---
title: dbt MetricFlow
line: Reading metrics and dimensions from the semantic manifest your dbt pipeline writes, wherever it puts the file.
group: Connectors
order: 4
reviewed: 2026-11-20
---

Read the metrics and dimensions of a dbt project's semantic layer from the one file dbt writes, `semantic_manifest.json`, wherever your pipeline puts it. A read never runs dbt and never reaches dbt Cloud, a warehouse or data. It keeps no calculation and no value, and it never changes or publishes an item: it flags the items that rely on a definition that changed or went.

## Make the file

`dbt parse` writes `target/semantic_manifest.json`. It needs an adapter installed, but reaches no warehouse. dbt Core parses only after `dbt deps` has installed the project's packages; dbt v2 (Fusion) installs them itself.

Most projects keep `target/` out of Git, so your pipeline puts the file where the service can read it. Step 2 of connecting asks where, and each place shows its own recipe:

| Place          | What you give                                          | Best for                                                                                  |
| -------------- | ------------------------------------------------------ | ----------------------------------------------------------------------------------------- |
| Address        | An https link, kept as a secret                        | A public file, a signed link, an internal artifact server                                 |
| Object storage | The object's address and a read-only key               | A pipeline that uploads to S3, an S3-compatible store, Google Cloud Storage or Azure Blob |
| Git repository | A repository, a branch and a read-only token           | A project that commits the file                                                           |
| Server folder  | Nothing here: whoever runs the server names the folder | A pipeline that drops the file on the machine that runs the service                       |

### An address

Upload the file and make a link to it. A link is read as it is, with no key added, so it holds whatever it needs.

A signed link is as good as a key, so it goes in the secret store, and the form shows it only as set. A failure names its host, never its path or signature.

Links signed by S3 or Google Cloud Storage last 7 days at most, so a source that lasts needs Object storage, or a link that does not expire. **Test connection** says when a link stops working, and warns in its last 14 days. An artifact server on a private network has to be allowed by name by whoever runs the server, with `FOOTNOTE_EGRESS_PRIVATE_HOSTS` in the [service settings](../configuration.md#connectors).

### Object storage

Upload the file, then give the object's https address and a key that can read that object and nothing else:

```yaml
# A step of your CI, after dbt parse. Use your project's adapter in place of dbt-duckdb.
- run: pip install dbt-core dbt-duckdb
- run: dbt deps
- run: dbt parse --profiles-dir .
- run: aws s3 cp target/semantic_manifest.json s3://your-bucket/dbt/semantic_manifest.json
```

| Service              | File address                                                   | Key                                                                             |
| -------------------- | -------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| Amazon S3            | `https://your-bucket.s3.eu-west-1.amazonaws.com/dbt/file.json` | An access key whose policy allows only `s3:GetObject` on that object            |
| S3-compatible store  | `https://storage.example.com/your-bucket/dbt/file.json`        | A key that reads that object. Region: the one it signs for, or empty            |
| Google Cloud Storage | `https://storage.googleapis.com/your-bucket/dbt/file.json`     | An HMAC key of a service account with only Storage Object Viewer on that bucket |
| Azure Blob Storage   | `https://youraccount.blob.core.windows.net/dbt/file.json`      | A shared access signature with read permission only (`sp=r`)                    |

The key stays in the secret store. For every service but Azure, each read is signed with it, and only the signature goes to that address. Google Cloud Storage takes the same signature from an HMAC key at its S3-compatible address.

Azure Blob Storage has no such signing, and an account key can do everything, so it takes a shared access signature. One that may do more than read and list is refused. One that names a stored policy (`si=`) says nothing of what it may do, so it cannot be checked: give that policy read permission only.

The service can see what a shared access signature may do. It cannot see what an S3 key may do, so least access there is yours to set.

### A Git repository

In CI, on each change to the project, commit the file to a folder of the repository or to a branch of its own:

```yaml
# A step of your CI, on the branch that holds the project.
- run: pip install dbt-core dbt-duckdb
- run: dbt deps
- run: dbt parse --profiles-dir .
- run: |
    mkdir -p semantic
    cp target/semantic_manifest.json semantic/semantic_manifest.json
    git add semantic/semantic_manifest.json
    git diff --cached --quiet || git commit -m "Update the semantic manifest"
    git push
```

Your Git host's CI may need a token of its own to push. Then make a token that can read this repository and nothing else, and add the source in Integrations, with Folder `semantic`.

### A folder on the server

When your CI drops the file on the machine that runs the service, skip the commit. Whoever runs the server names the folder, and the connector reads `semantic_manifest.json` in it:

```sh
FOOTNOTE_SERVER_FOLDERS='{"dbt-metricflow":"/srv/dbt/target"}'
```

It is then one of the server's own sources, with no settings, token or Git. The server's domain map, `FOOTNOTE_DOMAIN_OVERRIDES`, gives a semantic model with no domain its domain. [Service settings](../configuration.md#connectors) has the rest.

## Where `meta` goes

The domain and the other names come from `config.meta`, and the place depends on your YAML spec. dbt drops them anywhere else, without saying so, and every view then shows no domain.

| What              | Legacy spec                            | Latest spec                                  |
| ----------------- | -------------------------------------- | -------------------------------------------- |
| A model's domain  | `semantic_models[].config.meta.domain` | `models[].semantic_model.config.meta.domain` |
| A dimension's own | `dimensions[].config.meta`             | `columns[].dimension.config.meta`            |
| A metric's own    | `metrics[].config.meta`                | `metrics[].config.meta`                      |
| Not read: dropped |                                        | `models[].config.meta`                       |

```yaml
# Latest spec: on the semantic model, not on the model.
models:
  - name: orders
    semantic_model:
      enabled: true
      config:
        meta:
          domain: sales
```

```yaml
# Either spec: other names, and a domain of its own, on a metric.
config:
  meta:
    domain: sales
    synonyms: ['purchases', 'order count']
```

## Connect it

An admin adds it in Settings, Integrations, as [Integrations](../help/integrations.md) says. The fields follow the place you choose:

| Field                   | What it is                                                                                                                                    |
| ----------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| Where the file lives    | Address, Object storage, Git repository, or Server folder, which is set where the server runs                                                 |
| File address            | For an address: the https address of the file, kept in the secret store. For object storage: the object's address, with no signature or query |
| Storage service         | Amazon S3, an S3-compatible store, Google Cloud Storage or Azure Blob Storage                                                                 |
| Region                  | For S3 or an S3-compatible store: the region it signs for. An S3 address that names its region needs none. Empty means `us-east-1`            |
| Access key, Secret key  | For S3, S3-compatible stores and Google Cloud Storage: a read-only key, kept in the secret store                                              |
| Shared access signature | For Azure Blob Storage: read permission only, kept in the secret store                                                                        |
| Repository              | The https address of the Git repository that holds the file                                                                                   |
| Branch, tag or commit   | Where the file is read: the branch your CI commits it to. `main` to start with                                                                |
| Folder                  | The folder that holds the file. Empty for the top                                                                                             |
| File                    | The file in that folder, `semantic_manifest.json` by default                                                                                  |
| Read-only token         | Sent only to the repository's address, and kept in the secret store. Empty for a public repository                                            |
| User name for the token | Under More settings: sent with the token, for hosts that ask for one                                                                          |
| Domain names            | Under More settings: the domain each `meta.domain` value means, when it is not a domain id                                                    |

A source moves between Address, Object storage and Git repository in **Change settings**, and keeps its definitions. The secrets of the place it leaves are forgotten, and the new place needs its own.

A project read from a server folder cannot move to a source added in Integrations. The server's source keeps its definitions, even once it is taken out of the server's settings, so a source added later cannot take them.

## What a read does

From an address or object storage, a read asks whether the file changed since the last read. When the store says it has not, nothing is read and what the service knows stays. From Git, it reads the one commit the branch or tag names.

It then maps the file:

- **A semantic model is a group**, which Integrations lists and maps to a domain.
- **Every dimension is a definition**, such as `dbt:orders.status`, of the type `categorical` or `time`. Dimensions of one name stay apart: the status of orders is not the status of customers.
- **Every metric that is not hidden is a definition**, under the one semantic model all its inputs come from, such as `dbt:orders.revenue`, or under `_shared` when they span more than one.
- **A metric's type** is its aggregation, such as `sum`, when it is simple, and otherwise its own, such as `ratio` or `derived`.
- **Left out**: measures, entities, saved queries and time spines. They are inputs, join keys and plumbing, not what people ask about.

Each definition keeps its label, the first 500 characters of its description, the other names in `meta.synonyms` and a domain. Every read that takes the file is a full listing, so a definition that left is marked gone.

**Domains.** A definition's own valid `meta.domain` wins. A dimension otherwise takes its semantic model's, as a metric does. A metric under `_shared` takes the one domain all its semantic models agree on, or none. A missing domain is never guessed: an admin maps it.

**What counts as a change.** The calculation, with the calculations of the metrics and measures it is built from, the type, the label and the description. A metric changes when anything it is built on is worked out differently, never for an input's label.

The domain, the other names, and the database and schema the project was built for are not part of it. The same meaning reads the same under both YAML specs.

## What Test connection may say

**Test connection** reads the file once, keeps nothing, and says what it found:

| On screen                                             | What it means, and what to do                                                                |
| ----------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| No domain named                                       | A semantic model, or a metric under `_shared`, names no domain. Map it, or set `meta.domain` |
| A domain we do not have                               | A `meta.domain` is not a domain id. Add it to Domain names                                   |
| A description was cut                                 | A description is over 500 characters. Only the first 500 are kept                            |
| A type we do not know                                 | The definition is kept with no type, never a guessed one. A newer dbt may have added it      |
| A metric and a dimension share a name                 | Only the metric is kept. Rename one of them in dbt                                           |
| A metric is built on something the file does not hold | It is left out and the read is in part, so what was known stays. Commit a whole file         |
| This is not dbt's semantic manifest                   | The read fails: the file is another one, often `manifest.json`. Point File at the right one  |
| This signature can do more than read                  | The read fails: make a shared access signature with `sp=r`                                   |

A read that fails, in the test or on its schedule, says why in Integrations when it is one of these. Any other failure of a scheduled read shows only that it couldn't be read, and Test connection says more.

- **It is too large, or not text**: the file is over 2 MB, compressed, or not UTF-8.
- **What it reads wasn't found**: there is no file at that address or path.
- **The key was refused**: a wrong key or an expired link. S3 also says this for a missing file, to a key that may not list the bucket.
- **It redirects somewhere it may not follow**: a redirect to another host or port, or more than three.
- **Its address is not one it may reach**: the host is not public.

## Schedule and limits

It is read every hour by default, every 15 minutes at the shortest, and it is out of date after 6 hours. A read takes at most 90 seconds and 100,000 definitions.

The file is at most 2 MB wherever it lives: about 2,400 definitions at the size dbt writes them. An address or an object over it is refused by the length the host gives, or as soon as that much has arrived.

A metric moved to another semantic model is a new definition. dbt's own query names, such as `customer__region`, are not read as names.

## What it has been tried on

- Files from dbt Core 1.12.6 and 1.12.7 with MetricFlow 0.213.0, and from dbt v2 (Fusion) 2.0.12.
- dbt Labs' public samples: jaffle-shop on the latest spec, with dbt Core and with Fusion, which give the same definitions, and jaffle-sl-template on the legacy spec.
- Fusion checks the semantic layer only with dbt Cloud credentials, so its file can hold a metric built on something missing. That metric is left out, with the warning above.
- The signing has been checked against the `aws` command and a store on one computer, not against a live S3, Google Cloud Storage or Azure account.
