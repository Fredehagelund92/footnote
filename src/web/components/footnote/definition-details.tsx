import * as React from 'react'
import { LockIcon, PencilIcon, TriangleAlertIcon } from '@/components/icons'
import { useQuery } from '@tanstack/react-query'
import { definitionHistoryQuery } from '@/api/queries'
import {
  ConflictNote,
  NoMeaning,
  OtherNameFor,
  SynonymTags,
} from '@/components/footnote/definition'
import { DocFold, Property } from '@/components/footnote/doc'
import { LISTED } from '@/components/footnote/family-variants'
import {
  MeaningDialog,
  MeaningWords,
  VariantsOwnWords,
  differingLine,
  meaningParts,
  meaningSource,
} from '@/components/footnote/family-meaning'
import { MentionText } from '@/components/footnote/mention-chip'
import { PeekAttention, PeekFact } from '@/components/footnote/peek'
import { Related } from '@/components/footnote/related'
import { ShowMoreButton } from '@/components/footnote/show-more'
import { SourcePassages } from '@/components/footnote/source-text'
import { VersionHistory } from '@/components/footnote/version-history'
import { Button } from '@/components/ui/button'
import { useRelated } from '@/hooks/use-related'
import { useShowMore } from '@/hooks/use-show-more'
import { familyBy, useGlossary, type Definition, type Family } from '@/lib/definitions'
import { openDock } from '@/lib/dock'
import { mentionId, plainText } from '@/lib/mentions'
import { useReadAhead } from '@/lib/read-ahead'
import { navigate, useRoute } from '@/lib/router'
import { cn } from '@/lib/utils'
import { useDomains, useFacts, useMe } from '@/lib/workspace'
import type { Fact } from '@/model/items'
import { foundSaid } from '@domain/family-found'

// A definition's own page (design direction A, "the sentence, large"): what it means, as the
// largest words on the page, with one quiet line under it on where the words come from and how
// to change them; then Also called, its other names, in one line; a metric's Built from tree and
// Used by, or a dimension's values; the context about it; and the rest as closed rows, each with
// a line of what it holds: Variants, How it is built, Where it comes from and History. Only the
// page shows it, so none of it is in the first load.

const n = (x: number) => x.toLocaleString('en-GB')

/** The sentence: 20 px on a phone, 24 px from a tablet up, at the reading measure. */
const sentence = 'max-w-reading text-xl text-pretty @md:text-2xl'

export function DefinitionDetails({
  d,
  variants,
  built,
  relations,
  values,
}: {
  d: Definition
  /** A family's variants, for its Variants row. */
  variants?: React.ReactNode
  /** How a family was found and how its variants are worked out, for its How it is built row. */
  built?: React.ReactNode
  /** What a metric is built from and what is built from it, shown open under its names. */
  relations?: React.ReactNode
  /** A dimension's values and the forms that add them, in place of the context about it. */
  values?: React.ReactNode
}) {
  const me = useMe()
  const canEdit = me.admin || (!!d.domain && me.owns.includes(d.domain))
  const facts = useFacts()
  const glossary = useGlossary()
  const domains = useDomains()
  const target = d.sameAs ? glossary.find(d.sameAs) : undefined
  const about = glossary.contextAbout(d, facts)
  const subject = target ? glossary.meaningOf(d) : d
  const related = useRelated(mentionId(d.type, d.name))
  const domain = d.domain ? (domains[d.domain]?.name ?? 'All domains') : 'All domains'
  const history = useQuery(definitionHistoryQuery(d.name)).data ?? []
  const { query } = useRoute()
  const tool = d.tool ?? 'its tool'
  const family = d.family
  const meaning = family?.meaning
  return (
    <div className="flex flex-col gap-6">
      <ConflictNote d={d} />
      {family ? (
        <FamilyMeaning d={d} family={family} />
      ) : (
        <div className="flex flex-col items-start gap-2">
          {target && <OtherNameFor target={target} />}
          {target ? (
            <div className={cn(sentence, 'text-muted-foreground')}>
              {subject.synced ? (
                <SourcePassages text={subject.definition} code="text-sm" />
              ) : (
                plainText(subject.definition)
              )}
            </div>
          ) : d.definition ? (
            <div className={sentence}>
              {d.synced ? (
                <SourcePassages text={d.definition} code="text-sm" />
              ) : (
                <MentionText text={d.definition} />
              )}
            </div>
          ) : (
            <p className={cn(sentence, 'text-muted-foreground')}>
              <NoMeaning d={d} />
            </p>
          )}
          {!target && (
            <p className="flex flex-wrap items-center gap-1 text-xs text-muted-foreground">
              {d.synced ? (
                <>
                  <LockIcon aria-hidden className="size-3 shrink-0" />
                  Read from {tool}. Change it there.
                </>
              ) : (
                <>
                  Written by {d.by}, {d.updated}.{' '}
                  <Button
                    variant="link"
                    className="h-auto p-0 text-xs"
                    onClick={() => navigate(`/definitions/${encodeURIComponent(d.name)}/edit`)}
                  >
                    Edit
                  </Button>
                </>
              )}
            </p>
          )}
        </div>
      )}
      {!d.sameAs && <SynonymTags d={d} canEdit={canEdit} inline />}
      {relations && <div className="border-t pt-6">{relations}</div>}
      <div className="border-t pt-6">
        {subject.type !== 'dimension' ? <ContextAbout subject={subject} about={about} /> : values}
      </div>
      <div className="-mt-2 flex flex-col border-t">
        {family && (
          <Row
            label="Variants"
            summary={`${n(family.variants.length)} - ${
              family.variants.length <= LISTED
                ? family.variants.map((v) => v.values.join(' ') || v.name).join(', ')
                : familyBy(family)
            }`}
            defaultOpen={query.get('variants') === 'other'}
          >
            {variants}
          </Row>
        )}
        {family && built && (
          <Row label="How it is built" summary={foundSaid(family.found, tool) ?? ''}>
            {built}
          </Row>
        )}
        <Row
          label="Where it comes from"
          summary={d.synced ? `${domain}, read from ${tool}` : `${domain}, written by ${d.by}`}
        >
          <div className="flex flex-col gap-2 text-sm">
            {d.synced ? (
              <PeekFact icon={LockIcon}>
                <b>{domain}</b> - read from {tool}, and changed only there
                {d.fileUrl && (
                  <>
                    {' '}
                    -{' '}
                    <a
                      href={d.fileUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="font-medium whitespace-nowrap text-primary underline-offset-4 hover:underline"
                    >
                      Open in source
                      <span className="sr-only"> (opens in a new tab)</span>
                    </a>
                  </>
                )}
              </PeekFact>
            ) : (
              <PeekFact icon={PencilIcon}>
                <b>{domain}</b> - written by <b>{d.by}</b> - {d.updated}
              </PeekFact>
            )}
            <dl className="flex flex-col gap-0.5">
              {family && meaning && meaningSource(family, meaning, tool) && (
                <Property label="Its words">
                  <span className="py-1">{meaningSource(family, meaning, tool)}</span>
                </Property>
              )}
              {d.synced && (d.ref || d.changed) && (
                <Property label="From">
                  <span className="py-1">
                    {d.ref && <span className="font-mono text-xs">{d.ref}</span>}
                    {d.changed && (
                      <span className="block text-xs text-muted-foreground">
                        Definition changed in {tool} on {d.changed}
                      </span>
                    )}
                  </span>
                </Property>
              )}
              {related.links.length > 0 && (
                <Property label="Related">
                  <Related id={mentionId(d.type, d.name)} />
                </Property>
              )}
            </dl>
          </div>
        </Row>
        <div className="border-b">
          <VersionHistory versions={history} canRestore={!d.synced && canEdit} label="History" />
        </div>
      </div>
    </div>
  )
}

/** One closed row of the page, 44 px, with a line of what it holds while it is closed. */
function Row({
  label,
  summary,
  defaultOpen,
  children,
}: {
  label: string
  summary: string
  defaultOpen?: boolean
  children: React.ReactNode
}) {
  return (
    <div className="border-b">
      <DocFold label={label} summary={summary} defaultOpen={defaultOpen}>
        <div className="pt-1 pb-4">{children}</div>
      </DocFold>
    </div>
  )
}

/**
 * A family's meaning as the page's sentence, each value it varies by read as the values it holds
 * ("in EUR or USD"), with where the words come from and Change the words for an owner of its
 * domain or an admin, and the variants that say something else.
 */
function FamilyMeaning({ d, family }: { d: Definition; family: Family }) {
  const me = useMe()
  const [changing, setChanging] = React.useState(false)
  const meaning = family.meaning
  const tool = d.tool ?? 'its tool'
  const values = React.useCallback(
    (axis: string) => {
      const i = family.by.indexOf(axis)
      return [...new Set(family.variants.map((v) => v.values[i] ?? ''))].filter(Boolean)
    },
    [family],
  )
  if (!meaning)
    return (
      <p className={sentence}>
        Its {n(family.variants.length)} variants differ only {familyBy(family)}.
      </p>
    )
  // Words the tool writes for the family are changed there.
  const canChange =
    meaning.source !== 'declared' && (me.admin || (!!d.domain && me.owns.includes(d.domain)))
  // A variant converted from another says how, which its row shows: it says nothing else.
  const converted = new Set((family.conversions ?? []).map((c) => c.to))
  const differing = differingLine({
    ...meaning,
    differing: meaning.differing.filter((name) => !converted.has(name)),
  })
  const source =
    meaning.source === 'declared'
      ? `Written for the family in ${tool}. Change it there.`
      : meaning.source === 'written'
        ? `${meaningSource(family, meaning, tool)}.`
        : meaning.words
          ? 'Worked out from its variants.'
          : ''
  return (
    <div className="flex flex-col items-start gap-2">
      {meaning.words ? (
        <p className={sentence}>
          <MeaningWords meaning={meaning} by={family.by} code="text-sm" values={values} />
        </p>
      ) : (
        <VariantsOwnWords family={family} className="max-w-reading text-base" />
      )}
      {(source || canChange) && (
        <p className="flex flex-wrap items-center gap-1 text-xs text-muted-foreground">
          {meaning.source === 'declared' && <LockIcon aria-hidden className="size-3 shrink-0" />}
          {source}
          {canChange && (
            <Button variant="link" className="h-auto p-0 text-xs" onClick={() => setChanging(true)}>
              Change the words
            </Button>
          )}
        </p>
      )}
      {differing && <PeekAttention icon={TriangleAlertIcon}>{differing}</PeekAttention>}
      {changing && (
        <React.Suspense fallback={null}>
          <MeaningDialog
            name={d.name}
            family={family}
            parts={meaningParts}
            onClose={() => setChanging(false)}
          />
        </React.Suspense>
      )}
    </div>
  )
}

/** The context about a definition: the first five, then more on request, so the page grows instead of a box scrolling. */
function ContextAbout({ subject, about }: { subject: Definition; about: Fact[] }) {
  const ahead = useReadAhead()
  const { shown, more, next, showMore } = useShowMore(about, 5, 10)
  const domains = useDomains()
  return (
    <div className="flex flex-col gap-2">
      <p className="text-sm font-medium">
        Context about {subject.name}{' '}
        <span className="font-normal text-muted-foreground tabular-nums">{about.length}</span>
      </p>
      {about.length ? (
        shown.map((f) => (
          <button
            key={f.id}
            type="button"
            {...ahead(f.id)}
            onClick={() => openDock('context', f.id)}
            className="rounded-md border px-3 py-2 text-left text-sm outline-none hover:bg-muted/50 focus-visible:ring-3 focus-visible:ring-ring/50"
          >
            <span className="line-clamp-1">{f.title}</span>
            <span className="text-xs text-muted-foreground">
              {domains[f.domain]?.name}, {f.where.join(', ')}
            </span>
          </button>
        ))
      ) : (
        <p className="text-sm text-muted-foreground">
          No context yet. Agents asking about {subject.name} hear that nothing is written down.
        </p>
      )}
      <ShowMoreButton more={more} next={next} onClick={showMore} />
    </div>
  )
}
