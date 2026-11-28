import * as React from 'react'
import {
  ChevronDownIcon,
  ChevronRightIcon,
  EqualIcon,
  LockIcon,
  PlusIcon,
  TriangleAlertIcon,
} from '@/components/icons'
import { termWord } from '@domain/terms'
import { toast } from '@/lib/toast'
import { cn } from '@/lib/utils'
import { TypeGlyph, glyphs, kindOf } from '@/components/footnote/type-glyph'
import { TagChip } from '@/components/footnote/tag-chip'
import { Kbd } from '@/components/ui/kbd'
import {
  listIndex,
  parseTags,
  kindName,
  type BuiltFromMetric,
  type Conflict,
  type Definition,
  useGlossary,
} from '@/lib/definitions'
import { openDock, useDock } from '@/lib/dock'
import { useFacts, useMe } from '@/lib/workspace'
import { PeekBand, PeekLabel } from '@/components/footnote/peek'
import { useQuery } from '@tanstack/react-query'
import { toApiError } from '@/api/errors'
import { Button } from '@/components/ui/button'
import { builtFromQuery, useWrite } from '@/api/queries'
import { useUndo } from '@/lib/undo'
import { useShowMore } from '@/hooks/use-show-more'
import { ShowMoreButton } from '@/components/footnote/show-more'

/** The type as a neutral tile: 24 in compact rows, 28 in comfortable rows, headers and on a phone. Labelled for screen readers. */
export function TypeTile({
  d,
  size = 'md',
  label,
  className,
}: {
  d: Pick<Definition, 'type' | 'sameAs' | 'family'>
  size?: 'md' | 'lg'
  /** What it says to a screen reader in place of its kind, when a tooltip beside it says the same. */
  label?: string
  className?: string
}) {
  const Glyph = glyphs[kindOf(d)]
  const corner = size === 'md' ? 'rounded-sm' : 'rounded-md'
  const tile = (
    <span
      role="img"
      aria-label={label ?? kindName(d)}
      title={label ? undefined : kindName(d)}
      className={cn(
        'relative inline-flex shrink-0 items-center justify-center border bg-muted text-foreground',
        size === 'md' ? 'size-6 [&>svg]:size-3.5' : 'size-7 [&>svg]:size-4',
        corner,
        !d.family && className,
      )}
    >
      <Glyph aria-hidden />
    </span>
  )
  if (!d.family) return tile
  // A family is its metric's tile with two more behind it, each a step up and to the right: a
  // stack of variants. Their edges are the muted ink, so the stack reads in light and dark alike.
  const behind = cn(
    'absolute border border-muted-foreground/35 bg-muted',
    size === 'md' ? 'size-6' : 'size-7',
    corner,
  )
  return (
    // The stack takes no room of its own: the name beside it starts where a metric's would.
    <span className={cn('relative -mt-1 -mr-1 inline-flex shrink-0 pt-1 pr-1', className)}>
      <span aria-hidden className={cn(behind, 'top-0 right-0 opacity-60')} />
      <span aria-hidden className={cn(behind, 'top-0.5 right-0.5')} />
      {tile}
    </span>
  )
}

/**
 * What a definition with no words of its own says: one read from a tool is described there, so
 * the line says where, by the member's name in it; one people keep here has nothing written yet.
 */
export function NoMeaning({ d }: { d: Definition }) {
  if (!d.synced) return <>No meaning written yet.</>
  const tool = d.tool ?? 'its tool'
  const member = d.ref?.slice(d.ref.indexOf(':') + 1)
  return member ? (
    <>
      No description in {tool}. Add one there, in{' '}
      <code className="font-mono text-sm">{member}</code>.
    </>
  ) : (
    <>No description in {tool}. Add one there.</>
  )
}

/** A synonym's quiet link to the definition whose meaning it uses: "Other name for Σ Gross sales". */
export function OtherNameFor({ target, className }: { target: Definition; className?: string }) {
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation()
        openDock('def', target.name)
      }}
      className={cn(
        'inline-flex h-6 max-w-full shrink-0 items-center gap-1 rounded-md border px-1.5 text-xs text-muted-foreground outline-none hover:bg-muted hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50',
        className,
      )}
    >
      Other name for
      <TypeGlyph d={target} className="text-foreground" />
      <span className="truncate font-medium text-foreground">{target.name}</span>
    </button>
  )
}

/** Why a term can mislead an agent, said once, in the warning tone. */
export function ConflictNote({
  d,
  self,
  className,
}: {
  d: Definition
  /** The term a draft was opened from. */
  self?: string | undefined
  className?: string
}) {
  const glossary = useGlossary()
  const conflict = glossary.conflictOf(d, self)
  if (!conflict) return null
  return (
    <p
      role="note"
      className={cn(
        'flex gap-2 rounded-frame border border-caution/40 bg-caution/8 px-3 py-2 text-sm',
        className,
      )}
    >
      <TriangleAlertIcon aria-hidden className="mt-0.5 size-4 shrink-0 text-caution" />
      <span>
        <span className="font-medium">
          {conflict.kind === 'chain'
            ? 'Points to a synonym. '
            : conflict.kind === 'two-things'
              ? 'Used for two things. '
              : 'Points nowhere. '}
        </span>
        {conflict.message}{' '}
        {conflict.asks
          ? "Agents ask which one until it's settled."
          : "Agents don't use it until it's settled."}
      </span>
    </p>
  )
}

/** A note on a word as it is typed: the word is taken, or it looks like one in use. */
export function WordNote({
  title,
  children,
  className,
}: {
  title: string
  children: React.ReactNode
  className?: string
}) {
  return (
    <p
      role="note"
      className={cn(
        'flex gap-2 rounded-frame border border-caution/40 bg-caution/8 px-3 py-2 text-sm',
        className,
      )}
    >
      <TriangleAlertIcon aria-hidden className="mt-0.5 size-4 shrink-0 text-caution" />
      <span>
        <span className="font-medium">{title} </span>
        {children}
      </span>
    </p>
  )
}

/**
 * A word that was not added: why, in the service's words, and whether trying again can help (a
 * save that got no answer or failed may go through; a word refused stays refused).
 */
type NotAdded = { word: string; reason: string; retry: boolean }

/** What a save that did not go through says, beside Try again. */
const notSaved = 'The save did not go through, so nothing changed.'

/**
 * A definition's other names, under Also called, as tags in one box: type a word and a comma (or
 * Enter, or paste "GMV, turnover, sales value") and each becomes a tag at once, saved as a synonym.
 * Backspace in the empty box selects the last tag, then removes it; x removes one. A word that was
 * not added stays, marked, with one plain line under the box that says why: it already means
 * something else (who has it), the service turned it down (its reason), or the save did not go
 * through (with Try again). Never a toast: the line stays beside the word until it is dismissed or
 * tried again. The source's own names are locked tags. Escape keeps every tag made so far. The
 * same box on the definition's page, in its quick view and in the term editor, so all three write
 * the one list. On the page it is one line (`inline`): the label, the tags and a dashed Add a name
 * that opens the field in place, then one line on what the names do, and a line for each name
 * that means two things.
 */
export function SynonymTags({
  d,
  label = 'Also called',
  canEdit,
  level = 3,
  inline = false,
}: {
  d: Definition
  label?: string
  canEdit: boolean
  level?: 2 | 3
  inline?: boolean
}) {
  const H = level === 2 ? 'h2' : 'h3'
  const glossary = useGlossary()
  const write = useWrite()
  const undo = useUndo()
  const point = d.sameAs ? glossary.meaningOf(d) : d
  const synonyms = glossary.synonymsOf(point.name)
  const [text, setText] = React.useState('')
  const [notAdded, setNotAdded] = React.useState<NotAdded[]>([])
  const [selected, setSelected] = React.useState<string | null>(null)
  const [said, setSaid] = React.useState('')
  const [flash, setFlash] = React.useState<string | null>(null)
  const input = React.useRef<HTMLInputElement>(null)
  const addButton = React.useRef<HTMLButtonElement>(null)
  // On the page the field opens from Add a name, and closes again when it is left empty.
  const [opened, setOpened] = React.useState(false)
  const field = canEdit && (!inline || opened)
  const backToAdd = React.useRef(false)
  React.useEffect(() => {
    if (!inline) return
    if (opened) input.current?.focus()
    else if (backToAdd.current) addButton.current?.focus()
    backToAdd.current = false
  }, [inline, opened])
  const id = React.useId()
  const me = useMe()
  const same = (a: string, b: string) => termWord(a) === termWord(b)
  // The line already names the word, so a reason that starts with it says "It" instead.
  const itFor = (word: string, reason: string) => {
    const lead = /^“([^”]+)” (.+)$/su.exec(reason)
    return lead && same(lead[1]!, word) ? `It ${lead[2]}` : reason
  }
  const without = (list: string[], words: string[]) =>
    list.filter((n) => !words.some((w) => same(n, w)))

  // A word is a tag the moment it is typed, and a removed one goes at once, while the save runs
  // behind it (the service reads the glossary, writes, then every definition is read again: seconds
  // on a slow line). A failed save takes its change back and says so. Plain state rather than
  // useOptimistic: an open transition that long would hold every other transition in the app.
  const [adding, setAdding] = React.useState<string[]>([])
  const [removing, setRemoving] = React.useState<string[]>([])
  const kept = synonyms.filter((s) => !removing.some((n) => same(n, s.name)))
  const tags: { name: string; by?: string; conflict?: Conflict }[] = [
    ...kept.map((s) => ({ name: s.name, by: s.by, conflict: glossary.conflictOf(s) })),
    ...without(adding, [...kept.map((s) => s.name), ...removing]).map((w) => ({
      name: w,
      by: me.name,
    })),
  ]
  // The saves run one at a time, in the order they were made: a tag removed while it is still being
  // added goes once it is in.
  const saves = React.useRef<Promise<void>>(Promise.resolve())
  const unsaved = React.useRef<string[]>([])
  const inTurn = (run: () => Promise<void>) => {
    saves.current = saves.current.then(run, run)
  }

  const commit = (words: string[]) => {
    const known = [...point.sourceNames, ...tags.map((t) => t.name)]
    // A word already here, or typed twice before its save is in, is never sent again.
    const fresh = words.filter((w) => !known.some((n) => same(n, w)))
    const here = words.find((w) => !fresh.includes(w))
    if (here) setFlash(known.find((n) => same(n, here)) ?? null)
    if (!fresh.length) {
      if (words.length) setSaid('Already there.')
      return
    }
    unsaved.current = without(unsaved.current, fresh)
    setAdding((list) => [...list, ...fresh])
    setRemoving((list) => without(list, fresh))
    setNotAdded((prev) => prev.filter((p) => !fresh.some((w) => same(w, p.word))))
    inTurn(async () => {
      const added: string[] = []
      const out: NotAdded[] = []
      for (const w of fresh) {
        try {
          const r = await write('addSynonym', { target: point.name, word: w })
          if (r.ok) added.push(w)
          else if (r.why === 'here') setFlash(w)
          else if (r.why !== 'empty')
            out.push({ word: w, reason: itFor(w, r.reason), retry: false })
        } catch (e) {
          // A save that got no answer, or that the service failed, may go through when tried
          // again. A word the service turned down says why, in its words, and trying again
          // changes nothing.
          const error = toApiError(e)
          const retry = error.retryable || error.kind === 'failed'
          out.push({ word: w, reason: retry ? notSaved : itFor(w, error.message), retry })
        }
      }
      unsaved.current = [...unsaved.current, ...out.map((o) => o.word)]
      setAdding((list) => without(list, fresh))
      setNotAdded((prev) => [
        ...prev.filter(
          (p) => !out.some((o) => same(o.word, p.word)) && !added.some((a) => same(a, p.word)),
        ),
        ...out,
      ])
      setSaid(
        [
          added.length && `Added synonym ${added.join(', ')}.`,
          ...out.map((o) => `“${o.word}” was not added. ${o.reason}`),
          !added.length && !out.length && 'Already there.',
        ]
          .filter(Boolean)
          .join(' '),
      )
    })
  }
  const remove = (name: string) => {
    setSelected(null)
    setRemoving((list) => [...list, name])
    // The focus stays in the names: the field, or Add a name when the field is closed.
    const stay = input.current ?? addButton.current
    stay?.focus()
    inTurn(async () => {
      if (unsaved.current.some((w) => same(w, name))) {
        setRemoving((list) => without(list, [name]))
        return
      }
      try {
        const removed = await write('removeTerm', { name })
        setSaid(`Removed synonym ${name}.`)
        undo.offer(`Removed “${name}”`, removed.undo, {
          description: `${point.name} itself is unchanged.`,
        })
      } catch {
        toast.error(`Couldn't remove “${name}”`, {
          description: `It is still another name for ${point.name}.`,
          action: { label: 'Try again', onClick: () => remove(name) },
        })
      }
      setRemoving((list) => without(list, [name]))
    })
  }
  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === ',' || (e.key === 'Enter' && text.trim())) {
      e.preventDefault()
      commit(parseTags(text))
      setText('')
      return
    }
    if (e.key === 'Backspace' && !text) {
      const last = tags[tags.length - 1]
      if (!last) return
      e.preventDefault()
      if (selected === last.name) remove(last.name)
      else {
        setSelected(last.name)
        setSaid(`${last.name} selected. Backspace again removes it.`)
      }
      return
    }
    if (e.key === 'Escape' && (text || selected)) {
      // Escape lets go of what is half typed; every tag made so far stays.
      e.stopPropagation()
      setText('')
      setSelected(null)
      return
    }
    if (e.key === 'Escape' && inline) {
      // Pressed again, it closes the field on the page, back on Add a name.
      e.stopPropagation()
      backToAdd.current = true
      setOpened(false)
      return
    }
    setSelected(null)
  }

  const chips = (
    <>
      {point.sourceNames.map((n) => (
        <TagChip
          key={n}
          icon={<LockIcon aria-hidden />}
          title={`${point.tool ?? 'Its tool'}'s own name, read-only`}
          className={cn(flash && same(flash, n) && 'ring-2 ring-ring')}
        >
          {n}
          <span className="sr-only"> (from {point.tool ?? 'its tool'}, read-only)</span>
        </TagChip>
      ))}
      {tags.map(({ name, by, conflict }) => (
        <TagChip
          key={name}
          tone={conflict ? 'warn' : 'term'}
          icon={conflict ? <TriangleAlertIcon aria-hidden /> : <EqualIcon aria-hidden />}
          title={conflict ? conflict.message : `${name}, added by ${by}`}
          onRemove={canEdit ? () => remove(name) : undefined}
          removeLabel={`Remove the other name ${name}`}
          className={cn(
            'max-w-48',
            (selected === name || (flash && same(flash, name))) && 'ring-2 ring-ring',
          )}
        >
          {name}
          {conflict && <span className="sr-only"> (conflict: {conflict.short})</span>}
        </TagChip>
      ))}
      {/* A word that was not added stays, marked: struck through when it was refused, dashed in
          red when its save did not go through. */}
      {notAdded.map((r) => (
        <TagChip
          key={r.word}
          tone={r.retry ? 'neutral' : 'warn'}
          icon={<TriangleAlertIcon aria-hidden />}
          title={`Not added. ${r.reason}`}
          onRemove={() => setNotAdded((x) => x.filter((y) => y !== r))}
          removeLabel={`Dismiss ${r.word}`}
          className={cn(
            'max-w-48',
            r.retry
              ? 'border border-dashed border-destructive bg-transparent text-destructive'
              : 'line-through decoration-1',
          )}
        >
          {r.word}
          <span className="sr-only"> (not added)</span>
        </TagChip>
      ))}
    </>
  )

  const fieldInput = (
    <input
      ref={input}
      id={`${id}-input`}
      value={text}
      aria-label={`Add a name for ${point.name}`}
      aria-describedby={`${id}-help`}
      placeholder="Add a name"
      onChange={(e) => {
        const v = e.target.value
        // A comma typed or pasted mid-word: every finished word becomes a tag, the rest stays.
        if (v.includes(',')) {
          const parts = v.split(',')
          commit(parseTags(parts.slice(0, -1).join(',')))
          setText(parts[parts.length - 1]!.trimStart())
        } else setText(v)
      }}
      onPaste={(e) => {
        const pasted = e.clipboardData.getData('text')
        if (!/[,\n]/.test(pasted)) return
        e.preventDefault()
        commit(parseTags(`${text}${pasted}`))
        setText('')
      }}
      onKeyDown={onKeyDown}
      onBlur={(e) => {
        // Left empty for something outside the names, the field closes back to Add a name.
        if (inline && !text && !e.currentTarget.closest('section')?.contains(e.relatedTarget))
          setOpened(false)
      }}
      className={cn(
        'h-6 bg-transparent px-1 text-sm outline-none placeholder:text-muted-foreground pointer-coarse:h-8',
        inline ? 'w-40 min-w-0' : 'min-w-28 flex-1',
      )}
    />
  )
  const named = tags.length > 0 || point.sourceNames.length > 0
  const notes = (
    <>
      {notAdded.length > 0 && (
        <ul className="flex flex-col gap-1">
          {notAdded.map((r) => (
            <li key={r.word} className="flex flex-wrap items-start gap-x-2 gap-y-1 text-sm">
              <TriangleAlertIcon
                aria-hidden
                className={cn(
                  'mt-0.5 size-4 shrink-0',
                  r.retry ? 'text-destructive' : 'text-caution',
                )}
              />
              <span className="min-w-0 flex-1">
                <span className="font-medium">“{r.word}” was not added.</span> {r.reason}
              </span>
              {r.retry && (
                <Button
                  variant="outline"
                  onClick={() => commit([r.word])}
                  aria-label={`Try again to add ${r.word}`}
                >
                  Try again
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}
      <p role="status" aria-live="polite" className="sr-only">
        {said}
      </p>
    </>
  )

  if (inline)
    return (
      <section aria-labelledby={`${id}-label`} className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
          <H id={`${id}-label`} className="text-sm font-medium">
            {label}
          </H>
          <div className="flex min-w-0 flex-wrap items-center gap-1.5">
            {chips}
            {field ? (
              <span className="inline-flex items-center gap-1 rounded-sm border bg-background pr-0.5 focus-within:border-ring focus-within:ring-3 focus-within:ring-ring/50">
                {fieldInput}
                <Kbd aria-hidden>Enter</Kbd>
              </span>
            ) : (
              canEdit && (
                <button
                  ref={addButton}
                  type="button"
                  onClick={() => setOpened(true)}
                  className="relative inline-flex h-6 items-center gap-1 rounded-sm border border-dashed border-input px-1.5 text-xs font-medium text-muted-foreground outline-none hover:bg-muted hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50 pointer-coarse:after:absolute pointer-coarse:after:inset-(--touch-inset) [&>svg]:size-3"
                >
                  <PlusIcon aria-hidden />
                  Add a name
                </button>
              )
            )}
          </div>
        </div>
        <p id={`${id}-help`} className="text-xs text-muted-foreground">
          {field && 'A comma or Enter adds a name. '}
          {named
            ? `Agents read each of these as ${point.name}.`
            : `No other names yet. Agents find it only as “${point.name}”.`}
          {point.sourceNames.length ? ` Locked names come from ${point.tool ?? 'its tool'}.` : ''}
        </p>
        {/* A name that also means something else says so in a line of its own. */}
        {kept.map((s) => (
          <ConflictNote key={s.name} d={s} />
        ))}
        {notes}
      </section>
    )

  return (
    <section aria-labelledby={`${id}-label`} className="flex flex-col gap-1.5">
      <H id={`${id}-label`} className="text-sm font-medium">
        {label}
      </H>
      {canEdit ? (
        // The box takes clicks anywhere into its field, as a tag box does.
        <div
          onClick={() => input.current?.focus()}
          className={cn(
            'flex min-h-9 cursor-text flex-wrap items-center gap-1.5 rounded-md border bg-background px-1.5 py-1.5 focus-within:border-ring focus-within:ring-3 focus-within:ring-ring/50',
            'pointer-coarse:min-h-11',
          )}
        >
          {chips}
          {fieldInput}
        </div>
      ) : named ? (
        <div className="flex flex-wrap items-center gap-1.5">{chips}</div>
      ) : (
        <p className="text-sm text-muted-foreground">
          No other names yet. Agents find it only as “{point.name}”.
        </p>
      )}
      {notes}
      {canEdit && (
        <p id={`${id}-help`} className="text-xs text-muted-foreground">
          A comma or Enter adds a name. Agents read each of these as {point.name}.
          {point.sourceNames.length ? ` Locked names come from ${point.tool ?? 'its tool'}.` : ''}
        </p>
      )}
    </section>
  )
}

/**
 * What the tree of what a metric is built from (built-from-tree.tsx) takes from the first load,
 * handed to it rather than imported, so its own code loads apart without splitting the first load
 * into more files (as family-parts.ts does for a family's quick view). Here, since this module
 * already imports all of it: a module of its own split the first load into twice the files.
 */
export const builtFromParts = {
  /** What a metric is built from, once read; null while it is read, or when it is built from no metric. */
  useBuiltFrom: (name: string) => {
    const metrics = useQuery(builtFromQuery(name)).data
    return metrics?.[0]?.from.length ? metrics : null
  },
  /** For each line: the definition it names, and how many published items about it the person may read. */
  useLines: () => {
    const glossary = useGlossary()
    const facts = useFacts()
    const index = React.useMemo(() => listIndex(glossary.all, facts), [glossary, facts])
    return (m: BuiltFromMetric) => {
      const d = m.linked ? glossary.find(m.name) : undefined
      return { d, count: d ? index.contextAbout(d).length : 0 }
    }
  },
  /** The definition the side panel shows, by name. */
  usePeeked: () => {
    const dock = useDock()
    return dock?.kind === 'def' ? dock.id : undefined
  },
  openMetric: (name: string) => openDock('def', name),
  useShowMore,
  cn,
  TypeTile,
  ShowMoreButton,
  PeekBand,
  PeekLabel,
  ChevronDownIcon,
  ChevronRightIcon,
}

export type BuiltFromParts = typeof builtFromParts
