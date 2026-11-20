/*
  The words on the landing page that change with the first release (site/README.md, "The release
  switch"). The page renders one set, picked by the `released` constant in its frontmatter, so a
  build before the release carries none of the release's words, even hidden. Until then the page
  says what is true of a checkout: `docker compose up` builds Footnote on the reader's computer, as
  the README's Try it does. At the release it says the 0.1.0 words: the first start pulls the
  published images. Before flipping the switch, check that a stranger can pull both images named in
  compose.images.yaml without signing in.
*/

export type ReleaseWords = {
  /** Under the first screen's buttons. */
  heroMeta: string
  /** Markdown in Git's status among the connectors. */
  markdownStatus: string
  /** The install section's opening paragraph. */
  installLede: string
  /** What the first step says, and the commands it gives. */
  startLine: string
  startCommands: readonly string[]
  /** The note on what the version is for. */
  versionNote: string
  /** Beside the buttons at the end of the install section. */
  endMeta: string
}

const clone = 'git clone https://github.com/Fredehagelund92/footnote.git && cd footnote'

const unreleased: ReleaseWords = {
  heroMeta: 'Open source under Apache-2.0. Not released yet: it runs on one computer with Docker.',
  markdownStatus: 'built, not tried on a real account',
  installLede:
    'You need Docker. The first start builds Footnote from the code you cloned and loads the demo company: its people and their notes, a few suggestions waiting for review, and some weeks of questions from agents. It can take ten minutes.',
  startLine: 'Clone the repository and start it. It builds on your computer.',
  startCommands: [clone, 'docker compose up'],
  versionNote:
    "It has not had its first release yet. It's for trying the idea on one computer with the demo, not yet for your company's data, and it will change before 1.0. We don't have a measured number yet for how much better agents answer with Footnote.",
  endMeta: 'Open source under Apache-2.0. Not released yet.',
}

const released: ReleaseWords = {
  heroMeta:
    'Open source under Apache-2.0. The first release is v0.1.0, and it runs on one computer with Docker.',
  markdownStatus: 'not in the 0.1.0 image yet',
  installLede:
    'You need Docker. The first start pulls the 0.1.0 images and loads the demo company: its people and their notes, a few suggestions waiting for review, and some weeks of questions from agents. Give it about two minutes.',
  startLine: 'Clone the repository and start the published images.',
  startCommands: [clone, 'docker compose -f compose.yaml -f compose.images.yaml up'],
  versionNote:
    "It's before 1.0. It's for trying the idea on one computer with the demo, not yet for your company's data, and things will change between releases. We don't have a measured number yet for how much better agents answer with Footnote.",
  endMeta: 'Open source under Apache-2.0. The first release is v0.1.0.',
}

/** The words for a build before the first release, or after it. */
export const releaseWords = (isReleased: boolean): ReleaseWords =>
  isReleased ? released : unreleased
