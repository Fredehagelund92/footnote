---
title: Self-host Footnote on one computer
line: Run it with docker compose on one computer, back it up, restore it, upgrade it and roll an upgrade back.
group: Run the service
order: 2
reviewed: 2026-11-18
---

Run it with `docker compose` on one computer, back it up, restore it, upgrade it and roll an upgrade back. To run it anywhere else, see [Where to run Footnote](where-to-run.md).

> **For local evaluation, not for production use.** Anyone who reaches this setup can sign in as an admin, the database trusts every connection in its container network, and nothing is encrypted in transit. Keep both ports on this computer, as `compose.yaml` does, and put no company data in it that this computer may not hold.

## Install

You need Docker Engine 25 or later with Compose v2: Docker Desktop, Colima or Docker on Linux.

```sh
git clone https://github.com/Fredehagelund92/footnote.git && cd footnote
docker compose up -d --wait   # builds the images, prepares the database, waits until all is ready
```

Then open http://localhost:8080. The first start builds both images and loads the demo, which can take ten minutes or more.

To check it, `docker compose ps` shows each part `healthy`, and `docker compose logs footnote` shows what the start did.

| Setting             | Default | What it does                                                                                       |
| ------------------- | ------- | -------------------------------------------------------------------------------------------------- |
| `FOOTNOTE_WEB_PORT` | `8080`  | The web app's port on this computer                                                                |
| `FOOTNOTE_PORT`     | `3000`  | The service's port on this computer, where agents connect (`/mcp`)                                 |
| `SEED_DEMO`         | `on`    | Loads the demo into a new, empty database                                                          |
| `CUBE_MODEL_DIR`    | Unset   | Your own Cube model's folder, read only ([Use your own data](#use-your-own-data))                  |
| `MODELS`            | Unset   | `live` answers Ask and the test runs on a real model ([Ask on a real model](#ask-on-a-real-model)) |

When 8080 or 3000 is taken by another program, move them, as in `FOOTNOTE_WEB_PORT=8081 FOOTNOTE_PORT=3001 docker compose up`. Docker Desktop refuses a taken port with an error. Colima may say nothing, and the other program then answers on that port. An agent then connects to the new service port, such as `http://localhost:3001/mcp`.

## The demo

The demo is an invented outdoor-gear retailer that sells in twelve countries: its people, domains and context items with their history, suggestions waiting for review, and the questions agents asked over the past weeks. Nothing leaves this computer, and no AI service is called.

It opens as Ravi Kapoor, the admin. **View as**, in the top right corner, shows the same company as Jon Abara, who owns Sales, or as Maria Lindqvist, who can read and suggest. Sign out to pick any other demo person.

Ctrl+C stops it. `docker compose down --volumes` also removes its data, so the next start loads the demo again.

`compose.yaml` runs the service in development mode for the demo's people picker, where anyone can sign in as anyone. The service image on its own starts in production mode, with company sign-in: see [Run the image in production mode](operations.md#run-the-image-in-production-mode).

### Connect Claude Code to the demo

With the demo running:

```sh
claude mcp add --transport http footnote http://localhost:3000/mcp
```

Then run `/mcp` in Claude Code, choose **footnote**, and choose **Authenticate**. Your browser opens Footnote: choose a demo person and **Allow**. Ask it how orders in Norway changed in October 2026. Other agents are in [Connect an agent](help/connect-an-agent.md).

### From the published images

```sh
docker compose -f compose.yaml -f compose.images.yaml up
```

This pulls the images of the latest release instead of building them, which takes about two minutes. They can be behind the code you cloned. The images are not published until the first release, so until then the command is refused: run `docker compose up`, which builds them from your checkout.

## Use your own data

Footnote reads metric and dimension names from your semantic layer, and never writes to it. For a [Cube](https://cube.dev) model, name its folder:

```sh
CUBE_MODEL_DIR=/path/to/your/cube/model docker compose up
```

With your own model Footnote starts empty, with no demo data. The sign-in page offers the sample people of [the local people file](../db/seed/people.local.yml). Sign in as Ravi Kapoor, the admin, and follow the setup checklist in the Inbox: add your domains, then publish the names each read makes, on one card. Your context applies to those names.

On a Mac the folder must be one Docker shares, or Footnote refuses to start and says so. See [the Cube connector](connectors/cube.md).

To sign in as yourself, add your name and email to the top of [the local people file](../db/seed/people.local.yml) with `roles: [administrator]`, then start with `docker compose up --build`, so the image takes the file in.

For dbt, Footnote reads the semantic manifest that `dbt parse` writes, from a link, object storage, a Git repository or a folder: see [the dbt MetricFlow connector](../src/connectors/dbt-metricflow/README.md). Tokens and signed links stay in a secret store in Docker's `footnote_keys` volume.

## Ask on a real model

The demo answers Ask on scripted models: they list what is written, and nothing leaves this computer. To answer on Claude, start it with an [Anthropic API key](https://console.anthropic.com/settings/keys):

```sh
MODELS=live ANTHROPIC_API_KEY=sk-ant-... docker compose up
```

That is the only step. Ask and the test runs answer on Claude Sonnet 5.5, and the test runs are judged by Claude Opus 5.5.

Another provider is one line too. `FOOTNOTE_MODEL` names `<provider>:<model>` for every role, and `FOOTNOTE_MODEL_PRICES` gives its price in US dollars per million tokens, input then output:

```sh
# OpenAI
MODELS=live OPENAI_API_KEY=sk-... FOOTNOTE_MODEL=openai:gpt-6-luna \
  FOOTNOTE_MODEL_PRICES=0.1,0.5 docker compose up
# OpenRouter, or another hosted server that speaks OpenAI's API
MODELS=live OPENAI_BASE_URL=https://openrouter.ai/api/v1 OPENAI_API_KEY=sk-or-... \
  FOOTNOTE_MODEL=openai:anthropic/claude-sonnet-5.5 FOOTNOTE_MODEL_PRICES=2,10 docker compose up
# Ollama on this computer: nothing leaves it
MODELS=live OPENAI_BASE_URL=http://host.docker.internal:11434/v1 \
  FOOTNOTE_MODEL=openai:gpt-oss:20b FOOTNOTE_MODEL_PRICES=0,0 docker compose up
# A gateway that speaks Anthropic's API, such as LiteLLM, with a bearer token
MODELS=live ANTHROPIC_BASE_URL=http://host.docker.internal:4000/v1 \
  ANTHROPIC_AUTH_TOKEN=sk-... docker compose up
```

The line sets only the roles no one has changed. After that, an admin's `models.*` settings decide ([Change a setting](administration.md#change-a-setting), [Choose a model provider](model-providers.md)). With one model, the test runs' judge is that same model. Name another with `FOOTNOTE_JUDGE_MODEL` and `FOOTNOTE_JUDGE_MODEL_PRICES`. Models other than Claude work, but their answers are less complete.

**The model check.** Once it starts, the service makes three tiny calls on each role's model: a tool call, a call told to use no tool, and an answer in a set JSON shape. A model that cannot call tools still answers Ask, without its tools, and test runs refuse to start on it.

The log, and Settings, Advanced under Models, say what each check found. `docker compose exec footnote npm run models:check` makes it again.

**What leaves this computer.** For each question, Ask sends Anthropic the chat so far, the text of the items it reads, their owners' names, and whether the person asking is an admin and which domains they own. It sends no e-mail address and not the asker's name. Test runs send their test questions and the items they read.

On another provider, that provider receives the same, and the model's vendor too when the provider passes it on. A model server on this computer sends nothing out. Put no company data in until your company approves the provider.

**What it costs.** On the demo, an Ask question cost about USD 0.02, and at most about USD 0.06. Test runs start only when an admin starts one.

An admin can let them run on their own, every Monday and after a change agents may notice, in Settings, Advanced, Answer tests, which first shows what a run is estimated to cost: two runs of the demo's tests cost USD 1.12.

The service stops calling the model at these limits, which an admin can change:

| Setting                              | Default                                        |
| ------------------------------------ | ---------------------------------------------- |
| `limits.llm_daily_micros_per_person` | USD 2 a person a day                           |
| `limits.llm_feature_monthly_micros`  | USD 250 a month for Ask, and for the test runs |
| `limits.llm_monthly_cap_micros`      | USD 500 a month in all                         |

## What runs

| Part       | What it is                                                                                         | Address                  |
| ---------- | -------------------------------------------------------------------------------------------------- | ------------------------ |
| `db`       | PostgreSQL 18, with all the data, in the volume `footnote_db`                                      | None outside the network |
| `footnote` | The API, the MCP server for agents and the jobs, with keys and the secret store in `footnote_keys` | http://localhost:3000    |
| `web`      | The web app, served by nginx, which forwards `/api/v1` to the service                              | http://localhost:8080    |

A third volume, `footnote_no-model`, stays empty. It stands where your own model's folder goes when you name none.

## If the start goes wrong

- **Your own model's folder arrives empty.** When Docker cannot read the folder, the service refuses to start and says so in `docker compose logs footnote`. On a Mac, Docker Desktop shares only the folders under Settings, Resources, File sharing, and Colima shares your home folder unless told otherwise.
- **The model provider refuses the key.** With `MODELS=live`, the service asks the provider at start whether it takes the key, which costs nothing. A wrong or revoked key is logged as `The model provider anthropic refused the key in ANTHROPIC_API_KEY (HTTP 401)`, and Ask then says the key was refused. The rest of the service works. Start it again with a key that works.
- **The demo is half loaded.** The start stops with `The demo is half loaded` and the cause. The demo is not retried: run `docker compose down --volumes`, then `docker compose up` again.

## What to back up

| What                                  | Where                                   | Why                                                                                       |
| ------------------------------------- | --------------------------------------- | ----------------------------------------------------------------------------------------- |
| The database                          | The volume `footnote_db`                | Everything people wrote and decided, the history log, agents' access and the settings     |
| The keys                              | The volume `footnote_keys`              | Without them every connected agent must sign in again, and sealed drafts cannot be opened |
| The secret store                      | The folder `secrets` in `footnote_keys` | The tokens and signed links of tools connected in Settings. Without them, each read fails |
| Your own Cube model, when you use one | The folder `CUBE_MODEL_DIR` names       | It is only read here. It is yours, and lives wherever you keep it                         |

The keys and the secret store are secrets, so keep their backups where only you can read them. Never copy the database volume's files while it runs.

## Back up

With everything running, from the clone's folder:

```sh
docker compose exec -T footnote sh -c 'pg_dump --format=custom --dbname="$DATABASE_URL_MIGRATE"' > footnote.dump
docker compose exec -T footnote tar -C /var/lib/footnote -cf - . > footnote-keys.tar
```

`footnote.dump` is the whole database, taken in one consistent snapshot while the service keeps running. `footnote-keys.tar` holds the three key files and the secret store. Copy both off this computer.

### Prove the backup restores: the restore drill

```sh
docker compose exec footnote npm run db:restore-drill
```

It takes a backup the same way, restores it into a scratch database, and proves the copy is the same. It then drops the copy and ends with `PASSED` or `FAILED`. See [what it checks](security.md#the-restore-drill).

It takes about a minute on the demo and changes nothing in your database. Run it before every upgrade, and now and then on its own.

## Restore

To bring back a backup, onto this computer or a new one with the same version checked out:

```sh
docker compose down --volumes            # only when replacing what is there: this deletes it
docker compose up -d --wait db
docker compose run --rm --no-deps -e SEED_DEMO=off footnote npm run db:migrate   # makes the roles
docker compose exec -T db dropdb -U postgres footnote
docker compose exec -T db createdb -U postgres --owner=context_layer_owner --template=template0 footnote
docker compose exec -T db pg_restore -U postgres --dbname=footnote --single-transaction --exit-on-error < footnote.dump
docker compose run --rm --no-deps -T footnote tar -C /var/lib/footnote -xf - < footnote-keys.tar
docker compose up -d --wait
```

The third line makes the database roles, which a dump does not carry. The next three lines replace the empty database with the backup.

On the next start, `docker compose logs footnote` says `applied 0 migrations`, and no demo is loaded. Whoever was signed in still is, and agents stay connected, because the keys came back too.

## Upgrade

Database migrations only go forward, and an older version refuses a database a newer one has migrated. So an upgrade starts with a backup that is known to restore.

1. Read the release notes of every version between yours and the new one.
2. [Back up](#back-up) the database and the keys, and run the [restore drill](#prove-the-backup-restores-the-restore-drill). Go on only when it says `PASSED`.
3. Get the new version and start it:

   ```sh
   git fetch --tags && git checkout <new version>
   docker compose build
   docker compose up -d --wait
   ```

4. Check `docker compose logs footnote`, which says how many migrations it applied. Open the web app and see your data.

The service applies new migrations before it serves, each in a transaction of its own. If one fails, the service stops with the reason. That migration's changes are not kept, and the ones before it are. Fix the cause and start again, or [roll back](#roll-back).

## Roll back

Rolling back means going back to the backup from step 2 of the upgrade. Anything written since is lost, so roll back soon or not at all.

```sh
git checkout <previous version>
docker compose build
```

Then [restore](#restore) `footnote.dump` and `footnote-keys.tar` from before the upgrade. Without a restore, the previous version stops with `Migration history differs at ...`, on purpose.

## Running from source instead

With [`npm run dev:server`](operations.md#run-the-service-locally) the same parts live elsewhere:

| Part             | Where it is                                                                                                          |
| ---------------- | -------------------------------------------------------------------------------------------------------------------- |
| The database     | The one `DATABASE_URL_MIGRATE` names in `.env.local`                                                                 |
| The keys         | The files `MCP_DEV_KEY_FILE`, `FOOTNOTE_MCP_STATE_KEY_FILE` and `FOOTNOTE_OAUTH_SIGNING_KEY_FILE` name, in the clone |
| The secret store | The folder `FOOTNOTE_SECRETS_DIR` names, when it is set. Without it, a tool that needs a secret can't connect        |

Back up the database and prove the backup with these, which need PostgreSQL 18's tools on `PATH`:

```sh
pg_dump --format=custom --dbname="$DATABASE_URL_MIGRATE" > footnote.dump
npm run db:restore-drill
```

## The web image

What the `web` image does for a browser:

| What             | How                                                                                              |
| ---------------- | ------------------------------------------------------------------------------------------------ |
| Compression      | Every text file ships gzipped at the highest level, and the service's JSON is gzipped on the way |
| Security headers | A Content-Security-Policy that runs only the app's own scripts, and no framing                   |
| HSTS             | Only when a proxy in front ended TLS and says so with `X-Forwarded-Proto: https`                 |
| Missing files    | A missing file is a real 404. Every other address opens the app                                  |
| For robots       | `robots.txt` keeps search engines out. `llms.txt` gives an agent the documentation as text       |
