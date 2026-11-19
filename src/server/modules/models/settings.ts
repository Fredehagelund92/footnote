import { settingSchemas } from '../../../contract/admin.ts'
import type { Queryable } from '../../db/database.ts'
import { ModelConfigError } from './errors.ts'
import type { ModelPort } from './port.ts'
import { defaultModel } from './providers.ts'
import { modelRoles, type ModelRef, type ModelRole, type Prices } from './types.ts'

/**
 * Each role's model, from the versioned settings (`models.<role>`, FR-809): a provider from the
 * registry and a model, with prices for a model it does not list. The judge may instead be
 * `different_family`.
 */

export const differentFamily = 'different_family'
export type JudgeSetting = ModelRef | typeof differentFamily
export type ModelSettings = Record<Exclude<ModelRole, 'judge'>, ModelRef> & { judge: JudgeSetting }

/** One role's setting; a missing one is the default, an invalid one is refused by name. */
export function parseModelSetting<R extends ModelRole>(
  role: R,
  raw: unknown,
): R extends 'judge' ? JudgeSetting : ModelRef
export function parseModelSetting(role: ModelRole, raw: unknown): JudgeSetting {
  if (raw === undefined || raw === null) return role === 'judge' ? differentFamily : defaultModel
  const parsed = settingSchemas[`models.${role}`].safeParse(raw)
  if (!parsed.success)
    throw new ModelConfigError(
      `models.${role} must name a provider and a model, such as {"provider":"anthropic","model":"claude-sonnet-5-5"}`,
    )
  return parsed.data
}

export async function readModelSettings(tx: Queryable): Promise<ModelSettings> {
  const rows = await tx.query<{ key: string; value: unknown }>(
    `select key,value from settings_current where key = any($1)`,
    [modelRoles.map((role) => `models.${role}`)],
  )
  const raw = (role: ModelRole) => rows.find((row) => row.key === `models.${role}`)?.value
  return {
    eval_answer: parseModelSetting('eval_answer', raw('eval_answer')),
    judge: parseModelSetting('judge', raw('judge')),
    assistant: parseModelSetting('assistant', raw('assistant')),
    test_authoring: parseModelSetting('test_authoring', raw('test_authoring')),
  }
}

/** Checks every role's setting at start-up; the first that cannot be served stops the service. */
export function checkModelSettings(port: ModelPort, settings: ModelSettings): void {
  for (const role of modelRoles) {
    const value = settings[role]
    if (value !== differentFamily) port.check(`models.${role}`, value)
  }
}

/**
 * The roles whose setting gives its own prices, for the log at start-up: a hosted model priced at
 * 0 by mistake would make the spend limits count nothing for it.
 */
export function settingPrices(
  settings: ModelSettings,
): { setting: string; id: string; prices: Prices }[] {
  return modelRoles.flatMap((role) => {
    const value = settings[role]
    return value !== differentFamily && value.prices
      ? [
          {
            setting: `models.${role}`,
            id: `${value.provider}/${value.model}`,
            prices: value.prices,
          },
        ]
      : []
  })
}

/** The one-line start's models (FOOTNOTE_MODEL, FOOTNOTE_JUDGE_MODEL): every role's, and the judge's. */
export type StartModels = { model: ModelRef | undefined; judge: ModelRef | undefined }

/**
 * Sets each role whose setting is still the one it was installed with (its first version, no
 * person's change) to the one-line start's model, and the judge to its own; a setting anyone
 * changed is kept. Each model is checked first, by the variable that names it. Returns the
 * settings it set. Two services starting at once write each setting once.
 */
export async function fillModelSettings(
  tx: Queryable,
  port: ModelPort,
  start: StartModels,
): Promise<string[]> {
  const filled: string[] = []
  for (const role of modelRoles) {
    const [name, ref] =
      role === 'judge' ? ['FOOTNOTE_JUDGE_MODEL', start.judge] : ['FOOTNOTE_MODEL', start.model]
    if (!ref) continue
    port.check(name, ref)
    const rows = await tx.query<{ key: string }>(
      `insert into settings_versions(key,version,value,reason)
       select key, 2, $2, $3 from settings_versions where key = $1
        group by key having max(version) = 1 and bool_and(changed_by is null)
       on conflict do nothing
       returning key`,
      [`models.${role}`, JSON.stringify(ref), `${name} at start-up`],
    )
    filled.push(...rows.map((row) => row.key))
  }
  return filled
}

/** Checks a new value of a `models.<role>` setting before it is saved; other keys pass. */
export function checkModelSetting(port: ModelPort, key: string, value: unknown): void {
  const role = modelRoles.find((r) => key === `models.${r}`)
  if (!role) return
  const parsed = parseModelSetting(role, value)
  if (parsed !== differentFamily) port.check(key, parsed)
}
