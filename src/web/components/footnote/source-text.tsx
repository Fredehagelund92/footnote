import * as React from 'react'
import {
  inlineSegments,
  markdownBlocks,
  type DocBlock,
  type Mark,
  type Segment,
} from '@domain/markdown-blocks'
import { safeHref } from '@/lib/host'
import { cn } from '@/lib/utils'

// Words a source wrote in Markdown, read-only: a tool's description of a definition, a quote
// copied from a document. The small subset the editor writes is drawn (bold, italic, struck
// through, code and links, in paragraphs and lists) from the one reading of it
// (src/domain/markdown-blocks.ts); nothing else is: no HTML, no images, no tables. Every other
// character stays as it is, and the stored text is never changed, so a copy keeps the marks.

/** Code, as the editor draws it: a step smaller than the words around it. */
const editorCode = 'rounded-sm bg-(--rte-code-inline-bg) px-1.5 py-0.5 font-mono font-medium'

/** Code in an answer's words and the review's comparison: the words' own size, on the muted tone. */
export const answerCode = 'rounded-xs bg-muted px-1 font-mono text-sm'

/** How a place draws code: the editor's look a step smaller than its words, or an answer's. */
export type CodeLook = 'text-xs' | 'text-sm' | 'answer'
export const codeLook = (look: CodeLook) => (look === 'answer' ? answerCode : cn(editorCode, look))

/**
 * Words with their marks, drawn the one way every Markdown reader here draws them: code, struck
 * through, italic, then bold outermost. `code` is the code's look where it is not the editor's.
 */
export function Marks({
  marks,
  code = cn(editorCode, 'text-xs'),
  children,
}: {
  marks: Iterable<Mark>
  code?: string
  children: React.ReactNode
}) {
  const set = new Set(marks)
  let node = children
  if (set.has('code')) node = <code className={code}>{node}</code>
  if (set.has('strike')) node = <s>{node}</s>
  if (set.has('italic')) node = <em>{node}</em>
  if (set.has('bold')) node = <strong className="font-semibold">{node}</strong>
  return <>{node}</>
}

/**
 * The words' runs: each its marks, and its link when that is safe and the place may hold one.
 * `words` draws a run's plain words, where they hold more than characters (item text's mentions).
 */
function runs(
  segments: readonly Segment[],
  code: string,
  links: boolean,
  words?: (text: string) => React.ReactNode,
) {
  return segments.map((s, i) => {
    const node = (
      <Marks key={i} marks={s.marks} code={code}>
        {words ? words(s.text) : s.text}
      </Marks>
    )
    const href = links ? safeHref(s.href) : null
    if (!href) return node
    return (
      <a
        key={i}
        href={href}
        target="_blank"
        rel="noreferrer"
        className="rounded-xs text-primary underline underline-offset-4 outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
      >
        {node}
        <span className="sr-only"> (opens in a new tab)</span>
      </a>
    )
  })
}

/** A tool's description in plain words, its marks taken off: for a tooltip. */
export const sourceWords = (text: string) =>
  inlineSegments(text)
    .map((s) => s.text)
    .join('')

/**
 * A description as its tool wrote it, on one line of the page: its marks drawn, its link as plain
 * words (a row or a button may not hold a link). `code` is how its code is drawn.
 */
export function SourceText({ text, code = 'text-xs' }: { text: string; code?: CodeLook }) {
  return runs(inlineSegments(text), codeLook(code), false)
}

/**
 * A line of item text as the editor wrote it (FR-119): its marks and safe links drawn, and its
 * plain words by `words`, which draws its mentions as chips.
 */
export function MarkedWords({
  text,
  words,
  code = 'text-sm',
}: {
  text: string
  words: (text: string) => React.ReactNode
  code?: CodeLook
}) {
  return runs(inlineSegments(text), codeLook(code), true, words)
}

/** Consecutive list items of one kind, so each list is one list. */
function grouped(blocks: readonly DocBlock[]) {
  const out: (DocBlock | { list: 'bullet' | 'number'; items: DocBlock[] })[] = []
  for (const b of blocks) {
    const type = b.shape.type
    if (type === 'rule') continue
    if (type !== 'bullet' && type !== 'number') {
      out.push(b)
      continue
    }
    const last = out.at(-1)
    if (last && 'list' in last && last.list === type) last.items.push(b)
    else out.push({ list: type, items: [b] })
  }
  return out
}

/**
 * Words a source wrote in Markdown, whole: its paragraphs and lists, its marks and its safe links,
 * which open in a new tab. A heading reads as a bold line, a quote inside it as a paragraph. A long
 * name or address breaks to fit. `code` is how its code is drawn.
 */
export function SourcePassages({
  text,
  code = 'text-xs',
  className,
}: {
  text: string
  code?: CodeLook
  className?: string
}) {
  const look = codeLook(code)
  return (
    <div className={cn('flex flex-col gap-2 wrap-anywhere', className)}>
      {grouped(markdownBlocks(text)).map((b, i) => {
        if ('list' in b) {
          const List = b.list === 'number' ? 'ol' : 'ul'
          return (
            <List
              key={i}
              className={cn(
                'ml-5 flex flex-col gap-1 marker:text-muted-foreground',
                b.list === 'number' ? 'list-decimal' : 'list-disc',
              )}
            >
              {b.items.map((item, j) => (
                <li key={j}>{runs(item.segments, look, true)}</li>
              ))}
            </List>
          )
        }
        return (
          <p key={i} className={b.shape.type === 'heading' ? 'font-semibold' : undefined}>
            {runs(b.segments, look, true)}
          </p>
        )
      })}
    </div>
  )
}
