import { describe, expect, it } from 'vitest'
import {
  ADDRESS,
  ASK_FIRST_LINE,
  CLAUDE_CODE_COMMAND,
  cursorLink,
  GUIDES,
  liveCopy,
  PROMPT,
  PROMPT_PARTS,
  vscodeLink,
} from '@/lib/agents'

// The prompt is what the page shows, word for word; the quick links carry the same address.

describe('the prompt', () => {
  it('copies exactly what the page shows', () => {
    expect(PROMPT).toBe(PROMPT_PARTS.map((p) => p.text).join('\n\n'))
    expect(PROMPT_PARTS.filter((p) => p.code).map((p) => p.text)).toEqual([
      CLAUDE_CODE_COMMAND,
      ASK_FIRST_LINE,
    ])
  })

  it('connects, adds the Ask-first line to the file the project uses, and never asks for a secret', () => {
    expect(PROMPT).toContain(ADDRESS)
    expect(PROMPT).toContain('CLAUDE.md if it exists, otherwise AGENTS.md')
    expect(PROMPT).toContain(ASK_FIRST_LINE)
    expect(PROMPT).toContain('Never ask me for a key or a token.')
  })
})

describe('the quick links', () => {
  it('installs the server in Cursor with its address', () => {
    const url = new URL(cursorLink())
    expect(url.protocol).toBe('cursor:')
    expect(JSON.parse(atob(url.searchParams.get('config')!))).toEqual({ url: ADDRESS })
  })

  it('installs the server in VS Code with its address', () => {
    const link = vscodeLink()
    expect(link.startsWith('vscode:mcp/install?')).toBe(true)
    expect(JSON.parse(decodeURIComponent(link.split('?')[1]!))).toMatchObject({ url: ADDRESS })
  })
})

describe('by hand', () => {
  it("ends every agent's steps with approving the connection in the browser", () => {
    for (const g of GUIDES)
      expect(
        g.steps.some((s) => /approve the connection in the browser/i.test(s.what)),
        g.id,
      ).toBe(true)
  })

  it('has one Claude for the terminal and one for the app, never two of the same name', () => {
    const names = GUIDES.map((g) => g.name)
    expect(new Set(names).size).toBe(names.length)
  })
})

describe('the live line before a wait begins', () => {
  const idle = (connected?: number) =>
    liveCopy('idle', 'prompt', 'Claude Code', 'Jon Abara', connected)

  it('says Not connected yet only while no agent is connected', () => {
    expect(idle().title).toBe('Not connected yet')
    expect(idle(0).title).toBe('Not connected yet')
  })

  it('says how many agents are connected, so it never contradicts the list under it', () => {
    expect(idle(1)).toEqual({
      title: '1 agent is connected',
      body: 'To connect another, paste the prompt. This page says Connected when it signs in.',
    })
    expect(idle(2).title).toBe('2 agents are connected')
  })

  it('says what the wait is doing, whatever is connected already', () => {
    expect(liveCopy('waiting', 'prompt', 'Claude Code', 'Jon Abara', 2).title).toBe(
      'Waiting for your agent to connect…',
    )
  })
})
