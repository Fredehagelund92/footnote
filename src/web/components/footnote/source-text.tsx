import * as React from 'react'
import { cn } from '@/lib/utils'

/** A Markdown code span, as a tool's description quotes a name or a value: `FORECAST`. */
const CODE_SPAN = /`([^`\n]+)`/

/** A tool's description in plain words: its code spans without their backticks, for a tooltip. */
export const sourceWords = (text: string) => text.replace(new RegExp(CODE_SPAN, 'g'), '$1')

/**
 * A description as its tool wrote it, read-only: its code spans as code, and every other character
 * as it is. Nothing else of the tool's Markdown is drawn, so a description never reads differently
 * here than in the tool. Code is drawn as the editor draws it, a step smaller than the words
 * around it: `code` is that step.
 */
export function SourceText({
  text,
  code = 'text-xs',
}: {
  text: string
  code?: 'text-xs' | 'text-sm'
}) {
  // Splitting on a group keeps it: every odd part is a code span's text.
  return text.split(new RegExp(CODE_SPAN, 'g')).map((part, i) =>
    i % 2 ? (
      <code
        key={i}
        className={cn(
          'rounded-sm bg-(--rte-code-inline-bg) px-1.5 py-0.5 font-mono font-medium',
          code,
        )}
      >
        {part}
      </code>
    ) : (
      <React.Fragment key={i}>{part}</React.Fragment>
    ),
  )
}
