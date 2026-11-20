---
title: Agent tools
line: The six tools an agent can call, what each takes and gives back, and how to read a reply.
group: Reference
order: 1
minutes: 6
reviewed: 2026-11-20
---

The six tools an agent can call: first the short list, then what each one takes and gives back, for anyone building on them. All read, apart from the two that send something to an owner after the person says yes. A suggestion waits for the owner, unless the owner lets that agent [publish without review](publish-without-review.md).

## The six tools

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

One context item in full.

- Takes: A context item.
- Returns: Its text, source, check date and don't conclude line.

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
