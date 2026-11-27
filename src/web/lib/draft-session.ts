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
// draft again, merges, and saves once more. The rules are model/draft-session.ts.

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
    const agentOf = (f: SessionField) => fact.session?.fields[f]?.agent ?? 'Your agent'
    if (merged.waiting.length)
      setWaiting((w) => ({
        ...w,
        ...Object.fromEntries(merged.waiting.map((f) => [f, { form: theirs, agent: agentOf(f) }])),
      }))
  }

  const read = useQuery({
    ...draftNowQuery(draft?.id ?? ''),
    enabled: on,
    staleTime: 0,
    refetchInterval: DRAFT_REFRESH_MS,
    refetchOnWindowFocus: 'always',
  })

  const autosave = useAutosave<number>({
    save: async () => {
      for (let tries = 1; ; tries++) {
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
    if (!on) return
    if (unsaved.length) autosave.change(++tick.current)
    else autosave.discard()
    // The form is what changes; what it is compared with moves with every save.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [on, form])

  const without = (field: SessionField) => setWaiting(({ [field]: _, ...rest }) => rest)

  return {
    on,
    status: autosave.status,
    retry: autosave.retry,
    /** Sends what is waiting; settles once all of it is stored. */
    flush: autosave.flush,
    /** What the agent changed last, for the strip, until Undo or the strip is closed. */
    change,
    undo: () => {
      if (!change) return
      const undone = undoChange(formRef.current, change)
      put(undone, change.fields)
      setChange(null)
    },
    dismiss: () => setChange(null),
    /**
     * The agent's words for a field the person is writing in, until they take them or keep their
     * own; none once the field says the same.
     */
    waitingIn: (field: SessionField) => {
      const theirs = waiting[field]
      return theirs && !sameField(form, theirs.form, field) ? theirs : undefined
    },
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
     * Who wrote a field the person has not changed since: their agent, by its name, when it was
     * the last to change it and nobody has confirmed it.
     */
    agentIn: (field: SessionField) => {
      const stamp = stamps[field]
      if (stamp?.by !== 'agent' || stamp.mark === 'confirmed' || unsaved.includes(field)) return
      return stamp.agent ?? 'Your agent'
    },
  }
}
