import * as React from 'react'
import { SparklesIcon, Undo2Icon, XIcon } from '@/components/icons'
import { Button } from '@/components/ui/button'
import { changeLine, fieldList, type AgentChange } from '@/model/draft-session'
import { cn } from '@/lib/utils'

// What the person's agent did to the draft open in the editor (Route 1): a strip that says what it
// changed and how long ago, with Undo; its words beside a field the person was writing in, to take
// or leave; and a mark on each field only the agent has written, which nobody has read yet.

/** The time now, again every `ms`: "20 seconds ago" stays true while it is on the screen. */
function useNow(ms: number) {
  const [now, setNow] = React.useState(() => new Date())
  React.useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), ms)
    return () => window.clearInterval(timer)
  }, [ms])
  return now
}

/**
 * Said to a screen reader once when a change comes, without the time that moves on: there before
 * the strip is, so the words are read out.
 */
export function AgentChangeSaid({ change }: { change: AgentChange | null }) {
  return (
    <span className="sr-only" aria-live="polite">
      {change ? `${change.agent} changed ${fieldList(change.fields)}.` : ''}
    </span>
  )
}

/** "Claude changed Title and When, 20 seconds ago", with Undo and a way to close it. */
export function AgentChangeStrip({
  change,
  onUndo,
  onClose,
}: {
  change: AgentChange
  onUndo: () => void
  onClose: () => void
}) {
  const now = useNow(10_000)
  return (
    <section
      aria-label={`What ${change.agent} changed`}
      className="mb-5 flex items-center gap-2 rounded-frame bg-muted py-1 pr-1 pl-3 text-sm"
    >
      <SparklesIcon className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
      <p className="min-w-0 flex-1 py-1">{changeLine(change, now)}</p>
      <Button variant="ghost" onClick={onUndo}>
        <Undo2Icon data-icon="inline-start" />
        Undo
      </Button>
      <Button variant="ghost" size="icon" aria-label="Close" onClick={onClose}>
        <XIcon />
      </Button>
    </section>
  )
}

/**
 * The agent's words for a field the person is writing in: they never replace what is typed, and
 * wait here until the person takes them or keeps their own.
 */
export function AgentVersion({
  agent,
  field,
  children,
  onTake,
  onLeave,
  className,
}: {
  agent: string
  /** The field's name, as the editor shows it. */
  field: string
  /** The agent's value, in the words the field shows it with. */
  children: React.ReactNode
  onTake: () => void
  onLeave: () => void
  className?: string
}) {
  return (
    <div
      role="group"
      aria-label={`${agent}'s version of ${field}`}
      className={cn('flex flex-col gap-1.5 rounded-frame border bg-muted/30 px-3 py-2', className)}
    >
      <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <SparklesIcon className="size-3 shrink-0" aria-hidden />
        {agent} changed this while you were writing. Its version:
      </p>
      <div className="line-clamp-4 text-sm">{children}</div>
      <div className="flex flex-wrap gap-2">
        <Button variant="outline" onClick={onTake}>
          Use {agent}'s version
        </Button>
        <Button variant="ghost" onClick={onLeave}>
          Keep mine
        </Button>
      </div>
    </div>
  )
}

/** "Claude wrote the title and the text. Check them before you send it." */
export function AgentWroteLine({ agent, parts }: { agent: string; parts: string[] }) {
  if (!parts.length) return null
  const them = parts.length > 1 ? 'them' : 'it'
  return (
    <p className="mb-4 flex items-start gap-1.5 text-xs text-muted-foreground">
      <SparklesIcon className="mt-0.5 size-3 shrink-0" aria-hidden />
      {agent} wrote {parts.join(' and ')}. Check {them} before you send it.
    </p>
  )
}

/** A field only the agent has written, and nobody has read yet: its mark, as a PropertyRow shows it. */
export const agentMark = (agent: string) => ({
  icon: <SparklesIcon className="size-3" />,
  words: `Written by ${agent}. Check it before you send it.`,
})
