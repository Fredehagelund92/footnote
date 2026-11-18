---
title: Run and operate the service
line: Run the service, check it is healthy, run it in production, and read its jobs, limits and metrics.
group: Run the service
order: 3
reviewed: 2026-11-05
---

Start the service, check it is healthy, and run it in production. To compare the ways to run it, see [Where to run Footnote](where-to-run.md). In containers on one computer, see [Self-host Footnote on one computer](self-hosting.md).

## Run the service locally

The service needs Node 26 and PostgreSQL 18. On macOS with Homebrew:

```sh
brew install postgresql@18 && brew services start postgresql@18
cp .env.example .env.local        # adjust the database addresses if your server differs
npm run db:migrate                # creates the roles and the database, applies the schema
npm run dev:server                # http://127.0.0.1:3000, restarts on change
```

`npm run db:migrate` is safe to run again.

The service starts empty. To load the demo, set `SEED_DEMO=on`, as `.env.example` does. It loads into a database that holds nothing yet, as long as `CUBE_MODEL_DIR` is the demo's model. Production refuses it, so a real install never gets demo data by accident.

## Check that it runs

```sh
curl localhost:3000/health         # answers while the process runs
curl localhost:3000/health/ready   # also asks the database: 503 when it cannot reach it
```

Both name the version that runs.

Logs are JSON lines on stdout. Each line about a request carries its id (`reqId`), and the response returns the same id as `X-Request-Id`, so a person can quote it. A history log entry written by that request carries the id too.

Logs never hold a header, a body, a query string, a credential or a person.

## Run the image in production mode

The service image starts in production mode unless told otherwise. People sign in with your company's provider, and the people picker, dev tokens and the demo are refused. With no sign-in set up, it refuses to start and names the missing settings.

`compose.yaml` sets `NODE_ENV=development`, the one setting the demo needs. That turns on the people picker, where anyone can sign in as anyone, an admin included.

To run the image in production mode, beside a PostgreSQL 18 database:

1. **Set up sign-in.** Follow [Set up company sign-in](company-sign-in.md).
2. **Make the keys, once.** They go in the volume that keeps them, and a key that exists is kept:

   ```sh
   docker run --rm -v footnote-keys:/var/lib/footnote <image> npm run keys:create
   ```

   Set `FOOTNOTE_SECRETS_DIR=/var/lib/footnote/secrets` too, so the tokens and signed links of the tools you connect are kept in the same volume. Without it, a tool that needs a secret can't be connected.

3. **Set the database addresses.** `DATABASE_URL` is the service's own role and `DATABASE_URL_MIGRATE` is the owner, which the image needs to apply the schema at start. When the roles do not exist yet, also set `DATABASE_URL_BOOTSTRAP` to a superuser. See the [database guide](../db/README.md).
4. **Set the addresses.** The login server for agents needs https in production:

   ```sh
   MCP_RESOURCE_URL=https://footnote.example.com/mcp
   FOOTNOTE_WEB_ORIGINS=https://footnote.example.com
   ```

5. **Put a TLS proxy in front.** It sends `/api/v1/`, `/mcp`, `/oauth/` and `/.well-known/oauth-*` to the service directly, and only the rest to the web image, with the public host.
6. **Name that proxy** in `FOOTNOTE_TRUSTED_PROXIES`: see [The proxy in front](where-to-run.md#the-proxy-in-front).

See [Service settings](configuration.md) for every other setting, and the [database guide](../db/README.md) for the roles.

## Request limits

Every request under `/api` counts against a limit each minute, the setting `limits.api_rate_per_minute`.

| Who                        | Limit a minute |
| -------------------------- | -------------- |
| A signed-in person         | 600            |
| An address, before sign-in | 120            |

Over a limit, the answer is 429 with `Retry-After` in seconds. Each instance counts on its own. `/health`, `/health/ready` and `/metrics` are not limited.

The address is the one that connected, unless that is a proxy named in `FOOTNOTE_TRUSTED_PROXIES`. Then it is the address the proxy forwards. Unset, the service believes no forwarded address.

## Scheduled jobs

The service runs its own jobs on the same database. A job that came due while the service was stopped runs once when it starts again. `connectors.sync` also runs once at every start, so the server's own model folder is read at once.

| Job                      | When (UTC)       | What it does                                                   |
| ------------------------ | ---------------- | -------------------------------------------------------------- |
| `observability.rollup`   | Each night       | Keeps the weekly counts, which are kept without limit          |
| `partitions.ensure`      | Each night       | Makes the database partitions coming up                        |
| `observability.snapshot` | Each night       | Keeps the last whole month's counts                            |
| `retention.run`          | Each night       | Clears what has passed its retention period                    |
| `outbox.relay`           | Every minute     | Delivers events the relay has not delivered yet                |
| `saved.check`            | Every minute     | Checks saved questions once what agents get has moved          |
| `evals.work`             | Every minute     | Works through queued evaluations                               |
| `evals.retrieval`        | Every minute     | Runs the free retrieval checks                                 |
| `evals.weekly`           | Mondays          | Runs the weekly evaluation                                     |
| `connectors.sync`        | Every 5 minutes  | Reads each source that is due, on its own schedule             |
| `jobs.watchdog`          | Every 5 minutes  | Raises an alert for a job that is late or a source out of date |
| `gaps.detect`            | Every 15 minutes | Turns questions that found nothing into Not found cards        |
| `alerts.raise`           | Every 15 minutes | Runs the alert rules, which raise Inbox cards                  |

`GET /api/v1/operations` shows each job's last success and last error, the queue, the sources and model spending, for an admin session. To run a job now:

```text
POST /api/v1/operations/jobs/retention.run/run
```

Problems are error log lines with an `alert` field: `job_failed` after the last retry, and `job_overdue` and `connector_stale` from the watchdog. A job that only waits out an earlier failure, as the saved check does, is backing off, not succeeding: the failure stands until a run goes well, and the watchdog sees the job overdue meanwhile.

## Metrics

`GET /metrics` serves the service's numbers in the Prometheus text format. Turn it on by setting `FOOTNOTE_METRICS_TOKEN`, a token of at least 32 characters, in the service's environment and restarting it. Without one, the address answers 404. Make a token with `openssl rand -hex 32`, then read the numbers:

```sh
curl -H "Authorization: Bearer <the token>" localhost:3000/metrics
```

It counts HTTP requests by route, MCP requests by tool, status and agent family, and what the operations view shows: jobs, queues, source age, model spending and the database pool.

Labels come from fixed lists, never a path, a question, a person or an agent's own name. Counts here are exact for whoever holds the token, unlike Observability, which hides small counts.

## Upgrade from Heed 0.1

The product was called Heed until 0.1 and is called Footnote since. The names a machine reads changed with it. Most old names still work for this release and stop working in the next, so nothing breaks at the upgrade, but rename them now. With `docker compose`, start with [Upgrade from Heed 0.1](self-hosting.md#upgrade-from-heed-01) on the self-hosting page, which moves the data.

What still works for this release:

- **Settings.** Every `HEED_` setting is read when its `FOOTNOTE_` name is unset, with a warning: see [the next section](#settings-that-started-with-heed_). The compose file's ports and the web image's address of the service count too: see the list below.
- **Sign-in.** A browser signed in before the upgrade stays signed in: the service still reads the `heed_session` cookie, and the next sign-in replaces it. A web app or command line from before still sends `X-Heed-CSRF`, which the service still takes.
- **The database `heed`.** When the database the service is set to (`footnote` in `compose.yaml`) is missing and `heed` is there, the start renames it, once.
- **Key files.** A key under its old default name, `.heed-oauth-key.pem`, `.heed-mcp-state.key` or `.heed-dev-key.pem`, is moved to the new one, `.footnote-…`, the first time the service needs it. Agents stay connected.
- **Agents.** An agent keeps the name it gave the server, so one added as `heed` keeps working. To have its tools named after Footnote, remove it and add it again as `footnote`, and change the tool names in its `CLAUDE.md` or rules file.
- **Browsers.** The theme, the panes and the Ask chats a browser kept move to their new names on the first visit.

What changed outright:

- **The image's key folder** is `/var/lib/footnote`, not `/var/lib/heed`. Mount the keys volume there, or the service refuses to start in production without its key.
  Settings of your own that still point into the old folder win over the image's defaults, so repoint them too:
  - `HEED_SECRETS_DIR`
  - `HEED_OAUTH_SIGNING_KEY_FILE`
  - `HEED_MCP_STATE_KEY_FILE`
  - `MCP_DEV_KEY_FILE`
- **The web image's address of the service** defaults to `http://footnote:3000`, not `http://heed:3000`. Outside this compose file (your own compose, Kubernetes, Swarm), with a service named `heed` and no API URL set, nginx stops with a host not found error.
  Set `FOOTNOTE_API_URL`, or name the service `footnote`.
- **The service's locks** on the database (roles, domains, settings, sources) have new keys, so a 0.1 instance and a new one must not run against one database at the same time. Stop the old one, then start the new: there is no rolling upgrade.
- **Dev tokens** from `npm run mcp:token` made before the upgrade are refused, since their issuer was `urn:heed:local` and is `urn:footnote:local`. Make a new one.
- **A connector's manifest** names the interface range in the field `footnote`, not `heed`. A connector written to the 0.1 docs renames that field.
- **Metrics** start `footnote_`, not `heed_`, so a dashboard or alert reads the new names, and each series starts again at the upgrade. The log's `name` is `footnote`.
- **The command line** is `npm run footnote`, not `npm run heed`.
- **An edition export** says `footnote.edition/1`. One from before still verifies and imports.
- **The images** are named after the repository: once it is renamed `footnote`, they are `ghcr.io/fredehagelund92/footnote` and `footnote-web`. 0.1.0 is only under `heed`.

## Settings that started with HEED_

Every setting that now starts with `FOOTNOTE_` used to start with `HEED_`, and the rest of its name is the same: `HEED_AUTH` is now `FOOTNOTE_AUTH`.

The image's shipped defaults are `FOOTNOTE_DEFAULT_` now too.

This version still reads an old name when the new one is unset or empty, and a new name that is set always wins. Each process that reads an old name prints one warning at start, with the old settings in use and their new names, never their values.

The next version reads the new names only, so rename them in `.env.local`, in your own compose file and wherever else the service runs. The `CL_` names that came before `HEED_` are no longer read.
