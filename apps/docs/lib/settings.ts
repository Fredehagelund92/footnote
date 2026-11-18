/*
  Where one build of the site is served and what it links to, read from the environment
  (apps/docs/README.md). With nothing set it is served at the root of its own host, as `npm run
  dev` and a team without internet access serve it.
*/

import { DEFAULT_PRODUCT_NAME } from '../../../src/domain/brand.ts'
import { withRenamedSettings } from '../../../src/domain/renamed-settings.ts'

export type Settings = {
  /** The host, `https://fredehagelund92.github.io`. Empty: no canonical addresses and no sitemap. */
  site: string
  /** The path every version sits under, `/footnote`. Empty at the root of a host. */
  root: string
  /** The folder of this build, `v0.1` or `next`. Empty when the build is alone at the root. */
  version: string
  /** The Git reference that links to repository files open at: the release tag, or main. */
  ref: string
  product: string
}

const withoutTrailingSlash = (path: string) => path.replace(/\/+$/, '')

export function readSettings(env: Record<string, string | undefined>): Settings {
  const version = env.DOCS_VERSION ?? ''
  if (version && !/^(?:v\d+\.\d+|next)$/.test(version))
    throw new Error(`DOCS_VERSION is "${version}": write vMAJOR.MINOR or next.`)
  return {
    site: withoutTrailingSlash(env.DOCS_SITE ?? ''),
    root: withoutTrailingSlash(env.DOCS_ROOT ?? ''),
    version,
    ref: env.DOCS_REF || 'main',
    product: withRenamedSettings(env).environment.FOOTNOTE_PRODUCT_NAME || DEFAULT_PRODUCT_NAME,
  }
}

/** The path of this build without a trailing slash: `/footnote/v0.1`, or `` at a host's root. */
export const basePath = ({ root, version }: Pick<Settings, 'root' | 'version'>) =>
  version ? `${root}/${version}` : root
