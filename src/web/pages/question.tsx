import * as React from 'react'
import type { Question } from '@contract/questions'
import type { CheckAnswer } from '@domain/question-link'
import type { QuestionParts } from '@/components/footnote/question-parts'

/*
  The page a question link opens (Ask someone who knows, src/domain/questions.ts): no sidebar and
  no list, one question for someone who will never learn the app. The topic in large letters, never
  the words of a question; then one answer and one button that sends it to the owner, under the
  person's name. Nothing it sends reaches an agent until the owner publishes. It stands outside the
  shell, as the sign-in page does, and asks a person who is not signed in to sign in here. What it
  uses of the app comes as its parts (question-parts.ts), so loading it splits nothing.
*/

const Parts = React.createContext<QuestionParts | null>(null)
function useParts(): QuestionParts {
  const parts = React.useContext(Parts)
  if (!parts) throw new Error('The question page draws inside its parts.')
  return parts
}

/** A phone's finger needs 44px. */
const touch = 'pointer-coarse:h-11'

export default function QuestionPage({ parts }: { parts: QuestionParts }) {
  return (
    <Parts.Provider value={parts}>
      <Page />
    </Parts.Provider>
  )
}

function Page() {
  const { usePageTitle, useRoute, useQuery, sessionQuery, Logo, PersonAvatar } = useParts()
  usePageTitle('A question for you')
  const { parts, path } = useRoute()
  const id = parts[1] ?? ''
  const session = useQuery(sessionQuery())
  const user = session.data?.user
  return (
    <div className="flex min-h-svh flex-col bg-background">
      <header className="flex h-bar shrink-0 items-center justify-between gap-3 border-b px-4 md:px-6">
        <Logo className="h-6" />
        {user && (
          <span className="flex min-w-0 items-center gap-2 text-sm text-muted-foreground">
            <PersonAvatar name={user} size={20} />
            <span className="min-w-0 truncate">
              Signed in as <span className="font-medium text-foreground">{user}</span>
            </span>
          </span>
        )}
      </header>
      <main className="flex w-full flex-1 justify-center px-4 pt-10 pb-16 md:px-6 md:pt-20">
        <div className="flex w-full max-w-reading flex-col">
          {session.isPending ? <Waiting /> : !user ? <SignIn returnTo={path} /> : <Asked id={id} />}
        </div>
      </main>
    </div>
  )
}

function Waiting() {
  const { Skeleton } = useParts()
  return (
    <div role="status" aria-label="Loading" className="flex flex-col gap-3">
      <Skeleton className="h-9 w-4/5" />
      <Skeleton className="h-9 w-1/2" />
      <Skeleton className="mt-6 h-5 w-full" />
      <Skeleton className="mt-4 h-28 w-full" />
    </div>
  )
}

/** A heading and a sentence or two: a state of the page that asks nothing of the person. */
function Notice({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-3">
      <h1 className="text-2xl font-semibold text-balance">{title}</h1>
      <p className="text-base text-pretty text-muted-foreground">{children}</p>
    </section>
  )
}

function SignIn({ returnTo }: { returnTo: string }) {
  const { SignInChoices } = useParts()
  return (
    <section className="flex flex-col gap-6">
      <div className="flex flex-col gap-3">
        <h1 className="text-2xl font-semibold text-balance">Sign in to see the question</h1>
        <p className="text-base text-pretty text-muted-foreground">
          Someone asked you what happened with a number. The question opens once you sign in, and
          what you answer goes to its owner under your name.
        </p>
      </div>
      <div className="max-w-xs">
        <SignInChoices returnTo={returnTo} />
      </div>
      <p className="border-t pt-4 text-sm text-pretty text-muted-foreground">
        <span className="font-medium text-foreground">Can&apos;t sign in?</span> Ask the person who
        sent you this link. They can ask an admin to add you, or to let your company&apos;s sign-in
        in.
      </p>
    </section>
  )
}

function Asked({ id }: { id: string }) {
  const { useQuery, questionQuery, toApiError, Button } = useParts()
  const question = useQuery(questionQuery(id))
  const [sent, setSent] = React.useState(false)
  if (question.isPending) return <Waiting />
  if (question.isError)
    return toApiError(question.error).kind === 'not-found' ? (
      <Notice title="We couldn't find this question">
        The link may be cut short. Ask the person who sent it to copy it again.
      </Notice>
    ) : (
      <section className="flex flex-col items-start gap-4">
        <Notice title="We couldn't load this question">
          Nothing was sent. Check the connection and try again.
        </Notice>
        <Button size="lg" variant="outline" onClick={() => void question.refetch()}>
          Try again
        </Button>
      </section>
    )
  const q = question.data
  if (sent) return <Sent q={q} />
  if (!q.open)
    return (
      <Notice title="Nothing to answer here any more">
        {q.kind === 'gap'
          ? 'Someone wrote this down already, or its owner closed the question. Thanks for looking.'
          : 'The context item this asked about was archived. Thanks for looking.'}
      </Notice>
    )
  // Answered or closed meanwhile: the page reads the question again and says so.
  return <Answer q={q} onSent={() => setSent(true)} onClosed={() => void question.refetch()} />
}

/** Who gets the answer, in the words of the button and the line under it. */
function sendTo(q: Question) {
  const [one] = q.owners
  if (q.owners.length === 1)
    return {
      button: `Send to ${one}, owner of ${q.domain}`,
      checks: `${firstName(one!)} checks it`,
      waits: firstName(one!),
    }
  if (q.owners.length > 1)
    return {
      button: `Send to the owners of ${q.domain}`,
      checks: `${orList(q.owners.map(firstName))} checks it`,
      waits: `the owners of ${q.domain}`,
    }
  return { button: 'Send to the admins', checks: 'An admin checks it', waits: 'the admins' }
}
const firstName = (name: string) => name.split(' ')[0] ?? name
/** "Jon, Maria or Ravi". */
const orList = (names: readonly string[]) =>
  names.length < 2 ? names.join('') : `${names.slice(0, -1).join(', ')} or ${names.at(-1)}`

/** A day in British English, whatever the browser's language: "30 October 2026", or a part of it. */
const dayIn = (day: string, parts: Intl.DateTimeFormatOptions) =>
  new Date(`${day}T00:00:00Z`).toLocaleString('en-GB', { timeZone: 'UTC', ...parts })
const full: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'long', year: 'numeric' }

/**
 * The days a question is about, as the topic's second line, end exclusive: "October 2026",
 * "30 October to 1 November 2026", "Since 28 April 2026" for an item still going.
 */
function datesLine(dates: Question['dates'], shiftDate: QuestionParts['shiftDate']) {
  if (dates.end === null) return `Since ${dayIn(dates.start, full)}`
  const [start, last] = [dates.start, shiftDate(dates.end, -1)]
  const sameYear = start.slice(0, 4) === last.slice(0, 4)
  if (start.endsWith('-01') && dates.end.endsWith('-01')) {
    const month = { month: 'long', year: 'numeric' } as const
    if (start.slice(0, 7) === last.slice(0, 7)) return dayIn(start, month)
    return `${dayIn(start, sameYear ? { month: 'long' } : month)} to ${dayIn(last, month)}`
  }
  if (start === last) return dayIn(start, full)
  const from =
    start.slice(0, 7) === last.slice(0, 7)
      ? dayIn(start, { day: 'numeric' })
      : dayIn(start, sameYear ? { day: 'numeric', month: 'long' } : full)
  return `${from} to ${dayIn(last, full)}`
}

/** The topic in large letters: the one thing on the page to read first. */
function Topic({ q }: { q: Question }) {
  const { shiftDate } = useParts()
  return (
    <h1 className="flex flex-col text-3xl font-bold text-balance wrap-anywhere">
      <span>{q.topic}</span>
      <span className="text-muted-foreground">{datesLine(q.dates, shiftDate)}</span>
    </h1>
  )
}

function Sent({ q }: { q: Question }) {
  const { CircleCheckIcon } = useParts()
  return (
    <section role="status" className="flex flex-col gap-3">
      <CircleCheckIcon aria-hidden className="size-8 text-good" />
      <h1 className="text-2xl font-semibold">Sent. It waits for {sendTo(q).waits}.</h1>
    </section>
  )
}

/** A link it reads as one: http or https, with nothing else around it. */
const linkProblem = (link: string) =>
  link && !/^https?:\/\/\S+$/.test(link)
    ? 'Paste the whole link, starting with https://, or leave it empty.'
    : null

function Answer({
  q,
  onSent,
  onClosed,
}: {
  q: Question
  onSent: () => void
  onClosed: () => void
}) {
  const {
    QUESTION_WORDS,
    CHECK_WORDS,
    useApiWrite,
    shiftDate,
    toApiError,
    Textarea,
    Input,
    Button,
    TriangleAlertIcon,
  } = useParts()
  const answer = useApiWrite('answerQuestion')
  const [words, setWords] = React.useState('')
  const [link, setLink] = React.useState('')
  // A gap's dates are its month: always an end.
  const [dates, setDates] = React.useState<Days>({
    start: q.dates.start,
    end: q.dates.end ?? shiftDate(q.dates.start, 1),
  })
  const [choice, setChoice] = React.useState<CheckAnswer | null>(null)
  const [endedOn, setEndedOn] = React.useState<string | null>(null)
  const [shown, setShown] = React.useState<string | null>(null)
  const to = sendTo(q)
  const isGap = q.kind === 'gap'
  const max = isGap ? QUESTION_WORDS : CHECK_WORDS
  const count = [...words].length
  const failed = answer.isError ? toApiError(answer.error) : null

  const send = () => {
    const trimmed = words.trim()
    const problem = isGap
      ? !trimmed
        ? 'Write what happened first, in a sentence or two.'
        : null
      : !choice
        ? 'Choose an answer first.'
        : choice === 'ended' && !endedOn
          ? 'Pick the day it ended.'
          : null
    setShown(problem ?? linkProblem(link.trim()))
    if (problem ?? linkProblem(link.trim())) return
    const source = link.trim() ? { link: link.trim() } : {}
    answer.mutate(
      isGap
        ? { id: q.id, kind: 'gap', words: trimmed, dates, ...source }
        : {
            id: q.id,
            kind: 'check',
            answer: choice!,
            ...(choice === 'ended' && endedOn ? { endedOn } : {}),
            ...(trimmed ? { words: trimmed } : {}),
            ...source,
          },
      {
        onSuccess: onSent,
        onError: (error) => {
          if (toApiError(error).kind === 'conflict') onClosed()
        },
      },
    )
  }

  return (
    <form
      className="flex flex-col gap-8"
      noValidate
      onSubmit={(e) => {
        e.preventDefault()
        send()
      }}
    >
      <div className="flex flex-col gap-4">
        <Topic q={q} />
        {isGap ? (
          <p className="text-base text-pretty text-muted-foreground">
            People asked about this
            {q.times === null
              ? ' fewer than 5 times this week'
              : q.times > 0
                ? ` ${q.times.toLocaleString('en-GB')} times this week`
                : ''}
            , and nothing is written down.
          </p>
        ) : (
          q.item && (
            <blockquote className="border-l-2 pl-4 text-base text-pretty">
              {q.item.summary}
            </blockquote>
          )
        )}
      </div>

      {isGap ? (
        <div className="flex flex-col gap-2">
          <label htmlFor="question-words" className="text-xl font-semibold">
            Do you know what happened?
          </label>
          <Textarea
            id="question-words"
            value={words}
            onChange={(e) => {
              setWords(e.target.value)
              setShown(null)
            }}
            placeholder="Two sentences, in your own words"
            rows={4}
            maxLength={max}
            aria-invalid={shown !== null && !words.trim()}
            aria-describedby="question-words-count"
            className="min-h-28 rounded-surface px-3 py-2.5 text-base md:text-base"
          />
          <p
            id="question-words-count"
            aria-live="polite"
            className="self-end text-xs text-muted-foreground tabular-nums"
          >
            {count > max - 40 ? `${max - count} characters left` : ''}
          </p>
          <WhenRow dates={dates} onChange={setDates} />
        </div>
      ) : (
        <CheckChoice
          choice={choice}
          onChoice={(c) => {
            setChoice(c)
            setShown(null)
          }}
          endedOn={endedOn}
          onEndedOn={(day) => {
            setEndedOn(day)
            setShown(null)
          }}
          since={q.dates.start}
          words={words}
          onWords={setWords}
        />
      )}

      <div className="flex flex-col gap-2">
        <label htmlFor="question-link" className="text-sm font-medium">
          A link to where this is written, if you have one
        </label>
        <Input
          id="question-link"
          type="url"
          inputMode="url"
          value={link}
          onChange={(e) => {
            setLink(e.target.value)
            setShown(null)
          }}
          placeholder="https://"
          aria-invalid={shown !== null && linkProblem(link.trim()) !== null}
          className="h-10 md:text-base"
        />
      </div>

      <div className="flex flex-col gap-3 border-t pt-6">
        {(shown ?? (failed && failed.kind !== 'conflict' ? failed.message : null)) && (
          <p role="alert" className="flex items-start gap-2 text-sm text-destructive">
            <TriangleAlertIcon aria-hidden className="mt-0.5 size-4 shrink-0" />
            {shown ?? failed!.message}
          </p>
        )}
        <Button
          type="submit"
          size="lg"
          className={`self-start max-sm:w-full ${touch}`}
          loading={answer.isPending}
          loadingLabel="Sending…"
        >
          <span className="truncate">{to.button}</span>
        </Button>
        <p className="text-sm text-pretty text-muted-foreground">
          {to.checks} before any AI agent gets it. Your name is on it.
        </p>
      </div>
    </form>
  )
}

type Days = { start: string; end: string }

/** The dates, already set to what was asked about, with Change: two days a phone picks natively. */
function WhenRow({ dates, onChange }: { dates: Days; onChange: (dates: Days) => void }) {
  const parts = useParts()
  const { shiftDate, CalendarIcon, Button, Input } = parts
  const [open, setOpen] = React.useState(false)
  const last = shiftDate(dates.end, -1)
  return (
    <div className="mt-2 flex flex-col gap-3 text-sm">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
        <span id="question-when" className="font-medium">
          When
        </span>
        <span className="flex items-center gap-2 text-foreground">
          <CalendarIcon aria-hidden className="size-4 text-muted-foreground" />
          {datesLine(dates, shiftDate)}
        </span>
        <Button
          variant="ghost"
          className={`-ml-2 text-primary ${touch}`}
          aria-expanded={open}
          aria-describedby="question-when"
          onClick={() => setOpen(!open)}
        >
          {open ? 'Done' : 'Change'}
        </Button>
      </div>
      {open && (
        <div className="flex flex-wrap gap-4">
          <label className="flex flex-col gap-1.5">
            <span className="font-medium">First day</span>
            <Input
              type="date"
              value={dates.start}
              max={last}
              onChange={(e) => e.target.value && onChange({ ...dates, start: e.target.value })}
              className="h-10 w-auto md:text-base"
            />
          </label>
          <label className="flex flex-col gap-1.5">
            <span className="font-medium">Last day</span>
            <Input
              type="date"
              value={last}
              min={dates.start}
              onChange={(e) =>
                e.target.value && onChange({ ...dates, end: shiftDate(e.target.value, 1) })
              }
              className="h-10 w-auto md:text-base"
            />
          </label>
        </div>
      )}
    </div>
  )
}

const choiceWords: Record<CheckAnswer, string> = {
  still_true: 'Yes, still true',
  ended: 'It ended on a day',
  unknown: "I don't know",
}

/** "Is this still true?": three answers, a day for the one that ended, and words if they have some. */
function CheckChoice({
  choice,
  onChoice,
  endedOn,
  onEndedOn,
  since,
  words,
  onWords,
}: {
  choice: CheckAnswer | null
  onChoice: (choice: CheckAnswer) => void
  endedOn: string | null
  onEndedOn: (day: string) => void
  since: string
  words: string
  onWords: (words: string) => void
}) {
  const { CHECK_WORDS, Input, RadioGroup, RadioGroupItem, Textarea } = useParts()
  return (
    <div className="flex flex-col gap-6">
      <fieldset className="flex flex-col gap-3">
        <legend className="mb-3 text-xl font-semibold">Is this still true?</legend>
        <RadioGroup
          value={choice ?? ''}
          onValueChange={(v) => onChoice(v as CheckAnswer)}
          className="flex flex-col gap-0 divide-y border-y"
        >
          {(Object.keys(choiceWords) as CheckAnswer[]).map((value) => (
            <div key={value} className="flex min-h-12 flex-wrap items-center gap-x-3 py-1.5">
              <label className="flex min-h-9 flex-1 cursor-default items-center gap-3 text-base">
                <RadioGroupItem value={value} />
                {choiceWords[value]}
              </label>
              {value === 'ended' && choice === 'ended' && (
                <Input
                  type="date"
                  aria-label="The day it ended"
                  value={endedOn ?? ''}
                  min={since}
                  onChange={(e) => e.target.value && onEndedOn(e.target.value)}
                  className={`h-10 w-auto md:text-base ${touch}`}
                />
              )}
            </div>
          ))}
        </RadioGroup>
      </fieldset>
      <div className="flex flex-col gap-2">
        <label htmlFor="question-words" className="text-sm font-medium">
          Anything the owner should know, if you like
        </label>
        <Textarea
          id="question-words"
          value={words}
          onChange={(e) => onWords(e.target.value)}
          placeholder="In your own words"
          rows={3}
          maxLength={CHECK_WORDS}
          className="min-h-20 rounded-surface px-3 py-2.5 text-base md:text-base"
        />
      </div>
    </div>
  )
}
