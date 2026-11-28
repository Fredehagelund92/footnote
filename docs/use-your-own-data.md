---
title: Use your own data
line: Run it on one computer with your own semantic layer instead of the demo, and keep a private profile apart.
group: Run the service
order: 2
reviewed: 2026-11-27
---

Run it on one computer with your own semantic layer instead of the demo, and sign in as yourself. It starts the same way as [Try the demo](try-the-demo.md), with `docker compose`.

## Read your own Cube model

Footnote reads metric and dimension names from your semantic layer, and never writes to it. For a [Cube](https://cube.dev) model, name its folder:

```sh
CUBE_MODEL_DIR=/path/to/your/cube/model docker compose up
```

With your own model it starts empty, with no demo data. If you tried the demo first, its data is still in Docker's volume, and the two would be mixed: the start stops and says so. Run `docker compose down --volumes`, which deletes the demo's database and keys, then start again the same way.

The first time you open it, the sign-in page asks your name, your email and what the workspace is called, and makes you its admin. There are no sample people. Then follow the setup checklist in the Inbox: publish the names the read made, on one card, ask, and write what you know. Your context applies to those names.

On a Mac the folder must be one Docker shares, or the service refuses to start and says so. Docker Desktop shares only the folders under Settings, Resources, File sharing, and Colima shares your home folder unless told otherwise. [The Cube connector](connectors/cube.md) says what the model needs.

## Read dbt on this computer

For a dbt project on this computer, run `dbt parse` in it, then name the folder that holds the `semantic_manifest.json` it writes, most often the project's `target`:

```sh
DBT_MANIFEST_DIR=/path/to/your/dbt/project/target docker compose up
```

The folder is shared into the container read only, as a Cube model's is, and the service reads it as its own dbt source, with no demo data. After the demo, the start stops as it does for a Cube model, with the same way out. After the next `dbt parse`, use Read again on the source's page, in Settings, Integrations.

A semantic model takes its domain from its `meta`, as [dbt MetricFlow](connectors/dbt-metricflow.md#where-meta-goes) shows. On a Mac the folder needs the same file sharing as a Cube model's.

## Start empty

When your definitions are not in a folder on this computer, such as in dbt Cloud, Cube Cloud or a Git host, start with no demo and no definitions:

```sh
SEED_DEMO=off docker compose up
```

Say who you are on the first screen, as above, then connect your tool in Settings, Integrations. If you tried the demo first, run `docker compose down --volumes` before you start, as above.

## Read dbt or another tool

For dbt, the service reads the semantic manifest that `dbt parse` writes, from a link, object storage, a Git repository or a folder: see [dbt MetricFlow](connectors/dbt-metricflow.md). An admin connects it in Settings, Integrations, as [Integrations](help/integrations.md) says.

[Connectors](connectors.md) lists every tool it reads. Tokens and signed links stay in a secret store in Docker's `footnote_keys` volume.

## Who you are

On your own data the first person to open the app says who they are and becomes its admin; after that the sign-in page offers the people in the workspace, by a press. The demo keeps its sample people, and a host who sets `FOOTNOTE_DEV_PEOPLE_FILE` gets the people of that file instead.

This is still the people picker of a computer of your own: anyone who reaches it can sign in as anyone, and colleagues you invite cannot sign in until company sign-in is set up. To let real people sign in, see [Run in production](run-in-production.md).

## Private profiles

A private profile is how you try it on your own company's data on your own computer: a folder with the install's settings, its keys and anything you bring in, beside a clean checkout. Keep the folder outside every git checkout, this one's and any other, so no `git add` can reach it.

Start every file in it with a line that holds the marker:

```text
FOOTNOTE-PRIVATE-PROFILE <the profile's name>
```

In a file with comments, put the marker in a comment; in JSON Lines, in a field of the first line. The repository's secret scan fails every pull request and every push whose commits carry the marker, so a profile file, or something made from one, cannot be merged into the repository or reach the demo.

Run the profile on its own database, with its own settings file:

- `FOOTNOTE_PROFILE_LABEL` names it in the header and on the sign-in page, so you always see which install you are in.
- Leave `SEED_DEMO` off and `FOOTNOTE_AUTH` at `dev`: the sign-in page then says nothing about the demo, which it does only for `FOOTNOTE_AUTH=demo` or with the demo loaded.

## Next

- [Choose a model provider](model-providers.md), to answer Ask on a real model.
- [Back up, restore and upgrade](back-up-restore-and-upgrade.md), before the data matters.
