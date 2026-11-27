---
title: Agent sign-in settings
line: The login server agents sign in through, how long a sign-in lasts, and how to make and rotate its keys.
group: Run the service
order: 5
reviewed: 2026-11-20
---

The service runs its own login server, so a person's agent signs in as that person with no key to copy. These are its settings and its keys, for whoever runs the service. How a person connects an agent is in [Connect an agent](help/connect-an-agent.md) and [Connect an agent by hand](reference/connect-by-hand.md).

## What a sign-in lasts

| What              | Lasts                                     | Setting                                                       |
| ----------------- | ----------------------------------------- | ------------------------------------------------------------- |
| An access token   | 10 minutes, renewed by the agent          | None                                                          |
| A refresh token   | Until 7 days unused. Each use replaces it | `FOOTNOTE_OAUTH_REFRESH_IDLE_HOURS`                           |
| A connection      | 30 days after sign-in                     | `FOOTNOTE_OAUTH_CONNECTION_DAYS`                              |
| A browser session | 12 hours unused, or 7 days after sign-in  | `FOOTNOTE_SESSION_IDLE_HOURS` and `FOOTNOTE_SESSION_MAX_DAYS` |

When a connection ends, the agent asks the person to sign in again.

## The login server settings

| Setting                               | Default                                                         | What it does                                                                                                                                                 |
| ------------------------------------- | --------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `FOOTNOTE_LOGIN_SERVER`               | `builtin`                                                       | `builtin` runs it here, `external` trusts another login server, and `off` turns agent sign-in off: access keys still work, and dev tokens outside production |
| `FOOTNOTE_OAUTH_ISSUER`               | The origin of `MCP_RESOURCE_URL`                                | The issuer of its tokens. It must be that origin                                                                                                             |
| `FOOTNOTE_OAUTH_CONSENT_URL`          | `/connect/approve` on the first web origin on the issuer's host | The consent page. It must be on an allowed web origin, on the issuer's host                                                                                  |
| `FOOTNOTE_OAUTH_SIGNING_KEY_FILE`     | `.footnote-oauth-key.pem`                                       | The key that signs tokens. Made for you outside production, and required in production                                                                       |
| `FOOTNOTE_OAUTH_PREVIOUS_KEY_FILES`   | None                                                            | Earlier keys, comma-separated, that still verify after a rotation                                                                                            |
| `FOOTNOTE_OAUTH_DYNAMIC_REGISTRATION` | `on` outside production, `off` in production                    | Allows dynamic client registration, which Claude Code uses                                                                                                   |
| `FOOTNOTE_OAUTH_REFRESH_IDLE_HOURS`   | `168`                                                           | A refresh token unused this long expires                                                                                                                     |
| `FOOTNOTE_OAUTH_CONNECTION_DAYS`      | `30`                                                            | A connection ends this many days after sign-in                                                                                                               |
| `MCP_AUTH_ISSUER`                     | None                                                            | With `external`: whose tokens the MCP server accepts                                                                                                         |
| `MCP_AUTH_JWKS_URL`                   | None                                                            | With `external`: where their keys are                                                                                                                        |

Addresses must be https, or http on the same computer only.

## Make the keys

For production, this makes the signing key, readable by its owner only, and keeps one that exists:

```sh
npm run keys:create
```

In containers, run it in the image, onto the volume that keeps the keys, as [Run in production](run-in-production.md#run-the-image-in-production-mode) shows.

To make the signing key yourself:

```sh
openssl genpkey -algorithm ed25519 -out .footnote-oauth-key.pem && chmod 600 .footnote-oauth-key.pem
```

The service refuses a key file others may read. Keep it out of the repository, the images and the logs.

## Rotate the signing key

1. Create a new key, and point `FOOTNOTE_OAUTH_SIGNING_KEY_FILE` at it.
2. List the old file, or its public key, in `FOOTNOTE_OAUTH_PREVIOUS_KEY_FILES`. Make the public key with the command below.

   ```sh
   openssl pkey -in old.pem -pubout
   ```

3. Restart the service. New tokens use the new key, and tokens signed by the old one work until they expire, ten minutes at most.
4. Take the old key off the list.

Connections survive a rotation, because refresh tokens are not signed.

> **If a key leaks.** Rotate without listing the old key. Every access token it signed is refused at once, and agents get new ones with their refresh tokens.

## Known limits

- Rate counts live in one process.
- Agents signed in through another login server, and dev tokens, are not listed in Agents and access.
