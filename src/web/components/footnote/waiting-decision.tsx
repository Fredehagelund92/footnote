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
import { Textarea } from '@/components/ui/textarea'
import { DontPublishDialog } from '@/components/footnote/dont-publish-dialog'
import { text } from '@/components/templates/comment-box/utils'
import { useWrite } from '@/api/queries'
import { toApiError } from '@/api/errors'
import { navigate } from '@/lib/router'
import { toast } from '@/lib/toast'
import { useUndo } from '@/lib/undo'
import type { Fact } from '@/model/items'

// What an owner of its domain, or an admin, decides on a new item waiting for review from its own
// page: Publish it as it is, Edit then publish (the editor), Send back with a note, or Don't
// publish with a reason its sender reads. Its sender only withdraws it. The same decisions as the
// review, so the service's rules hold either way; the page's buttons and its phone menu share them.

type Asked = 'return' | 'close' | null

export function useWaitingDecision(fact: Fact) {
  const write = useWrite()
  const undo = useUndo()
  const [asked, setAsked] = React.useState<Asked>(null)
  const [words, setWords] = React.useState('')
  const [busy, setBusy] = React.useState<'publish' | 'return' | 'close' | 'withdraw' | null>(null)
  const sender = fact.by || null
  const first = sender?.split(' ')[0] ?? 'Its sender'

  /** Runs a decision once; it leaves the page, which no longer waits, and offers Undo. */
  const run = (
    what: NonNullable<typeof busy>,
    send: () => Promise<{ undo: { token: string; until: string | null } } | void>,
    said: { message: string; description: string },
    failed: string,
  ) => {
    if (busy) return
    setBusy(what)
    send().then(
      (done) => {
        setBusy(null)
        setAsked(null)
        setWords('')
        navigate('/context')
        if (done) undo.offer(said.message, done.undo, { description: said.description })
        else toast(said.message, { description: said.description })
      },
      (error: unknown) => {
        setBusy(null)
        toast.error(failed, { description: `${toApiError(error).message} Nothing changed.` })
      },
    )
  }

  const publish = () =>
    run(
      'publish',
      () => write('publishReview', { id: fact.id }),
      { message: 'Published', description: 'Agents get it from the next question.' },
      "Couldn't publish.",
    )
  const sendBack = () =>
    run(
      'return',
      () => write('returnReview', { id: fact.id, note: text(words.trim()) }),
      {
        message: sender ? `Returned to ${sender}` : 'Returned',
        description: `${first} sees your note in the comments. Agents don't get it.`,
      },
      "Couldn't return it.",
    )
  const close = () =>
    run(
      'close',
      () => write('closeReview', { id: fact.id, reason: words.trim() }),
      {
        message: 'Closed',
        description: sender
          ? `It won't be published. ${first} reads why in their Inbox.`
          : "It won't be published, so agents never get it.",
      },
      "Couldn't close it.",
    )
  const withdraw = () =>
    run(
      'withdraw',
      () => write('withdrawSuggestion', { id: fact.id }),
      { message: 'Withdrawn', description: 'The owners no longer see it.' },
      "Couldn't withdraw it.",
    )

  const ask = (what: Asked) => {
    setWords('')
    setAsked(what)
  }
  const dialogs = (
    <>
      <DontPublishDialog
        title={fact.title}
        sender={sender}
        open={asked === 'close'}
        onCancel={() => setAsked(null)}
        reason={words}
        onReason={setWords}
        onConfirm={close}
        busy={busy === 'close'}
      />
      <Dialog open={asked === 'return'} onOpenChange={(o) => !o && setAsked(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Send it back with a note?</DialogTitle>
            <DialogDescription>
              {sender
                ? `${first} reads your note in the comments, edits it and sends it again.`
                : 'Your note goes in the comments.'}{' '}
              Agents don't get it until it is published.
            </DialogDescription>
          </DialogHeader>
          <Textarea
            aria-label="What would make it ready"
            placeholder="What would make it ready?"
            rows={3}
            value={words}
            onChange={(e) => setWords(e.target.value)}
          />
          <DialogFooter>
            <DialogClose render={<Button variant="outline" />}>Cancel</DialogClose>
            <Button
              disabled={!words.trim()}
              loading={busy === 'return'}
              loadingLabel="Sending…"
              onClick={sendBack}
            >
              Send back
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
  return { publish, withdraw, ask, busy, dialogs }
}
