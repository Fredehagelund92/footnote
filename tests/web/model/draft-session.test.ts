import { describe, expect, it } from 'vitest'
import {
  agoWords,
  changeLine,
  helpChangeLine,
  inSentence,
  joinChanges,
  mergeDraft,
  undoChange,
  unsavedFields,
  writerName,
  type DraftSession,
  type SessionForm,
} from '@/model/draft-session'

// The editor keeps up with the person's agent (Route 1): what the agent changed comes into each
// field the person is not writing in, and never over what they typed; Undo puts it back.

const form: SessionForm = {
  title: 'Norway customs rule',
  body: 'Online sales to Norway stopped on 4 August 2026.',
  kind: 'event',
  domain: 'sales',
  owners: ['Jon Abara'],
  where: [],
  when: 'from',
  from: '2026-08-04',
  until: '',
  source: '',
  quote: '',
  dontConclude: '',
}
const at = '2026-11-27T10:00:00.000Z'
const byAgent = (revision: number) => ({ by: 'agent' as const, agent: 'Claude', revision, at })
const session = (fields: DraftSession['fields'], revision = 2): DraftSession => ({
  revision,
  fields,
})
const nobodyTyping = () => false

describe('mergeDraft', () => {
  it('puts what the agent changed into the fields the person is not writing in, with Undo', () => {
    const theirs = { ...form, title: 'Webshop sales to Norway stopped', body: 'Parcels are held.' }
    const merged = mergeDraft(
      { form, saved: form, revision: 1 },
      { form: theirs, session: session({ title: byAgent(2), text: byAgent(2) }) },
      nobodyTyping,
    )!
    expect(merged.form).toEqual(theirs)
    expect(merged.saved).toEqual(theirs)
    expect(merged.revision).toBe(2)
    expect(merged.waiting).toEqual([])
    expect(merged.change).toMatchObject({ agent: 'Claude', fields: ['title', 'text'], at })
    expect(undoChange(merged.form, merged.change!)).toEqual(form)
  })

  it('never writes over a field the person changed and has not saved: the agent’s words wait', () => {
    const mine = { ...form, title: 'Webshop sales stopped' }
    const theirs = { ...form, title: 'Online sales stopped', body: 'Parcels are held.' }
    const merged = mergeDraft(
      { form: mine, saved: form, revision: 1 },
      { form: theirs, session: session({ title: byAgent(2), text: byAgent(2) }) },
      nobodyTyping,
    )!
    expect(merged.form).toEqual({ ...mine, body: 'Parcels are held.' })
    expect(merged.waiting).toEqual(['title'])
    expect(merged.change?.fields).toEqual(['text'])
    // What is stored now is the agent's title, so the person's is still to save.
    expect(unsavedFields(merged.form, merged.saved)).toEqual(['title'])
  })

  it('never writes over the field the cursor is in, saved or not', () => {
    const theirs = { ...form, dontConclude: 'Not that demand fell.' }
    const merged = mergeDraft(
      { form, saved: form, revision: 1 },
      { form: theirs, session: session({ dontConclude: byAgent(2) }) },
      (field) => field === 'dontConclude',
    )!
    expect(merged.form).toEqual(form)
    expect(merged.waiting).toEqual(['dontConclude'])
    expect(merged.change).toBeNull()
    // Nothing of theirs is unsaved there: the person's old words are not saved over the agent's.
    expect(unsavedFields(merged.form, merged.saved)).toEqual([])
  })

  it('settles a wait when the field later comes in, and a field that waits again replaces it', () => {
    const first = { ...form, title: 'Online sales stopped' }
    const waits = mergeDraft(
      { form, saved: form, revision: 1 },
      { form: first, session: session({ title: byAgent(2) }, 2) },
      (field) => field === 'title',
    )!
    expect(waits.waiting).toEqual(['title'])
    expect(waits.settled).toEqual([])
    const later = { ...form, title: 'Webshop sales stopped' }
    const settles = mergeDraft(
      { form: waits.form, saved: waits.saved, revision: 2 },
      { form: later, session: session({ title: byAgent(3) }, 3) },
      nobodyTyping,
    )!
    expect(settles.form.title).toBe('Webshop sales stopped')
    expect(settles.waiting).toEqual([])
    expect(settles.settled).toEqual(['title'])
    const again = mergeDraft(
      { form: waits.form, saved: waits.saved, revision: 2 },
      { form: later, session: session({ title: byAgent(3) }, 3) },
      (field) => field === 'title',
    )!
    expect(again.waiting).toEqual(['title'])
    expect(again.settled).toEqual([])
  })

  it('reads only what changed after its revision, by who changed it, never by the words', () => {
    // The service writes a field back in its own way; one nobody changed since is left alone.
    const theirs = { ...form, body: 'Online sales to Norway stopped on 4 August 2026 .' }
    expect(
      mergeDraft(
        { form, saved: form, revision: 2 },
        { form: theirs, session: session({ text: byAgent(2) }, 3) },
        nobodyTyping,
      ),
    ).toMatchObject({ form, change: null, revision: 3 })
    // Nothing newer than what the editor has: nothing to merge.
    expect(
      mergeDraft(
        { form, saved: form, revision: 3 },
        { form: theirs, session: session({ text: byAgent(3) }, 3) },
        nobodyTyping,
      ),
    ).toBeNull()
  })

  it("brings the person's own change from another window in quietly", () => {
    const theirs = { ...form, kind: 'issue' }
    const merged = mergeDraft(
      { form, saved: form, revision: 1 },
      { form: theirs, session: session({ kind: { by: 'person', revision: 2, at } }) },
      nobodyTyping,
    )!
    expect(merged.form.kind).toBe('issue')
    expect(merged.change).toBeNull()
  })

  it('moves a domain with its owners, and says it by the domain alone', () => {
    const theirs = { ...form, domain: 'marketing', owners: ['Ines Duarte'] }
    const merged = mergeDraft(
      { form, saved: form, revision: 1 },
      { form: theirs, session: session({ domain: byAgent(2) }) },
      nobodyTyping,
    )!
    expect(merged.form).toMatchObject({ domain: 'marketing', owners: ['Ines Duarte'] })
    expect(merged.change?.fields).toEqual(['domain'])
  })
})

describe('Undo', () => {
  it('keeps a field the person changed after the agent did', () => {
    const theirs = { ...form, title: 'Webshop sales stopped', body: 'Parcels are held.' }
    const merged = mergeDraft(
      { form, saved: form, revision: 1 },
      { form: theirs, session: session({ title: byAgent(2), text: byAgent(2) }) },
      nobodyTyping,
    )!
    const typed = { ...merged.form, title: 'Webshop sales to Norway stopped' }
    expect(undoChange(typed, merged.change!)).toEqual({ ...form, title: typed.title })
  })

  it('takes back two changes that came one after the other at once', () => {
    const first = mergeDraft(
      { form, saved: form, revision: 1 },
      { form: { ...form, title: 'One' }, session: session({ title: byAgent(2) }) },
      nobodyTyping,
    )!
    const second = mergeDraft(
      { form: first.form, saved: first.saved, revision: 2 },
      {
        form: { ...first.form, title: 'Two', kind: 'issue' },
        session: session({ title: byAgent(3), kind: byAgent(3) }, 3),
      },
      nobodyTyping,
    )!
    const both = joinChanges(first.change, second.change!)
    expect(both.fields).toEqual(['title', 'kind'])
    expect(undoChange(second.form, both)).toEqual(form)
  })
})

describe('the strip', () => {
  it('says what changed and how long ago', () => {
    const change = {
      agent: 'Claude',
      fields: ['title', 'text', 'when'] as const,
      at,
      before: form,
      after: form,
    }
    expect(
      changeLine({ ...change, fields: [...change.fields] }, new Date(Date.parse(at) + 23_000)),
    ).toBe('Claude changed Title, Text and When, 20 seconds ago')
    expect(changeLine({ ...change, fields: ['when'] }, new Date(at))).toBe(
      'Claude changed When, just now',
    )
  })

  it('counts in tens of seconds, then minutes, then says the time', () => {
    const then = new Date(at)
    const after = (s: number) => agoWords(then, new Date(then.getTime() + s * 1000))
    expect(after(-5)).toBe('just now')
    expect(after(9)).toBe('just now')
    expect(after(59)).toBe('50 seconds ago')
    expect(after(61)).toBe('a minute ago')
    expect(after(60 * 12)).toBe('12 minutes ago')
    expect(after(60 * 90)).toMatch(/^at \d\d:\d\d$/)
  })
})

describe('writing help as a writer of the draft', () => {
  const byHelp = (revision: number) => ({ by: 'writing_help' as const, revision, at })
  const blank: SessionForm = { ...form, title: '', body: '', when: 'always', from: '' }

  it('comes into the form as its own change, apart from an agent’s', () => {
    const theirs = {
      ...form,
      title: 'Webshop sales to Norway stopped',
      dontConclude: 'Not demand.',
    }
    const merged = mergeDraft(
      { form, saved: form, revision: 1 },
      { form: theirs, session: session({ title: byHelp(2), dontConclude: byAgent(2) }) },
      nobodyTyping,
    )!
    expect(merged.form).toEqual(theirs)
    expect(merged.helped).toMatchObject({ agent: 'Writing help', fields: ['title'], at })
    expect(merged.change).toMatchObject({ agent: 'Claude', fields: ['dontConclude'] })
    // Each takes back its own fields only.
    expect(undoChange(merged.form, merged.helped!)).toEqual({ ...theirs, title: form.title })
  })

  it('never writes over the field the cursor is in: its words wait there', () => {
    const theirs = { ...form, title: 'Webshop sales to Norway stopped', body: 'Parcels are held.' }
    const merged = mergeDraft(
      { form, saved: form, revision: 1 },
      { form: theirs, session: session({ title: byHelp(2), text: byHelp(2) }) },
      (field) => field === 'title',
    )!
    expect(merged.form).toEqual({ ...form, body: 'Parcels are held.' })
    expect(merged.waiting).toEqual(['title'])
    expect(merged.helped?.fields).toEqual(['text'])
  })

  it('is named as a writer at the start of a sentence, and as a plain noun inside one', () => {
    expect(writerName({ by: 'writing_help' })).toBe('Writing help')
    expect(writerName({ by: 'agent', agent: 'Claude' })).toBe('Claude')
    expect(writerName({ by: 'agent' })).toBe('Your agent')
    expect(inSentence('Writing help')).toBe('writing help')
    expect(inSentence('Claude')).toBe('Claude')
  })

  it('says a first fill by its count, any other change by its fields, and what kept the person’s words', () => {
    const now = new Date('2026-11-27T10:00:04.000Z')
    const filled = {
      agent: 'Writing help',
      fields: ['title', 'text', 'when'] as const,
      at,
      before: blank,
      after: form,
    }
    expect(helpChangeLine({ ...filled, fields: [...filled.fields] }, now)).toBe(
      'Writing help filled in 3 fields from your message. Check each one.',
    )
    const changed = {
      agent: 'Writing help',
      fields: ['text' as const],
      at,
      before: form,
      after: form,
    }
    expect(helpChangeLine(changed, now)).toBe('Writing help changed Text, just now.')
    expect(helpChangeLine({ ...changed, kept: ['title'] }, now)).toBe(
      'Writing help changed Text, just now. Title was kept as you wrote it.',
    )
    expect(helpChangeLine({ ...changed, kept: ['title', 'when'] }, now)).toBe(
      'Writing help changed Text, just now. Title and When were kept as you wrote them.',
    )
  })
})
