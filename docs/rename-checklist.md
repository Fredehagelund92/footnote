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
- **Part B, the technical names (to do).** Steps 5 to 12, and what steps 1 to 3 leave. Until then
  the old name stays in the environment variables, cookies, headers, metric and job names, the
  database, the MCP server id, the `heed` command, the package and the repository.

Two things show the gap between the parts. The app writes the slug of the product's name
(`SLUG` in `src/web/lib/brand.ts`) as the name of the MCP server in an agent's config and as the
command line's name, so it now says `footnote` where the command is still `npm run heed` and the
README still adds the server as `heed`; step 11 makes them agree. And the release notes, the
GitHub release titles and the README say Footnote, while the images on ghcr and the repository
keep `heed` (step 12).

## The setting

One setting holds the name people and agents read: `HEED_PRODUCT_NAME`, default `Footnote`
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

Do these in the order below, one pull request each. The risk is what breaks if the step is done
alone or done wrong.

| Order | Item                                                                                                                                                                                                                                                                                                                                                                                                                                        | Where                                                                                                        | Risk                                                                                                                                                                                                |
| ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1     | **Placeholder** (18 Nov 2026). Brand assets: the lockup, symbol and mark (`src/web/public/heed-*.svg`, the favicons, `src/web/components/heed/logo.tsx`, which shows the SVG files by reference, `docs/design/logo.md`). They show the name in Newsreader italic and its F while the owner has the final mark drawn; it replaces the same files. GitHub's social preview and the owner's avatar change only when a maintainer uploads them. | `src/web/public`, `src/web/components/heed/logo.tsx`                                                         | Low. Design work, not code: the wordmark is drawn, not typed, so the setting cannot change it. Keep the file names until step 6.                                                                    |
| 2     | **Done** (18 Nov 2026). Code names: `FootnoteApi`, `FootnoteClient`, `whatFootnoteReads`, the lint rule `footnote/plain-words`. Left: the folder `src/web/components/heed`, the file `apps/docs/lib/remark-heed-docs.ts`, the docs site's class names (`heed-title`, `heed-note`) and its element `heed-version`.                                                                                                                           | `src/web`, `src/cli`, `scripts`                                                                              | Low. A rename refactor the type check proves.                                                                                                                                                       |
| 3     | **Done** (18 Nov 2026). Events and test names: the `footnote:open` window event, and temporary folder prefixes such as `footnote-sync-` in tests. The held-out seal's files changed with them: no cases are sealed yet, so the guard (`scripts/check-held-out-seal.ts`) lets them change beside `src/`.                                                                                                                                     | `src/web`, `tests/e2e`, `tests/web`                                                                          | Low. Change the event and every listener together; test folder names are cosmetic.                                                                                                                  |
| 4     | **Done**. Docs slugs: none. The help pages with `what-is-heed` and `tell-heed-about-your-business` left with `docs/old-help` (30 Oct 2026); the pages in `docs/help` name no product.                                                                                                                                                                                                                                                       | None                                                                                                         | None.                                                                                                                                                                                               |
| 5     | Environment variables: the `HEED_` settings in `.env.example`, the `HEED_DEFAULT_*` values the compose file sets, `HEED_HELDOUT_KEY`, `HEED_HELDOUT_KEY_FILE`, and the compose file's `HEED_PORT` and `HEED_WEB_PORT`.                                                                                                                                                                                                                      | `src/server/config`, `src/cli`, `scripts`, `vite.config.ts`, `.env.example`, `compose.yaml`, CI              | Medium. Read the old name as a fallback for one release, and say so in the release note, or every local `.env` breaks silently.                                                                     |
| 6     | Local files and folders: `~/.heed/held-out.key`, the container's `/var/lib/heed`, `.heed-dev-key.pem`, `.heed-mcp-state.key`, `.heed-oauth-key.pem` and the public `heed-*.svg` files.                                                                                                                                                                                                                                                      | `src/server/config/env.ts`, `src/web/public`, `Dockerfile`, `.gitignore`                                     | High for keys: a new default path means a new signing or state key, which signs everyone out and voids sealed questions. Move the file or keep the old default.                                     |
| 7     | Cookies and storage keys: `heed_session`, `heed_oauth_browser`, `heed_oidc_browser`, and the Ask chats `heed.ask.chats.<person>` in the browser. The browser's other keys follow the setting (`storageKey` in `src/web/lib/brand.ts`).                                                                                                                                                                                                      | `src/server/modules/auth`, `src/server/modules/oauth`, `src/web`                                             | High. A new cookie name signs everyone out; a new storage key loses unsaved drafts. Read both names for a release, then drop the old.                                                               |
| 8     | HTTP headers: `x-heed-csrf`, `x-heed-api`, `X-Heed-Tool-Digest`.                                                                                                                                                                                                                                                                                                                                                                            | `src/server/http`, `src/server/mcp`, `src/web/api/http.ts`, `src/cli/client.ts`                              | High. The web app, the CLI and the service must agree: accept both names on the service first, then switch the clients, then drop the old.                                                          |
| 9     | Metrics and logs: the `heed_*` metric names, the logger's name `heed`, job and queue names (`heed-jobs`, `heed-relay`, `heed-serve`, `heed-eval-runner`), the read user agent `Heed/1.0`.                                                                                                                                                                                                                                                   | `src/server/observability`, `src/server/http/metrics.ts`, `src/server/modules/*`                             | Medium. Dashboards and alerts query metric names: rename them in the dashboards in the same change. Old series stop, so history splits at the rename.                                               |
| 10    | Database and stored records: the role and database names (`heed`), advisory lock and setting keys (`heed.migrations`, `heed.local_roles`, `heed.roles`, `heed.areas`, `heed.sources.add`, `heed.dev_people`, `heed.bulk_seed`), `heed.edition/1` in exports, and the app family `heed`.                                                                                                                                                     | `db/migrations`, `src/server/db`, `src/domain/edition-export.ts`, `src/domain/app-family.ts`, `compose.yaml` | Highest. Records already written carry these names. Rename by migration only, and keep reading the old values; never edit an applied migration.                                                     |
| 11    | The MCP server id and registration name `heed`, the field `heed_adds` in the tools' results, the `service` the health check names, and the `heed` CLI command (`npm run heed`). The protected resource name follows the setting.                                                                                                                                                                                                            | `src/server/mcp/gateway.ts`, `src/cli`, `package.json`, connection guides                                    | Highest for people: every agent that registered the server by its id, and every `CLAUDE.md` line that names its tools, must be added again. Announce it, and keep the old id answering for a while. |
| 12    | Repository, package and host names: the repository and the npm package, both `heed`, and test hosts such as `heed.example.test`.                                                                                                                                                                                                                                                                                                            | `package.json`, tests, `src/web/lib/docs.ts`                                                                 | Low for test hosts; the repository name is outside this plan.                                                                                                                                       |

Developer documentation (`README.md`, `docs/ai-sign-in.md`, `docs/contributing`,
`docs/connectors*`, `docs/requirements.md`, `docs/domain/core.md`, `docs/templates`) talks about
the product by name and names the identifiers above. Its prose says Footnote since 18 November
2026; the identifiers it names change with the step that changes them.

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

1. Change `DEFAULT_PRODUCT_NAME` (`src/domain/brand.ts`), or set `HEED_PRODUCT_NAME` where the
   service runs and where the web app and the docs site (`apps/docs`) are built, and rebuild.
2. Run `npm test`: the brand tests confirm the MCP text says the new name and never the old one. Screens and agent text that still write the name by hand
   (class (b) strings not yet moved to `productName`) need a search for the old name.
3. Replace the brand assets (step 1 above), then work down the table as far as the rename goes.
