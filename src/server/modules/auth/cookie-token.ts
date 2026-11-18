/**
 * The one value of the cookie `name` in a Cookie header. Undefined when there is none, more than
 * one, or it is not 64 hex characters, as every token this service sets is.
 */
export function cookieValue(header: string | undefined, name: string): string | undefined {
  const values =
    header
      ?.split(';')
      .map((v) => v.trim())
      .filter((v) => v.startsWith(`${name}=`)) ?? []
  if (values.length !== 1) return undefined
  const value = values[0]!.slice(name.length + 1)
  return /^[a-f0-9]{64}$/.test(value) ? value : undefined
}
