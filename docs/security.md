---
title: Security
line: What is scanned on every change, what leaves the service, and where to report a security problem.
group: Run the service
order: 11
reviewed: 2026-11-20
---

What is scanned on every change, what leaves the service, and where to report a security problem.

## What is scanned

The scans run on every pull request, on `main` and every night, whatever changed, because a new advisory can fail an unchanged lockfile. A change cannot merge until they pass.

| Scan        | What it checks                                                                 |
| ----------- | ------------------------------------------------------------------------------ |
| Signatures  | The registry signature of every installed package, with `npm audit signatures` |
| OSV-Scanner | Every locked dependency against the OSV database, with reviewed exceptions     |
| gitleaks    | Every commit, for secrets and for files from a private profile                 |

## What leaves the service

- **To a model.** With `MODELS=live`, Ask and the test runs send the model provider you choose the chat, the items they read and their owners' names, never an e-mail address. Without it, scripted models answer and nothing is sent. [What leaves this computer](model-providers.md#what-leaves-this-computer) has the whole list, and who receives it for each provider.
- **To the tools you connect.** A connector reaches only the hosts it declares, over https, and only reads: nothing is written back to the tool. See [Connector security](connectors/security.md).
- **To a page someone links.** Draft from text opens a public https page a person pastes, on port 443, as one anonymous request: no cookie, no sign-in. It never opens a private address, a sign-in page or a link that carries a key, and keeps only the link and one sentence. See [Links people paste](run-in-production.md#links-people-paste).
- **To agents.** An agent reads only published context: a person's agent only what that person may read, and an access key only what everyone may read. See [Connect an agent by hand](reference/connect-by-hand.md#sign-in-as-yourself).

## Report a problem

Report a security problem privately, never in a public issue: the [security policy](../SECURITY.md) says how, what to include and what happens next.

## Private profiles

Trying it on your own company's data, keep it in a private profile, so no file from it can reach the repository: see [Private profiles](use-your-own-data.md#private-profiles).

## The restore drill

The drill that proves a backup restores is in [Back up, restore and upgrade](back-up-restore-and-upgrade.md#the-restore-drill).
