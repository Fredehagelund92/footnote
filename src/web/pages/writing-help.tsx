import * as React from 'react'
import {
  ArrowUpIcon,
  CircleAlertIcon,
  LinkIcon,
  Loader2Icon,
  RefreshCwIcon,
  SparklesIcon,
  SquareIcon,
  Undo2Icon,
} from '@/components/icons'
import { useSession, useWorkspace } from '@/api/queries'
import { DockFrame } from '@/components/dock'
import { PublicGuideLink } from '@/components/footnote/guide-link'
import { TagChip } from '@/components/footnote/tag-chip'
import { Button } from '@/components/ui/button'
import { Kbd } from '@/components/ui/kbd'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { useIsMobile } from '@/hooks/use-mobile'
import { isTyping } from '@/lib/keys'
import { href } from '@/lib/router'
import { inputSurface } from '@/lib/surfaces'
import { cn } from '@/lib/utils'
import { askHelp, stopHelp, undoHelp, useHelp, type HelpOpening } from '@/lib/writing-help'
import { useMe } from '@/lib/workspace'
import { sessionFieldLabel } from '@/model/draft-session'
import {
  failedLine,
  HELP_NAME,
  keptLine,
  landedFields,
  progressLine,
  readLine,
  refusedLine,
  stoppedByPersonLine,
  stoppedLine,
  suggestedLine,
  unavailableLine,
  type HelpTurn,
} from '@/model/writing-help'

// Writing help's dock beside the editor (Route 3, design B): the person says what happened or what
// to change, and sees the draft change beside it. The chat is what was said, what writing help
// replied, and under each reply the fields it changed, with Undo. It writes one draft: it has no
// Send, since sending is the page's own button, and its arrow is Say it. Nothing here rates or
// cites, as Ask does. A new item opens with it beside the editor, its box ready for the first words.

/**
 * What the person said: clamped at three lines when it is a long paste, with a way to see all of
 * it. Long is measured as it is drawn, since the dock's width and a link decide where lines break.
 */
function Said({ text }: { text: string }) {
  const [all, setAll] = React.useState(false)
  const [long, setLong] = React.useState(false)
  const words = React.useRef<HTMLParagraphElement>(null)
  React.useLayoutEffect(() => {
    const el = words.current
    if (!el || all) return
    const measure = () => setLong(el.scrollHeight > el.clientHeight + 1)
    measure()
    const watch = new ResizeObserver(measure)
    watch.observe(el)
    return () => watch.disconnect()
  }, [all, text])
  return (
    <div className="flex flex-col items-end gap-1">
      <div className="max-w-22/25 min-w-0 rounded-surface bg-muted px-4 py-2.5 text-base leading-chat">
        {/* Clamped inside the padding, so no part of a fourth line shows under the third. */}
        <p ref={words} className={cn('wrap-anywhere whitespace-pre-line', !all && 'line-clamp-3')}>
          {text}
        </p>
      </div>
      {long && (
        <Button
          variant="link"
          className="h-auto px-0 text-sm"
          aria-expanded={all}
          onClick={() => setAll((v) => !v)}
        >
          {all ? 'Show less' : 'Show all'}
        </Button>
      )}
    </div>
  )
}

/** A quiet line of a turn: what it read, what it kept, why a field is as it was. */
function Line({ icon, children }: { icon?: React.ReactNode; children: React.ReactNode }) {
  return (
    <p className="flex items-start gap-2 text-sm text-muted-foreground [&>svg]:mt-0.5 [&>svg]:size-3.5 [&>svg]:shrink-0">
      {icon}
      <span className="min-w-0">{children}</span>
    </p>
  )
}

/** What went wrong with a turn, with a way to say the same again where that can help. */
function Problem({ children, onAgain }: { children: React.ReactNode; onAgain?: () => void }) {
  return (
    <div
      role="alert"
      className="flex flex-wrap items-center gap-x-3 gap-y-2 text-sm text-muted-foreground"
    >
      <span className="flex min-w-0 items-start gap-2">
        <CircleAlertIcon className="mt-0.5 size-3.5 shrink-0" aria-hidden />
        <span className="min-w-0">{children}</span>
      </span>
      {onAgain && (
        <Button variant="outline" onClick={onAgain}>
          <RefreshCwIcon data-icon="inline-start" />
          Try again
        </Button>
      )}
    </div>
  )
}

/**
 * The fields a turn changed, as chips, with Undo while its change is the one Undo takes back. A
 * field whose words wait under the person's own is not one of them: the draft still says theirs.
 */
function Changed({
  turn,
  undoable,
  onUndo,
}: {
  turn: HelpTurn
  undoable: boolean
  onUndo: () => void
}) {
  const changed = landedFields(turn)
  if (!changed.length) return null
  return (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5">
      <span className="text-sm text-muted-foreground">Changed</span>
      <ul aria-label="Fields it changed" className="flex min-w-0 flex-wrap gap-1.5">
        {changed.map((field) => (
          <li key={field} className="flex min-w-0">
            <TagChip>{sessionFieldLabel[field]}</TagChip>
          </li>
        ))}
      </ul>
      {turn.undone ? (
        <span className="text-sm text-muted-foreground">Undone</span>
      ) : (
        undoable && (
          <Button
            variant="link"
            className="h-6 px-0 text-muted-foreground hover:text-foreground"
            onClick={() => {
              undoHelp()
              onUndo()
            }}
          >
            <Undo2Icon data-icon="inline-start" />
            Undo
          </Button>
        )
      )}
    </div>
  )
}

function Turn({
  turn,
  latest,
  busy,
  undoable,
  focusBox,
}: {
  turn: HelpTurn
  latest: boolean
  busy: boolean
  undoable: boolean
  focusBox: () => void
}) {
  // A button that leaves the page when pressed hands the keyboard to the box, not to the body.
  const ask = (words: string) => {
    void askHelp(words)
    focusBox()
  }
  const again = latest && !busy ? () => ask(turn.said) : undefined
  const reply = turn.reply
  const read = reply ? readLine(reply) : ''
  const changed = landedFields(turn)
  return (
    <div className="flex flex-col gap-y-3">
      <Said text={turn.said} />
      {turn.state === 'asking' && (
        <>
          <Line icon={<Loader2Icon className="animate-spin" aria-hidden />}>
            {progressLine(turn.progress)}
          </Line>
          {turn.words && <p className="text-base leading-chat whitespace-pre-line">{turn.words}</p>}
        </>
      )}
      {reply && (
        <>
          {read && <Line icon={<LinkIcon aria-hidden />}>{read}</Line>}
          {reply.reply && (
            <p className="text-base leading-chat wrap-anywhere whitespace-pre-line">
              {reply.reply}
            </p>
          )}
          {reply.stopped && (
            <Problem
              {...(again && ['steps', 'time', 'model'].includes(reply.stopped)
                ? { onAgain: again }
                : {})}
            >
              {stoppedLine(reply, changed)}
            </Problem>
          )}
        </>
      )}
      {turn.state === 'stopped' && <Line>{stoppedByPersonLine(changed)}</Line>}
      {turn.state === 'failed' && (
        <Problem {...(again ? { onAgain: again } : {})}>
          {failedLine(turn.problem, changed)}
        </Problem>
      )}
      {/* Its words that wait under a field the person was writing in, said as it says the rest. */}
      {turn.suggested.length > 0 && (
        <p className="text-base leading-chat wrap-anywhere">{suggestedLine(turn.suggested)}</p>
      )}
      {turn.state !== 'asking' && <Changed turn={turn} undoable={undoable} onUndo={focusBox} />}
      {reply && reply.kept.length > 0 && <Line>{keptLine(reply.kept)}</Line>}
      {reply?.refused.map((refused) => (
        <Line key={refused.field}>{refusedLine(refused)}</Line>
      ))}
      {reply?.question && (
        <div className="flex flex-col gap-3">
          <p className="text-base leading-chat wrap-anywhere">{reply.question.text}</p>
          {latest && reply.question.answers.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {reply.question.answers.map((answer) => (
                <Button key={answer} variant="outline" disabled={busy} onClick={() => ask(answer)}>
                  {answer}
                </Button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

/**
 * What the card the person came from knew, then what it asks of them: a quiet line and a plain
 * one, at the top of the chat. It is no reply and cost no turn.
 */
function Opening({ opening }: { opening: HelpOpening }) {
  return (
    <div className="flex flex-col gap-1">
      <p className="text-sm text-muted-foreground">{opening.known}</p>
      <p className="text-base leading-chat wrap-anywhere">{opening.ask}</p>
    </div>
  )
}

/** The dashed line at the top of the dock: what it says, in the one box Try it has too. */
function Notice({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex items-start gap-2 rounded-surface border border-dashed border-input px-3 py-2 text-sm">
      <SparklesIcon className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />
      <span className="min-w-0">{children}</span>
    </div>
  )
}

/**
 * Where writing help is not there to ask, the dock says why in one line, with the guide or the
 * switch for an admin, and has no box.
 */
function Unavailable() {
  const { answeredBy } = useSession()
  const me = useMe()
  const line = unavailableLine({ model: answeredBy !== 'reader', admin: me.admin })
  return (
    <div className="px-4 pt-6 pb-6">
      <Notice>
        {line.text}
        {line.link?.to === 'model-guide' && (
          <>
            {' '}
            <PublicGuideLink slug="model-providers">{line.link.label}</PublicGuideLink>
          </>
        )}
        {line.link?.to === 'switch' && (
          <>
            {' '}
            <a
              href={href('/settings/advanced/writing-help')}
              className="text-primary underline underline-offset-4"
            >
              {line.link.label}
            </a>
          </>
        )}
      </Notice>
    </div>
  )
}

/** The box at the foot: Enter says it, Shift and Enter makes a new line, and Say it becomes Stop. */
function Composer({
  busy,
  first,
  box,
}: {
  busy: boolean
  first: boolean
  box: React.RefObject<HTMLTextAreaElement | null>
}) {
  const [text, setText] = React.useState('')
  // A touch screen gets no automatic focus: the keyboard would cover the draft before anyone asked.
  const [touch] = React.useState(() => window.matchMedia('(pointer: coarse)').matches)
  // Nor does it take the keyboard from a field of the draft: the dock opens a moment after Write
  // the draft, and by then the person may be writing in the title.
  React.useEffect(() => {
    if (!touch && !isTyping(document.activeElement)) box.current?.focus()
  }, [touch, box])
  const send = () => {
    if (busy || !text.trim()) return
    void askHelp(text)
    setText('')
  }
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault()
        send()
      }}
      onClick={(e) => e.target === e.currentTarget && box.current?.focus()}
      className={cn('flex w-full cursor-text flex-col', inputSurface)}
    >
      <textarea
        ref={box}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
            e.preventDefault()
            send()
          } else if (e.key === 'Escape' && busy) {
            e.preventDefault()
            stopHelp()
          }
        }}
        rows={1}
        aria-label="Say something to writing help"
        aria-keyshortcuts="Enter"
        placeholder={
          first ? 'Paste a message or a link, or say what happened' : 'Tell me what to change'
        }
        className="field-sizing-content max-h-48 min-h-10 w-full resize-none bg-transparent px-4 pt-3 pb-1 text-base leading-6 outline-none placeholder:text-muted-foreground"
      />
      <div className="flex h-11 items-center justify-end px-2">
        {/* Say it and Stop share one slot, so Stop is where Say it was while a turn runs. Send is
            the page's own word, in its header. */}
        <Tooltip>
          {busy ? (
            <TooltipTrigger
              render={
                <Button
                  type="button"
                  size="icon"
                  aria-label="Stop"
                  aria-keyshortcuts="Escape"
                  className="rounded-md bg-foreground text-background hover:bg-foreground/80"
                  onClick={stopHelp}
                />
              }
            >
              <SquareIcon className="size-2.5 fill-current" />
            </TooltipTrigger>
          ) : (
            <TooltipTrigger
              render={
                <Button
                  type="submit"
                  size="icon"
                  aria-label="Say it"
                  disabled={!text.trim()}
                  className="rounded-md"
                />
              }
            >
              <ArrowUpIcon />
            </TooltipTrigger>
          )}
          <TooltipContent>
            {busy ? (
              <>
                Stop <Kbd>Esc</Kbd>
              </>
            ) : (
              <>
                Say it <Kbd>Enter</Kbd> - new line <Kbd>Shift</Kbd>+<Kbd>Enter</Kbd>
              </>
            )}
          </TooltipContent>
        </Tooltip>
      </div>
    </form>
  )
}

/** Writing help, in the dock beside the draft it works on. */
export function WritingHelpDock() {
  const help = useHelp()
  const mobile = useIsMobile()
  const workspace = useWorkspace()
  const end = React.useRef<HTMLDivElement>(null)
  const box = React.useRef<HTMLTextAreaElement>(null)
  const focusBox = () => box.current?.focus()
  const last = help.turns.at(-1)
  // What arrives stays in view: the latest turn's end, as it grows.
  React.useEffect(() => {
    end.current?.scrollIntoView({ block: 'end' })
  }, [help.turns.length, last?.state, last?.words, last?.changed.length, last?.progress])
  const status =
    last?.state === 'asking'
      ? `${HELP_NAME} is working.`
      : last?.state === 'done'
        ? `${HELP_NAME} is done.`
        : last?.state === 'stopped'
          ? 'Stopped.'
          : ''
  // A phone has no dock beside a page, so no writing help: a link to it opened there says so.
  // Where an admin has not turned it on, or no model is connected, the dock says that instead.
  if (!mobile && !workspace.writingHelp)
    return (
      <DockFrame title={HELP_NAME}>
        <Unavailable />
      </DockFrame>
    )
  if (mobile || !help.there)
    return (
      <DockFrame title={HELP_NAME}>
        <p className="p-4 text-sm text-muted-foreground md:p-5">
          {mobile
            ? `${HELP_NAME} is on a computer or tablet.`
            : `${HELP_NAME} works on a draft that is open. Open a draft, or start one from Write context.`}
        </p>
      </DockFrame>
    )
  return (
    <DockFrame
      title={HELP_NAME}
      foot={
        <div className="px-4 pt-3 pb-4">
          <Composer busy={help.busy} first={help.turns.length === 0} box={box} />
        </div>
      }
    >
      <div data-touch-targets className="flex min-h-full flex-col gap-6 px-4 pt-6 pb-6">
        <Notice>
          Your draft and what you write here go to the AI model set for Ask. Agents don't get it
          yet.
        </Notice>
        {help.opening ? (
          <Opening opening={help.opening} />
        ) : (
          help.turns.length === 0 && (
            <p className="text-sm text-muted-foreground">
              {HELP_NAME} fills in the draft. You check each field, then send or publish it
              yourself.
            </p>
          )
        )}
        {help.turns.length > 0 && (
          // A log, so a screen reader hears each reply arrive.
          <div role="log" aria-label={HELP_NAME} className="flex flex-col gap-8">
            {help.turns.map((turn, i) => (
              <Turn
                key={turn.id}
                turn={turn}
                latest={i === help.turns.length - 1}
                busy={help.busy}
                undoable={help.latest?.turn === turn.id}
                focusBox={focusBox}
              />
            ))}
          </div>
        )}
        <div ref={end} />
      </div>
      {/* Always there, so a screen reader hears it change: working, done, stopped. */}
      <p role="status" className="sr-only">
        {status}
      </p>
    </DockFrame>
  )
}
