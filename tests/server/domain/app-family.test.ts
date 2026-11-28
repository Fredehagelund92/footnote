import { describe, expect, it } from 'vitest'
import {
  appFamilies,
  appFamilyNames,
  appFamilyOf,
  friendlyAgentName,
} from '../../../src/domain/app-family.ts'

it('maps the names agents send to a family from the fixed list (FR-410)', () => {
  const cases: [unknown, string][] = [
    ['claude-code', 'claude_code'],
    ['Claude Code', 'claude_code'],
    ['claude-ai', 'claude_ai'],
    ['Anthropic/ClaudeAI', 'claude_ai'],
    ['openai-mcp', 'chatgpt'],
    ['ChatGPT', 'chatgpt'],
    ['codex-mcp-client', 'codex'],
    ['cursor-vscode', 'cursor'],
    ['Visual Studio Code', 'vscode_copilot'],
    ['Visual Studio Code - Insiders', 'vscode_copilot'],
    ['windsurf-client', 'windsurf'],
    ['gemini-cli-mcp-client', 'gemini_cli'],
    ['goose', 'goose'],
    ['footnote-eval-runner', 'footnote'],
    ['  CLAUDE-CODE  ', 'claude_code'],
  ]
  for (const [name, family] of cases) expect(appFamilyOf(name), String(name)).toBe(family)
})

it('makes any other name another app, and a missing one unknown, so free text never passes', () => {
  for (const name of [
    'Alice Smith private agent',
    'claude-codex-clone',
    'my claude',
    'footnote',
    'x',
  ])
    expect(appFamilyOf(name), name).toBe('other')
  for (const name of [undefined, null, '', '   ', 42, { name: 'claude-code' }])
    expect(appFamilyOf(name)).toBe('unknown')
  // Whatever arrives, the answer is on the list the database allows (mcp_requests).
  for (const name of ['a'.repeat(10_000), 'claude-code' + 'x'.repeat(200), '\u0000'])
    expect(appFamilies).toContain(appFamilyOf(name))
})

it('names every family in words', () => {
  expect(Object.keys(appFamilyNames).sort()).toEqual([...appFamilies].sort())
})

describe('the name people know an agent by', () => {
  it('has no name for a proxy, a bridge or a command line, so a screen says "your agent"', () => {
    for (const name of [
      'mcp-cli-proxy',
      'mcp-remote',
      'MCP CLI Proxy',
      'my-agent',
      'acme_bridge',
      'internal-gateway/1.2',
      'mcpbridge',
      '   ',
      '',
      undefined,
      42,
    ])
      expect(friendlyAgentName(name), String(name)).toBeNull()
  })

  it('names a known app as people know it, whatever its client calls itself', () => {
    const cases: [string, string][] = [
      ['claude-code', 'Claude Code'],
      ['claude-ai', 'Claude app'],
      ['openai-mcp', 'ChatGPT'],
      ['codex-mcp-client', 'Codex'],
      ['cursor-vscode', 'Cursor'],
      ['windsurf-client', 'Windsurf'],
      ['gemini-cli-mcp-client', 'Gemini CLI'],
      ['goose', 'goose'],
    ]
    for (const [name, shown] of cases) expect(friendlyAgentName(name), name).toBe(shown)
  })

  it('keeps a name that is already plain, such as one a person or an admin typed', () => {
    for (const name of [
      'Claude',
      'Claude Code',
      'Cursor',
      'VS Code',
      'Perplexity',
      'Weekly metrics bot',
    ])
      expect(friendlyAgentName(name), name).toBe(name)
  })

  it('gives the same answer for its own answer', () => {
    for (const name of [
      'claude-ai',
      'cursor-vscode',
      'mcp-cli-proxy',
      'Perplexity',
      'openai-mcp',
    ]) {
      const once = friendlyAgentName(name)
      expect(friendlyAgentName(once), name).toBe(once)
    }
  })
})
