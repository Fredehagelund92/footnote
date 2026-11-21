# Cube Cloud deployment

Reads the data model of a Cube Cloud deployment through Cube Cloud's APIs, and gives Footnote each
public member of its views and cubes as a definition under `cube:`, the same refs the
[Cube model files](../cube/README.md) connector gives, so items keep their refs when a model moves
to Cube Cloud. It reads metadata only: never data, SQL or private members, and it writes nothing to
Cube Cloud. A read only flags the items that rely on a member that changed or left: it never
changes an item and never publishes.

Cube Cloud gives no calculations, so this connector's change marks see metadata only: a member's
type, how it adds up, its title, description, format and `meta`. A change to a calculation alone
flags nothing until one of those changes too. The connect page says so before anything is given.

## Setting it up

1. In Cube Cloud, open **Admin**, then **API Keys**, and create a key limited to the one
   deployment to read. Footnote uses it only to ask for a token that reads metadata.
2. Note the deployment's number, the digits after `/deployments/` in its address, and the REST API
   address Cube Cloud shows for it, ending in `/cubejs-api/v1`.
3. If the model has data access policies, choose a security context that sees every view to read:
   what the token cannot see is left out, and marked gone.

## Settings

| Field              | What it is                                                                                                                         |
| ------------------ | ---------------------------------------------------------------------------------------------------------------------------------- |
| Cube Cloud address | The address you sign in to Cube Cloud with, such as `https://your-team.cubecloud.dev`.                                             |
| Deployment         | The deployment's number.                                                                                                           |
| REST API address   | The deployment's REST API, ending in `/cubejs-api/v1`. Its `/v1/meta` is read there.                                               |
| Domain names       | The model's `meta.domain` value to the domain it means, for a model whose names differ from the domain ids.                        |
| Environment        | Under More settings: the number of the environment to read. Empty for the production environment.                                  |
| Security context   | Under More settings: the JSON object the token is made for. Empty for none.                                                        |
| API key            | A secret, kept in the server's secret store. It is sent only to the Cube Cloud address, and forgotten when either address changes. |

## What a read does

1. Lists the deployment's environments (`GET /api/v1/deployments/{id}/environments`) with the API
   key, and takes the one the settings name, or the production one. The production one is asked for
   by its type; one named by its number is looked for page after page, up to 20 pages. A
   deployment without it fails with `cube-cloud.environment_not_found`.
2. Asks how the latest build of that environment's branch stands
   (`GET /api/v1/deployments/{id}/build-status`). When its `filesHash` and `lastHash` are the ones
   the last read saw, the read ends there, as unchanged, and the core keeps what that read found.
   Only a build whose status is `done` counts (Cube Cloud does not document its statuses). A build
   that is not done, has no hash, has no status yet (404), or sits on a branch name this cannot
   ask about reads every time. So does a non-production environment with no branch, since the
   status could then answer for another branch; the production environment is asked with none.
3. Trades the key for a token (`POST /api/v1/deployments/{id}/environments/{env}/tokens-for-meta-sync`)
   that reads metadata only and lasts 5 minutes, with the settings' security context. It asks for
   no `meta-private` scope, so private members stay out of reach.
4. Reads `/v1/meta` at the REST API address with the token. An answer that is not Cube's fails
   with `cube-cloud.not_cube_meta`.
5. Sends each member of each public cube and view as a definition `cube:<view>.<member>`, with its
   title, a copy of the first 500 characters of its description, its type, its other names from
   `meta.synonyms` and the domain the model gives it in `meta.domain` (the member's own first, then
   its view's), through the domain names. A view that names no domain warns `missing_domain`, and
   a value that is not a domain warns `invalid_domain`. A cube, view or member Cube hides
   (`public: false`) is left out. A view Cube describes in a way this does not read is left out
   with `cube-cloud.unreadable_view`, and the read is then in part, so it marks nothing missing.
   A member whose `meta.footnote` names a family (`family`, `by`, and `family_description` for what it means) gets that family as written
   (D9); one that cannot be kept is none, warned as `invalid_family`.
6. Ends with the build's hash as its version and its cursor. Every read that is not unchanged is a
   full listing: a member that left is marked missing, and the items that rely on it are flagged.

The change mark is the SHA-256 of what `/v1/meta` says of a member: its type, its aggregation, its
title, description, format, currency, granularities, values, drill members, the member it stands
for (`aliasMember`) and its `meta` without the domain, the other names and the family it declares (`footnote`). Nothing else in the
answer is read: SQL in an extended answer is never kept, hashed or passed on.

A refused key fails with `unauthorized` on `apiKey`, a token the REST API refuses with
`cube-cloud.token_refused` (the REST API address is not the environment's, or the security
context is refused; the API key is fine), a deployment or environment Cube Cloud does not know with `not_found`, and too many
requests with `rate_limited`, tried again when Cube Cloud says. Cube Cloud's own words about a
failure never cross: only a code.

### Moving from Cube model files

Both connectors write `cube:` refs, and a ref belongs to one source. While the model-files source
is connected, a Cube Cloud read leaves its refs out (`taken`). Disconnect the model-files source an
admin added to hand them over: the next Cube Cloud read takes them, and since the two connectors
compute marks differently, it stores the new marks without flagging any item and tells the owners
once. A files source set up on the server (`CUBE_MODEL_DIR`) cannot be disconnected, so its refs
stay with it. A member the files source had already marked missing takes the new mark as a change
when it comes back, so the items on it are flagged. A member Cube Cloud does not show (for example
one the security context hides) stays with the disconnected source and is never marked missing.

## Schedule and limits

Read every hour by default, at most every 15 minutes. A source not read for six hours is out of
date. A read takes at most two minutes and 100,000 definitions. Cube Cloud's API answers are capped
at 1 MB and `/v1/meta` at 20 MB.

## Tests

The conformance kit runs against it in `tests/server/connectors/conformance.test.ts`, with a fake
Cube Cloud on this machine (`tests/server/connectors/cube-cloud-server.ts`) and the invented
`/v1/meta` in `tests/fixtures/cube-cloud/`. `tests/server/connectors/cube-cloud.test.ts` covers
where the key and the token go, the environments, the build status and each refusal, and
`tests/integration/cube-cloud-sources.test.ts` takes a source through the API, the sources' job
and the definitions pipeline: what a changed or removed member flags, and the hand-over from Cube
model files.
