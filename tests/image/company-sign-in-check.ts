import { chromium, type Browser, type Page } from '@playwright/test'

/*
  The browser of the company sign-in check (tests/image/company-sign-in.sh): people of the
  invented footnote-demo realm sign in to Footnote in production mode through Keycloak's own login
  page, and each lands as what docs/company-sign-in.md ("Who may sign in") says:

    - Noor Haddad, invited as the first admin with `footnote invite --admin`, opens the link and
      signs in as an Admin.
    - Sam Okafor, in the footnote-admins group, joins as an Admin with no invite.
    - Elias Berg, in the footnote-members group, joins as a Member with no invite.
    - Tove Ek, in the members group but with an address Keycloak has not verified, is turned back.
    - Pia Lund, in no group and not invited, is turned back with the one plain answer.
    - Signing out ends the session here, not at Keycloak: the next sign-in asks no password.

  PUBLIC_ORIGIN, INVITE_LINK and DEMO_PASSWORD come from the script. Each step prints one line;
  the first that fails stops the check with what the page showed.
*/

const origin = process.env.PUBLIC_ORIGIN ?? 'https://footnote.example.test:8443'
const inviteLink = process.env.INVITE_LINK ?? ''
const password = process.env.DEMO_PASSWORD ?? ''
const provider = 'Keycloak'

async function fail(step: string, page: Page): Promise<never> {
  const text = (
    await page
      .locator('body')
      .innerText()
      .catch(() => '')
  ).slice(0, 800)
  throw new Error(`not ok - ${step}\n  at ${page.url()}\n  ${text.replace(/\n+/g, ' / ')}`)
}
async function check(ok: Promise<unknown>, step: string, page: Page) {
  try {
    await ok
  } catch {
    await fail(step, page)
  }
  console.log(`ok - ${step}`)
}

type Session = { person: { name: string; permissions: { roles: string[] } } }
async function session(page: Page): Promise<Session | null> {
  // From the page, so the request takes the browser's way to the public name.
  return page.evaluate(async () => {
    const answer = await fetch('/api/v1/auth/session')
    return answer.ok ? ((await answer.json()) as Session) : null
  })
}

/** Footnote's sign-in screen, then Keycloak's login page with the person's username. */
async function signIn(page: Page, username: string) {
  await page.locator('a', { hasText: `Sign in with ${provider}` }).click()
  await page.waitForURL(/^https:\/\/login\.example\.test:9443\//)
  await page.locator('#username').fill(username)
  await page.locator('#password').fill(password)
  await page.locator('#kc-login').click()
  await page.waitForURL((url) => url.origin === origin, { timeout: 30_000 })
}

async function freshPage(browser: Browser) {
  const context = await browser.newContext({
    ignoreHTTPSErrors: true,
    viewport: { width: 1440, height: 900 },
  })
  return context.newPage()
}

async function joins(browser: Browser, username: string, name: string, admin: boolean) {
  const page = await freshPage(browser)
  await page.goto(origin)
  await check(page.waitForURL(/\/signin$/), `${name} meets the sign-in screen first`, page)
  await signIn(page, username)
  const signedIn = await session(page)
  if (signedIn?.person.name !== name) await fail(`${name} is signed in`, page)
  const roles = signedIn!.person.permissions.roles
  if (roles.includes('administrator') !== admin)
    await fail(`${name} is ${admin ? 'an Admin' : 'a Member'}`, page)
  await check(
    page.getByText(name).first().waitFor(),
    `${name} signs in through ${provider} as ${admin ? 'an Admin' : 'a Member'}`,
    page,
  )
  return page
}

async function turnedBack(browser: Browser, username: string, words: string, step: string) {
  const page = await freshPage(browser)
  await page.goto(origin)
  await page.waitForURL(/\/signin$/)
  await signIn(page, username)
  await check(page.getByRole('alert').getByText(words).waitFor(), step, page)
  if (await session(page)) await fail(`${step}: and is not signed in`, page)
  await page.context().close()
}

const browser = await chromium.launch({
  args: [
    '--host-resolver-rules=MAP footnote.example.test 127.0.0.1, MAP login.example.test 127.0.0.1',
  ],
})
try {
  // The first admin's invite link, as `footnote invite` printed it.
  const noor = await freshPage(browser)
  // The `footnote invite` container has just joined and left the host's network, which Chromium
  // reports as ERR_NETWORK_CHANGED on a navigation under way; the same navigation then goes through.
  await noor.goto(inviteLink).catch(() => noor.goto(inviteLink))
  await check(
    noor.getByText("You're invited as an Admin").waitFor(),
    'the invite link says what it invites Noor Haddad as',
    noor,
  )
  await signIn(noor, 'noor')
  const first = await session(noor)
  if (
    first?.person.name !== 'Noor Haddad' ||
    !first.person.permissions.roles.includes('administrator')
  )
    await fail('Noor Haddad, invited from the command line, signs in as an Admin', noor)
  console.log('ok - Noor Haddad, invited from the command line, signs in as an Admin')

  await (await joins(browser, 'sam', 'Sam Okafor', true)).context().close()
  await (await joins(browser, 'elias', 'Elias Berg', false)).context().close()
  await turnedBack(
    browser,
    'tove',
    `${provider} hasn't confirmed your email address.`,
    'Tove Ek, whose address Keycloak has not verified, is turned back and told why',
  )
  await turnedBack(
    browser,
    'pia',
    "This account can't sign in here. Ask an admin for an invite.",
    'Pia Lund, in no group and not invited, is turned back',
  )

  // Signing out ends the session here; Keycloak's own session stays, so it asks no password.
  await noor.goto(`${origin}/inbox`)
  await noor
    .locator('[data-sidebar=sidebar] [data-sidebar=footer]')
    .first()
    .getByRole('button')
    .click()
  await noor.getByRole('menuitem', { name: 'Sign out' }).click()
  await check(noor.waitForURL(/\/signin$/), 'Noor Haddad signs out', noor)
  if (await session(noor)) await fail('signing out ends the session here', noor)
  await noor.locator('a', { hasText: `Sign in with ${provider}` }).click()
  await noor.waitForURL((url) => url.origin === origin && !url.pathname.endsWith('/signin'))
  if ((await session(noor))?.person.name !== 'Noor Haddad')
    await fail('signing in again goes through on Keycloak session', noor)
  console.log(
    "ok - signing out ends the session here, not at Keycloak, as the docs' known limits say",
  )
} finally {
  await browser.close()
}
