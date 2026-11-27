import { CircleCheckIcon, CircleHelpIcon, CircleXIcon, TriangleAlertIcon } from '@/components/icons'
import { cn } from '@/lib/utils'
import { Mark } from '@/components/footnote/mark'
import { KindLabel } from '@/components/footnote/review-parts'
import type { Review } from '@/model/review'

// The parts only the full review draws: the claim check and the words that read like orders. Apart
// from review-parts.tsx, which the Inbox's quick review loads up front, so they load on demand with
// the review page.

/** An agent's claims, each against the sentence it copied from the source. Footnote didn't open the page. */
export function ClaimCheck({
  claims,
  from,
  drafted,
}: {
  claims: NonNullable<Review['claims']>
  from: string
  drafted?: boolean
}) {
  const verdict = {
    same: { icon: CircleCheckIcon, label: 'Same', cls: 'text-foreground' },
    check: { icon: CircleHelpIcon, label: 'Not sure. Compare them.', cls: 'text-caution' },
    different: { icon: CircleXIcon, label: 'Different', cls: 'text-destructive' },
  } as const
  return (
    <section className="flex flex-col gap-3 py-2">
      <header className="flex items-center gap-2">
        <KindLabel kind="Added" />
        <span className="text-xs text-muted-foreground">Compared with the source</span>
      </header>
      <p className="text-sm text-muted-foreground">
        {drafted
          ? 'The draft copied this sentence from the source.'
          : `The agent copied this sentence from the source, with ${from}'s OK.`}{' '}
        The numbers, dates and names in the summary are compared with it.{' '}
        {drafted ? 'Nobody opened the page yet.' : 'It did not open the page.'}
      </p>
      <blockquote className="rounded-frame bg-muted px-3 py-2 text-sm italic">
        “{claims.sentence}”
      </blockquote>
      <div className="overflow-hidden rounded-frame border">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-muted/50 text-left text-xs text-muted-foreground">
              <th className="px-3 py-2 font-medium">In the summary</th>
              <th className="px-3 py-2 font-medium">In the copied sentence</th>
              <th className="w-36 px-3 py-2 font-medium">Same?</th>
            </tr>
          </thead>
          <tbody>
            {claims.rows.map((r) => {
              const v = verdict[r.same]
              return (
                <tr key={r.claim} className="border-t">
                  <td className="px-3 py-2.5">{r.claim}</td>
                  <td className="px-3 py-2.5 text-muted-foreground">{r.source}</td>
                  {/* On a phone the verdict wraps under its icon's line, so the table keeps to its frame. */}
                  <td
                    className={cn(
                      'px-3 py-2.5 font-medium whitespace-nowrap @max-md:whitespace-normal',
                      v.cls,
                    )}
                  >
                    <span className="inline-flex items-start gap-1.5">
                      <v.icon aria-hidden className="mt-0.5 size-4 shrink-0" />
                      {v.label}
                    </span>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </section>
  )
}

/**
 * Words of the suggestion that read like orders to an AI agent (NFR-024), by the field they are
 * in. Agents get them as words, never as orders; the reviewer decides whether they belong.
 */
export function InstructionWarning({ found }: { found: NonNullable<Review['instructionLike']> }) {
  return (
    <section
      aria-label="Words that read like orders"
      className="mb-6 flex flex-col gap-3 border-b pb-6"
    >
      <header className="flex items-center gap-2">
        <TriangleAlertIcon aria-hidden className="size-4 shrink-0 text-caution" />
        <Mark role="needs" icon={false} className="text-sm">
          Some words read like orders to an AI agent
        </Mark>
      </header>
      <p className="text-sm text-muted-foreground">
        Agents get them as words to read, never as orders. Check that they belong in it before you
        publish.
      </p>
      <dl className="grid gap-x-4 gap-y-1.5 text-sm sm:grid-cols-(--cols-lead-40)">
        {found.map((f) => (
          <div key={f.field} className="contents">
            <dt className="text-muted-foreground">{f.field}</dt>
            <dd>{f.words.map((w) => `“${w}”`).join(', ')}</dd>
          </div>
        ))}
      </dl>
    </section>
  )
}
