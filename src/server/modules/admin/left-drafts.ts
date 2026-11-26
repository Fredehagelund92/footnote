import { ORPCError } from '@orpc/client'
import type { LeftDrafts } from '../../../contract/context.ts'
import type { Queryable } from '../../db/database.ts'

/*
  The drafts of people who left (FR-139). A draft is its writer's alone, so once they leave nobody
  reads it again: an admin sees only how many each left, and may delete them all, unread. The
  database does both (cl_left_drafts, cl_clear_left_drafts), since row security keeps the drafts
  from the admin.
*/

/** Everyone who left with drafts they never sent, most drafts first. */
export function leftDrafts(tx: Queryable): Promise<LeftDrafts[]> {
  return tx.query<LeftDrafts>(
    `select d.person_id::text as "personId", p.display_name as name, d.drafts
       from cl_left_drafts() d join people p on p.id = d.person_id
      order by d.drafts desc, p.display_name collate "en-x-icu", d.person_id`,
  )
}

/** Deletes every open draft of someone who left, and says how many. */
export async function clearLeftDrafts(tx: Queryable, personId: string) {
  const [row] = await tx
    .query<{ deleted: number }>('select cl_clear_left_drafts($1) as deleted', [personId])
    .catch((error: unknown) => {
      if ((error as { code?: string }).code === '23514')
        throw new ORPCError('CONFLICT', {
          message: 'Only the drafts of someone who left can be deleted here.',
        })
      throw error
    })
  return { deleted: row?.deleted ?? 0 }
}
