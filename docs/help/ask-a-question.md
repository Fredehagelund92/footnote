---
title: Ask a question
line: Ask about a number, read how the answer was made, ask again at other dates, and tell the owner what is missing.
group: Ask
order: 1
minutes: 8
reviewed: 2026-11-25
open:
  label: Open Ask
  href: /ask
---

Ask answers a question about a number from the context your owners wrote and checked, and every answer starts with a line that says how much of it is written down. It reads published context with the same engine your agents use, and never more than you may see.

Ask knows the names of the metrics, dimensions and domains you can see in Definitions. So when you name a metric another way, or in another language, it reads that metric by its own name.

![An answer in Ask, marked Checked. Under the question, Read as shows Units sold, Norway and Today, assumed. Under the answer, Used 1 item says it was published and checked on 2 July 2026, followed by the definition of Units sold.](../images/docs/ask-answer-light.webp)

## Ask

1. Open **Ask**.
2. Type your question in the box, the way you would ask a colleague: "Why did orders in Norway drop in August?". Enter sends it, and Shift and Enter start a new line.
3. To point the question at something, type @ and pick a domain, a definition, a context item or a market.

Before your first question, the page can show what agents asked about this week, as counts only, never the words, with the answer each would get now.

With no AI model connected, Ask still answers: it lists what your team wrote and an owner checked.

## Read the answer

The answer starts with its [answer line](answer-lines.md): Checked, Partial, Not found, Conflict, Outdated or Not looked up. Press it to see what the line means and what you do next.

- **Read as**, under your question, shows what Ask read it as: the metric, the market and the dates. When the question named no dates, they read Today · assumed. **Change** puts the question back in the box, to change before you ask again.
- A number after a sentence is the context item it comes from. Point at it to see who checked it and when, and open it from there.
- Under the answer, its sources show by title, the first three and a count for the rest. Point at one to see which sentences it backs, and press it to open it. An item that is archived, may be out of date or is due for a check shows on its own line under them, so you never miss it.
- When you ask what something is, the answer is its definition card: the words of the tool that defines it, who owns it, and the context items about it, which open in the card. With none yet about a metric, its owners and admins get Write context, which starts an item about it. In other answers a definition shows as a quote, with the tool that defines it.
- When Ask stops at its time or step limit, the answer says Stopped and shows what is written, as agents get it. Ask again tries once more. When Ask read a metric or a market in your question, Search for these words opens Search on them.

### Numbers

Your workspace keeps no business figures, so Ask never shows one. An answer to a question about a number says what is written about it, and the number itself is in the tool that holds your data.

## Ask again at other dates

Press the dates in Read as. Choose Today, Any date, Last month, Last quarter or Last year, or Pick dates for days of your own. Ask asks the same question again at those dates, as a new answer under the last one, which keeps its own dates.

The new answer's Read as names the period with its days, such as last month with its first and last day, and its first sentence names it too. An answer about what a metric means has no dates to choose: dates do not change what it means.

## Ask a follow-up

Ask the next question in the same chat, such as "And in Spain?". Ask carries what your last question was about, and Read with shows what it carried. Drop them puts the question back in the box with what was carried in it, so you can take out what you do not mean. A question you point at something with @ does not carry anything.

**New chat** starts again with nothing carried.

## Ask how it works

Ask also answers questions about how it works, such as "What does Checked mean on an answer?" or "How do I add a context item?". It answers from these help pages and links the part of the page it used under the answer, such as Write context for "How do I add a context item?".

Such an answer has no answer line, since it rests on the help and not on your context.

When the answer says how to do something, a button under it opens that screen, such as Write context or Invite people. If the screen is not yours to use, the answer says who does it, and has no button.

## When nothing is written

A Not found answer means nothing is written about it yet, and a card under it says what is missing. If you do not own that domain, Tell the owner sends the owners what you asked about and the dates, never your words. It waits in their Inbox, where they can write it: [When nothing is written yet](when-nothing-is-written-yet.md).

When Ask finds no metric or context item that uses a word at all, Tell an admin sends the admins that word alone, never your question. If you are an admin or own a domain, Add the word to Definitions opens a new term with the word already in it.

### Not published yet

When nothing published covers your question, Ask also looks in your own drafts and in the suggestions waiting for review that you may open. A draft is yours alone. A suggestion waiting for review is open to the person who sent it, the owners of its domain and admins.

What it finds shows in a block of its own under the answer, Not published yet, in place of the card: each item with its state, its domain, who wrote it and the day.

None of it is part of the answer. It is not final, it is never a source, and agents don't get it until an owner publishes it. Under the items, one sentence may say what they would mean if published as written.

Open the draft opens your draft, and Review opens a suggestion that waits for you to decide. Anyone who may not open them sees no block at all, and a shared chat leaves it out.

## When an answer is wrong

Under each answer, Good answer and Bad answer say how it went. When the answer cites a context item, Bad answer also opens Something wrong? beside the answer, or under it when Ask is itself in the right panel, and so does More.

Say which part is wrong and what is wrong, and add a link if you have one. The owners see it in their Inbox as a report: [Keep context up to date](keep-context-up-to-date.md).

Suggest the right words starts from the item's own words, for you to change. They wait as a suggestion on the item, and agents keep the item as it is until an owner publishes it. If you own the item, or you are an admin, Edit opens it, so you can change it yourself.

## Save a question

The owners of a domain and admins can save a question, so it is answered again after every change. Press More under the answer, then Save question. Quality, in Observability, shows when a saved question's answer changes: [See what agents asked](see-what-agents-asked.md).

## Your chats

**History** lists your chats, newest first, with a search. Each new chat is a row of its own, even when it asks a question you asked before. Only you see them. They are kept in this browser and go when you sign out: [Privacy](privacy.md).

## Share a chat

1. Open the chat, and press Share chat at the top of Ask.
2. The panel beside it makes the link. Press Copy link, and paste it where you like.

The link keeps a copy of the whole chat as it is now, under your name: each question, what Ask read, the answer line, the words and the sources. An answer that rests on a draft is left out, and no figure is kept. Later answers are not added, so share the chat again for a new link.

Only people signed in to your workspace can open it. Each source opens as it is today, and only for people who may read it. Where someone may not read a source, they see only the question and its answer line, not the words or what Ask read.

A link lasts 90 days. In History, a shared chat says until when. Press Stop sharing there, and the link opens nothing. A link whose chat is no longer in this browser is listed under Shared links. An admin can turn sharing off for everyone.
