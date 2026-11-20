---
title: Try the demo
line: The quick start. Install the demo on your computer with Docker, ask it a question, and connect Claude Code to it.
group: Start
order: 1
reviewed: 2026-11-20
---

The quick start: install Footnote on your own computer with its demo, ask the question the demo is built around, and connect Claude Code to it. You need Docker, and the first start can take ten minutes.

## Install and start it

You need Docker Engine 25 or later with Compose v2: Docker Desktop, Colima or Docker on Linux.

```sh
git clone https://github.com/Fredehagelund92/footnote.git && cd footnote
docker compose up
```

The first start builds the images from the code you cloned and loads the demo, which can take ten minutes. Footnote has not had its first release yet, so there are no published images to pull instead.

It runs on your computer with invented data and calls no AI service. Ctrl+C stops it, and `docker compose down --volumes` also removes its data, so the next start loads the demo again. When port 8080 or 3000 is taken, [Install](self-hosting.md#install) says how to move them.

## Ask the question

1. Open http://localhost:8080. You are Ravi Kapoor, the admin of an invented outdoor-gear retailer.
2. Open **Ask** and ask _How did orders in Norway change in October 2026?_
3. The answer is marked Checked and puts the customs rule first.

Checked is one of six [answer lines](help/answer-lines.md): each says what an answer rests on. Here it rests on a context item that Jon Abara, the owner of Sales, checked and published. [Write context](help/write-context.md) shows that item, part by part.

## Look around

**View as**, in the top right corner, shows the same company as Jon Abara, who owns Sales, or as Maria Lindqvist, who can read and suggest. Jon's Inbox holds suggestions waiting for him: [Review a suggestion](help/review-a-suggestion.md) says what he does with them.

## Connect Claude Code

With the demo running:

```sh
claude mcp add --transport http footnote http://localhost:3000/mcp
```

Then run `/mcp` in Claude Code, choose **footnote**, and choose **Authenticate**. Your browser opens Footnote: choose a demo person and **Allow**. Ask it how orders in Norway changed in October 2026. Other agents are in [Connect an agent](help/connect-an-agent.md).

## What next

- [Self-host Footnote on one computer](self-hosting.md): your own data, Ask on a real model, backups and upgrades.
- [Set up your workspace](help/set-up-your-workspace.md): the six steps of a new, empty workspace.
- [What's new](help/changelog.md): the changes people notice, newest first.
