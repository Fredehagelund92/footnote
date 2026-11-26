/**
 * The hosts an admin lists for Footnote never to read a link on (FR-144): a name such as
 * intranet.example.com, which also covers its subdomains, or an IPv4 address. Kept in lower case
 * with no final dot.
 */

/** The most hosts an admin may list. */
export const NEVER_READ_HOSTS_MAX = 500

/** A host as it is kept: lower case, with no space around it and no final dot. */
export const normalizeHost = (host: string) => host.trim().toLowerCase().replace(/\.$/, '')

/** Whether a host, as it is kept, is one a link can be on. */
export const isHost = (host: string) =>
  /^(?=.{1,253}$)[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)*$/.test(
    host,
  )
