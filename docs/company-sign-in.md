---
title: Set up company sign-in
line: Let people sign in to the web app with your company's OpenID Connect provider, and choose who may join.
group: Run the service
order: 4
reviewed: 2026-11-19
---

Let people sign in with your company's OpenID Connect provider: Okta, Microsoft Entra ID, Google, Keycloak, Auth0 or any other that publishes a discovery document. A person's own agent then signs in through the same web session.

SAML providers work through an OIDC broker, such as Keycloak, Dex or the provider's own OIDC bridge. [Service settings](configuration.md#sign-in-and-addresses) has the settings around it, such as `FOOTNOTE_AUTH`.

## Set it up

1. At the provider, register a web application with the authorization code flow, these scopes, and this redirect address:

   ```text
   Redirect address: https://<your address>/api/v1/auth/oidc/callback
   Scopes:           openid email profile
   ```

   To map groups, the ID token must list them: add the provider's groups scope, or in Keycloak a Group Membership mapper on the client with Full group path off. A public client (PKCE, no secret) and a confidential one with a secret both work.

2. Set the three settings below. `FOOTNOTE_AUTH=oidc` is the default in production.

   ```sh
   FOOTNOTE_AUTH=oidc
   FOOTNOTE_OIDC_ISSUER=https://login.example.com
   FOOTNOTE_OIDC_CLIENT_ID=<the client id>
   ```

3. For a confidential client, write the secret to a file only the service's user may read, and name that file. The service refuses a file others may read, and never reads the secret from a setting.

   ```sh
   printf %s "$SECRET" > oidc-secret && chmod 600 oidc-secret
   FOOTNOTE_OIDC_CLIENT_SECRET_FILE=oidc-secret
   ```

4. Invite the first admin, after the service has started once and applied the schema. This prints a link that works for a week:

   ```sh
   FOOTNOTE_WEB_ORIGINS=<your public origin> DATABASE_URL_MIGRATE=<the owner's address> npm run footnote -- invite you@company.example --admin
   ```

   Or name an admin group in `FOOTNOTE_OIDC_ADMIN_GROUPS`. After that, admins invite everyone else in Settings, People.

5. Serve the web app and the service on the same host. One origin behind your proxy is simplest, because the session cookie belongs to that host.

## The settings

| Setting                            | Default                                                  | What it does                                                                                 |
| ---------------------------------- | -------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| `FOOTNOTE_AUTH`                    | `oidc` in production, `dev` elsewhere                    | `oidc`, or a people picker: `dev` locally, `demo` for demos. Production refuses both pickers |
| `FOOTNOTE_OIDC_ISSUER`             | None, required                                           | The provider's issuer, exactly as its discovery document names it                            |
| `FOOTNOTE_OIDC_CLIENT_ID`          | None, required                                           | This app's client id at the provider                                                         |
| `FOOTNOTE_OIDC_CLIENT_SECRET_FILE` | None: a public client                                    | An owner-only file (mode 0600) with a confidential client's secret                           |
| `FOOTNOTE_OIDC_REDIRECT_URL`       | `/api/v1/auth/oidc/callback` on the MCP address's origin | The redirect address registered at the provider                                              |
| `FOOTNOTE_OIDC_SCOPES`             | `openid email profile`                                   | What to ask for. `openid` is required                                                        |
| `FOOTNOTE_OIDC_GROUPS_CLAIM`       | `groups`                                                 | The ID token claim that lists the person's groups                                            |
| `FOOTNOTE_OIDC_ADMIN_GROUPS`       | None                                                     | Groups whose members may sign in without an invite, as an Admin. Comma-separated             |
| `FOOTNOTE_OIDC_MEMBER_GROUPS`      | None                                                     | Groups whose members may sign in without an invite, as a Member. Comma-separated             |
| `FOOTNOTE_OIDC_NAME`               | "your company account"                                   | The provider's name on the sign-in button, such as Okta                                      |
| `FOOTNOTE_SESSION_IDLE_HOURS`      | `12`                                                     | A browser session ends after this many hours unused                                          |
| `FOOTNOTE_SESSION_MAX_DAYS`        | `7`                                                      | A browser session ends this many days after sign-in, used or not                             |

## Who may sign in

- **Someone already linked.** The first sign-in links the account at the provider to the person. A changed address at the provider still signs in the same person.
- **An active person, or an address with an open invite.** The provider must say the address is verified. An invite is accepted at that sign-in, with its role and domains.
- **A member of a mapped group.** They join as a Member, or as an Admin for the admin group. An Admin role the group gave ends when they sign in outside the group, unless no other admin would be left.

Anyone else goes back to the sign-in screen with one plain answer, the same whether the address is unknown, removed or linked to another account.

Someone an admin removed stays out until an admin invites their address again. A group does not bring them back. The invite brings back the same person.

People who signed in with the people picker keep their rows and roles. Their first company sign-in by a matching verified address links their account.

## Known limits

- Signing out ends the session here, not the session at the provider.
- Groups are read from the ID token only. A provider that sends them elsewhere needs a claim mapping there.
- A provider that never says an address is verified signs nobody in, because no account is linked by an unverified address.
- Groups are not used yet to decide who reads which context item.
