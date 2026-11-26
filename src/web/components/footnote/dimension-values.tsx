import * as React from 'react'
import { pastedValues } from '@domain/values'
import { toApiError } from '@/api/errors'
import { useWrite } from '@/api/queries'
import { PlusIcon } from '@/components/icons'
import { Button } from '@/components/ui/button'
import { Field, FieldDescription, FieldError, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import type { Definition, DefinitionValue } from '@/lib/definitions'
import { toast } from '@/lib/toast'
import { useDomains, useMe } from '@/lib/workspace'

// A dimension's values on its page (values without figures, V1): the ones people and owners
// published, and two ways to add more, one at a time or as a pasted list. An owner of the
// dimension's domain or an admin publishes them at once; anyone else's wait for one on the Names
// card. Footnote reads no value from the data: these are the values context is written about.

/** How many values show before Show all: a dimension can have thousands. */
const FIRST_VALUES = 12

const n = (x: number) => x.toLocaleString('en-GB')
const count = (x: number) => `${n(x)} ${x === 1 ? 'value' : 'values'}`
/** Words after commas, each once: "Norge, NO" is two. */
const words = (text: string) => [
  ...new Set(
    text
      .split(',')
      .map((word) => word.trim())
      .filter(Boolean),
  ),
]

function ValueLine({ value }: { value: DefinitionValue }) {
  const said = [
    value.aliases.length > 0 && `also ${value.aliases.join(', ')}`,
    value.writtenAs.length > 0 && `the data writes ${value.writtenAs.join(', ')}`,
  ].filter(Boolean)
  return (
    <li className="flex min-w-0 flex-wrap items-baseline gap-x-2 py-1.5">
      <span className="font-medium">{value.name}</span>
      {said.length > 0 && <span className="text-xs text-muted-foreground">{said.join(' · ')}</span>}
    </li>
  )
}

export default function DimensionValues({ d }: { d: Definition }) {
  const me = useMe()
  const domains = useDomains()
  const write = useWrite()
  const id = React.useId()
  const values = d.values ?? []
  const [all, setAll] = React.useState(false)
  const [adding, setAdding] = React.useState<'one' | 'list' | null>(null)
  const [name, setName] = React.useState('')
  const [aliases, setAliases] = React.useState('')
  const [writtenAs, setWrittenAs] = React.useState('')
  const [list, setList] = React.useState('')
  const [problem, setProblem] = React.useState<string | null>(null)
  const [busy, setBusy] = React.useState(false)
  // Who publishes what is added here: the person, or the owners of the dimension's domain.
  const publishes = me.admin || (!!d.domain && me.owns.includes(d.domain))
  const owner = d.domain
    ? `an owner of ${domains[d.domain]?.name ?? 'its domain'}`
    : 'an admin, since it has no domain'
  // Only the names are sent: the keys the list is read with tell its repeats apart.
  const pasted = pastedValues('dim:pasted', list)
  const shown = all ? values : values.slice(0, FIRST_VALUES)

  const close = () => {
    setAdding(null)
    setName('')
    setAliases('')
    setWrittenAs('')
    setList('')
    setProblem(null)
  }
  const send = async (written: { name: string; aliases: string[]; writtenAs: string[] }[]) => {
    setBusy(true)
    setProblem(null)
    try {
      const done = await write('addValues', { dimension: d.name, values: written })
      const what =
        done.values.length === 1 ? (done.values[0]?.name ?? 'The value') : count(done.values.length)
      toast(
        done.outcome === 'published'
          ? `${what} ${done.values.length === 1 ? 'is' : 'are'} published`
          : `${what} ${done.values.length === 1 ? 'waits' : 'wait'} for ${owner}`,
      )
      close()
    } catch (error) {
      setProblem(toApiError(error).message)
    } finally {
      setBusy(false)
    }
  }
  const submitOne = (e: React.FormEvent) => {
    e.preventDefault()
    if (!name.trim()) return setProblem('Write the value’s name.')
    void send([{ name: name.trim(), aliases: words(aliases), writtenAs: words(writtenAs) }])
  }
  const submitList = (e: React.FormEvent) => {
    e.preventDefault()
    if (pasted.unreadable.length)
      return setProblem(`“${pasted.unreadable[0]}” has no letter or digit to name a value with.`)
    if (!pasted.values.length) return setProblem('Paste at least one value, one per line.')
    void send(pasted.values.map(({ name, aliases }) => ({ name, aliases, writtenAs: [] })))
  }
  const verb = publishes ? 'Publish' : 'Suggest'

  return (
    <section aria-labelledby={`${id}-label`} className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
        <h3 id={`${id}-label`} className="text-sm font-medium">
          Values{' '}
          {values.length > 0 && (
            <span className="text-xs font-normal text-muted-foreground tabular-nums">
              {n(values.length)}
            </span>
          )}
        </h3>
        {!adding && (
          <span className="flex items-center gap-1">
            <Button variant="ghost" onClick={() => setAdding('one')}>
              <PlusIcon data-icon="inline-start" />
              Add a value
            </Button>
            <Button variant="ghost" onClick={() => setAdding('list')}>
              Paste a list
            </Button>
          </span>
        )}
      </div>
      {values.length ? (
        <>
          <ul className="flex flex-col text-sm">
            {shown.map((value) => (
              <ValueLine key={value.name} value={value} />
            ))}
          </ul>
          {shown.length < values.length && (
            <Button variant="ghost" className="w-fit" onClick={() => setAll(true)}>
              Show all {n(values.length)}
            </Button>
          )}
        </>
      ) : (
        <p className="text-sm text-muted-foreground">
          No values yet. Add the ones context is written about, so an item can say it applies to one
          of them. Your data tool has the full list.
        </p>
      )}
      {adding === 'one' && (
        <form onSubmit={submitOne} className="flex flex-col gap-3 rounded-md border p-3">
          <Field>
            <FieldLabel htmlFor={`${id}-name`}>Name</FieldLabel>
            <Input
              id={`${id}-name`}
              autoFocus
              autoComplete="off"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </Field>
          <Field>
            <FieldLabel htmlFor={`${id}-aliases`}>Other names</FieldLabel>
            <Input
              id={`${id}-aliases`}
              autoComplete="off"
              value={aliases}
              onChange={(e) => setAliases(e.target.value)}
            />
            <FieldDescription>Words people say for it, after commas.</FieldDescription>
          </Field>
          <Field>
            <FieldLabel htmlFor={`${id}-written`}>How the data writes it</FieldLabel>
            <Input
              id={`${id}-written`}
              autoComplete="off"
              value={writtenAs}
              onChange={(e) => setWrittenAs(e.target.value)}
            />
            <FieldDescription>
              The value as it is in the data, such as a code, so an agent that passes it is
              understood.
            </FieldDescription>
          </Field>
          {problem && <FieldError>{problem}</FieldError>}
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm text-muted-foreground">
              {publishes ? 'It is published at once.' : `It waits for ${owner}.`}
            </p>
            <span className="ml-auto flex gap-2">
              <Button type="button" variant="ghost" onClick={close}>
                Cancel
              </Button>
              <Button type="submit" disabled={busy}>
                {verb}
              </Button>
            </span>
          </div>
        </form>
      )}
      {adding === 'list' && (
        <form onSubmit={submitList} className="flex flex-col gap-3 rounded-md border p-3">
          <Field>
            <FieldLabel htmlFor={`${id}-list`}>Values, one per line</FieldLabel>
            <Textarea
              id={`${id}-list`}
              autoFocus
              rows={6}
              value={list}
              onChange={(e) => setList(e.target.value)}
            />
            <FieldDescription>Other names after commas, as in “North, Northern”.</FieldDescription>
          </Field>
          {problem && <FieldError>{problem}</FieldError>}
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm text-muted-foreground">
              {publishes ? 'They are published at once.' : `They wait for ${owner}.`}
            </p>
            <span className="ml-auto flex gap-2">
              <Button type="button" variant="ghost" onClick={close}>
                Cancel
              </Button>
              <Button type="submit" disabled={busy || !pasted.values.length}>
                {verb} {pasted.values.length ? count(pasted.values.length) : 'values'}
              </Button>
            </span>
          </div>
        </form>
      )}
    </section>
  )
}
