import * as React from 'react'
import { useDomains } from '@/lib/workspace'
import {
  OBS_PURPOSE,
  ObsDrawn,
  rangeLabel,
  useDomainChoice,
  useKeptObsPage,
  useObservability,
  useObsView,
} from '@/lib/obs'
import {
  ArrowUpRightIcon,
  BotIcon,
  CheckIcon,
  FlagIcon,
  LockIcon,
  MessageSquareIcon,
  MinusIcon,
  ThumbsDownIcon,
  ThumbsUpIcon,
} from '@/components/icons'
import { cn } from '@/lib/utils'
import { buttonVariants } from '@/components/ui/button'
import { Frame, FrameSection } from '@/components/footnote/frame'
import { Loadable } from '@/components/footnote/load-state'
import { CountUp } from '@/components/footnote/count-up'
import { ObsSkeleton } from '@/components/obs/obs-skeleton'
import { ObsEmpty } from '@/components/obs/obs-empty'
import { DomainDot } from '@/components/footnote/tag-chip'
import { Bars } from '@/components/obs/charts'
import { shareChange } from '@domain/observability'
import { DomainChip, Kpi, kpiChange, RangeSwitch } from '@/components/obs/controls'
import { TextSwitch } from '@/components/footnote/switches'
import {
  dateLabel,
  HIDE_UNDER,
  REPORT_WORDS,
  shownCount,
  type ReportState,
} from '@/model/observability'
import { ObsPage } from '@/pages/observability'

// Feedback: what people and agents said about answers. A thumbs up or down under an answer in Ask
// keeps only the verdict, the domain and the hour (FR-712); a report is sent on purpose, so it carries the person's
// name; an agent's report carries its kind, never a name. Open reports wait in the Inbox, which is
// the queue: nothing is scored here. Agents never read comments or reports.

const STATE_ICON: Record<ReportState, typeof FlagIcon> = {
  inbox: FlagIcon,
  looked: CheckIcon,
  fine: MinusIcon,
}

export function FeedbackPage() {
  // Another range keeps this view until the next has loaded: the numbers count to the new ones and
  // the bars move, instead of a skeleton.
  const { load, drawn, busy } = useKeptObsPage('feedback')
  return (
    <ObsPage section="feedback">
      <Loadable
        query={load}
        what="the feedback"
        skeleton={<ObsSkeleton section="feedback" kpis={4} body="split" />}
      >
        <ObsDrawn.Provider value={drawn}>
          <Feedback busy={busy} />
        </ObsDrawn.Provider>
      </Loadable>
    </ObsPage>
  )
}

/**
 * The share of answers marked good, in whole per cent, and how many were marked: only when both
 * counts are shown and something was marked, so it never gives a hidden count away.
 */
function goodShare(good: number | null, wrong: number | null) {
  if (good === null || wrong === null || good + wrong === 0) return null
  return { pct: Math.round((good / (good + wrong)) * 100), marked: good + wrong }
}

/** Why a list of reports is empty, in one sentence: for the range, the domain and the state. */
function emptyList(tab: 'all' | ReportState, range: string, domain: string | undefined) {
  const where = domain ? ` in ${domain}` : ''
  if (tab === 'inbox')
    return `No report${where} waits in the Inbox: every one ${range} has been looked at.`
  if (tab === 'looked') return `No report${where} ${range} has been looked at yet.`
  if (tab === 'fine') return `No report${where} ${range} was marked Not a problem.`
  return `Nobody reported an answer${where} ${range}. A report from Ask, or an agent's Not found, shows here.`
}

/** A count as a number cell says it: counting to its new value, or "Fewer than 5". */
const figure = (n: number | null) =>
  n === null || (n > 0 && n < HIDE_UNDER) ? shownCount(n) : <CountUp value={n} />

function Feedback({ busy }: { busy: boolean }) {
  const domains = useDomains()
  const obs = useObservability()
  const view = useObsView()
  const choice = useDomainChoice()
  const [tab, setTab] = React.useState<'all' | ReportState>('all')
  const feedback = obs.data.feedback
  // The binding gives the reports of the domains the person sees.
  const reports = view.state === 'empty' || !feedback ? [] : feedback.reports
  const shown = reports.filter((r) => tab === 'all' || r.state === tab)
  // The range drawn: while another loads, the one on screen.
  const range = obs.data.range
  const byWeek = feedback?.byWeek ?? []
  const good = feedback?.week.good ?? null
  const wrong = feedback?.week.wrong ?? null
  const share = goodShare(good, wrong)
  const before = feedback ? goodShare(feedback.week.goodBefore, feedback.week.wrongBefore) : null
  const people = reports.filter((r) => !r.agent).length
  const agents = reports.filter((r) => r.agent).length
  if (view.state === 'empty')
    return (
      <Frame>
        <FrameSection title="Feedback" description={OBS_PURPOSE.feedback} />
        <ObsEmpty
          cells={[
            { icon: <ThumbsUpIcon />, label: 'Good answers' },
            { icon: <ThumbsDownIcon />, label: 'Something was wrong' },
            { icon: <FlagIcon />, label: 'Reports' },
            { icon: <BotIcon />, label: 'From agents' },
          ]}
          chart={
            <Bars
              parts={[
                { name: 'Good', values: [0, 0, 0, 0], fill: 'var(--chart-2)' },
                { name: 'Something was wrong', values: [0, 0, 0, 0], fill: 'var(--caution)' },
              ]}
              labels={[3, 2, 1, 0].map((w) => dateLabel(obs.data.last - w * 7 * 86_400_000))}
              caption="Nothing marked yet"
            />
          }
          icon={<ThumbsUpIcon />}
          title="Nothing said about answers yet"
          sentence="When someone marks or reports an answer in Ask, or an agent reports a Not found, it shows here."
          next={
            <a href="/ask" className={cn(buttonVariants())}>
              <MessageSquareIcon data-icon="inline-start" />
              Ask a question
            </a>
          }
        />
      </Frame>
    )
  return (
    <Frame aria-busy={busy || undefined}>
      <FrameSection
        title="Feedback"
        description={OBS_PURPOSE.feedback}
        action={
          <div className="flex flex-wrap items-center gap-2">
            {/* An owner reads one of their own domains at a time; an admin all, or one. */}
            <DomainChip value={view.domain} choices={choice.choices} all={!view.owned} />
            <RangeSwitch value={view.range} />
          </div>
        }
      />
      <div className="grid grid-cols-2 gap-px border-t bg-border @3xl/main:grid-cols-4">
        {/* The share of good is worked out only from counts that are shown, so it never gives a
            hidden one away. */}
        <Kpi
          icon={<ThumbsUpIcon />}
          label="Good answers"
          value={share ? <CountUp value={share.pct} suffix="%" /> : figure(good)}
          change={
            share && before
              ? kpiChange(
                  shareChange(good!, share.marked, feedback!.week.goodBefore!, before.marked),
                  (c) => `${c.by > 0 ? '+' : ''}${c.by} pts`,
                  'up',
                )
              : undefined
          }
          sub={
            share
              ? `${good!.toLocaleString('en-GB')} of ${share.marked.toLocaleString('en-GB')} marked in Ask, ${rangeLabel(range)}`
              : `marked good in Ask, ${rangeLabel(range)}`
          }
        />
        <Kpi
          icon={<ThumbsDownIcon />}
          label="Something was wrong"
          value={
            wrong === null || (wrong > 0 && wrong < 5) ? (
              <span className="text-xl">Fewer than 5</span>
            ) : (
              <CountUp value={wrong} />
            )
          }
          sub={
            wrong === null || (wrong > 0 && wrong < 5)
              ? 'a count under 5 is hidden'
              : `${rangeLabel(range)}, in Ask`
          }
        />
        {/* Reports are sent on purpose and carry a name, so their count hides nobody: it shows as it is. */}
        <Kpi
          icon={<FlagIcon />}
          label="Reports"
          value={<CountUp value={people} />}
          sub="sent on purpose, with a name"
        />
        <Kpi
          icon={<BotIcon />}
          label="From agents"
          value={<CountUp value={agents} />}
          href={agents ? '#reports' : undefined}
          sub="reported a Not found or gave feedback"
        />
      </div>
      <div className="grid grid-cols-1 border-t @4xl/main:grid-cols-(--cols-split-3-2)">
        <div id="reports" className="scroll-mt-16">
          {/* One line of states; a narrow page scrolls it sideways rather than wrapping it. */}
          <div className="overflow-x-auto border-b px-4 py-1.5 md:px-5">
            <TextSwitch
              label="Reports"
              options={(['all', 'inbox', 'looked', 'fine'] as const).map((k) => ({
                value: k,
                label: k === 'all' ? 'All' : REPORT_WORDS[k],
                count: k === 'all' ? reports.length : reports.filter((r) => r.state === k).length,
              }))}
              value={tab}
              onChange={setTab}
            />
          </div>
          <div role="region" aria-label={tab === 'all' ? 'All reports' : REPORT_WORDS[tab]}>
            {shown.length === 0 && (
              <p
                data-slot="list-empty"
                className="border-b px-4 py-6 text-sm text-muted-foreground md:px-5"
              >
                {emptyList(tab, rangeLabel(range), view.domain && domains[view.domain]?.name)}
              </p>
            )}
            <ul>
              {shown.map((r) => {
                const Icon = STATE_ICON[r.state]
                return (
                  <li
                    key={r.id}
                    className="flex flex-wrap items-center gap-x-3 gap-y-1.5 border-b px-4 py-3 md:px-5"
                  >
                    <span className="flex size-8 shrink-0 items-center justify-center rounded-md border text-muted-foreground">
                      {r.agent ? (
                        <BotIcon className="size-4" aria-hidden />
                      ) : (
                        <FlagIcon className="size-4" aria-hidden />
                      )}
                    </span>
                    <div className="min-w-0 flex-1">
                      <a
                        href={r.href}
                        className="block truncate text-sm font-medium underline-offset-4 hover:underline"
                      >
                        {r.title}
                      </a>
                      <p className="flex items-center gap-1.5 truncate text-xs text-muted-foreground">
                        {r.domain && <DomainDot id={r.domain} />}
                        {r.domain ? domains[r.domain]?.name : 'No domain'} - {r.line}
                      </p>
                    </div>
                    {/* On a narrow page the state and who sent it go under the title. */}
                    <div className="flex shrink-0 flex-col items-end gap-1 @max-2xl/main:basis-full @max-2xl/main:flex-row @max-2xl/main:items-center @max-2xl/main:gap-2 @max-2xl/main:pl-11">
                      <span
                        className={cn(
                          'inline-flex h-6 shrink-0 items-center gap-1 rounded-md border px-2 text-xs whitespace-nowrap',
                          r.state === 'inbox' && 'border-caution/45 text-foreground',
                          r.state === 'looked' && 'text-foreground',
                          r.state === 'fine' && 'text-muted-foreground',
                        )}
                      >
                        <Icon className="size-3" aria-hidden />
                        {REPORT_WORDS[r.state]}
                      </span>
                      <span className="text-xs text-muted-foreground">
                        {r.from} - {r.when}
                      </span>
                    </div>
                  </li>
                )
              })}
            </ul>
          </div>
          <a
            href="/inbox"
            className="flex items-center gap-1.5 px-4 py-3 text-sm text-muted-foreground underline-offset-4 hover:text-foreground hover:underline md:px-5"
          >
            <ArrowUpRightIcon className="size-3.5" aria-hidden />
            Open reports wait in the Inbox
          </a>
        </div>
        <div className="border-t @4xl/main:border-t-0 @4xl/main:border-l">
          <FrameSection
            title="Good and wrong, by week"
            description="Thumbs under an answer in Ask. Only the verdict, the domain and the hour are kept."
          >
            <div className="px-3 pb-3">
              <Bars
                parts={[
                  { name: 'Good', values: byWeek.map((w) => w.good), fill: 'var(--chart-2)' },
                  {
                    name: 'Something was wrong',
                    values: byWeek.map((w) => w.wrong),
                    fill: 'var(--caution)',
                  },
                ]}
                labels={byWeek.map((w) => w.label)}
                soFar={byWeek.at(-1)?.soFar}
                caption="Good answers and something wrong, by week"
              />
              <ul className="mt-2 flex gap-x-4 px-1 text-xs text-muted-foreground">
                <li className="flex items-center gap-1.5">
                  <span className="size-2.5 bg-chart-2" aria-hidden />
                  Good
                </li>
                <li className="flex items-center gap-1.5">
                  <span className="size-2.5 bg-caution" aria-hidden />
                  Something was wrong
                </li>
              </ul>
            </div>
          </FrameSection>
          <p className="flex items-start gap-2 border-t px-4 py-4 text-sm text-muted-foreground md:px-5">
            <LockIcon className="mt-0.5 size-4 shrink-0" aria-hidden />
            Comments and reports are read by owners and admins. Agents never read them.
          </p>
        </div>
      </div>
    </Frame>
  )
}
