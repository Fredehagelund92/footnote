import * as React from 'react'
import { toast } from '@/lib/toast'
import { FAMILY_WORDS_MAX } from '@domain/family-meaning-line'
import { inlineSegments } from '@domain/markdown-blocks'
import { useWrite } from '@/api/queries'
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
import type { Family, FamilyMeaning } from '@/lib/definitions'
import { useReported } from '@/lib/reported'
import { cn } from '@/lib/utils'

// What a family of metrics means (FR-142, M1), in its quick view and on its page: the meaning, with
// each value it varies by as a small chip ("in Currency via Channel"), or on its page as the values
// it holds ("in EUR or USD"), one quiet line on where the words come from with Change for an owner,
// and one attention line when variants say something else. The owner's choice opens in a dialog loaded on first use: most definitions are no family.
// It is handed what it uses of the app (`meaningParts`): were it to import these itself, the
// bundler would split the code the first load shares with it into more chunks the first load
// then fetches too.

export const MeaningDialog = React.lazy(() => import('@/components/footnote/family-meaning-dialog'))

const n = (x: number) => x.toLocaleString('en-GB')

/**
 * The meaning's words, each value it varies by as the axis it stands for, in a chip, and the
 * Markdown its tool wrote drawn as the rest of a definition's words are (source-text.tsx). `code`
 * is how its code is drawn. Given `values`, a slot reads as the values it stands for instead, as
 * a sentence says them ("in EUR or USD"), dotted under; past three, as the axis.
 */
export function MeaningWords({
  meaning,
  by,
  code = 'text-xs',
  values,
}: {
  meaning: FamilyMeaning
  by: string[]
  code?: CodeLook
  /** The values each axis holds, for the slots to read as them. */
  values?: (axis: string) => string[]
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
        if (!part.startsWith('{') || !by.includes(axis))
          return <React.Fragment key={j}>{part}</React.Fragment>
        if (values) {
          const held = values(axis)
          return (
            <span
              key={j}
              title={`One metric for each ${axis}: ${listed(held)}`}
              className="cursor-help underline decoration-muted-foreground/50 decoration-dotted underline-offset-4"
            >
              {held.length && held.length <= 3 ? either(held) : axis}
            </span>
          )
        }
        return (
          <span
            key={j}
            className="mx-0.5 inline-flex h-5.5 items-center rounded-sm border bg-muted px-1.5 text-sm font-medium text-muted-foreground"
          >
            {axis}
          </span>
        )
      })}
    </Marks>
  ))
}

/** "EUR or USD", "EUR, USD or GBP": the values a slot may be. */
const either = (held: string[]) =>
  held.length < 2 ? (held[0] ?? '') : `${held.slice(0, -1).join(', ')} or ${held.at(-1)}`

/** "EUR, USD and GBP", or the first six and how many more. */
const listed = (held: string[]) => {
  const shown = held.slice(0, 6)
  const more = held.length - shown.length
  return more > 0
    ? `${shown.join(', ')} and ${n(more)} more`
    : shown.length < 2
      ? (shown[0] ?? '')
      : `${shown.slice(0, -1).join(', ')} and ${shown.at(-1)}`
}

/** The most variants whose own words a family with no meaning shows. */
const OWN_SHOWN = 4

/**
 * A family with no meaning yet, as a reader reads it (C1): its variants say what it is, each in
 * its own words after its values, as large as a meaning; past a few, how many more have words.
 */
export function VariantsOwnWords({
  family,
  code = 'text-xs',
  className,
}: {
  family: Pick<Family, 'variants'>
  code?: CodeLook
  className?: string
}) {
  const own = family.variants.filter((variant) => variant.description?.trim())
  if (!own.length)
    return (
      <p className={cn('text-muted-foreground', className)}>
        Its variants have no words of their own yet.
      </p>
    )
  const more = own.length - OWN_SHOWN
  return (
    <div className={className}>
      <p className="text-sm text-muted-foreground">
        Its {n(family.variants.length)} variants say what it is in their own words:
      </p>
      <ul aria-label="In its variants’ own words" className="mt-1.5 flex flex-col gap-1.5">
        {own.slice(0, OWN_SHOWN).map((variant) => (
          <li key={variant.name}>
            <span className="font-medium">{variant.values.join(', ') || variant.name}</span>
            {': '}
            <SourceText text={variant.description!.trim()} code={code} />
          </li>
        ))}
      </ul>
      {more > 0 && (
        <p className="mt-1.5 text-sm text-muted-foreground">
          {n(more)} more {more === 1 ? 'has words of its' : 'have words of their'} own.
        </p>
      )}
    </div>
  )
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
