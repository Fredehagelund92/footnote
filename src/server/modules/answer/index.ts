/**
 * The answer engine on the service (src/domain/answer.ts): Asked this week, the replay of a topic
 * and the reach of a draft, each on the edition it needs, read once and kept a short while; and
 * Ask's loop, one model that reads with Footnote's own read tools as the person asking (FR-718 to
 * FR-720). No model decides a state, an item or what agents are told, and no question is stored.
 */
export { gateCases, type GateCase } from './gate-cases.ts'
export { demoCases, type DemoCase } from './burned-cases.ts'
export {
  askedCounts,
  askedFor,
  askedThisWeek,
  createBundleCache,
  liveBundle as liveServingBundle,
  liveEditionKey,
  minimumCount,
  reachOfDraft,
  replayTopic,
  type AskTrace,
  type BundleCache,
} from './service.ts'
export {
  askToolDefinitions,
  askToolNames,
  createAskTools,
  toolErrorSchema,
  type AskToolInput,
  type AskToolName,
  type AskToolOutput,
  type AskToolResult,
  type AskTools,
} from './tools.ts'
export {
  createKeptReads,
  toolReadsIn,
  type KeptReads,
  type ToolReads,
  type ToolServices,
  type TurnReads,
} from './tool-reads.ts'
export { readHelp, readyHelp, searchHelp, type HelpSection } from './help.ts'
export {
  ASK_BACK,
  askLoop,
  readAssistantModel,
  cachedThrough,
  EARLIER_TURNS,
  DECLINE,
  declinedTurn,
  footerOf,
  LOOP_MAX_TOKENS,
  LOOP_SECONDS,
  LOOP_STEPS,
  loopSystem,
  overviewTurn,
  progressOf,
  readLines,
  readLoopLimits,
  stateOf,
  stoppedSentence,
  turnOf,
  type Asker,
  type LoopDeps,
  type MadeRead,
} from './loop.ts'
export {
  scriptedLoopChoice,
  scriptedLoopModel,
  scriptedPrompt,
  type ScriptedPrompt,
  type ScriptedStep,
} from './loop-mock.ts'
