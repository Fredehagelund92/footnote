import { isIP } from 'node:net'

/**
 * Where a base URL's host is, for who receives what is sent to it: this computer (a loopback
 * address, or Docker's name for the machine it runs on), a private network, or the internet.
 */
export type Place = 'this computer' | 'private network' | 'internet'

export function placeOf(host: string): Place {
  const name = host.replace(/^\[|\]$/g, '').toLowerCase()
  if (
    name === 'localhost' ||
    name.endsWith('.localhost') ||
    name === 'host.docker.internal' ||
    name === '::1' ||
    (isIP(name) === 4 && name.startsWith('127.'))
  )
    return 'this computer'
  if (isIP(name) === 4) {
    const [a, b] = name.split('.').map(Number) as [number, number]
    if (a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168))
      return 'private network'
    return 'internet'
  }
  // IPv6 unique local addresses (fc00::/7).
  if (isIP(name) === 6 && /^f[cd]/.test(name)) return 'private network'
  return 'internet'
}
