---
title: Connect an agent by hand
line: The MCP address, each agent's own steps, access keys for bots, and the limits on what an agent may send.
group: Reference
order: 3
reviewed: 2026-11-20
---

Add the MCP server to an agent yourself, or give a bot or a script its own way in. For a person's agent, the [prompt](../help/connect-an-agent.md) does all of this for you. What each tool takes and gives back is in [Agent tools](../help/tools.md).

## The address

The MCP server is at `/mcp` on the service's address, the setting `MCP_RESOURCE_URL`. With `docker compose up` it is `http://localhost:3000/mcp`.

Settings, Agents and access, shows the address of your workspace.

## A person's agent

Each agent has its own steps, the same as in Agents and access under Prefer to do it by hand, where they carry your workspace's address. Here they use the address that `docker compose up` serves. The agent signs in as you, with no key to copy, as [Sign in as yourself](#sign-in-as-yourself) says.

<!-- tabs -->

### Claude Code

1. Run this in a terminal:

   ```sh
   claude mcp add --transport http footnote http://localhost:3000/mcp
   ```

2. Add this line to CLAUDE.md if the project has one, otherwise AGENTS.md, so it checks first:

   ```text
   Before you answer a question about company data, call get_context first and use what it returns.
   ```

3. In Claude Code, type `/mcp`, choose the server you added, press Authenticate, and approve the connection in the browser.

### Claude, the app

1. Copy the address, `http://localhost:3000/mcp`.
2. In Claude, open Customize, then Connectors. Press + Add, then Add custom connector, and paste the address.
3. Press Add, then Connect, and approve the connection in the browser.
4. On a Team or Enterprise plan an owner adds it under Organization settings, Connectors; then each person presses Connect.

### Cursor

Agents and access has an Add to Cursor link that does the first step for you.

1. Add this to `.cursor/mcp.json`:

   ```json
   { "mcpServers": { "footnote": { "url": "http://localhost:3000/mcp" } } }
   ```

2. Add this line to AGENTS.md, so it checks first:

   ```text
   Before you answer a question about company data, call get_context first and use what it returns.
   ```

3. In Cursor's settings, under MCP, press Connect and approve the connection in the browser.

### VS Code

Agents and access has an Install in VS Code link that does the first step for you.

1. Add this to `.vscode/mcp.json`:

   ```json
   { "servers": { "footnote": { "type": "http", "url": "http://localhost:3000/mcp" } } }
   ```

2. Add this line to AGENTS.md, so it checks first:

   ```text
   Before you answer a question about company data, call get_context first and use what it returns.
   ```

3. Start the server from the file, and approve the connection in the browser.

### Codex

1. Run this in a terminal, and approve the connection in the browser it opens:

   ```sh
   codex mcp add footnote --url http://localhost:3000/mcp
   ```

2. Add this line to AGENTS.md, so it checks first:

   ```text
   Before you answer a question about company data, call get_context first and use what it returns.
   ```

3. If the browser did not open, run `codex mcp login footnote` and approve the connection in the browser.

### ChatGPT

1. Copy the address, `http://localhost:3000/mcp`.
2. In ChatGPT on the web, open Settings, Apps and Connectors, Advanced settings, and turn on Developer mode.
3. Press Create, name it, paste the address, choose OAuth (sign in through the browser), and approve the connection in the browser.
4. On a Business or Enterprise plan an admin turns on connectors first.

### Other agents

1. Copy the address, `http://localhost:3000/mcp`.
2. Add it where your agent lists its connectors or MCP servers, over HTTP.
3. Approve the connection in the browser when it asks. If the agent reads an instructions file, add the line from the other tabs to it.

<!-- /tabs -->

## Sign in as yourself

1. Most agents open the sign-in by themselves. In Claude Code, run `/mcp` and choose Authenticate.
2. Your browser opens. Sign in, read which app asks and what it may do, then choose Allow or Don't allow.
3. The browser goes back to the agent, and its tools work as you.

On a computer running the demo, sign-in means choosing a person from the demo's people.

The sign-in screen lists the scopes the agent asks for, all three unless it asks for fewer:

| Scope      | What it allows                                        |
| ---------- | ----------------------------------------------------- |
| `read`     | Read context: the published context items you can see |
| `feedback` | Report what is missing or wrong, after you say yes    |
| `propose`  | Suggest changes, in your name, after you say yes      |

An agent always reads what is published now, never drafts or comments. The request log keeps which family of app called and never who it acted for.

The agent renews its own access, so a connection lasts 30 days after sign-in, or until it goes 7 days unused. Then the agent asks you to sign in again. Whoever runs the service can change both: see [Agent sign-in settings](../agent-sign-in-settings.md).

> **Agents that cannot sign in.** An agent needs a client ID metadata document or dynamic client registration. One with neither uses an access key, as the next section says.

## A bot or a scheduled job

A job that runs on its own, with nobody there to approve a sign-in, uses an access key. Admins make them:

1. In Settings, Agents and access, open Tools and access keys.
2. Press Create an access key, give it a name, such as what the job does, then press Create and Copy. The key is shown once: keep it where the job keeps its secrets.
3. Give the job the MCP address, with the key as its bearer token:

   ```text
   Authorization: Bearer hak_...
   ```

A key reads published context and sends reports. It names no person, so it never sends a suggestion: a key can never have suggest_context.

It shows in Connected agents by its name, with who made it and when it was last used. Rename it, or switch its tools off for a while, in its Details. A key has no end date, and it keeps working after the person who made it leaves, so delete it when the job ends. Deleting it ends it at once.

## On your own computer, with a dev token

Running the service from source with `npm run dev:server`, you can skip sign-in with a dev token:

```sh
claude mcp add --transport http footnote http://localhost:3000/mcp \
  --header "Authorization: Bearer $(npm run --silent token:dev)"
```

- A token lasts eight hours. Make a new one when it ends.
- `--client <label>` makes one for another client label, which works once an admin has added and enabled that label.
- The first run makes a signing key, `.footnote-dev-key.pem`, which git ignores.
- Production refuses dev tokens.

## What a request needs

| Rule            | What happens                                                                  |
| --------------- | ----------------------------------------------------------------------------- |
| Method          | POST to `/mcp`. `GET` and `DELETE` answer 405                                 |
| Bearer token    | Every request needs one                                                       |
| Host and origin | They must name this computer or the MCP address's own host. Others answer 403 |
| Batches         | An array of calls answers 400, so each call meets its own limits              |
| Sessions        | None. The server keeps nothing between calls                                  |

The server speaks the two latest revisions of the MCP protocol.

## Limits

Over a limit, the answer is 429 with `Retry-After` in seconds, and its text says how many seconds to wait.

| Limit                                   | Default a minute |
| --------------------------------------- | ---------------- |
| Calls by one person                     | 30               |
| Calls by one client label               | 120              |
| `get_context` calls by one client label | 120              |
| `report` calls by one client label      | 20               |
| Other messages by one person            | 120              |

Only tool calls count as calls. Starting a session and listing the tools are other messages, so an agent that opens many sessions at once still gets the tools.

Admins change these with the settings `limits.mcp_requests_per_minute` and `limits.mcp_rate_per_minute`, and a change applies at the next request: see [Administer the service](../administration.md#change-a-setting). Each instance counts on its own.
