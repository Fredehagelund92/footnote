import {
  namesQuery,
  readQuestionQuery,
  useWorkspace,
  useWrite,
  workspaceQuery,
} from '@/api/queries'
import { WithAction } from '@/components/footnote/bits'
import { Cell } from '@/components/footnote/cell'
import { cardIcon } from '@/components/footnote/inbox-pane'
import { ChevronRightIcon, CircleCheckIcon, InboxIcon, MessageSquareIcon } from '@/components/icons'
import { SiteHeader } from '@/components/site-header'
import { Button } from '@/components/ui/button'
import {
  CardAction,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { openDock } from '@/lib/dock'
import { open } from '@/lib/events'
import { dueScope } from '@/lib/inbox-rows'
import { href, navigate, setQuery, useRoute } from '@/lib/router'
import { mayOpenSettings } from '@/lib/settings-access'
import { definitionsStep, setupHeading, setupSteps } from '@/lib/setup'
import { toast } from '@/lib/toast'
import { today } from '@/lib/today'
import { cn } from '@/lib/utils'
import { useAdminsSaid, useFacts, useMe } from '@/lib/workspace'
import { questionAbout } from '@/model/ask'
import { homeDomain, listOf, type Domain, type Person } from '@/model/people'
import { questionDates } from '@/model/validity'
import { useQuery } from '@tanstack/react-query'
import * as React from 'react'

const NamesDialog = React.lazy(() =>
  import('@/components/footnote/names-review').then((m) => ({ default: m.NamesDialog })),
)

/** Where the first context item goes, as the editor starts it, and who publishes it there. */
function whereContextGoes(me: Person, domains: Domain[]) {
  const home = homeDomain(me, domains)
  // A new install's first domain is made with its names.
  if (!home)
    return me.admin
      ? 'Context goes to the domain your names are published under.'
      : 'Context goes to a domain, and there is none yet: an admin adds one.'
  // Several of one's own: the editor starts on one, and the writer picks.
  const owned = domains.filter((domain) => me.owns.includes(domain.id) && !domain.sandbox).length
  if (owned > 1) return `Context goes to one of the ${owned} domains you own.`
  if (me.owns.includes(home.id)) return `Context goes to the domain ${home.name}, owned by you.`
  const by = home.owners.length ? `owned by ${listOf(home.owners)}` : 'which has no owner yet'
  return `Context goes to the domain ${home.name}, ${by}. ${
    me.admin ? 'As an admin, you publish it at once.' : 'Agents get it once an owner publishes it.'
  }`
}

/**
 * A new install's Inbox: the checklist, and what already waits, so a first test that changes a
 * definition sees its items Needs a recheck without finishing every step. `due` is how many.
 */
export function Setup({ due }: { due: number }) {
  const {
    setup: { done: setupDone, serverSource },
    domains: domainList,
    about,
  } = useWorkspace()
  const me = useMe()
  const write = useWrite()
  // A read ends a moment after a tool is connected: its names show here by themselves. Any left
  // for a look stay on their step, as the Inbox's cards wait for the checklist to end.
  const canPublish = me.admin || me.owns.length > 0
  const namesRead = useQuery({
    ...namesQuery(),
    enabled: canPublish,
    refetchInterval: setupDone.definitions || !canPublish ? false : 3000,
  })
  const names = namesRead.data?.names.filter((name) => name.state !== 'left_out')
  // The server's own definitions are read by themselves too: the checklist asks until that read
  // has ended, then counts it ended only once the names read after it are in, so the step goes
  // from the read on its way straight to its names.
  const reading = serverSource?.state === 'reading' && !setupDone.definitions
  const workspaceRead = useQuery({ ...workspaceQuery(), refetchInterval: reading ? 3000 : false })
  const [sawReading, setSawReading] = React.useState(reading)
  if (reading && !sawReading) setSawReading(true)
  const { refetch: refetchNames } = namesRead
  const ended = sawReading && serverSource?.state === 'read'
  React.useEffect(() => {
    if (ended) void refetchNames()
  }, [ended, refetchNames])
  const namesBehind = ended && canPublish && namesRead.dataUpdatedAt < workspaceRead.dataUpdatedAt
  // The first names published end the step. A decision reads only the names again, so while the
  // step is open the checklist reads the workspace once the names change.
  const revision = namesRead.data?.revision
  const lastRevision = React.useRef(revision)
  const { refetch: refetchWorkspace } = workspaceRead
  React.useEffect(() => {
    const was = lastRevision.current
    lastRevision.current = revision
    if (was !== undefined && revision !== was && !setupDone.definitions) void refetchWorkspace()
  }, [revision, setupDone.definitions, refetchWorkspace])
  // A step done says what it is, whatever read its names.
  const definitions = definitionsStep(
    setupDone.definitions || !serverSource
      ? null
      : { ...serverSource, state: namesBehind ? 'reading' : serverSource.state },
    names?.length ?? 0,
    namesRead.data?.place ?? null,
  )
  const [reviewing, setReviewing] = React.useState(false)
  const { query } = useRoute()
  const asked = canPublish && query.get('card') === 'names:waiting'
  const askedShow = query.get('show')
  // A question about the first item, from what it applies to or, if that is empty, its own words,
  // on its own dates when they miss today: most first items are about a day that has passed.
  // A new install has only what this visit added, newest first: the first one published.
  const item = useFacts().find((f) => f.status === 'Live' || f.status === 'Needs a recheck')
  const words = useQuery({
    ...readQuestionQuery(item ? `${item.title} ${item.summary}` : ''),
    enabled: !!item && !item.where.length,
  }).data
  const read =
    item && (item.where.length ? { metric: item.where[0], markets: item.where.slice(1) } : words)
  const firstQuestion = questionAbout(read, item ? questionDates(item.valid, today()) : '')
  const doneCount = setupSteps.filter((s) => setupDone[s.id]).length
  const admins = useAdminsSaid()
  // The steps done in an admin's Settings: anyone else reads who does them, and has no button.
  const inSettings: Record<string, string> = {
    ...(definitions.opens === 'names' ? {} : { definitions: '/settings/integrations' }),
  }
  // Written and not asked again yet: the step asks the question about it for you.
  const askAgain = !!item && !setupDone.fact
  const mayDo = (id: string) => mayOpenSettings(inSettings[id] ?? '', me)
  const first = setupSteps.find((s) => !setupDone[s.id] && mayDo(s.id))
  const go = (id: string) => {
    if (id === 'definitions' && definitions.opens === 'names') setReviewing(true)
    else if (id === 'definitions' && definitions.opens === 'source' && serverSource)
      navigate(`/settings/integrations/${serverSource.id}`)
    // The catalogue loads with the first page that needs it, never with the Inbox.
    else if (id === 'definitions')
      void import('@/model/catalogue').then(({ definitionsConnectHref }) =>
        navigate(definitionsConnectHref(), { setup: '1' }),
      )
    // A question in the person's own words: about a number they know, nothing written yet.
    if (id === 'ask') navigate('/ask', { setup: '1', n: 'setup' })
    // Once written, the same question about it again, typed in and ready to send.
    if (id === 'fact' && askAgain) navigate('/ask', { setup: '1', n: 'setup', q: firstQuestion })
    else if (id === 'fact') navigate('/context/new', { setup: '1' })
    if (id === 'agent') {
      void write('completeSetupStep', { step: 'agent' }).catch(() =>
        toast.error("Couldn't tick this step", { description: 'It stays open. Try again.' }),
      )
      open('connect')
    }
  }
  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* The same header as the Inbox in every state, so the page keeps its shape. */}
      <SiteHeader title="Inbox" icon={<InboxIcon />}>
        <Button
          variant="outline"
          size="icon"
          aria-label="Ask in the side panel"
          onClick={() => openDock('ask')}
        >
          <MessageSquareIcon />
        </Button>
      </SiteHeader>
      <div className="@container/main min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto flex w-full max-w-3xl flex-col p-4 md:p-6">
          {/* What already waits comes first: on a phone the checklist is two screens long. */}
          {due > 0 && <DueRow due={due} />}
          <div className="grid grid-cols-1 gap-px bg-border p-px">
            <Cell className="gap-0 py-0">
              <CardHeader className="border-b px-4 py-4 md:px-5">
                <CardTitle className="text-base">{setupHeading}</CardTitle>
                <CardDescription>
                  Your team writes down what the numbers don't show, and every agent reads it before
                  it answers. Name your metrics, ask, then write what you know: about ten minutes to
                  your first answer. {whereContextGoes(me, domainList)}
                </CardDescription>
                <CardAction className="text-xs text-muted-foreground tabular-nums">
                  {doneCount} of {setupSteps.length} done
                </CardAction>
              </CardHeader>
              <CardContent className="px-0">
                <ol className="flex flex-col divide-y divide-border">
                  {setupSteps.map((step, i) => {
                    const isDone = setupDone[step.id]
                    const own = step.id === 'definitions'
                    const action = !mayDo(step.id)
                      ? null
                      : own
                        ? definitions.action
                        : step.id === 'fact' && askAgain
                          ? 'Ask again'
                          : step.action
                    return (
                      <li
                        key={step.id}
                        className="flex min-h-16 items-center gap-3 px-4 py-3 @md:px-6"
                      >
                        <span
                          aria-hidden
                          className="flex size-10 shrink-0 items-center justify-center text-sm text-muted-foreground tabular-nums"
                        >
                          {isDone ? <CircleCheckIcon className="size-4 text-foreground" /> : i + 1}
                        </span>
                        <WithAction
                          action={
                            action !== null &&
                            (!isDone || (own && definitions.opens === 'names')) && (
                              <Button
                                variant={first?.id === step.id ? 'default' : 'outline'}
                                onClick={() => go(step.id)}
                              >
                                {action}
                              </Button>
                            )
                          }
                        >
                          <span className="block space-y-1">
                            <span
                              className={cn(
                                'block text-sm leading-snug',
                                isDone && 'text-muted-foreground line-through',
                              )}
                            >
                              {step.title}
                            </span>
                            <span
                              className="block text-xs text-muted-foreground"
                              aria-live={own ? 'polite' : undefined}
                            >
                              {own ? definitions.description : step.description}
                            </span>
                            {!isDone && !mayDo(step.id) && (
                              <span className="block text-xs text-muted-foreground">
                                An admin does this{admins}.
                              </span>
                            )}
                          </span>
                          {isDone && <span className="sr-only">Done</span>}
                        </WithAction>
                      </li>
                    )
                  })}
                </ol>
              </CardContent>
              {(!item || (!about.trim() && mayOpenSettings('/settings/general', me))) && (
                <CardFooter className="flex-col items-start gap-1 rounded-none border-t bg-background px-4 py-4 text-xs text-muted-foreground @md:px-6">
                  {!item && (
                    <p>
                      Until there is context, agents hear “Nothing is written down for this.” That
                      is the honest answer, not an error.
                    </p>
                  )}
                  {/* About our business left the steps: it is written from the names, once there are some. */}
                  {!about.trim() && mayOpenSettings('/settings/general', me) && (
                    <p>
                      Later, say what the business is about in{' '}
                      <a
                        href={href('/settings/general', { setup: '1' })}
                        className="underline underline-offset-4 hover:text-foreground"
                      >
                        About our business
                      </a>
                      . Ask and agents read it as background.
                    </p>
                  )}
                </CardFooter>
              )}
            </Cell>
          </div>
        </div>
      </div>
      {(reviewing || asked) && (
        <React.Suspense fallback={null}>
          <NamesDialog
            show={askedShow === 'families' || askedShow === 'names' ? askedShow : undefined}
            onClose={() => {
              setReviewing(false)
              if (asked) setQuery({ card: undefined, show: undefined })
            }}
          />
        </React.Suspense>
      )}
    </div>
  )
}

/**
 * The Inbox's Needs a recheck row, above the checklist while setup is unfinished: how many, in
 * whose domains, and a link to them in Context.
 */
function DueRow({ due }: { due: number }) {
  const me = useMe()
  const Icon = cardIcon.check
  return (
    <section aria-label="Needs you" className="mb-4 grid grid-cols-1 gap-px bg-border p-px">
      <Cell className="gap-0 py-0">
        <a
          href={href('/context', { status: 'due' })}
          className="flex min-h-16 items-center gap-3 px-4 py-3 outline-none hover:bg-muted/50 focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:ring-inset @md:px-6"
        >
          <span
            aria-hidden
            className="flex size-10 shrink-0 items-center justify-center text-muted-foreground"
          >
            <Icon className="size-4" />
          </span>
          <span className="min-w-0 flex-1 space-y-1">
            <span className="block text-sm leading-snug font-medium">
              Needs a recheck{' '}
              <span className="font-normal text-muted-foreground tabular-nums">
                {due.toLocaleString('en-GB')} {dueScope(me)}
              </span>
            </span>
            <span className="block text-xs text-muted-foreground">
              A definition they rely on changed in its tool, or their check date passed.
            </span>
          </span>
          <ChevronRightIcon aria-hidden className="size-4 shrink-0 text-muted-foreground" />
        </a>
      </Cell>
    </section>
  )
}
