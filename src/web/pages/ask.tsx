import * as React from 'react'
import {
  EllipsisIcon,
  HistoryIcon,
  Link2Off,
  MessageSquareIcon,
  PanelLeftCloseIcon,
  PanelLeftOpenIcon,
  PencilIcon,
  SearchIcon,
  ShareIcon,
  SquarePenIcon,
  Trash2Icon,
  XIcon,
} from '@/components/icons'
import { toast } from '@/lib/toast'
import { api } from '@/api'
import { ASK_ANCHOR, ASK_ROOM_GAP_PX } from '@/lib/ask-motion'
import { toApiError } from '@/api/errors'
import { cn } from '@/lib/utils'
import { DockFrame } from '@/components/dock'
import { AnswerBody, DraftBanner, Question } from '@/components/footnote/answer'
import { ResizableAside } from '@/components/resizable-aside'
import { SiteHeader } from '@/components/site-header'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'
import { Kbd } from '@/components/ui/kbd'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import {
  askedWeekQuery,
  askQuery,
  chatSharesQuery,
  useAskExamples,
  useInbox,
  useSession,
  useWrite,
} from '@/api/queries'
import type { ChosenPeriodInput } from '@contract/answer'
import { chatTurnOf, type Answer, type AskInput, type QuestionPart } from '@/model/ask'
import {
  firstRead,
  NOT_KEPT,
  notKept,
  keptAnswers,
  nextTurnId,
  openingAnswers,
  openingQuestion,
  placeOf,
  reduce,
  sessionOf,
  type Join,
  type Place,
  type Session,
} from '@/model/ask-session'
import {
  askedTurn,
  doneTurn,
  effectsOf,
  isLive,
  outcomeOf,
  outcomeOfAnswer,
  turnReducer,
  unansweredIn,
  type Outcome,
  type Turn,
  type TurnAction,
} from '@/model/ask-turn'
import { isOnline } from '@/lib/send'
import type { AskQuestion, ComposerHandle } from '@/pages/ask-composer'
import type * as LiftMotion from '@/lib/lift-motion'
import type { Fact } from '@/model/items'
import { useDraft } from '@/lib/draft'
import { useOpeningRead } from '@/lib/opening-read'
import { useIsMobile, useMedia } from '@/hooks/use-mobile'
import { useWide } from '@/hooks/use-wide'
import { readWidth, saveWidth } from '@/lib/pane-width'
import { openDock, useDock, useTyped } from '@/lib/dock'
import { dayMonth } from '@/lib/dates'
import { linksByChat, sharedChatPath, type ChatLinks } from '@/model/shared-chat'
import { navigate, setQuery, useRoute } from '@/lib/router'
import { composerSurface } from '@/lib/surfaces'
import { useThreadActions, useThreads, type Day, type Thread } from '@/lib/threads'
import { TruncatedText } from '@/components/footnote/truncated'
import { AskedThisWeek, StateLegend } from '@/components/footnote/asked-week'
import { Answering, Suggestions } from '@/components/footnote/suggestions'
import { useToastFloor } from '@/lib/toast-floor'
import { arriveRef, leaveThen, useLeaving } from '@/lib/presence'
import { asksAgain } from '@domain/ask-again'
import { fitChat } from '@domain/ask-chat'

// Ask, drawn like assistant-ui's thread inside the Efferd shell: a thread history on the left, a
// calm centred thread at reading width, and a composer docked to the bottom edge. A question shows
// the moment it is sent; its answer follows the look-up as it runs, the words a sentence at a time.

/** What a chat passes on to the next question: the turns its outcome carries, within the caps. */
const chatFrom = (turns: readonly Turn[]) =>
  fitChat(
    turns.flatMap((turn) => {
      const outcome = outcomeOf(turn)
      const carried = outcome && effectsOf(outcome).carried ? chatTurnOf(turn.answer) : undefined
      return carried ? [carried] : []
    }),
  )

/** The words a turn asked: the ones it repeated, when it was asked again in words. */
const askedWords = ({ again, question, parts, scope }: Answer) =>
  again ?? { question, parts, scope }

/** What a turn asks when it is asked again: the same words, with the chat before it. */
const askAgainInput = (turns: readonly Turn[], i: number): AskInput => {
  const { answer } = turns[i]!
  const { question, parts, scope } = askedWords(answer)
  const chat = chatFrom(turns.slice(0, i))
  return {
    question,
    parts,
    scope,
    ...(answer.period ? { period: answer.period } : {}),
    ...(chat.length ? { turns: chat } : {}),
  }
}

const reducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches

/** How near the bottom, in pixels, the reader counts as at the bottom: the view follows the answer (`ASK_ANCHOR` follow). */
const FOLLOW_SLACK = 24

/** How wide, in pixels, a pane holds the box under the question until the first question. */
const LIFT_MIN = 640

/** What the empty Ask says of who answers: one line in the Ask column. */
const answeredBySaid: Record<ReturnType<typeof useSession>['answeredBy'], string> = {
  model: 'Answers come from what your team wrote and an owner checked.',
  reader: 'No AI model is connected, so answers list what your team wrote and an owner checked.',
  preview: 'A design preview: answers are made in this browser, with no service and no AI model.',
}

const AskComposer = React.lazy(() =>
  import('@/pages/ask-composer').then((m) => ({ default: m.AskComposer })),
)

/** The box as it looks before its editor has loaded, so nothing shifts when it arrives. */
function ComposerPlaceholder({ placeholder }: { placeholder: string }) {
  return (
    <div aria-hidden className={cn('flex w-full flex-col', composerSurface)}>
      <div className="min-h-10 px-4 pt-3 pb-1 text-base leading-6 text-muted-foreground">
        {placeholder}
      </div>
      <div className="h-11" />
    </div>
  )
}

export function AskChat({
  initial,
  failedOpening,
  draft,
  compact,
  prefill,
  onAnswered,
  onExample,
  onTurns,
  onAnswers,
}: {
  initial?: Answer[]
  /**
   * A chat that opens on no answer: its question, and the line that says why (its first answer
   * could not be read, or none was kept). It shows unanswered, to ask again.
   */
  failedOpening?: { question: string; line: string }
  draft?: Fact
  compact?: boolean
  /** A question typed into the box, waiting to be sent. */
  prefill?: string
  /** A turn was answered, however it was asked: its question, so the chat can join the history. */
  onAnswered?: (question: string) => void
  /** An example's question opens that example instead of being asked; true when it did. */
  onExample?: (question: string) => boolean
  /** Everything this chat has asked and answered so far, so the history search finds it. */
  onTurns?: (text: string) => void
  /** The chat's kept answers once none is on its way, to keep with it. */
  onAnswers?: (answers: Answer[]) => void
}) {
  const [turns, setTurns] = React.useState<Turn[]>(() =>
    failedOpening
      ? [
          {
            ...askedTurn('t0', failedOpening.question),
            error: failedOpening.line,
          },
        ]
      : (initial ?? []).map(doneTurn),
  )
  /** One more event for the turn `id`. */
  const update = (id: string, action: TurnAction) =>
    setTurns((ts) => ts.map((t) => (t.answer.id === id ? turnReducer(t, action) : t)))
  const viewport = React.useRef<HTMLDivElement>(null)

  // The turn whose last words are still on their way to the screen, after its answer is in: Stop
  // and Escape stay until the last word shows.
  const [revealing, setRevealing] = React.useState<string | null>(null)
  const onRevealing = React.useCallback(
    (id: string, on: boolean) => setRevealing((r) => (on ? id : r === id ? null : r)),
    [],
  )
  const busy = turns.some(isLive) || revealing !== null
  // One question at a time, as in any chat: from the moment one is sent until its answer is in (or
  // has failed, or was stopped), nothing else is asked. The ref holds it at once, before React shows
  // it: a second click in the same moment finds it held.
  const [waiting, setWaiting] = React.useState(false)
  // Whether a question was sent in this thread, as opposed to a chat only opened.
  const [askedHere, setAskedHere] = React.useState(false)
  const sending = React.useRef(false)
  const answering = waiting || busy
  /** Runs one send, unless another is under way or an answer is still being written. */
  const one = async (send: () => Promise<void>) => {
    if (sending.current || busy) return
    sending.current = true
    setWaiting(true)
    setAskedHere(true)
    try {
      await send()
    } finally {
      sending.current = false
      setWaiting(false)
    }
  }
  // While an answer is written the view follows it down, only while the reader is at the bottom
  // (`ASK_ANCHOR` follow). Anchored at the top, the view stays where the reader put it.
  const follow = React.useRef(true)

  /** Brings a finished answer fully into view, down to its action row, above the composer. */
  const reveal = (id: string) =>
    ASK_ANCHOR === 'follow' &&
    requestAnimationFrame(() => {
      const box = viewport.current
      const el = box?.querySelector<HTMLElement>(`[data-turn-id="${id}"]`)
      if (!box || !el || !follow.current) return
      const below = el.getBoundingClientRect().bottom - box.getBoundingClientRect().bottom + 16
      if (below > 0) box.scrollBy({ top: below, behavior: reducedMotion() ? 'auto' : 'smooth' })
    })

  // The answer being written, which Stop ends: the look-up's request, and the model's call with it.
  const live = React.useRef<AbortController | null>(null)
  // The turn asked last, which the status line speaks for.
  const [current, setCurrent] = React.useState<string | null>(null)
  React.useEffect(() => () => live.current?.abort(), [])

  // Stop cancels: the answer keeps what it showed, says it isn't finished, and that comes into view.
  const stop = () => {
    const turn = turns.find(isLive) ?? turns.find((t) => t.answer.id === revealing)
    if (!turn) return
    live.current?.abort()
    update(turn.answer.id, { type: 'stop' })
    follow.current = true
    reveal(turn.answer.id)
    keepFocus()
  }

  /**
   * The answer to one turn, its events going to the turn as they come, and how the turn ended: the
   * answer once it is in, or none when it was stopped.
   */
  const answerTurn = async (
    id: string,
    input: AskInput,
  ): Promise<{ answer: Answer | null; outcome: Outcome }> => {
    setCurrent(id)
    const controller = new AbortController()
    live.current = controller
    try {
      const answer = await api.ask(input, {
        signal: controller.signal,
        onEvent: (event) => update(id, event),
      })
      update(id, { type: 'done', answer })
      reveal(id)
      return { answer, outcome: outcomeOfAnswer(answer) }
    } catch (error) {
      if (controller.signal.aborted)
        return { answer: null, outcome: { kind: 'stopped', answered: false } }
      throw error
    } finally {
      if (live.current === controller) live.current = null
    }
  }

  const composer = React.useRef<ComposerHandle>(null)
  // A touch screen gets no automatic focus: the keyboard would cover the page before anyone asked for it.
  const [touch] = React.useState(() => window.matchMedia('(pointer: coarse)').matches)
  // Ask and Stop take each other's place: focus stays in the box rather than leaving with them.
  function keepFocus() {
    if (!touch) composer.current?.focus()
  }
  // On a pane wide enough, an empty chat has its box under the question, lifted a little; the first
  // question docks it to the bottom edge, where a phone keeps it all along.
  const [pane, wide] = useWide<HTMLDivElement>(LIFT_MIN)
  const up = wide && !compact && turns.length === 0
  const dock = React.useRef<HTMLDivElement>(null)
  // Docked at the foot, the box is a floor toasts stay above.
  const floor = useToastFloor<HTMLDivElement>()
  const docked = React.useCallback(
    (el: HTMLDivElement | null) => {
      dock.current = el
      return floor(el)
    },
    [floor],
  )
  const lifted = React.useRef<number | null>(null)
  // The motion's code comes while the box is up, ready for the first question.
  const motion = React.useRef<typeof LiftMotion>(null)
  React.useEffect(() => {
    if (up) void import('@/lib/lift-motion').then((m) => (motion.current = m))
  }, [up])
  React.useLayoutEffect(() => {
    const from = lifted.current
    lifted.current = null
    const el = dock.current
    if (up || from === null || !el || reducedMotion()) return
    motion.current?.dockFrom(el, from)
  }, [up])
  const { fresh, answeredBy } = useSession()
  const examples = useAskExamples()
  // What agents asked this week; with nothing asked yet (a new workspace), its starters instead.
  const week = useQuery(askedWeekQuery()).data
  const starters = examples.filter((e) => e.starter).map((e) => e.question)
  const queryClient = useQueryClient()
  // A first answer opens again on its question alone: a question with no mentions gets the same
  // answer, so it is kept for that, and opening the chat again looks nothing up.
  const remember = (
    index: number,
    { question, parts, scope }: Pick<Answer, 'question' | 'parts' | 'scope'>,
    answer: Answer,
  ) => {
    if (index === 0 && !scope?.length && (parts ?? []).every((p) => typeof p === 'string'))
      queryClient.setQueryData(askQuery({ question }).queryKey, answer)
  }
  const add = (asked: string | AskQuestion, period?: ChosenPeriodInput) => {
    // Where the box was, under the question, so it moves from there to the bottom edge.
    if (up) lifted.current = dock.current?.getBoundingClientRect().top ?? null
    return one(async () => {
      const {
        text: q,
        parts,
        scope,
      } = typeof asked === 'string' ? { text: asked, parts: undefined, scope: [] } : asked
      const index = turns.length
      const id = nextTurnId(turns)
      follow.current = true
      // A draft's answer is the draft's own, written here: it is there at once.
      if (draft && initial?.[0]) {
        setTurns((ts) => [...ts, doneTurn({ ...initial[0]!, id, question: q, parts })])
        reveal(id)
        return
      }
      // An example's question, typed or picked, opens the example. Any other is asked here, one that
      // is already a chat too: once answered it joins that chat, so the history never has it twice.
      if (index === 0 && onExample?.(q)) return
      // "Try again" asks the last question again, as Ask again does, with no model in between.
      const repeats = asksAgain(q) ? turns.length - 1 : -1
      const again = repeats < 0 ? null : askAgainInput(turns, repeats)
      const repeated = repeats < 0 ? null : askedWords(turns[repeats]!.answer)
      // A follow-up carries the chat's last answered turns; they stay in the browser (FR-717).
      const chat = chatFrom(turns)
      // The question is in the chat at once; its answer follows as the look-up runs.
      setTurns((ts) => [
        ...ts,
        askedTurn(
          id,
          q,
          repeated
            ? {
                again: repeated,
                scope: repeated.scope,
                ...(again?.period ? { period: again.period } : {}),
              }
            : { parts, scope, ...(period ? { period } : {}) },
        ),
      ])
      keepFocus()
      // Any answered turn can start the chat in the history, once; the session says whether it does.
      const words = repeated?.question ?? q
      const join = () => onAnswered?.(words)
      try {
        const { answer, outcome } = await answerTurn(
          id,
          again ?? {
            question: q,
            parts,
            scope,
            ...(chat.length ? { turns: chat } : {}),
            ...(period ? { period } : {}),
          },
        )
        // Not checked stays in the chat, with Ask again, and leaves the chat as it was.
        if (!answer || !effectsOf(outcome).joins) return
        join()
        remember(index, { question: words, parts, scope }, answer)
      } catch (e) {
        // Nothing came back: the question stays in the chat, saying so, with Ask again.
        update(id, {
          type: 'error',
          message: unansweredIn(toApiError(e).message, isOnline()),
        })
      }
    })
  }

  // "Change it" under a misread question: the question goes back in the box with what it was read as, as chips to keep or swap.
  const rescope = (parts: QuestionPart[]) => composer.current?.set(parts)
  // A period chosen on the read line asks the same words again, read at that period.
  const reperiod = (answer: Answer) => (period: ChosenPeriodInput) => {
    const { question, parts, scope } = askedWords(answer)
    void add({ text: question, parts: parts ?? [question], scope: scope ?? [] }, period)
  }

  // Ask again asks the same question again; a check that failed reads it afresh, since the failure was the check's.
  const retry = (i: number) => () => void askAgain(i)
  const askAgain = (i: number) =>
    one(async () => {
      const before = turns[i]!
      const { question, parts, scope, id, again, period } = before.answer
      follow.current = true
      setTurns((ts) =>
        ts.map((t, j) => (j === i ? askedTurn(id, question, { parts, scope, again, period }) : t)),
      )
      const words = askedWords(before.answer)
      /** The answer it had comes back. */
      const restore = () => setTurns((ts) => ts.map((t, j) => (j === i ? before : t)))
      try {
        const { answer, outcome } = await answerTurn(id, askAgainInput(turns, i))
        if (effectsOf(outcome).restores) {
          restore()
          if (answer) toast("Couldn't ask that again", { description: answer.note })
          return
        }
        if (!answer) return
        onAnswered?.(words.question)
        remember(i, words, answer)
      } catch (e) {
        restore()
        toast("Couldn't ask that again", { description: toApiError(e).message })
      }
    })

  // "/" puts the cursor in the box from anywhere on the page that isn't a text field.
  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement
      if (
        e.key !== '/' ||
        e.metaKey ||
        e.ctrlKey ||
        t.closest('input, textarea, [contenteditable=true]')
      )
        return
      e.preventDefault()
      composer.current?.focus()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  // Escape stops an answer being written, unless something open (a menu, the @ list) takes it first.
  React.useEffect(() => {
    if (!busy) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented) return
      stop()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  // A long answer stays in view as it is written: its last line follows the bottom edge, while the
  // reader is at the bottom. Scrolling up to read stops that; scrolling back down starts it again.
  const content = React.useRef<HTMLDivElement>(null)
  React.useEffect(() => {
    const box = viewport.current
    const inner = content.current
    if (ASK_ANCHOR !== 'follow' || !box || !inner || !busy) return
    let last = box.scrollTop
    const onScroll = () => {
      const bottom = box.scrollHeight - box.scrollTop - box.clientHeight <= FOLLOW_SLACK
      // Following only ever scrolls down: a scroll up is the reader's.
      if (bottom) follow.current = true
      else if (box.scrollTop < last) follow.current = false
      last = box.scrollTop
    }
    const ro = new ResizeObserver(() => {
      const turn = turns.find(isLive)
      const el = turn && box.querySelector<HTMLElement>(`[data-turn-id="${turn.answer.id}"]`)
      if (!follow.current || !el) return
      const below = el.getBoundingClientRect().bottom - box.getBoundingClientRect().bottom + 16
      if (below > 0) box.scrollBy({ top: below })
    })
    ro.observe(inner)
    box.addEventListener('scroll', onScroll, { passive: true })
    return () => {
      ro.disconnect()
      box.removeEventListener('scroll', onScroll)
    }
  }, [busy, turns])

  // What a screen reader hears of the answer asked last: that it started, finished or stopped. The
  // words themselves arrive in the log a sentence at a time.
  const asked = turns.find((t) => t.answer.id === current)
  const status = !asked
    ? ''
    : asked.stopped
      ? 'Stopped. The answer is not finished.'
      : asked.error
        ? asked.error
        : asked.stage === 'done'
          ? 'Answer written.'
          : asked.answered || asked.words
            ? 'Writing the answer.'
            : 'Looking up the answer.'

  // Anchored at the top, the newest question keeps room under it, the view's height less a little,
  // so it can reach the top while its answer is still short.
  const [room, setRoom] = React.useState(0)
  React.useEffect(() => {
    const box = viewport.current
    if (ASK_ANCHOR !== 'top' || !box) return
    const ro = new ResizeObserver(() => setRoom(box.clientHeight))
    ro.observe(box)
    return () => ro.disconnect()
  }, [])

  // What the chat holds, for the history search.
  const said = turns.map((t) => `${t.answer.question} ${t.answer.text}`).join(' ')
  React.useEffect(() => onTurns?.(said), [said, onTurns])
  // Once no turn is on its way, the chat keeps the turns whose outcome is kept, so it opens again as
  // it was. A turn asked here is what makes it worth keeping: a chat only opened is left as it is.
  const kept = React.useMemo(() => keptAnswers(turns), [turns])
  React.useEffect(() => {
    if (kept && askedHere) onAnswers?.(kept)
  }, [kept, askedHere, onAnswers])

  // A new question scrolls to the top of the view, so the answer arrives under it.
  const count = turns.length
  React.useEffect(() => {
    if (!count) return
    const el = viewport.current?.querySelector<HTMLElement>(`[data-turn="${count - 1}"]`)
    el?.scrollIntoView({ block: 'start', behavior: reducedMotion() ? 'auto' : 'smooth' })
  }, [count])

  const width = compact ? 'max-w-none px-4' : 'max-w-176 px-4'
  // Under 480 px the long placeholder is cut off: a phone gets a short one.
  const narrow = useMedia('(max-width: 479px)')
  const placeholder = draft
    ? 'Ask another question against the draft'
    : narrow
      ? 'Ask about a number'
      : 'Ask what is written about a number, or why it moved'

  // What agents asked this week; a new workspace, with nothing asked yet, gets its starters instead.
  const start = draft ? null : fresh || (week && !week.rows.length) ? (
    <Suggestions grid items={starters.slice(0, 4)} onPick={(q) => void add(q)} />
  ) : (
    <AskedThisWeek onPick={(q) => void add(q)} />
  )

  return (
    <Answering value={answering}>
      {/* Lifted, the whole page scrolls: the question, the box under it and what was asked. */}
      <div
        ref={pane}
        data-touch-targets
        className={cn(
          '@container flex h-full min-h-0 flex-col',
          up && 'scrollbar-stable overflow-y-auto',
        )}
      >
        {/* Positioned, so what is placed inside a turn (a citation's screen-reader words) stays in
            this scroll box and never makes the page around it taller. */}
        <div
          ref={viewport}
          data-thread
          className={cn(
            'relative',
            up ? 'shrink-0' : 'min-h-0 flex-1 scrollbar-stable overflow-y-auto',
          )}
        >
          <div ref={content} className={cn('mx-auto flex min-h-full w-full flex-col', width)}>
            {turns.length === 0 ? (
              <div
                className={cn(
                  'flex flex-1 flex-col gap-5 pt-8 sm:pt-ask-greeting',
                  up ? 'pb-1' : 'pb-10',
                )}
              >
                <div className="px-2 text-center">
                  <h2 className="text-2xl font-medium tracking-tight text-balance">
                    What do you want to know about your metrics?
                  </h2>
                  <p className="mt-2 text-sm text-balance text-muted-foreground">
                    {answeredBySaid[answeredBy]}
                  </p>
                </div>
                {!up && start}
              </div>
            ) : (
              // A log, so a screen reader hears each answer arrive.
              <div
                role="log"
                aria-label="Questions and answers"
                className="flex flex-col gap-y-12 pt-6 pb-10"
              >
                {draft && <DraftBanner />}
                {turns.map((t, i) => (
                  <div
                    key={t.answer.id}
                    data-turn={i}
                    data-turn-id={t.answer.id}
                    className="flex scroll-mt-4 flex-col gap-y-2.5"
                    style={
                      i === turns.length - 1 && room
                        ? { minHeight: room - ASK_ROOM_GAP_PX }
                        : undefined
                    }
                  >
                    <Question
                      answer={t.answer}
                      onRescope={draft ? undefined : rescope}
                      onReperiod={draft ? undefined : reperiod(t.answer)}
                      onEdit={draft ? undefined : (parts) => composer.current?.set(parts)}
                    />
                    <AnswerBody
                      key={t.asked}
                      turn={t}
                      draft={draft}
                      docked={compact}
                      onRetry={retry(i)}
                      {...(i === turns.length - 1 ? { onAsk: (q: string) => void add(q) } : {})}
                      onRevealing={onRevealing}
                      latest={i === turns.length - 1}
                    />
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
        {/* Always there, so a screen reader hears it change: started, written, stopped. */}
        <p role="status" className="sr-only">
          {status}
        </p>
        {/* Docked to the bottom edge, part of the frame: a hairline above, the box at reading width.
            Lifted, it sits under the question with a soft shadow and the states' legend under it. */}
        <div
          ref={docked}
          data-dock
          className={cn('shrink-0 bg-background', up ? 'pt-5' : 'border-t')}
        >
          <div className={cn('mx-auto flex w-full flex-col gap-2 pt-3 pb-4', width)}>
            <div
              className={cn(
                'rounded-composer transition-shadow duration-(--dur-3)',
                up && 'shadow-lift',
              )}
            >
              <React.Suspense fallback={<ComposerPlaceholder placeholder={placeholder} />}>
                <AskComposer
                  ref={composer}
                  onSubmit={(q) => void add(q)}
                  onStop={stop}
                  busy={busy}
                  waiting={waiting}
                  placeholder={placeholder}
                  prefill={prefill}
                  autoFocus={(turns.length === 0 || !!prefill) && !touch}
                />
              </React.Suspense>
            </div>
            {up && <StateLegend />}
          </div>
        </div>
        {up && start && <div className={cn('mx-auto w-full pt-6 pb-10', width)}>{start}</div>}
      </div>
    </Answering>
  )
}

/* ---------- the chats ---------- */

const DAYS: Day[] = ['Today', 'Yesterday', 'Earlier']
const HISTORY_KEY = '⌥H'

/** Starts an empty chat: a new `n` gives the thread a fresh start. */
const startChat = () => setQuery({ example: undefined, chat: undefined, n: String(Date.now()) })

/**
 * One chat. Its time sits on the right; on hover or focus, Rename and Delete fade in over the same
 * spot on a fade of the row's own colour, so nothing moves. On a touch screen they always show.
 */
function ThreadRow({
  thread,
  active,
  tabbable,
  snippet,
  shared,
  onOpen,
  onDelete,
  onStopSharing,
}: {
  thread: Thread
  active: boolean
  tabbable: boolean
  /** While searching: the line where the words matched, the match marked. */
  snippet?: Snippet
  /** Its live links, when it is shared (FR-721). */
  shared?: ChatLinks
  onOpen: () => void
  onDelete: () => void
  onStopSharing: () => void
}) {
  const threadActions = useThreadActions()
  const [renaming, setRenaming] = React.useState(false)
  const leaving = useLeaving(thread.id)
  const row = React.useRef<HTMLLIElement>(null)
  const openButton = React.useRef<HTMLButtonElement>(null)

  const nameInput = React.useRef<HTMLInputElement>(null)
  // Rename can come from the touch menu, which is still closing: focus the field once it has.
  React.useEffect(() => {
    if (!renaming) return
    const t = window.setTimeout(() => {
      nameInput.current?.focus()
      nameInput.current?.select()
    }, 0)
    return () => window.clearTimeout(t)
  }, [renaming])

  const finishRename = (title?: string) => {
    if (title?.trim()) threadActions.rename(thread.id, title.trim())
    setRenaming(false)
    requestAnimationFrame(() => openButton.current?.focus())
  }

  const remove = () => {
    // Focus goes to the neighbouring chat, or to New chat when this was the last one.
    const li = row.current
    const next =
      li?.nextElementSibling?.querySelector<HTMLElement>('[data-open]') ??
      li?.previousElementSibling?.querySelector<HTMLElement>('[data-open]') ??
      li?.closest('[data-chats]')?.querySelector<HTMLElement>('[data-new-chat]')
    void leaveThen(thread.id, () => {
      onDelete()
      next?.focus()
    })
  }

  return (
    <li
      ref={row}
      data-active={active || undefined}
      data-leaving={leaving || undefined}
      className="group/row row-presence"
    >
      <div className="relative min-h-0 overflow-hidden rounded-md bg-(--row) [--row:var(--background)] group-data-active/row:shadow-hairline group-data-active/row:[--row:var(--muted)] hover:[--row:var(--muted)]">
        {renaming ? (
          <Input
            ref={nameInput}
            defaultValue={thread.title}
            aria-label="Chat name"
            className="text-sm"
            onBlur={(e) => finishRename(e.currentTarget.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') finishRename(e.currentTarget.value)
              if (e.key === 'Escape') {
                e.stopPropagation()
                finishRename()
              }
            }}
          />
        ) : (
          <>
            <button
              ref={openButton}
              type="button"
              data-open
              // The list is one stop: arrows move through the chats, F2 renames, Delete deletes.
              tabIndex={tabbable ? 0 : -1}
              aria-current={active ? 'page' : undefined}
              aria-keyshortcuts="F2 Delete"
              aria-describedby="chat-keys"
              onClick={onOpen}
              onKeyDown={(e) => {
                if (e.key === 'F2') {
                  e.preventDefault()
                  setRenaming(true)
                } else if (e.key === 'Delete') {
                  e.preventDefault()
                  remove()
                } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
                  e.preventDefault()
                  const rows = [
                    ...(row.current?.closest('nav')?.querySelectorAll<HTMLElement>('[data-open]') ??
                      []),
                  ]
                  const i = rows.indexOf(e.currentTarget)
                  rows[
                    Math.min(rows.length - 1, Math.max(0, i + (e.key === 'ArrowDown' ? 1 : -1)))
                  ]?.focus()
                }
              }}
              title={thread.title}
              className="flex min-h-9 w-full flex-wrap items-center gap-x-2 rounded-md py-1.5 pr-2 pl-2.5 text-left text-sm outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
            >
              <TruncatedText text={thread.title} className="min-w-0 flex-1" />
              <span className="shrink-0 text-xs text-muted-foreground tabular-nums transition-opacity duration-(--dur-2) group-focus-within/row:opacity-0 group-hover/row:opacity-0 [@media(hover:none)]:opacity-0">
                {thread.time}
              </span>
              {snippet && (
                <span className="basis-full truncate text-xs text-muted-foreground">
                  {snippet.before}
                  <mark className="rounded-xs bg-primary/15 px-px text-foreground">
                    {snippet.hit}
                  </mark>
                  {snippet.after}
                </span>
              )}
              {shared && (
                <span className="basis-full truncate text-xs text-muted-foreground">
                  Shared until {dayMonth(shared.until)}
                </span>
              )}
            </button>
            <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center gap-0.5 bg-linear-to-l from-(--row) from-65% to-transparent pr-1 pl-7 opacity-0 transition-opacity duration-(--dur-2) group-focus-within/row:pointer-events-auto group-focus-within/row:opacity-100 group-hover/row:pointer-events-auto group-hover/row:opacity-100 [@media(hover:none)]:pointer-events-auto [@media(hover:none)]:opacity-100">
              <div className="flex items-center gap-0.5 [@media(hover:none)]:hidden">
                {shared && (
                  <Tooltip>
                    <TooltipTrigger
                      render={
                        <Button
                          variant="ghost"
                          size="icon"
                          tabIndex={-1}
                          aria-label={`Stop sharing ${thread.title}`}
                          className="hover:bg-foreground/8"
                          onClick={onStopSharing}
                        />
                      }
                    >
                      <Link2Off />
                    </TooltipTrigger>
                    <TooltipContent>Stop sharing</TooltipContent>
                  </Tooltip>
                )}
                <Tooltip>
                  <TooltipTrigger
                    render={
                      <Button
                        variant="ghost"
                        size="icon"
                        tabIndex={-1}
                        aria-label={`Rename ${thread.title}`}
                        className="hover:bg-foreground/8"
                        onClick={() => setRenaming(true)}
                      />
                    }
                  >
                    <PencilIcon />
                  </TooltipTrigger>
                  <TooltipContent>Rename</TooltipContent>
                </Tooltip>
                <Tooltip>
                  <TooltipTrigger
                    render={
                      <Button
                        variant="ghost"
                        size="icon"
                        tabIndex={-1}
                        aria-label={`Delete ${thread.title}`}
                        className="hover:bg-foreground/8"
                        onClick={remove}
                      />
                    }
                  >
                    <Trash2Icon />
                  </TooltipTrigger>
                  <TooltipContent>Delete</TooltipContent>
                </Tooltip>
              </div>
              {/* No hover on a touch screen: one menu instead of two buttons, so the title keeps its room. */}
              <DropdownMenu>
                <DropdownMenuTrigger
                  render={
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label={`More for ${thread.title}`}
                      className="hidden hover:bg-foreground/8 [@media(hover:none)]:inline-flex"
                    />
                  }
                >
                  <EllipsisIcon />
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-auto" finalFocus={false}>
                  <DropdownMenuItem onClick={() => setRenaming(true)}>
                    <PencilIcon />
                    Rename
                  </DropdownMenuItem>
                  {shared && (
                    <DropdownMenuItem onClick={onStopSharing}>
                      <Link2Off />
                      Stop sharing
                    </DropdownMenuItem>
                  )}
                  <DropdownMenuItem variant="destructive" onClick={remove}>
                    <Trash2Icon />
                    Delete
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </>
        )}
      </div>
    </li>
  )
}

/** The folded history: a slim rail whose toggle sits exactly where Hide history was. */
function HistoryRail({ onShow }: { onShow: (focusSearch?: boolean) => void }) {
  return (
    <div className="flex h-full flex-col gap-1 px-2 pt-2">
      <Tooltip>
        <TooltipTrigger
          render={
            <Button
              variant="ghost"
              size="icon-lg"
              aria-label="Show history"
              onClick={() => onShow()}
            />
          }
        >
          <PanelLeftOpenIcon />
        </TooltipTrigger>
        <TooltipContent side="right">
          Show history <Kbd>{HISTORY_KEY}</Kbd>
        </TooltipContent>
      </Tooltip>
      <Tooltip>
        <TooltipTrigger
          render={
            <Button variant="ghost" size="icon-lg" aria-label="New chat" onClick={startChat} />
          }
        >
          <SquarePenIcon />
        </TooltipTrigger>
        <TooltipContent side="right">New chat</TooltipContent>
      </Tooltip>
      <Tooltip>
        <TooltipTrigger
          render={
            <Button
              variant="ghost"
              size="icon-lg"
              aria-label="Search chats"
              onClick={() => onShow(true)}
            />
          }
        >
          <SearchIcon />
        </TooltipTrigger>
        <TooltipContent side="right">Search chats</TooltipContent>
      </Tooltip>
    </div>
  )
}

type Snippet = { before: string; hit: string; after: string }

/** The words around a match, for one line: "…sales to Norway stopped after a new [customs] rule…". */
function snippetOf(text: string, q: string): Snippet | undefined {
  const at = text.toLowerCase().indexOf(q)
  if (at < 0) return undefined
  const from = Math.max(0, text.lastIndexOf(' ', Math.max(0, at - 14)) + 1)
  return {
    before: (from > 0 ? '…' : '') + text.slice(from, at),
    hit: text.slice(at, at + q.length),
    after: text.slice(at + q.length, at + q.length + 60),
  }
}

/** The chats beside the thread: New chat and search pinned on top, then the chats by day. */
function ThreadList({
  current,
  live,
  onPick,
  onHide,
  onOpenChat,
  onNewChat,
}: {
  current?: string | null
  /** What the open chat has said so far, follow-ups included. */
  live?: string
  onPick?: () => void
  onHide?: () => void
  /** Where a chat opens, when not in Ask itself (the dock). */
  onOpenChat?: (t: Thread) => void
  onNewChat?: () => void
}) {
  const all = useThreads()
  const { fresh } = useSession()
  const threadActions = useThreadActions()
  const [search, setSearch] = React.useState('')
  // The person's shared links by chat (FR-721): a chat here says until when, and one whose chat
  // is not in this browser (deleted here, or shared from another) is listed on its own to stop.
  const shares = useQuery(chatSharesQuery()).data
  const byChat = React.useMemo(() => linksByChat(shares?.links ?? []), [shares])
  const write = useWrite()
  const stopSharing = (links: ChatLinks) =>
    void write('stopSharing', { ids: links.ids }).then(
      () => toast('Stopped sharing', { description: links.title }),
      (e: unknown) => toast.error("Couldn't stop sharing", { description: toApiError(e).message }),
    )
  const visible = fresh ? all.filter((t) => !t.seed) : all
  const q = search.trim().toLowerCase()
  // Search reads what was asked and what the answers said, the open chat's latest turns too, not only the title.
  const body = (t: Thread) =>
    `${t.question} ${t.preview}${t.id === current && live ? ` ${live.replace(/\[\d+\]/g, '')}` : ''}`
  const shown = visible.filter((t) => `${t.title} ${body(t)}`.toLowerCase().includes(q))
  // The line that matched, unless the title already shows it.
  const snippet = (t: Thread) =>
    q && !t.title.toLowerCase().includes(q) ? snippetOf(body(t), q) : undefined
  const here = new Set(all.map((t) => t.id))
  const away = [...byChat].flatMap(([chat, links]) =>
    !here.has(chat) && links.title.toLowerCase().includes(q) ? [links] : [],
  )

  const startNew = () => {
    if (onNewChat) onNewChat()
    else startChat()
    onPick?.()
  }
  const open = (t: Thread) => {
    if (onOpenChat) onOpenChat(t)
    else
      setQuery({
        example: placeOf(t).example ?? undefined,
        chat: placeOf(t).chat ?? undefined,
        n: placeOf(t).example ? undefined : t.id,
      })
    onPick?.()
  }
  const remove = async (t: Thread) => {
    await threadActions.remove(t.id, t.title)
    if (current === t.id) startChat()
  }

  return (
    <div data-chats className="group/chats flex h-full min-h-0 flex-col">
      <div className="flex flex-col gap-2 px-2 pt-2 pb-1">
        <div className="flex items-center gap-1">
          {onHide && (
            <Tooltip>
              <TooltipTrigger
                render={
                  <Button
                    variant="ghost"
                    size="icon-lg"
                    aria-label="Hide history"
                    onClick={onHide}
                  />
                }
              >
                <PanelLeftCloseIcon />
              </TooltipTrigger>
              <TooltipContent>
                Hide history <Kbd>{HISTORY_KEY}</Kbd>
              </TooltipContent>
            </Tooltip>
          )}
          <Button
            data-new-chat
            variant="ghost"
            size="lg"
            className="flex-1 justify-start"
            onClick={startNew}
          >
            <SquarePenIcon />
            New chat
          </Button>
        </div>
        <div className="relative">
          <SearchIcon
            className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground"
            aria-hidden
          />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onKeyDown={(e) => e.key === 'Escape' && search && (e.stopPropagation(), setSearch(''))}
            placeholder="Search chats"
            aria-label="Search chats"
            data-search-chats
            className="pr-8 pl-8 text-sm"
          />
          {search && (
            <button
              type="button"
              aria-label="Clear the search"
              onClick={() => setSearch('')}
              className="absolute top-1/2 right-1 grid size-6 -translate-y-1/2 place-items-center rounded-sm text-muted-foreground outline-none hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50"
            >
              <XIcon className="size-3.5" />
            </button>
          )}
        </div>
      </div>
      <nav aria-label="Chats" className="min-h-0 flex-1 overflow-y-auto fade-in-top px-2 pb-3">
        {visible.length === 0 ? (
          <div className="px-2.5 pt-5 text-sm">
            <p className="font-medium">No chats yet</p>
            <p className="mt-1 text-muted-foreground">
              Your questions here show up in this list, and only you see them. From agents, only
              what a question was about and how often is kept, never the words or who asked.
            </p>
          </div>
        ) : shown.length === 0 ? (
          <div className="px-2.5 pt-5 text-sm">
            <p className="break-words text-muted-foreground">No chats match “{search.trim()}”.</p>
            <Button
              variant="link"
              className="mt-1 h-auto p-0 text-sm"
              onClick={() => setSearch('')}
            >
              Clear the search
            </Button>
          </div>
        ) : (
          DAYS.map((day) => {
            const items = shown.filter((t) => t.day === day)
            if (!items.length) return null
            return (
              <section key={day} aria-labelledby={`chats-${day}`} className="pt-3 first:pt-2">
                <h2
                  id={`chats-${day}`}
                  className="px-2.5 pb-1.5 text-xs font-medium text-muted-foreground"
                >
                  {day}
                </h2>
                <ul ref={arriveRef} className="flex flex-col gap-px">
                  {items.map((t) => (
                    <ThreadRow
                      key={t.id}
                      thread={t}
                      active={current === t.id}
                      tabbable={
                        current
                          ? current === t.id ||
                            (!shown.some((x) => x.id === current) && t.id === shown[0]?.id)
                          : t.id === shown[0]?.id
                      }
                      snippet={snippet(t)}
                      shared={byChat.get(t.id)}
                      onOpen={() => open(t)}
                      onDelete={() => void remove(t)}
                      onStopSharing={() => {
                        const links = byChat.get(t.id)
                        if (links) stopSharing(links)
                      }}
                    />
                  ))}
                </ul>
              </section>
            )
          })
        )}
        {away.length > 0 && (
          <section aria-labelledby="chats-shared" className="pt-3">
            <h2
              id="chats-shared"
              className="px-2.5 pb-1.5 text-xs font-medium text-muted-foreground"
            >
              Shared links
            </h2>
            <ul className="flex flex-col gap-px">
              {away.map((links) => (
                <li
                  key={links.ids[0]}
                  className="flex items-center gap-0.5 rounded-md pr-1 hover:bg-muted"
                >
                  <a
                    href={sharedChatPath(links.ids[0]!)}
                    onClick={() => onPick?.()}
                    className="flex min-h-9 min-w-0 flex-1 flex-col rounded-md py-1.5 pl-2.5 text-sm outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
                  >
                    <TruncatedText text={links.title} />
                    <span className="truncate text-xs text-muted-foreground">
                      Shared until {dayMonth(links.until)}
                    </span>
                  </a>
                  <Tooltip>
                    <TooltipTrigger
                      render={
                        <Button
                          variant="ghost"
                          size="icon"
                          aria-label={`Stop sharing ${links.title}`}
                          className="hover:bg-foreground/8"
                          onClick={() => stopSharing(links)}
                        />
                      }
                    >
                      <Link2Off />
                    </TooltipTrigger>
                    <TooltipContent>Stop sharing</TooltipContent>
                  </Tooltip>
                </li>
              ))}
            </ul>
          </section>
        )}
      </nav>
      {/* What is kept, said once where the chats are; while a chat has keyboard focus, the keys instead. */}
      <p className="flex h-bar shrink-0 items-center border-t px-4 text-xs leading-4 text-muted-foreground group-has-[[data-open]:focus-visible]/chats:hidden">
        Only you see these chats. Agents' questions are kept as counts.
      </p>
      <p
        id="chat-keys"
        className="hidden h-bar shrink-0 flex-wrap content-center items-center gap-x-2.5 gap-y-1 border-t px-4 text-xs text-muted-foreground group-has-[[data-open]:focus-visible]/chats:flex"
      >
        <span>
          <Kbd>↑</Kbd> <Kbd>↓</Kbd> move
        </span>
        <span>
          <Kbd>F2</Kbd> rename
        </span>
        <span>
          <Kbd>Delete</Kbd> delete
        </span>
      </p>
    </div>
  )
}

/**
 * One thread of Ask: its session (src/web/model/ask-session.ts) is made when it mounts and goes
 * with it, so a thread that comes back is worked out from `place` and the kept chats alone. The
 * page and the dock both show it, with their own idea of where a chat lives.
 */
function AskThread({
  place,
  mint,
  compact,
  prefill,
  onJoined,
  onExample,
  onTurns,
}: {
  place: Place
  /** The id a chat that starts in this thread gets. */
  mint: () => string
  compact?: boolean
  prefill?: string
  /** The chat this thread started is in the history: where it lives now. */
  onJoined: (chat: string) => void
  onExample?: (question: string) => boolean
  onTurns?: (text: string) => void
}) {
  const threads = useThreads()
  const threadActions = useThreadActions()
  // Set once a turn is answered here; until then the session is the address's.
  const [answered, setAnswered] = React.useState<Session | null>(null)
  const became = React.useRef<Session | null>(null)
  const session = answered ?? sessionOf(place, threads)
  // An example or a chat opens on its first answer, which is read once before the thread shows (src/web/lib/opening-read.ts).
  const examples = useAskExamples()
  const opening = useOpeningRead(firstRead(session))
  // The thread takes these once, when it mounts: it is not shown before they are in.
  const initial = openingAnswers(session, opening.state === 'read' ? opening.answer : undefined)
  const join = (j: Join) => {
    threadActions.add(j.chat, j.question)
    onJoined(j.chat)
  }
  // Any answered turn starts the chat in the history, once, whichever button asked it.
  const onAnswered = (question: string) => {
    const from = became.current ?? sessionOf(place, threads)
    const next = reduce(from, { type: 'answered', question, mint: mint() })
    if (next.session === from) return
    became.current = next.session
    setAnswered(next.session)
    if (next.join) join(next.join)
  }
  // The chat on show keeps its answers, under the id it has once its first question is answered.
  const chat = session.kind === 'live' || session.kind === 'history' ? session.chat : null
  const keepAnswers = React.useCallback(
    (answers: Answer[]) => {
      if (chat && answers[0]) threadActions.keep(chat, answers[0].question, answers)
    },
    // threadActions is made afresh each render; the chat's id is what decides.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [chat],
  )
  if (opening.state === 'reading') return <OpeningNotice />
  return (
    <AskChat
      compact={compact}
      initial={initial}
      {...(notKept(session)
        ? { failedOpening: { question: session.question, line: NOT_KEPT } }
        : opening.state === 'failed'
          ? {
              failedOpening: {
                question: openingQuestion(session, examples),
                line: unansweredIn(opening.message, isOnline()),
              },
            }
          : {})}
      prefill={prefill}
      onAnswered={onAnswered}
      onExample={onExample}
      onTurns={onTurns}
      onAnswers={keepAnswers}
    />
  )
}

/** What a chat says while its first answer is read; no box yet, as the thread is not shown before. */
function OpeningNotice() {
  return (
    <p
      role="status"
      className="grid h-full min-h-0 place-items-center text-sm text-muted-foreground"
    >
      Opening the chat…
    </p>
  )
}

export function AskPage() {
  const { query } = useRoute()
  const isMobile = useIsMobile()
  const example = query.get('example')
  const chat = query.get('chat')
  const n = query.get('n')
  const threads = useThreads()
  const [sheet, setSheet] = React.useState(false)
  const [live, setLive] = React.useState('')
  const [collapsed, setCollapsedState] = React.useState(
    () => readWidth('ask-chats-hidden', 0) === 1,
  )
  const setCollapsed = React.useCallback((c: boolean) => {
    setCollapsedState(c)
    saveWidth('ask-chats-hidden', c ? 1 : 0)
  }, [])
  const show = (focusSearch?: boolean) => {
    setCollapsed(false)
    if (focusSearch)
      window.setTimeout(
        () => document.querySelector<HTMLElement>('#ask-chats [data-search-chats]')?.focus(),
        reducedMotion() ? 0 : 200,
      )
  }

  // Option-H shows and hides the history, on a phone as the sheet.
  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!e.altKey || e.metaKey || e.ctrlKey || e.code !== 'KeyH') return
      e.preventDefault()
      if (isMobile) setSheet((o) => !o)
      else setCollapsed(!collapsed)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [isMobile, collapsed, setCollapsed])

  // A new chat joins the list with its first answered turn. The thread stays mounted: only an
  // opened chat or New chat changes `n`, which is what starts a thread afresh.
  const write = useWrite()
  // The chat that already asks a question, so the history never gets the same question twice.
  const chatAsking = (question: string) =>
    threads.find((x) => x.question.toLowerCase() === question.toLowerCase())
  // An example's question opens the example: its answer is the example's own, not a look-up.
  const openExample = (question: string) => {
    const example = chatAsking(question)?.example
    if (!example) return false
    setQuery({ example, chat: undefined, n: undefined })
    return true
  }
  // Share chat (FR-721): once the chat on show has an answer, while sharing is on.
  const shares = useQuery(chatSharesQuery()).data
  const dock = useDock()
  const shown = chat && !example ? threads.find((t) => t.id === chat) : undefined
  const shareable = !!shares?.on && !!shown && !shown.example && !!shown.answers?.length
  const setup = query.get('setup')
  const onJoined = (id: string) => {
    setQuery({ chat: id, setup: undefined, q: undefined })
    // The setup's two questions (FR-816): the first, with nothing written yet, and the same one
    // asked again once it is.
    if (setup) {
      void write('completeSetupStep', { step: 'ask' })
      toast('Your question is answered', {
        description: 'This is what agents get today, from what is written.',
        action: { label: 'Back to setup', onClick: () => navigate('/inbox') },
      })
    }
  }

  return (
    <div data-touch-targets className="flex h-full min-h-0 flex-col">
      <SiteHeader title="Ask" icon={<MessageSquareIcon />} fold>
        {shareable && (
          <Tooltip>
            <TooltipTrigger
              render={
                <Button
                  variant="outline"
                  aria-label="Share chat"
                  aria-pressed={dock?.kind === 'share' && dock.id === shown.id}
                  data-narrow="icon"
                  onClick={() => openDock('share', shown.id)}
                />
              }
            >
              <ShareIcon />
              <span data-narrow="gone">Share chat</span>
            </TooltipTrigger>
            <TooltipContent>Share chat as a link</TooltipContent>
          </Tooltip>
        )}
        <Tooltip>
          <TooltipTrigger
            render={
              <Button
                variant="outline"
                aria-label="History"
                aria-expanded={isMobile ? sheet : !collapsed}
                aria-controls={isMobile ? undefined : 'ask-chats'}
                data-narrow="icon"
                onClick={() => (isMobile ? setSheet(true) : setCollapsed(!collapsed))}
              />
            }
          >
            <HistoryIcon />
            <span data-narrow="gone">History</span>
          </TooltipTrigger>
          <TooltipContent>
            {isMobile ? 'History' : collapsed ? 'Show history' : 'Hide history'}{' '}
            <Kbd>{HISTORY_KEY}</Kbd>
          </TooltipContent>
        </Tooltip>
        {/* The history has New chat; on a phone, where the history is a sheet, the header has it too. */}
        {isMobile && (
          <Tooltip>
            <TooltipTrigger
              render={
                <Button variant="outline" size="icon" aria-label="New chat" onClick={startChat} />
              }
            >
              <SquarePenIcon />
            </TooltipTrigger>
            <TooltipContent>New chat</TooltipContent>
          </Tooltip>
        )}
      </SiteHeader>
      <div className="flex min-h-0 flex-1">
        <div id="ask-chats" className="hidden md:contents">
          <ResizableAside
            side="left"
            storageKey="ask-chats"
            defaultWidth={272}
            min={220}
            max={400}
            label="History"
            collapsed={collapsed}
            onCollapsedChange={setCollapsed}
            rail={<HistoryRail onShow={show} />}
            railWidth={52}
            className="border-r"
          >
            <ThreadList current={example ?? chat} live={live} onHide={() => setCollapsed(true)} />
          </ResizableAside>
        </div>
        <div className="min-h-0 min-w-0 flex-1">
          <AskThread
            key={example ? `e-${example}` : `c-${n ?? ''}`}
            place={{ example, chat }}
            mint={() => `chat-${n ?? Date.now()}`}
            prefill={query.get('q') ?? undefined}
            onJoined={onJoined}
            onExample={openExample}
            onTurns={setLive}
          />
        </div>
      </div>
      <Sheet open={sheet} onOpenChange={setSheet}>
        <SheetContent side="left" className="w-popover-phone gap-0 bg-background p-0">
          <SheetHeader className="border-b">
            <SheetTitle>History</SheetTitle>
          </SheetHeader>
          <ThreadList current={example ?? chat} live={live} onPick={() => setSheet(false)} />
        </SheetContent>
      </Sheet>
    </div>
  )
}

export function AskDock() {
  // A quick view's "Try it with a question" opens Ask with the question typed in, not yet sent; a
  // person's own question, such as a report's, comes in memory (`askInDock`), not in the address.
  const { query } = useRoute()
  const typed = useTyped()
  const q = query.get('q') ?? undefined
  // The dock keeps its own place: History opens a chat here, New chat starts afresh, and a chat
  // that joins the history stays on show. The thread itself is the page's (AskThread).
  const [dock, setDock] = React.useState<{
    key: string
    place: Place
    typed?: string | null
  }>({
    key: 'new',
    place: { example: null, chat: null },
  })
  const [taken, setTaken] = React.useState<number | null>(null)
  const [history, setHistory] = React.useState(false)
  if (typed && typed.n !== taken) {
    setTaken(typed.n)
    setDock({
      key: `typed-${typed.n}`,
      place: { example: null, chat: null },
      typed: typed.question,
    })
  }
  const newChat = () =>
    setDock({ key: `new-${Date.now()}`, place: { example: null, chat: null }, typed: null })
  const openChat = (t: Thread) => {
    setDock({ key: `${t.id}-${Date.now()}`, place: placeOf(t) })
    setHistory(false)
  }
  return (
    <DockFrame
      title="Ask"
      actions={
        <>
          <Popover open={history} onOpenChange={setHistory}>
            <Tooltip>
              <TooltipTrigger
                render={
                  <PopoverTrigger
                    render={<Button variant="ghost" size="icon" aria-label="History" />}
                  />
                }
              >
                <HistoryIcon />
              </TooltipTrigger>
              <TooltipContent>History</TooltipContent>
            </Tooltip>
            <PopoverContent align="end" aria-label="History" className="h-history w-72 p-0">
              <ThreadList
                current={dock.place.example ?? dock.place.chat}
                onOpenChat={openChat}
                onNewChat={() => (newChat(), setHistory(false))}
              />
            </PopoverContent>
          </Popover>
          <Tooltip>
            <TooltipTrigger
              render={
                <Button variant="ghost" size="icon" aria-label="New chat" onClick={newChat} />
              }
            >
              <SquarePenIcon />
            </TooltipTrigger>
            <TooltipContent>New chat</TooltipContent>
          </Tooltip>
        </>
      }
    >
      <AskThread
        key={`${q}-${dock.key}`}
        place={dock.place}
        mint={() => `chat-dock-${Date.now()}`}
        compact
        prefill={dock.place.chat || dock.place.example ? undefined : (dock.typed ?? q)}
        onJoined={(chat) => setDock((d) => ({ ...d, place: { example: null, chat } }))}
      />
    </DockFrame>
  )
}

/** Try it: Ask against a suggestion's draft, before agents get it. */
export function TryIt({ cardId, embedded }: { cardId?: string; embedded?: boolean }) {
  const { cards } = useInbox()
  const card = cards.find((c) => c.id === cardId)
  const editorDraft = useDraft()
  const draft = cardId === 'editor' ? (editorDraft ?? undefined) : card?.suggestion?.draft
  const hasDraft = !!draft
  const initial = React.useMemo(() => {
    if (!draft) return []
    const question =
      cardId === 'editor'
        ? `What should I know about ${draft.where[0]?.toLowerCase() ?? 'this'}${draft.where[1] ? ` in ${draft.where[1]}` : ''}?`
        : card?.id === 'sug-agent'
          ? 'Why are Poland orders low this week?'
          : card?.id === 'sug-jon'
            ? 'Why is return on ad spend in Norway empty since May?'
            : 'How many test accounts does units sold leave out in Norway?'
    return [
      {
        id: 'try',
        question,
        metric: draft.where[0] ?? '',
        // Only the market the draft names: never one of the demo's in its place.
        markets: draft.where.slice(1, 2),
        state: 'grounded' as const,
        text: `${draft.summary
          .split(/(?<=\.)\s/)
          .slice(0, 2)
          .join(' ')} [1]`,
        sources: [draft.id],
        said: `1 context item applies to ${draft.where.join(' in ')}. Nothing else was looked up.`,
      },
    ]
    // The draft is read once it exists, when Try it opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cardId, hasDraft])
  const chat = <AskChat key={`${cardId}-${!!draft}`} initial={initial} draft={draft} compact />
  if (embedded) return chat
  return <DockFrame title="Try it">{chat}</DockFrame>
}
