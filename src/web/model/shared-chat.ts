import type { MyShare, ShareTurn } from '@contract/shared-chats'
import type { Answer } from './ask'

// A chat shared as a link (FR-721): what each of its turns sends, and how its sender's links are
// told apart. Pure: the screens are components/footnote/share-chat.tsx and pages/shared-chat.tsx.

/** The most a turn sends, as the service takes it: longer words or lists are cut. */
const WORDS_MAX = 20_000
const LINE_MAX = 500
const LINES_MAX = 20
const SOURCES_MAX = 50

/**
 * What one answered turn sends: its question as asked, what Ask read, its state, its words with
 * [n] for its nth source, and its sources by id. Never a figure, a definition or an item's words:
 * the sources are read live when the link opens. None for a turn with no question.
 */
export function shareTurnOf(a: Answer): ShareTurn | null {
  const question = a.question.trim()
  if (!question) return null
  return {
    question: question.slice(0, 2000),
    read: (a.read ?? []).slice(0, LINES_MAX).map((line) => line.slice(0, LINE_MAX)),
    state: a.state,
    words: a.text.slice(0, WORDS_MAX),
    sources: a.sources.slice(0, SOURCES_MAX),
  }
}

/** Every turn of a chat as it is now, oldest first. */
export const shareTurnsOf = (answers: readonly Answer[]): ShareTurn[] =>
  answers.flatMap((a) => shareTurnOf(a) ?? [])

/** A shared chat's own page. */
export const sharedChatPath = (id: string) => `/shared/${id}`

/** The address a person copies. */
export const sharedChatLink = (id: string, origin = globalThis.location?.origin ?? '') =>
  `${origin}${sharedChatPath(id)}`

/** A chat's live links, newest first, the title the newest keeps, and when the last one ends. */
export type ChatLinks = { ids: string[]; title: string; until: string }

/** The person's live links by the chat they copy. */
export function linksByChat(links: readonly MyShare[]): Map<string, ChatLinks> {
  const byChat = new Map<string, ChatLinks>()
  for (const link of links) {
    const had = byChat.get(link.chat)
    if (!had) byChat.set(link.chat, { ids: [link.id], title: link.title, until: link.until })
    else
      byChat.set(link.chat, {
        ...had,
        ids: [...had.ids, link.id],
        until: link.until > had.until ? link.until : had.until,
      })
  }
  return byChat
}

/**
 * The link a chat already has that keeps every turn it has now, so opening Share chat again (or
 * reloading it) makes no second link for the same chat.
 */
export const sameLinkOf = (links: readonly MyShare[], chat: string, turns: number) =>
  links.find((l) => l.chat === chat && l.turns === turns)

/** "1 answer", "3 answers". */
export const answersCount = (n: number) =>
  n === 1 ? '1 answer' : `${n.toLocaleString('en-GB')} answers`
