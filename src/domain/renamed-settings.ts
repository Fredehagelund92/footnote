/**
 * The settings that were named `HEED_*` before the product was renamed Footnote and are
 * `FOOTNOTE_*` since, the rest of each name unchanged. For one release an old name still works
 * when its new name is unset, and the process that reads it says so once; the release after that
 * reads the new names only (docs/contributing/internals.md, "Settings named HEED_ before the
 * rename"). This table is the only code that names an old setting:
 * tests/lint/renamed-settings.test.ts fails on one anywhere else. The `CL_` names of before 0.1.0
 * were read for 0.1 only, as promised, and are no longer read.
 */
export const renamedSettings = {
  HEED_API_URL: 'FOOTNOTE_API_URL',
  HEED_ASK_LOOP: 'FOOTNOTE_ASK_LOOP',
  HEED_AUTH: 'FOOTNOTE_AUTH',
  HEED_DEV_PEOPLE_FILE: 'FOOTNOTE_DEV_PEOPLE_FILE',
  HEED_DOMAIN_OVERRIDES: 'FOOTNOTE_DOMAIN_OVERRIDES',
  HEED_EGRESS_PRIVATE_HOSTS: 'FOOTNOTE_EGRESS_PRIVATE_HOSTS',
  HEED_EMAIL: 'FOOTNOTE_EMAIL',
  HEED_FIGURE_OVERRIDES: 'FOOTNOTE_FIGURE_OVERRIDES',
  HEED_FIXED_TODAY: 'FOOTNOTE_FIXED_TODAY',
  HEED_LOGIN_SERVER: 'FOOTNOTE_LOGIN_SERVER',
  HEED_MCP_STATE_KEY_FILE: 'FOOTNOTE_MCP_STATE_KEY_FILE',
  HEED_METRICS_TOKEN: 'FOOTNOTE_METRICS_TOKEN',
  HEED_OAUTH_CONNECTION_DAYS: 'FOOTNOTE_OAUTH_CONNECTION_DAYS',
  HEED_OAUTH_CONSENT_URL: 'FOOTNOTE_OAUTH_CONSENT_URL',
  HEED_OAUTH_DYNAMIC_REGISTRATION: 'FOOTNOTE_OAUTH_DYNAMIC_REGISTRATION',
  HEED_OAUTH_ISSUER: 'FOOTNOTE_OAUTH_ISSUER',
  HEED_OAUTH_PREVIOUS_KEY_FILES: 'FOOTNOTE_OAUTH_PREVIOUS_KEY_FILES',
  HEED_OAUTH_REFRESH_IDLE_HOURS: 'FOOTNOTE_OAUTH_REFRESH_IDLE_HOURS',
  HEED_OAUTH_SIGNING_KEY_FILE: 'FOOTNOTE_OAUTH_SIGNING_KEY_FILE',
  HEED_OIDC_ADMIN_GROUPS: 'FOOTNOTE_OIDC_ADMIN_GROUPS',
  HEED_OIDC_CLIENT_ID: 'FOOTNOTE_OIDC_CLIENT_ID',
  HEED_OIDC_CLIENT_SECRET_FILE: 'FOOTNOTE_OIDC_CLIENT_SECRET_FILE',
  HEED_OIDC_GROUPS_CLAIM: 'FOOTNOTE_OIDC_GROUPS_CLAIM',
  HEED_OIDC_ISSUER: 'FOOTNOTE_OIDC_ISSUER',
  HEED_OIDC_MEMBER_GROUPS: 'FOOTNOTE_OIDC_MEMBER_GROUPS',
  HEED_OIDC_NAME: 'FOOTNOTE_OIDC_NAME',
  HEED_OIDC_REDIRECT_URL: 'FOOTNOTE_OIDC_REDIRECT_URL',
  HEED_OIDC_SCOPES: 'FOOTNOTE_OIDC_SCOPES',
  HEED_ORIGIN: 'FOOTNOTE_ORIGIN',
  HEED_PRODUCT_NAME: 'FOOTNOTE_PRODUCT_NAME',
  HEED_PROFILE_LABEL: 'FOOTNOTE_PROFILE_LABEL',
  HEED_SECRETS_DIR: 'FOOTNOTE_SECRETS_DIR',
  HEED_SERVER_FOLDERS: 'FOOTNOTE_SERVER_FOLDERS',
  HEED_SESSION_IDLE_HOURS: 'FOOTNOTE_SESSION_IDLE_HOURS',
  HEED_SESSION_MAX_DAYS: 'FOOTNOTE_SESSION_MAX_DAYS',
  HEED_SUPPORT_EMAIL: 'FOOTNOTE_SUPPORT_EMAIL',
  HEED_TRUSTED_PROXIES: 'FOOTNOTE_TRUSTED_PROXIES',
  HEED_URL: 'FOOTNOTE_URL',
  HEED_WEB_ORIGINS: 'FOOTNOTE_WEB_ORIGINS',
  HEED_WEB_READ_LOOPBACK: 'FOOTNOTE_WEB_READ_LOOPBACK',
} as const

export type OldSettingName = keyof typeof renamedSettings

export type Environment = Record<string, string | undefined>

const isSet = (value: string | undefined) => value !== undefined && value !== ''

/**
 * The environment with each new setting taken from its old name when only the old one is set (an
 * empty value counts as unset, as `.env` files write them), and the old names it took. A new name
 * that is set always wins. When neither name is set, `FOOTNOTE_DEFAULT_` plus the rest of the name
 * supplies the value, so the image and compose.yaml can ship a default that an operator's old name
 * still overrides, with its warning. The 0.1.0 compose.yaml shipped those as `HEED_DEFAULT_`, which
 * still count for this release, as old names.
 */
export function withRenamedSettings(environment: Environment): {
  environment: Environment
  oldNames: string[]
} {
  const renamed = { ...environment }
  const oldNames: string[] = []
  for (const [oldName, newName] of Object.entries(renamedSettings) as [OldSettingName, string][]) {
    if (isSet(environment[newName])) continue
    if (isSet(environment[oldName])) {
      renamed[newName] = environment[oldName]
      oldNames.push(oldName)
      continue
    }
    const shippedName = newName.replace(/^FOOTNOTE_/, 'FOOTNOTE_DEFAULT_')
    if (isSet(environment[shippedName])) {
      renamed[newName] = environment[shippedName]
      continue
    }
    const formerShippedName = oldName.replace(/^HEED_/, 'HEED_DEFAULT_')
    if (isSet(environment[formerShippedName])) {
      renamed[newName] = environment[formerShippedName]
      oldNames.push(formerShippedName)
    }
  }
  return { environment: renamed, oldNames }
}

/** The one warning line about old names in use: each with its new name, never a value. */
export function renamedSettingsWarning(oldNames: readonly string[]): string {
  const names = oldNames
    .map((name) => `${name} is now ${name.replace(/^HEED_/, 'FOOTNOTE_')}`)
    .join(', ')
  return `Renamed settings: ${names}. The old names work in this release only (docs/operations.md, "Settings that started with HEED_").`
}
