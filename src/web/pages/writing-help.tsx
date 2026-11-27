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
import { DockFrame } from '@/components/dock'
import { TagChip } from '@/components/footnote/tag-chip'
import { Button } from '@/components/ui/button'
import { Kbd } from '@/components/ui/kbd'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { inputSurface } from '@/lib/surfaces'
import { cn } from '@/lib/utils'
import { askHelp, stopHelp, undoHelp, useHelp } from '@/lib/writing-help'
import { sessionFieldLabel } from '@/model/draft-session'
import {
  failedLine,
  HELP_NAME,
  keptLine,
  progressLine,
  readLine,
  refusedLine,
  stoppedByPersonLine,
  stoppedLine,
  type HelpTurn,
} from '@/model/writing-help'

// Writing help's dock beside the editor (Route 3, design B): the person says what happened or what
// to change, and sees the draft change beside it. The chat is what was said, what writing help
// replied, and under each reply the fields it changed, with Undo. It writes one draft: it has no
// Send, since sending is the page's own button, and nothing here rates or cites, as Ask does.

/** What the person said: clamped when it is a long paste, with a way to see all of it. */
function Said({ text }: { text: string }) {
  const [all, setAll] = React.useState(false)
  const long = text.length > 220 || text.split('\n').length > 3
  return (
    <div className="flex flex-col items-end gap-1">
      <div className="max-w-22/25 min-w-0 rounded-surface bg-muted px-4 py-2.5 text-base leading-chat">
        {/* Clamped inside the padding, so no part of a fourth line shows under the third. */}
        <p className={cn('wrap-anywhere whitespace-pre-line', long && !all && 'line-clamp-3')}>
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

/** The fields a turn changed, as chips, with Undo while its change is the one Undo takes back. */
function Changed({ turn, undoable }: { turn: HelpTurn; undoable: boolean }) {
  if (!turn.changed.length) return null
  return (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5">
      <span className="text-sm text-muted-foreground">Changed</span>
      <ul aria-label="Fields it changed" className="flex min-w-0 flex-wrap gap-1.5">
        {turn.changed.map((field) => (
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
            onClick={undoHelp}
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
}: {
  turn: HelpTurn
  latest: boolean
  busy: boolean
  undoable: boolean
}) {
  const again = latest && !busy ? () => void askHelp(turn.said) : undefined
  const reply = turn.reply
  const read = reply ? readLine(reply) : ''
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
              {stoppedLine(reply)}
            </Problem>
          )}
        </>
      )}
      {turn.state === 'stopped' && <Line>{stoppedByPersonLine(turn.changed)}</Line>}
      {turn.state === 'failed' && (
        <Problem {...(again ? { onAgain: again } : {})}>{failedLine(turn.problem)}</Problem>
      )}
      {turn.state !== 'asking' && <Changed turn={turn} undoable={undoable} />}
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
                <Button
                  key={answer}
                  variant="outline"
                  disabled={busy}
                  onClick={() => void askHelp(answer)}
                >
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

/** The box at the foot: Enter sends, Shift and Enter makes a new line, and Send becomes Stop. */
function Composer({ busy, first }: { busy: boolean; first: boolean }) {
  const [text, setText] = React.useState('')
  const box = React.useRef<HTMLTextAreaElement>(null)
  // A touch screen gets no automatic focus: the keyboard would cover the draft before anyone asked.
  const [touch] = React.useState(() => window.matchMedia('(pointer: coarse)').matches)
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
        autoFocus={!touch}
        rows={1}
        aria-label="Say something to writing help"
        aria-keyshortcuts="Enter"
        placeholder={
          first ? 'Paste a message or a link, or say what happened' : 'Tell me what to change'
        }
        className="field-sizing-content max-h-48 min-h-10 w-full resize-none bg-transparent px-4 pt-3 pb-1 text-base leading-6 outline-none placeholder:text-muted-foreground"
      />
      <div className="flex h-11 items-center justify-end px-2">
        {/* Send and Stop share one slot, so Stop is where Send was while a turn runs. */}
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
                  aria-label="Send"
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
                Send <Kbd>Enter</Kbd> - new line <Kbd>Shift</Kbd>+<Kbd>Enter</Kbd>
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
  const end = React.useRef<HTMLDivElement>(null)
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
  if (!help.there)
    return (
      <DockFrame title={HELP_NAME}>
        <p className="p-4 text-sm text-muted-foreground md:p-5">
          {HELP_NAME} works on a draft that is open. Open a draft, or start one from Write context.
        </p>
      </DockFrame>
    )
  return (
    <DockFrame
      title={HELP_NAME}
      foot={
        <div className="px-4 pt-3 pb-4">
          <Composer busy={help.busy} first={help.turns.length === 0} />
        </div>
      }
    >
      <div data-touch-targets className="flex min-h-full flex-col gap-6 px-4 pt-6 pb-6">
        <div className="flex items-center gap-2 rounded-surface border border-dashed border-input px-3 py-2 text-sm">
          <SparklesIcon className="size-4 shrink-0 text-muted-foreground" aria-hidden />
          Works on your draft only. Agents don't get it yet.
        </div>
        {help.turns.length === 0 ? (
          <div className="flex flex-col gap-2 text-sm text-muted-foreground">
            <p>
              Paste a message or a link, or say what happened. {HELP_NAME} writes it into the draft,
              and you check each field.
            </p>
            <p>Your draft and what you write here go to the AI model set for Ask.</p>
          </div>
        ) : (
          // A log, so a screen reader hears each reply arrive.
          <div role="log" aria-label={HELP_NAME} className="flex flex-col gap-8">
            {help.turns.map((turn, i) => (
              <Turn
                key={turn.id}
                turn={turn}
                latest={i === help.turns.length - 1}
                busy={help.busy}
                undoable={help.latest?.turn === turn.id}
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
