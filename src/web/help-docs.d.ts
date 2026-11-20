// The documentation's pages, read at build time (scripts/docs-plugin.ts).
declare module 'virtual:help-docs' {
  import type { Docs } from '@domain/docs'
  const docs: Docs
  export default docs
  /** The release the pages describe, package.json's version: `0.1.0`. */
  export const version: string
}

// Each page's title by its slug, without the pages (scripts/docs-plugin.ts).
declare module 'virtual:help-docs-titles' {
  const titles: Record<string, string>
  export default titles
}
