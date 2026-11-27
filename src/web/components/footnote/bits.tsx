import type { CSSProperties, ReactNode } from 'react'
import { useDomains } from '@/lib/workspace'
import { diffWords } from 'diff/lib/diff/word.js'
import { BotIcon } from '@/components/icons'
import { cn } from '@/lib/utils'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { Badge } from '@/components/ui/badge'
import type { DomainId } from '@/model/items'

/* ---------- people ---------- */

// Soft tint, deep initials, picked from the name so one person keeps one colour everywhere: ten
// hues every 36 degrees round the wheel, drawn by the avatar tokens, so a face is a dark tint with
// light initials in dark mode. Every hue keeps its initials at 4.5:1 or better (the token test).
const HUES = Array.from({ length: 10 }, (_, i) => 20 + 36 * i)

function hash(s: string) {
  let h = 7
  for (const c of s) h = (h * 31 + c.charCodeAt(0)) >>> 0
  return h
}

const initials = (name: string) =>
  name
    .split(' ')
    .map((p) => p[0])
    .join('')
    .slice(0, 2)
    .toUpperCase()

/** A person: 28 in lists, 32 in the user menu. Initials are 12 px; a 20 px avatar has its two at
 *  9 px and a 16 px one its first at 9 px, so where the name is not beside it (View as on a phone)
 *  it is still a person and never a bare disc. A small one is hidden from a screen reader, which
 *  hears the name beside it or its control's label, and its letters are drawn, not written, so
 *  they never join the name in a copy or a search of the page. The name stays in its title. */
export function PersonAvatar({
  name,
  size = 28,
  className,
}: {
  name: string
  size?: 16 | 20 | 28 | 32
  className?: string
}) {
  const hue = HUES[hash(name) % HUES.length]!
  const small = size < 28
  return (
    <Avatar
      aria-hidden={small ? true : undefined}
      className={cn(
        size === 16 ? 'size-4' : size === 20 ? 'size-5' : size === 28 ? 'size-7' : 'size-8',
        className,
      )}
      title={name}
    >
      {/* The ink is inline so a row that forces its own text colour (a focused menu item) cannot
          take it: the initials keep their contrast on the tint in every row. */}
      <AvatarFallback
        data-initials={small ? initials(name).slice(0, size === 16 ? 1 : 2) : undefined}
        className="bg-avatar text-xs font-semibold"
        style={
          {
            '--avatar-h': hue,
            color: 'oklch(var(--avatar-ink-l) var(--avatar-ink-c) var(--avatar-h))',
            // Below the type scale on purpose: a mark, as an icon is, not words to read.
            ...(small && { fontSize: 9 }),
          } as CSSProperties
        }
      >
        {!small && initials(name)}
      </AvatarFallback>
    </Avatar>
  )
}

/** An agent that sent something with a person's OK. */
export function AgentAvatar({ size = 28 }: { size?: 28 | 32 }) {
  return (
    <Avatar className={size === 28 ? 'size-7' : 'size-8'}>
      <AvatarFallback className="bg-muted text-foreground">
        <BotIcon className="size-4" aria-hidden />
      </AvatarFallback>
    </Avatar>
  )
}

/* ---------- layout ---------- */

/**
 * Words with their button beside them, as a row's last part. Where the button would leave the
 * words a few to a line (under 28rem, a phone), it goes under them, as Google Drive's Replace key
 * does. `children` are the words, which take what the button leaves.
 */
export function WithAction({ children, action }: { children: ReactNode; action?: ReactNode }) {
  return (
    <div className="@container min-w-0 flex-1">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <div className="min-w-0 flex-1">{children}</div>
        {action && <div className="@max-md:basis-full">{action}</div>}
      </div>
    </div>
  )
}

/* ---------- context items ---------- */

export function DomainBadge({ id }: { id: DomainId }) {
  const domains = useDomains()
  return <Badge variant="outline">{domains[id]?.name}</Badge>
}

/* ---------- answer states ---------- */

// The answer line is its own module, so the docs site can show it without the app's data.
export { StateLine } from './state-line'

/* ---------- review ---------- */

/** Before and now in one line: what went struck out, what came in marked. */
export function WordDiff({ before, after }: { before: string; after: string }) {
  return (
    <p className="text-sm leading-relaxed">
      {diffWords(before, after).map((p, i) =>
        p.added ? (
          <ins
            key={i}
            className="rounded-sm bg-diff-add px-0.5 text-diff-add-ink underline decoration-diff-add-line/50"
          >
            {p.value}
          </ins>
        ) : p.removed ? (
          <del key={i} className="rounded-sm bg-diff-del px-0.5 text-diff-del-ink">
            {p.value}
          </del>
        ) : (
          <span key={i}>{p.value}</span>
        ),
      )}
    </p>
  )
}

/** One field of a suggestion: unchanged fields stay quiet, changed ones show the words that moved. */
export function FieldDiff({
  label,
  before,
  after,
}: {
  label: string
  before: string
  after: string
}) {
  const changed = before !== after
  return (
    <div className="grid gap-1.5 border-t py-3 first:border-t-0 first:pt-0 @lg:grid-cols-(--cols-lead-40) @lg:gap-4">
      <div className="flex items-center gap-2 text-sm text-muted-foreground @lg:flex-col @lg:items-start @lg:gap-1">
        {label}
        {changed && before && <Badge variant="secondary">Changed</Badge>}
      </div>
      {changed && before ? (
        <WordDiff before={before} after={after} />
      ) : (
        <p
          className={cn('text-sm leading-relaxed break-words', !changed && 'text-muted-foreground')}
        >
          {after}
        </p>
      )}
    </div>
  )
}
