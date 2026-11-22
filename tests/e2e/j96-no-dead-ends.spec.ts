import type { Page } from '@playwright/test'
import { expect, go, onMockOnly, signInAs, test } from './go.ts'

// J96, no dead ends (quick actions S1): a person is never sent to a page that refuses them, nor
// shown a button the service refuses. An owner of a domain and a member with no role open the
// places that once sent them to "Settings are for admins": Quality's model key, the Settings
// breadcrumb, the definitions tool on Definitions, a sync's read in the Inbox, the setup checklist,
// a family to publish and a new term. Where they may not act they read who does it, and "Settings
// are for admins" itself has a way on, to the Settings section that is theirs. (The search of a turn
// of Ask that stopped is in tests/web/loop-answer.test.ts: no demo turn stops before reading.)

/**
 * Jon as an owner of Sales and nothing more: Ravi, an admin, makes him a member in People. The mock
 * offers no other owner of Sales to sign in as.
 */
async function jonOwnsSalesOnly(page: Page) {
  await signInAs(page, 'Ravi Kapoor')
  await go(page, '/settings/people')
  await page
    .getByRole('list', { name: 'People' })
    .getByRole('button', { name: /Jon Abara/ })
    .click()
  await page
    .getByRole('radiogroup', { name: 'Role' })
    .getByRole('radio', { name: 'Member' })
    .click()
  await expect(page.getByText('Jon Abara is a member now')).toBeVisible()
  await signInAs(page, 'Jon Abara')
}

/** The admins by name, or "an admin" where the service does not tell a non-admin who they are. */
const admins = /(: Jon Abara or Ravi Kapoor)?\./

test('an owner is never sent to Settings are for admins', async ({ page }) => {
  await signInAs(page, 'Tomas Eriksen')

  // Quality: the model key is an admin's, so the owner reads who adds it, with no button.
  await go(page, '/observability/quality')
  const key = page.getByText(/^Needs a model key/)
  await expect(key).toHaveText(
    /^Needs a model key, which an admin adds(: Jon Abara or Ravi Kapoor)?\. The free check above already runs after every change\.$/,
  )
  await expect(page.getByRole('link', { name: 'Settings, Advanced' })).toHaveCount(0)

  // The breadcrumb's Settings opens Settings as an owner has it: their domains.
  await go(page, '/settings/people')
  await expect(page.getByRole('heading', { name: 'People', level: 1 })).toBeVisible()
  await page.getByRole('main').getByRole('link', { name: 'Settings', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Domains and owners', level: 1 })).toBeVisible()
  await expect(page.getByText('Settings are for admins')).toHaveCount(0)
  // Only an admin adds a domain: an owner reads who does, and its address leads back.
  const domainsList = page.getByRole('list', { name: 'Domains' })
  await expect(domainsList.getByRole('link', { name: 'Add a domain' })).toHaveCount(0)
  await expect(domainsList.getByText(/^An admin adds a domain/)).toHaveText(
    new RegExp(`^An admin adds a domain${admins.source}$`),
  )
  await go(page, '/settings/domains/new')
  await expect(page.getByText('Settings are for admins')).toBeVisible()

  // A section that is an admin's says so, and leads to the owner's own.
  await go(page, '/settings/advanced')
  await expect(page.getByText('Settings are for admins')).toBeVisible()
  await page.getByRole('link', { name: 'Open Domains and owners' }).click()
  await expect(page.getByRole('heading', { name: 'Domains and owners', level: 1 })).toBeVisible()

  // Definitions names its tool, and links the tool's page in Integrations only for an admin.
  await go(page, '/definitions')
  const from = page.getByText(/- change them there\./)
  await expect(from).toBeVisible()
  await expect(from.getByRole('link')).toHaveCount(0)
  // An owner writes their domain's terms.
  await expect(page.getByRole('button', { name: 'New term' }).first()).toBeVisible()
})

test("a family waiting in another owner's domain has no Publish for this owner", async ({
  page,
}) => {
  await onMockOnly('families waiting to be published (?demo=families)', async () => {
    await go(page, '/inbox?demo=families')
    const card = page.getByText(/new metrics and dimensions from dbt/).first()
    await expect(card).toBeVisible()
    const family = '/inbox?card=names:waiting&dock=family.group:packaging_costs'

    // Jon owns Sales, where the family waits: he publishes it.
    await jonOwnsSalesOnly(page)
    await go(page, family)
    await expect(page.getByRole('button', { name: 'Publish as a family' })).toBeVisible()

    // Tomas owns Marketing: the names are not his, so neither the card nor the button is there.
    await signInAs(page, 'Tomas Eriksen')
    await go(page, '/inbox')
    await expect(page.getByRole('main').getByRole('heading').first()).toBeVisible()
    await expect(page.getByText(/new metrics and dimensions from dbt/)).toHaveCount(0)
    await go(page, family)
    await expect(page.getByText('Suggested family')).toBeVisible()
    await expect(page.getByRole('button', { name: /^Publish/ })).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'Keep them separate' })).toHaveCount(0)
  })
})

test('an owner reads a sync of their domain without a link to Integrations', async ({ page }) => {
  await onMockOnly("Google Drive's read of two suggestions for Sales", async () => {
    await jonOwnsSalesOnly(page)
    await go(page, '/inbox')
    await expect(page.getByText(/^From Google Drive/).first()).toBeVisible()
    await expect(page.getByRole('link', { name: 'About this read' })).toHaveCount(0)
  })
})

test('a member is never sent to Settings are for admins', async ({ page }) => {
  await signInAs(page, 'Ines Duarte')

  // Settings for a member is their agents, and any other section leads back to it.
  await go(page, '/settings/domains')
  await expect(page.getByText('Settings are for admins')).toBeVisible()
  await expect(page.getByText(/^Ask .+ if something here needs changing\.$/)).toBeVisible()
  await page.getByRole('link', { name: 'Open Agents and access' }).click()
  await expect(page.getByRole('heading', { name: 'Agents and access', level: 1 })).toBeVisible()
  await expect(
    page.getByRole('main').getByRole('link', { name: 'Settings', exact: true }),
  ).toHaveAttribute('href', '/settings')

  // A member writes no term: the service refuses it, so New term is nowhere.
  await go(page, '/definitions')
  const from = page.getByText(/- change them there\./)
  await expect(from).toBeVisible()
  await expect(from.getByRole('link')).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'New term' })).toHaveCount(0)
  await page.keyboard.press('ControlOrMeta+k')
  const palette = page.getByRole('dialog', { name: 'Search' })
  await expect(palette.getByRole('option', { name: 'New context' })).toBeVisible()
  await expect(palette.getByRole('option', { name: 'New term' })).toHaveCount(0)
  await page.keyboard.press('Escape')
})

test('a new install tells an owner and a member who does the admin steps', async ({ page }) => {
  await onMockOnly('new install with people beside its admin (?demo=setup)', async () => {
    for (const name of ['Tomas Eriksen', 'Ines Duarte']) {
      await signInAs(page, name)
      await go(page, '/inbox?demo=setup')
      const steps = page.getByRole('main').getByRole('listitem')
      for (const [title, action] of [
        ['Say what the business is about', 'Write'],
        ['Connect your definitions', 'Connect'],
      ] as const) {
        const step = steps.filter({ hasText: title })
        await expect(step.getByText(/^An admin does this/)).toHaveText(
          new RegExp(`^An admin does this${admins.source}$`),
        )
        await expect(step.getByRole('button', { name: action, exact: true })).toHaveCount(0)
      }
      // What anyone does stays a button.
      await expect(
        steps
          .filter({ hasText: 'Write your first context item' })
          .getByRole('button', { name: 'Write context' }),
      ).toBeVisible()
      await go(page, '/inbox?demo=week')
    }
  })
})
