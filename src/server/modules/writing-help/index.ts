/**
 * Writing help (domain/writing-help.ts): Footnote's own help for writing one draft, in the
 * editor's dock. Its switch and limits, and the loop of one turn: a model that changes the fields
 * of the person's own draft, as them, through the write path an agent's write_draft uses.
 */
export {
  readWritingHelp,
  requireShortEnough,
  requireWritingHelp,
  takeTurn,
  type WritingHelpSettings,
} from './settings.ts'
export {
  HELP_MAX_TOKENS,
  HELP_SECONDS,
  HELP_STEPS,
  helpSystem,
  helpWriteInput,
  writingHelpTurn,
  type HelpDeps,
  type HelpInput,
} from './loop.ts'
