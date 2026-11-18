# Product name: inventory and rename checklist

The product was called Heed and is now called Footnote. This page says where the name appears,
which of those places follow one setting, and what the rename still has to change by hand. It was
made on 16 October 2026 from every occurrence of "Heed" in `src`, `docs`, `README.md` and the
design notes. On 3 November 2026 the identifiers in the plan below were checked against the code,
and those the code no longer has were taken out; the counts are still those of 16 October.

## The rename to Footnote

On 18 November 2026 the captain chose the name Footnote and asked for a full rename. It is done in
two parts:

- **Part A, what a person reads or sees (done).** The setting's default is `Footnote`, so every
  sentence that names the product says it. The logo, the favicons and the other brand files show
  the new name, set in type as a placeholder until the final mark is drawn
  ([logo](design/logo.md)). The prose of the README, the developer documentation, the design
  notes, the issue templates and the comments says Footnote.
  Steps 1 to 4 of the plan below are done, except what they list as left.
- **Part B, the technical names (done).** Steps 5 to 12, and what steps 1 to 3 left: the
  environment variables, the key files and folders, cookies and browser keys, headers, metric,
  log and job names, the database's name and lock keys, the MCP server id, the `footnote` command,
  the package, the compose project and the in-repository links and image names.
  Where an install of 0.1.0 would lose data or access, the old name still works for one release,
  or the service moves it once ([Upgrade from Heed 0.1](operations.md#upgrade-from-heed-01)).

What is left is outside the code. The GitHub repository is still `heed`: the code already links to
`Fredehagelund92/footnote` and names the images `ghcr.io/fredehagelund92/footnote` and
`footnote-web`, which work once a maintainer renames the repository (GitHub then forwards the old
links) and a release publishes the images under the new name. Until then the links to the
repository forward nowhere, and `compose.images.yaml` finds no image. The docs site moves with the
repository to `fredehagelund92.github.io/footnote`. GitHub's social preview and the owner's avatar
change when a maintainer uploads them.

Two names wait for the repository rename, since they only exist after it: the clone address in
`tests/image/git-markdown.sh` and `DOCS_ROOT` in `.github/workflows/docs-site.yml` (`/heed`, where
GitHub Pages serves the site) move to `footnote` with it. After the rename, rebuild the already
published `/v0.1/` folder, which was built under `/heed/v0.1`.

Rename the repository before the next release. A release made before it would publish the images
under `heed` while `compose.images.yaml` names `footnote`, so the release's demo job
(`demo-images.yml`) would fail.

## The setting

One setting holds the name people and agents read: `FOOTNOTE_PRODUCT_NAME`, default `Footnote`
(`src/domain/brand.ts`).

- The service reads it once at start (`src/server/brand.ts`), so the MCP tools' descriptions and
  the server instructions stay byte-stable between requests. A
  value that is not a usable name stops the start (`src/server/config/env.ts`).
- The web build reads the same variable (`envPrefix` in `vite.config.ts`, `src/web/lib/brand.ts`),
  and so does the page title in `src/web/index.html`. Set it for both.
- The documentation in `docs/help` names no product ([copy](design/copy.md)), and the docs site
  (`apps/docs`) reads the same setting and default.

The checks:

- `tests/server/brand.test.ts` checks the setting: the default, a name that stops the start, and
  the token. It also sets another name and checks that the MCP instructions and tools say it, and
  never the old name.
- The lint rule `brand/no-product-name` (`eslint.product-name.js`, proved in
  `tests/lint/product-name.test.ts`) reports a string, template text or JSX text in the app, the
  domain, the contract, the service or the CLI that names the product by hand. It reports the
  former name, Heed, too, so the old name cannot come back in a sentence. The technical names
  below that still carry it carry an `eslint-disable-next-line` comment with their reason.

## How each occurrence was classified

| Class                         | Rule                                                                                                                      | What to do                                                                                                                                                                                   |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| (a) Labels that need no name  | A navigation or action label, or a sentence where the name is filler: the reader already knows which product they are in. | Rewrite without it: "Back to Heed" is "Back", "Add Heed to your agent" is "Add to your agent", "Last week in Heed" is "Last week", "Heed reads" is "Reads", "Ask Heed first" is "Ask first". |
| (b) Sentences that name it    | The sentence reads wrongly without the name: "Sign in to Heed", "What is Heed", an agent told what the server holds.      | The name comes from the setting: `productName` in the app and the service.                                                                                                                   |
| (c) Technical identifiers     | A name a machine, a file or a stored record depends on.                                                                   | Leave as they are. Listed below as the plan for a real rename.                                                                                                                               |
| (d) Historical or quoted text | Records of what was said or decided.                                                                                      | Unchanged.                                                                                                                                                                                   |

Counts when this was made: 586 lines in 155 files in `src/web` (177 of them strings a person can
read; the rest code names and comments), 252 lines in `src/server` (144 strings), 34 strings in
`src/domain`, `src/contract` and `src/cli`, and 161 in the 11 help pages.

Comments and code names are not text anyone reads in the product. The rename to Footnote renamed
them anyway (step 2), so the code says the name the product has.

## (c) Technical identifiers: the plan for a real rename

The plan was one pull request per step, in this order. The rename to Footnote did steps 5 to 12 in
one, part B, with the old names still working where each step's risk asked for it. The risk is what
breaks if the step is done alone or done wrong, and how the rename met it.

| Order | Item                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | Where                                                                                                                                                                               | Risk                                                                                                                                                                                          |
| ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1     | **Placeholder** (18 Nov 2026). Brand assets: the lockup and symbol (`src/web/public/footnote-*.svg`, the favicons, `src/web/components/footnote/logo.tsx`, which shows the SVG files by reference, `docs/design/logo.md`). They show the name in Newsreader italic and its F while the owner has the final mark drawn; it replaces the same files. GitHub's social preview and the owner's avatar change only when a maintainer uploads them.                                                                                                                                                                                                                                              | `src/web/public`, `src/web/components/footnote/logo.tsx`                                                                                                                            | Low. Design work, not code: the wordmark is drawn, not typed, so the setting cannot change it.                                                                                                |
| 2     | **Done** (18 Nov 2026). Code names: `FootnoteApi`, `FootnoteClient`, `whatFootnoteReads`, the lint rule `footnote/plain-words`, the folder `src/web/components/footnote`, `apps/docs/lib/remark-footnote-docs.ts`, the docs site's class names (`footnote-title`, `footnote-note`) and its element `footnote-version`.                                                                                                                                                                                                                                                                                                                                                                     | `src/web`, `src/cli`, `scripts`, `apps/docs`                                                                                                                                        | Low. A rename refactor the type check proves.                                                                                                                                                 |
| 3     | **Done** (18 Nov 2026). Events and test names: the `footnote:open` window event, and temporary folder prefixes such as `footnote-sync-` in tests. The held-out seal's files changed with them: no cases are sealed yet, so the guard (`scripts/check-held-out-seal.ts`) lets them change beside `src/`.                                                                                                                                                                                                                                                                                                                                                                                    | `src/web`, `tests/e2e`, `tests/web`                                                                                                                                                 | Low. Change the event and every listener together; test folder names are cosmetic.                                                                                                            |
| 4     | **Done**. Docs slugs: none. The help pages with `what-is-heed` and `tell-heed-about-your-business` left with `docs/old-help` (30 Oct 2026); the pages in `docs/help` name no product.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      | None                                                                                                                                                                                | None.                                                                                                                                                                                         |
| 5     | **Done** (18 Nov 2026). Environment variables: every `HEED_` setting is `FOOTNOTE_`, the shipped `HEED_DEFAULT_*` values are `FOOTNOTE_DEFAULT_*`, the compose file's ports are `FOOTNOTE_PORT` and `FOOTNOTE_WEB_PORT`, the web image's `FOOTNOTE_API_URL`, and the held-out key's `FOOTNOTE_HELDOUT_KEY` and `FOOTNOTE_HELDOUT_KEY_FILE`. Each old name is read for one release when its new one is unset, with one warning (`src/domain/renamed-settings.ts`); the `CL_` names before them are no longer read, as 0.1 promised.                                                                                                                                                         | `src/domain/renamed-settings.ts`, `src/server/config`, `src/cli`, `scripts`, `vite.config.ts`, `.env.example`, `compose.yaml`, `docker/16-api-url.envsh`, `db/seed/held-out.ts`, CI | Medium. Drop the old names in the release after next. `tests/lint/renamed-settings.test.ts` keeps them out of everything else.                                                                |
| 6     | **Done** (18 Nov 2026). Local files and folders: `~/.footnote/held-out.key`, the container's `/var/lib/footnote`, `.footnote-dev-key.pem`, `.footnote-mcp-state.key`, `.footnote-oauth-key.pem` and the public `footnote-*.svg` files (the old copy `heed-mark.svg` is gone). A key file under its old default name is moved to the new one the first time the service needs it (`src/server/config/former-key-files.ts`).                                                                                                                                                                                                                                                                 | `src/server/config`, `src/web/public`, `Dockerfile`, `.gitignore`                                                                                                                   | High for keys, handled by the move. Someone who mounts the keys volume by hand at `/var/lib/heed` moves the mount; production then refuses to start until they do, rather than make new keys. |
| 7     | **Done** (18 Nov 2026). Cookies and storage keys: `footnote_session`, `footnote_oauth_browser`, `footnote_oidc_browser`, the Ask chats `footnote.ask.chats.<person>` and the browser's other keys. The service reads a cookie under its old name for one release when the new one is absent (`src/server/modules/auth/cookie-token.ts`), and signing in or out clears the old session cookie. The browser moves every `heed-` and `heed.` key to its new name on the first visit (`src/web/theme-bootstrap.js`).                                                                                                                                                                           | `src/server/modules/auth`, `src/server/modules/oauth`, `src/web`                                                                                                                    | High, handled: nobody is signed out and no chat is lost. Drop the old cookie names in the release after next.                                                                                 |
| 8     | **Done** (18 Nov 2026). HTTP headers: `x-footnote-csrf`, `x-footnote-api`, `X-Footnote-Tool-Digest`. The service still takes `X-Heed-CSRF` from a web app or command line of before, for one release.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      | `src/server/http`, `src/server/mcp`, `src/server/modules/auth/security.ts`, `src/web/api/http.ts`, `src/cli/client.ts`                                                              | Drop `X-Heed-CSRF` in the release after next. The other two are answers the clients only show.                                                                                                |
| 9     | **Done** (18 Nov 2026). Metrics and logs: the `footnote_*` metric names, the logger's name `footnote`, the database application names (`footnote`, `footnote-jobs`, `footnote-relay`, `footnote-serve`), the eval runner's client `footnote-eval-runner`, the read user agent `Footnote/1.0`.                                                                                                                                                                                                                                                                                                                                                                                              | `src/server/observability`, `src/server/http/metrics.ts`, `src/server/modules/*`                                                                                                    | Medium. No dashboard lives in the repository; an operator's dashboards and alerts read the new names, and each series starts again at the upgrade.                                            |
| 10    | **Done** (18 Nov 2026). Database and stored records: the compose database is `footnote`, and the start renames a `heed` database once when `footnote` is missing (`src/server/db/roles.ts`). The lock keys are `footnote.*`: migration 0058 defines the four functions that took `heed.roles` and `heed.dev_people` again with the new keys, and the migration runner takes `heed.migrations` too for one release. Exports say `footnote.edition/1`; older ones still verify and import. The app family `heed` is `footnote`, rows included (0058). The roles keep their older name, `context_layer_*`, which never said the product: renaming them would mean editing applied migrations. | `db/migrations/0058_footnote_names.sql`, `src/server/db`, `src/domain/edition-export.ts`, `src/domain/app-family.ts`, `compose.yaml`                                                | Highest, handled by the migration and the rename at start.                                                                                                                                    |
| 11    | **Done** (18 Nov 2026). The MCP server id `footnote`, the field `footnote_adds` in the tools' results, the `service` the health check names, and the `footnote` CLI command (`npm run footnote`). The protected resource name follows the setting.                                                                                                                                                                                                                                                                                                                                                                                                                                         | `src/server/mcp/gateway.ts`, `src/cli`, `package.json`, connection guides                                                                                                           | Low in practice: an agent keeps its own name for the server, so one added as `heed` keeps working, with tools named after it until it is added again as `footnote`.                           |
| 12    | **Done in the code** (18 Nov 2026). Repository, package and host names: the npm packages `footnote` and `footnote-docs`, the compose project and service `footnote` (volumes `footnote_db`, `footnote_keys`), the image names in `compose.images.yaml`, every link to the repository, the docs site's path and archive `footnote-docs-<version>.tar.gz`, and test hosts such as `footnote.example.test`. Left: renaming the GitHub repository and publishing images under the new name (see above).                                                                                                                                                                                        | `package.json`, `compose*.yaml`, workflows, tests, `src/domain/brand.ts`                                                                                                            | Medium for compose installs: their data stays in the `heed_*` volumes until moved ([Upgrade from Heed 0.1](self-hosting.md#upgrade-from-heed-01)).                                            |

Developer documentation (`README.md`, `docs/ai-sign-in.md`, `docs/contributing`,
`docs/connectors*`, `docs/requirements.md`, `docs/domain/core.md`, `docs/templates`) talks about
the product by name and names the identifiers above. It says Footnote, and the identifiers' new
names, since 18 November 2026.

## (d) Historical and quoted text

Left as written, since it records what happened:

- the captain's quotes and decisions in comments and design notes;
- the decisions recorded in `docs/design/design-contract.md`;
- applied database migrations in `db/migrations`;
- the API description generated into `docs/api/openapi.json` (generated: it follows the code);
- `CHANGELOG.md`, which release-please writes from the commits;
- the rules Draft 1 of the design contract had, in its section 11;
- the recorded model steps and judge verdicts of the Ask harness (`tests/web/integration`,
  `tests/web/ask-eval/judge-verdicts.json`), which say what a model wrote at the time, and the
  answer judge's prompt and labelled set (`tests/web/ask-eval/judge.ts`, `judge-set.ts`), whose
  digest the recorded verdicts carry: they change with the next recording.

## When the name changes

1. Change `DEFAULT_PRODUCT_NAME` (`src/domain/brand.ts`), or set `FOOTNOTE_PRODUCT_NAME` where the
   service runs and where the web app and the docs site (`apps/docs`) are built, and rebuild.
2. Run `npm test`: the brand tests confirm the MCP text says the new name and never the old one. Screens and agent text that still write the name by hand
   (class (b) strings not yet moved to `productName`) need a search for the old name.
3. Replace the brand assets (step 1 above), then work down the table as far as the rename goes.
