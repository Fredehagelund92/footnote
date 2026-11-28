/**
 * Ask on the Footnote service: a turn of Ask's loop (`ask.lookup`) and Asked this week
 * (`ask.asked`) as the app reads them (src/web/model/ask.ts), and the person's chats, which stay in
 * their browser (FR-717). The service decides the state, the sources and what was read; this
 * only shapes the turn for the page.
 */
import type { Asked, LoopTurn } from '@contract/answer'
import type { Vocabulary } from '@domain/item'
import type { Term } from '@domain/vocabulary'
import { lookupFailedNote } from '@domain/words'
import { ALL_VALUES } from '@/model/observability'
import type { Answer, AskedRow, AskedWeek, Example, Thread } from '@/model/ask'
import type { Undoable } from './client'

/** A scope as the engine reads it: metric keys, each dimension's value keys, and its days. */
export type ReadScope = Asked['rows'][number]['scope']

/**
 * The names of the vocabulary's keys: `metric:orders` is Orders, `val:channel/email` is Email;
 * and the metrics and the values of every dimension as terms, for the names closest to a
 * question's words.
 */
export type Names = {
  metric: (key: string) => string
  value: (key: string) => string
  terms?: readonly Term[]
}

export function namesOf(vocabulary: Vocabulary): Names & {
  /** A metric's key by its name, any case. */
  metricKey: (name: string) => string | undefined
} {
  const metrics = new Map([
    ...vocabulary.families.map((f) => [f.key, f.name] as const),
    ...vocabulary.metrics.map((m) => [`metric:${m.id}`, m.name] as const),
  ])
  const values = new Map(
    vocabulary.dimensions.flatMap((d) => d.values.map((v) => [`val:${d.id}/${v.id}`, v.name])),
  )
  const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase()
  const term = (key: string, kind: Term['kind'], name: string, aliases: string[] = []): Term => ({
    key,
    kind,
    name,
    aliases,
    parentKey: null,
    areaId: null,
    definitionRefs: [],
  })
  return {
    terms: [
      ...vocabulary.families.map((f) => term(f.key, 'metric', f.name)),
      ...vocabulary.metrics.map((m) => term(`metric:${m.id}`, 'metric', m.name)),
      ...vocabulary.dimensions.flatMap((d) =>
        d.values.map((v) => term(`val:${d.id}/${v.id}`, 'dimension_value', v.name, v.aliases)),
      ),
    ],
    metric: (key) => metrics.get(key) ?? key.replace(/^[a-z]+:/, ''),
    value: (key) => values.get(key) ?? key.replace(/^.*\//, ''),
    metricKey: (name) => {
      const f = vocabulary.families.find((x) => same(x.name, name))
      if (f) return f.key
      const m = vocabulary.metrics.find((x) => same(x.name, name))
      return m && `metric:${m.id}`
    },
  }
}

/** "1 to 31 Aug 2026", "1 Jul to 30 Sep 2026": the days a question was read for. */
const datesWords = (words: string) => words.replace(/^(\d+)-/, '$1 to ')

/** The answer when the check could not run: Not checked, never Not found. */
export const failedAnswer = (question: string): Answer => ({
  id: 'custom',
  question,
  metric: '',
  values: [],
  state: 'failed',
  note: lookupFailedNote,
  text: '',
  sources: [],
  said: "The check failed. Do not say that nothing is known; say that the check couldn't run.",
})

/**
 * A turn of Ask's loop as the chat shows it (FR-718 to FR-720): the model's words with their
 * numbered sources, or its one question back with the readings as choices, or the fixed sentence
 * of a turn that stopped. The state, the footer, what was read and the items named but not used
 * are the service's, written by code from the reads.
 */
export const loopAnswerOf = (
  turn: LoopTurn,
  question: string,
  names: ReturnType<typeof namesOf>,
): Answer => {
  const nouns = new Map(turn.nouns.map((n) => [n.id, n.name]))
  const about = turn.subject?.about ?? []
  const named = (kind: string) =>
    about.flatMap((id) => (id.startsWith(`${kind}:`) ? [nouns.get(id) ?? names.value(id)] : []))
  const dates = turn.subject && !turn.subject.assumedToday ? datesWords(turn.subject.period) : null
  return {
    id: 'custom',
    question,
    loop: turn,
    // What the question was read as: its metric, and the values it narrowed, of any dimension.
    metric: named('metric')[0] ?? '',
    values: named('value'),
    ...(dates ? { dates } : {}),
    state: turn.state,
    text: turn.text,
    sources: turn.sources,
    said: '',
    footer: turn.footer,
    read: turn.read,
    reads: turn.reads,
    ...(turn.nearby.length ? { related: turn.nearby } : {}),
    ...(turn.conflict.length === 2 ? { conflict: turn.conflict } : {}),
    ...(turn.definitions.length ? { definitions: turn.definitions } : {}),
    ...(turn.kind === 'question' ? { reply: 'clarify' as const, choices: turn.choices } : {}),
    // A decline ends with questions to press, as every refusal does.
    ...(turn.kind === 'answer' && turn.choices.length ? { choices: turn.choices } : {}),
    ...(turn.stopped ? { stopped: turn.stopped } : {}),
  }
}

/** The answer when nothing is shared with agents yet: no context, so nothing applies. */
export const nothingLiveAnswer = (question: string): Answer => ({
  id: 'custom',
  question,
  metric: '',
  values: [],
  state: 'missing',
  text: 'Nothing is written down yet, so nothing applies. Once an owner publishes the first context item, Ask answers from it.',
  sources: [],
  said: 'Nothing is written down yet. No match does not prove that nothing applies.',
})

/** The question a row or a starter asks: "What should I know about Orders in Norway?" */
export const questionAbout = (title: string) => `What should I know about ${title}?`

/** Asked this week as Ask shows it, with each row's question; an empty week when nothing is live. */
export function askedWeekOf(asked: Asked | null, names: Names): AskedWeek {
  if (!asked) return { rows: [], hidden: 0, asked: 0 }
  const rows = asked.rows.map((r): AskedRow => {
    // Every dimension's values, by the dimension's key, so a row reads the same each week.
    const values = Object.keys(r.scope.filters)
      .sort()
      .flatMap((dimension) => r.scope.filters[dimension] ?? [])
    const month = r.months[0] ?? r.scope.window.start
    return {
      topic: {
        id: `${r.title}|${month}`,
        metric: r.scope.metrics[0] ? names.metric(r.scope.metrics[0]) : '',
        where: values.length ? values.map(names.value).join(' and ') : ALL_VALUES,
        ...(r.area ? { domain: r.area } : {}),
        month: month.slice(0, 7),
      },
      title: r.title,
      question: questionAbout(r.title),
      times: r.count ?? r.atLeast,
      count: r.count === null ? `${r.atLeast}+` : String(r.count),
      nothing: r.nothing,
      state: r.state,
      sources: r.items,
      // A Nothing written yet card with a draft is named by its draft (the Inbox's own naming).
      ...(r.gap
        ? {
            next: r.gap.draft
              ? { label: 'Write it', href: `/context/new?gap=${r.gap.draft}` }
              : { label: 'Open the card', href: `/inbox?card=${encodeURIComponent(r.gap.card)}` },
          }
        : {}),
    }
  })
  return {
    rows,
    hidden: asked.hidden ?? 0,
    asked: asked.asked,
    askedAtLeast: asked.askedAtLeast,
  }
}

/**
 * The questions Ask offers from the workspace itself (decided 27 October 2026): what agents asked
 * most this week, then the starters made from what it has written. Each asks with its scope.
 */
export function examplesOf(asked: Asked | null): Example[] {
  if (!asked) return []
  return [
    ...asked.rows.map((r) => ({
      id: `asked:${r.title}`,
      label: r.title,
      question: questionAbout(r.title),
    })),
    ...asked.starters.map((s) => ({
      id: `starter:${s.title}`,
      label: s.title,
      question: questionAbout(s.title),
      starter: true,
    })),
  ]
}

/* ---------- the person's chats, in their browser ---------- */

type StoredChat = {
  id: string
  title: string
  question: string
  at: number
  preview: string
  /** Its finished answers, for the newest chats only (`KEPT_ANSWERS`). */
  answers?: KeptAnswer[]
}

/** The most chats that keep their answers in the browser; an older one asks again when opened. */
export const KEPT_ANSWERS = 20

/** An answer as a browser kept it: one kept before its values were named so has them as markets. */
type KeptAnswer = Answer | (Omit<Answer, 'values'> & { markets?: string[] })

const keptAnswer = (a: KeptAnswer): Answer => {
  if ('values' in a) return a
  const { markets = [], ...answer } = a
  return { ...answer, values: markets }
}

const SHORT_MONTHS = 'Jan Feb Mar Apr May Jun Jul Aug Sep Oct Nov Dec'.split(' ')
const startOfDay = (t: number) => new Date(t).setHours(0, 0, 0, 0)
const clockTime = (t: number) => {
  const d = new Date(t)
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

/** When a chat was, as the history groups and shows it. */
export function dayOf(at: number, now: number): Pick<Thread, 'day' | 'time'> {
  const days = Math.round((startOfDay(now) - startOfDay(at)) / 86_400_000)
  if (days <= 0) return { day: 'Today', time: clockTime(at) }
  if (days === 1) return { day: 'Yesterday', time: clockTime(at) }
  const d = new Date(at)
  return { day: 'Earlier', time: `${d.getDate()} ${SHORT_MONTHS[d.getMonth()]}` }
}

/** Where the browser keeps things: its local storage, or memory when that is not there. */
export type Shelf = {
  get: (key: string) => string | null
  set: (key: string, value: string) => void
  remove: (key: string) => void
}

export function browserShelf(): Shelf {
  const memory = new Map<string, string>()
  const storage = () => {
    try {
      return globalThis.localStorage ?? null
    } catch {
      return null
    }
  }
  return {
    get(key) {
      try {
        return storage()?.getItem(key) ?? memory.get(key) ?? null
      } catch {
        return memory.get(key) ?? null
      }
    },
    set(key, value) {
      memory.set(key, value)
      try {
        storage()?.setItem(key, value)
      } catch {
        // A browser that keeps nothing (a private window, storage full) keeps the chats in memory.
      }
    },
    remove(key) {
      memory.delete(key)
      try {
        storage()?.removeItem(key)
      } catch {
        // Nothing was kept there to remove.
      }
    },
  }
}

/**
 * The chats under Ask, kept in the person's browser under their own key, so another person signed
 * in on the same browser never sees them, and never sent to the service (FR-603, FR-717).
 */
export function createChatShelf(shelf: Shelf, now: () => number = Date.now) {
  const undos = new Map<string, () => void>()
  const keyOf = (person: string) => `footnote.ask.chats.${person}`
  const read = (person: string): StoredChat[] => {
    try {
      const parsed: unknown = JSON.parse(shelf.get(keyOf(person)) ?? '[]')
      return Array.isArray(parsed) ? (parsed as StoredChat[]) : []
    } catch {
      return []
    }
  }
  const write = (person: string, chats: StoredChat[]) =>
    shelf.set(keyOf(person), JSON.stringify(chats))
  return {
    list: (person: string): Thread[] =>
      read(person)
        .sort((a, b) => b.at - a.at)
        .map((c) => ({
          id: c.id,
          title: c.title,
          question: c.question,
          preview: c.preview,
          ...(c.answers?.length ? { answers: c.answers.map(keptAnswer) } : {}),
          ...dayOf(c.at, now()),
        })),
    /** A chat the person just started, at the top of Today, with what its first answer said. */
    add(person: string, id: string, question: string, preview: string) {
      write(person, [
        { id, title: question, question, at: now(), preview },
        ...read(person).filter((c) => c.id !== id),
      ])
    },
    /**
     * The finished answers of a chat, kept with it: the newest chats keep theirs, so what the
     * browser holds stays small.
     */
    keep(person: string, id: string, question: string, answers: Answer[]) {
      const chats = read(person)
      const at = chats.find((c) => c.id === id)
      const kept = at
        ? chats.map((c) => (c.id === id ? { ...c, answers } : c))
        : [{ id, title: question, question, at: now(), preview: '', answers }, ...chats]
      const newest = [...kept]
        .sort((a, b) => b.at - a.at)
        .slice(0, KEPT_ANSWERS)
        .map((c) => c.id)
      write(
        person,
        kept.map(({ answers: a, ...c }) => (a && newest.includes(c.id) ? { ...c, answers: a } : c)),
      )
    },
    rename(person: string, id: string, title: string) {
      write(
        person,
        read(person).map((c) => (c.id === id ? { ...c, title } : c)),
      )
    },
    /** Deletes a chat; the token puts it back as it was. */
    remove(person: string, id: string): Undoable {
      const gone = read(person).find((c) => c.id === id)
      write(
        person,
        read(person).filter((c) => c.id !== id),
      )
      const token = `chat:${globalThis.crypto.randomUUID()}`
      undos.set(token, () => {
        if (gone && !read(person).some((c) => c.id === id)) write(person, [...read(person), gone])
      })
      // Kept in this browser, it can be put back until the page goes.
      return { undo: { token, until: null } }
    },
    /** Takes all of a person's chats out of the browser, as at sign-out, so none can be put back. */
    forget(person: string) {
      shelf.remove(keyOf(person))
      undos.clear()
    },
    /** Whether a token is one of these chats' own; it puts the chat back once. */
    undo(token: string): boolean {
      const put = undos.get(token)
      if (!put) return false
      undos.delete(token)
      put()
      return true
    },
  }
}
