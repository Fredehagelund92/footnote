# The product name

The product is called Footnote. This page says where the name appears, which of those places
follow one setting, which are fixed technical names, and what changing the name takes.

## The setting

One setting holds the name people and agents read: `FOOTNOTE_PRODUCT_NAME`, default `Footnote`
(`src/domain/brand.ts`).

- The service reads it once at start (`src/server/brand.ts`), so the MCP tools' descriptions and
  the server instructions stay byte-stable between requests. A value that is not a usable name
  stops the start (`src/server/config/env.ts`).
- The web build reads the same variable (`envPrefix` in `vite.config.ts`, `src/web/lib/brand.ts`),
  and so does the page title in `src/web/index.html`. Set it for both.
- The documentation in `docs/help` names no product ([copy](design/copy.md)), and the public site
  (`site`) reads the same setting and default for the docs' titles and the logo. The landing page's
  own words say Footnote.

A label needs no name: the reader already knows which product they are in, so it says "Back",
"Add to your agent" or "Reads", not the name. A sentence that reads wrongly without it ("Sign in
to Footnote", an agent told what the server holds) takes the name from the setting:
`productName` in the app and the service.

## The technical names

A name a machine, a file or a stored record depends on is fixed and does not follow the setting:

- the settings, which start `FOOTNOTE_`, and the compose file's `FOOTNOTE_PORT` and
  `FOOTNOTE_WEB_PORT`;
- the key files `.footnote-dev-key.pem`, `.footnote-mcp-state.key` and `.footnote-oauth-key.pem`,
  the image's folder `/var/lib/footnote`, and the held-out key `~/.footnote/held-out.key`;
- the cookies `footnote_session`, `footnote_oauth_browser` and `footnote_oidc_browser`, and the
  Ask chats' storage key `footnote.ask.chats.<person>` (the browser's other keys start with the
  product's slug, so they follow the setting);
- the headers `x-footnote-csrf`, `x-footnote-api` and `X-Footnote-Tool-Digest`;
- the metric names `footnote_*`, the logger's name, the database's application names and lock
  keys (`footnote.*`), the agent family of the built-in test runs and the export format
  `footnote.edition/1`;
- the MCP server id `footnote`, the field `footnote_adds` in the tools' results, and the command
  `npm run footnote`;
- the npm packages `footnote` and `footnote-site`, the compose project, service and volumes, and
  the images `ghcr.io/fredehagelund92/footnote` and `footnote-web`;
- the public site's theme key in the browser, `footnote-theme`, and the docs' tarball
  `footnote-docs-<version>.tar.gz`.

The database roles keep their own name, `context_layer_*`, which never named the product.

## The checks

- `tests/server/brand.test.ts` checks the setting: the default, a name that stops the start, and
  the token. It also sets another name and checks that the MCP instructions and tools say it.
- The lint rule `brand/no-product-name` (`eslint.product-name.js`, proved in
  `tests/lint/product-name.test.ts`) reports a string, template text or JSX text in the app, the
  domain, the contract, the service or the CLI that names the product by hand. A technical name
  carries an `eslint-disable-next-line` comment with its reason.
- `tests/lint/former-name.test.ts` fails when the product's former name appears in any file git
  tracks, or in a file's path, outside a short list of historical records that are never
  rewritten.

## Outside the repository

A maintainer does these in the repository's and the registry's settings; no change to the code
does them:

- **Rename the GitHub repository** to `footnote`. The code already links to
  `Fredehagelund92/footnote`; until the rename those links lead nowhere. GitHub then forwards the
  old address. The clone in `tests/image/git-markdown.sh` follows the repository's name on its
  own, and so does the public site on Vercel, which takes the repository from Vercel's Git
  settings (`site/scripts/vercel-build.ts`).
- **Rename before the first release.** A release pushes its images under the repository's name
  (`.github/workflows/release.yml`), so a release made before the rename would push them where
  `compose.images.yaml` does not look, and its demo job (`demo-images.yml`) would fail.
- **The images.** After the first release, make the packages `footnote` and `footnote-web` public
  ([releasing](releasing.md#set-up-once)), and delete the packages the withdrawn release pushed
  under the repository's earlier name.
- **The social preview and the owner's avatar** change when a maintainer uploads them
  ([logo](design/logo.md)).

## When the name changes

1. Change `DEFAULT_PRODUCT_NAME` (`src/domain/brand.ts`), or set `FOOTNOTE_PRODUCT_NAME` where the
   service runs and where the web app and the public site (`site`) are built, and rebuild.
2. Run `npm test`: the brand tests confirm the MCP text says the new name.
3. Replace the brand assets ([logo](design/logo.md)). Renaming the technical names above is a
   change of its own, with no old name read in their place.
