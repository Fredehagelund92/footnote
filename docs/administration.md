---
title: Administer the service
line: Change settings, read the history log, import items, export an edition and use the footnote command.
group: Run the service
order: 10
reviewed: 2026-11-05
---

Change settings, read the history log, and move items in and out. Most of this is for admins, through the API under `/api/v1` or the `footnote` command. For how to call the API, see the [HTTP API overview](reference/http-api.md).

## Change a setting

`GET /settings` lists the current version of each limit, threshold, retention period, review time and model.

`PUT /settings/{key}` takes the version you read, the new value and a reason. A stale version answers 409, and a value the setting does not accept answers 422.

```json
{
  "version": 3,
  "value": { "person": 600, "ip": 300 },
  "reason": "A busy office behind one address"
}
```

A change applies at once, and the history log keeps it with who made it.

| Setting                          | What it limits                                |
| -------------------------------- | --------------------------------------------- |
| `limits.api_rate_per_minute`     | Requests to the API, by person and by address |
| `limits.mcp_requests_per_minute` | Agent calls, by person and by client label    |
| `limits.mcp_rate_per_minute`     | Agent calls to each tool                      |
| `limits.agent_drafts`            | Drafts one person's agents can save           |
| `limits.link_reads`              | Links people can read, failed reads too       |
| `limits.writing_help`            | How much one person can use writing help      |
| `limits.undo_seconds`            | How long a decision can be undone             |
| `privacy.min_count`              | The smallest count shown                      |
| `retention.delivery_days`        | How long what agents asked about is kept      |

## Links people paste

Draft from text opens the public page a pasted link points to. Three settings govern it, and Settings, Advanced changes the first two:

| Setting                  | What it does                                                    |
| ------------------------ | --------------------------------------------------------------- |
| `links.read_pages`       | On as installed. Off, people paste the page's text instead      |
| `links.never_read_hosts` | Hosts never read: a name with its subdomains, or an address     |
| `limits.link_reads`      | Reads a person may make in an hour and a day, and the workspace |

The limits are counted in the database, so every service process keeps the same ones. The count keeps who and when, never an address, for two days. What the reader refuses, and why it never uses a proxy, is in [Links people paste](run-in-production.md#links-people-paste).

## Shared chats

A person can share an Ask chat as a link: a copy of each turn's question, what Ask read, its answer line, its words and its sources, under their name. Only people signed in open it, and each source shows only to those who may read it. A link lasts 90 days, and its sender stops it from History.

`ask.share_chats` is on as installed, and Settings, Advanced, Shared chats turns it off. Off, no link is made and none opens, the ones already made too. A link pasted into another tool shows only "A chat from Footnote".

## Writing help

Writing help is a panel beside the editor, on a computer or tablet: a person says what happened or what to change, and an AI model changes the fields of their own draft, which they check. It cannot send or publish, it never sets the domain, the owner, who may read an item or its risk, and every field it writes passes the checks an agent's `write_draft` passes.

| Setting               | What it does                                                                       |
| --------------------- | ---------------------------------------------------------------------------------- |
| `writing_help.on`     | Off as installed. Settings, Advanced, Writing help turns it on                     |
| `limits.writing_help` | Turns one person may take in 24 hours (40), and characters in one message (12,000) |

Turn it on only once your company approves the model provider for draft text. On, three things go to the model set for Ask (`models.assistant`), for that turn:

- the words of the person's own draft
- what they write to writing help
- the text of one page they link

Off, nothing of a draft leaves the service. It is there only with a real model (`MODELS=live`); with none, the switch changes nothing people see.

The turns are counted in the database with who and when, never a word, for 24 hours. Its model calls count under `limits.llm_feature_monthly_micros.writing_help` and the person's daily limit. Nothing of a chat is stored: the browser keeps it for the visit. The history of a draft names the person as the one who changed it and writing help as the writer.

## Switch a tool off for every agent

`POST /tools/{tool}` takes `{ enabled, reason }`. To do it for one agent, use [its Details](help/connect-an-agent.md#the-tools-each-agent-may-call).

## Set a policy for a client label

These have no screen in the web app. `GET /clients` lists the client labels, and `PUT /clients/{label}` adds or changes one:

| Field              | What it does                                         |
| ------------------ | ---------------------------------------------------- |
| `displayName`      | Its name                                             |
| `toolsAllowed`     | Its tools. Null means every tool that is switched on |
| `ratePerMinute`    | Its rate. Null means the default client rate         |
| `maxResponseBytes` | The largest reply, 1,000 to 100,000                  |
| `enabled`          | Whether it may call at all                           |
| `reason`           | Why, for the history log                             |

A label is never removed. Switch it off instead.

## Create a domain

`POST /areas` creates one with an `id` that never changes, its name, hue, review time in working days (1 to 30), owners and a reason. It is served from the start.

Owners and admins change a domain's `summary` and `description` with `PUT /areas/{id}/description`. Both operations need an `Idempotency-Key`.

To change who looks after a domain, use `/assignments/grant` and `/assignments/revoke`, which have no screen in the web app.

## Read the history log

Admins can read it. Reading or exporting it is not itself logged.

| Operation           | What it does                                                                                                       |
| ------------------- | ------------------------------------------------------------------------------------------------------------------ |
| `GET /audit`        | Searches newest first, 50 at a time, by `action`, `actorId`, `areaId`, `subjectType`, `subjectId`, `from` and `to` |
| `GET /audit/export` | Writes JSON Lines, or CSV with `format=csv`, oldest first, up to 10,000 entries a call                             |
| `GET /audit/verify` | Checks the log's hash chain                                                                                        |

`action` takes a full name, such as `setting.changed`, or a prefix, such as `proposal`.

## Import items

`POST /imports` takes a YAML or JSON item file, up to 5,000 items. Nothing is ever published by an import: an import makes suggestions for owners to review.

- A dry run is the default, and changes nothing. Each entry gets the checks of the form.
- An entry with an `id` suggests a change to that item, and an entry equal to what is live proposes nothing.
- To apply, send `Idempotency-Key`. It makes suggestions only when no entry has an error and there are at most 500 to make.
- `submit: false` keeps them as drafts.

The [templates](templates) have an item file and a test question file to start from.

## Export an edition

`GET /editions/{label}/export` gives the edition as one document, for owners and admins: every served item with its digest, the vocabulary, the domains, and the digest it was sealed with.

An item the reader may not see is listed by id and digest only, so the edition's digest still checks. `footnote verify` recomputes every digest offline. An export reads back as an import.

## Read the item format

`GET /schema/item` publishes the JSON Schema of the item format. It needs no sign-in.

## The footnote command

`footnote` talks to the service and signs in as a person from the dev people file, so it works with the dev or demo sign-in and not with company sign-in.

```sh
npm run footnote -- validate lessons.yaml                                     # no service needed
npm run footnote -- import lessons.yaml --as per_maria@example.test           # dry run
npm run footnote -- import lessons.yaml --apply --as per_maria@example.test   # suggestions, for review
npm run footnote -- draft item.yaml --as per_maria@example.test               # one draft
npm run footnote -- import-tests questions.yaml --as per_maria@example.test   # test questions, dry run
npm run footnote -- export --out edition.json --as per_maria@example.test     # the live edition
npm run footnote -- verify edition.json                                       # recompute the digests
npm run footnote -- audit --format csv --as per_ravi@example.test
```

| Option     | Setting           | Default                                                         |
| ---------- | ----------------- | --------------------------------------------------------------- |
| `--as`     | `FOOTNOTE_EMAIL`  | None                                                            |
| `--url`    | `FOOTNOTE_URL`    | `http://127.0.0.1:3000`                                         |
| `--origin` | `FOOTNOTE_ORIGIN` | The first of `FOOTNOTE_WEB_ORIGINS`, else the service's default |

`--json` prints the result as JSON, for scripts and coding agents. The exit status is 0 when done, 1 when the file has problems or the service refused, and 2 for wrong usage.

`footnote prove` is the one command that runs the service's own code on its database (`DATABASE_URL`) and model keys, rather than calling the service. It asks the same questions three ways and prints a table, as [Run the proof](prove.md) explains:

```sh
npm run footnote -- prove --questions my-questions.yaml                  # the scripted model, free
npm run footnote -- prove --questions my-questions.yaml --real --cap 5   # a real agent, after a yes
```
