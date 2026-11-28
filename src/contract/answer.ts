/**
 * The answer engine on the API (src/domain/answer.ts): what agents get for a question, a typed
 * scope or a topic, on the live edition, the edition before it, or with a draft in it, with its
 * state, its items, what was left out and why, its sentence and its timed steps. No model runs.
 * Ask looks up a question (`ask.lookup`, step by step), Ask shows what agents asked this week
 * (`ask.asked`), Try it runs on a draft (`tryIt.run`), the answer panel replays a topic
 * (`obs.replay`), and the editor and the review count who would get a draft (`engine.reach`).
 */
import * as z from 'zod/mini'
import { actionIds } from '../domain/actions.ts'
import { answerStates, leftOutReasons } from '../domain/answer.ts'
import { chosenPeriodNames } from '../domain/dates.ts'
import { marks } from '../domain/markdown-blocks.ts'
import { calendarDateSchema } from '../domain/validity.ts'
import { CHAT_LINE, CHAT_SOURCES, CHAT_TURNS, LOOP_READS, LOOP_REPLY } from '../domain/ask-chat.ts'
import { itemKinds } from '../domain/item.ts'
import { footerSchema } from '../domain/records-answer.ts'

/** The resolver's status, as get_context gives it. */
const statusSchema = z.enum(['matched', 'conflict', 'no_match', 'need_more_detail', 'check_failed'])
const windowSchema = z.object({ start: z.string(), end: z.nullable(z.string()) })
/** A scope as read: metric keys, each dimension's value keys (none for "by dimension"), the days. */
export const readScopeSchema = z.object({
  metrics: z.array(z.string()),
  filters: z.record(z.string(), z.array(z.string())),
  window: windowSchema,
})
const issueSchema = z.object({
  field: z.string(),
  input: z.string(),
  options: z.array(z.string()),
  /** A word with more than one meaning: how a person writes it. */
  word: z.optional(z.string()),
  /** Each meaning, in the order the question says them. */
  meanings: z.optional(z.array(z.object({ key: z.string(), name: z.string() }))),
  message: z.optional(z.string()),
})
const datesSchema = z.object({ words: z.string(), reads_as: z.string() })
const assumedSchema = z.object({
  date: z.string(),
  /** The workspace's time zone today was counted in (`calendar.time_zone`), UTC until it sets one. */
  time_zone: z.string(),
  reason: z.literal('no date given'),
})

export const answerItemSchema = z.object({
  id: z.string(),
  version: z.number(),
  areaId: z.string(),
  kind: z.enum(itemKinds),
  title: z.string(),
  summary: z.string(),
  validity: windowSchema,
  match: z.enum(['exact', 'partial']),
  unverified: z.boolean(),
  unverifiedReason: z.nullable(z.enum(['needs_check', 'source_missing', 'past_review_date'])),
  /** Published with an owner's permission to publish without review: nobody read it. */
  unreviewed: z.boolean(),
  restrictions: z.array(z.object({ dimension: z.string(), values: z.array(z.string()) })),
  conflictsWith: z.array(z.string()),
  /** The line its owner copied from its first source; null when none was copied. */
  quote: z.nullable(z.string()),
  /** What not to conclude from it, when its writer said; null for the default. */
  notToConclude: z.nullable(z.string()),
})
export const leftOutSchema = z.object({
  id: z.string(),
  reason: z.enum(leftOutReasons),
  kind: z.enum(itemKinds),
  title: z.string(),
  replacedBy: z.nullable(z.string()),
})
const uncoveredSchema = z.object({ metrics: z.array(z.string()), values: z.array(z.string()) })
export const answerStateSchema = z.enum(answerStates)

const timed = { ms: z.number() }
/** One step of an answer, as it was done, and how long it took in milliseconds. */
export const answerStepSchema = z.union([
  z.object({
    step: z.literal('read_scope'),
    ...timed,
    scope: z.nullable(readScopeSchema),
    dates: z.nullable(datesSchema),
    assumed: z.nullable(assumedSchema),
    issues: z.array(issueSchema),
  }),
  z.object({
    step: z.literal('looked_up'),
    ...timed,
    status: statusSchema,
    items: z.array(answerItemSchema),
  }),
  z.object({
    step: z.literal('left_out'),
    ...timed,
    leftOut: z.array(leftOutSchema),
    more: z.number(),
    forAnotherGroup: z.number(),
  }),
  z.object({
    step: z.literal('checked'),
    ...timed,
    state: answerStateSchema,
    uncovered: uncoveredSchema,
  }),
  z.object({ step: z.literal('said'), ...timed, say: z.string(), next: z.nullable(z.string()) }),
])

/**
 * What it was answered on: the live edition, a past one (`edition`), or the live edition with a
 * draft in it, where `item` is the draft's item. A draft's answer is never called Checked: it says
 * "Based on this draft".
 */
export const answerTargetSchema = z.union([
  z.object({ kind: z.literal('live') }),
  z.object({ kind: z.literal('edition') }),
  z.object({ kind: z.literal('draft'), proposal: z.string(), item: z.string() }),
])

export const answerSchema = z.object({
  target: answerTargetSchema,
  /** The edition's label, such as 2026-10-20.3. */
  edition: z.string(),
  /** The resolver's status, as get_context gives it. */
  status: statusSchema,
  /** One of the six answer states (FR-349). */
  state: answerStateSchema,
  scope: z.nullable(readScopeSchema),
  dates: z.nullable(datesSchema),
  assumed: z.nullable(assumedSchema),
  issues: z.array(issueSchema),
  items: z.array(answerItemSchema),
  leftOut: z.array(leftOutSchema),
  /** Near misses past the first ten, counted only. */
  leftOutMore: z.number(),
  /** Items that apply but are for another group: counted, never named. */
  forAnotherGroup: z.number(),
  /** The asked metrics and values no item covers in full: what makes an answer Partial. */
  uncovered: uncoveredSchema,
  /** What a person hears, as get_context says it (FR-344). */
  say: z.string(),
  /** What an agent is told to do next. */
  next: z.nullable(z.string()),
  steps: z.array(answerStepSchema),
  /** The steps' time together, in milliseconds. */
  ms: z.number(),
})
export type AnswerResult = z.infer<typeof answerSchema>

/** A word Ask asks about, and its meanings in the order the question says them. */

/**
 * One read of Ask's loop: the tool, by its name, and its input, as the model gave it; then the step
 * of its turn it was sent in, counted among the reads sent back, and the words the model wrote in that step before it, on the step's
 * first read. A follow-up sends the turn again so, step by step, and its prompt cache holds.
 */
export const loopReadSchema = z.strictObject({
  tool: z.string().check(z.minLength(1), z.maxLength(40)),
  input: z.record(z.string().check(z.maxLength(40)), z.unknown()),
  step: z.optional(z.number().check(z.int(), z.minimum(0), z.maximum(LOOP_READS))),
  before: z.optional(z.string().check(z.maxLength(LOOP_REPLY))),
})
export type LoopRead = z.infer<typeof loopReadSchema>

/** A noun an answer names, by the id a typed mention writes (src/domain/ask-nouns.ts). */
const loopNounSchema = z.object({
  id: z.string(),
  name: z.string(),
  /** A value's dimension, by id and name. */
  of: z.nullable(z.object({ id: z.string(), name: z.string() })),
  /** A dimension's value type, as its source gives it ("time"): what picks its icon. */
  type: z.nullable(z.string()),
  /**
   * A metric group that is no family (FR-142): a name its tool puts metrics under, with no
   * definition of its own, so its chip opens no definition.
   */
  plainGroup: z.optional(z.literal(true)),
})
/** Where words of an answer link: a web or mail address, or a help page at one of its parts. */
const loopLinkSchema = z.union([
  z.object({ url: z.string() }),
  z.object({ slug: z.string(), id: z.string() }),
])
export type LoopLink = z.infer<typeof loopLinkSchema>
/**
 * A run of an answer's words: plain words, a noun, a citation, a count with what it is out of, a
 * day. Plain words carry the marks and the link the model wrote them with, in Markdown.
 */
const loopRunSchema = z.union([
  z.object({
    t: z.literal('text'),
    text: z.string(),
    marks: z.optional(z.array(z.enum(marks))),
    link: z.optional(loopLinkSchema),
  }),
  z.object({ t: z.literal('noun'), id: z.string() }),
  z.object({ t: z.literal('cite'), n: z.number() }),
  z.object({ t: z.literal('count'), value: z.string(), of: z.nullable(z.string()) }),
  z.object({ t: z.literal('date'), day: z.string() }),
])
export type LoopRun = z.infer<typeof loopRunSchema>
/**
 * A block of an answer's words: a paragraph, a short list the model wrote (numbered from `start`
 * when it numbered it), a short table it wrote, its first row the heads, the lines it wrote as code,
 * or the items of a read as code lists them (`[list:r1]`), by id, with how many more the read found.
 */
const loopBlockSchema = z.union([
  z.object({ t: z.literal('p'), runs: z.array(loopRunSchema) }),
  z.object({
    t: z.literal('ul'),
    items: z.array(z.array(loopRunSchema)),
    start: z.optional(z.number()),
  }),
  z.object({ t: z.literal('table'), rows: z.array(z.array(z.array(loopRunSchema))) }),
  z.object({ t: z.literal('code'), text: z.string() }),
  z.object({ t: z.literal('list'), rows: z.array(z.string()), more: z.number() }),
])
export type LoopBlock = z.infer<typeof loopBlockSchema>
/** A context item as a row shows it: what it applies to, its domain, its status and its days. */
const loopItemSchema = z.object({
  id: z.string(),
  title: z.string(),
  kind: z.string(),
  /** Its domain and what it applies to, as nouns' ids. */
  domain: z.nullable(z.string()),
  about: z.array(z.string()),
  status: z.enum(['live', 'due', 'archived']),
  /** The day it was last checked, and why it may be out of date. */
  checked: z.nullable(z.string()),
  outOfDate: z.nullable(z.string()),
  /** Its number as a source, when the answer cites it. */
  n: z.nullable(z.number()),
})
export type LoopItem = z.infer<typeof loopItemSchema>
/** One row of an overview's group: a card or an item, what it is about, why it waits, its day. */
const overviewRowSchema = z.object({
  title: z.string(),
  /** The context item it is about, by id, when the person may read one. */
  item: z.nullable(z.string()),
  about: z.array(z.string()),
  domain: z.nullable(z.string()),
  status: z.string(),
  date: z.nullable(z.string()),
  /** The Inbox card it opens, by its id there. */
  card: z.nullable(z.string()),
})
/**
 * An overview (FR-720): a set shown as groups, all by code from one read the model named. The
 * total is the groups' own, and the page's count when it differs, with why; the groups in the
 * order the read gives them; the model's closing line only when it wrote one.
 */
const overviewSchema = z.object({
  /** Where it comes from: the Inbox, or the records of the Context list. */
  from: z.enum(['inbox', 'records']),
  /** What the groups are by: the Inbox's groups, or a domain, kind, status, metric or value. */
  by: z.string(),
  /** What the groups add up to, by code, and the one line that says it with what it counts. */
  total: z.number(),
  headline: z.array(loopRunSchema),
  /** When the page counts otherwise: its count and why the two differ. */
  page: z.nullable(z.object({ count: z.number(), why: z.string() })),
  order: z.string(),
  groups: z.array(
    z.object({
      key: z.nullable(z.string()),
      name: z.string(),
      count: z.number(),
      rows: z.array(overviewRowSchema),
      more: z.number(),
    }),
  ),
  note: z.nullable(z.array(loopRunSchema)),
})
export type LoopOverview = z.infer<typeof overviewSchema>

/**
 * A family of metrics as an answer shows its definition (FR-142): what tells its variants apart,
 * how many there are, its meaning as one plain line ("Money taken in each currency"; null for
 * none), and the own words of its variants that say something else or how they are worked out
 * from another (of every variant, with no meaning), by their values: at most a few, and how many
 * more have words of their own. Only the page reads it; Ask's model reads the definition's words.
 * `source` is where the meaning comes from (C1): words declared for the family in its tool,
 * written by an owner (by name, and the day), the words most of its variants share (how many), or
 * the words of its base, the variant the others are converted from (its values, and each other
 * variant's); `none` for no meaning. A turn written before it has none.
 */
export const familyShownSchema = z.object({
  by: z.array(z.string()),
  variants: z.number(),
  meaning: z.nullable(z.string()),
  own: z.array(z.object({ values: z.array(z.string()), words: z.string() })),
  more: z.number(),
  source: z.optional(
    z.discriminatedUnion('kind', [
      z.object({ kind: z.literal('declared') }),
      z.object({ kind: z.literal('written'), by: z.string(), on: z.string() }),
      z.object({ kind: z.literal('common'), agree: z.number() }),
      z.object({
        kind: z.literal('base'),
        values: z.array(z.string()),
        converted: z.array(z.array(z.string())),
      }),
      z.object({ kind: z.literal('none') }),
    ]),
  ),
})
export type FamilyShown = z.infer<typeof familyShownSchema>

/**
 * A definition as an answer's card shows it (the definition card): its name and kind, the source's
 * own words (of a family, `family` too), the tool and the source's name for it, its group, its
 * domain (a noun's id when a read named it) and owners by name, and the context items about it:
 * how many, and the ones a read of it returned, by id, as the turn's items.
 */
const definitionCardSchema = z.object({
  id: z.string(),
  name: z.string(),
  kind: z.enum(['metric', 'dimension', 'term']),
  words: z.nullable(z.string()),
  family: z.optional(familyShownSchema),
  tool: z.string(),
  member: z.nullable(z.string()),
  group: z.nullable(z.string()),
  domain: z.nullable(z.object({ id: z.nullable(z.string()), name: z.string() })),
  owners: z.array(z.string()),
  context: z.object({ count: z.number(), items: z.array(z.string()) }),
  inWords: z.boolean(),
  /** The words its read looked it up by, when they are none of its names and its own words say them. */
  mentions: z.optional(z.string()),
})
export type DefinitionCard = z.infer<typeof definitionCardSchema>

/**
 * A turn of Ask's loop once it is done (FR-719, FR-720): the model's words, or one question back
 * with the readings it sees as choices, or a fixed sentence when the turn stopped at a limit or
 * its model failed. Everything else is written by code from the reads: the sources (the context
 * items its words cite, by id, [n] for the nth), the state (FR-720.4), the footer (FR-720.5),
 * what was read (FR-720.9), the definitions it named, and the reads the next turn sends back.
 */
export const loopTurnSchema = z.object({
  kind: z.enum(['answer', 'question', 'stopped']),
  text: z.string(),
  sources: z.array(z.string()),
  state: z.nullable(answerStateSchema),
  footer: footerSchema,
  read: z.array(z.string()),
  /**
   * What the turn's read about the question's subject read: its names, as nouns too, and its days;
   * `carried` when an earlier turn's read it was, made again; null when none.
   */
  subject: z.nullable(
    z.object({
      names: z.array(z.string()),
      about: z.array(z.string()),
      period: z.string(),
      /**
       * How the days were read where the words left room, said beside them: "year not given",
       * "fiscal year read as the calendar year", "day first", "could not place 'since the launch'",
       * "could also mean 1 Jul to 30 Sep 2025" (the days Ask read the words as, when they differ);
       * null when nothing was guessed.
       */
      note: z.nullable(z.string()),
      assumedToday: z.boolean(),
      carried: z.boolean(),
      /** The asked metrics and values no item covers in full, as nouns' ids. */
      uncovered: z.array(z.string()),
      /** Of those, the ones no item the read gave is about at all: nothing is written about them. */
      unwritten: z.array(z.string()),
    }),
  ),
  /** Context items about the same names that do not apply, under Not found: named, not used. */
  nearby: z.array(z.string()),
  /** Under Conflict, two of its sources that disagree, by id, as the reads mark them. */
  conflict: z.array(z.string()),
  /**
   * The definitions shown with the answer: only when the question asks what one is, or turns on a
   * word of it (`mark`), and never when the words already say it. A family's shows as `family`.
   */
  definitions: z.array(
    z.object({
      name: z.string(),
      words: z.nullable(z.string()),
      family: z.optional(familyShownSchema),
      tool: z.string(),
      id: z.optional(z.string()),
      mark: z.optional(z.string()),
    }),
  ),
  /**
   * What an answer that cites no item defines, from its reads (decision 3): the page shows the
   * Definition label, with these names and the tool their words come from, in place of a state.
   */
  defined: z.optional(
    z.object({
      names: z.array(z.string()),
      tool: z.string(),
      /**
       * Each definition as its card shows it, from the definitions read: the source's own words,
       * where they come from, its domain and owners, and what is written about it. `inWords` when
       * the answer's words already give the definition: the card then stands in for them.
       */
      cards: z.array(definitionCardSchema),
    }),
  ),
  /**
   * The help pages an answer about Footnote itself rests on, from its help reads (FR-719.8): the
   * page shows each as its source, and no state. Left out when it read no help.
   */
  help: z.optional(
    z.array(
      z.object({
        /** The page's slug, as its address in the help takes it. */
        slug: z.string(),
        /** The heading's anchor; empty for the top of the page. */
        id: z.string(),
        title: z.string(),
        heading: z.string(),
      }),
    ),
  ),
  /**
   * The words this turn's definitions reads found nothing under, when nothing the turn read covers
   * the question (no item cited, no definition found, no subject named): what the gap card offers
   * to tell an admin is not written. Taken from the reads, never from the question. Left out when
   * there are none.
   */
  unknown: z.optional(z.array(z.string())),
  /**
   * The quick actions the answer offers to open (FR-719.10), at most two: each one its words mark
   * as what they explain how to do, that a read of the chat offered, with the family the read was
   * about. The page draws a button for each the person may do (src/domain/actions.ts), and says
   * who does it in place of one they may not. Left out when there are none.
   */
  actions: z.optional(
    z.array(
      z.object({
        id: z.enum(actionIds),
        family: z.optional(
          z.object({
            name: z.string(),
            domain: z.nullable(z.string()),
            owners: z.array(z.string()),
          }),
        ),
      }),
    ),
  ),
  /**
   * What is not published yet that the person may open and that matches every word of a search
   * that found nothing published (FR-718.2): their own drafts and the suggestions waiting for
   * review they sent or decide for, in a block of its own under the answer, never a source. Each
   * row with what opens it (src/domain/actions.ts); the one sentence the model may write about
   * them, if they are published as written, drawn by code and kept out of the answer's words; and
   * the words searched. Left out when there are none.
   */
  drafts: z.optional(
    z.object({
      words: z.array(z.string()),
      found: z.number(),
      more: z.number(),
      rows: z.array(
        z.object({
          id: z.string(),
          state: z.enum(['draft', 'waiting']),
          /** A change to a published item, not a new one. */
          change: z.boolean(),
          title: z.string(),
          /** Its domain, as a noun's id when a read named it. */
          domain: z.nullable(z.string()),
          by: z.nullable(z.string()),
          on: z.string(),
          action: z.object({
            id: z.enum(['open_draft', 'review_suggestion']),
            draft: z.object({
              id: z.string(),
              domain: z.nullable(z.string()),
              mine: z.boolean(),
              owners: z.array(z.string()),
            }),
          }),
        }),
      ),
      sentence: z.nullable(z.array(loopRunSchema)),
    }),
  ),
  choices: z.array(z.string()),
  reads: z.array(loopReadSchema),
  /**
   * Why a turn stopped: its step or time limit, the spending limits, its model failed, or the
   * model's provider refused its key or said its account is out of credit.
   */
  stopped: z.nullable(z.enum(['steps', 'time', 'spending', 'model', 'key', 'credit'])),
  /**
   * The answer as the page draws it, by code from the model's words and the reads: `text` is the
   * same in plain words. Every noun is one a read returned, every count and day a read's own.
   */
  body: z.array(loopBlockSchema),
  /** The same as the model writes it, each noun as its typed mention: what the chat sends back. */
  said: z.string(),
  nouns: z.array(loopNounSchema),
  items: z.array(loopItemSchema),
  /** The items written nearest a Not found's subject, counted by each value of the dimension it narrowed. */
  closest: z.nullable(
    z.object({
      by: z.nullable(z.string()),
      counts: z.array(z.object({ id: z.string(), count: z.number() })),
      items: z.array(z.string()),
    }),
  ),
  /** Who owns the subject: each domain with its owners, as nouns' ids. */
  owners: z.array(z.object({ domain: z.string(), people: z.array(z.string()) })),
  overview: z.nullable(overviewSchema),
  /** What the code check found in the model's words and dealt with: never shown as the words. */
  checks: z.array(z.object({ kind: z.string(), words: z.string() })),
})
export type LoopTurn = z.infer<typeof loopTurnSchema>

/**
 * One turn of the chat, sent from the browser with each question so Ask's loop can carry it
 * (FR-719.1): its question, its sources by id, how it was read and what it answered in one line
 * each, the question Ask asked back, when it did, and what Ask said with the reads it made. Never
 * stored on the service, like the question (FR-602, FR-717).
 */
export const chatTurnSchema = z.strictObject({
  question: z.string().check(z.minLength(1), z.maxLength(2000)),
  sources: z.array(z.string().check(z.maxLength(64))).check(z.maxLength(CHAT_SOURCES)),
  asked: z.optional(z.string().check(z.maxLength(2000))),
  understood: z.optional(z.nullable(z.string().check(z.maxLength(CHAT_LINE)))),
  headline: z.optional(z.nullable(z.string().check(z.maxLength(CHAT_LINE)))),
  /**
   * What Ask said, as the person read it, and the reads it made, by tool and input. The service
   * reads each again as the person before the model sees its result, so a result is never taken
   * from the browser (FR-718.3).
   */
  reply: z.optional(z.string().check(z.maxLength(LOOP_REPLY))),
  reads: z.optional(z.array(loopReadSchema).check(z.maxLength(LOOP_READS))),
})
export type ChatTurnInput = z.infer<typeof chatTurnSchema>

/**
 * A period a person chose for a question on the read line of Ask's loop (R12): a named one, any
 * date, or the days they picked, first and last. It stands over the dates in the words.
 */
export const chosenPeriodSchema = z.union([
  z.enum(chosenPeriodNames),
  z
    .strictObject({ from: calendarDateSchema, to: calendarDateSchema })
    .check(z.refine((days) => days.from <= days.to, 'The days end before they start')),
])
export type ChosenPeriodInput = z.infer<typeof chosenPeriodSchema>

/**
 * A question for Ask: its words, the chat's last turns, oldest first, and the period a person
 * chose on the read line. The words are read in memory and never stored or logged (FR-602); sent
 * in a POST body for that reason.
 */
export const lookupInputSchema = z.strictObject({
  question: z.string().check(z.minLength(1), z.maxLength(2000)),
  turns: z.optional(z.array(chatTurnSchema).check(z.maxLength(CHAT_TURNS))),
  period: z.optional(chosenPeriodSchema),
})
export type LookupInput = z.infer<typeof lookupInputSchema>
/**
 * A turn of Ask's loop as it runs (FR-718 to FR-720): a `progress` line as each read starts,
 * written by code from what it reads, then one `turn`. While the model writes, `words` comes each
 * time one more of its sentences is final and has passed the check: the answer so far, drawn as
 * the turn draws it (decision 5). Null takes back what was shown: the words led into a read, not
 * an answer. The `turn` that ends it is the whole answer.
 */
export const lookupEventSchema = z.union([
  z.object({
    type: z.literal('progress'),
    working: z.string(),
    /** Each read of the turn so far, by code: what it reads, and once done, what it found. */
    steps: z.optional(z.array(z.object({ runs: z.array(loopRunSchema), done: z.boolean() }))),
    nouns: z.optional(z.array(loopNounSchema)),
  }),
  z.object({ type: z.literal('turn'), turn: loopTurnSchema }),
  z.object({ type: z.literal('words'), turn: z.nullable(loopTurnSchema) }),
])
export type LookupEvent = z.infer<typeof lookupEventSchema>

/**
 * Asked this week: the topics agents asked about most this week (a metric, its values and the
 * dimensions named, its months joined), each with the state Ask gives it now for its latest
 * month, as counts only. A count under the minimum is never shown (FR-614): `count` is null when
 * a small month could be worked out from it, and `atLeast` is what the shown months add up to.
 */
export const askedSchema = z.object({
  /** The first of the 7 full days counted, as Observability counts them (UTC). */
  week: z.string(),
  rows: z.array(
    z.object({
      /** The topic in words, as get_context says a scope: "Orders in Norway". */
      title: z.string(),
      area: z.nullable(z.string()),
      /** The scope a click asks about: the topic at its latest month. */
      scope: readScopeSchema,
      months: z.array(z.string()),
      count: z.nullable(z.number()),
      atLeast: z.number(),
      state: answerStateSchema,
      /** How many items the answer gives. */
      items: z.number(),
      /**
       * How many of this week's calls delivered no item, what agents found, not what the topic
       * reads as now; null under the minimum (FR-614).
       */
      nothing: z.nullable(z.number()),
      /**
       * For the owners of the topic's domains and administrators: the Nothing written yet card open on it,
       * and its draft when one waits. Null for anyone else, and when nothing is open.
       */
      gap: z.nullable(z.object({ card: z.string(), draft: z.nullable(z.string()) })),
    }),
  ),
  /** Calls about topics not listed, themselves hidden under the minimum. */
  hidden: z.nullable(z.number()),
  /**
   * Every call this week; null under the minimum, and when what it adds over the rows' counts
   * would give a small month away (FR-614). `askedAtLeast` is what the rows show together.
   */
  asked: z.nullable(z.number()),
  askedAtLeast: z.number(),
  /**
   * A workspace's first questions, made from what it has written: the scopes of its live context
   * items, then the metrics of its vocabulary, at most four, each with the scope a click asks.
   */
  starters: z.array(z.object({ title: z.string(), scope: readScopeSchema })),
})
export type Asked = z.infer<typeof askedSchema>

/** The answer panel's replay: a topic answered now, or before the last publish. */
export const replayInputSchema = z.strictObject({
  topic: z.string().check(z.uuid()),
  when: z._default(z.enum(['now', 'before']), 'now'),
})
export const replaySchema = z.object({
  when: z.enum(['now', 'before']),
  answer: answerSchema,
})
export type Replay = z.infer<typeof replaySchema>
export const reachSchema = z.object({
  /** Questions about topics asked at least the minimum times this week whose answer gives it. */
  questions: z.number(),
  week: z.string(),
})
export type Reach = z.infer<typeof reachSchema>
