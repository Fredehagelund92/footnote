---
title: Agent tools
line: The seven tools an agent can call, what each takes and gives back, and how to read a reply.
group: Reference
order: 1
minutes: 16
reviewed: 2026-11-28
---

The seven tools an agent can call: first the short list, then what each one takes and gives back, for anyone building on them.

Three read published context. One sends a report to an owner after the person says yes. The last three write, read and send a draft of the person's own: writing and reading never send it, and the send waits for the person's yes, then for the owner, unless the owner lets that agent [publish without review](publish-without-review.md).

## The seven tools

<!-- include tools -->

### get_context

The context that applies to a question about a metric, with one sentence to relay.

- Takes: The question, or its metrics, dimension values and dates.
- Returns: The answer line, the context items that apply, and one sentence to relay.

### find_context

Find context items and definitions by words, or list them by kind or domain.

- Takes: A few words, a kind or a domain, all optional.
- Returns: Each context item's title and summary, never its text, and each definition's meaning, a page at a time.

### read_context

One context item or one definition in full, with its links.

- Takes: A context item, or a definition by its name.
- Returns: A context item's text, source, check date, Don't conclude line and what it links to and from; a definition's words, owner, family and the context items about it.

### report

Tell the owner something is missing, wrong or unclear.

- Takes: What is wrong, after the person says yes.
- Returns: That it was sent, and to which owner.

### write_draft

Write or change a draft of the person's own. It is never sent.

- Takes: The words and what they apply to, or the fields to change in a draft.
- Returns: The draft, its revision and its link, and each field the person changed since the agent read it.

### read_draft

Read a draft of the person's own as it is now, with what changed.

- Takes: The draft, and the revision the agent read last.
- Returns: Each field, who changed it last and when, and the draft's revision.

### send_draft

Send a draft of the person's own to the owner, after the person says yes.

- Takes: The draft, and the revision the person said yes to.
- Returns: That it waits in the owner's Inbox, or that it was published with the owner's permission to publish without review.

<!-- /include -->

> **Switching tools off.** Admins switch tools off for every agent in Agents and access, Tools and access keys, and for one agent in its Details: see [the tools each agent may call](connect-an-agent.md#the-tools-each-agent-may-call).

`get_context` is for a question about a metric, `find_context` for looking a name up or seeing what there is, and `read_context` for reading one in full. In Claude Code, `get_context` loads when a session starts, and the others load the first time the agent needs them.

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
      "not_to_conclude": "Fewer orders after 4 August do not mean fewer customers.",
      "url": "/context/itm_norway01"
    }
  ],
  "reply_id": "0f8fad5b-d9cb-469f-a165-70867728950e"
}
```

Pass on `say`, which starts with the [answer line](answer-lines.md). If the reply has `next`, follow it: it is the step for the agent. Keep `reply_id` to send a `report`.

| `status`           | Answer line   | What it means                                                                                                                          |
| ------------------ | ------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| `matched`          | Checked       | Context covers the question                                                                                                            |
| `partial`          | Partial       | No item covers all of it, a match is held back, every item was published without review, or a question with no dates was read at today |
| `no_match`         | Not found     | Nothing applies                                                                                                                        |
| `conflict`         | Conflict      | Two items that apply disagree                                                                                                          |
| `stale`            | Outdated      | An item's check date passed, or its source changed                                                                                     |
| `check_failed`     | Not looked up | The checks could not run                                                                                                               |
| `need_more_detail` | None          | The question could not be read, so nothing was looked up                                                                               |

### Other fields you may see

- `definitions`: on a question about what a metric means.
- `terms`: the words a person defined that the question uses, up to five. Read the words by them, and never give a term as a checked source.
- `options`: on a word with two meanings. Ask the person which they mean, using `say`, and pass the choice in `metrics`.
- `may_be_out_of_date` and `disagrees_with`: on an item, when they hold.
- `about`: on a reply about several metrics, the ones an item is about. Never give them as one figure.
- `published_without_review`: on an item, in place of its checked stamp, when an owner's permission published it and nobody read it. It names the role whose permission it was and the day. Say that nobody checked it.

Set `response_format` to `full` for each item's body, every source, owner and links, and for how the dates were read.

### Dates and size

Dates in `window` include both ends: `window.from` and `window.to`. A question with no dates is read at today.

The items come in one order, the one Ask reads too: first those whose title, summary or `not_to_conclude` line hold the question's own words (the words that name no metric, value or domain), a rarer word weighing more; then whole matches, higher risk and newer start.

`max_items` is 10 by default and 50 at most. When more apply, `next_cursor` passed back as `cursor` with the same question gives the next ones. `max_bytes` limits the whole result, 100,000 by default, with links cut before items, and the reply lists the items it cut. A cursor ends when what agents read changes, and on the next day: start again without a cursor.

A metric is read by its name, another name, another form or order of it, its initials (such as ROAS) or a word only its name holds (such as churn). `read_as` says which words were read so.

When the question names no metric, `unread` gives each word that could have named one, with the names that hold it. Ask the person which they meant, or search the word with `find_context`, and never read it as one of them yourself.

A question that names a value and no metric, such as "What happened in Norway in August 2026?", reads the items of every metric that apply to that value. `say` tells you each item may be about a different metric: answer for each apart, from `applies`.

A word where a value goes that names no value here, such as "Denmark" for a market, is read as every value, and `say` says so. It appears in `unread` with `value_of`, the dimensions it could be a value of, and `closest`, the values it is a typo away from.

Tell the person the answer is for every value, and call again with the name if they meant a close one. Sending dimension filters, even an empty list, does not switch this off.

## Search or list: find_context

With `query`, it searches names, titles, summaries and text, by the names people use, such as GMV. Without `query`, it lists what there is, for a request such as "show me ten of our metrics" or "what is written down about Sales". It is not for a question about the data, which `get_context` answers.

- Search gives back the matching context items under `context`, each with its title and summary, and the definitions the words name.
- A list gives back definitions first, each with a one-line meaning, then the published context items the agent may see, each with its title and summary.
- Neither gives an item's text: `read_context` does. Suggestions and drafts are never listed.

| Option   | What it does                                                                                             |
| -------- | -------------------------------------------------------------------------------------------------------- |
| `query`  | A few words. Leave it out to list                                                                        |
| `kind`   | `metric`, `dimension` or `term` for definitions; `event`, `warning`, `rule` or `guide` for context items |
| `domain` | One domain, by name                                                                                      |
| `window` | The dates of the items that apply, when no words match                                                   |
| `limit`  | How many on a page: 10 for a search and 25 for a list by default, 100 at most                            |
| `cursor` | The `next_cursor` of the page before                                                                     |

Both give back `total`, how many there are, and `next_cursor` for the next page, or null on the last. A list is in a fixed order: metrics, then dimensions, then terms, each A to Z, then context items A to Z by title. With a definition's `kind`, the words only narrow the names.

To pick a few at random, an agent reads a page of up to 100 and picks from it, or reads on with the next cursor. A cursor ends when what agents read changes, and on the next day: start again without a cursor.

## Read one: read_context

`read_context` reads one context item in full. It takes `id`, the item's id, and gives back its text, every source, who checked it, its links and the terms it uses:

- `links_out`: what the item links to, such as a metric it applies to or an item it mentions, each with how it links and whether it is still there.
- `links_in`: the items that link to it, 20 to a page with `next_cursor`: those that mention it, replace it or disagree with it.

`relations` keeps only some kinds of link, out and in. It takes any of these:

- `replaces` and `replaced_by`
- `conflicts_with`
- `applies_to` and `in_area`
- `mentions` and `mentioned_by`

To follow a link, the agent reads the linked item the same way. A link never changes what `get_context` delivers, and an item the agent may not see is left out.

## Read a definition: read_context

For "what does gross margin mean" or "how is ROAS defined", even when no context item is about it. Not for a question about the data, which `get_context` answers.

When `id` is no context item's id, `read_context` reads it as a definition: its name, another of its names, or its key from the search or a list, such as `metric:orders`. The reply's `definition` has:

- Its words whole, and where they come from: the source's own words, a family's meaning, or what a person wrote for a term. Only the first 500 characters of a source's words are kept, and `shortened` says when the source wrote more.
- Its kind, domain and other names, and its owner as a role and a team, never a person.
- The source tool, the definition's own name there, and the day it was last read.
- For a family, its metrics and the values that tell them apart, how it was found, what it means and where that comes from, and its usual metric.
- What it is built from and converted from, by name, never the calculation.
- How many published context items about it the agent may read, with their titles, 20 to a page.

Read from a version an agent is held to, a family comes back with only its metrics as that version has them: its words and values come from the live definitions, and the reply says so.

Words that name several definitions come back with their keys to choose from, and words that name none with the closest names. Only published definitions are read: never a draft, a suggestion or a name waiting in the Inbox.

## Send a report: report

It runs only after the person says yes. Use it when the person only knows an answer is missing, wrong or unclear, or that it helped; when the agent knows the correct wording, `write_draft` then `send_draft` (after the person says yes) proposes the fix and is the better path. `kind` says what the person reports:

- `missing`: the context has nothing on it.
- `wrong`: what the context says is wrong.
- `unclear`: the person could not tell what it means.
- `helped`: it did the job.

What else you send depends on what the report is about:

- About a `get_context` reply, send its `reply_id`.
- About one item, add `context_id`.
- Something missing with no reply takes `question`, and `metrics`, `dimension_filters` and `window` if you have them.

A `reply_id` that names no reply of the last 90 days is refused, also when a `context_id` is sent with it. A report about one item keeps the item, so the owner's Inbox card and Observability show which one.

Add a short note. It is checked for sensitive text, and the report never keeps who asked. The reply says that it was sent, and who sees it (`to`). A report about no single domain reaches no owner's Inbox: the reply says an admin sees it in Observability.

## Write a draft together: write_draft and read_draft

The person and their agent work on one draft: the person in the app, the agent with these tools. Only a person's own agent may call them. An access key or a dev token names no person, so it is refused.

Neither tool sends anything. The person sends the draft for review in the app, or says yes and the agent calls `send_draft`. When the agent knows the correct wording for something missing or wrong, this proposes the fix; when the person only knows an answer is wrong, the agent uses `report`.

`write_draft` takes one of three shapes:

- Without `draft_id`, it starts a new draft from `text`, at most 2,000 characters, with optional hints: a title, a kind and an area.
- With `item_id` instead, the new draft changes that published item rather than starting a new one.
- With `draft_id` and `revision`, it changes only the fields you pass: the title, summary, text, kind, area, scope, window, evidence and Don't conclude line.

Each source in `evidence` is one of:

- A `url` and a `quote` copied from that page.
- For what is written nowhere a link opens, `said_by`: one line that says who or what says so.

Every tool that gives a source back gives one with no link as `url: null` with that line in `said_by`, and says there is nothing to open.

An area counts only when the metrics it names give no single domain.

| `status`             | What happened                                                                                  |
| -------------------- | ---------------------------------------------------------------------------------------------- |
| `draft_saved`        | A new draft was saved. It is not sent                                                          |
| `draft_changed`      | The fields in `applied` changed                                                                |
| `conflict`           | Nothing changed: the person changed each field since the revision you read                     |
| `no_change`          | Every field was already as you passed it                                                       |
| `needs_area`         | The words do not point to one domain. Ask the person which, and pass `area`                    |
| `possible_duplicate` | Published items look alike. Ask the person, then call again with `item_id` or `new_item: true` |

To write context from a document, the agent saves each item as its own draft and sends none. The person reviews them in Your drafts, in the Inbox, and publishes them together.

One person's agents can save 50 new drafts in 24 hours, with 50 waiting unsent. Admins change this with `limits.agent_drafts`. Each new draft's reply says how many wait, and the limits, in `drafts`:

| Field                  | What it holds                                                  |
| ---------------------- | -------------------------------------------------------------- |
| `waiting`              | The person's agent drafts not sent or deleted, the new one too |
| `most_waiting`         | The most that may wait                                         |
| `new_in_24_hours`      | New drafts in the last 24 hours, deleted ones too              |
| `most_new_in_24_hours` | The most new drafts in 24 hours                                |

Past either limit nothing is saved, and the refusal says the limits.

`read_draft` takes `draft_id`, and the revision you read last as `since_revision`. It gives back:

- the draft's revision, and each field as it is now, with who changed it last, the person or an agent, when, and its mark;
- `changed_since`, what changed after your revision;
- `blocking`, what stops it being sent.

The agent sees the person's edits only when it reads the draft, which is when the person writes to it: nothing can tell it that a draft changed. The other way round is quicker: a draft open in the app saves as the person types, and shows the agent's change within a few seconds, with Undo, never over a field the person is writing in.

So a write names the revision the agent read. A field the person changed since then keeps their words, and comes back in `conflicts` with its value now; the other fields change.

- Every write is checked as a new draft is. Text that looks like personal data or a secret is refused, and so are words that read like orders to an AI agent. Nothing changes.
- A draft that was sent can't be changed. Withdraw it first.
- A field the person changes is marked confirmed, so the owner sees a person read it. A field only the agent wrote stays prefilled.
- The person's agents can change one draft 60 times an hour. A new draft counts toward `limits.agent_drafts`; a change does not.
- `read_draft` reads only the person's own drafts and their suggestions still waiting. The words are the person's, never a source for an answer: the other read tools and Ask read only published context.

### The write_context prompt

An agent that may call `write_draft` is also offered one prompt, `write_context`, which starts a draft with the person. In Claude Code it is the command /footnote:write_context. It takes `topic`, what the item is about, such as a metric, a market and dates; without one, the agent asks what happened. It gives back the same words as the app's Write with Claude button: [Write with your agent](write-with-your-agent.md).

## Send a draft: send_draft

It runs only after the person says yes, and only a person's own agent may call it. It takes `draft_id` and `revision`, the revision the person saw, and no words: it sends exactly that revision, as the person's own Send for review would. It gives back one of these statuses, with a link:

| `status`    | What happened                                                                                                         |
| ----------- | --------------------------------------------------------------------------------------------------------------------- |
| `sent`      | It waits in the owner's Inbox. `policy.waits_because` says why, if a permission to publish is on                      |
| `published` | An owner's permission to publish without review covered it, so it went live                                           |
| `kept`      | The review checks refused it. `blocking` says why, with a link to the draft                                           |
| `changed`   | Nothing was sent: the draft changed after the revision given. `changed_since` lists the fields. Read it and ask again |

- At connect, the instructions name each domain where the agent may publish without review, as far as they have room. The reply is the source of truth if a permission was set or ended since.
- A permission covers only a draft its own agent wrote. A draft the person started in the app, or another agent wrote, waits for review.
- A draft that was sent already is refused, and nothing is sent twice.
- `send_draft` has its own switch, apart from `write_draft` and `read_draft`: an admin can let agents write drafts and keep them from sending.
