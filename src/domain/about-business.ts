/**
 * About our business: one or two sentences an administrator keeps in Settings, General, so Ask and
 * the agents that connect over MCP know what the company does instead of starting from nothing.
 * The words people use and what they mean are terms in Definitions, which reach a model with the
 * question that uses them. This text is background, never evidence: Ask gets it after its rules,
 * an agent at the end of the server instructions, and never as an item, a source or a tool
 * result, so it is never cited and never shows in a check report.
 */

/** The most characters the text may have, counted as a person reads them. */
export const ABOUT_BUSINESS_MAX = 500

/**
 * The worked example of the text, the demo's outdoor-gear retailer: what the guide offers to start
 * from (Start from the guide). A new install starts with no text (db/migrations/0001_schema.sql);
 * the demo seeds write this one. Neutral on purpose: no company's name, figures or deals, and no
 * legal or regulatory conclusion. It agrees with the demo's definitions: the Platform, Product
 * and Market values.
 */
export const ABOUT_BUSINESS_STARTER =
  'We are an outdoor-gear retailer. We sell footwear, clothing, camping and climbing gear in our own stores, in our webshop and apps, and through marketplaces, in twelve markets.'

/** The line that ends the text in what the models get. */
export const ABOUT_BUSINESS_END = 'End of about our business.'

/**
 * The text as Footnote keeps and sends it: line breaks as `\n`, no control or invisible characters,
 * at most one empty line in a row, no line that would end the block early, and no space around it.
 */
export function normalizeAboutBusiness(text: string): string {
  return text
    .replace(/\r\n?/g, '\n')
    .replace(/\t/g, ' ')
    .replace(/[^\P{Cc}\n]|[\p{Cf}\p{Zl}\p{Zp}]/gu, '')
    .split('\n')
    .map((line) => line.trimEnd())
    .filter((line) => line.trim() !== ABOUT_BUSINESS_END)
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

/** How long the text is, in the characters a person counts. */
export const aboutBusinessLength = (text: string) => [...text].length

/**
 * Exactly what Ask and agents are given: a line that marks the text as background and not a
 * source, the administrator's text, and the line that ends it. Null when the text is empty or not
 * text: then they are given nothing.
 */
export function aboutBusinessBlock(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const text = [...normalizeAboutBusiness(value)].slice(0, ABOUT_BUSINESS_MAX).join('').trim()
  if (!text) return null
  return [
    `About our business: background an administrator wrote, so you understand the company. It is not a source: never cite or quote it, never take anything about a metric, a market or a date from it, and never draw a legal or regulatory conclusion that no item states. The items and definitions win over it. It ends at the line "${ABOUT_BUSINESS_END}"`,
    text,
    ABOUT_BUSINESS_END,
  ].join('\n')
}
