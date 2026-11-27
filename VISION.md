# Vision

Footnote exists so that an AI agent asked why a business number moved answers from what a person checked, or says plainly that nothing is written.
It is the companion to the analytics engine when people ask it questions.
The semantic layer defines a metric and returns the figure; Footnote holds what a definition cannot say.
That is context bound to a time and a place, such as a market closed for a month, a tool that changed how it counts, or data that arrived late.
Each item carries the dates and the place it applies to, and it is told only for a question about those dates and that place.
An item ends itself: a question after its end date does not get it, and past its check date it is told as possibly out of date until its owner checks it again.
When nothing fits, the answer says so in plain words, and no agent is handed a guess that sounds sure.
These three are the core, and every other part of Footnote serves them.
It serves data teams first: the analysts, analytics engineers and owners of definitions who are asked why a number moved and who keep most of this context today.
It is also for the people in finance, marketing, operations and management who know why the numbers move; they may suggest context in plain words, and bringing them in to write is the aim.
Agents can be built to add or suggest context too, within the rights they are given.
Owners check it and publish it as short context items, each with a source, an owner and its dates, that agents read over MCP before they answer.
It owns exactly one thing: checked context about what the numbers mean, never the numbers.

## Anyone may suggest, owners decide

The front door is the data team's own repository: item files kept beside its definitions, a pull request merged by the domain's owner as the owner's publish, and Footnote as the reader that serves what is on the main branch.
The web app, where people suggest and owners review, is the second way in, and when the two compete for work the repository path comes first.
Anyone who knows the business may suggest context, and so may an agent or a document sync.
An admin sets what each named agent may do: read, suggest, or nothing.
An owner may decide in advance that one named agent's low-risk new items in their own domain are published without a review round, and that the agent keeps the dates of its own items current, such as a Warning about late data that grows or ends.
Each such publish is still the owner's decision, under their name, with an undo.
Every other change to a live item, every retirement and every other suggestion waits for the domain's owner, and only a person publishes.
A sync from documents or definitions never publishes.
Work that makes review faster or clearer is welcome: what changes, whether it matches its source, what it clashes with, and what agents would say after.
Work that lets something reach agents without a person's yes, given then or in advance, is refused.

## Answers come from published, owned context

Answers, in Ask and to agents, draw their context only from published items that a domain's owner answers for, never from chats or documents searched at the moment of asking, and every answer names the items it used.
Any way of finding published items is welcome, search by meaning included, as long as each reader finds only the items they may read and the answer still names its sources; finding by name alone was a gap, not a value.
Nothing an edit says changes an answer, in Ask or to an agent, until a person with the right publishes it, however it was edited, alone or together, now or later, and Footnote does not learn on its own.
The words of a draft, a suggestion, a comment, a report or a saved question never reach an agent and never shape an answer.
A draft's words never reach an answer; the agent a person writes with may read back that person's own draft.
Ask may show, apart from the answer and under a clear Not published yet label, what waits for review that the asker may read, and the asker's own drafts.
When nothing is published but a suggestion waits, the answer stays Not found, and an agent is told only that a suggestion waits for that domain's owner, never what it says.
An agent may get a published item in the reader's language, as a machine translation marked as translated from the checked text.
Every answer starts with one of six fixed answer states, set by code from the items found, never by a model.
A model may write the words of an answer, and code checks each sentence against what was read before anyone sees it.
Footnote gives no advice of its own; it repeats only what an item says to check, and names the item.
A question that finds nothing goes back to the owner as a gap, so the missing context gets written.
An item is Due for a check when its check date passes, unless its owner marked it as a rule that does not age; such an item stays Checked until it is edited or a definition it relies on changes.
Context that does not age stays small: Footnote keeps only what a dated item needs to be read correctly.

## Meaning, not numbers

The semantic layer, such as Cube or dbt, defines the figures and returns them.
A definition says what a metric is; a context item says what happened to it, when and where.
The place is a value of a dimension, such as one market. A value is a name: Footnote keeps the ones context is written about, added by a person or an agent or listed with the definitions, and published by an owner.
Footnote reads definitions as a read-only copy and pushes nothing into any other tool, not even its own context; another tool may read published items the way an agent does.
Footnote reads no figure and keeps none, and Ask says so plainly when a question needs one.
It asks the data nothing: it holds no key that can read a row, and no source is read because someone asked.
Figures come only from the person's own agent, through its figures tool, and Footnote holds the context.
Footnote does not watch the numbers: spotting a move nobody explained is the work of the agent that holds the figures, at the moment someone asks it.
One agent call that returns a figure together with its context is welcome only once it proves to give agents better output than two separate reads.
Footnote does not enforce data access or replace the semantic layer's access rules.
When the source is modelled in a way that hurts answers, Footnote says so at Connect and in the docs, and leaves the fix to the source.

## Privacy is a product rule

From agents, Footnote keeps only what a question was about and how often, never its words and never who asked.
A count under five reads "Fewer than 5", and no total gives a hidden part away.
Words are kept only when a person sends them on purpose, under their name.
Footnote does not mine what people ask or tell their agents for new context, though that is the cheapest source of it; a person or their agent may send a suggestion on purpose, and a question that finds nothing comes back only as a gap.
Ask chats stay in the person's browser unless they share one as a link, and a draft is read only by its writer.
There is no tracking of people, no history of questions per person and no analytics per person, and Ask declines questions about one person's work.
Footnote sends nothing about how it is used unless an admin turns on usage counts for the project: off by default, fixed names and counts only, never words, names or company data.

## Plain words that are true

The readers know their business, often read English as a second language, and never need data or AI words.
One word means one thing, and the glossary and lint rules hold screens, docs and agent replies to it.
Every screen says only what is true today: no control that pretends, no number that counts something other than its label, no placeholder for what is not built.
Copy says what is kept, not that nobody can see.
Footnote claims no better answers than the same facts in a plain file, or than nothing, until a test on questions about a period and a market shows it.
The first release waits for that test, which runs with a cap on what it spends.

## One generic product, kept small

Footnote is open source and names no vendor in its core; that is how it is built and why a company can trust it, not what sets it apart.
A company runs it on its own machines, so its context and its questions stay inside apart from what it sends to the model it chose, any agent it uses can read the context, and no vendor's price or roadmap decides what happens to it.
For now it is fully self-hosted: the project runs no hosted service, only a public demo in read-only mode.
No change is justified by one company's setup alone, and no company's names, metrics or examples enter the repository.
The demo uses an invented company and invented people on scripted models; a live model is optional and spends money only when a person turned it on.
A tool's name comes from the connector that reads it, and the docs stay host-neutral.
The most welcome outside contribution is a connector that follows the connector contract, for definitions or for dated notes a team already keeps, such as events marked on charts; what it brings in arrives as suggestions.
A direction that stops earning its place is deleted, not kept beside its replacement.

## Scope

Footnote is not a BI tool, a monitoring tool, a semantic layer, a warehouse, a store of figures or a store of standing rules.
People's own agents, which hold the figures, are the everyday place for numbers and analysis, and they include the agents inside the tools a company already pays for; Ask is where people read the checked context and where stewards look after it.
It is not a wiki: no page tree and no company directory.
It is not a notification service: the Inbox is the only announcement, with no email or chat digest.

A change aligns when it helps a person or an agent add or suggest context bound to a time and a place within their rights, helps an owner check it or keep it true, helps any agent read only checked context with its source and dates, makes the repository path easier, or says more honestly what is and is not known.
A change should be resisted when it lets unpublished words into an answer or to an agent, stores or watches figures, reads data, keeps question words, tracks a person, pushes anything into another tool, announces outside the Inbox, turns Footnote into a hosted service, grows content that does not age, or keeps an old path alive beside its replacement.
