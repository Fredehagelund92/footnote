import * as React from 'react'
import { andList, eachOf, splitLabel } from '@domain/family-split'
import { useWrite } from '@/api/queries'
import { CopyIcon, ExternalLinkIcon, LockIcon } from '@/components/icons'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import type { Definition } from '@/lib/definitions'
import { useReported } from '@/lib/reported'
import { navigate } from '@/lib/router'
import { toast } from '@/lib/toast'
import { useDomains, useFacts, useMe } from '@/lib/workspace'
import { servedToAgents } from '@/model/items'

// Split on a family's own page (FR-142, D2-D4). An owner of its domain or an admin splits a family
// Footnote found back into its metrics, after one dialog that says what happens to each thing
// that depends on it, and Undo makes it one family again. A family its tool declares is changed
// there: the page says where, with the file when its source links one. Anyone else is told who
// decides. On the family's own page only, so none of it is in the first load.

const n = (x: number) => x.toLocaleString('en-GB')

/** Whether the person may split the family: an owner of its domain or an admin, never declared. */
export function useMaySplit(d: Definition): boolean {
  const me = useMe()
  return (
    !!d.family && !d.family.declared && (me.admin || (!!d.domain && me.owns.includes(d.domain)))
  )
}

/** Who decides whether it is one family, for anyone who can't: its domain's owners, by name. */
export function useWhoDecides(d: Definition): string | null {
  const me = useMe()
  const domains = useDomains()
  if (!d.family || d.family.declared || me.admin || (d.domain && me.owns.includes(d.domain)))
    return null
  const domain = d.domain ? domains[d.domain] : undefined
  if (!domain) return 'An admin decides whether it is one family.'
  return domain.owners.length
    ? `Owners of ${domain.name} decide whether it is one family: ${andList(domain.owners)}.`
    : `Owners of ${domain.name} decide whether it is one family.`
}

/** The context items about the family itself, live: those Split leaves due for a check. */
function useItemsAbout(name: string): number {
  const facts = useFacts()
  return facts.filter((f) => servedToAgents(f) && f.where.includes(name)).length
}

/** Split into N metrics, and the dialog that confirms it in plain words. */
export function SplitFamily({ d }: { d: Definition }) {
  const family = d.family!
  const [open, setOpen] = React.useState(false)
  const count = family.variants.length
  return (
    <>
      <Button variant="outline" onClick={() => setOpen(true)} className="-my-1 shrink-0">
        {splitLabel(count)}
      </Button>
      {open && <SplitDialog d={d} onClose={() => setOpen(false)} />}
    </>
  )
}

function SplitDialog({ d, onClose }: { d: Definition; onClose: () => void }) {
  const family = d.family!
  const variants = family.variants.map((v) => v.name)
  const count = variants.length
  const items = useItemsAbout(d.name)
  const tool = d.tool ?? 'its tool'
  const cancel = React.useRef<HTMLButtonElement>(null)
  const write = useWrite()
  const splitting = useReported<{ metrics: string[]; items: number }>({
    wasnt: `${d.name} wasn't split.`,
    done: (split) => {
      toast(`${d.name} is split into ${n(split.metrics.length)} metrics`, {
        description: split.items
          ? `Each is in Definitions now. ${n(split.items)} context ${split.items === 1 ? 'item waits' : 'items wait'} for a check by ${split.items === 1 ? 'its owner' : 'their owners'}.`
          : 'Each is in Definitions now.',
        action: {
          label: 'Undo',
          onClick: () =>
            void write('joinFamily', { name: d.name }).then(
              () => {
                toast(`${d.name} is one family again`)
                navigate(`/definitions/${encodeURIComponent(d.name)}`)
              },
              () =>
                toast.error(`${d.name} wasn't made one family again`, {
                  description: 'Make them one family again from Definitions, under Families.',
                }),
            ),
        },
      })
    },
  })
  const sending = splitting.state === 'sending'
  const word = d.name.toLowerCase()
  return (
    <Dialog open onOpenChange={(next) => !next && !sending && onClose()}>
      <DialogContent initialFocus={cancel} className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>
            Split {d.name} into {n(count)} metrics?
          </DialogTitle>
          <DialogDescription className="sr-only">
            What splitting it does, before it happens.
          </DialogDescription>
        </DialogHeader>
        <ul className="flex list-disc flex-col gap-2 pl-5 text-sm leading-6">
          <li>
            {count <= 3 ? (
              <>
                {variants.map((v, i) => (
                  <React.Fragment key={v}>
                    {i > 0 && (i === count - 1 ? ' and ' : ', ')}
                    <b className="font-semibold">{v}</b>
                  </React.Fragment>
                ))}{' '}
                each become a metric in Definitions.
              </>
            ) : (
              <>
                Its <b className="font-semibold">{n(count)} variants</b> each become a metric in
                Definitions, under the names they have.
              </>
            )}{' '}
            The family goes; its history stays.
          </li>
          <li>Its meaning and its usual variant go with it, kept in its history.</li>
          <li>
            {items ? (
              <>
                <b className="font-semibold">
                  {n(items)} context {items === 1 ? 'item is' : 'items are'}
                </b>{' '}
                about {d.name}. No words change: {items === 1 ? 'it' : 'each'} now applies to{' '}
                {eachOf(count)} metrics, and {items === 1 ? 'its' : 'each'} owner gets a card to
                check that it fits each one.
              </>
            ) : (
              <>No context item is about {d.name} itself, so none needs a check.</>
            )}
          </li>
          <li>
            A question that says only “{word}” then names no metric, so agents ask which one is
            meant.
          </li>
          <li>
            The next read of {tool} keeps them apart. You can make them one family again from
            Definitions.
          </li>
        </ul>
        {splitting.problem && (
          <p role="alert" className="text-sm text-destructive">
            {splitting.problem}
          </p>
        )}
        <DialogFooter>
          <DialogClose render={<Button variant="outline" ref={cancel} disabled={sending} />}>
            Cancel
          </DialogClose>
          <Button
            onClick={() =>
              splitting.act(() =>
                write('splitFamily', { name: d.name }, () => {
                  onClose()
                  navigate('/definitions', { show: 'families' })
                }),
              )
            }
            aria-disabled={sending || undefined}
          >
            {splitLabel(count)}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/** The file a model link opens, as a repository names it: `models/orders.yml`. */
function fileOf(url: string): string {
  const at = url.indexOf('/blob/')
  const path =
    at < 0
      ? (url.split(/[?#]/)[0]!.split('/').pop() ?? '')
      : url
          .slice(at + '/blob/'.length)
          .split(/[?#]/)[0]!
          .split('/')
          .slice(1)
          .join('/')
  return decodeURIComponent(path)
}

/**
 * A family its tool declares, which is changed there and never split here (D4): where it is
 * declared, the file when its source links one, and its key to copy.
 */
export function FamilyDeclared({ d }: { d: Definition }) {
  const declared = d.family!.declared!
  const tool = d.tool ?? 'its tool'
  const count = d.family!.variants.length
  const file = d.fileUrl ? fileOf(d.fileUrl) : ''
  return (
    <section
      aria-label={`Changed in ${tool}`}
      className="flex max-w-reading flex-col gap-2 rounded-frame border bg-muted/40 px-4 py-3 text-sm"
    >
      <p className="flex items-center gap-2 font-medium">
        <LockIcon aria-hidden className="size-4 shrink-0" />
        Changed in {tool}, not here
      </p>
      <p className="leading-6">
        Each of its {n(count)} metrics names this family in {tool}, under{' '}
        <code className="rounded-sm bg-muted px-1 font-mono text-xs">
          meta.footnote.family: {declared}
        </code>
        . To split it, rename it or add a variant, change that in {tool}. The next read follows.
      </p>
      <p className="flex flex-wrap gap-x-4 gap-y-1">
        {d.fileUrl && (
          <a
            href={d.fileUrl}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 font-medium text-primary underline-offset-4 hover:underline"
          >
            <ExternalLinkIcon aria-hidden className="size-3.5" />
            Open {file || 'its file'} in your repository
            <span className="sr-only"> (opens in a new tab)</span>
          </a>
        )}
        <button
          type="button"
          onClick={() =>
            void navigator.clipboard.writeText(declared).then(
              () => toast('Copied the key', { description: declared }),
              () => toast.error("Couldn't copy the key", { description: declared }),
            )
          }
          className="inline-flex items-center gap-1 font-medium text-primary underline-offset-4 outline-none hover:underline focus-visible:ring-3 focus-visible:ring-ring/50"
        >
          <CopyIcon aria-hidden className="size-3.5" />
          Copy the key
        </button>
      </p>
    </section>
  )
}
