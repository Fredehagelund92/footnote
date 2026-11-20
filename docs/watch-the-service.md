---
title: Watch the service
line: Check the service is healthy, read its logs, its request limits and its scheduled jobs, and serve its metrics.
group: Run the service
order: 8
reviewed: 2026-11-20
---

Check the service is healthy, read its logs, know its request limits and its scheduled jobs, and serve its numbers to your monitoring. The addresses here are the service's own, such as `localhost:3000` on one computer.

## Check that it runs

```sh
curl localhost:3000/health         # answers while the process runs
curl localhost:3000/health/ready   # also asks the database: 503 when it cannot reach it
```

Both name the version that runs.

## Logs

Logs are JSON lines on stdout. Each line about a request carries its id (`reqId`), and the response returns the same id as `X-Request-Id`, so a person can quote it. A history log entry written by that request carries the id too.

Logs never hold a header, a body, a query string, a credential or a person. The web image's log holds the same: method, path and status, with no query string and no caller's address.

## Request limits

Every request under `/api` counts against a limit each minute, the setting `limits.api_rate_per_minute`.

| Who                        | Limit a minute |
| -------------------------- | -------------- |
| A signed-in person         | 600            |
| An address, before sign-in | 120            |

Over a limit, the answer is 429 with `Retry-After` in seconds. Each instance counts on its own. `/health`, `/health/ready` and `/metrics` are not limited.

`/mcp` refuses 60 requests a minute from one address before a token is accepted: no token, a token that fails, or a wrong host, origin or method. Past that, each is answered the same, sign-in challenge included, but writes no request record and no log line until the minute ends. A valid token is never held back by it. An agent's own limits are in [Connect an agent by hand](reference/connect-by-hand.md#limits).

The address is the one that connected, unless that is a proxy named in `FOOTNOTE_TRUSTED_PROXIES`. Then it is the address the proxy forwards. Unset, the service believes no forwarded address: see [The proxy in front](run-in-production.md#the-proxy-in-front).

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
| `evals.weekly`           | Mondays          | Runs the weekly evaluation, when test runs are turned on       |
| `connectors.sync`        | Every 5 minutes  | Reads each source that is due, on its own schedule             |
| `jobs.watchdog`          | Every 5 minutes  | Raises an alert for a job that is late or a source out of date |
| `gaps.detect`            | Every 15 minutes | Turns questions that found nothing into Not found cards        |
| `alerts.raise`           | Every 15 minutes | Runs the alert rules, which raise Inbox cards                  |

`GET /api/v1/operations` shows each job's last success and last error, the queue, the sources and model spending, for an admin session. To run a job now:

```text
POST /api/v1/operations/jobs/retention.run/run
```

Problems are error log lines with an `alert` field:

- `job_failed`, after a job's last retry;
- `job_overdue` and `connector_stale`, from the watchdog;
- `eval_run_unfinished`, for a scheduled test run that did not finish within 24 hours.

A job that only waits out an earlier failure, as the saved check does, is backing off, not succeeding: the failure stands until a run goes well, and the watchdog sees the job overdue meanwhile.

## Metrics

`GET /metrics` serves the service's numbers in the Prometheus text format. Turn it on by setting `FOOTNOTE_METRICS_TOKEN`, a token of at least 32 characters, in the service's environment and restarting it. Without one, the address answers 404. Make a token with `openssl rand -hex 32`, then read the numbers:

```sh
curl -H "Authorization: Bearer <the token>" localhost:3000/metrics
```

It counts HTTP requests by route, MCP requests by tool, status and agent family, and what the operations view shows: jobs, queues, source age, model spending and the database pool.

Labels come from fixed lists, never a path, a question, a person or an agent's own name. Counts here are exact for whoever holds the token, unlike [Observability](help/see-what-agents-asked.md), which hides small counts.
