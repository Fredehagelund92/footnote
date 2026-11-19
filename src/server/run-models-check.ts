import { parseArgs } from 'node:util'
import { ConfigError, loadConfig, modelName, modelPrices, unlistedModel } from './config/env.ts'
import { createDatabase } from './db/database.ts'
import {
  checkedRoles,
  checkModelSettings,
  checkWords,
  createModelChecks,
  createModelPort,
  ModelConfigError,
  readModelSettings,
  roleFails,
  roleModels,
  type CheckedRole,
  type ModelCheck,
  type ModelChoice,
} from './modules/models/index.ts'
import { createLogger } from './observability/logger.ts'

/**
 * `npm run models:check`: the model check of each role's model, as the service makes it once at
 * start-up (models/capability.ts). Three tiny calls on each model, metered in the spend ledger:
 * a forced tool call, a call told to use no tool, and an answer against a JSON schema. It always
 * uses real models, with the keys in .env.local. `--model <provider>:<model>` checks that model
 * alone, before any setting names it, with `--prices <input>,<output>` for a model its provider
 * does not list. Exit 0: every role's model does what the role needs; 1: one does not; 2: a check
 * could not tell.
 */

const usage =
  'Usage: npm run models:check [-- --model <provider>:<model> [--prices <input>,<output>]]'

async function main(): Promise<number> {
  let values
  try {
    values = parseArgs({
      options: { model: { type: 'string' }, prices: { type: 'string' } },
    }).values
  } catch {
    console.error(usage)
    return 1
  }
  const named = values.model === undefined ? undefined : modelName.safeParse(values.model)
  const priced = values.prices === undefined ? undefined : modelPrices.safeParse(values.prices)
  if (named?.success === false || priced?.success === false || (priced && !named)) {
    console.error(usage)
    return 1
  }
  if (named?.data && !priced && unlistedModel(named.data)) {
    console.error(
      `Provider ${named.data.provider} does not list ${named.data.model}: give its prices with --prices <input>,<output> in US dollars per million tokens, 0,0 for a model that costs nothing.`,
    )
    return 1
  }
  let config
  try {
    config = loadConfig({ ...process.env, MODELS: 'live' })
  } catch (error) {
    if (!(error instanceof ConfigError)) throw error
    console.error(error.message)
    return 1
  }
  const database = createDatabase(config.databaseUrl, createLogger({ level: 'silent' }))
  try {
    const port = createModelPort({ mode: 'live', env: config.modelEnv })
    let roles: { role: CheckedRole; choice: ModelChoice }[]
    try {
      if (named?.data) {
        const ref = { ...named.data, ...(priced?.data ? { prices: priced.data } : {}) }
        port.check('--model', ref)
        roles = checkedRoles.map((role) => ({
          role,
          choice: port.choose(role, ref),
        }))
      } else {
        const settings = await readModelSettings(database)
        checkModelSettings(port, settings)
        roles = roleModels(port, settings)
      }
    } catch (error) {
      if (!(error instanceof ModelConfigError)) throw error
      console.error(error.message)
      return 1
    }
    const recipients = [...new Set(roles.map((r) => r.choice.recipients))].join('; ')
    console.log(
      `Checking each role's model: three tiny calls a model, to ${recipients}, with no company data.`,
    )
    const checks = createModelChecks({ database })
    let failed = false
    let untold = false
    for (const { role, choice } of roles) {
      const check: ModelCheck = await checks.of(choice, role)
      failed ||= roleFails(role, check)
      untold ||= [check.tools, check.noTools, check.json].includes('unknown')
      console.log(
        `models.${role}: ${choice.id}: tools ${check.tools}, no tools when told ${check.noTools}, JSON schema ${check.json}. ${checkWords(role, check)}.`,
      )
      for (const note of check.notes) console.log(`  ${note}`)
    }
    return failed ? 1 : untold ? 2 : 0
  } finally {
    await database.close()
  }
}

process.exitCode = await main()
