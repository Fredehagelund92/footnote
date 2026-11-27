import { spawn } from 'node:child_process'
import { chmod, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { generateKeyPairSync } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { testDatabase } from './support.ts'

/*
  The service starts on its FOOTNOTE_ settings alone and uses the key files they name: it listens,
  serves /metrics to the token, keeps the keys it was given and prints no value of a setting.
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

describe('a start with the FOOTNOTE_ settings', () => {
  it('listens, reads each setting and keeps the key files it names', async () => {
    const folder = await mkdtemp(join(tmpdir(), 'footnote-settings-'))
    const oauthKey = generateKeyPairSync('ed25519')
      .privateKey.export({ format: 'pem', type: 'pkcs8' })
      .toString()
    const keys = [['.footnote-oauth-key.pem', oauthKey]] as const
    for (const [name, content] of keys) {
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
        FOOTNOTE_AUTH: 'dev',
        FOOTNOTE_WEB_ORIGINS: 'http://localhost:5173',
        FOOTNOTE_FIXED_TODAY: '2026-01-15',
        FOOTNOTE_METRICS_TOKEN: metricsToken,
        FOOTNOTE_OAUTH_SIGNING_KEY_FILE: join(folder, '.footnote-oauth-key.pem'),
      },
    })
    let output = ''
    child.stdout.on('data', (chunk: Buffer) => (output += chunk.toString()))
    child.stderr.on('data', (chunk: Buffer) => (output += chunk.toString()))
    const exited = new Promise((resolve) => child.on('exit', resolve))
    try {
      expect(await healthy(port, Date.now() + 50_000), output).toBe(true)
      const metrics = await fetch(`http://127.0.0.1:${port}/metrics`, {
        headers: { authorization: `Bearer ${metricsToken}` },
      })
      expect(metrics.status, output).toBe(200)
      expect(await metrics.text()).toContain('footnote_')
      expect(output).not.toContain(metricsToken)
      for (const [name, content] of keys)
        expect(await readFile(join(folder, name), 'utf8')).toBe(content)
    } finally {
      child.kill('SIGTERM')
      await exited
      await rm(folder, { recursive: true, force: true })
    }
  }, 90_000)
})
