import { unified } from '@astrojs/markdown-remark'
import starlight from '@astrojs/starlight'
import { defineConfig } from 'astro/config'
import { linkContext } from './lib/links.ts'
import { repoRoot, sidebar, sitePages } from './lib/pages.ts'
import { remarkFootnoteDocs } from './lib/remark-footnote-docs.ts'
import { docsPath, readSettings } from './lib/settings.ts'

/*
  The docs (site/README.md): docs/help and the operator pages, read where they are, in the site's
  design. One build makes one version, in a folder of its own under /docs/ that holds its
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

// The landing page's terminal as a code theme, in dark and in light (shared/tokens.css): its card,
// its words, and comments and keys a step dimmer, as get_context's reply reads on the landing page.
const terminal = (type: 'dark' | 'light', card: string, words: string, dim: string) => ({
  name: `footnote-${type}`,
  type,
  colors: { 'editor.background': card, 'editor.foreground': words },
  tokenColors: [
    {
      scope: [
        'comment',
        'punctuation.definition.comment',
        'support.type.property-name',
        'punctuation.support.type.property-name',
      ],
      settings: { foreground: dim },
    },
  ],
})

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
        './shared/tokens.css',
        './shared/fonts.css',
        './shared/chrome.css',
        './src/styles/theme.css',
      ],
      sidebar: sidebar(pages),
      // The code block is the landing page's terminal, in the reader's theme.
      expressiveCode: {
        themes: [
          terminal('dark', '#0f1011', '#d0d6e0', '#82878f'),
          terminal('light', '#ffffff', '#2f3338', '#656b74'),
        ],
        defaultProps: { wrap: true },
        styleOverrides: {
          borderRadius: '12px',
          borderColor: 'var(--line)',
          codeBackground: 'var(--bg-1)',
          codeFontFamily: 'var(--mono)',
          codeFontSize: '0.8125rem',
          codeFontWeight: '400',
          codeLineHeight: '1.7',
          codePaddingBlock: '1rem',
          codePaddingInline: '1.25rem',
          uiFontFamily: 'var(--sans)',
          uiFontSize: '0.8125rem',
          frames: {
            frameBoxShadowCssValue: 'none',
            editorActiveTabIndicatorHeight: '0',
            editorTabBarBackground: 'var(--bg-1)',
            editorTabBarBorderBottomColor: 'transparent',
            editorActiveTabBackground: 'var(--bg-1)',
            editorActiveTabForeground: 'var(--fg-4)',
            terminalTitlebarForeground: 'var(--fg-4)',
            terminalTitlebarBackground: 'var(--bg-1)',
            terminalTitlebarBorderBottomColor: 'var(--line)',
            terminalBackground: 'var(--bg-1)',
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
      // The landing page's header and footer, its theme button, and its theme and font in the head.
      components: {
        Footer: './src/components/Footer.astro',
        Head: './src/components/Head.astro',
        PageTitle: './src/components/PageTitle.astro',
        Search: './src/components/Search.astro',
        SiteTitle: './src/components/SiteTitle.astro',
        SocialIcons: './src/components/SocialIcons.astro',
        ThemeProvider: './src/components/ThemeProvider.astro',
        ThemeSelect: './src/components/ThemeSelect.astro',
      },
    }),
  ],
})
