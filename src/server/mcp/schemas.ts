import * as z from 'zod'
import { AGENT_MAX_ITEMS } from '../../domain/answer.ts'
import { replyStatuses } from '../../domain/answer-state.ts'
import { kindFilters } from '../../domain/mcp-text.ts'
import { isCalendarDate } from '../../domain/validity.ts'
import { itemKinds } from '../../domain/item.ts'
import { relations } from '../../domain/links.ts'
import {
  fieldMarks,
  limits,
  markedFields,
  questionIds,
  toolInputLimits,
} from '../../domain/proposal-attributes.ts'
import { provenanceFlagCodes } from '../../domain/provenance.ts'

const date = z.string().refine(isCalendarDate, 'Expected a calendar date')
const edition = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}\.\d+$/)
  .optional()
const scopeFields = {
  question: z.string().max(2000),
  metrics: z
    .array(z.string().min(1).max(toolInputLimits.name))
    .max(toolInputLimits.names)
    .optional()
    .describe(
      'Metric names as people say them, their other names, or the member names you queried in the data tool (view.member, such as payments.orders).',
    ),
  dimension_filters: z
    .array(
      z.strictObject({
        dimension: z
          .string()
          .min(1)
          .max(toolInputLimits.name)
          .describe('A dimension by its name, or the member name you queried (view.member).'),
        // No values names the dimension without choosing one ("orders by market").
        values: z.array(z.string().min(1).max(toolInputLimits.name)).max(toolInputLimits.values),
      }),
    )
    .max(toolInputLimits.names)
    .optional(),
  window: z
    .strictObject({ from: date, to: date })
    .refine((w) => w.from <= w.to, 'Window ends before it starts')
    .optional(),
  /**
   * R11: the person's own words for the period, read as people write them, as Ask reads them
   * ("August last year", "early May"). A window stands over them, and they over the question's.
   */
  period: z
    .strictObject({
      words: z
        .string()
        .min(1)
        .max(120)
        .describe(
          "The person's words for the period, as they wrote them, such as 'August last year'.",
        ),
    })
    .optional()
    .describe(
      "The period in the person's own words, read as people write dates; period_read says the days. Pass window instead for exact days.",
    ),
}
/**
 * FR-342: how much a reply of find_context says. `concise` keeps what an answer needs (each
 * item's title, summary, dates, claim level, freshness and what not to conclude) and leaves out
 * bodies, evidence, owners and links, which read_context gives for one item; `full` carries every
 * source detail of FR-326 and FR-331.
 */
const responseFormat = z
  .enum(['concise', 'full'])
  .describe(
    "concise: a shorter reply, about half the size, each item without its body, evidence, owner and links (read_context gives them). full: every source detail and link. Ask for concise when you only need what applies; full when you will cite an item's evidence or follow its links.",
  )
export type ResponseFormat = z.infer<typeof responseFormat>
/**
 * How much get_context's reply says (FR-342). `concise`, the default, is the agent contract's
 * short reply: the status, say, what was asked, each item that applies with its source
 * and check, the reply id and the edition. `full` adds every source detail of FR-326 and FR-331:
 * each item's body, evidence, owner and links, and how the question was read.
 */
export const contextFormat = z
  .enum(['concise', 'full'])
  .describe(
    "concise (the default): the answer line, say, what was asked, and each item that applies with its source and who checked it. full: also each item's body, every source, its links, and how the question was read (scope_used, dates_read, definitions, check_report). Ask for full when you will quote an item's text or follow its links.",
  )
/** The most context items one get_context reply gives. */
export const MOST_ITEMS = 50
export const getContextInput = z.strictObject({
  ...scopeFields,
  edition,
  max_items: z
    .number()
    .int()
    .min(1)
    .max(MOST_ITEMS)
    .default(AGENT_MAX_ITEMS)
    .describe(
      'How many context items a reply gives at most: the ones the question turns on come first. next_cursor gives the rest.',
    ),
  max_bytes: z.number().int().min(1000).max(100000).default(100000),
  cursor: z
    .string()
    .max(2000)
    .optional()
    .describe(
      "The next_cursor of a reply to the same question: the context items after that reply's, in the same order.",
    ),
  response_format: contextFormat.default('concise'),
})
export type GetContextInput = z.infer<typeof getContextInput>
/**
 * get_context's input as Footnote's own checks give it (the publish gate's delivery check, the
 * test questions): the agent tool's, without its caps on how many names a list holds. The caps
 * guard what an agent may send; an item may apply to hundreds of metrics, and its check asks for
 * every one of them.
 */
export const checkContextInput = getContextInput.extend({
  metrics: z.array(z.string().min(1).max(toolInputLimits.name)).optional(),
  dimension_filters: z
    .array(
      z.strictObject({
        dimension: z.string().min(1).max(toolInputLimits.name),
        values: z.array(z.string().min(1).max(toolInputLimits.name)),
      }),
    )
    .optional(),
})
/** A context item's id: what read_context reads as an item, and anything else as a definition. */
export const itemIdPattern = /^itm_[a-z0-9]{8,16}$/
/**
 * read_context (FR-353): one context item, by its id, with its links one step out and in, or one
 * definition, by a name or its key.
 */
export const readInput = z.strictObject({
  id: z
    .string()
    .min(1)
    .max(200)
    .describe(
      "A context item's id (itm_...), or a definition: its name, another of its names, or its key from find_context (such as metric:orders or term:...).",
    ),
  relations: z
    .array(z.enum(relations))
    .min(1)
    .max(relations.length)
    .optional()
    .describe("Only an item's links of these kinds. Leave it out for all of them."),
  edition,
  cursor: z
    .string()
    .max(2000)
    .optional()
    .describe('The next_cursor of the reply before, for the next page.'),
  max_bytes: z.number().int().min(1000).max(100000).default(100000),
})
export type ReadInput = z.infer<typeof readInput>
const domainName = z
  .string()
  .min(1)
  .max(80)
  .describe('A domain by its name, such as Sales (its id, such as area_sales, works too).')
/**
 * FR-338: find what Footnote holds about a few words or a question, by the names people use. The
 * window only narrows the items that apply when no words match.
 */
export const findInput = z.strictObject({
  query: z
    .string()
    .min(1)
    .max(2000)
    .describe(
      'A few words or the question as asked: a metric, a market, a domain or a topic, such as "GMV Spain" or "what is net revenue".',
    ),
  domain: domainName.optional(),
  kind: z.enum(itemKinds).optional(),
  window: scopeFields.window.describe(
    'Inclusive UTC dates, for the items that apply when no words match. Today when left out.',
  ),
  edition,
  limit: z.number().int().min(1).max(50).default(10),
  max_bytes: z.number().int().min(1000).max(100000).default(100000),
  response_format: responseFormat.default('full'),
})
/** What find_context finds or lists by kind: a definition's kind, or an item's as agents read it. */
export const definitionKinds = ['metric', 'dimension', 'term'] as const
export const findKinds = [
  ...definitionKinds,
  ...(Object.keys(kindFilters) as (keyof typeof kindFilters)[]),
] as const
/** How many find_context gives to a page: by default, with words and without, and at most. */
export const findLimits = { words: 10, list: 25, max: 100 } as const
/**
 * find_context (FR-338): what is written down about a few words, by the names people use, or
 * without words everything of a kind or in a domain, a page at a time. A kind is named as agents
 * read it (metric, dimension, term, event, warning, rule, guide).
 */
export const findContextInput = z.strictObject({
  query: findInput.shape.query
    .optional()
    .describe(
      'A few words or the question as asked: a metric, a market, a domain or a topic, such as "GMV Spain" or "what is net revenue". Leave it out to list everything of a kind or in a domain.',
    ),
  domain: domainName.optional(),
  kind: z
    .enum(findKinds)
    .optional()
    .describe(
      'Only this kind: a definition (metric, families too, dimension, or term, a word a person defined) or an item (event, warning, rule or guide).',
    ),
  window: findInput.shape.window,
  edition,
  limit: z
    .number()
    .int()
    .min(1)
    .max(findLimits.max)
    .optional()
    .describe(
      `How many to a page: ${findLimits.words} with words and ${findLimits.list} without by default, at most ${findLimits.max}.`,
    ),
  cursor: z
    .string()
    .max(2000)
    .optional()
    .describe('The next_cursor of the page before, for the next page.'),
  max_bytes: z.number().int().min(1000).max(100000).default(100000),
  response_format: responseFormat
    .default('concise')
    .describe(
      'concise (the default): each definition without where its source keeps it. full: every source detail. Read an item in full with read_context.',
    ),
})
export type FindContextInput = z.infer<typeof findContextInput>
/**
 * report: the person says something is missing, wrong or
 * unclear, or that it helped, about a reply, an item, or a question's scope. It records
 * what and where, never who: the reply's topic or the item's domain, and a short note checked
 * for sensitive text (FR-611).
 */
export const reportKinds = ['missing', 'wrong', 'unclear', 'helped'] as const
export const reportInput = z.strictObject({
  kind: z
    .enum(reportKinds)
    .describe(
      'missing: something the person needs is not written down. wrong: an item says something that is not true. unclear: it is hard to read or to use. helped: it helped.',
    ),
  reply_id: z.uuid().optional().describe('The reply_id of the get_context reply it is about.'),
  context_id: z
    .string()
    .regex(/^itm_[a-z0-9]{8,16}$/)
    .optional()
    .describe('The id of the item it is about, when it is about one.'),
  question: scopeFields.question
    .optional()
    .describe(
      'For missing without a reply_id: the question, read in memory only for its metrics, markets and dates, never kept.',
    ),
  metrics: scopeFields.metrics,
  dimension_filters: scopeFields.dimension_filters,
  window: scopeFields.window,
  period: scopeFields.period,
  note: z
    .string()
    .min(1)
    .max(500)
    .optional()
    .describe(
      "A short note in the person's words, if they gave one. Never the question text, personal data or secrets.",
    ),
})
export type ReportInput = z.infer<typeof reportInput>
/**
 * FR-121: what an agent passes to draft context for the person. Every field is a suggestion the
 * person confirms; Footnote resolves names against the vocabulary and never trusts a key or a fact
 * from the agent's memory. Bounded fields only: never a conversation (FR-603).
 */
export const draftInput = z.strictObject({
  text: z
    .string()
    .min(1)
    .max(toolInputLimits.text)
    .describe(
      'What the person wants recorded, in their words or a short summary of them: what happened, where and since when. Not a transcript.',
    ),
  title: z.string().min(1).max(limits.title).optional().describe('A short title, if you have one.'),
  summary: z
    .string()
    .min(1)
    .max(
      limits.summary,
      `at most ${limits.summary} characters: what happened, where and when. Move detail, caveats and what it does not mean into text, which becomes the body`,
    )
    .optional()
    .describe(
      `One or two sentences an agent reads first, at most ${limits.summary} characters. Do not claim a cause.`,
    ),
  kind: z
    .enum(itemKinds)
    .optional()
    .describe(
      'event: something that happened on a day. issue: a data problem that lasts a while. note: a lasting remark. guide: how to investigate. example: a checked answer to a question.',
    ),
  scope: z
    .strictObject({
      metrics: scopeFields.metrics.describe('Metric names, as you used them with get_context.'),
      dimension_filters: scopeFields.dimension_filters.describe(
        'Dimensions and the values it applies to, such as market Norway. No values means every value.',
      ),
    })
    .optional()
    .describe("Names, as in your last get_context call. They're matched to the vocabulary."),
  window: z
    .strictObject({
      from: date,
      to: date.optional(),
      uncertain: z
        .boolean()
        .optional()
        .describe(
          'True when the person is unsure of the dates: from is your best guess, and the owner sees the dates flagged.',
        ),
    })
    .refine((w) => w.to === undefined || w.from <= w.to, 'Window ends before it starts')
    .optional()
    .describe(
      'Inclusive UTC dates the person named or that the source gives. When they are unsure, give your best start with uncertain: true. Leave out to when it is open.',
    ),
  evidence: z
    .array(
      z.strictObject({
        url: z
          .string()
          .max(limits.url)
          .refine(
            (url) => /^https?:\/\//.test(url) && URL.canParse(url),
            'Expected an http or https link',
          ),
        quote: z.string().min(1).max(limits.quote),
      }),
    )
    .max(toolInputLimits.evidence)
    .optional()
    .describe(
      "Each source the person gave or you read: the address of the exact page, and one sentence copied character for character from that page in the page's own language, never a translation, a summary or a search snippet. Prefer the official text, such as a law on a government site, to a news report of it. Never invent one: if you only saw a summary of a page, leave it out and say so.",
    ),
  not_to_conclude: z
    .string()
    .min(1)
    .max(limits.notToConclude)
    .optional()
    .describe(
      'What not to conclude from this, in the person\'s words, if they said. Otherwise "cause not proven" is used.',
    ),
  area: z
    .string()
    .min(1)
    .max(limits.areaId)
    .optional()
    .describe('The domain, only when the person chose one after a reply asked.'),
  item_id: z
    .string()
    .regex(/^itm_[a-z0-9]{8,16}$/)
    .optional()
    .describe('To suggest a change to an accepted item instead of a new one.'),
  new_item: z
    .boolean()
    .optional()
    .describe('true when the person said it is new after a reply listed possible duplicates.'),
})
export type DraftInput = z.infer<typeof draftInput>

const listed = z.strictObject({ id: z.string(), title: z.string(), kind: z.string() })
const question = z.strictObject({
  field: z.enum(markedFields),
  question: z.string(),
  options: z.array(z.string()).optional(),
})
/**
 * What `suggest_context` returns (their MCP output schema), field names and
 * marks from the attribute table (src/domain/proposal-attributes.ts). `status` says which parts
 * are present: a suggestion sent to the owner, one published under an owner's policy (FR-421), a
 * saved draft (suggest_context's, or one the review checks kept back), a domain to choose, possible
 * duplicates, or a refusal, which saves nothing.
 */
export const draftOutput = z
  .object({
    status: z.enum([
      'suggestion_sent',
      'suggestion_published',
      'draft_saved',
      'needs_area',
      'possible_duplicate',
      'refused',
    ]),
    saved: z.boolean(),
    message: z.string().optional(),
    submitted: z.boolean().optional(),
    draft_id: z.string().optional(),
    number: z.number().optional(),
    title: z.string().optional(),
    url: z.string().nullable().optional(),
    fields: z
      .partialRecord(
        z.enum(markedFields),
        z.strictObject({
          value: z.unknown(),
          mark: z.enum(fieldMarks),
          reason: z.string().optional(),
        }),
      )
      .optional(),
    questions: z.array(question).optional(),
    /** The questions the person answered in their agent, when it could ask them. */
    answered: z.array(z.enum(questionIds)).optional(),
    not_in_vocabulary: z
      .array(z.strictObject({ name: z.string(), suggestions: z.array(z.string()) }))
      .optional(),
    areas: z.array(z.strictObject({ id: z.string(), name: z.string() })).optional(),
    possible_duplicates: z.array(listed).optional(),
    overlaps: z
      .strictObject({
        accepted: z.array(listed),
        own_proposals: z.array(z.record(z.string(), z.unknown())),
      })
      .optional(),
    flags: z
      .array(
        z.strictObject({
          code: z.enum(provenanceFlagCodes),
          field: z.enum(markedFields),
          words: z.array(z.string()),
        }),
      )
      .optional(),
    findings: z.array(z.record(z.string(), z.unknown())).optional(),
    /**
     * When it was published under an owner's policy: whose policy, in which domain. When a policy is
     * on but did not publish it: why it waits for review instead.
     */
    policy: z
      .strictObject({
        published: z.boolean(),
        set_by: z.string(),
        domain: z.string(),
        waits_because: z.string().optional(),
      })
      .optional(),
    instructions: z.string().optional(),
  })
  .loose()
const said = {
  say: z
    .string()
    .min(1)
    .describe(
      'What you may tell the person about this result, in these words: plain sentences on what was read and what was found.',
    ),
  next: z
    .string()
    .min(1)
    .optional()
    .describe(
      'What to do next with this result: for you, not the person. When nothing was found, it says why that proves nothing and which call to make.',
    ),
  status: z.string(),
}
/**
 * What every read tool returns (its MCP output schema, FR-344): the status and, first, `say`, the
 * sentences for that status a model may repeat to the person, then `next`, the step for the
 * model. The rest is the tool's own; what serves a cache or an audit is in `_meta` (FR-346),
 * which an output schema does not describe.
 */
export const readOutput = z.object(said).loose()
/** An item as the agent contract gives it: its page in Footnote, and how it was checked, if it was. */
const contextEntry = z
  .object({
    id: z.string(),
    title: z.string(),
    kind: z.string().describe('event, warning, rule or guide.'),
    url: z.string().describe("The item's page, for the person: link it where you cite the item."),
    checked: z
      .object({ role: z.string(), date: z.string() })
      .optional()
      .describe(
        'Who checked it before agents got it, as a role (never a person), and on which day.',
      ),
    published_without_review: z
      .object({ permission_of: z.string(), date: z.string() })
      .optional()
      .describe(
        'In place of checked: nobody read it before agents got it. It was published on that day with the permission of this role (never a person) to publish without review.',
      ),
  })
  .loose()
/**
 * A word a person defined in Definitions, as the agent contract gives it (FR-138): what it names,
 * its meaning as written, who wrote it as a role and when, and its page. Never a checked source.
 */
const termEntry = z
  .object({
    word: z.string().describe('The words as they were used.'),
    name: z.string().describe('What they name: a term, a metric or a dimension.'),
    kind: z.enum(['term', 'metric', 'dimension']),
    synonym: z
      .literal(true)
      .optional()
      .describe('The words are another name for it, which a person wrote in Definitions.'),
    meaning: z
      .string()
      .optional()
      .describe("A term's meaning, as a person wrote it here. It is not a checked source."),
    domain: z.string().optional(),
    written: z
      .object({ role: z.string(), date: z.string() })
      .describe('Who wrote it, as a role (never a person), and on which day.'),
    url: z.string().describe('Its page in Definitions, for the person.'),
  })
  .loose()
const terms = z
  .array(termEntry)
  .optional()
  .describe(
    'The words that a person defined in Definitions: what each means here, as they wrote it. Read the words by them; a term never makes an answer checked.',
  )
/**
 * R11: the days a get_context reply read, in every reply that looked something up, and where they
 * came from: the caller's window, the person's period words, the question's words, or today
 * because none were given.
 */
const periodRead = z
  .object({
    from: z.string(),
    to: z.string(),
    reads_as: z.string().describe('The days in words, and how they were read.'),
    provenance: z
      .enum(['window', 'period', 'question', 'assumed'])
      .describe(
        "Where the days came from: your window, the person's period words, the question's words, or today, assumed because no dates were given.",
      ),
    words: z.string().optional().describe('The words the days were read from.'),
    note: z
      .string()
      .optional()
      .describe('What was guessed, such as year not given: tell the person.'),
    unplaced: z
      .array(z.string())
      .optional()
      .describe('Words that name dates and could not be placed: tell the person.'),
  })
  .describe('The days that were looked up, inclusive, and how they were read: say them.')
/**
 * What get_context returns (its MCP output schema, FR-344 and FR-349): the status, which carries
 * the answer state, `say` and `next`, what was asked, the items that apply, the reply id
 * to report on and the edition. `response_format` full adds the details of each item and how the
 * question was read.
 */
export const contextOutput = z
  .object({
    say: said.say,
    next: said.next,
    status: z
      .enum(replyStatuses)
      .describe(
        'The answer state: matched (Checked), partial (Partial), no_match (Not found), conflict (Conflict), stale (Outdated), check_failed (Not checked); need_more_detail when the question could not be read.',
      ),
    asked: z
      .string()
      .nullable()
      .optional()
      .describe('What was looked up: the metrics, markets and dates, in words.'),
    period_read: periodRead.optional(),
    defined: z
      .array(z.object({ metric: z.string(), definition: z.string(), from: z.string() }))
      .optional()
      .describe(
        'What each metric asked for is: the first sentence of its definition, in the words of the tool it comes from. Say a figure as this says it is, such as an amount or a count.',
      ),
    context: z.array(contextEntry).optional(),
    terms,
    next_cursor: z
      .string()
      .optional()
      .describe(
        'Where the rest of the context items that apply start, when more apply than the reply gives: pass it as cursor with the same question for the next ones.',
      ),
    read_as: z
      .array(
        z.object({
          words: z.string(),
          name: z.string(),
          by: z.enum(['form', 'initials', 'part']),
        }),
      )
      .optional()
      .describe(
        "The question's words read as a name they are not exactly: another form or order of it (form), its initials (initials), or a word only its name holds (part). Say a part reading to the person, since the word may mean something else.",
      ),
    unread: z
      .array(
        z.object({
          word: z.string(),
          closest: z.array(z.string()),
          domain: z.string().optional(),
          value_of: z.array(z.string()).optional(),
        }),
      )
      .optional()
      .describe(
        "The question's words that named nothing. A word that could have named a metric, when it names no metric: the metrics, groups and dimensions whose names hold it as a word (closest, empty when none does) and the domain it names. A word where a value goes (value_of: the dimensions it could be a value of): it names no value, so the reply is for every value, and closest has the values it is a typo away from. Never read as one of them for the person.",
      ),
    reply_id: z
      .string()
      .optional()
      .describe('The id of this reply, for report when the person says what was wrong or helped.'),
    edition: z.string().optional(),
  })
  .loose()
/** The page and where the next one is, in find_context's and read_context's replies. */
const page = {
  total: z
    .number()
    .int()
    .optional()
    .describe('How many there are with these filters, on every page.'),
  next_cursor: z
    .string()
    .nullable()
    .optional()
    .describe('Pass it as cursor for the next page; null on the last page.'),
}
/** An owner as agents read one (FR-326): a role and the domain's team, never a person. */
const listOwner = z
  .object({ role: z.string(), team: z.string().nullable() })
  .describe('Who looks after it, as a role and a team (never a person).')
/**
 * find_context (FR-338, FR-347): the matching or listed items with their pages in Footnote, each
 * with its title and summary and never its text, and the definitions.
 */
export const findContextOutput = z
  .object({
    ...said,
    ...page,
    definitions: z
      .array(z.object({}).loose())
      .optional()
      .describe(
        "With words, each metric or dimension they name: the definition its source gives and what this context adds. Without words, a page of definitions: each one's key, name, kind, domain, owner and one-line meaning.",
      ),
    context: z
      .array(
        contextEntry.extend({
          summary: z.string(),
          applies: z.string().describe('What it applies to, in words.'),
          when: z.string().describe('When it applies, in words.'),
          may_be_out_of_date: z
            .literal(true)
            .optional()
            .describe('It is due for a check: say so if you use it.'),
        }),
      )
      .optional(),
    terms,
  })
  .loose()
/** A name a definition is known by, with its key: what read_context reads it by. */
const namedDefinition = z.object({ key: z.string(), name: z.string() })
/**
 * One definition in full (FR-353), as read_context gives it: the source's words as Footnote keeps
 * them, or a person's for a term, who looks after it as a role, its other names, its family, what
 * it is built from, and the published context items about it. Never a calculation or a person.
 */
const definitionEntry = z
  .object({
    key: z.string().describe('Its key, which read_context reads it by, such as metric:orders.'),
    name: z.string(),
    kind: z
      .enum(['metric', 'metric family', 'dimension', 'term'])
      .describe(
        'A metric family is one name for near-identical metrics, such as one per currency.',
      ),
    domain: z.string().nullable(),
    owner: listOwner,
    other_names: z
      .array(z.string())
      .describe('Its other names: those its source gives, and the synonyms people wrote.'),
    words: z
      .string()
      .nullable()
      .describe(
        "What it means, whole: its source's own words, a family's meaning, or what a person wrote for a term. Null when nothing says.",
      ),
    words_from: z.string().describe('Where the words come from, in a sentence: say it with them.'),
    shortened: z
      .literal(true)
      .optional()
      .describe(
        'The source wrote more than the 500 characters kept of it: the words end with ... and the rest is in the source.',
      ),
    source: z
      .object({
        tool: z.string().describe('The tool that defines it, such as Cube.'),
        source: z.string().describe("The source's name in Sources."),
        name: z.string().describe('Its own name in the tool, such as payments.orders.'),
        title: z.string().optional(),
        read_on: z.string().optional().describe('The day it was last read from the source.'),
        state: z
          .enum(['current', 'changed', 'missing'])
          .describe(
            'changed: the source changed it after some context items about it were checked; missing: the source no longer lists it.',
          ),
      })
      .optional(),
    written: z
      .object({ role: z.string(), date: z.string() })
      .optional()
      .describe('For a term: who wrote it, as a role, and when.'),
    family: z
      .object({
        by: z
          .array(z.string())
          .optional()
          .describe('What tells its metrics apart, such as Currency.'),
        found: z.string().optional().describe('How it was found, in a sentence.'),
        meaning_from: z
          .enum(['declared', 'written', 'common', 'none'])
          .optional()
          .describe(
            'Where its meaning comes from: declared in its source, written by an owner, the words most of its metrics share, or none.',
          ),
        usual: namedDefinition
          .extend({ values: z.array(z.string()) })
          .optional()
          .describe(
            'The metric its owners say a question means when it names none of the values, such as EUR.',
          ),
        members: z
          .array(
            namedDefinition
              .extend({
                values: z.array(z.string()).optional(),
                words: z
                  .string()
                  .optional()
                  .describe("Its source's own words, when it gives some."),
              })
              .loose(),
          )
          .describe('Its metrics, each with the values that tell it apart.'),
        converted: z
          .array(z.object({ from: z.string(), to: z.string(), by: z.string() }))
          .optional()
          .describe('Which metric is worked out from which, by names, and the column it reads.'),
      })
      .optional(),
    member_of: namedDefinition.optional().describe('The family it is one metric of.'),
    relations: z
      .array(
        z
          .object({
            kind: z.enum(['converted_from', 'converted_to', 'built_from', 'used_by']),
            name: z.string(),
            key: z.string().nullable().describe('Its key, or null for a column.'),
            missing: z.literal(true).optional(),
          })
          .loose(),
      )
      .optional()
      .describe(
        "What it is built from and what is built from it, by name, as its source's structure says: never a calculation.",
      ),
    context: z
      .object({
        count: z.number().int().describe('How many published context items about it you may read.'),
        items: z.array(z.object({ id: z.string(), title: z.string() })),
      })
      .describe('The published context items about it, titles only: read one with read_context.'),
    url: z.string().describe('Its page in Definitions, for the person.'),
  })
  .loose()
/** A link as an item writes it: how it links, and what it links to as it stands now. */
const linkOut = z
  .object({
    rel: z
      .string()
      .describe('How it links: replaces, conflicts_with, applies_to, mentions or in_area.'),
    target: z
      .object({
        type: z.string().describe('item, metric, dimension, term or area.'),
        id: z.string(),
        label: z.string(),
        status: z
          .string()
          .describe(
            'current; retired or replaced for an item no longer served; source_missing, source_changed or unresolved for a definition.',
          ),
      })
      .loose(),
  })
  .loose()
/**
 * read_context: the one item in full with its links one step out and in, or the one definition
 * (FR-353), with its page in Footnote (FR-347).
 */
export const readContextOutput = z
  .object({
    ...said,
    context: contextEntry.optional(),
    links_out: z
      .array(linkOut)
      .optional()
      .describe('What the item links to, in a fixed order. Read a linked item with read_context.'),
    links_in: z
      .object({
        count: z
          .number()
          .int()
          .describe('How many links to it you may read: one for each item and way it links.'),
        items: z.array(
          z.object({
            rel: z
              .string()
              .describe('How it links to this item: mentioned_by, replaced_by or conflicts_with.'),
            id: z.string(),
            title: z.string(),
          }),
        ),
      })
      .optional()
      .describe(
        'A page of the items that link to it, in a fixed order; next_cursor gives the next.',
      ),
    definition: definitionEntry.optional(),
    next_cursor: page.next_cursor,
    options: z
      .array(
        z.object({
          field: z.string(),
          input: z.string(),
          options: z.array(z.string()),
        }),
      )
      .optional()
      .describe('The definitions the words may mean, by key: call again with one of them.'),
    terms,
  })
  .loose()
/** report: that it was sent, and to which owner. */
export const reportOutput = z
  .object({
    say: said.say,
    next: said.next,
    status: z.string(),
    recorded: z.boolean().optional(),
    to: z.string().optional().describe('Who will see it, as a role: the owner of a domain.'),
  })
  .loose()
