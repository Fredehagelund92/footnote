---
title: Set up your workspace
line: The four steps from an empty workspace to a first checked answer, and the page for each step.
group: Start
order: 2
minutes: 5
reviewed: 2026-11-26
open:
  label: Open the Inbox
  href: /inbox
does:
  publish-the-names: publish_names
---

Here you write down what your numbers mean, so AI tools stop guessing. Your Inbox shows the four steps until you have done them, under Set up your workspace so agents can use what you know.

The steps run in the order it happens later: you ask, nothing is written yet, you write what you know, and the same question is answered from it.

## The four steps

<!-- include setup-steps -->

1. **Publish your names**. Connect where your metrics are defined, then publish their names. Questions and context name them.
2. **Ask about a number you know**. Pick one you can explain. Nothing is written yet, and the answer will say so.
3. **Write what you know, and ask again**. Two sentences and where it is written. The same question is then answered from it.
4. **Ask your own agent**. Paste one prompt into Claude, Cursor or another agent, and ask it the same question.

<!-- /include -->

![The setup checklist in the Inbox: Set up your workspace so agents can use what you know, 0 of 4 done. Publish your names says the names go under Sales, with its button Publish 5 names; the other three steps have Ask, Write context and Copy the prompt. The foot links to About our business.](../images/docs/setup-light.webp)

## The page for each step

1. Publish your names: [Integrations](integrations.md#connect-a-source), then [publish the names](#publish-the-names).
2. Ask about a number you know: [Answer lines](answer-lines.md).
3. Write what you know, and ask again: [Write context](write-context.md), then [your first answer](#your-first-answer).
4. Ask your own agent: [Connect an agent](connect-an-agent.md).

Later, say what the business is about in [About our business](write-context.md#about-our-business): the card's foot links to it until it is written. More domains are made in [Domains and owners](domains-and-owners.md#add-a-domain).

## Publish the names

Each time your definitions are read, a name is made for every metric and dimension that has none yet. They wait on one card in the Inbox, and nothing is published until you publish it.

On a new workspace there is no domain yet. A domain is a part of the business with an owner, such as Sales. When names have no domain, the card's **Domain** field says where they go, filled in: the domain your tool names, or one named for the view most of them are in. Change it if you like. Published, they go under it, a new domain is made with them and owned by you, and their views are mapped to it, so the names read later go there too. Left empty, they stay shared.

![The card 5 new metrics and dimensions from dbt. Under Look at these first is Publish these as suggested, then Basket value, Total and Total (refunds), each with a name to keep or change, Publish and Leave out. Under Ready to publish is Completed orders, and at the foot Publish all.](../images/docs/names-light.webp)

- **Publish all** makes the ready names live at once, so context can apply to them and agents can use them.
- **Look at these first** holds a name that would give a word a second meaning, such as two metrics both called Revenue. Keep it, change it, or leave it out. Nothing is picked for you.
- A family is one name for many near-identical metrics, such as a metric for each currency. Publish it, and its variants are published with it. When families wait, the card has two parts: Families, counted by how each was found, and Names. Metrics whose names alone look alike wait under Look alike, to publish as one family or apart. See [Variants](metric-variants.md#if-you-keep-a-metric-for-each-variant).
- **Publish these as suggested** publishes, at one press, the names there only because another definition has the same name, each with the name shown, which tells it apart. A project that keeps one dimension, such as Region, in many semantic models has a copy for each.
- **Left out** holds dates and ids, which a context item's dates and Applies to already cover, and what you left out. While the card is open you can still publish any of them. Dates and ids alone never raise the card.

## Your first answer

Ask about a number you know before you write anything. The answer says Not found: nothing applies to that question yet, and it says whose it is to write. That is the honest answer, not an error, and agents hear the same.

Then write what you know, and ask again. Once your first item is published, the step's button is Ask again: it writes the question for you, with the item's dates when they do not cover today, so a question about a day that has passed still finds your item. The answer starts with an answer line, such as Checked, and cites your context item.

> **Why names come first.** A question and a context item name what they are about, and they can only name what is in Definitions. That is why the names come before you ask or write.
