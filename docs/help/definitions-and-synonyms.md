---
title: Definitions and synonyms
line: Metrics and terms, other names for them, and why some are read-only.
group: Write and review
order: 6
minutes: 5
reviewed: 2026-11-22
open:
  label: Open Definitions
  href: /definitions
does:
  families: [pick_usual_variant, family_meaning]
  terms-and-synonyms: add_definition
---

Metrics and dimensions, the business's own terms, and other names for them.

## Metrics and dimensions

Open **Definitions** to see every metric, dimension and term your workspace knows.

They come from where your metrics are defined, and are read-only here: their meaning and other names belong to that source. Write context about them instead.

A line under the toolbar says which tool they come from and links to it in Integrations. When the tool has figures switched on, an info button at the end of the line names the data contact who hears about a figure that looks wrong.

A read makes a name for each new one, and it reaches Definitions once its owner publishes it on the Names card in the Inbox. An admin publishes a name that belongs to no domain. See [Set up your workspace](set-up-your-workspace.md#publish-the-names).

## What a metric is built from

A metric's page says what it is built from, as its source's structure says it, under its description:

- Built from: the metrics it takes, such as a ratio's two, each a link to its page, and the columns its calculation reads, by name.
- Used by: the metrics built from it.
- Converted from and Converted to: a metric in another currency, worked out from the other with one more column, such as `exchange_rate_usd`.

These come from the source at each read and are never edited here. They never show the calculation, and never mark context as due for a check. An input the source no longer has says so.

## Families

A family is one entry for many near-identical metrics, such as a metric for each currency and channel. Its row is as tall as a metric's, marked by a stack of tiles in place of a metric's tile. Point at the stack to see how many variants it has and what tells them apart, such as Family of 250 metrics, by Currency and Channel.

- Its variants are never rows of their own. A search for one finds its family, and says how many variants match. Its quick view then names the variant the search found.
- Its row and quick view lead with what the family means. A family no words speak for reads No meaning yet. The quick view shows the values its variants hold, such as EUR and USD, marks the base variant, and says which variant is converted from which.
- An owner of its domain, or an admin, can pick the usual variant, such as Revenue (EUR) web. Ask reads a question that names no currency or channel as that variant, and says so under the question. A question that names one is read as written.
- Its quick view counts the context about the family apart from the context about one variant alone.
- Its quick view and page say what the family means, and where those words come from, in this order:
  1. Words your tool writes for the family.
  2. Words an owner wrote for the family.
  3. The words most variants share, with each value shown as what it stands for, such as Currency, and a note on how a value is converted, such as (EUR × the row's rate), left out. A currency's name, such as euros, counts as its code. Words most variants hold within their own count too.
- A variant converted from another, or whose words say it is worked out from one at a rate, has no say. When only the variant the others are converted from is left, its words are the meaning.
- Words that still name one variant's value, such as in euros, are never the family's: it reads No meaning yet.
- An owner of its domain, or an admin, can choose Change: worked out from its variants, or written for the family. Written words can begin from what its variants say, each wording once. History keeps each choice. Variants whose own words say something else than the meaning are named, and agents read their words too. A family with no meaning names none.
- Its own page lists the variants, and narrows them by each value, such as Currency: EUR. It says how the family was found, such as declared in dbt, and which variant is converted from which.
- Context about the family applies to every variant. See [Variants: a dimension, not a metric each](metric-variants.md).

## Terms and synonyms

<!-- include word: Synonym -->

Another name for a metric or a dimension, such as GMV for Gross sales. Agents read it as that definition.

<!-- /include -->

- A term is a word with its own meaning, such as Peak season. An owner of its domain, or an admin, adds one with **New term** in Definitions.
- On a definition, type other names into Another name: a comma or Enter makes each one a tag.
- In a term's editor, Another name for points the word at a metric or a dimension.
- A word that already means something else says who has it, and is never saved twice. Case, spaces and accents don't make it another word: Salés is Sales.
- A word that looks like one in use, such as Sale beside Sales, only warns. Agents read them as two words, so you can still publish it.
- If a definitions tool later gives a word a second meaning, the word shows a conflict. Agents ask which one until it's settled.
