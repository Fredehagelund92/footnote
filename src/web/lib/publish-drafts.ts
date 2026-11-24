import type { Undoable } from '@/api/client'
import { useWrite } from '@/api/queries'
import { ApiError } from '@/api/errors'
import { planFacts, publishesNow, publishParts, type Me, type Skip } from '@/lib/bulk'
import { today } from '@/lib/today'
import { useDomains, useMe } from '@/lib/workspace'
import type { Fact } from '@/model/items'
import type { Domains } from '@/model/people'
import { dateLabel } from '@/model/validity'

// The person's own drafts published as they are, as the Context list's Publish does (FR-139): at
// once where they own the domain or are an admin, and sent to the domain's owners elsewhere. A
// draft's page, the editor and the Inbox's drafts card publish this way.

/** Which of the drafts publish at once, which go to the owners, and to which domains. */
export function publishSplit(rows: readonly Fact[], me: Me, domains: Domains) {
  const plan = planFacts('publish', [...rows], me, domains)
  const sending = plan.act.filter((f) => !publishesNow(f, me, domains))
  const publishing = plan.act.filter((f) => !sending.includes(f))
  return {
    plan,
    publishing,
    sending,
    publish: publishing.length,
    send: sending.length,
    to: [...new Set(sending.map((f) => domains[f.domain]?.name))].join(' and '),
  }
}

export type DraftsPublished = {
  published: Fact[]
  sent: Fact[]
  failed: Fact[]
  /** What the editor's or the service's checks kept back, with why. */
  skipped: Skip[]
  /** The domains whose owners got a suggestion, by name: "Marketing and Sales". */
  to: string
  undo: Undoable['undo']
}

/**
 * Publishes the drafts, and says what it did; `summary` is its line in History. Refused, with the
 * first reason, when none of them can go.
 */
export function usePublishDrafts() {
  const me = useMe()
  const domains = useDomains()
  const write = useWrite()
  return async (rows: readonly Fact[], summary: string): Promise<DraftsPublished> => {
    const who = { name: me.name, admin: me.admin }
    const { plan } = publishSplit(rows, who, domains)
    if (!plan.act.length)
      throw new ApiError('invalid', plan.skipped[0]?.reason ?? 'There is no draft to publish.')
    const parts = publishParts(plan, who, domains, dateLabel(today()))
    const result = await write('applyBulk', {
      action: 'publish',
      patches: parts.patches,
      remove: [],
      ...(parts.suggest.length ? { suggest: parts.suggest } : {}),
      entry: {
        id: `log-publish-${Date.now().toString(36)}`,
        on: today(),
        who: me.name,
        what: 'published',
        summary,
        items: plan.act.map((f) => ({ id: f.id, title: f.title, domain: f.domain })),
      },
    })
    const done = plan.act.filter((f) => result.done.includes(f.id))
    return {
      published: done.filter((f) => !parts.suggest.includes(f.id)),
      sent: done.filter((f) => parts.suggest.includes(f.id)),
      failed: plan.act.filter((f) => result.failed.includes(f.id)),
      skipped: [...plan.skipped, ...(result.skipped ?? [])],
      to: parts.to,
      undo: result.undo,
    }
  }
}
