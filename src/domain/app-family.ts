/**
 * The agent that called Footnote's MCP server, in coarse buckets from a fixed list (FR-410). An MCP
 * client names itself in `clientInfo` (on protocol 2026-07-28 with every request, before that
 * when it starts a session). That name is self-chosen free text, so it is never kept: it is mapped
 * here to one of these families, and anything not on the list becomes `other`. A family names the
 * kind of app, never a person, a version or the model behind it, which the protocol never says.
 *
 * Claude's desktop and web apps both reach a remote server as `claude-ai`, so they are one family,
 * the Claude app.
 */
export const appFamilies = [
  'claude_code',
  'claude_ai',
  'chatgpt',
  'codex',
  'cursor',
  'vscode_copilot',
  'windsurf',
  'gemini_cli',
  'goose',
  'footnote',
  'other',
  'unknown',
] as const
export type AppFamily = (typeof appFamilies)[number]

/** The names people know the families by. */
export const appFamilyNames: Record<AppFamily, string> = {
  claude_code: 'Claude Code',
  claude_ai: 'Claude app',
  chatgpt: 'ChatGPT',
  codex: 'Codex',
  cursor: 'Cursor',
  vscode_copilot: 'VS Code (Copilot)',
  windsurf: 'Windsurf',
  gemini_cli: 'Gemini CLI',
  goose: 'goose',
  footnote: 'Built-in test runs',
  other: 'Another agent',
  unknown: 'Agent not named',
}

/** The first rule that matches a client's name, lower case, decides its family. */
const rules: readonly [AppFamily, RegExp][] = [
  // The eval runner, footnote-eval-runner.
  ['footnote', /^footnote[-_ ]/],
  ['claude_code', /^claude[-_ ]?code\b/],
  ['claude_ai', /^(anthropic\/)?claude([-_ .]?(ai|desktop))?$/],
  ['chatgpt', /^(openai-mcp|chatgpt)\b/],
  ['codex', /^codex\b/],
  ['cursor', /^cursor\b/],
  ['vscode_copilot', /^(visual studio code|vscode|vs code|github copilot|copilot)\b/],
  ['windsurf', /^windsurf\b/],
  ['gemini_cli', /^gemini[-_ ]?cli\b/],
  ['goose', /^goose\b/],
]

/**
 * The family of a client's self-reported name: `unknown` when it sent none, `other` when it is
 * not on the list. The name itself goes no further than this function.
 */
export function appFamilyOf(name: unknown): AppFamily {
  if (typeof name !== 'string') return 'unknown'
  const normal = name.trim().slice(0, 100).toLowerCase()
  if (!normal) return 'unknown'
  return rules.find(([, pattern]) => pattern.test(normal))?.[0] ?? 'other'
}

/** A name a program gave itself, not one a person would say: one word with a separator, or lower case. */
const looksTechnical = (name: string) =>
  !/\s/.test(name) && (/[-_/.:@]/.test(name) || name === name.toLowerCase())

/** Words that name how a program connects, never what it is: a proxy, a bridge, a command line. */
const plumbing = /\b(mcp|proxy|bridge|cli|remote|client|gateway|sdk|inspector)\b/i

/**
 * The name people know an agent by, from the name its program reported when it connected: a known
 * app by its own name, such as Cursor for `cursor-vscode`, and a name that is already plain as it
 * is. `null` when it is a technical identifier, such as `mcp-cli-proxy`: the screen then says
 * "your agent", never the identifier. It gives the same answer for its own answer, so a name
 * that went through it once can go through it again.
 */
export function friendlyAgentName(name: unknown): string | null {
  if (typeof name !== 'string') return null
  const trimmed = name.trim().slice(0, 100)
  if (!trimmed) return null
  const family = appFamilyOf(trimmed)
  if (family !== 'other' && family !== 'unknown')
    return looksTechnical(trimmed) ? appFamilyNames[family] : trimmed
  return looksTechnical(trimmed) || plumbing.test(trimmed) ? null : trimmed
}
