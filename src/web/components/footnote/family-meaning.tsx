import * as React from 'react'
import { toast } from '@/lib/toast'
import { FAMILY_WORDS_MAX } from '@domain/family-meaning-line'
import { inlineSegments } from '@domain/markdown-blocks'
import { useWrite } from '@/api/queries'
import { TriangleAlertIcon } from '@/components/icons'
import { PeekAttention } from '@/components/footnote/peek'
import { Marks, SourceText, codeLook, type CodeLook } from '@/components/footnote/source-text'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import { Textarea } from '@/components/ui/textarea'
import type { Definition, Family, FamilyMeaning } from '@/lib/definitions'
import { useReported } from '@/lib/reported'
import { useMe } from '@/lib/workspace'

// What a family of metrics means (FR-142, M1), in its quick view and on its page: the meaning, with
// each value it varies by as a small chip ("in Currency via Channel"), one quiet line on where the
// words come from with Change for an owner, and one attention line when variants say something
// else. The owner's choice opens in a dialog loaded on first use: most definitions are no family.
// It is handed what it uses of the app (`meaningParts`): were it to import these itself, the
// bundler would split the code the first load shares with it into more chunks the first load
// then fetches too.

export const MeaningDialog = React.lazy(() => import('@/components/footnote/family-meaning-dialog'))

const n = (x: number) => x.toLocaleString('en-GB')

/**
 * The meaning's words, each value it varies by as the axis it stands for, in a chip, and the
 * Markdown its tool wrote drawn as the rest of a definition's words are (source-text.tsx). `code`
 * is how its code is drawn.
 */
export function MeaningWords({
  meaning,
  by,
  code = 'text-xs',
}: {
  meaning: FamilyMeaning
  by: string[]
  code?: CodeLook
}) {
  if (!meaning.words)
    return (
      <span className="text-muted-foreground">
        No meaning yet: no words speak for all its variants.
      </span>
    )
  // The marks are read over the whole words first, so a mark around a slot keeps the slot inside it.
  return inlineSegments(meaning.words).map((segment, i) => (
    <Marks key={i} marks={segment.marks} code={codeLook(code)}>
      {segment.text.split(/(\{[^{}]+\})/).map((part, j) => {
        const axis = part.slice(1, -1)
        return part.startsWith('{') && by.includes(axis) ? (
          <span
            key={j}
            className="mx-0.5 inline-flex h-5.5 items-center rounded-sm border bg-muted px-1.5 text-sm font-medium text-muted-foreground"
          >
            {axis}
          </span>
        ) : (
          <React.Fragment key={j}>{part}</React.Fragment>
        )
      })}
    </Marks>
  ))
}

/** What the owner's dialog uses of the app, handed to it as its parts. */
export const meaningParts = {
  toast,
  useWrite,
  useReported,
  FAMILY_WORDS_MAX,
  MeaningWords,
  Button,
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  RadioGroup,
  RadioGroupItem,
  Textarea,
  SourceText,
}
export type MeaningParts = typeof meaningParts

/** Where the meaning's words come from, in one line; none for no meaning, which says why. */
export function meaningSource(family: Family, meaning: FamilyMeaning, tool: string): string {
  const { source, chosen } = meaning
  const by = `by ${chosen?.by} on ${chosen?.on}`
  return source === 'declared'
    ? `Written for the family in ${tool}`
    : source === 'written'
      ? `Written for the family ${by}`
      : source === 'common' && meaning.base
        ? `Words of ${meaning.base}, the variant the others are converted from`
        : source === 'common'
          ? `Common words of ${n(meaning.common!.agree)} of ${n(family.variants.length)} variants, chosen automatically`
          : ''
}

/** Variants that say something else: named when they are few, counted when many. */
export function differingLine(meaning: FamilyMeaning): string | null {
  const differing = meaning.differing
  if (!differing.length) return null
  if (differing.length === 1) return `${differing[0]} says something else.`
  if (differing.length <= 3)
    return `${differing.slice(0, -1).join(', ')} and ${differing.at(-1)} say something else.`
  return `${n(differing.length)} variants say something else.`
}

/**
 * A family's meaning: its words, where they come from (and Change, for an owner of its domain or
 * an admin), and the variants that say something else.
 */
export function FamilyMeaningBlock({
  d,
  family,
  className,
}: {
  d: Pick<Definition, 'name' | 'domain' | 'tool'>
  family: Family
  className?: string
}) {
  const me = useMe()
  const [changing, setChanging] = React.useState(false)
  const meaning = family.meaning
  if (!meaning) return null
  // Words the tool writes for the family are changed there.
  const canChange =
    meaning.source !== 'declared' && (me.admin || (!!d.domain && me.owns.includes(d.domain)))
  // A variant converted from another says how, which the page shows: it says nothing else.
  const converted = new Set((family.conversions ?? []).map((c) => c.to))
  const differing = differingLine({
    ...meaning,
    differing: meaning.differing.filter((name) => !converted.has(name)),
  })
  const source = meaningSource(family, meaning, d.tool ?? 'its tool')
  return (
    <div className={className}>
      <p>
        <MeaningWords meaning={meaning} by={family.by} />
      </p>
      {(source || canChange) && (
        <p className="mt-1.5 text-xs leading-5 text-muted-foreground">
          {source}
          {canChange && (
            <span className="whitespace-nowrap">
              {source && ' - '}
              <Button
                variant="link"
                className="h-auto p-0 text-xs"
                onClick={() => setChanging(true)}
              >
                Change
              </Button>
            </span>
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
