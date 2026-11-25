import type { Settings } from '../client'
import { AGENT_TOOLS } from '@/lib/agents'
import { MCP_URL } from '@/lib/brand'
import { toolsFor, type AgentToolName } from '@domain/agents'
import { LIVE_PHASES, MOCK_SIGN_IN_MS, type Connected, type LivePhase } from '@/lib/connect'
import type { ConnectRequest } from '@contract/connections'
import { MOCK_CONNECT_REQUEST, mockConnectRequest, seedAgents, toolRows } from './data/agents'
import { demoConnected } from './data/integrations'
import type { Address } from './scenario'

// The mock's switches and connections, kept until the page reloads: the tools agents call, Pause
// sharing, the tools connected, and the agents signed in. The review flag ?connect= shows the live
// line in any state.

export function createSettings() {
  /** The tools an admin switched off; every other is on. */
  let off: string[] = []
  let pause: Settings['pause'] = { all: false, domain: null }
  let connected: string[] = [...demoConnected]
  let agents: Connected[] = [...seedAgents]
  let made = 0
  /** Whether the demo's waiting agent sign-in was answered on the consent page. */
  let answered = false

  /**
   * A sign-in adds the agent on top, marked new, with every tool on that the person allowed; the
   * same agent for the same person keeps its row and the switches an admin set, and moves up.
   */
  const addAgent = (agent: string, who: string) => {
    const was = agents.find((r) => r.kind === 'app' && r.agent === agent && r.who === who)
    const row: Connected = {
      id: was?.id ?? `agent-${++made}`,
      kind: 'app',
      agent,
      who,
      host: 'claude.ai',
      since: '23 Oct 2026',
      used: 'Just now',
      fresh: true,
      tools: was?.tools ?? toolRows('app', ['read', 'feedback', 'propose']),
      ...(was?.setBy ? { setBy: was.setBy } : {}),
      sent: was?.sent ?? 0,
      recent: was?.recent ?? [],
      policies: [],
    }
    agents = [
      row,
      ...agents.filter((r) => r !== was).map((r) => (r.fresh ? { ...r, fresh: false } : r)),
    ]
  }

  return {
    /** The switches as they stand. */
    read(): Settings {
      return {
        mcpAddress: MCP_URL,
        tools: Object.fromEntries(AGENT_TOOLS.map((t) => [t.name, !off.includes(t.name)])),
        pause,
        connected,
      }
    },
    setTool(name: string, on: boolean) {
      off = on ? off.filter((t) => t !== name) : [...new Set([...off, name])]
    },
    setPause(change: { all: boolean } | { domain: string | null }) {
      pause = { ...pause, ...change }
    },
    connect(id: string) {
      if (!connected.includes(id)) connected = [...connected, id]
    },
    disconnect(id: string) {
      connected = connected.filter((c) => c !== id)
    },
    /** Every agent for an admin; anyone else sees the apps they signed in with. */
    agents: (me: string, admin: boolean) =>
      admin ? agents : agents.filter((r) => r.kind === 'app' && r.who === me),
    /** A new access key goes on top of Connected agents, by its name and who made it, never used yet. */
    addKey(who: string, name: string) {
      const row: Connected = {
        id: `key-${++made}`,
        kind: 'key',
        agent: name,
        who,
        since: '23 Oct 2026',
        used: 'Never',
        fresh: true,
        tools: toolRows('key', ['read', 'feedback']),
        sent: 0,
        recent: [],
        policies: [],
      }
      agents = [row, ...agents.map((r) => (r.fresh ? { ...r, fresh: false } : r))]
    },
    /** False when no access key has that id. */
    renameKey(id: string, name: string) {
      if (!agents.some((r) => r.id === id && r.kind === 'key')) return false
      agents = agents.map((r) => (r.id === id ? { ...r, agent: name } : r))
      return true
    },
    /** Switches one tool for one agent. Null for no agent, or suggest_context on an access key. */
    setAgentTool(id: string, tool: AgentToolName, on: boolean, by: string) {
      const row = agents.find((r) => r.id === id)
      if (!row || (on && !toolsFor(row.kind).includes(tool))) return null
      if (row.tools.find((t) => t.tool === tool)?.on === on) return false
      agents = agents.map((r) =>
        r === row
          ? {
              ...r,
              setBy: { name: by, on: '23 Oct 2026' },
              tools: r.tools.map((t) => (t.tool === tool ? { ...t, on } : t)),
            }
          : r,
      )
      return true
    },
    /** The agent that has the id, or none. */
    agent: (id: string) => agents.find((r) => r.id === id),
    revoke(id: string) {
      agents = agents.filter((r) => r.id !== id)
    },
    /** In the demo an agent signs in 8 seconds after a copy; ?connect=declined says it was declined. */
    check(address: Address, since: number, agent: string, me: string) {
      if (address.query.connect === 'declined') return { state: 'declined' as const }
      if (Date.now() - since < MOCK_SIGN_IN_MS) return { state: 'waiting' as const }
      if (agents[0]?.agent !== agent || agents[0]?.who !== me || !agents[0]?.fresh)
        addAgent(agent, me)
      return { state: 'connected' as const, agent }
    },
    /** The demo's agent sign-in at the consent page, until it is answered; null for any other. */
    connectRequest(id: string): ConnectRequest | null {
      return id === MOCK_CONNECT_REQUEST && !answered
        ? { ...mockConnectRequest, scopes: [...mockConnectRequest.scopes] }
        : null
    },
    /** The answer: a yes signs the agent in as the person. False when there is nothing to answer. */
    answerRequest(id: string, allow: boolean, me: string): boolean {
      if (id !== MOCK_CONNECT_REQUEST || answered) return false
      answered = true
      if (allow) addAgent(mockConnectRequest.clientName, me)
      return true
    },
    /** The live line's state a review address shows; ?connect=connected has the agent signed in. */
    review(address: Address, me: string): LivePhase | null {
      const flag = LIVE_PHASES.find((p) => p === address.query.connect) ?? null
      if (flag === 'connected' && !(agents[0]?.agent === 'Claude Code' && agents[0]?.who === me))
        addAgent('Claude Code', me)
      return flag
    },
  }
}
