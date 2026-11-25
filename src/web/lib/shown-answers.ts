import * as React from 'react'
import type { Answer } from '@/model/ask'
import type { Fact } from '@/model/items'

// The answers on screen, kept by a key the dock's address carries, so the right panel can share an
// answer or show where it says that while the chat stays beside it. In memory only, like the chats.

export type ShownAnswer = {
  answer: Answer
  facts: Fact[]
}

const shown = new Map<string, ShownAnswer>()
const listeners = new Set<() => void>()

/** A key for an answer in a chat: its turn and its question, so two chats never share one. */
export function answerKey(a: Pick<Answer, 'id' | 'question'>) {
  let h = 7
  for (const c of a.question) h = (h * 31 + c.charCodeAt(0)) >>> 0
  return `${a.id}-${h.toString(36)}`
}

export function keepShown(key: string, entry: ShownAnswer) {
  const kept = shown.get(key)
  if (kept?.answer === entry.answer) return
  shown.set(key, entry)
  listeners.forEach((l) => l())
}

/** An answer on screen, or undefined until its chat shows it. */
export function useShownAnswer(key: string | undefined) {
  return React.useSyncExternalStore(
    (l) => {
      listeners.add(l)
      return () => listeners.delete(l)
    },
    () => (key ? shown.get(key) : undefined),
  )
}

/*
  The answers on screen that were reported this visit, from wherever the form was: the right panel
  beside the answer, or under it. The answer shows its line, and offers Something wrong? no more.
*/
const reported = new Set<string>()
const reportListeners = new Set<() => void>()

export function markReportSent(key: string) {
  reported.add(key)
  reportListeners.forEach((l) => l())
}

/** Whether the answer on screen by this key was reported this visit. */
export function useReportSent(key: string) {
  return React.useSyncExternalStore(
    (l) => {
      reportListeners.add(l)
      return () => reportListeners.delete(l)
    },
    () => reported.has(key),
  )
}
