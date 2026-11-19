# The public site

Footnote's public site, built with [Astro](https://astro.build): the landing page at the root, and the docs under `/docs/`, built with [Starlight](https://starlight.astro.build) from the Markdown in `docs/`, where the pages stay. It is a static site that needs no service: search and fonts are local files, and no page loads anything from another host.

It is its own npm package with its own lockfile, so its packages stay out of the app's tree and out of the images, and a bad upgrade can only break the site. The app's full test suite leaves it alone: the CI job **The site** checks it (`.github/workflows/ci.yml`), and release-please leaves a change that touches only `site/` out of the changelog. The app's own Docs area, at `/docs` in the app, and `npm run docs:build` do not use it.

## Run it

From the repository root, `npm --prefix site ci` once, then:

```sh
npm run site:build   # the whole site in site/dist, then the checks of its pages and links
npm run site:dev     # the docs alone, at http://localhost:4321/docs/
```

In this folder:

```sh
npm run preview      # site/dist as it is published, at http://localhost:4321/
npm run dev:landing  # the landing page alone
npm run typecheck    # and npm run lint, npm test: the site's own code
npm run test:smoke   # the smoke test, on site/dist: run npm run build first
```

The two parts are two Astro builds of this one package: `astro.landing.config.ts` builds the landing page and the 404 page into `dist`, then `astro.config.ts` builds the docs into `dist/docs`. So each version of the docs is a folder that holds its own pages, styles and search, and an old version never depends on a newer build.

## The landing page

`landing/pages/index.astro` is the landing page as it was approved: its words and its look, with its fonts and pictures served from here. Its claims carry footnotes that cite the test or file in the repository that holds them, at the build's reference (`lib/site.ts`). A link to a page of the docs names it without a version, `/docs/get-started/`, so it opens the newest release's page. A docs page or a repository file that does not exist stops the build.

The faint grey is one shade darker than in the approved file, so that small text keeps 4.5:1 on the paper, as [the accessibility bar](../docs/design/accessibility.md) asks.

### The pictures

The pictures of the app are real captures of the demo, in `landing/captures`, light and dark, wide and on a phone. To take them again, serve the web app on its demo data from the repository root (`npx vite build && npx vite preview --port 5517`), then run `npm run capture` here. It writes the WebP files the page reads.

## The docs

The site publishes only pages written for the people who read it. `publishedPages` in `lib/pages.ts` is the list: the 13 help pages and What's new, the MCP and API reference with its pages, the pages for running the service, and the connector pages. Every help page has to be on it. Each page's front matter says its group and order, and the sidebar follows them.

The rest of `docs/` stays in the repository, `docs/contributing` among it, which holds what the published pages leave out: requirement ids, design reasons and source paths. A page that is not on the list is out of the sidebar, the search, `llms.txt`, `llms-full.txt` and the sitemap, and a published page that links to it opens it on GitHub. A group with no published page is left out of the sidebar, the docs' home and `llms.txt`.

### Ready for readers

`lib/reader-ready.ts` reads the Markdown of every published page in `npm run build`, so CI runs it too. A page fails when it holds:

- a requirement id: `FR-`, `NFR-`, `CON-` or `R-` and a number;
- a path to a repository file, such as `src/domain/words.ts`;
- dated history, such as a day of a month, or "since 0.1.0" or "v0.1". What's new is the one page exempt from this rule, because dated change is its job;
- a paragraph over 70 words, or more than four pieces of code in one paragraph.

It reads what a reader sees, so the address of a link does not count, but the words of a link do.

To publish a page, make it pass, then add it to `publishedPages`. Its group shows up on its own. A page that must name a source file does so through a link, whose address does not count. A command runs through an `npm run` script, not a path.

### Links

Pages keep the relative links that work on GitHub, and the build resolves them (`lib/links.ts`):

- a link to another page of the site opens on the site;
- a link to any other file of the repository, a page that is not published among them, opens on GitHub at the build's reference, so a release's pages open the files of that release;
- a link to a screen of the app keeps its words without a link, because the site knows no instance of the app. The `open:` button of a help page is left out for the same reason;
- a link to a file that does not exist stops the build.

After the build, `scripts/check-site.ts` reads the built pages, the landing page among them. It fails on a link or a heading that goes nowhere, on anything loaded from another host, on a `<title>` tag that reached a page's body, on a missing landing or 404 page, and on a page missing from the docs or from `llms.txt`.

### For agents

Each version of the docs has its own `llms.txt` and `llms-full.txt` (`lib/llms.ts`), written by the functions that write the app's (`src/domain/docs.ts`), over every page of the docs. `/docs/llms.txt` is the newest release's.

## The design

The landing page's design is the whole site's, so the docs read as part of it:

- `shared/tokens.css` holds its palette in light and dark: cool paper under a white sheet, blue-black ink, a proofreader's blue for marks and links, and a highlighter yellow for what was checked;
- `shared/fonts.css` holds its two voices: Schibsted Grotesk for Footnote and Source Serif 4 for what an agent says, with JetBrains Mono for code and Outfit for the wordmark;
- `shared/chrome.css`, `shared/Brand.astro`, `shared/ThemeToggle.astro` and `shared/SiteFooter.astro` are its header, logo, theme button and footer, on the landing page and on every page of the docs;
- `src/styles/theme.css` maps the tokens to Starlight's names, and sets the docs' notes as the landing page's margin notes, in the serif beside a blue rule, and a page's footnotes as its blue marks. Code blocks are dark in both themes, as the landing page's commands.

The theme is one for the whole site (`shared/theme.ts`): light until the reader picks dark, and the pick holds from the landing page to the docs.

## Settings

All are read when the site is built:

| Setting                 | What it does                                                                                                                                                                                                                                                                                                      |
| ----------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `SITE_URL`              | Where the landing page is served, such as `https://footnote.example` or `https://fredehagelund92.github.io/footnote`. Every address of the site follows it: the path under the host, canonical addresses, the sitemap and whole addresses in `llms.txt`. Empty: the root of any host, with no canonical addresses |
| `DOCS_VERSION`          | The docs' folder in this build: `MAJOR.MINOR`, or `next`, which search engines are told to skip. Empty: the docs alone at `/docs/`                                                                                                                                                                                |
| `DOCS_REF`              | The Git reference repository links open at, `main` by default                                                                                                                                                                                                                                                     |
| `FOOTNOTE_PRODUCT_NAME` | The product name in the docs' titles. A renamed build shows it in place of the logo                                                                                                                                                                                                                               |

## Versions and publishing

`.github/workflows/site.yml` builds the docs of each minor release into `/docs/MAJOR.MINOR/`, at its tag, and `/docs/next/` from `main`; the landing page at the root follows `main`. `scripts/collect.ts` puts each build in its place on the `gh-pages` branch: `/docs/` opens the newest release, and so does every page named without a version. `/docs/versions.json` lists the folders, and the switcher in the header reads it when a page opens, so an old version's pages know of newer ones without being built again. Publishing is off until a maintainer turns it on: see [Releasing Footnote](../docs/releasing.md#the-site).

So a change to the docs in a pull request shows in `/docs/next/` once it merges, and a release's docs stay as they were at its tag.

## A team without internet access

Either way, nothing in the browser needs a service.

1. **Download once.** Each GitHub Release has `footnote-docs-<version>.tar.gz`, the site with that release's docs, built to be served at the root of a host. Carry it in with the images, unpack it, and serve the folder with any static server.
2. **Build it yourself.** At the release tag, run `npm --prefix site ci`, then `npm run site:build`, and copy `site/dist` to a static server. The build needs no network. The install needs an npm mirror that holds the platform packages of `pagefind` and `sharp`.
