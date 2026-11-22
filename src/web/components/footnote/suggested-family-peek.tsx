import * as React from 'react'
import type { SourceNameRead } from '@contract/inbox'
import type { FamilyParts } from '@/components/footnote/family-parts'
import {
  BoldNames,
  FamilyHead,
  FamilyPartsProvider,
  RefsSaid,
  ValueRows,
  useParts,
} from '@/components/footnote/family-peek'

// A family the Names card offers, before an owner publishes it (FR-141, FR-142, F4): the same
// panel as a published family's, so an owner sees what it would mean, the values its variants
// hold and who owns it before they answer. Two answers: publish them as one family, or keep them
// separate, each variant by its own name. Leave out stays on the card.

const n = (x: number) => x.toLocaleString('en-GB')

type Suggested = SourceNameRead & { family: NonNullable<SourceNameRead['family']> }

/** Why Footnote offers these as one family, in the tool's name (D1). */
function whyOne(name: Suggested, familyBy: FamilyParts['familyBy']): string {
  const { family, tool } = name
  const by = familyBy({ by: family.by, variants: [] })
  return family.found === 'declared'
    ? `${tool} declares these ${n(family.variants)} metrics as one family, ${by}.`
    : family.found === 'calculation'
      ? `${tool} has ${n(family.variants)} metrics worked out the same way apart from ${family.by.join(' and ')}.`
      : `These ${n(family.variants)} metrics have one name apart from ${family.by.join(' and ')}, and nothing in ${tool} says they are one metric.`
}

/** Where the words it would mean come from, in one line; empty for none, which says why itself. */
function sourceSaid(name: Suggested): string {
  const { meaning, variants } = name.family
  if (!meaning) return ''
  if (meaning.source === 'declared') return `Written for the family in ${name.tool}`
  if (meaning.source !== 'common') return ''
  return meaning.agree === variants
    ? `Common words of all ${n(variants)} variants`
    : `Common words of ${n(meaning.agree)} of ${n(variants)} variants`
}

export default function SuggestedFamilyPeek({
  parts,
  nameKey,
}: {
  parts: FamilyParts
  nameKey: string
}) {
  return (
    <FamilyPartsProvider parts={parts}>
      <SuggestedFamily nameKey={nameKey} />
    </FamilyPartsProvider>
  )
}

function SuggestedFamily({ nameKey }: { nameKey: string }) {
  const P = useParts()
  const read = P.useQuery(P.namesQuery())
  const domains = P.useDomains()
  const me = P.useMe()
  const write = P.useWrite()
  const online = P.useOnline()
  const [busy, setBusy] = React.useState(false)
  if (!read.data) return <P.DockWaiting title="Suggested family" />
  const found = read.data.names.find((x) => x.key === nameKey)
  if (!found?.family)
    return (
      <P.DockFrame title="Suggested family">
        <P.DockMissing>
          This family no longer waits on the Names card. It may have been published or left out.
        </P.DockMissing>
      </P.DockFrame>
    )
  const name = found as Suggested
  const { family } = name
  const revision = read.data.revision
  const joining = name.linked.length > 0
  const domain = name.areaId ? domains[name.areaId] : undefined
  const owners = domain?.owners ?? []
  // An owner of its domain or an admin decides, as the service lets them; anyone else reads who.
  const mayDecide = me.admin || (!!name.areaId && me.owns.includes(name.areaId))
  // Its tool declares it one family, or it is live already and gains variants: no other answer.
  const mayKeepApart = !joining && family.found !== 'declared'
  const problems = name.flags.filter((flag) => flag.code !== 'look_alike')
  const meaning = family.meaning && {
    source: family.meaning.source,
    words: family.meaning.words,
    differing: [],
    revision: 0,
  }
  const source = sourceSaid(name)

  const decide = async (apart: boolean) => {
    setBusy(true)
    try {
      await write('decideNames', {
        revision,
        accept: [{ key: name.key, ...(apart ? { apart: true as const } : {}) }],
        leaveOut: [],
      })
      P.toast(
        apart
          ? `${n(family.variants)} metrics are published separately`
          : `${name.name} is published as a family`,
      )
      P.closeDock()
    } catch (e) {
      P.toast(apart ? "Couldn't keep them separate" : "Couldn't publish the family", {
        description: P.toApiError(e).message,
      })
    } finally {
      setBusy(false)
    }
  }

  return (
    <P.DockFrame
      title="Suggested family"
      quietTitle
      footer={
        mayDecide && (
          <>
            {mayKeepApart && (
              <P.Button
                variant="outline"
                disabled={busy || !online}
                onClick={() => void decide(true)}
              >
                Keep them separate
              </P.Button>
            )}
            <P.Button disabled={busy || !online} onClick={() => void decide(false)}>
              <P.LayersIcon data-icon="inline-start" />
              {name.linked.length ? 'Publish its new variants' : 'Publish as a family'}
            </P.Button>
          </>
        )
      }
    >
      <P.PeekBands>
        <P.PeekBand first>
          <FamilyHead
            name={name.name}
            family={family}
            count={family.variants}
            suggested
            joining={joining}
          />
          {meaning && (
            <p className="mt-3 text-base leading-7 text-pretty">
              <P.MeaningWords meaning={meaning} by={family.by} />
            </p>
          )}
          {source && (
            <p className="mt-2 flex items-start gap-1.5 text-xs leading-5 text-muted-foreground">
              {family.meaning?.source === 'declared' ? (
                <P.LockIcon aria-hidden className="mt-0.75 size-3.5 shrink-0" />
              ) : (
                <P.SparklesIcon aria-hidden className="mt-0.75 size-3.5 shrink-0" />
              )}
              <span className="min-w-0">{source}</span>
            </p>
          )}
          {family.meaning?.words && family.meaning.differing > 0 && (
            <P.PeekAttention icon={P.TriangleAlertIcon}>
              {family.meaning.differing === 1
                ? '1 variant says'
                : `${n(family.meaning.differing)} variants say`}{' '}
              something else.
            </P.PeekAttention>
          )}
          {problems.length > 0 && (
            <P.PeekAttention icon={P.TriangleAlertIcon}>
              {problems.map((flag) => flag.message).join(' ')}
            </P.PeekAttention>
          )}
          <div
            role="note"
            className="mt-4 flex items-start gap-2.5 rounded-frame border bg-muted/60 py-2.5 pr-3 pl-3 text-sm"
          >
            <P.LayersIcon aria-hidden className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
            <p className="min-w-0 text-pretty">
              {whyOne(name, P.familyBy)}{' '}
              {joining
                ? 'These variants join the live family.'
                : 'Published as a family, people and agents see one name.'}{' '}
              {domain ? `An owner of ${domain.name} decides.` : 'An admin decides.'}
            </p>
          </div>
        </P.PeekBand>
        <P.PeekBand label="Varies by">
          <P.PeekLabel>Varies by</P.PeekLabel>
          <ValueRows by={family.by} values={family.values} />
          {family.names.length > 0 && (
            <p className="mt-3 text-xs leading-5 text-muted-foreground">
              Its variants: {family.names.join(', ')}
            </p>
          )}
        </P.PeekBand>
        <P.PeekBand label="Where it comes from">
          <P.PeekFacts>
            <P.PeekFact icon={P.LockIcon}>
              <b>{domain?.name ?? 'No domain yet'}</b> - read from {name.tool}, and changed there
            </P.PeekFact>
            {owners.length > 0 && (
              <P.PeekFact icon={P.UserIcon}>
                Owned by <BoldNames names={owners} />
              </P.PeekFact>
            )}
            <P.PeekFact icon={P.CircleDotIcon}>
              {family.found === 'declared'
                ? `Declared as one family in ${name.tool}`
                : family.found === 'calculation'
                  ? `Found from the calculation in ${name.tool}`
                  : 'Found by its names alone'}
            </P.PeekFact>
          </P.PeekFacts>
        </P.PeekBand>
        <P.PeekBand flush>
          <P.PeekDetails
            rows={[
              [
                'Type',
                joining
                  ? 'Family of metrics, with new variants waiting'
                  : 'Family of metrics, not published yet',
              ],
              [
                `${name.tool} names`,
                <RefsSaid
                  key="v"
                  refs={name.definitionRefs.filter((ref) => !name.linked.includes(ref))}
                />,
              ],
            ]}
            links={[]}
          />
        </P.PeekBand>
      </P.PeekBands>
    </P.DockFrame>
  )
}
