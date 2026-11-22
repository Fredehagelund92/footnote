/**
 * A name as two names are compared: case, accents and spaces aside. Its own module, which imports
 * nothing, so code loaded later than the web app's first load can use it without splitting that.
 */
export function normalizeName(name: string): string {
  return name
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/æ/g, 'ae')
    .replace(/ø/g, 'o')
    .replace(/ß/g, 'ss')
    .replace(/ς/g, 'σ')
    .replace(/\s+/g, ' ')
    .trim()
}
