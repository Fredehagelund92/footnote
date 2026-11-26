/**
 * "customs.example": a link's host, the way a link chip names it; a source that is no link stays
 * as written.
 */
export const hostOf = (url: string) => {
  try {
    return new URL(url).host.replace(/^www\./, '') || url
  } catch {
    return url.replace(/^https?:\/\//, '')
  }
}

/**
 * A link's address when a reader may follow it (http, https or mailto, or one on this site);
 * null for any other, such as javascript:, so its words are drawn without a link. A suggestion's
 * text can come from an agent or a document.
 */
export function safeHref(href: string | null): string | null {
  if (!href) return null
  try {
    const url = new URL(href, 'https://footnote.invalid')
    return ['http:', 'https:', 'mailto:'].includes(url.protocol) ? href : null
  } catch {
    return null
  }
}
