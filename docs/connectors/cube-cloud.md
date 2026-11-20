---
title: Cube Cloud
line: Reading metrics and dimensions from the metadata of a Cube Cloud deployment, through its APIs.
group: Connectors
order: 3
reviewed: 2026-11-20
---

Read the metrics and dimensions of a Cube Cloud deployment through Cube Cloud's APIs. A read takes the names, titles, types and descriptions of the public views and cubes and their members: never data, SQL or private members, and it writes nothing to Cube Cloud. It never changes or publishes an item: it flags the items that rely on a member that changed or went. It is experimental.

Its definitions are the same as [Cube model files](cube.md) give, so items keep them when a model moves to Cube Cloud: see [Move from Cube model files](#move-from-cube-model-files).

## What it cannot see

Cube Cloud gives no calculations. So a change to a calculation alone flags nothing, until something Cube Cloud shows of the member changes too: its type, how it adds up, its title, description, format or `meta`. The connect page says so before you give anything.

To flag a changed calculation, read the model files instead, from Git or from a folder on the server, with [the Cube connector](cube.md).

## Set it up

1. In Cube Cloud, open **Admin**, then **API Keys**, and create a key limited to the one deployment to read. It is used only to ask for a token that reads metadata.
2. Note the deployment's number, the digits after `/deployments/` in its address, and the REST API address Cube Cloud shows for it, ending in `/cubejs-api/v1`.
3. If the model has data access policies, choose a security context that sees every view to read. What the token cannot see is left out, and marked gone.

An admin then adds it in Settings, Integrations, as [Integrations](../help/integrations.md) says:

| Field              | What it is                                                                                                  |
| ------------------ | ----------------------------------------------------------------------------------------------------------- |
| Cube Cloud address | The address you sign in to Cube Cloud with, such as `https://your-team.cubecloud.dev`                       |
| Deployment         | The deployment's number                                                                                     |
| REST API address   | The deployment's REST API, ending in `/cubejs-api/v1`. Its metadata is read there, never its data           |
| Domain names       | The domain each `meta.domain` value means, for a model whose names differ from your domain ids              |
| API key            | Kept in the secret store, sent only to the Cube Cloud address, and forgotten when either address changes    |
| Environment        | Under More settings: the number of the environment to read. Empty for the production environment            |
| Security context   | Under More settings: the JSON object the token is made for, such as `{ "role": "catalog" }`. Empty for none |

## What a read does

1. It finds the environment the settings name, or the production one.
2. It asks how that environment's latest build stands. When the build is done and is the one the last read saw, the read ends there, and what that read found stays.
3. It trades the key for a token that reads metadata only and lasts 5 minutes, made for the security context. The token cannot reach private members.
4. It reads the deployment's metadata at the REST API address with the token.
5. Each member of each public view and cube becomes a definition, with its title, the first 500 characters of its description, its type, its other names from `meta.synonyms`, and its domain from `meta.domain`: the member's own first, then its view's.

Every read that reads the metadata is a full listing: a member that left is marked gone, and the items that rely on it are flagged. A cube, view or member Cube hides is left out. A view Cube Cloud describes in a way the connector does not read is left out too, and the read is then in part, so it marks nothing gone.

What counts as a change is what the metadata says of a member: its type, how it adds up, whether it is cumulative, its title, description, format, currency, granularities, values, key, drill members, the member it stands for, and its `meta` without the domain and the other names. SQL in the answer is never kept or passed on.

## What Test connection may say

**Test connection** reads the metadata once, keeps nothing, and says what it found:

| On screen                              | What it means, and what to do                                                                       |
| -------------------------------------- | --------------------------------------------------------------------------------------------------- |
| No domain named                        | A view names no domain. Map it, or set `meta.domain` in the model                                   |
| A domain we do not have                | A `meta.domain` is not a domain id. Add it to Domain names                                          |
| A view could not be read               | It is left out, and the read is in part, so what was known of it stays                              |
| The REST API refused the token         | The REST API address is not this environment's, or it refuses the security context. The key is fine |
| This is not a Cube REST API            | Copy the REST API address Cube Cloud shows for the deployment, ending in `/cubejs-api/v1`           |
| The deployment has no such environment | Leave Environment empty for production, or give the number of one of its environments               |

A read that fails, in the test or on its schedule, says why in Integrations when it is one of these:

- **The key was refused**: Cube Cloud refused the API key.
- **What it reads wasn't found**: Cube Cloud does not know the deployment or the environment.
- **It was asked too often**: it tries again when Cube Cloud says.
- **It couldn't be reached**: Cube Cloud did not answer.

Any other failure of a scheduled read shows only that it couldn't be read, and Test connection says more. Cube Cloud's own words about a failure are never shown: only a code, and the app's words for it.

## Move from Cube model files

Both connectors give the same definitions, and a definition belongs to one source. While a Cube model files source is connected, a Cube Cloud read leaves its definitions out, as read by another source.

1. **Disconnect** the model files source an admin added.
2. The next Cube Cloud read takes its definitions. It flags no item for the move, since the two connectors see a member differently, and tells the owners once.

A model folder set up on the server cannot be disconnected, so its definitions stay with it. A member the model files source had already marked gone counts as changed when it comes back, so the items on it are flagged. A member Cube Cloud does not show, for example one the security context hides, stays with the disconnected source and is never marked gone.

## Schedule and limits

It is read every hour by default, every 15 minutes at the shortest, and it is out of date after 6 hours. A read takes at most two minutes and 100,000 definitions. Cube Cloud's answers are read up to 1 MB, and the metadata up to 20 MB.
