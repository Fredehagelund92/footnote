import { defineConfig } from 'astro/config'
import { readSettings } from './lib/settings.ts'

/*
  The landing page and the site's 404 page (site/README.md), at the root of the site. The docs are
  a build of their own (astro.config.ts) into dist/docs, so each version of the docs is a folder
  that holds everything it needs: its pages, styles and search. `npm run build` builds this first,
  as it empties dist.
*/

const { site, root } = readSettings(process.env)

export default defineConfig({
  site: site || undefined,
  base: `${root}/`,
  srcDir: './landing',
  outDir: './dist',
  trailingSlash: 'always',
  // The web app's icons and logo, so a change there reaches the site.
  publicDir: '../src/web/public',
  devToolbar: { enabled: false },
})
