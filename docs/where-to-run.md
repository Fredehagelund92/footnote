---
title: Where to run Footnote
line: Docker Compose, a cloud host or container platform, or Vercel for the demo, and what each one asks of you.
group: Run the service
order: 1
reviewed: 2026-11-05
---

Footnote has three parts: the service, the web app and a PostgreSQL 18 database. There are three ways to
run them. Docker Compose is the default, and [Try the demo](try-the-demo.md) uses it.
To run Footnote for your own team, run the same images on a host you choose. Vercel with Neon is only
for the demo.

|                          | Docker Compose                                                  | A cloud host or container platform                                                  | Vercel with Neon                                                        |
| ------------------------ | --------------------------------------------------------------- | ----------------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| What it is for           | Trying Footnote on one computer                                 | Running Footnote for your own team, on AWS, Railway, Fly or another host            | The demo, and nothing else                                              |
| What you run             | `docker compose up`: PostgreSQL 18, the service and the web app | The service image, the web image and a managed PostgreSQL 18, behind an https proxy | A Vercel project with the service as a function, and a database on Neon |
| What you manage yourself | The computer, Docker, and the backups                           | The database, the https proxy, the keys, sign-in, backups and upgrades              | The demo's snapshot, its roles and its settings                         |
| What has been tested     | CI starts it with the demo                                      | CI boots the images in production mode. No named host has been tested               | Tests build the function and call it, without deploying it              |

## Docker Compose

[Try the demo](try-the-demo.md) installs it, [Use your own data](use-your-own-data.md) runs it on your own
semantic layer, and [Back up, restore and upgrade](back-up-restore-and-upgrade.md) keeps what people
wrote. `compose.yaml` sets `NODE_ENV` to `development`, which turns on the demo's people picker, so
keep both ports on this computer.

## A cloud host or container platform

This is the way to run Footnote for real people. It asks three things of a host: it runs containers,
keeps a folder between restarts, and ends https in front of them.

> **Not tested on a named host.** CI boots both images in production mode, against a stand-in
> sign-in provider and a PostgreSQL 18 container. The project has not tested them on AWS, Railway,
> Fly or a managed PostgreSQL, so this page gives no steps for any of them. Expect to work out the
> host's own part yourself.

[Run in production](run-in-production.md) has the steps, the settings and the proxy in front,
[the database guide](../db/README.md) says how to set up the roles, and
[Set up company sign-in](company-sign-in.md) has every sign-in setting.

### The proxy in front

The proxy in front of the containers is now in [Run in production](run-in-production.md#the-proxy-in-front).

## Vercel with Neon

This runs Footnote's demo only. [Run the demo on Vercel and Neon](vercel.md) has the whole setup. It is
not a way to run Footnote for your own team.
