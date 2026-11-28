import * as React from 'react'
import { CircleDashedIcon, FileTextIcon, UserPlusIcon } from '@/components/icons'
import { WithAction } from '@/components/footnote/bits'
import { Button } from '@/components/ui/button'
import { useDefinitions, useInbox } from '@/api/queries'
import { contextAbout } from '@/lib/definitions'
import { navigate } from '@/lib/router'
import { mayOpenSettings } from '@/lib/settings-access'
import { nextStepWords, nextSteps, nextWords, NEXT_UNTIL, type NextStep } from '@/lib/next-steps'
import { servedToAgents } from '@/model/items'
import { useFacts, useMe } from '@/lib/workspace'

const nextIcons: Record<NextStep['kind'], typeof CircleDashedIcon> = {
  metric: CircleDashedIcon,
  people: UserPlusIcon,
  documents: FileTextIcon,
}

/**
 * What to write next once the setup checklist is done (FR-816, the owner's call 3): until five
 * context items are published, the metrics nothing is written about, those agents asked about
 * first, and for an admin a colleague who knows and the team's documents. It goes by itself.
 */
export function NextCard() {
  const me = useMe()
  const facts = useFacts()
  const definitions = useDefinitions()
  const { cards } = useInbox()
  const published = facts.filter(servedToAgents).length
  const steps = React.useMemo(() => {
    // Counted first: a workspace past its first days never reads its coverage here.
    if (published >= NEXT_UNTIL) return null
    const metrics = definitions.filter((d) => d.type === 'metric' && !d.sameAs)
    return nextSteps({
      published,
      uncovered: metrics
        .filter((d) => contextAbout(definitions, d, facts).length === 0)
        .map((d) => d.name),
      asked: cards.flatMap((card) => (card.type === 'gap' ? (card.gap?.scope ?? []) : [])),
      admin: mayOpenSettings('/settings/people', me),
    })
  }, [published, definitions, facts, cards, me])
  if (!steps) return null
  const words = nextWords(published)
  const go = (step: NextStep) => {
    if (step.kind === 'metric') navigate('/context/new', { metric: step.metric })
    if (step.kind === 'people') navigate('/settings/people')
    if (step.kind === 'documents') navigate('/settings/integrations')
  }
  return (
    <section aria-labelledby="inbox-next" className="border-t">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 px-4 pt-4 @md:px-5">
        <h2 id="inbox-next" className="text-sm font-medium">
          {words.heading}
        </h2>
        <span className="text-xs text-muted-foreground tabular-nums">{words.count}</span>
        <p className="w-full text-xs text-muted-foreground">{words.description}</p>
      </div>
      <ol className="flex flex-col divide-y divide-border pt-1">
        {steps.map((step) => {
          const said = nextStepWords(step)
          const Icon = nextIcons[step.kind]
          return (
            <li
              key={step.kind === 'metric' ? step.metric : step.kind}
              className="flex min-h-14 items-center gap-3 px-4 py-2.5 @md:px-5"
            >
              <span
                aria-hidden
                className="flex size-8 shrink-0 items-center justify-center text-muted-foreground"
              >
                <Icon className="size-4" />
              </span>
              <WithAction
                action={
                  <Button variant="outline" onClick={() => go(step)}>
                    {said.action}
                  </Button>
                }
              >
                <span className="block space-y-1">
                  <span className="block text-sm leading-snug">{said.title}</span>
                  <span className="block text-xs text-muted-foreground">{said.description}</span>
                </span>
              </WithAction>
            </li>
          )
        })}
      </ol>
    </section>
  )
}
