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

// Don't publish: an owner closes a new item or a change that waits for their review, with the
// reason its sender reads in their Inbox. One dialog for the review page and the item's page, so
// both ask the same. Nothing is deleted and Undo is there for a moment after, so nothing is red.

type Props = {
  title: string
  /** Who sent it and is told why; null when a sync or a draft for a Not found card made it. */
  sender: string | null
  open: boolean
  onCancel: () => void
  reason: string
  onReason: (reason: string) => void
  onConfirm: () => void
  /** While the close is being sent. */
  busy?: boolean
}

export function DontPublishDialog({
  title,
  sender,
  open,
  onCancel,
  reason,
  onReason,
  onConfirm,
  busy,
}: Props) {
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onCancel()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Don't publish it?</DialogTitle>
          <DialogDescription>
            Agents never get “{title}”. Say why:{' '}
            {sender
              ? `${sender} reads the reason in their Inbox.`
              : 'the reason is kept with the decision.'}
          </DialogDescription>
        </DialogHeader>
        <Textarea
          aria-label="Why you don't publish it"
          placeholder="Why you don't publish it"
          rows={3}
          value={reason}
          onChange={(e) => onReason(e.target.value)}
        />
        <DialogFooter>
          <DialogClose render={<Button variant="outline" />}>Cancel</DialogClose>
          <Button
            disabled={!reason.trim()}
            loading={busy}
            loadingLabel="Closing…"
            onClick={onConfirm}
          >
            Don't publish
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
