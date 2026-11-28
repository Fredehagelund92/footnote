/*
  The words on the landing page that change with the first release (site/README.md, "The release
  switch"). The page renders one set, picked by the `released` constant below, so a
  build before the release carries none of the release's words, even hidden. Until then the page
  says what is true of a checkout: `docker compose up` builds Footnote on the reader's computer, as
  the README's Try it does. At the release it says the 0.1.0 words: the first start pulls the
  published images. Before flipping the switch, check that a stranger can pull both images named in
  compose.images.yaml without signing in.
*/

/**
 * The release switch: false until the first release's images can be pulled. It is the one line to
 * change at the release. The landing page's words follow it, and so does the footer's Releases
 * link, which shows only once there is a release to open.
 */
export const released = false

export type ReleaseWords = {
  /** Beside the first screen's buttons. */
  status: string
  /** Markdown in Git's status among the sources Footnote reads. */
  markdownStatus: string
  /** The opening of the section on running the demo. */
  installLede: string
  /** What the first step says, and the commands it gives. */
  startLine: string
  startCommands: readonly string[]
  /** The note on what the version is for. */
  versionNote: string
  /** The close's first line, over "Try the demo on your computer". */
  closeTitle: string
}

const clone = 'git clone https://github.com/Fredehagelund92/footnote.git && cd footnote'

const unreleased: ReleaseWords = {
  status: 'Not released yet',
  markdownStatus: 'built, not tried on a real account',
  installLede:
    'You need Docker. The first start builds Footnote from the code you cloned and loads the demo company, which can take ten minutes.',
  startLine: 'Clone the repository and start it. It builds on your computer.',
  startCommands: [clone, 'docker compose up'],
  versionNote:
    "It has not had its first release yet. It's for trying the idea on one computer, not yet for your company's data.",
  closeTitle: 'Not released yet',
}

const atRelease: ReleaseWords = {
  status: 'The first release is v0.1.0',
  markdownStatus: 'not in the 0.1.0 image yet',
  installLede:
    'You need Docker. The first start pulls the 0.1.0 images and loads the demo company. Give it about two minutes.',
  startLine: 'Clone the repository and start the published images.',
  startCommands: [clone, 'docker compose -f compose.yaml -f compose.images.yaml up'],
  versionNote:
    "It's before 1.0. It's for trying the idea on one computer, not yet for your company's data, and things will change between releases.",
  closeTitle: 'The first release is v0.1.0',
}

/** The words for a build before the first release, or after it. */
export const releaseWords = (isReleased: boolean): ReleaseWords =>
  isReleased ? atRelease : unreleased
