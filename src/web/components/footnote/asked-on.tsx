import * as React from 'react'
import type { PersonAvatar } from '@/components/footnote/bits'
import type { LinkIcon } from '@/components/icons'
import type { midSentence } from '@/lib/utils'
import type { CheckAnswerRow, InboxCard } from '@/model/inbox'

/*
  Ask someone who knows, on an Inbox card (pages/inbox.tsx): the day its link was copied, never who
  opened it, and on a Needs a recheck card what people answered there, under their names. The
  owner still does the check. What it uses of the Inbox comes as its parts, so loading it splits
  nothing.
*/

type Parts = {
  PersonAvatar: typeof PersonAvatar
  LinkIcon: typeof LinkIcon
  midSentence: typeof midSentence
}

/** An answer to "Is this still true?" in a few words, as the owner reads it on the card. */
export const checkAnswerWords = (row: Pick<CheckAnswerRow, 'answer' | 'endedOn'>) =>
  row.answer === 'still_true'
    ? 'Yes, still true'
    : row.answer === 'ended'
      ? `It ended on ${row.endedOn}`
      : "I don't know"

export default function AskedOn({
  asked,
  parts: { PersonAvatar, LinkIcon, midSentence },
}: {
  asked: NonNullable<InboxCard['asked']>
  parts: Parts
}) {
  const answers = asked.answers
  const note = React.useId()
  return (
    <section
      aria-label="Asked someone who knows"
      aria-describedby={answers.length ? note : undefined}
      className="flex flex-col gap-3"
    >
      <p className="flex items-center gap-2 text-muted-foreground">
        <LinkIcon aria-hidden className="size-4 shrink-0" />
        Link copied on {asked.on}.{answers.length ? '' : ' No answer yet.'}
      </p>
      {answers.map((a, i) => (
        <figure key={i} className="flex gap-3 border-l-2 pl-3">
          <PersonAvatar name={a.by} size={20} className="mt-0.5" />
          <div className="flex min-w-0 flex-col gap-1">
            <figcaption>
              <span className="font-medium">{a.by}</span> answered {midSentence(a.when)}:{' '}
              <span className="font-medium">{checkAnswerWords(a)}</span>
            </figcaption>
            {a.words && (
              <blockquote className="text-pretty text-muted-foreground">{a.words}</blockquote>
            )}
            {a.link && (
              <a
                href={a.link}
                target="_blank"
                rel="noreferrer"
                className="truncate text-primary underline-offset-4 hover:underline"
              >
                {a.link.replace(/^https?:\/\//, '')}
              </a>
            )}
          </div>
        </figure>
      ))}
      {answers.length > 0 && (
        <p id={note} className="text-muted-foreground">
          Agents don&apos;t get answers. Check it yourself, then decide.
        </p>
      )}
    </section>
  )
}
