# Releasing Footnote

How a version of Footnote is made: one version number, a release pull request that writes the
changelog, and a tag that builds the images, the site and the GitHub Release. Only a
maintainer merges the release pull request and pushes the tag; nothing is released by a merge alone.

## One version number

Footnote's version is written in one place, `version` in `package.json`. The service reads it from
there when it starts (`src/server/version.ts`) and names it in:

- the MCP server info an agent gets when it connects (`serverInfo.version`);
- the OpenAPI document, `info.version`, as served at `/api/v1/openapi.json` and as written in
  `docs/api/openapi.json`;
- `GET /health` and `GET /health/ready` (`"version": "0.1.0"`).

`tests/server/version.test.ts` and the MCP conformance test fail when any of them, the lockfile or
`.release-please-manifest.json` names another version. Nobody changes the number by hand: the
release pull request does.

Before 1.0, Footnote is for trying it on one computer, not for production use, and every release says
so in its notes.

## How a release happens

1. **Every merge to `main`** runs [release-please](https://github.com/googleapis/release-please)
   (`.github/workflows/release-please.yml`, set up in `release-please-config.json`). It keeps one
   pull request open, titled with the next version, such as `chore(main): release 0.2.0`, that:
   - writes the new section of `CHANGELOG.md` from the commit titles since the last release;
   - raises the version in `package.json`, `package-lock.json`, `.release-please-manifest.json`,
     `docs/api/openapi.json`, the supported versions in `SECURITY.md`, and the two images
     `compose.images.yaml` pulls, so the demo from the published images at a release's tag
     ([From the published images](try-the-demo.md#from-the-published-images)) runs that release's images.

   It makes the pull request again on top of `main` after every merge, even one that adds no line
   to the changelog, so the pull request is never behind `main`.

   CI runs on the release pull request as on any other and reports **CI gate**. The pull request
   is opened by the `github-actions` bot, so GitHub holds its CI run until a maintainer approves
   it: on the pull request, choose **Approve workflows to run**. Approve the run of the newest
   push, when you mean to release; the pull request is made again after every merge.

2. **A maintainer merges the release pull request** once **CI gate** has passed, with a squash
   merge like any other.
3. **A maintainer tags the commit that merge made**, `v0.1.0`, and pushes the tag.
4. **The tag runs `.github/workflows/release.yml`**:
   1. it checks that the tag names the version in `package.json`, that the tagged commit is the
      one that merged the release pull request into `main`, and that **CI gate** passed on it;
   2. it builds both images in the `Dockerfile`, the service and the web app, for `linux/amd64` and
      `linux/arm64`, each on a runner of that platform;
   3. it scans each image on each platform with [Trivy](https://trivy.dev), pushed by digest and
      before it has a tag, and stops on a critical or high vulnerability that a newer package
      fixes;
   4. it pushes them to the GitHub Container Registry with an SBOM and the build provenance, as
      `ghcr.io/fredehagelund92/footnote` (the service) and `ghcr.io/fredehagelund92/footnote-web` (the web
      app), each tagged `0.1.0`, `0.1` and `latest`;
   5. it signs the build provenance of both images with GitHub's artifact attestations, and checks
      that each platform has its SBOM and provenance and that the signature verifies;
   6. it checks that `compose.images.yaml` names exactly the images it pushed, then starts the
      demo from them as a stranger would at the tag, without signing in to ghcr.io:
      `docker compose -f compose.yaml -f compose.images.yaml up`. On that demo it runs the demo
      journey and the eight demo questions in a browser (`.github/workflows/demo-images.yml`).
      Until they pass, there is no GitHub Release;
   7. it builds the release's offline copy of the site at the tag ([The site](#the-site)), in parallel and apart
      from the release, so a failed site build never stops it;
   8. it creates the GitHub Release `Footnote 0.1.0`: its notes are the version's section of
      `CHANGELOG.md` (`scripts/release-notes.ts`) and the two images with their digests;
   9. it moves the release pull request's label from `autorelease: pending` to
      `autorelease: tagged`. release-please opens no new release pull request while a merged one
      is still pending;
   10. a last job attaches the site as `footnote-docs-0.1.0.tar.gz` to the release, only if the site
       build succeeded. If it failed, the run shows the failed site job and a warning that the
       tarball was not attached; the release and images are intact;
   11. it asks Vercel to build the site again, so the release's docs appear ([The site](#the-site));
   12. it asks Vercel to build the demo, which builds only for a release
       ([The demo on Vercel](#the-demo-on-vercel)).

The workflows use only the workflow's own token, with the least each job needs. The only secrets
are the two optional deploy hooks, the site's `SITE_DEPLOY_HOOK` ([The site](#the-site)) and the
demo's `APP_DEPLOY_HOOK` ([The demo on Vercel](#the-demo-on-vercel)).

## The version number and the changelog

The pull request title becomes the commit on `main` (one squash commit per pull request), and the
commit title becomes the changelog line, so a title is written for the person who reads the
release notes. The type decides where it goes and what it raises:

| Title                        | In the changelog | Raises, before 1.0 | Raises, from 1.0 |
| ---------------------------- | ---------------- | ------------------ | ---------------- |
| `feat: ...`                  | Features         | 0.1.0 to 0.2.0     | 1.0.0 to 1.1.0   |
| `fix: ...`                   | Fixes            | 0.1.0 to 0.1.1     | 1.0.0 to 1.0.1   |
| `perf: ...`                  | Faster           | 0.1.0 to 0.1.1     | 1.0.0 to 1.0.1   |
| `feat!: ...` (breaks a user) | Features         | 0.1.0 to 0.2.0     | 1.0.0 to 2.0.0   |
| `docs`, `ci`, `test`, ...    | left out         | nothing            | nothing          |

`CHANGELOG.md` is written by release-please and by nothing else. Never edit it, in the release
pull request or later. To change what a line says, edit the description of the pull request that
merged the change, before the release pull request is merged, and add the words release-please
should use instead:

```text
BEGIN_COMMIT_OVERRIDE
fix(web): say a question was not looked up instead of Not found
END_COMMIT_OVERRIDE
```

To choose the next number yourself, end the message of the squash commit with the line
`Release-As: 0.2.0` when you merge a pull request.

**What's new** in the app (`docs/help/changelog.md`) is a different page: a few changes people
notice, in the app's words, written by hand ([the help pages](help/README.md#whats-new)). Check
that it is current before you merge a release pull request.

**The pictures** of the app, in the README and on the landing page, are captures of the demo taken
by a script. Before you merge a release pull request, take them again ([the pictures](../site/README.md#the-pictures))
and merge any that changed in a pull request of their own, so the release shows the app as it is.

## The site

The public site ([site](../site/README.md)), the landing page at the root and the docs under `/docs/`, is built and served by Vercel from this repository, at the project's `vercel.app` address. Production follows `main`, and each pull request gets a preview.

- **Every deployment** builds the whole site: the commit's landing page and its docs as `/docs/next/`, which tells search engines to leave it alone, and the docs of every release as `/docs/MAJOR.MINOR/`, such as `/docs/0.1/`, each built again from its own tag. So a change to the docs shows in the pull request's preview and, once it merges, in production's `/docs/next/`, and a release's docs stay as they were at its tag.
- **Docs are published once per minor version**, from the newest patch of that minor: a patch release replaces its minor's folder, and an older patch is never built. A tag from before the site, such as `v0.1.0`, the pre-release from before the name, has no `site/` folder and adds nothing.
- **`/docs/`** opens the newest release, and so does a page named without a version, such as `/docs/try-the-demo/`, which is how the landing page links to the docs. Until the first release, `/docs/` opens `/docs/next/`, and its pages carry no banner that they follow main: nothing is ahead of them yet.
- **A push that changes nothing the site reads** builds nothing (`site/scripts/vercel-ignore.ts`). A redeploy builds, and so does any push while the live site lacks a release.

A tag starts no build on Vercel, so after a release the **Site on Vercel** job in `release.yml` calls the project's deploy hook, which builds `main` again with the new release's docs. Without the hook it says so in the run, and the next push to `main` adds them. `.github/workflows/site.yml` only builds the release's offline copy, `footnote-docs-<version>.tar.gz`; a failed site build never stops the release: the tarball is skipped with a warning.

To connect the project, once, a maintainer:

1. Imports the repository in Vercel as a new project, with **Root Directory** `site`. `site/vercel.json` sets the rest: the Astro preset, `npm ci`, the build, the output folder `dist` and the ignored build step. The production branch is `main`.
2. Leaves `SITE_URL` unset, so every address follows the project's production address, `VERCEL_PROJECT_PRODUCTION_URL`, and a preview's own. To serve it elsewhere later, sets `SITE_URL` in the project's environment variables, such as `https://footnote.example`, and redeploys: every folder is built again with the new address.
3. Creates a deploy hook for `main` in the project's **Settings, Git**, and adds its address as the repository secret `SITE_DEPLOY_HOOK`.

## The demo on Vercel

The hosted demo ([Run the demo on Vercel and Neon](vercel.md)) is a second Vercel project, built from the repository's root by `vercel.json`. Unlike the site, it builds only for a release: every push and pull request is skipped (`scripts/vercel-ignore.ts`). After a release the **App on Vercel** job in `release.yml` calls the project's deploy hook, which builds `main`, now at the release's version. Without the hook it says so in the run, and the next push to `main` builds the release.

To connect it, once, a maintainer creates a deploy hook for `main` in the demo project's **Settings, Git**, and adds its address as the repository secret `APP_DEPLOY_HOOK` ([Only a release builds](vercel.md#only-a-release-builds)).

## Set up once

These are repository settings, so a maintainer makes them, once before the first release. A fork
or a new repository needs them again:

1. **Settings, Actions, General, Workflow permissions:** turn on **Allow GitHub Actions to create
   and approve pull requests**. Leave the default permissions at read. Without it the release
   pull request workflow fails on every merge to `main` with "GitHub Actions is not permitted to
   create or approve pull requests".
2. **After the first release**, the two packages on ghcr.io are private, as every new package is.
   On each package's page (**Packages**, `footnote` and `footnote-web`, **Package settings**), choose
   **Change visibility**, then **Public**, so `docker pull` works without signing in. Check that
   each shows this repository under **Repository source**.
3. Optional: a tag ruleset (**Settings, Rules, Rulesets, New tag ruleset**, for `v*`) that lets only
   maintainers create, move or delete release tags.

## The first release

Footnote has no release yet, and the first is 0.1.0. A release 0.1.0 of 2 November 2026, made
under the product's earlier name, was withdrawn: nobody used it. So `release-please-config.json`
tells release-please to make 0.1.0 again, from the start of the history:

- `release-as` is `0.1.0`, so the release pull request is `chore(main): release 0.1.0`, not the
  next number after the withdrawn release;
- `last-release-sha` is the repository's first commit, so the changelog section of 0.1.0 holds
  every change, not only those since the withdrawn release.

Before a maintainer merges that pull request:

1. Delete the withdrawn release, its tag and its images, so the tag `v0.1.0` can name the new
   release: the GitHub Release and the tag (`gh release delete v0.1.0 --cleanup-tag`), and the
   two packages it pushed to ghcr.io under the repository's earlier name.
2. Take the withdrawn release's section, `## 0.1.0 (2026-11-02)`, out of `CHANGELOG.md` in a
   commit on `main`, so the changelog has one 0.1.0. This is the one change to `CHANGELOG.md` a
   maintainer makes by hand: release-please writes the new section above the old one and never
   removes a section. It makes the release pull request again from `main` after every merge, so
   the change belongs on `main`, not in the release pull request.

Then make the release as below, with `0.1.0` where the steps say `0.2.0`. Once it is out, remove
`release-as` and `last-release-sha` from `release-please-config.json`: as long as they are there,
every release pull request is 0.1.0 again, with the whole history.

## Make a release

Every release takes the same steps, with its own version where these say `0.2.0`:

1. Open the pull request `chore(main): release 0.2.0`. If there is none, start it by hand:
   **Actions, Release pull request, Run workflow** on `main`, or

   ```sh
   gh workflow run release-please.yml --repo Fredehagelund92/footnote --ref main
   ```

2. Read the new `CHANGELOG.md` and check that `package.json`, `package-lock.json`,
   `.release-please-manifest.json`, `docs/api/openapi.json`, `SECURITY.md` and
   `compose.images.yaml` say `0.2.0`. Check
   **What's new**. Choose **Approve workflows to run**, and wait for **CI gate**.
3. Run Ask's speed gate on the release pull request's branch. On a quiet computer, with nothing
   else running, start the demo on a real model ([Start on a real model](model-providers.md#start-on-a-real-model))
   and run:

   ```sh
   node scripts/time-ask.ts http://localhost:8080
   ```

   It asks "What is net revenue?" and then "Who owns it?" in ten new chats, and times each until
   the answer's first word shows. It passes when 9 rounds of 10 show the first answer's first word
   within 4 seconds and the follow-up's within 2.5 seconds. It costs about USD 0.50. When it
   fails, the release waits until it passes.

4. Merge it. Wait for **CI gate** to pass on the commit the merge made on `main`.
5. Tag that commit and push the tag:

   ```sh
   git fetch origin
   sha=$(gh pr view <release pull request number> --repo Fredehagelund92/footnote --json mergeCommit --jq .mergeCommit.oid)
   git tag -a v0.2.0 -m "Footnote 0.2.0" "$sha"
   git push origin v0.2.0
   ```

6. Watch **Actions, Release**. It takes a few minutes. When it passes, the release is at
   `https://github.com/Fredehagelund92/footnote/releases/tag/v0.2.0`.
7. Check the images:

   ```sh
   docker buildx imagetools inspect ghcr.io/fredehagelund92/footnote:0.2.0     # linux/amd64 and linux/arm64
   gh attestation verify oci://ghcr.io/fredehagelund92/footnote:0.2.0 --repo Fredehagelund92/footnote
   gh attestation verify oci://ghcr.io/fredehagelund92/footnote-web:0.2.0 --repo Fredehagelund92/footnote
   ```

8. Check that the release has `footnote-docs-0.2.0.tar.gz` among its files.

## When something goes wrong

- **The tag does not name the version, or names another commit:** the first job stops before
  anything is built. Delete the tag (`git push origin :refs/tags/v0.1.0`, then
  `git tag -d v0.1.0`) and tag the commit that merged the release pull request.
- **CI gate has not passed on the tagged commit yet:** the first job stops. Once it has passed,
  open the run and choose **Re-run all jobs**.
- **The scan found a critical or high vulnerability that has a fix:** nothing is tagged or
  released. Its job names the package and the version that fixes it. Take the fix on `main` (a
  newer base image or package) in a new release: move the merged release pull request's label
  from `autorelease: pending` to `autorelease: tagged`, so release-please opens the next one.
- **The demo from the published images failed:** read its Playwright report among the run's
  files. If the images could not be pulled, the packages are not public yet
  ([Set up once](#set-up-once), step 2): make them public and choose **Re-run failed jobs**.
- **A build or the release failed half way:** choose **Re-run failed jobs**. Images are pushed by
  digest, and a release that was already made gets its notes written again.
- **To take a release back:** delete the GitHub Release and the tag. Pushed images stay where they
  are, under their digests; delete the versions on each package's page if they must go. To make
  the same release again, push the same tag again.
