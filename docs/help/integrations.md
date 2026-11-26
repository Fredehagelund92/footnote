---
title: Integrations
line: Connect a source of definitions or documents, and what is read from each.
group: Set up
order: 2
minutes: 4
reviewed: 2026-11-22
open:
  label: Open Integrations
  href: /settings/integrations
does:
  connect-a-source: connect_source
---

Connect the tool where metrics are defined and the sources where documents live, and what is read from each.

![Integrations in Settings: under Connected, one tool that holds definitions and one that holds documents, each read today; under Available, three more tools, each with Connect.](../images/docs/integrations-light.webp)

## Definitions

Metric and dimension names arrive from the tool where they are defined, and stay read-only. dbt calls a group of metrics a semantic model, and its domain is read from `config.meta.domain`.

A tool can be read from its files in a repository, or through its own API with a key limited to one deployment. Some APIs give no calculations. Then a changed calculation flags nothing until the definition's type, title or description changes too, and the tool's page says so before you connect it.

A read makes a name for each new one, and an owner publishes them on one card in the Inbox, as [Set up your workspace](set-up-your-workspace.md#publish-the-names) shows. Until then, [Definitions](definitions-and-synonyms.md) doesn't list them. When a definition changes there, the context that relies on it comes back to its owners to check.

## One definitions tool at a time

One definitions tool is on at a time. While one is on, the others under Available say so, and can't be connected.

To switch, open the tool that is on and choose **Turn off**, then connect or turn on the other. A tool that is off leaves Definitions, and agents stop getting its definitions. Context that relies on one stays published, marked as relying on a tool that is off, until it is on again.

## Documents

A folder shared with a service account, or Markdown in a repository. A read never publishes: each document becomes a suggestion in its owners' Inbox.

## Connect a source

Only admins connect a tool. Open **Settings**, then **Integrations**, and choose **Connect** on a tool under Available. It takes five steps on one page:

1. Pick: the tool.
2. Connect: its settings, then **Test connection**.
3. Choose: the views, semantic models or folders to read.
4. Map: each to a domain. A folder's documents go to its domain's owners; a view or semantic model left without a domain stays shared.
5. Schedule: how often it is read and what each read does. Then say why it is added.

**Change settings** goes through the same steps, filled in. A token or a key left empty stays as it is. **Disconnect** stops reading the tool and forgets its key: its open suggestions are withdrawn, and what owners published stays. A definitions tool disconnected is off, as above.

## Choose what it reads

Your organisation decides which views or semantic models are its catalogue. **Choose views** under What it reads opens Choose, Map and Schedule, for every definitions tool. That includes one the person who hosts this app set up, whose settings stay theirs.

Every view is read until an admin chooses. A view taken out leaves Definitions at the next read, and the context that relies on it comes back to its owners to check. It keeps its domain, so choosing it again restores it.

A view the tool adds later is not read until it is chosen. The admins get one card in the Inbox, New views not chosen, which opens Choose.

## Test a tool you connected

**Test connection** under Connection, on a tool's page, tests it as it is saved. That includes one the person who hosts this app set up from a folder on the server, whose settings are theirs. Nothing is kept, and nothing changes.

It says, step by step, that it reached the tool and signed in, what a read would hold, and whether the views it reads are all in the model. It names each file a read skips, such as one written with Jinja, and the families a read would find. When something fails, it says what, and what to do.

## Families on a tool's page

A definitions tool's page always has Families: metrics that are one metric with variants, such as Revenue in each currency. With none, it says how a read finds one, and shows the lines to add to your tool's model to make one.

With some, it lists each one: how it was found, its variants, and whether it is published or waits in the Inbox. Owners decide them in the Inbox and in Definitions, as [Metric variants](metric-variants.md) explains.
