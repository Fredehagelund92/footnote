<div align="center">

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/images/footnote-lockup-dark.svg">
  <img alt="Footnote" src="docs/images/footnote-lockup-light.svg" height="56">
</picture>

### Stop AI agents misreading your numbers.

AI tools guess when they do not know why a number moved.<br>
With Footnote, the people who know write it down once, and an owner checks it.<br>
Every AI tool then reads it before it answers, and shows where it came from.

<!-- Live demo: when the hosted demo is up, put this at the start of the link row below:
[**Live demo**](https://LIVE-DEMO-ADDRESS) &nbsp;·&nbsp; -->

[Quick start](#quick-start) &nbsp;·&nbsp; [Proof](#proof) &nbsp;·&nbsp; [How it works](#how-it-works) &nbsp;·&nbsp; [Status](#status) &nbsp;·&nbsp; [Docs](#docs) &nbsp;·&nbsp; [Contributing](CONTRIBUTING.md)

[![License: Apache-2.0](https://img.shields.io/badge/license-Apache--2.0-blue.svg)](LICENSE)
[![Node 26](https://img.shields.io/badge/node-26-339933.svg)](.nvmrc)
[![Status: pre-1.0](https://img.shields.io/badge/status-pre--1.0-orange.svg)](#status)

<br>

<img alt="Footnote's Ask page on the demo. Asked how orders in Norway changed in October 2026, it answers Checked: a new customs rule stopped all online sales to Norway from 4 August 2026, so orders there fell to almost nothing, then the other context items that apply. Each sentence carries the number of the source it came from." src="docs/images/hero.png" width="760">

</div>

## Why Footnote

Your metric has a definition. Why it moved doesn't. A market closed, a tool changed how it counts, a
partner's data came in late. Your analytics team knows this. An agent reading the warehouse or the
semantic layer can't see it, so it guesses, and a guess can sound sure of itself.

> Orders in Norway fell to almost nothing after 4 August.
>
> **Without Footnote**, an agent may blame weaker marketing and suggest you check the campaign budget.<br>
> **With Footnote**, it reads a context item: _a new customs rule stopped all online sales to Norway from 4 August 2026_,
> with a link to the notice, the owner who published it, and a line on what not to conclude.

_An illustration of the difference, not a transcript._ The demo data belongs to an invented outdoor-gear
retailer that sells in twelve real countries.

## Proof

Each of these is held by a test in this repository, so you can read it, run it, or try it on the demo.

| What Footnote promises                     | What shows it                                                                                                                                                                                                 |
| ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Agents read only what an owner published   | The database role that serves agents can't read the table of versions, drafts included: `permission denied` ([`tests/integration/mcp.test.ts`](tests/integration/mcp.test.ts))                                |
| The answer above is real                   | CI starts the demo, asks that question in a browser and expects **Checked** with the customs rule ([`tests/e2e-seed/demo.spec.ts`](tests/e2e-seed/demo.spec.ts))                                              |
| The right context gets delivered           | All 53 questions of the [golden set](db/seed/golden-set.yml) run in CI with no model, and each must get the items it expects ([`tests/integration/golden-set.test.ts`](tests/integration/golden-set.test.ts)) |
| Nothing is filled in when nothing is known | Every answer starts with one of six [answer lines](docs/help/answer-lines.md). Golden questions with nothing written down must come back Not found                                                            |

Footnote doesn't yet have a measured number for how much better an agent answers with it than without it.
[Status](#status) says what is and isn't done.

## How it works

1. **Write.** Anyone writes a short context item: what happened, where it applies, from when, and how we know.
   An agent or an integration can send a suggestion too.
2. **Review.** The owner of the domain sees it in the Inbox. The review shows exactly what changes, whether
   the claims match the source, and what agents would say before and after. The owner publishes it, or
   returns it with a note.
3. **Agents read.** Your agent asks Footnote over [MCP](docs/help/how-agents-use-it.md) and gets the items that
   apply, with sources, and an answer line first.
4. **Gaps come back.** A question that keeps finding nothing becomes a Not found card in the owner's Inbox,
   counted by topic, never by who asked.

Footnote holds context, not numbers. Your semantic layer defines the metrics and returns the figures; a context item
points to them. Footnote reads definitions from [Cube](docs/connectors/cube.md) and
[dbt MetricFlow](src/connectors/dbt-metricflow/README.md), and turns documents from Markdown in Git and Google
Drive into suggestions for owners. [Build a connector](docs/connectors/authoring.md) says how to add another tool.

## Quick start

You need Docker:

```sh
git clone https://github.com/Fredehagelund92/footnote.git && cd footnote
docker compose up
```

`docker compose up` builds the images from this checkout, so you get what this page describes. The first start
builds them and loads the demo, which takes several minutes. Then open <http://localhost:8080>. It opens as Ravi
Kapoor, the admin. **View as**, in the top right corner, switches to Jon Abara, who owns Sales, or to Maria
Lindqvist, who can read and suggest. Sign out to pick any other demo person.

The demo is an invented outdoor-gear retailer: people, domains and context items, with their history,
suggestions waiting for review and what agents asked over the past weeks. Nothing leaves your computer, and no
AI service is called. Stop with Ctrl+C; `docker compose down --volumes` also removes the data.

If port 8080 or 3000 is taken on this computer, move them: start with `FOOTNOTE_WEB_PORT=8081 FOOTNOTE_PORT=3001` in
front of `docker compose`, and connect agents to port 3001. Under Colima a taken port may fail without a word,
and the other program answers there instead.

Another way in:

- **The published images, in about two minutes.** `docker compose -f compose.yaml -f compose.images.yaml up`
  pulls them instead of building. They are the latest release, named in `compose.images.yaml`, which can be
  behind this page and may differ from it. A newer release replaces them. They exist from the first release on;
  until then `docker compose up` builds them.

To choose how to run Footnote for your own team, see [Where to run Footnote](docs/where-to-run.md). To keep it running
here, back it up, upgrade it or roll an upgrade back, see [Self-host Footnote on one computer](docs/self-hosting.md).
That is for local evaluation, not for production use.

`compose.yaml` runs the service in development mode (`NODE_ENV=development`) for the demo's people picker,
where anyone can sign in as anyone. The service image on its own starts in production mode, with company
sign-in: see [Run the image in production mode](docs/operations.md#run-the-image-in-production-mode).

### Connect Claude Code

With the demo running:

```sh
claude mcp add --transport http footnote http://localhost:3000/mcp
```

Then run `/mcp` in Claude Code, choose **footnote**, and choose **Authenticate**. Your browser opens Footnote; choose a
demo person and **Allow**. Ask _"How did orders in Norway change in October 2026?"_

<p align="center">
  <img alt="Claude Code asked how orders in Norway changed in October 2026, on the demo. It calls Footnote and answers with the checked context that online sales to Norway stopped on 4 August 2026 under a customs rule, who checked it, and that fewer orders there do not mean fewer customers." src="docs/images/claude-code.png" width="760">
</p>

[Connect an agent](docs/help/connect-an-agent.md) has the details for Claude Code and other agents, and
[Get started](docs/help/get-started.md) walks through a first answer.

### Use your own data

Footnote reads metric and dimension names from your semantic layer, and never writes to it. For a
[Cube](https://cube.dev) model, name its folder:

```sh
CUBE_MODEL_DIR=/path/to/your/cube/model docker compose up
```

This builds the images from this checkout, as the Quick start does. With your own model Footnote starts empty, with
no demo data. The sign-in page offers the sample people of `db/seed/people.local.yml`: sign in as Ravi Kapoor,
the admin, and follow the setup checklist in the Inbox: add your domains, then publish the names each read makes,
on one card. Your context applies to those names. On a Mac the folder must be one Docker shares, or Footnote
refuses to start and says so. See [the Cube connector](docs/connectors/cube.md).

To sign in as yourself, add your name and email to the top of `db/seed/people.local.yml` with
`roles: [administrator]`, then start with `docker compose up --build`, so the image takes the file in.

For dbt, Footnote reads the `semantic_manifest.json` that `dbt parse` writes, from a link, object storage, a Git
repository or a folder: see [the dbt MetricFlow connector](src/connectors/dbt-metricflow/README.md). Start Footnote
with `docker compose up`, as above. Tokens and signed links stay in a secret store in Docker's `footnote_keys` volume.

## What you get

<p align="center">
  <img alt="A short recording on the demo. Someone asks how orders in Norway changed in October 2026, and Ask answers Checked with four numbered sources. Then the Inbox of the owner of Sales opens on a conflict agents met about United Kingdom orders, both items side by side." src="docs/images/ask-and-inbox.gif" width="760">
</p>

<table>
  <tr>
    <td width="33%"><img alt="The Inbox of the owner of Sales: what agents asked this week and what needs them, by kind, with a conflict agents met about United Kingdom orders open beside it: both items side by side, and Compare and decide" src="docs/images/inbox.png"></td>
    <td width="33%"><img alt="A review: a suggestion to change a context item, what it changes, how it relates to the live items it overlaps, and what agents will say after it is published" src="docs/images/review.png"></td>
    <td width="33%"><img alt="Observability's Overview for the owner of Sales: views for all topics and what needs a look, a filter bar and facets, this week's numbers (113 questions asked, 27% checked, 15 not found), questions per day by answer, and the topics agents asked about. Counts only." src="docs/images/observability.png"></td>
  </tr>
  <tr>
    <td align="center"><sub>One Inbox for owners</sub></td>
    <td align="center"><sub>Review with what agents will say</sub></td>
    <td align="center"><sub>What agents asked, day by day, counts only</sub></td>
  </tr>
</table>

- **Four kinds of context.** Event, Warning, Rule and Guide. Each says where it applies (metric, market,
  dates), links its source with one copied sentence, and says what not to conclude.
- **Owners, not a free-for-all.** Every context item belongs to one domain, and that domain's owners publish
  it. A draft, a suggestion or a comment never reaches an agent.
- **Checked before it ships.** The review compares the claims with the source, shows a clash with live
  context, and runs the question agents asked against the draft. [Review a suggestion](docs/help/review-a-suggestion.md).
- **Six answer lines.** Every answer, for an agent and for a person, starts with one: Checked, Partial, Not found,
  Conflict, Outdated or Not looked up. [Answer lines](docs/help/answer-lines.md).
- **An MCP server.** Six tools: `get_context`, `find_context`, `read_context`, `report`, `suggest_context` and
  `get_related`. Agents sign in as the person and see only what that person can read.
  [Agent tools](docs/help/tools.md).
- **No AI picks the context.** Rules choose what applies from the question's metrics, markets and dates, so the
  same question gets the same items until an owner publishes a change. Ask shows exactly that.
- **Ask about the context itself.** Ask what is missing, due for a check, conflicting or unowned, and Footnote counts it from its own
  records, says out of how many, and says what it can't see.
- **Gaps and saved questions.** Questions that found nothing are counted by topic, so people write what's
  missing. Saved questions are answered again after every change, so a publish that makes an answer worse is
  seen at once. Footnote never records who asked.
- **Stays in step with your semantic layer.** When a definition an item relies on changes or disappears, the item
  is marked for its owner to check.

## How it fits together

<p align="center">
  <img alt="Agents such as Claude Code ask Footnote over MCP. Footnote keeps domains and owners, checks and editions, stores context and history in PostgreSQL, reads Cube model files, and uses a language model an admin chooses for Ask's words and test runs." src="docs/images/architecture.svg" width="640">
</p>

| Instead of                       | What breaks                                                      | What Footnote does                                                             |
| -------------------------------- | ---------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| A wiki or shared document        | Agents can't see it, or read a page nobody has checked in a year | Short, dated context with a source and an owner, delivered over MCP            |
| Notes in `CLAUDE.md` or a prompt | One copy per tool, no review, no history                         | One library for every agent, with review, checks and a history                 |
| Search over your documents       | Returns text that looks like the question, with no owner or date | Returns the context that applies to the metric, market and dates, or says none |
| Your semantic layer              | Defines the number, not why it moved                             | Sits beside it: the layer gives the figure, Footnote gives the context         |

Footnote is not a data tool: it stores no numbers. When an admin switches figures on for an integration, Ask reads
one figure from it when someone asks, and keeps it nowhere. It is not a wiki: every context item is short, has a
source, and its owner checks it. It doesn't watch people: it counts questions by topic, not by person.

## Docs

| Use it                                                  | Run and build it                                                                                 |
| ------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| [Get started](docs/help/get-started.md)                 | [Where to run Footnote](docs/where-to-run.md): the ways to run it, compared                      |
| [Write context](docs/help/write-context.md)             | [Self-host Footnote on one computer](docs/self-hosting.md): install, back up, upgrade, roll back |
| [Review a suggestion](docs/help/review-a-suggestion.md) | [Run and operate the service](docs/operations.md): run it, check it, run it in production        |
| [Connect an agent](docs/help/connect-an-agent.md)       | [MCP and API reference](docs/reference.md): which page to read, for agents and scripts           |
| [Privacy](docs/help/privacy.md)                         | [Sign in your own agent](docs/ai-sign-in.md)                                                     |
| [All help pages](docs/help/README.md)                   | [Evaluations and the golden set](docs/evaluations.md)                                            |
|                                                         | [Develop Footnote](docs/development.md) and [its tests](docs/testing.md)                         |
|                                                         | [Security, scanning and the restore drill](docs/security.md)                                     |
|                                                         | [Service settings](docs/configuration.md): every setting the service reads                       |
|                                                         | [Set up company sign-in](docs/company-sign-in.md): OpenID Connect, and who may sign in           |
|                                                         | [Administer the service](docs/administration.md): settings, the history log, import and export   |

<!-- Docs site: when it is published, add this line:
Read these as a site at [fredehagelund92.github.io/footnote](https://fredehagelund92.github.io/footnote/). -->

The help pages are also the app's own Docs, at `/docs`, and [the docs site](apps/docs/README.md), which isn't
published yet: `npm run site:dev` runs it on your computer. [Requirements](docs/requirements.md) says what Footnote must
do, and [Build a connector](docs/connectors/authoring.md) how to read another source.

The [documentation index](docs/README.md) lists every page. The [product page](docs/product.md) and the
[design contract](docs/design/design-contract.md) say what the Footnote v1 web app is and how it looks.

The clickable mockup is the design the app was built from, kept as a reference in git history, under the tag `mockup-archive`: the app now leads.

## Status

Footnote is **pre-1.0** and has no release yet: the first will be 0.1.0. This page describes the code on main.
It is for trying on one computer, not for production use. Expect rough edges and breaking changes.

**Works today**

- The whole loop on the demo: write, review, publish, read over MCP, and gaps back to the owner.
- Definitions from Cube and dbt MetricFlow, documents from Markdown in Git and Google Drive, and agents on your
  computer over MCP, such as Claude Code.
- Company sign-in with OpenID Connect ([Set up company sign-in](docs/company-sign-in.md)
  and [Sign in your own agent](docs/ai-sign-in.md)).

**Not there yet**

- **No measured result.** Footnote has an [evaluation runner](docs/evaluations.md) and a golden set, but no published
  figure for how much better an agent answers with Footnote than without it.
- **No hosted demo and no published docs site.** Run the demo yourself, and read the docs in this repository.
- **Not tested on a named cloud host.** CI starts the images in production mode, but nobody has yet run them on AWS,
  Railway or Fly ([Where to run Footnote](docs/where-to-run.md)).
- **Agents in the cloud** need Footnote at an address on the internet: see [Connect an agent](docs/help/connect-an-agent.md).

**Good to know**

- The Docker demo uses the demo sign-in: anyone can be an admin, so keep it off the internet.
- An access key, for a job that runs with nobody there to sign in, has no end date: it works until an admin
  deletes it, so delete one a job no longer needs ([Connect an agent](docs/help/connect-an-agent.md#a-bot-or-a-scheduled-job)).
- The demo runs on scripted mock models and spends nothing. `MODELS=live ANTHROPIC_API_KEY=... docker compose up`
  answers on Claude instead: [Ask on a real model](docs/self-hosting.md#ask-on-a-real-model) says what then leaves
  your computer and what it costs.
- Built with TypeScript on Node 26, Fastify, PostgreSQL 18, React 19 and the official MCP SDK.

## Contributing

**The most useful change you can send is a connector.** [Build a connector](docs/connectors/authoring.md) is
written so a coding agent can follow it from top to bottom, and [CONTRIBUTING.md](CONTRIBUTING.md) has the prompt
to start from. For anything else, open an issue first if it is bigger than a small fix, then send a pull request.
`npm run check` runs the type check, lint, format check and unit tests. Please follow the
[code of conduct](CODE_OF_CONDUCT.md).

Data status for agents, which would let an agent know when the data behind a metric is late or failing, is not built
yet. [The design is open](https://github.com/Fredehagelund92/footnote/issues/159), and your input is welcome there.

## Security

Please report a security problem privately, through GitHub's private vulnerability reporting, not in a public
issue. [SECURITY.md](SECURITY.md) says how and what happens next.

## License

[Apache License 2.0](LICENSE). You keep the copyright in your contributions.
