import * as React from 'react'
import { limits } from '@domain/proposal-rules'
import type { ReportParts } from '@/components/footnote/report-parts'
import type { Answer } from '@/model/ask'
import type { Fact } from '@/model/items'

// Something wrong? on an answer (FR-622): the right panel beside the answer, so the answer stays in
// view while the person writes. Bad answer opens it, and so does More. It names the owners the
// report goes to; an owner of the item gets Edit first. The right words for a source wait as a
// suggestion on it, which only an owner publishes. Where Ask is itself in the right panel, the same
// form opens under the answer instead. What it uses of the app comes as its parts
// (report-parts.ts), so loading it splits nothing.

type Sent = { domain: string; suggested?: string }

const Parts = React.createContext<ReportParts | null>(null)

/** The app's parts the form draws with, from its own provider. */
function useParts(): ReportParts {
  const parts = React.useContext(Parts)
  if (!parts) throw new Error('Something wrong? draws inside its parts provider.')
  return parts
}

/** The right panel for one answer on screen, by its key: the form, then what happens next. */
export function ReportPanel({ id, parts }: { id: string; parts: ReportParts }) {
  return (
    <Parts.Provider value={parts}>
      <ReportPanelBody id={id} />
    </Parts.Provider>
  )
}

function ReportPanelBody({ id }: { id: string }) {
  const { Button, DockFrame, DockMissing, askedOf, closeDock, markReportSent } = useParts()
  const { useReportSent, useShownAnswer } = useParts()
  const shown = useShownAnswer(id)
  const already = useReportSent(id)
  const [sent, setSent] = React.useState<Sent | null>(null)
  const done = React.useRef<HTMLHeadingElement>(null)
  // Sent, focus moves to what happens next, so it is read out, and Close is one Tab away.
  React.useEffect(() => {
    if (sent) done.current?.focus()
  }, [sent])
  if (!shown)
    return (
      <DockFrame title="Something wrong?">
        <DockMissing>
          This answer is not on screen any more. Ask the question again to report it.
        </DockMissing>
      </DockFrame>
    )
  if (already && !sent)
    return (
      <DockFrame title="Something wrong?" footer={<Button onClick={closeDock}>Close</Button>}>
        <div className="flex flex-col gap-4 p-4 @md:p-5">
          <YouAsked question={askedOf(shown.answer)} />
          <p className="text-sm">
            You reported this answer. Under it, you see what the owners did.
          </p>
        </div>
      </DockFrame>
    )
  if (sent)
    return (
      <DockFrame title="Something wrong?" footer={<Button onClick={closeDock}>Close</Button>}>
        <div className="flex flex-col gap-4 p-4 @md:p-5">
          <YouAsked question={askedOf(shown.answer)} />
          <SentNote sent={sent} heading={done} />
        </div>
      </DockFrame>
    )
  return (
    <ReportFormBody
      key={id}
      answer={shown.answer}
      facts={shown.facts}
      framed
      onClose={closeDock}
      onSent={(s) => {
        markReportSent(id)
        setSent(s)
      }}
    />
  )
}

function YouAsked({ question }: { question: string }) {
  return (
    <div className="flex flex-col gap-0.5 rounded-md bg-muted px-3 py-2.5">
      <p className="text-xs text-muted-foreground">You asked</p>
      <p className="text-sm">{question}</p>
    </div>
  )
}

/** After sending: where it went, and what happens next, in order. */
function SentNote({
  sent,
  heading,
}: {
  sent: Sent
  heading: React.RefObject<HTMLHeadingElement | null>
}) {
  const { CheckIcon, useDomains } = useParts()
  const domains = useDomains()
  const domain = domains[sent.domain]?.name ?? sent.domain
  return (
    <div className="flex flex-col gap-2 rounded-md border p-4">
      <h3
        ref={heading}
        tabIndex={-1}
        className="flex items-center gap-2 text-sm font-medium outline-none"
      >
        <CheckIcon className="size-4 shrink-0 text-good" aria-hidden />
        Sent to the owners of {domain}
      </h3>
      <ol className="flex list-decimal flex-col gap-1 pl-10 text-sm text-muted-foreground">
        <li>It waits in their Inbox as Reported.</li>
        {sent.suggested && (
          <li>
            Your words wait as a suggestion on “{sent.suggested}”, in your Inbox under Waiting on
            others.
          </li>
        )}
        <li>Ask and agents keep giving the item as it is until an owner publishes a change.</li>
        <li>Under the answer, you see what they did.</li>
      </ol>
    </div>
  )
}

/**
 * The form: which part is wrong, what is wrong, the right words for a source, a link, and who it
 * goes to. `framed` draws it as the right panel, with Send in its footer; otherwise it sits under
 * the answer, scrolled into view.
 */
export function ReportForm({
  parts,
  ...props
}: { parts: ReportParts } & React.ComponentProps<typeof ReportFormBody>) {
  return (
    <Parts.Provider value={parts}>
      <ReportFormBody {...props} />
    </Parts.Provider>
  )
}

function ReportFormBody({
  answer,
  facts,
  framed,
  onClose,
  onSent,
}: {
  answer: Answer
  facts: Fact[]
  framed?: boolean
  onClose: () => void
  onSent: (sent: Sent) => void
}) {
  const { Button, DockFrame, Field, FieldError, FieldGroup, FieldLabel, FieldLegend, FieldSet } =
    useParts()
  const { Input, Label, PencilIcon, RadioGroup, RadioGroupItem, Textarea } = useParts()
  const { askedOf, cn, listOf, navigate, useDomains, useMe, useReported, useWrite } = useParts()
  const domains = useDomains()
  const me = useMe()
  const write = useWrite()
  const formId = React.useId()
  const [part, setPart] = React.useState(facts[0]?.id ?? 'answer')
  const [what, setWhat] = React.useState('')
  const [suggesting, setSuggesting] = React.useState(false)
  const [words, setWords] = React.useState('')
  const [link, setLink] = React.useState('')
  const [problems, setProblems] = React.useState<{ what?: string; link?: string }>({})
  const whatRef = React.useRef<HTMLTextAreaElement>(null)
  const linkRef = React.useRef<HTMLInputElement>(null)
  const form = React.useRef<HTMLFormElement>(null)
  // The answer's wording is filed on its first source, so it reaches that domain's owners.
  const fact = facts.find((f) => f.id === part) ?? facts[0]
  const domainId = fact?.domain ?? 'sales'
  const domain = domains[domainId]?.name ?? domainId
  const owners = domains[domainId]?.owners ?? []
  const others = owners.filter((name) => name !== me.name)
  const canEdit = !!fact && (me.admin || me.owns.includes(domainId))
  // The right words are for one source, as its summary: an owner edits it instead.
  const forItem = !!fact && part === fact.id && !canEdit
  const suggested =
    forItem && suggesting && words.trim() && words.trim() !== fact.summary.trim() ? fact : null
  const to = others.length ? listOf(others) : `the owners of ${domain}`
  const sending = useReported<{ id: string; suggestion?: string }>({
    wasnt: "The report wasn't sent.",
    done: (result) =>
      onSent({
        domain: domainId,
        ...(result.suggestion && suggested ? { suggested: suggested.title } : {}),
      }),
  })

  // Opened, focus goes to what is wrong, and an inline form scrolls into view.
  React.useEffect(() => {
    whatRef.current?.focus({ preventScroll: true })
    if (!framed)
      form.current?.scrollIntoView({
        block: 'nearest',
        behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth',
      })
  }, [framed])

  // Escape closes it while nothing is typed; typed words are never lost to a key.
  const typed = !!(what.trim() || link.trim() || (suggesting && words.trim()))

  const send = () => {
    const found: typeof problems = {}
    if (!what.trim()) found.what = 'Say what is wrong, so the owners know what to fix.'
    if (link.trim() && !/^https?:\/\/\S+$/.test(link.trim()))
      found.link = 'A link starts with https:// and has no spaces.'
    setProblems(found)
    if (found.what) return whatRef.current?.focus()
    if (found.link) return linkRef.current?.focus()
    sending.act(() =>
      write('reportAnswer', {
        question: askedOf(answer),
        part,
        sources: answer.sources,
        what: what.trim(),
        ...(suggested ? { correction: words.trim() } : {}),
        ...(link.trim() ? { link: link.trim() } : {}),
      }),
    )
  }

  const label = suggested
    ? 'Send the report and suggestion'
    : others.length === 1
      ? `Send to ${others[0]}`
      : 'Send to the owners'
  const buttons = (
    <>
      <Button type="button" variant="ghost" onClick={onClose}>
        Cancel
      </Button>
      <Button
        type="submit"
        form={formId}
        loading={sending.state === 'sending'}
        loadingLabel="Sending…"
      >
        {label}
      </Button>
    </>
  )

  const body = (
    <form
      id={formId}
      ref={form}
      noValidate
      aria-label="Something wrong?"
      className={cn(
        'flex flex-col gap-5',
        framed
          ? 'p-4 @md:p-5'
          : 'animate-in scroll-my-1 rounded-surface border border-input bg-background p-4 duration-(--dur-3) fade-in-0 slide-in-from-top-1',
      )}
      onSubmit={(e) => {
        e.preventDefault()
        send()
      }}
      onKeyDown={(e) => {
        if (framed && e.key === 'Escape' && !e.defaultPrevented && !typed) {
          e.preventDefault()
          onClose()
        }
        if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
          e.preventDefault()
          send()
        }
      }}
    >
      {framed ? (
        <YouAsked question={askedOf(answer)} />
      ) : (
        <p className="text-sm font-medium">Something wrong?</p>
      )}
      {canEdit && fact && (
        <div className="flex flex-col items-start gap-2 rounded-md border p-3 text-sm">
          <p>
            {me.owns.includes(domainId)
              ? `You own ${domain}: you can change the item yourself, and publish it.`
              : 'As an admin, you can change the item yourself, and publish it.'}
          </p>
          <Button
            type="button"
            variant="outline"
            onClick={() => navigate(`/context/${fact.id}/edit`)}
          >
            <PencilIcon data-icon="inline-start" />
            Edit “{fact.title}”
          </Button>
          {others.length > 0 && (
            <p className="text-muted-foreground">Or tell {listOf(others)} below.</p>
          )}
        </div>
      )}
      <FieldGroup className="gap-5">
        <FieldSet>
          <FieldLegend variant="label">Which part is wrong?</FieldLegend>
          <RadioGroup
            value={part}
            onValueChange={(v) => {
              setPart(v as string)
              setSuggesting(false)
              setWords('')
            }}
          >
            {facts.map((f, i) => (
              <Field key={f.id} orientation="horizontal">
                <RadioGroupItem value={f.id} id={`${formId}-part-${f.id}`} />
                <Label htmlFor={`${formId}-part-${f.id}`} className="font-normal">
                  {i + 1}. {f.title}
                </Label>
              </Field>
            ))}
            <Field orientation="horizontal">
              <RadioGroupItem value="answer" id={`${formId}-part-answer`} />
              <Label htmlFor={`${formId}-part-answer`} className="font-normal">
                The answer&apos;s wording
              </Label>
            </Field>
          </RadioGroup>
        </FieldSet>
        <Field data-invalid={problems.what ? true : undefined}>
          <FieldLabel htmlFor={`${formId}-what`}>What&apos;s wrong?</FieldLabel>
          <Textarea
            ref={whatRef}
            id={`${formId}-what`}
            value={what}
            maxLength={2000}
            onChange={(e) => {
              setWhat(e.target.value)
              setProblems((p) => ({ ...p, what: undefined }))
            }}
            aria-invalid={problems.what ? true : undefined}
            aria-describedby={problems.what ? `${formId}-what-problem` : undefined}
          />
          <FieldError id={`${formId}-what-problem`}>{problems.what}</FieldError>
        </Field>
        {forItem &&
          fact &&
          (suggesting ? (
            <Field>
              <FieldLabel htmlFor={`${formId}-words`}>The right words (a suggestion)</FieldLabel>
              <Textarea
                id={`${formId}-words`}
                value={words}
                maxLength={limits.summary}
                onChange={(e) => setWords(e.target.value)}
                aria-describedby={`${formId}-words-note`}
              />
              <p id={`${formId}-words-note`} className="text-xs text-muted-foreground">
                It waits as a suggestion on “{fact.title}”. Ask and agents keep the item as it is
                until an owner publishes it.
              </p>
            </Field>
          ) : (
            <Button
              type="button"
              variant="ghost"
              className="-ml-2 w-fit"
              onClick={() => {
                // It starts from the item's words, so the change is all the owners review.
                setWords(fact.summary)
                setSuggesting(true)
                requestAnimationFrame(() =>
                  document.getElementById(`${formId}-words`)?.focus({ preventScroll: false }),
                )
              }}
            >
              <PencilIcon data-icon="inline-start" />
              Suggest the right words
            </Button>
          ))}
        <Field data-invalid={problems.link ? true : undefined}>
          <FieldLabel htmlFor={`${formId}-link`}>Link (optional)</FieldLabel>
          <Input
            ref={linkRef}
            id={`${formId}-link`}
            value={link}
            inputMode="url"
            placeholder="https://"
            onChange={(e) => {
              setLink(e.target.value)
              setProblems((p) => ({ ...p, link: undefined }))
            }}
            aria-invalid={problems.link ? true : undefined}
            aria-describedby={problems.link ? `${formId}-link-problem` : undefined}
          />
          <FieldError id={`${formId}-link-problem`}>{problems.link}</FieldError>
        </Field>
      </FieldGroup>
      <p className="text-xs text-muted-foreground">
        Goes to {to}, with your name, your words and this question. Nothing else from this chat is
        kept.
      </p>
      {sending.problem && (
        <p role="alert" className="text-sm text-destructive">
          {sending.problem}
        </p>
      )}
      {!framed && <div className="flex flex-wrap justify-end gap-2">{buttons}</div>}
    </form>
  )
  if (!framed) return body
  return (
    <DockFrame title="Something wrong?" footer={buttons}>
      {body}
    </DockFrame>
  )
}
