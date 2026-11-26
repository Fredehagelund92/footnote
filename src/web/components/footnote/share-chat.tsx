import * as React from 'react'
import { useQuery } from '@tanstack/react-query'
import { LinkIcon, RefreshCwIcon } from '@/components/icons'
import { toast } from '@/lib/toast'
import { toApiError } from '@/api/errors'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { DockFrame, DockMissing } from '@/components/dock'
import { CopiedIcon, useCopied } from '@/components/footnote/copied-icon'
import { chatSharesQuery, useWorkspace, useWrite } from '@/api/queries'
import type { MyShare } from '@contract/shared-chats'
import { dayMonthYear } from '@/lib/dates'
import { closeDock } from '@/lib/dock'
import { navigate } from '@/lib/router'
import { useThreads } from '@/lib/threads'
import {
  answersCount,
  sameLinkOf,
  sharedChatLink,
  sharedChatPath,
  shareTurnsOf,
} from '@/model/shared-chat'

// Share chat, from the Ask chat's header (FR-721): the right panel, which makes one link to a copy
// of the whole chat as it stands, and says what the link keeps and who can open it.

type Made = { link: MyShare } | { failed: string } | { stopped: true }

export function ShareChatPanel({ chat }: { chat: string }) {
  const thread = useThreads().find((t) => t.id === chat)
  const shares = useQuery(chatSharesQuery())
  const write = useWrite()
  const answers = React.useMemo(() => thread?.answers ?? [], [thread])
  const turns = React.useMemo(() => shareTurnsOf(answers), [answers])
  const [made, setMade] = React.useState<Made | null>(null)
  const asked = React.useRef(false)
  const links = shares.data?.links
  const same = links ? sameLinkOf(links, chat, turns.length) : undefined
  const on = shares.data?.on
  const share = React.useCallback(() => {
    if (!thread) return
    asked.current = true
    setMade(null)
    write('shareChat', { chat, title: thread.title, turns }).then(
      (link) => setMade({ link }),
      (e: unknown) => setMade({ failed: toApiError(e).message }),
    )
  }, [chat, thread, turns, write])
  // Opened, the panel makes the link at once, unless this chat already has one that keeps every
  // turn it has now: opening it again, or reloading, makes no second link.
  React.useEffect(() => {
    if (asked.current || !on || !links || same || !turns.length) return
    share()
  }, [on, links, same, turns.length, share])
  // Escape closes it, as it closes a peek.
  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (
        e.key === 'Escape' &&
        !e.defaultPrevented &&
        !(e.target as HTMLElement).closest('input, textarea, [contenteditable=true]')
      )
        closeDock()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  if (!thread || !turns.length)
    return (
      <DockFrame title="Share chat">
        <DockMissing>
          This chat is not in this browser any more, or has no answer yet. Open it from History to
          share it.
        </DockMissing>
      </DockFrame>
    )
  if (shares.isError)
    return (
      <DockFrame title="Share chat">
        <Trouble line="Couldn't read your links." onRetry={() => void shares.refetch()} />
      </DockFrame>
    )
  if (on === false)
    return (
      <DockFrame title="Share chat">
        <DockMissing>An admin has turned off sharing chats, so no link is made.</DockMissing>
      </DockFrame>
    )
  if (made && 'failed' in made)
    return (
      <DockFrame title="Share chat">
        <Trouble line={made.failed} onRetry={share} />
      </DockFrame>
    )
  if (made && 'stopped' in made)
    return (
      <DockFrame title="Share chat">
        <div className="flex flex-col items-start gap-3 p-4 text-sm @md:p-5">
          <p>The link is stopped. It opens nothing now, and its copy of the chat is deleted.</p>
          <Button variant="outline" onClick={share}>
            <LinkIcon data-icon="inline-start" />
            Share again
          </Button>
        </div>
      </DockFrame>
    )
  const link = made?.link ?? same
  if (!link)
    return (
      <DockFrame title="Share chat">
        <p role="status" className="p-4 text-sm text-muted-foreground @md:p-5">
          Making the link…
        </p>
      </DockFrame>
    )
  return (
    <ShareLink
      link={link}
      onStop={() =>
        void write('stopSharing', { ids: [link.id] }).then(
          () => setMade({ stopped: true }),
          (e: unknown) =>
            toast.error("Couldn't stop the link", { description: toApiError(e).message }),
        )
      }
    />
  )
}

/** A link once made: the address and Copy link, and what it keeps, for whom and how long. */
function ShareLink({ link, onStop }: { link: MyShare; onStop: () => void }) {
  const workspace = useWorkspace().name
  const [copied, copy] = useCopied()
  const address = sharedChatLink(link.id)
  const kept = link.turns - link.left
  return (
    <DockFrame
      title="Share chat"
      footer={
        <Button
          autoFocus
          onClick={() => {
            copy(address)
            toast('Link copied', { description: 'Anyone signed in here can open it.' })
          }}
        >
          <CopiedIcon copied={copied} data-icon="inline-start" />
          Copy link
        </Button>
      }
    >
      <div className="flex flex-col gap-4 p-4 text-sm @md:p-5">
        <p>
          {workspace
            ? `Anyone signed in to ${workspace} can open this link and see the chat as it is now, under your name.`
            : 'Anyone signed in here can open this link and see the chat as it is now, under your name.'}
        </p>
        <Input
          readOnly
          value={address}
          aria-label="Link to the chat"
          onFocus={(e) => e.target.select()}
        />
        <ul className="flex list-disc flex-col gap-1.5 pl-5 text-muted-foreground">
          <li>
            It keeps {answersCount(kept)}: each question, what Ask read, the answer line, the words
            and the sources.
          </li>
          {link.left > 0 && (
            <li>
              {link.left === 1
                ? '1 answer is left out, as it rests on a draft only its writer reads.'
                : `${link.left.toLocaleString('en-GB')} answers are left out, as they rest on drafts only their writers read.`}
            </li>
          )}
          <li>Each source opens as it is today, and only for people who may read it.</li>
          <li>No figures are kept. To see one, a reader asks the question again.</li>
          <li>Later answers in this chat are not added. Share it again for a new link.</li>
        </ul>
        <div className="flex flex-col gap-3 border-t pt-4">
          <p className="text-muted-foreground">
            Shared until {dayMonthYear(link.until)}. You can stop it here or in History.
          </p>
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" onClick={() => navigate(sharedChatPath(link.id))}>
              Open the link
            </Button>
            <Button variant="outline" onClick={onStop}>
              Stop sharing
            </Button>
          </div>
        </div>
      </div>
    </DockFrame>
  )
}

function Trouble({ line, onRetry }: { line: string; onRetry: () => void }) {
  return (
    <div role="alert" className="flex flex-col items-start gap-3 p-4 text-sm @md:p-5">
      <p>{line}</p>
      <Button variant="outline" onClick={onRetry}>
        <RefreshCwIcon data-icon="inline-start" />
        Try again
      </Button>
    </div>
  )
}
