---
title: 'Variants: a dimension, not a metric each'
line: Why one metric with currency as a dimension works better than a metric for each currency.
group: Set up
order: 4
minutes: 3
reviewed: 2026-11-20
---

Some models keep a metric for each currency or sales channel, such as Revenue (EUR) web and Revenue (USD) app. Model them as one metric, Revenue, with currency and channel as dimensions. Agents then find what your team wrote about revenue, whatever the currency.

## Why one metric works better

- Agents read a question by the names in it. "Revenue in EUR" and "Why did revenue drop last week?" both name Revenue. With a metric for each variant, no metric is called Revenue: the question names nothing, and the agent is asked to name one.
- A context item about revenue applies to one metric, not to hundreds.
- A change to how revenue is worked out changes one definition. The context about it is due for a check once, not once for each variant.
- [Definitions](definitions-and-synonyms.md) stays a list people can read.

## What Test connection says

When many of the metrics a read would hold look like variants of a few, Test connection in [Integrations](integrations.md) says so before anything is published. It says how many, how many metrics they look like, and the words they are split by, such as eur, usd and gbp.

It reads only the names, so now and then it is wrong. It only warns: you can still go on.

## How to model them

Keep one metric for each amount, and make what varies a dimension:

- Currency: a dimension of the orders, such as their currency code. A question about one currency filters by it.
- A sales channel, a region or a market: a dimension in the same way.
- A tool that lets one metric follow a choice, such as which currency to show, keeps one metric for every currency too.

## Totals across currencies

A sum over several currencies needs one reporting currency. Keep the amount in the reporting currency as a metric of its own, or let the choice of currency convert it.

## If you keep a metric for each variant

A read groups the variants of one calculation into a family, such as Revenue, with 250 variants by Currency and Channel. It finds a family from how each metric is worked out: the same calculation, with filters that differ only by the value they compare, such as EUR or web.

Metrics whose names are one name in other currencies are a family too, however they are worked out. Accrued share (EUR) and an Accrued share (USD) worked out from it with each row's rate are one family, by Currency. When the source describes how one comes from the other, the family's page says so.

- On the Names card a family is one name. Publish it, and its variants are published with it.
- [Definitions](definitions-and-synonyms.md#families) lists the family once, marked Family · 250 variants. A search for a variant, such as revenue eur web, finds its family. Only the family's own page lists the variants.
- A context item about the family applies to every variant, and agents get it for a question about revenue.
- When any variant changes, the item is due for a check once, not once for each variant.

A source that gives only the names of its metrics, not how they are worked out, makes no families. Each variant is then a metric of its own: a row in Definitions, a name to publish, and found by its exact name.
