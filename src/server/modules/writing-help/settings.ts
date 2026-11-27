import { ORPCError } from '@orpc/client'
import {
  pasteTooLong,
  turnsUsedUp,
  WRITING_HELP_PASTE_CHARACTERS,
  WRITING_HELP_TURNS_PER_DAY,
  writingHelpNoModel,
  writingHelpOff,
} from '../../../domain/writing-help.ts'
import type { Queryable } from '../../db/database.ts'

/*
  Writing help's switch and limits, as an admin set them (`writing_help.on`,
  `limits.writing_help`). It is off as installed: on, the words of a draft go to the model
  provider set for Ask. Missing or unreadable values read as the defaults, and as off.
*/

export type WritingHelpSettings = {
  on: boolean
  turnsPerDay: number
  pasteCharacters: number
}

export async function readWritingHelp(tx: Queryable): Promise<WritingHelpSettings> {
  const rows = await tx.query<{ key: string; value: unknown }>(
    `select key, value from settings_current where key in ('writing_help.on', 'limits.writing_help')`,
  )
  const value = (key: string) => rows.find((row) => row.key === key)?.value
  const limits = (value('limits.writing_help') ?? {}) as Record<string, unknown>
  const whole = (raw: unknown, fallback: number) =>
    typeof raw === 'number' && Number.isInteger(raw) && raw >= 1 ? raw : fallback
  return {
    on: value('writing_help.on') === true,
    turnsPerDay: whole(limits.turns_per_day, WRITING_HELP_TURNS_PER_DAY),
    pasteCharacters: whole(limits.paste_characters, WRITING_HELP_PASTE_CHARACTERS),
  }
}

/**
 * Refuses a request while writing help is not there to ask: an admin has not turned it on, or no
 * AI model is connected (`model`: whether one is).
 */
export function requireWritingHelp(settings: WritingHelpSettings, model: boolean) {
  if (!settings.on) throw new ORPCError('PRECONDITION_FAILED', { message: writingHelpOff })
  if (!model) throw new ORPCError('PRECONDITION_FAILED', { message: writingHelpNoModel })
}

/** Refuses a message over the most characters writing help reads at once. */
export function requireShortEnough(message: string, settings: WritingHelpSettings) {
  const characters = [...message].length
  if (characters > settings.pasteCharacters)
    throw new ORPCError('UNPROCESSABLE_CONTENT', {
      message: pasteTooLong(characters, settings.pasteCharacters),
    })
}

/**
 * Takes one of the person's turns for today, inside their transaction, or refuses with how long
 * until the next one. A turn that fails later still counts, as a link read does.
 */
export async function takeTurn(tx: Queryable) {
  const [taken] = await tx.query<{ refused: boolean; turns: number; wait_seconds: number | null }>(
    'select refused, turns, wait_seconds from cl_writing_help_turn_take()',
  )
  if (!taken?.refused) return
  const wait = taken.wait_seconds ?? 60
  throw new ORPCError('TOO_MANY_REQUESTS', {
    message: turnsUsedUp(taken.turns, wait),
    data: { retryAfterSeconds: wait },
  })
}
