---
title: Try the demo
line: The quick start. Install the demo on your computer with Docker, ask it a question, and connect Claude Code to it.
group: Start
order: 1
reviewed: 2026-11-20
---

The quick start: install Footnote on your own computer with its demo, ask the question the demo is built around, and connect Claude Code to it. You need Docker, and the first start can take ten minutes.

> **For trying it on one computer, not for production use.** Anyone who reaches this setup can sign in as an admin, the database trusts every connection in its container network, and nothing is encrypted in transit. Keep both ports on this computer, as `compose.yaml` does, and put no company data in it that this computer may not hold.

## Install and start it

You need Docker Engine 25 or later with Compose v2: Docker Desktop, Colima or Docker on Linux.

```sh
git clone https://github.com/Fredehagelund92/footnote.git && cd footnote
docker compose up
```

The first start builds the images from the code you cloned and loads the demo, which can take ten minutes. Footnote has not had its first release yet, so there are no published images to pull instead.

It runs on your computer with invented data and calls no AI service. Ctrl+C stops it, and `docker compose down --volumes` also removes its data, so the next start loads the demo again.

To check it from another terminal, `docker compose ps` shows each part `healthy`, and `docker compose logs footnote` shows what the start did.

## Ask the question

1. Open http://localhost:8080. You are Ravi Kapoor, the admin of an invented outdoor-gear retailer.
2. Open **Ask** and ask _How did orders in Norway change in October 2026?_
3. The answer is marked Checked and puts the customs rule first.

Checked is one of six [answer lines](help/answer-lines.md): each says what an answer rests on. Here it rests on a context item that Jon Abara, the owner of Sales, checked and published. [Write context](help/write-context.md) shows that item, part by part.

## Look around

The demo is a retailer that sells in twelve countries: its people, domains and context items with their history, suggestions waiting for review, and the questions agents asked over the past weeks.

**View as**, in the top right corner, shows the same company as Jon Abara, who owns Sales, or as Maria Lindqvist, who can read and suggest. Jon's Inbox holds suggestions waiting for him: [Review a suggestion](help/review-a-suggestion.md) says what he does with them. Sign out to pick any other demo person.

`compose.yaml` runs the service in development mode for the demo's people picker, where anyone can sign in as anyone. The service image on its own starts in production mode, with company sign-in: see [Run in production](run-in-production.md).

## Connect Claude Code

With the demo running:

```sh
claude mcp add --transport http footnote http://localhost:3000/mcp
```

Then run `/mcp` in Claude Code, choose **footnote**, and choose **Authenticate**. Your browser opens Footnote: choose a demo person and **Allow**. Ask it how orders in Norway changed in October 2026. Other agents are in [Connect an agent](help/connect-an-agent.md).

## Its settings

Set these in the shell, before `docker compose up`:

| Setting             | Default | What it does                                                                                                        |
| ------------------- | ------- | ------------------------------------------------------------------------------------------------------------------- |
| `FOOTNOTE_WEB_PORT` | `8080`  | The web app's port on this computer                                                                                 |
| `FOOTNOTE_PORT`     | `3000`  | The service's port on this computer, where agents connect (`/mcp`)                                                  |
| `SEED_DEMO`         | `on`    | Loads the demo into a new, empty database                                                                           |
| `CUBE_MODEL_DIR`    | Unset   | Your own Cube model's folder, read only: see [Use your own data](use-your-own-data.md)                              |
| `DBT_MANIFEST_DIR`  | Unset   | The folder of your dbt project's `semantic_manifest.json`, read only: see [Use your own data](use-your-own-data.md) |
| `MODELS`            | Unset   | `live` answers Ask and the test runs on a real model: see [Choose a model provider](model-providers.md)             |

When 8080 or 3000 is taken by another program, move them, as in `FOOTNOTE_WEB_PORT=8081 FOOTNOTE_PORT=3001 docker compose up`. Docker Desktop refuses a taken port with an error. Colima may say nothing, and the other program then answers on that port. An agent then connects to the new service port, such as `http://localhost:3001/mcp`.

## From the published images

```sh
docker compose -f compose.yaml -f compose.images.yaml up
```

This pulls the images of the release your checkout names instead of building them, which takes about two minutes. They can be behind the code you cloned. The images are not published until the first release, so until then the command is refused: run `docker compose up`, which builds them from your checkout.

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
- **Your own definitions after the demo.** The start stops with `holds the demo`, so your names are not mixed into the demo company. Run `docker compose down --volumes`, which deletes the demo's data, then start again with your folder named.

## What next

- [Use your own data](use-your-own-data.md): your own semantic layer, with no demo data.
- [Choose a model provider](model-providers.md): Ask on a real model.
- [Back up, restore and upgrade](back-up-restore-and-upgrade.md): keep what people wrote.
- [Set up your workspace](help/set-up-your-workspace.md): the four steps of a new, empty workspace.
- [What's new](help/changelog.md): the changes people notice, newest first.
