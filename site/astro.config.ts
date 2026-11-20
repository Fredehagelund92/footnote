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

// The landing page's terminal as a code theme (shared/tokens.css): its ink, with comments and keys
// in its dim grey, as get_context's reply reads on the landing page.
const terminal = {
  name: 'footnote-terminal',
  type: 'dark',
  colors: { 'editor.background': '#0d1118', 'editor.foreground': '#e6e9f0' },
  tokenColors: [
    {
      scope: [
        'comment',
        'punctuation.definition.comment',
        'support.type.property-name',
        'punctuation.support.type.property-name',
      ],
      settings: { foreground: '#8b94a7' },
    },
  ],
}

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
        './shared/ground.css',
        './src/styles/theme.css',
      ],
      sidebar: sidebar(pages),
      // The code block is the landing page's terminal, dark in both themes, so one theme is enough.
      expressiveCode: {
        themes: [terminal],
        defaultProps: { wrap: true },
        styleOverrides: {
          borderRadius: '11px',
          borderColor: 'var(--term-rule)',
          codeBackground: 'var(--term)',
          codeFontFamily: 'var(--mono)',
          codeFontSize: '0.8125rem',
          codeFontWeight: '450',
          codeLineHeight: '1.65',
          codePaddingBlock: '0.8125rem',
          codePaddingInline: '0.9375rem',
          uiFontFamily: 'var(--sans)',
          uiFontSize: '0.84375rem',
          frames: {
            frameBoxShadowCssValue: 'none',
            editorActiveTabIndicatorHeight: '0',
            editorTabBarBackground: 'var(--term)',
            editorTabBarBorderBottomColor: 'transparent',
            editorActiveTabBackground: 'var(--term)',
            editorActiveTabForeground: 'var(--term-dim)',
            terminalTitlebarForeground: 'var(--term-dim)',
            terminalTitlebarBackground: 'var(--term)',
            terminalTitlebarBorderBottomColor: 'var(--term-rule)',
            terminalBackground: 'var(--term)',
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
