import * as React from 'react'
import { useQuery } from '@tanstack/react-query'
import { FileTextIcon, LockIcon, MessageSquareIcon } from '@/components/icons'
import { toast } from '@/lib/toast'
import { ApiError, toApiError } from '@/api/errors'
import { Page } from '@/components/site-header'
import { Button } from '@/components/ui/button'
import { Loadable, PageSkeleton } from '@/components/footnote/load-state'
import { NotFound } from '@/components/footnote/not-found'
import { StateLine } from '@/components/footnote/state-line'
import { sharedChatQuery, useWrite } from '@/api/queries'
import type { SharedChat, SharedTurn } from '@contract/shared-chats'
import type { Fact } from '@/model/items'
import { stateSentence } from '@/model/ask'
import { cn } from '@/lib/utils'
import { dayMonthYear } from '@/lib/dates'
import { askInDock, openDock } from '@/lib/dock'
import { navigate } from '@/lib/router'
import { useFacts } from '@/lib/workspace'

// A chat someone shared as a link (FR-721): their copy of it, one block a turn, under their name.
// The sources are read now, as the reader: one they may not read is locked in its place, and a
// turn that rests on one shows its question and answer line without its words.

export function SharedChatPage({ id }: { id: string }) {
  const chat = useQuery(sharedChatQuery(id))
  const gone = chat.error instanceof ApiError && chat.error.kind === 'not-found'
  return (
    <Page title="Shared chat" icon={<MessageSquareIcon />}>
      <div className="mx-auto flex w-full max-w-176 flex-col px-4 py-6 md:py-8">
        {gone ? (
          <NotFound title="This link opens nothing" way={{ href: '/ask', label: 'Open Ask' }}>
            Its sender stopped it, its 90 days are over, or an admin turned off sharing chats. Ask
            the person who sent it.
          </NotFound>
        ) : (
          <Loadable what="the shared chat" skeleton={<PageSkeleton />} query={chat}>
            {chat.data && <Shared chat={chat.data} />}
          </Loadable>
        )}
      </div>
    </Page>
  )
}

function Shared({ chat }: { chat: SharedChat }) {
  const write = useWrite()
  const facts = useFacts()
  const byId = React.useMemo(() => new Map(facts.map((f) => [f.id, f])), [facts])
  const stop = () =>
    void write('stopSharing', { ids: [chat.id] }).then(
      () => {
        toast('Stopped sharing', { description: chat.title })
        navigate('/ask')
      },
      (e: unknown) => toast.error("Couldn't stop sharing", { description: toApiError(e).message }),
    )
  // A chat is named by its first question, unless its sender renamed it.
  const first = chat.turns.find((t) => t.kind === 'turn')
  const renamed = !first || first.question !== chat.title
  return (
    <div className="flex flex-col gap-8">
      <header className="flex flex-col gap-2 border-b pb-5">
        {renamed && <h2 className="text-xl font-semibold text-balance">{chat.title}</h2>}
        <p className="text-sm text-muted-foreground">
          Shared by {chat.mine ? 'you' : (chat.by.name ?? 'someone who has left')} on{' '}
          {dayMonthYear(chat.at)}, until {dayMonthYear(chat.until)}. A copy of the chat as it was
          then: its sources open as they are today, and only for people who may read them.
        </p>
        {chat.mine && (
          <div>
            <Button variant="outline" onClick={stop}>
              Stop sharing
            </Button>
          </div>
        )}
      </header>
      <ol className="flex flex-col gap-10">
        {chat.turns.map((turn, i) => (
          <li key={i}>
            <Turn turn={turn} byId={byId} />
          </li>
        ))}
      </ol>
    </div>
  )
}

function Turn({ turn, byId }: { turn: SharedTurn; byId: Map<string, Fact> }) {
  if (turn.kind === 'left')
    return (
      <p className="flex items-center gap-2 rounded-surface border border-dashed border-input px-3 py-2 text-sm text-muted-foreground">
        <FileTextIcon className="size-4 shrink-0" aria-hidden />
        One answer is left out here: it rested on a draft, which only its writer reads.
      </p>
    )
  return (
    <article className="flex flex-col gap-4">
      <div className="flex justify-end">
        <p className="max-w-22/25 min-w-0 rounded-surface bg-muted px-4 py-2.5 text-base leading-chat wrap-anywhere whitespace-pre-line @lg:max-w-4/5">
          {turn.question}
        </p>
      </div>
      {turn.state ? (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <StateLine state={turn.state} />
          {turn.state !== 'grounded' && (
            <span className="text-sm text-muted-foreground">{stateSentence[turn.state]}</span>
          )}
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">Nothing was looked up</p>
      )}
      {turn.words === null ? (
        <p className="flex items-start gap-2 text-sm text-muted-foreground">
          <LockIcon className="mt-0.5 size-4 shrink-0" aria-hidden />
          Its words are left out: they rest on a context item you may not read.
        </p>
      ) : (
        <Words text={turn.words} sources={turn.sources} />
      )}
      {turn.sources.length > 0 && (
        <ol aria-label="Sources" className="flex max-w-reading flex-col gap-1 text-sm">
          {turn.sources.map((id, i) => (
            <li key={i} className="grid grid-cols-(--cols-lead-4-trail-auto) gap-x-2">
              <span className="text-muted-foreground tabular-nums">{i + 1}</span>
              <Source fact={id ? byId.get(id) : undefined} id={id} />
            </li>
          ))}
        </ol>
      )}
      {turn.read.length > 0 && (
        <div className="flex max-w-reading flex-col gap-1.5 text-xs text-muted-foreground">
          <p className="font-medium text-foreground">What Ask read</p>
          <ul className="flex flex-col gap-1">
            {turn.read.map((line, i) => (
              <li key={i}>{line}</li>
            ))}
          </ul>
        </div>
      )}
      <div>
        <Button variant="outline" onClick={() => askInDock(turn.question)}>
          <MessageSquareIcon data-icon="inline-start" />
          Ask it yourself
        </Button>
      </div>
    </article>
  )
}

/** A citation as Ask draws one: its number in a small box, which opens its source. */
const cite =
  'ml-0.5 mr-px inline-flex h-6 min-w-6 -translate-y-px items-center justify-center rounded-md bg-muted px-1.5 align-middle text-xs font-medium text-foreground tabular-nums outline-none'

/** The words, a paragraph each, with each [n] a mark that opens its source. */
function Words({ text, sources }: { text: string; sources: readonly (string | null)[] }) {
  return (
    <div className="flex max-w-reading flex-col gap-3 text-base leading-chat text-pretty">
      {text
        .split(/\n{2,}/)
        .filter((p) => p.trim())
        .map((paragraph, i) => (
          <p key={i} className="whitespace-pre-line">
            {paragraph.split(/(\[\d+\])/).map((part, j) => {
              const n = /^\[(\d+)\]$/.exec(part)?.[1]
              if (!n) return <React.Fragment key={j}>{part}</React.Fragment>
              const source = sources[Number(n) - 1]
              return source ? (
                <button
                  key={j}
                  type="button"
                  aria-label={`Source ${n}`}
                  onClick={() => openDock('context', source)}
                  className={cn(
                    cite,
                    'cursor-pointer transition-colors hover:bg-accent focus-visible:ring-3 focus-visible:ring-ring/50',
                  )}
                >
                  {n}
                </button>
              ) : (
                <span key={j} aria-label={`Source ${n}`} className={cite}>
                  {n}
                </span>
              )
            })}
          </p>
        ))}
    </div>
  )
}

/** A source as it is today: its title and who checked it, or locked for a reader who may not read it. */
function Source({ fact, id }: { fact: Fact | undefined; id: string | null }) {
  if (!id)
    return (
      <span className="flex items-center gap-1.5 text-muted-foreground">
        <LockIcon className="size-3.5 shrink-0" aria-hidden />A context item you may not read
      </span>
    )
  return (
    <button
      type="button"
      onClick={() => openDock('context', id)}
      className="min-w-0 rounded-xs text-left outline-none hover:underline focus-visible:ring-3 focus-visible:ring-ring/50"
    >
      {fact ? (
        <>
          {fact.title}
          <span className="text-muted-foreground">
            {' '}
            -{' '}
            {fact.status === 'Archived'
              ? 'archived'
              : `checked by ${fact.checkedBy}, ${fact.checkedOn}`}
          </span>
        </>
      ) : (
        'Open the context item'
      )}
    </button>
  )
}
