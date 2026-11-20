---
title: Static list
line: Metrics and dimensions an admin writes in the form as a JSON list, for a trial or a team without a semantic layer.
group: Connectors
order: 5
reviewed: 2026-11-20
---

Write metrics and dimensions yourself, as a JSON list in the form. It suits a trial, or a team without a semantic layer yet. It reads nothing outside its own settings, and needs no host and no secret. It is experimental.

## Write the list

An admin adds it in Settings, Integrations, as [Integrations](../help/integrations.md) says, and writes the list under Definitions:

```json
[
  {
    "kind": "metric",
    "name": "payments.orders",
    "title": "Orders",
    "description": "Orders placed in the web shop, cancelled ones included.",
    "type": "number",
    "domain": "sales"
  },
  { "kind": "dimension", "name": "payments.market", "title": "Market" }
]
```

| Key           | What it holds                                                                                                                                                                           |
| ------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `kind`        | `metric` or `dimension`. Required                                                                                                                                                       |
| `name`        | Letters, digits and underscores, each part starting with a letter, usually the view's part before a dot, such as `payments.orders`. Required, at most 200 characters, and no name twice |
| `title`       | Its name on screen, at most 200 characters                                                                                                                                              |
| `description` | What it means, at most 5,000 characters. The first 500 are kept                                                                                                                         |
| `type`        | Its type as text, such as `number`, at most 50 characters                                                                                                                               |
| `domain`      | Its domain, as a domain id, at most 200 characters                                                                                                                                      |

An entry may hold no other key. The form refuses a list it cannot read, and names the first entry that is wrong and why, such as a key it does not know, a missing kind or a name it cannot take.

Where the list names a domain differently from your domains, say which domain it means under Domain names, in More settings. A domain id needs no line.

## What a read does

Each entry becomes a definition. Its kind, name, title, description and type make what counts as a change, so moving an entry in the list changes nothing, and changing its description flags the items that rely on it.

Its domain is not part of a change. A changed domain flags no item, and tells the owners of any term that uses it.

**Test connection** counts the metrics and dimensions, and warns when an entry names a domain that is not a domain id, or when a metric names no domain. A read gives an entry whose domain is not a domain id no domain, with the warning A domain we do not have. A description over 500 characters is cut, with the warning A description was cut.

## Schedule and limits

It is read every hour, and it is out of date after 6 hours. A list holds at most 500 entries and 20,000 characters, and a read takes at most 10 seconds.
