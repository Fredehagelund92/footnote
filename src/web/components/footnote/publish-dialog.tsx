import * as React from 'react'
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
import { SkippedList } from '@/components/footnote/delete-dialog'
import { count, type Skip } from '@/lib/bulk'

// The one question before many drafts are published from a list's bar: it names them, says that
// agents get them, and says which go to other domains' owners as suggestions instead. Publishing is
// no deletion, so nothing here is red; Cancel still has the focus, so a slip of Enter sends nothing.

type Props = {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** The drafts published at once. */
  publish: string[]
  /** The drafts sent to their domain's owners, and those domains by name. */
  send: { titles: string[]; domains: string }
  /** What the selection held that this won't publish, and why. */
  skipped: Skip[]
  onPublish: () => void
}

/** "Publish 21 drafts", "Suggest 3 drafts": the question and its button say the same. */
function publishVerb(publish: number, send: number) {
  return publish ? `Publish ${count(publish + send, 'draft')}` : `Suggest ${count(send, 'draft')}`
}

/** What the drafts for other domains' owners do: "3 drafts go to the owners of Marketing ...". */
function sendLine(n: number, domains: string) {
  const one = n === 1
  return `${count(n, 'draft')} ${one ? 'goes' : 'go'} to the owners of ${domains} as ${one ? 'a suggestion' : 'suggestions'}: agents get ${one ? 'it' : 'them'} once an owner publishes ${one ? 'it' : 'them'}.`
}

export function PublishDialog({ open, onOpenChange, publish, send, skipped, onPublish }: Props) {
  const cancel = React.useRef<HTMLButtonElement>(null)
  const verb = publishVerb(publish.length, send.titles.length)
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent initialFocus={cancel} className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{verb}?</DialogTitle>
          <DialogDescription>
            {publish.length
              ? 'Agents get them from the next question. You can undo it for a few seconds.'
              : 'Agents get them once an owner publishes them.'}
          </DialogDescription>
        </DialogHeader>
        <ul aria-label="To publish" className="max-h-48 overflow-y-auto rounded-md border text-sm">
          {[...publish, ...send.titles].map((t, i) => (
            <li key={`${i}-${t}`} className="border-b px-3 py-2 last:border-b-0">
              {t}
            </li>
          ))}
        </ul>
        {publish.length > 0 && send.titles.length > 0 && (
          <p className="text-sm text-muted-foreground">
            {sendLine(send.titles.length, send.domains)}
          </p>
        )}
        {skipped.length > 0 && <SkippedList skipped={skipped} />}
        <DialogFooter>
          <DialogClose render={<Button variant="outline" ref={cancel} />}>Cancel</DialogClose>
          <Button
            onClick={() => {
              onOpenChange(false)
              onPublish()
            }}
          >
            {verb}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
