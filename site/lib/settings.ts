/*
  Where one build of the site is served and what it links to, read from the environment
  (site/README.md). With nothing set it is served at the root of its own host, as `npm run dev`
  and a team without internet access serve it.
*/

import { DEFAULT_PRODUCT_NAME } from '../../src/domain/brand.ts'

export type Settings = {
  /** The host, `https://footnote.vercel.app`. Empty: no canonical addresses and no sitemap. */
  site: string
  /** The path the whole site sits under, `/footnote`. Empty at the root of a host. */
  root: string
  /** The docs' folder in this build, `0.1` or `next`. Empty when the docs are alone at /docs/. */
  version: string
  /** The Git reference that links to repository files open at: the release tag, or main. */
  ref: string
  product: string
}

const withoutTrailingSlash = (path: string) => path.replace(/\/+$/, '')

/** SITE_URL is where the site's landing page is served: a custom domain or a path under a host. */
function readSiteUrl(value: string): Pick<Settings, 'site' | 'root'> {
  if (!value) return { site: '', root: '' }
  const url = URL.parse(value)
  if (!url || !/^https?:$/.test(url.protocol) || url.search || url.hash)
    throw new Error(
      `SITE_URL is "${value}": write the address of the site, such as https://example.com/footnote.`,
    )
  return { site: url.origin, root: withoutTrailingSlash(url.pathname) }
}

export function readSettings(env: Record<string, string | undefined>): Settings {
  const version = env.DOCS_VERSION ?? ''
  if (version && !/^(?:\d+\.\d+|next)$/.test(version))
    throw new Error(`DOCS_VERSION is "${version}": write MAJOR.MINOR or next.`)
  return {
    ...readSiteUrl(env.SITE_URL ?? ''),
    version,
    ref: env.DOCS_REF || 'main',
    product: env.FOOTNOTE_PRODUCT_NAME || DEFAULT_PRODUCT_NAME,
  }
}

/** The docs' path in this build, without a trailing slash: `/footnote/docs/0.1`, or `/docs`. */
export const docsPath = ({ root, version }: Pick<Settings, 'root' | 'version'>) =>
  `${root}/docs${version ? `/${version}` : ''}`
