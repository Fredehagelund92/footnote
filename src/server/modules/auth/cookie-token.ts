/*
  The service's cookies were named `heed_*` until the product was renamed Footnote. A new name
  alone would sign every browser out at the upgrade, and break a sign-in that was under way. So for
  one release a cookie is still read under its former name when the browser sends none under the
  new one (docs/operations.md, "Upgrade from Heed 0.1"). Signing in and out clears the former
  session cookie, so it goes away with the next session.
*/

/** A cookie's name before the rename to Footnote. */
export const formerCookieName = (name: string) => name.replace(/^footnote_/, 'heed_')

/**
 * The one value of the cookie `name` in a Cookie header, or of its former name when the header
 * has none under the new one. Undefined when there is none, more than one, or it is not 64 hex
 * characters, as every token this service sets is.
 */
export function cookieToken(header: string | undefined, name: string): string | undefined {
  const pairs = header?.split(';').map((v) => v.trim()) ?? []
  for (const candidate of [name, formerCookieName(name)]) {
    const values = pairs.filter((v) => v.startsWith(`${candidate}=`))
    if (!values.length) continue
    if (values.length !== 1) return undefined
    const value = values[0]!.slice(candidate.length + 1)
    return /^[a-f0-9]{64}$/.test(value) ? value : undefined
  }
  return undefined
}
