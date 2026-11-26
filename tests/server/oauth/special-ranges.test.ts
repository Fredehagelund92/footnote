import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { blockedRanges, isPublicAddress } from '../../../src/server/modules/oauth/index.ts'

/*
  The addresses the service never fetches from, against IANA's IPv4 and IPv6 special-purpose
  address registries (tests/fixtures/iana, retrieved 24 Nov 2026 from
  https://www.iana.org/assignments/iana-ipv4-special-registry and iana-ipv6-special-registry).
  Every block the registries do not call globally reachable is refused, its first and last address
  too; and every range the service refuses is the registry's, or one of the few it refuses on
  purpose beyond it. When IANA adds a block, refresh the files: this test then names what to add.
*/

type Block = { network: string; prefix: number; reachable: string }

/** A registry's rows, as IANA writes them: quoted fields may hold commas. */
function registry(file: string): Block[] {
  const text = readFileSync(new URL(`../../fixtures/iana/${file}`, import.meta.url), 'utf8')
  const rows = text
    .trim()
    .split('\n')
    .map((line) =>
      [...line.matchAll(/("(?:[^"]|"")*"|[^,]*)(?:,|$)/g)].map((m): string => m[1] ?? ''),
    )
  const header = rows[0]!
  const at = (name: string) => header.indexOf(name)
  return rows.slice(1).flatMap((row) =>
    row[at('Address Block')]!.replace(/^"|"$/g, '')
      .split(',')
      .map((block) => block.replace(/\[\d+\]/g, '').trim())
      .map((block) => {
        const [network, prefix] = block.split('/')
        return {
          network: network!,
          prefix: Number(prefix),
          reachable: row[at('Globally Reachable')]!.replace(/\[\d+\]/g, '').trim(),
        }
      }),
  )
}

const v4 = registry('ipv4-special-registry.csv')
const v6 = registry('ipv6-special-registry.csv')

/** An address as a number, and back. */
const bits = (family: 4 | 6) => (family === 4 ? 32 : 128)
function toNumber(address: string, family: 4 | 6): bigint {
  if (family === 4) return address.split('.').reduce((n, part) => (n << 8n) | BigInt(part), 0n)
  const [head = '', tail] = address.split('::')
  const groups = (part: string) => (part ? part.split(':') : [])
  const left = groups(head)
  const right = tail === undefined ? [] : groups(tail)
  const all = [
    ...left,
    ...Array.from({ length: 8 - left.length - right.length }, () => '0'),
    ...right,
  ]
  return all.reduce((n, group) => (n << 16n) | BigInt(`0x${group}`), 0n)
}
function toAddress(n: bigint, family: 4 | 6): string {
  if (family === 4) return [24n, 16n, 8n, 0n].map((shift) => String((n >> shift) & 255n)).join('.')
  return Array.from({ length: 8 }, (_, i) =>
    ((n >> BigInt(112 - 16 * i)) & 0xffffn).toString(16),
  ).join(':')
}
const ends = ({ network, prefix }: Block, family: 4 | 6) => {
  const first = toNumber(network, family)
  const size = 1n << BigInt(bits(family) - prefix)
  return [toAddress(first, family), toAddress(first + size - 1n, family)]
}

/** Not globally reachable: False, N/A (Teredo, 6to4) or unsaid (deprecated blocks). */
const notReachable = (b: Block) => b.reachable !== 'True'

/**
 * Refused beyond the registries, on purpose: multicast (in IANA's multicast registry), the
 * deprecated site-local and IPv4-compatible ranges, and translation ranges that carry an IPv4
 * address inside, which the registry calls globally reachable.
 */
const beyond = ['224.0.0.0/4', '::/96', '64:ff9b::/96', 'fec0::/10', 'ff00::/8']

describe("IANA's special-purpose registries", () => {
  it('has every block that is not globally reachable refused, its first and last address too', () => {
    for (const [family, blocks] of [
      [4, v4],
      [6, v6],
    ] as const)
      for (const block of blocks.filter(notReachable))
        for (const address of ends(block, family))
          expect(isPublicAddress(address), `${block.network}/${block.prefix}: ${address}`).toBe(
            false,
          )
  })

  it('refuses only the registries’ blocks, and the few named beyond them', () => {
    const listed = new Set([...v4, ...v6].map((b) => `${b.network}/${b.prefix}`))
    for (const [network, prefix] of blockedRanges) {
      const range = `${network}/${prefix}`
      expect(listed.has(range) || beyond.includes(range), range).toBe(true)
    }
  })

  it('leaves public addresses public', () => {
    for (const address of ['8.8.8.8', '1.1.1.1', '2606:4700:4700::1111', '2a00:1450::1'])
      expect(isPublicAddress(address), address).toBe(true)
  })
})
