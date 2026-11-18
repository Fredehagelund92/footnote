import type { DevPerson } from './modules/auth/index.ts'

/**
 * What the Vercel bundle (scripts/vercel-build.ts) carries in place of the files a function cannot
 * read beside its code: Footnote's version from package.json, and the picker's people from
 * FOOTNOTE_DEV_PEOPLE_FILE. esbuild writes their JSON in where FOOTNOTE_BUNDLE stands. Everywhere else it
 * is undefined, and both are read from their files.
 */
declare const FOOTNOTE_BUNDLE: string | undefined

export const bundled =
  typeof FOOTNOTE_BUNDLE === 'undefined'
    ? undefined
    : (JSON.parse(FOOTNOTE_BUNDLE) as { version: string; people: DevPerson[] })
