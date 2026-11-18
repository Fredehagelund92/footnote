import { spawn } from 'node:child_process'
import { chmod, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { generateKeyPairSync } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { testDatabase } from './support.ts'

/*
  A 0.1 operator's environment, with only the old HEED_ names for the service's own settings and
  the key files under their old default names, starts the current service: it listens, warns once
  naming each old setting with its new name and no value, and moves each key file to its new name.
*/

const { url } = testDatabase()
const root = fileURLToPath(new URL('../../', import.meta.url))

async function freePort(): Promise<number> {
  const server = createServer()
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const { port } = server.address() as { port: number }
  await new Promise((resolve) => server.close(resolve))
  return port
}

async function healthy(port: number, deadline: number): Promise<boolean> {
  while (Date.now() < deadline) {
    try {
      if ((await fetch(`http://127.0.0.1:${port}/health`)).status === 200) return true
    } catch {
      // Not listening yet.
    }
    await new Promise((resolve) => setTimeout(resolve, 200))
  }
  return false
}

describe('a start with only the old HEED_ settings', () => {
  it('listens, warns once without values and moves the old key files', async () => {
    const folder = await mkdtemp(join(tmpdir(), 'old-settings-'))
    const stateKey = `${'ab'.repeat(32)}\n`
    const oauthKey = generateKeyPairSync('ed25519')
      .privateKey.export({ format: 'pem', type: 'pkcs8' })
      .toString()
    for (const [name, content] of [
      ['.heed-mcp-state.key', stateKey],
      ['.heed-oauth-key.pem', oauthKey],
    ] as const) {
      await writeFile(join(folder, name), content, { mode: 0o600 })
      await chmod(join(folder, name), 0o600)
    }
    const metricsToken = 'm'.repeat(40)
    const port = await freePort()
    const child = spawn(process.execPath, ['src/server/main.ts'], {
      cwd: root,
      env: {
        PATH: process.env.PATH ?? '',
        USER: process.env.USER ?? '',
        DATABASE_URL: url,
        PORT: String(port),
        HEED_AUTH: 'dev',
        HEED_WEB_ORIGINS: 'http://localhost:5173',
        HEED_FIXED_TODAY: '2026-01-15',
        HEED_METRICS_TOKEN: metricsToken,
        HEED_MCP_STATE_KEY_FILE: join(folder, '.footnote-mcp-state.key'),
        HEED_OAUTH_SIGNING_KEY_FILE: join(folder, '.footnote-oauth-key.pem'),
      },
    })
    let output = ''
    child.stdout.on('data', (chunk: Buffer) => (output += chunk.toString()))
    child.stderr.on('data', (chunk: Buffer) => (output += chunk.toString()))
    const exited = new Promise((resolve) => child.on('exit', resolve))
    try {
      expect(await healthy(port, Date.now() + 50_000), output).toBe(true)

      const warnings = output.split('\n').filter((line) => line.startsWith('Renamed settings:'))
      expect(warnings).toHaveLength(1)
      for (const name of [
        'AUTH',
        'WEB_ORIGINS',
        'FIXED_TODAY',
        'METRICS_TOKEN',
        'MCP_STATE_KEY_FILE',
        'OAUTH_SIGNING_KEY_FILE',
      ])
        expect(warnings[0]).toContain(`HEED_${name} is now FOOTNOTE_${name}`)
      expect(output).not.toContain(metricsToken)

      for (const [from, to, content] of [
        ['.heed-mcp-state.key', '.footnote-mcp-state.key', stateKey],
        ['.heed-oauth-key.pem', '.footnote-oauth-key.pem', oauthKey],
      ] as const) {
        expect(output).toContain(`Moved the key file ${join(folder, from)} to ${join(folder, to)}`)
        expect(await readFile(join(folder, to), 'utf8')).toBe(content)
        await expect(stat(join(folder, from))).rejects.toMatchObject({ code: 'ENOENT' })
      }
    } finally {
      child.kill('SIGTERM')
      await exited
      await rm(folder, { recursive: true, force: true })
    }
  }, 90_000)
})
