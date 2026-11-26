/*
  Reading the Markdown the editor writes as blocks (paragraphs, headings, quotes, list items and
  rules), each with its words, marks, links and mentions and the lines it takes. The review's
  difference (doc-diff.ts), its pairing of blocks (block-pairs.ts) and the comparison's text
  (src/web/lib/passage-diff.ts) build on it; its own module so the web app loads it without the
  rest of doc-diff.ts. Pure: no clock, no input or output.
*/

/** The marks inline text can carry. */
export const marks = ['bold', 'italic', 'strike', 'code'] as const
export type Mark = (typeof marks)[number]

/** The shape of a block of text. */
export type BlockShape =
  | { type: 'paragraph' | 'quote' | 'rule' }
  | { type: 'heading'; level: number }
  | { type: 'bullet' | 'number'; depth: number }

/** Words, runs of spaces and single marks, so an address diffs by its parts. */
export const wordTokens = (text: string): string[] =>
  text.match(/[\p{L}\p{N}_]+|\s+|[^\p{L}\p{N}_\s]/gu) ?? []

/* Reading the Markdown the editor writes */

/** A run of inline text with its marks, its link and its mention. */
export type Segment = {
  text: string
  marks: ReadonlySet<Mark>
  href: string | null
  mention: { target: string; label: string } | null
}
/** A word, a run of spaces or a single mark of a block; a mention is one token. */
export type Token = { text: string; marks: string; href: string | null; mention: string | null }
/**
 * One block of the text: its shape, its words, and the lines of the Markdown it takes, from
 * `line` to `last` (1 is the first line).
 */
export type DocBlock = {
  shape: BlockShape
  text: string
  tokens: Token[]
  segments: Segment[]
  line: number
  last: number
}

const markOrder = (set: ReadonlySet<Mark>) => marks.filter((m) => set.has(m)).join(',')

const delimiters: { open: string; mark: Mark }[] = [
  { open: '**', mark: 'bold' },
  { open: '__', mark: 'bold' },
  { open: '~~', mark: 'strike' },
  { open: '*', mark: 'italic' },
  { open: '_', mark: 'italic' },
]

/** Where the bracket that closes an address starts at `from` is, past the pairs inside it ("a_(b)"); -1 when none. */
function closingParen(s: string, from: number): number {
  let depth = 0
  for (let i = from; i < s.length; i++) {
    if (s[i] === '(') depth++
    else if (s[i] === ')' && depth-- === 0) return i
  }
  return -1
}

/** Inline Markdown as runs of text with their marks, link and mention. */
export function inlineSegments(source: string): Segment[] {
  const out: Segment[] = []
  const push = (text: string, active: Set<Mark>, href: string | null) => {
    if (!text) return
    const last = out.at(-1)
    if (last && !last.mention && last.href === href && markOrder(last.marks) === markOrder(active))
      last.text += text
    else out.push({ text, marks: new Set(active), href, mention: null })
  }
  const walk = (s: string, active: Set<Mark>, href: string | null) => {
    let literal = ''
    const flush = () => {
      push(literal, active, href)
      literal = ''
    }
    for (let i = 0; i < s.length;) {
      const c = s[i]!
      if (c === '\\' && i + 1 < s.length && /[\\`*_~[\]()@#>+-]/.test(s[i + 1]!)) {
        literal += s[i + 1]
        i += 2
        continue
      }
      if (c === '@' && s[i + 1] === '[') {
        const close = s.indexOf('](', i + 2)
        const end = close < 0 ? -1 : closingParen(s, close + 2)
        if (close > i + 2 && end > close + 2 && !s.slice(i + 2, close).includes(']')) {
          flush()
          const label = s.slice(i + 2, close)
          out.push({
            text: label,
            marks: new Set(active),
            href,
            mention: { target: s.slice(close + 2, end), label },
          })
          i = end + 1
          continue
        }
      }
      if (c === '`') {
        const end = s.indexOf('`', i + 1)
        if (end > i + 1) {
          flush()
          push(s.slice(i + 1, end), new Set([...active, 'code']), href)
          i = end + 1
          continue
        }
      }
      if (c === '[' && href === null) {
        const close = s.indexOf('](', i + 1)
        const end = close < 0 ? -1 : closingParen(s, close + 2)
        if (close > i && end > close + 2 && !s.slice(i + 1, close).includes('[')) {
          flush()
          walk(s.slice(i + 1, close), active, s.slice(close + 2, end).trim())
          i = end + 1
          continue
        }
      }
      const delimiter = delimiters.find((d) => s.startsWith(d.open, i))
      if (delimiter && !active.has(delimiter.mark)) {
        const wordBefore = /[\p{L}\p{N}]/u.test(s[i - 1] ?? '')
        const inner = i + delimiter.open.length
        const end = s.indexOf(delimiter.open, inner + 1)
        const opens =
          end > inner &&
          !/\s/.test(s[inner] ?? ' ') &&
          !/\s/.test(s[end - 1] ?? ' ') &&
          !(delimiter.open.startsWith('_') && wordBefore)
        if (opens) {
          flush()
          walk(s.slice(inner, end), new Set([...active, delimiter.mark]), href)
          i = end + delimiter.open.length
          continue
        }
      }
      literal += c
      i++
    }
    flush()
  }
  walk(source, new Set(), null)
  return out
}

const segmentTokens = (segments: readonly Segment[]): Token[] =>
  segments.flatMap((segment): Token[] =>
    segment.mention
      ? [
          {
            text: segment.text,
            marks: markOrder(segment.marks),
            href: segment.href,
            mention: segment.mention.target,
          },
        ]
      : wordTokens(segment.text).map((text) => ({
          text,
          marks: markOrder(segment.marks),
          href: segment.href,
          mention: null,
        })),
  )

const block = (shape: BlockShape, source: string, line: number, last: number): DocBlock => {
  const segments = inlineSegments(source.replace(/\s*\n\s*/g, ' ').trim())
  const tokens = segmentTokens(segments)
  return { shape, segments, tokens, text: tokens.map((t) => t.text).join(''), line, last }
}

/** The blocks of a Markdown text: paragraphs, headings, quotes, list items and rules. */
export function markdownBlocks(markdown: string): DocBlock[] {
  const blocks: DocBlock[] = []
  // What is open, with the lines it took so far.
  type Open = { lines: string[]; line: number; last: number }
  let paragraph: Open | null = null
  let quote: Open | null = null
  let item: (Open & { shape: BlockShape }) | null = null
  const endParagraph = () => {
    if (paragraph)
      blocks.push(
        block({ type: 'paragraph' }, paragraph.lines.join('\n'), paragraph.line, paragraph.last),
      )
    paragraph = null
  }
  const endQuote = () => {
    if (quote) blocks.push(block({ type: 'quote' }, quote.lines.join('\n'), quote.line, quote.last))
    quote = null
  }
  const endItem = () => {
    if (item) blocks.push(block(item.shape, item.lines.join('\n'), item.line, item.last))
    item = null
  }
  const endAll = () => {
    endParagraph()
    endQuote()
    endItem()
  }
  const add = (open: Open | null, text: string, n: number): Open => {
    if (!open) return { lines: [text], line: n, last: n }
    open.lines.push(text)
    open.last = n
    return open
  }
  markdown
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .forEach((raw, index) => {
      const n = index + 1
      const line = raw.replace(/\s+$/, '')
      if (!line.trim()) return endAll()
      const heading = /^ {0,3}(#{1,6})\s+(.*?)(?:\s+#+)?$/.exec(line)
      const rule = /^ {0,3}([-*_])(?:\s*\1){2,}$/.test(line)
      const listItem = /^(\s*)([-*+]|\d{1,9}[.)])\s+(.*)$/.exec(line)
      const quoted = /^ {0,3}>\s?(.*)$/.exec(line)
      if (rule) {
        endAll()
        blocks.push({
          shape: { type: 'rule' },
          segments: [],
          tokens: [],
          text: '',
          line: n,
          last: n,
        })
      } else if (heading) {
        endAll()
        blocks.push(block({ type: 'heading', level: heading[1]!.length }, heading[2]!, n, n))
      } else if (listItem) {
        endParagraph()
        endQuote()
        endItem()
        const depth = Math.floor(listItem[1]!.replace(/\t/g, '  ').length / 2)
        const type = /\d/.test(listItem[2]!) ? 'number' : 'bullet'
        item = { shape: { type, depth }, lines: [listItem[3]!], line: n, last: n }
      } else if (quoted) {
        endParagraph()
        endItem()
        quote = add(quote, quoted[1]!, n)
      } else if (item && /^\s+/.test(line)) {
        add(item, line.trim(), n)
      } else {
        endQuote()
        endItem()
        paragraph = add(paragraph, line, n)
      }
    })
  endAll()
  return blocks
}
