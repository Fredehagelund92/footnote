---
title: 'Variants: a dimension, not a metric each'
line: Why one metric with currency as a dimension works better than a metric for each currency.
group: Set up
order: 4
minutes: 6
reviewed: 2026-11-23
---

Some models keep a metric for each currency or sales channel, such as Revenue (EUR) web and Revenue (USD) app. Model them as one metric, Revenue, with currency and channel as dimensions. Agents then find what your team wrote about revenue, whatever the currency.

## Why one metric works better

- Agents read a question by the names in it. "Revenue in EUR" and "Why did revenue drop last week?" both name Revenue. With a metric for each variant, no metric is called Revenue: the question names nothing, and the agent is asked to name one.
- A context item about revenue applies to one metric, not to hundreds.
- A change to how revenue is worked out changes one definition. The context about it is due for a check once, not once for each variant.
- [Definitions](definitions-and-synonyms.md) stays a list people can read.

## What Test connection says

When a read would find families, Test connection in [Integrations](integrations.md) leads with them, before anything is published. It says how many of the metrics are variants, how many families they make, and how each family was found. After the first read, an owner of its domain, or an admin, confirms each one in the Inbox, under Families. Nothing is published before.

When many metrics only look like variants of a few, and no family is found in them, it says so instead. It says how many, how many metrics they look like, and the words they are split by, such as eur, usd and gbp. It reads only the names, so now and then it is wrong. It only warns: you can still go on.

Either way, a currency or a channel kept as a dimension needs no family at all.

## How to model them

Keep one metric for each amount, and make what varies a dimension:

- Currency: a dimension of the orders, such as their currency code. A question about one currency filters by it.
- A sales channel, a region or a market: a dimension in the same way.
- A tool that lets one metric follow a choice, such as which currency to show, keeps one metric for every currency too.

## Totals across currencies

A sum over several currencies needs one reporting currency. Keep the amount in the reporting currency as a metric of its own, or let the choice of currency convert it.

## If you keep a metric for each variant

A read groups near-identical metrics into a family, such as Revenue, with 250 variants by Currency and Channel. It finds a family in four ways, and trusts them in this order:

1. Declared in your tool. A metric that names its family under `meta.footnote` is a variant of it, as written. Two metrics are enough.
2. Found from the calculation, with filters that differ only by the value they compare, such as EUR or web. Three metrics are enough.
3. Found from a rate. A metric worked out from another with one more column, such as Accrued share (USD) from Accrued share (EUR) and the column `exchange_rate_usd`. When that column does this for several pairs, each pair is a family by Currency.
4. Suggested by the names alone. Metrics whose names are one name in other currencies, such as Shipping fee (EUR) and Shipping fee (USD), wait under Look alike on the Names card. They are never a family until you say so.

- The Names card has two parts: Families and Names. Families shows the families waiting, counted by how each was found. Those that look alike or need another name come first. The ready ones follow, grouped as declared in your tool, from the calculation or from a rate. Publish one, or all the ready ones at once, and its variants are published with it.
- A source's page in Integrations counts its families the same way, and Review families opens the Families part of the Names card.
- Select a family's name on the Names card to see what it would mean, the values its variants hold and who owns it. There, Keep them separate publishes each metric by its own name. A family your tool declares is changed in your tool instead.
- Under Look alike, choose Publish as a family, or Keep them separate to publish each metric by its own name.
- [Definitions](definitions-and-synonyms.md#families) lists the family once, marked by a stack of tiles. A search for a variant, such as revenue eur web, finds its family. Only the family's own page lists the variants, says how the family was found, and which variant is converted from which.
- A context item about the family applies to every variant, and agents get it for a question about revenue.
- When any variant changes, the item is due for a check once, not once for each variant.

A source that gives only the names of its metrics, not how they are worked out, makes families only from what it declares. The other metrics whose names look alike wait under Look alike.

## Declare a family in your tool

You never have to. Declaring is the surest way, and the only way for variants that are columns of their own, such as a sales line. Under each variant's `meta`, write the family's name and the values that tell it apart:

```yaml title="A metric that names its family, in dbt"
metrics:
  - name: net_revenue_retail_eur
    config:
      meta:
        footnote:
          family: net_revenue
          by:
            sales_line: retail
            currency: EUR
```

In a tool whose metrics are measures, the same `footnote` key goes under the measure's `meta`. Every variant names the same family and the same keys under `by`, each with its own values. A name under `by` that is a dimension of the view is shown by that dimension's name.

To say what the family means, add `family_description` beside `family`, with the same words on each variant that has it. Definitions and agents then read those words for the family, and nobody can replace them here. Variants that give different words are read without them, and Test connection says so.

A family that can't be kept is read as separate metrics, and Test connection says why: only one metric names it, its metrics are in different views, one is a dimension, they name different keys under `by`, or two name the same values.
