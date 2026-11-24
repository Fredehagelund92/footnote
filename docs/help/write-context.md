---
title: Write context
line: How to add a context item, what it is, what to put in it, its source and its check date.
group: Write and review
order: 1
minutes: 5
reviewed: 2026-11-23
open:
  label: Write context
  href: /context/new
does:
  add-a-context-item: write_context
  about-our-business: about_business
---

How to add a context item, what to put in it, and the line that stops an agent from reading a cause into it.

## Add a context item

To create one, open **Context** and choose **Write context**. The editor opens on a new item, with its first question: What should agents know?

When Ask finds nothing written about a question, an owner of its domain, or an admin, can choose Write context under the answer. The same editor opens, with what the question was about filled in.

## What a context item is

<!-- include word: Context item -->

One thing agents should know about the numbers: an event, a warning, a rule or a guide. It has a source and a check date.

<!-- /include -->

## The four kinds

<!-- include kinds -->

- **Event**: Something that happened on a date, like a stop or a new rule.
- **Warning**: A limit or problem agents should know, like late or missing data.
- **Rule**: A fixed way to read the numbers, like a house rule.
- **Guide**: What to check before you explain a change.

<!-- /include -->

A new context item starts as an Event. Pick another kind under Kind when it is one.

## What to put in it

![The editor for a new context item, What should agents know?, with its properties: Domain Sales, Kind Event, Status Not published yet and the owners, then Applies to, When, Source and Don't conclude, and the text below them.](../images/docs/editor-light.webp)

1. A title that is one plain sentence, with its date.
2. What agents should know: two or three sentences, with what it is not if people mix it up.
3. Where and when it applies: the metrics and markets, and the dates.
4. A source anyone can open. The check date is set for you.
5. Don't conclude: the one line that stops an agent from reading a cause into it.

In a domain you own, it is published at once. In another domain it goes to that domain's owners as a suggestion: [Review a suggestion](review-a-suggestion.md) is what they do with it. Applies to names only what [Definitions](definitions-and-synonyms.md) lists.

## Waiting for review

A new item you send is Waiting for review until an owner decides. Context lists it with the chip Waiting, who sent it, how long ago and who decides. Only you, the owners of its domain and admins see it, and agents don't get it yet. Filter by Waiting for review to see them all.

While it waits, you can withdraw it from its page. If an owner closes it, your Inbox says Closed by them, with their reason.

## An example

The demo's item about the stop in Norway, owned by Sales, has every part. Here its dates leave out the year.

![The context item Online sales to Norway stopped on 4 August 2026, as its page shows it: its text, the line it quotes from the customs notice, its domain, owners and when it was last checked, its source, and beside it what it links to and its history.](../images/docs/item-light.webp)

| Part                    | In the example                                                                                                                                                              |
| ----------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Kind                    | Event                                                                                                                                                                       |
| Title                   | Online sales to Norway stopped on 4 August                                                                                                                                  |
| What agents should know | A new customs rule stopped all online sales to Norway, so orders there fell to almost nothing. There are no stores in Norway, so the webshop was the only way to buy there. |
| Applies to              | Orders, Units sold and Gross sales, in Norway                                                                                                                               |
| When                    | From 4 August, still going on                                                                                                                                               |
| Source                  | A link to the customs notice, and the line copied from it, which says parcels from webshops outside Norway are held at the border                                           |
| Check date              | Set for you. Once it passes, the item is Due for a check.                                                                                                                   |
| Don't conclude          | Fewer orders in Norway after 4 August do not mean fewer customers.                                                                                                          |

The same news, written weakly:

| Part                    | In the weak item              | What is missing                                                       |
| ----------------------- | ----------------------------- | --------------------------------------------------------------------- |
| Title                   | Norway is down                | What is down, what happened, and when                                 |
| What agents should know | Sales in Norway dropped a lot | The cause, and how to compare the weeks before and after it           |
| Applies to              | Nothing                       | The metrics and the market, so agents know which questions it answers |
| Source                  | Nothing                       | A link anyone can open, so an owner can check it                      |
| Don't conclude          | Nothing                       | The line that stops an agent from blaming the drop on customers       |

## Publish many drafts at once

In **Context**, filter by Draft and tick the drafts you have read, or tick them all. Publish, on the bar that appears, publishes them at once in a domain you own, or in any domain for an admin. Each goes through the same checks as in the editor. A draft that is missing something, such as a source, stays ticked and says what.

More than five asks once first, because agents get them from the next question. Up to 50 go at a time, and Undo makes them drafts again. Your own draft for a domain you don't own goes to its owners as a suggestion, so the button says Suggest.

## About our business

One or two sentences on what the company does: what you sell, to whom, where and through which channels. Ask reads it with every question, and an agent when it connects, as background, never as a source. An agent connected now gets a change when it next connects. An admin writes it in **Settings**, then **General**, under About our business, in up to 500 characters.

The words people use and what they mean go in Definitions, as terms with an owner, not here: Ask and agents get a term with each question that uses its word. Under the text, a line that defines a word Definitions already has says so. Figures, deals, dates and what happened in a market are context items.
