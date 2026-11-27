---
title: Service settings
line: The settings the service reads from its environment when it starts, with their defaults.
group: Run the service
order: 9
reviewed: 2026-11-10
---

The service reads its settings from the environment, once, when it starts. If one is wrong, it refuses to start and names each bad setting.

`.env.example` lists every setting. Copy it to `.env.local`, which `npm run dev:server` loads. Settings an admin changes while the service runs, such as limits, are in [Administer the service](administration.md#change-a-setting).

## The service

| Setting     | Default       | What it does                                                               |
| ----------- | ------------- | -------------------------------------------------------------------------- |
| `NODE_ENV`  | `development` | `development`, `test` or `production`. The service image sets `production` |
| `HOST`      | `127.0.0.1`   | The address it listens on                                                  |
| `PORT`      | `3000`        | The port it listens on                                                     |
| `LOG_LEVEL` | `info`        | `fatal`, `error`, `warn`, `info`, `debug`, `trace` or `silent`             |

## The database

| Setting                  | What it does                                                                               |
| ------------------------ | ------------------------------------------------------------------------------------------ |
| `DATABASE_URL`           | The service's own role. Required                                                           |
| `DATABASE_URL_SERVE`     | The restricted role that serves agents. Unset, it is `DATABASE_URL` with the user changed  |
| `DATABASE_URL_MIGRATE`   | The owner, for migrations and backups. The service image needs it                          |
| `DATABASE_URL_BOOTSTRAP` | A superuser, to create the roles and the database when they are missing, and load the demo |
| `SEED_DEMO`              | `on` loads the demo into an empty database. Refused in production                          |

## Sign-in and addresses

| Setting                    | Default                                          | What it does                                                                               |
| -------------------------- | ------------------------------------------------ | ------------------------------------------------------------------------------------------ |
| `FOOTNOTE_AUTH`            | `oidc` in production, `dev` elsewhere            | How people sign in: see [Set up company sign-in](company-sign-in.md)                       |
| `FOOTNOTE_DEV_PEOPLE_FILE` | The demo's people                                | Who the `dev` and `demo` pickers offer                                                     |
| `FOOTNOTE_WEB_ORIGINS`     | `http://localhost:5173`, `http://localhost:4173` | The web app's origins, comma-separated. The first is the address links go to               |
| `FOOTNOTE_TRUSTED_PROXIES` | None                                             | The proxies it believes: see [The proxy in front](run-in-production.md#the-proxy-in-front) |
| `MCP_RESOURCE_URL`         | `http://localhost:3000/mcp`                      | The MCP address                                                                            |
| `MCP_DEV_KEY_FILE`         | `.footnote-dev-key.pem`                          | The key for dev tokens. Production refuses dev tokens                                      |

The login server's own settings are on [Agent sign-in settings](agent-sign-in-settings.md#the-login-server-settings).

## Models

| Setting                     | Default   | What it does                                                  |
| --------------------------- | --------- | ------------------------------------------------------------- |
| `MODELS`                    | `mock`    | `mock` is scripted and sends nothing. `live` uses real models |
| `ANTHROPIC_API_KEY`         | None      | The key for the `anthropic` provider                          |
| `ANTHROPIC_AUTH_TOKEN`      | None      | A gateway's bearer token in place of the key                  |
| `ANTHROPIC_BASE_URL`        | Anthropic | Any server that speaks Anthropic's Messages API               |
| `VERCEL_AI_GATEWAY_API_KEY` | None      | The key for the `vercel-gateway` provider                     |
| `OPENAI_API_KEY`            | None      | The key for the `openai` provider; a local server needs none  |
| `OPENAI_BASE_URL`           | OpenAI    | Any server that speaks OpenAI's Chat Completions API          |
| `FOOTNOTE_MODEL`            | None      | `<provider>:<model>` for every role no one has changed yet    |
| `FOOTNOTE_MODEL_PRICES`     | None      | Its `<input>,<output>` price, needed for an unlisted model    |
| `FOOTNOTE_JUDGE_MODEL`      | None      | The test runs' judge, the same way, with `_PRICES` as well    |

With `live`, each role's provider and model come from the `models.*` settings, and the service refuses to start when a provider, a model or a key is missing, or the provider does not list the model and its setting gives no prices.

Ask answers with one model that reads with Footnote's own read tools, as the person asking ([Ask's loop](evaluations.md#asks-loop)). That model must call tools. What the loop shows is not checked yet beyond its citations. With `MODELS=mock` it runs a scripted reader.

> **Before you go live.** Questions and answers then leave your company to the named provider and the model's vendor. Real company data needs company approval of them first.

## Connectors

| Setting                         | Default | What it does                                                                                                                                                                                           |
| ------------------------------- | ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `CUBE_MODEL_DIR`                | None    | A folder of Cube model files. Unset, the service reads two invented definitions, or in the image outside production, the demo model                                                                    |
| `FOOTNOTE_DOMAIN_OVERRIDES`     | None    | A JSON file: view to domain, for what the model leaves unnamed                                                                                                                                         |
| `CUBE_RENAMES_FILE`             | None    | A JSON file of renamed members, old id to new id                                                                                                                                                       |
| `CUBE_VIEWS_FILE`               | None    | A JSON list of the Cube views to read, such as `["orders", "revenue"]`, until an admin chooses them in the app. Unset, every view; empty, none ([views](connectors/cube.md#choose-the-views-it-reads)) |
| `CUBE_COMPILE_TIMEOUT_SECONDS`  | `120`   | How long Cube's compiler may take                                                                                                                                                                      |
| `CUBE_COMPILE_MEMORY_MB`        | `1024`  | The memory Cube's compiler may use                                                                                                                                                                     |
| `FOOTNOTE_SERVER_FOLDERS`       | None    | A JSON object of connector ids to folders on the server                                                                                                                                                |
| `FOOTNOTE_EGRESS_PRIVATE_HOSTS` | None    | Hosts on a private network connectors may reach over https, comma-separated                                                                                                                            |
| `FOOTNOTE_SECRETS_DIR`          | None    | The folder that keeps the tokens of sources added in Integrations                                                                                                                                      |

`FOOTNOTE_SERVER_FOLDERS` looks like `{"dbt-metricflow":"/srv/dbt/target"}`. The folder is read by that connector as the server's own source, and the demo definitions stop. In Docker, share the folder into the container and name its path there.

One definitions integration is on at a time. If the server names more than one definitions folder (`CUBE_MODEL_DIR` and an entry in `FOOTNOTE_SERVER_FOLDERS`, or two entries), the service starts, and the source of the first one it reads is on. The sources of the others are registered off: in Settings, Integrations, turn the one on off, then turn another on.

A connector that cannot read a folder stops the service at start. A folder that is not there shows as a failed read in Settings, Integrations.

> **Moving off a server folder.** Turn the server's source off in Settings, Integrations, then connect the new source. Its first read takes over the definitions it shares. A server source taken out of the configuration stays in Integrations: turn it off there before you connect another.

`FOOTNOTE_EGRESS_PRIVATE_HOSTS` applies to files and APIs read over https, not to Git. An admin in the app cannot add a host: see [Connector security](connectors/security.md#what-a-connector-may-reach).

`FOOTNOTE_SECRETS_DIR` must be outside the repository, and only the server's user may open it (mode 0700). `compose.yaml` sets it to a folder in the `footnote_keys` volume. Unset, no secret is kept, and a source that needs one cannot be added: connecting says so at its first step.

## The product

| Setting                  | Default    | What it does                                                                                                                                               |
| ------------------------ | ---------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `FOOTNOTE_PRODUCT_NAME`  | `Footnote` | The name the app and the help pages say                                                                                                                    |
| `FOOTNOTE_PROFILE_LABEL` | None       | A name for this install, at most 40 characters, in the header and on the sign-in page: see [Private profiles](use-your-own-data.md#private-profiles)       |
| `FOOTNOTE_SUPPORT_EMAIL` | None       | Where Contact support and Report a problem write to. Unset, they open the project's GitHub issues. Read when the app and the docs are built                |
| `FOOTNOTE_METRICS_TOKEN` | None       | Turns on [`/metrics`](watch-the-service.md#metrics). At least 32 characters                                                                                |
| `FOOTNOTE_FIXED_TODAY`   | None       | Pins the service's day for demos and tests. A day in the past is kept whole: Ask's records read it as ending at the end of that day. Refused in production |

Report a problem opens a mail in the person's own mail app, or an issue on GitHub when `FOOTNOTE_SUPPORT_EMAIL` is unset, and sends nothing through the service. An issue leaves out the install's address.
