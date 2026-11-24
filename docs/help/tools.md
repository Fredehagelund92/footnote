---
title: Agent tools
line: The eight tools an agent can call, what each takes and gives back, and how to read a reply.
group: Reference
order: 1
minutes: 10
reviewed: 2026-11-23
---

The eight tools an agent can call: first the short list, then what each one takes and gives back, for anyone building on them. All read, apart from the two that send something to an owner after the person says yes. A suggestion waits for the owner, unless the owner lets that agent [publish without review](publish-without-review.md).

## The eight tools

<!-- include tools -->

### get_context

The context that applies to a question, with one sentence to relay.

- Takes: The question, or a metric, markets and dates.
- Returns: The answer line, the context items that apply, and one sentence to relay.

### find_context

A word search over names, titles and summaries.

- Takes: A few words.
- Returns: Matching context items and definitions, titles only.

### read_context

One context item or one definition in full.

- Takes: A context item, or a definition by its name.
- Returns: A context item's text, source, check date and don't conclude line; a definition's words, owner, family and the context items about it.

### report

Tell the owner something is missing, wrong or unclear.

- Takes: What is wrong, after the person says yes.
- Returns: That it was sent, and to which owner.

### suggest_context

Send a suggestion to the owner, after the person says yes.

- Takes: The suggested text and what it applies to.
- Returns: That it waits in the owner's Inbox, or that it was published with the owner's permission to publish without review.

### get_related

Follow a link between context items, definitions and domains, one step at a time.

- Takes: A context item, a definition or a domain.
- Returns: What it links to and is linked from, without changing what an answer includes.

### list_definitions

The metrics, dimensions and terms in Definitions, a page at a time.

- Takes: A domain, a kind or a word, all optional.
- Returns: Each name with its kind, domain, owner and a one-line meaning.

### list_context

The published context items, a page at a time.

- Takes: A domain, a kind or a word, all optional.
- Returns: Each context item's title, kind, domain and dates, never its text.

<!-- /include -->

> **Switching tools off.** Admins switch tools off for every agent in Agents and access, Tools and access keys, where following links has its own switch, and for one agent in its Details: see [the tools each agent may call](connect-an-agent.md#the-tools-each-agent-may-call).

## Ask about a question: get_context

- Takes: `question`, and `metrics`, `dimension_filters` and `window` if you have them.
- Gives back: `status`, `say`, `context` and `reply_id`.

A short reply looks like this, cut down here to the main fields:

```json title="A get_context reply, cut down"
{
  "status": "matched",
  "say": "Checked. 1 context item applies to Orders in Norway in August 2026. Nothing else was looked up.",
  "asked": "Orders in Norway in August 2026",
  "context": [
    {
      "id": "itm_norway01",
      "title": "Norway closure",
      "summary": "Online sales stopped on 4 August.",
      "kind": "event",
      "applies": "Orders in Norway.",
      "not_to_conclude": "cause not proven",
      "url": "/context/itm_norway01"
    }
  ],
  "reply_id": "0f8fad5b-d9cb-469f-a165-70867728950e"
}
```

Pass on `say`, which starts with the [answer line](answer-lines.md). If the reply has `next`, follow it: it is the step for the agent. Keep `reply_id` to send a `report`.

| `status`           | Answer line   | What it means                                                           |
| ------------------ | ------------- | ----------------------------------------------------------------------- |
| `matched`          | Checked       | Context covers the question                                             |
| `partial`          | Partial       | No item covers all of it, or a question with no dates was read at today |
| `no_match`         | Not found     | Nothing applies                                                         |
| `conflict`         | Conflict      | Two items that apply disagree                                           |
| `stale`            | Outdated      | An item's check date passed, or its source changed                      |
| `check_failed`     | Not looked up | The checks could not run                                                |
| `need_more_detail` | None          | The question could not be read, so nothing was looked up                |

### Other fields you may see

- `definitions`: on a question about what a metric means.
- `terms`: the words a person defined that the question uses, up to five. Read the words by them, and never give a term as a checked source.
- `options`: on a word with two meanings. Ask the person which they mean, using `say`, and pass the choice in `metrics`.
- `may_be_out_of_date` and `disagrees_with`: on an item, when they hold.
- `about`: on a reply about several metrics, the ones an item is about. Never give them as one figure.

Set `response_format` to `full` for each item's body, every source, owner and links, and for how the dates were read.

### Dates and size

Dates in `window` include both ends: `window.from` and `window.to`. A question with no dates is read at today.

`max_items` is 20 by default and 50 at most. `max_bytes` limits the whole result, 100,000 by default, with links cut before items, and the reply lists the items it cut. Search and link cursors end when what agents read changes.

## Search and read: find_context and read_context

`find_context` searches names, titles, summaries and text.

- Takes: `query`.
- Narrows the search, if you want: `domain`, `kind`, `window` and `limit`.
- Gives back: titles and summaries under `context`, and definitions.

`read_context` reads one context item in full. It takes `id`, the item's id, and gives back its text, every source, who checked it and its links.

## Read a definition: read_context

For "what does gross margin mean" or "how is ROAS defined", even when no context item is about it. Not for a question about the data, which `get_context` answers.

When `id` is no context item's id, `read_context` reads it as a definition: its name, another of its names, or its key from the search or a list, such as `metric:orders`. The reply's `definition` has:

- Its words whole, and where they come from: the source's own words, a family's meaning, or what a person wrote for a term. Only the first 500 characters of a source's words are kept, and `shortened` says when the source wrote more.
- Its kind, domain and other names, and its owner as a role and a team, never a person.
- The source tool, the definition's own name there, and the day it was last read.
- For a family, its metrics and the values that tell them apart, how it was found, what it means and where that comes from, and its usual metric.
- What it is built from and converted from, by name, never the calculation.
- How many published context items about it the agent may read, with their titles, 20 to a page.

Read from a version an agent is held to, a family comes back with only its metrics as that version has them: its words and values come from the live definitions, and the reply says so. Words that name several definitions come back with their keys to choose from, and words that name none with the closest names. Only published definitions are read: never a draft, a suggestion or a name waiting in the Inbox.

## List what there is: list_definitions and list_context

For a request such as "show me ten of our metrics" or "what is written down about Sales". Not for a question about the data, which `get_context` answers, nor a search by words, which `find_context` does.

`list_definitions` lists the metrics, dimensions and terms in Definitions. A family of metrics is one entry, with `family: true` and its number of metrics in `members`. Each entry has its name and key, its kind, its domain, its owner as a role and a team, never a person, a one-line meaning where it has one, and its page.

`list_context` lists the published context items the agent may see. Each has its title, kind, domain, what it applies to, when, who checked it and when, and `may_be_out_of_date` when it is due for a check. It never gives an item's text: `read_context` does. Suggestions and drafts are never listed.

| Option   | What it does                                                                                             |
| -------- | -------------------------------------------------------------------------------------------------------- |
| `kind`   | `metric`, `dimension` or `term` for definitions; `event`, `warning`, `rule` or `guide` for context items |
| `domain` | One domain, by name                                                                                      |
| `query`  | Only names, or titles, with these words                                                                  |
| `limit`  | How many on a page: 25 by default, 100 at most                                                           |
| `cursor` | The `next_cursor` of the page before                                                                     |

Both give back `total`, how many there are with these filters, and `next_cursor` for the next page, or null on the last. The order is fixed: metrics, then dimensions, then terms, each A to Z, and context items A to Z by title.

To pick a few at random, an agent reads a page of up to 100 and picks from it, or reads on with the next cursor. A cursor ends when what agents read changes, and for `list_context` on the next day: start again without a cursor.

## Send a report: report

It runs only after the person says yes. `kind` says what the person reports:

- `missing`: the context has nothing on it.
- `wrong`: what the context says is wrong.
- `unclear`: the person could not tell what it means.
- `helped`: it did the job.

What else you send depends on what the report is about:

- About a `get_context` reply, send its `reply_id`.
- About one item, add `context_id`.
- Something missing with no reply takes `question`, and `metrics`, `dimension_filters` and `window` if you have them.

Add a short note. It is checked for sensitive text, and the report never keeps who asked. The reply says that it was sent, and who sees it (`to`).

## Send a suggestion: suggest_context

It runs only after the person says yes, and only a person's own agent may call it. An access key or a dev token names no person, so it is refused.

It takes `text`, at most 2,000 characters, and hints such as `title`, `kind` and `area`. It gives back one of these statuses, with a link:

| `status`               | What happened                                                                                    |
| ---------------------- | ------------------------------------------------------------------------------------------------ |
| `suggestion_sent`      | It waits in the owner's Inbox. `policy.waits_because` says why, if a permission to publish is on |
| `suggestion_published` | An owner's permission to publish without review covered it, so it went live                      |
| `draft_saved`          | The review checks refused it. `blocking` says why, with a link to the draft                      |

- At connect, the instructions name each domain where the agent may publish without review, as far as they have room. The reply is the source of truth if a permission was set or ended since.
- `possible_duplicate` means live items look alike. Ask the person, then call again with `item_id` or `new_item: true`.
- `needs_area` means the words do not point to one domain. Ask the person which, and pass `area`.
- Text that looks like personal data or a secret is refused, and nothing is saved.
- One person's agents can save 10 drafts in 24 hours, with 20 waiting unsent. Admins change this with `limits.agent_drafts`.

An agent that can show forms asks up to four of its open questions there first. An agent that cannot gets a link and the list of questions.

## Follow links: get_related

- Takes: `id`, which is an item id, or one such as `metric:orders`, `term:<id>` or `area:finance`.
- Gives back: the neighbours with their titles and summaries, and `next_cursor`.

It gives each neighbour once, at its shortest distance, and never changes what `get_context` delivers.

| Option      | What it does                                                                                                          |
| ----------- | --------------------------------------------------------------------------------------------------------------------- |
| `depth`     | `2` follows two steps. The default is one                                                                             |
| `max_nodes` | How many on a page: 20 by default, 50 at most                                                                         |
| `relations` | The kinds to follow: `replaces`, `replaced_by`, `conflicts_with`, `applies_to`, `mentions`, `mentioned_by`, `in_area` |
| `window`    | The dates of neighbouring items                                                                                       |

By default it follows every kind but `in_area`. `links_withheld` counts neighbours the caller may not see.
