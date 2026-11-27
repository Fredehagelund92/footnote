// A host that is the computer itself. A browser opens such an address on the reader's own
// computer and a server on its own, so a link to it opens nowhere else, and a server asked to read
// it looks at itself.

/**
 * How a host names the computer itself: `localhost` for that name or one under it, `address` for a
 * loopback address, and null for any other host.
 */
export function localHost(hostname: string): 'localhost' | 'address' | null {
  const host = hostname.toLowerCase()
  if (host === 'localhost' || host.endsWith('.localhost')) return 'localhost'
  return /^127\./.test(host) || host === '[::1]' || host === '0.0.0.0' ? 'address' : null
}

/** Whether a link opens only on the computer it was made on. */
export const opensOnlyHere = (link: string) => localHost(URL.parse(link)?.hostname ?? '') !== null
