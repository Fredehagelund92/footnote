# The public site

Footnote's public site, built with [Astro](https://astro.build): the landing page at the root, and the docs under `/docs/`, built with [Starlight](https://starlight.astro.build) from the Markdown in `docs/`, where the pages stay. It is a static site that needs no service: search and fonts are local files, and no page loads anything from another host.

It is its own npm package with its own lockfile, so its packages stay out of the app's tree and out of the images, and a bad upgrade can only break the site. The app's full test suite leaves it alone: the CI job **The site** checks it (`.github/workflows/ci.yml`), and release-please leaves a change that touches only `site/` out of the changelog. The app's own Docs area, at `/docs` in the app, and `npm run docs:build` do not use it, but they say the same ([The app's Docs area](#the-apps-docs-area)).

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

`landing/pages/index.astro` is the landing page as it was approved, "Ask this page": dark until the reader picks light, set in Inter, on Footnote's dot field, with the vision told one sentence a section. The first screen is a window in which an agent answers a question about the demo company with Footnote: four questions from the demo, each with the answer line `get_context` gives it on a fresh install and the note it read, written by a named person and checked by its owner (`landing/demo.ts`, drawn by `landing/components/AskWindow.astro`). Once, the Norway question types itself and sends itself: the agent's own guess is struck, the checked answer arrives, and a dotted leader runs from its number to its note. A press on another question, or a typed one, plays its answer; plain rules match a typed question, and anything else is told that nothing is written (`landing/hero.ts`). Below it: what Footnote exists for, a tour of five real screens of the app, meaning and not numbers, the demo's metrics beside the notes about them (`landing/definitions.ts`), the six answer lines, what agents read, and how to run the demo. `landing/page.ts` runs those parts, and `landing/styles/landing.css` holds their look ([the design](#the-design)).

`test/landing.test.ts` holds the page to its sources word for word: the demo's notes, names and metrics to `db/seed` and `docs/design/demo-world.md`, and the answer lines to the app's. The demo's Cube model declares no metric built from another, so the definitions window shows the columns it declares, and no tree.

A link to a page of the docs names it without a version, `/docs/try-the-demo/`, so it opens the newest release's page (`lib/site.ts`). A docs page that does not exist stops the build.

`e2e/landing.spec.ts` checks the page on the built site: the four questions by mouse, keyboard and typing, the finished state with reduced motion (no canvas, nothing moving, everything there), axe at WCAG 2.2 AA with each answer, with motion the dotted leaders starting at their numbers once the steps have settled, the definitions window and the tour, the release words, and screenshot baselines. Each platform keeps its own baselines, and one with none skips them: `npm run test:smoke -- e2e/landing.spec.ts --update-snapshots` writes them.

### The release switch

Until the first release the install section says what is true of a checkout: `docker compose up` builds Footnote on the reader's computer and can take ten minutes, and the page says it is not released yet. `released` in `landing/release.ts` is the switch: the file holds both sets of words, and the page renders one, so a build before the release carries none of the release's words. The footer's Releases link follows it too, so until the first release no page sends a reader to a release that is not there. At the release it says the 0.1.0 words: the first start pulls the published images. Flip it only once a stranger can pull both images named in `compose.images.yaml` without signing in.

### The pictures

The pictures of the app are real captures of the demo: the landing page's tour shows two of its own, in `landing/captures`, and three of the docs', in light and dark. The repository's README has one more, `docs/images/answer.png`: an Ask answer with the panel that says where it comes from, in light. The docs have their own, in `docs/images/docs`: each screen a page is about, cropped to that part, in light and dark ([the docs' pictures](../docs/help/README.md#pictures)). To take them all again, serve the web app on its demo data from the repository root (`npx vite build && npx vite preview --port 5517`), then run `npm run capture` here. It writes the WebP files the landing page and the docs read, and the README's PNG. `npm run capture -- landing`, `-- readme` or `-- docs` takes only one set. The demo is the invented company's, and the docs set stops on a screen that says the build is a design preview, so no picture shows it.

## The docs

The site publishes only pages written for the people who read it. `publishedPages` in `lib/pages.ts` is the list: the 18 help pages and What's new, the Reference pages, the pages for running the service, and the connector pages. Every help page has to be on it. Each page's front matter says its group and order, and the sidebar follows them.

The rest of `docs/` stays in the repository, `docs/contributing` among it, which holds what the published pages leave out: requirement ids, design reasons and source paths. A page that is not on the list is out of the sidebar, the search, `llms.txt`, `llms-full.txt` and the sitemap, and a published page that links to it opens it on GitHub. A group with no published page is left out of the sidebar, the docs' home and `llms.txt`.

### Ready for readers

`lib/reader-ready.ts` reads the Markdown of every published page in `npm run build`, so CI runs it too. A page fails when it holds:

- a requirement id: `FR-`, `NFR-`, `CON-` or `R-` and a number;
- a path to a repository file, such as `src/domain/words.ts`;
- dated history, such as a day of a month, or "since 0.1.0" or "v0.1". What's new is the one page exempt from this rule, because dated change is its job;
- a paragraph over 70 words, or more than four pieces of code in one paragraph.

It reads what a reader sees, so the address of a link does not count, but the words of a link do.

To publish a page, make it pass, then add it to `publishedPages`. Its group shows up on its own. A page that must name a source file does so through a link, whose address does not count. A command runs through an `npm run` script, not a path.

### Pictures and tabs

A picture is written as Markdown, named by its light file in `docs/images/docs`, and `lib/remark-footnote-docs.ts` draws it as a figure with its dark file beside it: the reader's theme shows one. A screen is drawn no wider than it was on screen, as it was taken at twice the pixels.

A page outside `docs/help` can hold tabs, for real alternatives such as each agent's own steps: its `###` sections between `<!-- tabs -->` and `<!-- /tabs -->` become one tab each, named by its heading (`src/components/Tabs.astro`). The arrow keys, Home and End move between them. Without the script every section shows under its name, as it does on GitHub. The help pages hold no tabs, because the app's Docs area draws them too.

### Links

Pages keep the relative links that work on GitHub, and the build resolves them (`lib/links.ts`):

- a link to another page of the site opens on the site;
- a link to any other file of the repository, a page that is not published among them, opens on GitHub at the build's reference, so a release's pages open the files of that release;
- a link to a screen of the app keeps its words without a link, because the site knows no instance of the app. The `open:` button of a help page is left out for the same reason;
- a link to a file that does not exist stops the build.

After the build, `scripts/check-site.ts` reads the built pages, the landing page among them. It fails on a link or a heading that goes nowhere, on anything loaded from another host, on a `<title>` tag that reached a page's body, on a missing landing or 404 page, on a page missing from the docs or from `llms.txt`, and on a page that is an island: its own words, not the sidebar or the footer, link to no other page of the docs, or no other page's words link to it.

A page that moved keeps its old address: `movedPages` in `lib/pages.ts` forwards it to where the page is now, and `movedSections` sends a link to one of a split page's headings to where that heading went (`src/pages/[...moved].astro`). Get started's address opens Try the demo, the first page a newcomer reads.

### For agents

Each version of the docs has its own `llms.txt` and `llms-full.txt` (`lib/llms.ts`), written by the functions that write the app's (`src/domain/docs.ts`), over every page of the docs. `/docs/llms.txt` is the newest release's.

Beside each page's title, **Copy as Markdown** copies the page as `llms-full.txt` gives it, for a reader who hands it to an agent. The Markdown is in the page, so copying asks no host for anything. Under each page, Edit page opens its Markdown on GitHub, on `main`, whichever version is read.

### The app's Docs area

The app carries the help pages and What's new in its own Docs area, drawn by its own components (`src/web/pages/docs.tsx`), so a team reads them without leaving the app or the network. It is built from the same Markdown in `docs/help` and the same pictures in `docs/images/docs` when the app is built, never from a copy, so each build of the app shows the pages of its own commit. Each of its pages opens with the release it describes, `Version 0.1`, as the version switcher here names its folders, and **Read the latest on the web**, the same page at `DOCS_URL` (`src/domain/brand.ts`), which opens the newest release.

`scripts/check-app-docs.ts` holds the two to the same words. It reads the app's docs as `npm run docs:build` writes them to `dist/docs`, with the app's components, and this site as `npm run build` writes it at the root of a host, and fails when:

- a page is in one and not the other: the app's are those its `llms.txt` lists, the site's those from `docs/help`;
- a page's title, its headings and their ids, its words, its pictures (their words and files) or its links to other pages differ;
- a picture's file is missing from either build, or a link of the app's goes to a page or a heading it does not have. `scripts/check-site.ts` checks the site's own links.

The app's own lists ([includes](../docs/help/README.md#includes-the-apps-own-lists)) are left out of the words, since the app draws each from its source and the site draws its Markdown, which the docs check holds to that source. Both mark them with `data-include`, and the app marks a page's lead and body with `data-docs`. CI runs the check in **The site**, after both builds. To run it yourself, from the repository root:

```sh
npm run docs:build && npm run site:build && npm --prefix site run check:app-docs
```

### Due for a check

Every published page says in its front matter the day someone last checked it against the app, `reviewed`. `lib/reviewed.ts` names each page checked more than 90 days ago as a warning, on the run's summary in CI, when the site is built. Such a page fails the build only when it names what the app no longer has, as far as a cheap read can tell: a setting, `FOOTNOTE_` and a name, that no code reads any more, or a link to a screen the app's router does not have. Tools are not read, as the pages also name Ask's own steps, which look like tools. A help page that links to a screen that is gone fails the docs check at any age.

To clear a warning, read the page against the app, mend what moved, and set `reviewed` to that day.

## The design

The whole site is in one design, the landing page's as it was approved: the landing page, every page of the docs and the 404 page.

- `shared/tokens.css` holds its palette, in light and dark: one near-black ramp in dark and its paper twin in light, hairlines, and the app's blue as the one accent. It has no highlighter yellow;
- `shared/fonts.css` holds its fonts: Inter for everything the site says, with its optical sizes, and JetBrains Mono for code;
- `shared/chrome.css` is the header, the buttons and the footer on every page, and `shared/Brand.astro`, `shared/ThemeToggle.astro` and `shared/SiteFooter.astro` are the logo, the theme button and the footer they draw. The landing page and the 404 page share one header (`landing/components/Header.astro`) and one reset (`landing/styles/base.css`); the docs draw Starlight's header in the same look, with the logo, a hairline and Docs, the search box, GitHub, the theme and Run the demo;
- `landing/styles/landing.css` holds the landing page's own parts, and `landing/styles/not-found.css` the 404 page's: the landing page's closing screen, for an address that leads nowhere;
- `src/styles/theme.css` maps the tokens to Starlight's names and sets a page of the docs as the landing page sets its words: its headings and the dimmer line under a title, links on a hairline, a table as rows parted by hairlines, a note as a card a step lighter than the ground, and a page's footnotes as the accent's numbers. A code block is the landing page's terminal, a card on a hairline in the reader's theme (`astro.config.ts`), and a command shows no window around it. A table stands in a box that scrolls sideways when the table is wider than the page (`lib/remark-footnote-docs.ts`). The docs' diagrams are drawn in the same colours (`docs/images/docs`).

The theme is one for the whole site (`shared/theme.ts`), and the pick holds from the landing page to the docs and back. Without a pick every page opens dark, as the design was approved. `e2e/smoke.spec.ts` checks that the three kinds of page share the ground, the font, the logo and the button.

The ground is the dot field, 28 px apart. The landing page draws it on its first and last screens, in its stylesheet, and its first screen answers the pointer: `field` in `shared/ground.ts` draws a leader from the pointer to the window, a wave that runs out from the note when it lands or changes, and marks that land now and then and point at the window. The 404 page has the field across its window (`shared/ground.css`), and now and then a footnote mark lands on a dot beside the page's words, the dots around it light up in a ring, and a dotted leader runs toward the words (`ground` in the same file). Either draws only while something moves, rests while the tab is hidden, and is never made with reduced motion, so the still dots stay. The docs have no ground, so a page of the docs is calm to read: `e2e/docs-home.spec.ts` checks that and keeps screenshot baselines of the docs' home, as the landing page's spec does.

The header stays at the top of every page, blurred over the page, on a hairline.

## Settings

All are read when the site is built:

| Setting                 | What it does                                                                                                                                                                                                                                                                                                                                                        |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `SITE_URL`              | Where the landing page is served, such as `https://footnote.example`. Every address of the site follows it: the path under the host, canonical addresses, the sitemap and whole addresses in `llms.txt`. Empty: the root of any host, with no canonical addresses. On Vercel it is the project's production address, or a preview's own, unless the project sets it |
| `DOCS_VERSION`          | The docs' folder in this build: `MAJOR.MINOR`, or `next`, which search engines are told to skip. Empty: the docs alone at `/docs/`                                                                                                                                                                                                                                  |
| `DOCS_REF`              | The Git reference repository links open at, `main` by default                                                                                                                                                                                                                                                                                                       |
| `DOCS_RELEASES`         | The folders of the releases whose docs the site carries beside this build, such as `0.1,0.2`. The docs of `next` say on every page that they follow main, ahead of any release, only once there is one. Empty: no banner                                                                                                                                            |
| `FOOTNOTE_PRODUCT_NAME` | The product name in the docs' titles. A renamed build shows it in place of the logo                                                                                                                                                                                                                                                                                 |

## Publishing on Vercel

The site is served by Vercel, from this repository, at the project's `vercel.app` address. `vercel.json` here sets it up for a project whose root directory is `site`: the Astro preset, `npm ci`, the build `scripts/vercel-build.ts` into `dist`, and the ignored build step `scripts/vercel-ignore.ts`. Vercel builds production from `main` and a preview for each pull request. How a maintainer connects the project is in [Releasing Footnote](../docs/releasing.md#the-site).

Every deployment builds the whole site:

1. this commit: the landing page, and its docs as `/docs/next/`, which search engines are told to skip. Its pages say they follow main only once a release has docs of its own (`DOCS_RELEASES`);
2. the docs of each release, the newest patch of each minor, as `/docs/MAJOR.MINOR/`. Each is built again from its own tag, with that tag's pages, code and lockfile, so a release's docs stay as they were at its tag, while every folder takes the deployment's address. A tag from before the site has no `site/` folder and adds nothing;
3. `scripts/collect.ts` puts them together: `/docs/` opens the newest release, and so does every page named without a version. `/docs/versions.json` lists the folders for the switcher in the header, and `/docs/releases.json` the release tags the build looked at.

So a change to the docs in a pull request shows in that preview's `/docs/next/`, and in production's once it merges, and a release's docs show from its tag on. The ignored build step skips a push that changed nothing the site reads (`site/`, `docs/`, the app's icons, and the product name and docs code it shares with the app). It still builds a redeploy, and a push made after a release that the live site has not looked at yet (`lib/vercel.ts`).

To build as Vercel does, run `node scripts/vercel-build.ts` here. It needs the network, for the release tags and their packages.

## A team without internet access

Either way, nothing in the browser needs a service.

1. **Download once.** Each GitHub Release has `footnote-docs-<version>.tar.gz`, the site with that release's docs, built to be served at the root of a host. Carry it in with the images, unpack it, and serve the folder with any static server.
2. **Build it yourself.** At the release tag, run `npm --prefix site ci`, then `npm run site:build`, and copy `site/dist` to a static server. The build needs no network. The install needs an npm mirror that holds the platform packages of `pagefind` and `sharp`.
