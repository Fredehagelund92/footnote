import { describe, expect, it } from 'vitest'
import {
  liveSiteUrl,
  releasesOf,
  shouldBuild,
  unseenReleases,
  vercelRef,
  vercelSiteUrl,
} from '../lib/vercel.ts'

describe('the address of a deployment on Vercel', () => {
  it("is the project's production address on production, and the deployment's on a preview", () => {
    const vercel = {
      VERCEL_PROJECT_PRODUCTION_URL: 'footnote.vercel.app',
      VERCEL_URL: 'footnote-abc123.vercel.app',
      VERCEL_BRANCH_URL: 'footnote-git-fix-docs.vercel.app',
    }
    expect(vercelSiteUrl({ ...vercel, VERCEL_ENV: 'production' })).toBe(
      'https://footnote.vercel.app',
    )
    expect(vercelSiteUrl({ ...vercel, VERCEL_ENV: 'preview' })).toBe(
      'https://footnote-git-fix-docs.vercel.app',
    )
    expect(vercelSiteUrl({ VERCEL_ENV: 'preview', VERCEL_URL: 'footnote-abc123.vercel.app' })).toBe(
      'https://footnote-abc123.vercel.app',
    )
  })

  it('is the setting when a maintainer set one, and the root of any host outside Vercel', () => {
    expect(
      vercelSiteUrl({
        SITE_URL: 'https://footnote.example',
        VERCEL_ENV: 'production',
        VERCEL_PROJECT_PRODUCTION_URL: 'footnote.vercel.app',
      }),
    ).toBe('https://footnote.example')
    expect(vercelSiteUrl({})).toBe('')
  })

  it('opens repository links at main on production and at the commit on a preview', () => {
    expect(vercelRef({ VERCEL_ENV: 'production', VERCEL_GIT_COMMIT_SHA: 'abc' })).toBe('main')
    expect(vercelRef({ VERCEL_ENV: 'preview', VERCEL_GIT_COMMIT_SHA: 'abc' })).toBe('abc')
  })
})

describe('the releases a deployment carries', () => {
  it('are the newest patch of each minor, newest first, from release tags only', () => {
    const lsRemote = [
      'a1\trefs/tags/v0.1.0',
      'a2\trefs/tags/v0.1.3',
      'a3\trefs/tags/v0.1.2',
      'a4\trefs/tags/v0.10.0',
      'a5\trefs/tags/v0.9.1',
      'a6\trefs/tags/v1.0.0-rc.1',
      'a7\trefs/tags/v0.1.3^{}',
      'a8\trefs/tags/mockup-archive',
    ].join('\n')
    expect(releasesOf(lsRemote)).toEqual([
      { tag: 'v0.10.0', folder: '0.10' },
      { tag: 'v0.9.1', folder: '0.9' },
      { tag: 'v0.1.3', folder: '0.1' },
    ])
  })

  it('are none before the first release', () => {
    expect(releasesOf('a8\trefs/tags/mockup-archive\n')).toEqual([])
  })
})

describe('what the live site has seen', () => {
  it("is read from production's address, or a preview branch's own", () => {
    expect(
      liveSiteUrl({
        VERCEL_ENV: 'production',
        VERCEL_PROJECT_PRODUCTION_URL: 'footnote.vercel.app',
      }),
    ).toBe('https://footnote.vercel.app')
    expect(
      liveSiteUrl({ VERCEL_ENV: 'preview', VERCEL_BRANCH_URL: 'footnote-git-x.vercel.app' }),
    ).toBe('https://footnote-git-x.vercel.app')
    expect(liveSiteUrl({ VERCEL_ENV: 'preview', VERCEL_URL: 'footnote-abc.vercel.app' })).toBe('')
  })

  it('names the releases it has not looked at', () => {
    const releases = [
      { tag: 'v0.2.0', folder: '0.2' },
      { tag: 'v0.1.3', folder: '0.1' },
    ]
    expect(unseenReleases(releases, ['v0.1.3'])).toEqual([{ tag: 'v0.2.0', folder: '0.2' }])
    expect(unseenReleases(releases, ['v0.2.0', 'v0.1.3'])).toEqual([])
  })
})

describe('whether a deployment builds', () => {
  it('builds a branch the first time, and a redeploy of the same commit', () => {
    expect(shouldBuild({ previous: undefined, current: 'b', changed: undefined, unseen: 0 })).toBe(
      true,
    )
    expect(shouldBuild({ previous: 'b', current: 'b', changed: false, unseen: 0 })).toBe(true)
  })

  it('builds a push that changed what the site reads, or when git cannot tell', () => {
    expect(shouldBuild({ previous: 'a', current: 'b', changed: true, unseen: 0 })).toBe(true)
    expect(shouldBuild({ previous: 'a', current: 'b', changed: undefined, unseen: 0 })).toBe(true)
  })

  it('builds when a release came out that the live site has not looked at, or that cannot be read', () => {
    expect(shouldBuild({ previous: 'a', current: 'b', changed: false, unseen: 1 })).toBe(true)
    expect(shouldBuild({ previous: 'a', current: 'b', changed: false, unseen: undefined })).toBe(
      true,
    )
  })

  it('skips a push that changed nothing the site reads, with every release already there', () => {
    expect(shouldBuild({ previous: 'a', current: 'b', changed: false, unseen: 0 })).toBe(false)
  })
})
