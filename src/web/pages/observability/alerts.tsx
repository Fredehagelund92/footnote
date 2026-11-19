import * as React from 'react'
import { ArrowUpRightIcon, BellIcon, UsersIcon } from '@/components/icons'
import { keepPreviousData, useInfiniteQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '@/api'
import { queryKeys, useAlerts, useWrite } from '@/api/queries'
import { alertRule } from '@domain/alerts'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@/components/ui/empty'
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { Frame, FrameSection } from '@/components/footnote/frame'
import { Loadable, LoadError, RefreshError } from '@/components/footnote/load-state'
import { ObsSkeleton } from '@/components/obs/obs-skeleton'
import { DomainChip } from '@/components/obs/controls'
import { DomainDot } from '@/components/footnote/tag-chip'
import { ShowMoreButton } from '@/components/footnote/show-more'
import { TextSwitch, type TextOption } from '@/components/footnote/switches'
import {
  lastOf,
  rulesFor,
  thresholdOf,
  type AlertSettings,
  type RaisedPage,
  type Rule,
  type RuleId,
} from '@/model/alerts'
import type { DomainId } from '@/model/items'
import { OBS_PURPOSE, useDomainChoice, useObsPageQuery, useObsView } from '@/lib/obs'
import { useDomains, useMe } from '@/lib/workspace'
import { ObsPage } from '@/pages/observability'

// Alerts: what raises a card in the Inbox, as rules of one sentence each, and what was raised
// lately. The Inbox is the only place an alert goes. An admin turns a rule off for everyone and
// changes its threshold in the sentence; an owner mutes a rule for their own domains.

/** How many raises a page of Raised lately holds, as the service reads them. */
const RAISED_PAGE = 20

export function AlertsPage() {
  const load = useObsPageQuery('alerts')
  return (
    <ObsPage section="alerts">
      <Loadable
        query={load}
        what="the alerts"
        skeleton={<ObsSkeleton section="alerts" body="rules" />}
      >
        <Alerts />
      </Loadable>
    </ObsPage>
  )
}

function Alerts() {
  const view = useObsView()
  const me = useMe()
  const { rules: all, raised, settings: s } = useAlerts()
  const rules = rulesFor(all, me.admin)
  const owned = view.owned
  const choice = useDomainChoice()
  const head = 'text-xs font-medium text-muted-foreground'
  return (
    <Frame>
      <FrameSection
        title="Alerts"
        description={OBS_PURPOSE.alerts}
        action={<DomainChip value={choice.asked} choices={choice.choices} all />}
      />
      <section aria-labelledby="alert-rules" className="border-t">
        <h3 id="alert-rules" className="sr-only">
          Rules
        </h3>
        <div
          aria-hidden
          className="hidden grid-cols-(--cols-alerts) gap-x-4 border-b bg-band px-5 py-2.5 @4xl/main:grid"
        >
          <span className={head}>When</span>
          <span className={head}>What happens</span>
          <span className={head}>Last raised</span>
          <span className={cn(head, 'text-right')}>{me.admin ? 'On' : 'For you'}</span>
        </div>
        <ul>
          {rules.map((r) => (
            <RuleRow
              key={r.id}
              rule={r}
              admin={me.admin}
              owned={owned}
              empty={view.state === 'empty'}
              state={s}
            />
          ))}
        </ul>
        {!me.admin && (
          <p className="border-b px-4 py-3 text-xs text-muted-foreground md:px-5">
            {all.length - rules.length} more rules go only to admins: about spend, failed calls and
            the whole workspace.
          </p>
        )}
      </section>

      <RaisedLately first={raised} empty={view.state === 'empty'} domain={choice.asked} />
      <p className="flex items-start gap-2 border-t px-4 py-4 text-sm text-muted-foreground md:px-5">
        <UsersIcon className="mt-0.5 size-4 shrink-0" aria-hidden />
        Owners see and mute alerts for their own domains. Admins turn rules off and change the
        levels. Email and chat are for later.
      </p>
    </Frame>
  )
}

/**
 * What the rules raised, of one rule or of all, a page at a time. The first page of all is the one
 * the Alerts read holds, so the list opens with it; Show more reads the next. Its key sits under
 * the Alerts read's, so what refreshes that refreshes these too. Another rule keeps the rows on
 * screen until its own have loaded.
 */
export function useRaisedPages(
  rule: RuleId | null,
  domain: DomainId | undefined,
  first: RaisedPage,
) {
  const client = useQueryClient()
  return useInfiniteQuery({
    queryKey: [...queryKeys.alerts, 'raised', rule ?? 'all', domain ?? 'all'],
    queryFn: ({ pageParam }) =>
      api.getRaised({
        ...(rule ? { rule } : {}),
        ...(domain ? { domain } : {}),
        ...(pageParam ? { after: pageParam } : {}),
      }),
    initialPageParam: '',
    getNextPageParam: (last) => last.next ?? undefined,
    ...(rule === null && !domain
      ? {
          initialData: { pages: [first], pageParams: [''] },
          initialDataUpdatedAt: () => client.getQueryState(queryKeys.alerts)?.dataUpdatedAt,
        }
      : {}),
    placeholderData: keepPreviousData,
  })
}

/**
 * What the rules raised, newest first, and how many: "20 of 198", by rule with each one's count, so
 * a rare raise (Conflict, Not found) is one click away under many check-date reminders, and Show
 * more for the older ones. An owner reads only their own domains' raises.
 */
export function RaisedLately({
  first,
  empty,
  domain,
}: {
  first: RaisedPage
  empty: boolean
  domain: DomainId | undefined
}) {
  const domains = useDomains()
  const [rule, setRule] = React.useState<RuleId | null>(null)
  const pages = useRaisedPages(rule, domain, first)
  const counts = pages.data?.pages[0] ?? first
  const raised = empty ? [] : (pages.data?.pages.flatMap((p) => p.raised) ?? [])
  const of = rule ? (counts.byRule.find((c) => c.rule === rule)?.count ?? 0) : counts.total
  const stale = pages.isPlaceholderData
  const left = of - raised.length
  const switches: TextOption<RuleId | 'all'>[] = [
    { value: 'all', label: 'All', count: counts.total },
    ...counts.byRule.map((c) => ({ value: c.rule, label: alertRule(c.rule).name, count: c.count })),
  ]
  return (
    <FrameSection
      title="Raised lately"
      description={
        raised.length && !stale
          ? `${raised.length < of ? `${raised.length} of ${of}` : `All ${of}`}, newest first. Each one is a card in the Inbox.`
          : 'Each one is a card in the Inbox.'
      }
      className="border-t-0"
    >
      {/* Every rule that raised, on one line: a narrow page scrolls it sideways. */}
      {!empty && counts.byRule.length > 1 && (
        <div className="overflow-x-auto px-4 pb-3 md:px-5">
          <TextSwitch
            label="Raised by rule"
            options={switches}
            value={rule ?? 'all'}
            onChange={(v) => setRule(v === 'all' ? null : v)}
          />
        </div>
      )}
      {pages.isError && !pages.data ? (
        <LoadError what="the raises" onRetry={() => void pages.refetch()} className="border-t" />
      ) : raised.length ? (
        <ul aria-label="Raised lately" aria-busy={stale} className="border-t">
          {raised.map((r) => (
            <li
              key={r.id}
              className="flex flex-wrap items-start gap-x-3 gap-y-1 border-b px-4 py-3 last:border-b-0 md:px-5"
            >
              <span className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-md border text-muted-foreground">
                <BellIcon className="size-4" aria-hidden />
              </span>
              <div className="min-w-0 flex-1">
                <a href={r.href} className="text-sm font-medium underline-offset-4 hover:underline">
                  {r.title}
                </a>
                <p className="text-xs text-muted-foreground">
                  {r.domain && (
                    <span className="mr-1.5 inline-flex items-center gap-1.5 align-middle">
                      <DomainDot id={r.domain} />
                      {domains[r.domain]?.name} -
                    </span>
                  )}{' '}
                  {r.line}
                </p>
              </div>
              <span className="shrink-0 text-xs whitespace-nowrap text-muted-foreground max-sm:basis-full max-sm:pl-11">
                {r.when}
              </span>
            </li>
          ))}
          {pages.isFetchNextPageError && (
            <li>
              <RefreshError
                what="more raises"
                onRetry={() => void pages.fetchNextPage()}
                className="border-t-0"
              />
            </li>
          )}
          {pages.hasNextPage && !stale && (
            <li className="border-t px-4 py-2 md:px-5">
              <ShowMoreButton
                more={left}
                next={Math.min(RAISED_PAGE, left)}
                onClick={() => void pages.fetchNextPage()}
              />
            </li>
          )}
        </ul>
      ) : (
        <Empty className="border-t py-10">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <BellIcon />
            </EmptyMedia>
            <EmptyTitle>
              {empty ? 'Nothing has raised an alert yet' : 'Nothing raised for your domains lately'}
            </EmptyTitle>
            <EmptyDescription>
              When a rule above fires, its card goes to the Inbox and shows here too.
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      )}
    </FrameSection>
  )
}

function RuleRow({
  rule: r,
  admin,
  owned,
  empty,
  state,
}: {
  rule: Rule
  admin: boolean
  owned: DomainId[] | null
  empty: boolean
  state: AlertSettings
}) {
  const domains = useDomains()
  const write = useWrite()
  const setRuleOn = (id: Rule['id'], on: boolean) => void write('setAlertRule', { id, on })
  const setMuted = (id: Rule['id'], ds: DomainId[], muted: boolean) =>
    void write('muteAlert', { id, domains: ds, muted })
  const setThreshold = (id: Rule['id'], value: string) =>
    void write('setAlertThreshold', { id, value })
  const mine = owned ?? []
  const muted = !admin && mine.length > 0 && mine.every((d) => state.muted[r.id]?.includes(d))
  const on = admin ? !state.off.includes(r.id) : !muted
  const where = mine.map((d) => domains[d]?.name).join(' and ')
  const value = thresholdOf(r, state)
  const [before, after] = r.when.split('{n}')
  const seen = lastOf(r, owned)
  const last = empty ? 'Never' : seen.last

  const toggle = (next: boolean) => {
    if (admin) {
      setRuleOn(r.id, next)
      toast(next ? `Turned on: ${r.name}` : `Turned off: ${r.name}`, {
        description: next
          ? 'It raises cards in the Inbox again.'
          : 'Nothing raises this card until it is on again.',
        action: { label: 'Undo', onClick: () => setRuleOn(r.id, !next) },
      })
    } else {
      setMuted(r.id, mine, !next)
      toast(next ? `Unmuted for ${where}` : `Muted for ${where}`, {
        description: next
          ? 'Its cards reach you again.'
          : 'Its cards stop reaching you. Other owners and admins still get them.',
        action: { label: 'Undo', onClick: () => setMuted(r.id, mine, next) },
      })
    }
  }

  return (
    <li
      className={cn(
        'grid grid-cols-(--cols-trail-auto) gap-x-4 gap-y-1 border-b px-4 py-3.5 md:px-5 @4xl/main:grid-cols-(--cols-alerts) @4xl/main:items-center',
        !on && '[&_[data-dim]]:text-muted-foreground',
      )}
    >
      <div className="min-w-0">
        <p data-dim className="flex flex-wrap items-center gap-2 text-sm font-medium">
          {r.name}
          {r.isNew && (
            <span className="inline-flex h-5 items-center rounded-md border px-1.5 text-xs font-normal text-muted-foreground">
              New
            </span>
          )}
        </p>
        <p className="mt-0.5 text-xs text-muted-foreground">
          {r.threshold && after !== undefined ? (
            <>
              {before}
              {admin ? (
                <Select
                  value={value}
                  onValueChange={(v) => {
                    const was = value
                    setThreshold(r.id, v as string)
                    toast('Level changed', {
                      description: `${r.name}: ${before}${v}${after}.`,
                      action: { label: 'Undo', onClick: () => setThreshold(r.id, was!) },
                    })
                  }}
                >
                  <SelectTrigger
                    size="sm"
                    aria-label={`${r.name}: level`}
                    className="mx-0.5 inline-flex h-6 gap-1 px-1.5 align-baseline text-sm text-foreground"
                  >
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectGroup>
                      {r.threshold.choices.map((c) => (
                        <SelectItem key={c} value={c}>
                          {c}
                        </SelectItem>
                      ))}
                    </SelectGroup>
                  </SelectContent>
                </Select>
              ) : (
                <span className="font-medium text-foreground">{value}</span>
              )}
              {after}
            </>
          ) : (
            r.when
          )}
        </p>
      </div>
      <div className="col-start-2 row-start-1 flex items-start justify-end pt-0.5 @4xl/main:col-start-4 @4xl/main:items-center @4xl/main:pt-0">
        <Switch
          checked={on}
          onCheckedChange={toggle}
          aria-label={admin ? r.name : `${r.name}, for ${where}`}
        />
      </div>
      <p data-dim className="text-sm @4xl/main:col-start-2 @4xl/main:row-start-1">
        <span className="text-muted-foreground @4xl/main:sr-only">Then: </span>
        {r.then}
      </p>
      <p className="col-span-2 text-xs text-muted-foreground @4xl/main:col-span-1 @4xl/main:col-start-3 @4xl/main:row-start-1">
        <span className="@4xl/main:sr-only">Last raised: </span>
        {seen.href && last !== 'Never' ? (
          <a
            href={seen.href}
            className="inline-flex items-center gap-1 underline-offset-4 hover:text-foreground hover:underline"
          >
            {last}
            <ArrowUpRightIcon className="size-3" aria-hidden />
          </a>
        ) : (
          last
        )}
        {!admin && muted && <span className="ml-1.5">- muted for {where}</span>}
      </p>
    </li>
  )
}
