---
title: Write with your agent
line: Tell Claude or another agent what happened, and it writes the context item with you, as your draft.
group: Write and review
order: 2
minutes: 3
reviewed: 2026-11-27
open:
  label: Write context
  href: /context/new
---

Tell Claude or another agent what happened, and it writes the context item with you. It saves it as your draft, you both change the same draft, and nothing is sent until you send it.

## Before you start

Connect your agent once, as [Connect an agent](connect-an-agent.md) says. It writes only your own drafts, as you, with write_draft, and reads them back with read_draft. An admin can switch either off for an agent in Agents and access.

## Start from the app

Open **Context** and choose **Write context**. In the editor's More menu, an item names your agent:

- Write with Claude opens Claude's app on a new chat, with the prompt in the box. Read it, and send it.
- Write with Cursor, or the name of another agent you connected, copies the prompt for you to paste into it. An agent that reports only a technical name, such as a proxy, shows as Write with your agent.
- Write with your agent, when none of yours may write a draft yet, opens Connect an agent.

<!-- include write-prompt -->

```text title="What Write with Claude sends"
Write a context item with me. Ask me what happened, when, and where it is written down, two questions at a time at most. Then save it as my draft with write_draft and give me the link. I may change the draft there too, so read it with read_draft before each change. Don't send it: I send it for review when it is ready.
```

<!-- /include -->

The same button is under a Not found answer in Ask, for an owner of its domain. There the prompt names what the item is about, its metrics, markets and dates, and never the question anyone asked. On a draft you saved, it asks your agent to go on with that draft.

## Start from your agent

Just say it in the chat, such as: Write a context item about the stop in Norway; the customs notice is attached. In Claude Code, the prompt is also a command: type /footnote:write_context, and what it is about.

## Work on it together

Your agent asks what it needs, two questions at a time at most, saves the draft and gives you its link. Open it beside the chat. Only you see it, as with any draft of yours, and agents answering questions never get it.

Change what you like there, then write to your agent. It reads the draft again before each change, so it keeps your words and changes only the rest.

Your agent sees your changes only when you write to it. It looks again then, not while you type.

When it is ready, publish it in a domain you own, or send it to the domain's owners, from the draft's page, as [Write context](write-context.md) says. Your agent never sends it on its own.

## In Claude's app, use a Project

Claude's app has no instructions file. In a Project, open its instructions and paste the line that Connect an agent gives under Claude, so Claude checks your context first in every chat of that Project.
