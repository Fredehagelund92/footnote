import * as React from 'react'
import { useQuery } from '@tanstack/react-query'
import { ApiError } from '@/api/errors'
import { draftNowQuery, useWrite } from '@/api/queries'
import { useAutosave } from '@/lib/autosave'
import {
  joinChanges,
  mergeDraft,
  sameField,
  sessionFields,
  takeField,
  undoChange,
  unsavedFields,
  writerName,
  type AgentChange,
  type FieldBy,
  type SessionField,
  type SessionForm,
} from '@/model/draft-session'
import type { Fact } from '@/model/items'

// The person's own draft in the editor, written with their agent (Route 1): it saves as they type,
// and while it is open it is read again every five seconds and whenever the person comes back to
// the window. What their agent changed comes into each field they are not writing in, said on a
// strip with Undo; in a field they are writing in, the agent's words wait beside theirs. A save
// over a revision the agent has moved on is refused by the service (409): the editor reads the
// draft again, merges, and saves once more. The rules are model/draft-session.ts. Writing help, the
// editor's dock, changes the same draft: what it changed comes in the same way, and the dock keeps
// each turn's change for its own Undo (lib/writing-help.ts).

/** How often an open draft is read again. */
export const DRAFT_REFRESH_MS = 5_000

/** A conflict refused this many times in a row is said as a failed save, not tried again. */
const MERGES_PER_SAVE = 3

type Options<F extends SessionForm> = {
  /** The draft as the editor opened it, with its session; undefined for anything else. */
  draft: Fact | undefined
  form: F
  setForm: (form: F) => void
  /** The form as the editor reads a draft, and the draft it saves from a form. */
  formOf: (fact: Fact) => F
  factOf: (form: F) => Fact
  /** Whether the cursor is in a field: what the person is writing in is never written over. */
  typing: (field: SessionField) => boolean
  /** The text came in from elsewhere (the agent, Undo): put it into the text editor. */
  setText: (body: string) => void
  onError: (error: unknown) => void
  /** Writing help changed fields the person was not writing in: what came into the form. */
  onHelped?: (change: AgentChange) => void
  /** Writing help wrote fields the person was writing in: its words wait under each, as a suggestion. */
  onSuggested?: (fields: SessionField[]) => void
}

export function useDraftSession<F extends SessionForm>(options: Options<F>) {
  const { draft, form } = options
  const on = !!draft?.session
  const write = useWrite()
  const latest = React.useRef(options)
  React.useLayoutEffect(() => {
    latest.current = options
  })
  // What the service holds as far as the editor knows, and the revision it is at. Refs, as the
  // save and the reads use them between renders; `track` draws them.
  const [track, setTrack] = React.useState(() => ({
    saved: form,
    revision: draft?.session?.revision ?? 0,
  }))
  const opened = React.useRef(track)
  const formRef = React.useRef(form)
  React.useLayoutEffect(() => {
    formRef.current = form
  })
  const keep = (next: { saved: F; revision: number }) => {
    opened.current = next
    setTrack(next)
  }
  const [stamps, setStamps] = React.useState(draft?.session?.fields ?? {})
  // A draft handed over after the page opened (a new item that kept itself) starts from what the
  // service holds of it, as one opened with it.
  const handed = React.useRef(draft?.id)
  React.useLayoutEffect(() => {
    if (draft?.id === handed.current) return
    handed.current = draft?.id
    if (!draft?.session) return
    keep({ saved: latest.current.formOf(draft), revision: draft.session.revision })
    setStamps(draft.session.fields)
    // Only a draft with another id is handed over: `keep` and the options move with every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft?.id])
  const [change, setChange] = React.useState<AgentChange | null>(null)
  /** The agent's words for a field the person is writing in, and the agent's name. */
  const [waiting, setWaiting] = React.useState<
    Partial<Record<SessionField, { form: F; agent: string }>>
  >({})

  const put = (next: F, fields: readonly SessionField[]) => {
    formRef.current = next
    latest.current.setForm(next)
    if (fields.includes('text')) latest.current.setText(next.body)
  }

  /** The draft as the service has it now, merged into what the person is writing. */
  const merge = (fact: Fact) => {
    if (!fact.session) return
    const theirs = latest.current.formOf(fact)
    const merged = mergeDraft(
      { form: formRef.current, ...opened.current },
      { form: theirs, session: fact.session },
      latest.current.typing,
    )
    if (!merged) return
    keep({ saved: merged.saved, revision: merged.revision })
    setStamps(fact.session.fields)
    if (merged.form !== formRef.current)
      put(
        merged.form,
        sessionFields.filter((f) => !sameField(merged.form, formRef.current, f)),
      )
    const came = merged.change
    if (came) setChange((older) => joinChanges(older, came))
    // Writing help's change is its turn's to gather: the editor's dock keeps them (lib/writing-help).
    if (merged.helped) latest.current.onHelped?.(merged.helped)
    const agentOf = (f: SessionField) => writerName(fact.session?.fields[f] ?? { by: 'agent' })
    const suggested = merged.waiting.filter((f) => fact.session?.fields[f]?.by === 'writing_help')
    if (suggested.length) latest.current.onSuggested?.(suggested)
    const { settled } = merged
    if (settled.length || merged.waiting.length)
      setWaiting((w) => {
        const rest = Object.fromEntries(
          Object.entries(w).filter(([f]) => !settled.includes(f as SessionField)),
        )
        return {
          ...rest,
          ...Object.fromEntries(
            merged.waiting.map((f) => [f, { form: theirs, agent: agentOf(f) }]),
          ),
        }
      })
  }

  const read = useQuery({
    ...draftNowQuery(draft?.id ?? ''),
    enabled: on,
    staleTime: 0,
    refetchInterval: DRAFT_REFRESH_MS,
    refetchOnWindowFocus: 'always',
  })

  // Published or sent, the draft is no longer the person's to save: nothing that waits goes after
  // it, not even as the page is left.
  const ended = React.useRef(false)
  const autosave = useAutosave<number>({
    save: async () => {
      for (let tries = 1; !ended.current; tries++) {
        const sent = formRef.current
        const { saved, revision } = opened.current
        const { factOf } = latest.current
        // Written back as it was, or merged in from the service: nothing is left to save.
        const changed = unsavedFields(sent, saved)
        if (!changed.length) return
        try {
          const done = await write('autosaveDraft', {
            fact: factOf(sent),
            before: factOf(saved),
            revision,
          })
          // What went is stored, at the revision the service answered: each field the person
          // changed is theirs now.
          const at = new Date().toISOString()
          const theirs: FieldBy = { by: 'person', revision: done.revision, at }
          setStamps((s) => ({ ...s, ...Object.fromEntries(changed.map((f) => [f, theirs])) }))
          keep({ saved: sent, revision: done.revision })
          return
        } catch (error) {
          // Their agent changed the draft since it was read: read it again, merge, save again.
          if (!(error instanceof ApiError && error.kind === 'conflict') || tries >= MERGES_PER_SAVE)
            throw error
          const now = await read.refetch()
          if (!now.data?.session) throw error
          merge(now.data)
        }
      }
    },
    onError: (error) => latest.current.onError(error),
  })

  // Every read that answers is merged, unless a save is on its way: its answer, or its 409, comes
  // first, and the next read brings the rest.
  const readAt = read.dataUpdatedAt
  React.useEffect(() => {
    if (!on || autosave.status === 'saving' || !read.data?.session) return
    merge(read.data)
    // Only a new answer is merged: the form and the save move on without it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [on, readAt])

  // Coming back to the window reads the draft again, as coming back to the tab does: the person may
  // have been in their agent's chat, beside the browser.
  const { refetch } = read
  React.useEffect(() => {
    if (!on) return
    const again = () => void refetch()
    window.addEventListener('focus', again)
    return () => window.removeEventListener('focus', again)
  }, [on, refetch])

  // Each change the person makes is saved a moment later; a field written back as it was is not.
  const unsaved = on ? unsavedFields(form, track.saved) : []
  const tick = React.useRef(0)
  React.useEffect(() => {
    if (!on || ended.current) return
    if (unsaved.length) autosave.change(++tick.current)
    else autosave.discard()
    // The form is what changes; what it is compared with moves with every save.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [on, form])

  const without = (field: SessionField) => setWaiting(({ [field]: _, ...rest }) => rest)
  const autosaveStatus = React.useRef(autosave.status)
  React.useLayoutEffect(() => {
    autosaveStatus.current = autosave.status
  })

  // The draft read again now and merged, without waiting for the next read on its own. One read
  // at a time: asked again while one is on its way, it reads once more after it, so what it
  // answers is never older than the asking, and a read is never cut short by the next.
  const refreshing = React.useRef<Promise<void> | null>(null)
  const refreshAgain = React.useRef(false)
  const refresh = () => {
    refreshAgain.current = true
    refreshing.current ??= (async () => {
      while (refreshAgain.current) {
        refreshAgain.current = false
        const now = await refetch()
        if (now.data?.session && autosaveStatus.current !== 'saving') merge(now.data)
      }
    })().finally(() => {
      refreshing.current = null
    })
    return refreshing.current
  }

  /**
   * A writer's words for a field the person is writing in, until they take them or keep their
   * own; none once the field says the same.
   */
  const waitingIn = (field: SessionField) => {
    const theirs = waiting[field]
    return theirs && !sameField(form, theirs.form, field) ? theirs : undefined
  }

  return {
    on,
    status: autosave.status,
    retry: autosave.retry,
    /** Sends what is waiting; settles once all of it is stored. */
    flush: autosave.flush,
    /** The draft was published or sent as itself: nothing more is saved to it. */
    end: () => {
      ended.current = true
      autosave.discard()
    },
    /** What the agent changed last, for the strip, until Undo or the strip is closed. */
    change,
    undo: () => {
      if (!change) return
      const undone = undoChange(formRef.current, change)
      put(undone, change.fields)
      setChange(null)
    },
    dismiss: () => setChange(null),
    /** The draft read again now, so a writer's change shows at once. */
    refresh,
    /**
     * Takes a change back: each of its fields as it was before, unless the person has changed it
     * since. Writing help's Undo, which the editor's dock keeps a turn at a time.
     */
    revert: (change: AgentChange) => put(undoChange(formRef.current, change), change.fields),
    waitingIn,
    take: (field: SessionField) => {
      const theirs = waiting[field]
      if (!theirs) return
      put(takeField(formRef.current, theirs.form, field), [field])
      without(field)
    },
    leave: (field: SessionField) => {
      const theirs = waiting[field]
      if (theirs)
        keep({ ...opened.current, saved: takeField(opened.current.saved, theirs.form, field) })
      without(field)
      if (theirs && !sameField(formRef.current, theirs.form, field)) autosave.change(++tick.current)
    },
    /**
     * Who wrote a field the person has not changed since: their agent, by its name, or writing
     * help, when it was the last to change it and nobody has confirmed it. Not a field whose
     * words still wait beside the person's own: what the field holds is theirs.
     */
    agentIn: (field: SessionField) => {
      const stamp = stamps[field]
      if (!stamp || stamp.by === 'person' || stamp.mark === 'confirmed' || unsaved.includes(field))
        return
      if (waitingIn(field)) return
      return writerName(stamp)
    },
  }
}
