import { unified } from '@astrojs/markdown-remark'
import starlight from '@astrojs/starlight'
import { defineConfig } from 'astro/config'
import { linkContext } from './lib/links.ts'
import { repoRoot, sidebar, sitePages } from './lib/pages.ts'
import { remarkFootnoteDocs } from './lib/remark-footnote-docs.ts'
import { docsPath, readSettings } from './lib/settings.ts'

/*
  The docs (site/README.md): docs/help and the operator pages, read where they are, in the landing
  page's design. One build makes one version, in a folder of its own under /docs/ that holds its
  pages, styles and search; nothing here depends on the other versions. The landing page is built
  apart (astro.landing.config.ts).
*/

const settings = readSettings(process.env)
const base = docsPath(settings)
const pages = sitePages()
// /docs/next/ follows main, so it stays out of search engines and carries no canonical addresses.
const isNext = settings.version === 'next'
// From the repository, as GitHub shows it: an image the site does not have to carry.
const socialPreview =
  'https://raw.githubusercontent.com/Fredehagelund92/footnote/main/docs/images/footnote-social-preview.png'

export default defineConfig({
  site: !isNext && settings.site ? settings.site : undefined,
  base: `${base}/`,
  outDir: `./dist${base.slice(settings.root.length)}`,
  trailingSlash: 'always',
  // The web app's icons and logo, so a change there reaches the site.
  publicDir: '../src/web/public',
  devToolbar: { enabled: false },
  markdown: {
    // Astro's default processor runs no remark plugins.
    processor: unified({
      remarkPlugins: [[remarkFootnoteDocs, linkContext(pages, base, settings.ref)]],
    }),
  },
  vite: { server: { fs: { allow: [repoRoot] } } },
  integrations: [
    starlight({
      title: settings.product,
      description: `Guides and reference for ${settings.product}.`,
      favicon: '/favicon.svg',
      // A wrong address anywhere opens the site's own 404 page, at the root (landing/pages/404.astro).
      disable404Route: true,
      customCss: [
        './shared/fonts.css',
        './shared/tokens.css',
        './shared/chrome.css',
        './src/styles/theme.css',
      ],
      sidebar: sidebar(pages),
      // The code block is dark in both themes, as on the landing page, so one theme is enough.
      expressiveCode: {
        themes: ['catppuccin-mocha'],
        defaultProps: { wrap: true },
        styleOverrides: {
          borderRadius: '10px',
          borderColor: 'transparent',
          codeBackground: 'var(--code-bg)',
          codeFontFamily: 'var(--mono)',
          codeFontSize: '0.8125rem',
          codeLineHeight: '1.65',
          uiFontFamily: 'var(--sans)',
          uiFontSize: '0.75rem',
          frames: {
            frameBoxShadowCssValue: 'none',
            editorActiveTabIndicatorHeight: '0',
            editorTabBarBackground: 'var(--code-bg)',
            editorActiveTabBackground: 'var(--code-bg)',
            editorActiveTabForeground: 'var(--code-dim)',
            terminalTitlebarForeground: 'var(--code-dim)',
            terminalTitlebarBackground: 'var(--code-bg)',
            terminalBackground: 'var(--code-bg)',
          },
        },
      },
      routeMiddleware: './src/route-data.ts',
      head: [
        {
          tag: 'link',
          attrs: {
            rel: 'alternate',
            type: 'text/plain',
            title: 'The docs for agents',
            href: `${base}/llms.txt`,
          },
        },
        // A shared link shows the logo's social preview (docs/design/logo.md).
        { tag: 'meta', attrs: { property: 'og:image', content: socialPreview } },
        { tag: 'meta', attrs: { name: 'twitter:card', content: 'summary_large_image' } },
        ...(isNext
          ? [{ tag: 'meta' as const, attrs: { name: 'robots', content: 'noindex' } }]
          : []),
      ],
      // The landing page's header and footer, its theme button and its theme in the head.
      components: {
        Footer: './src/components/Footer.astro',
        Search: './src/components/Search.astro',
        SiteTitle: './src/components/SiteTitle.astro',
        SocialIcons: './src/components/SocialIcons.astro',
        ThemeProvider: './src/components/ThemeProvider.astro',
        ThemeSelect: './src/components/ThemeSelect.astro',
      },
    }),
  ],
})
