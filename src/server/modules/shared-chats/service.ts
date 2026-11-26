import { ORPCError } from '@orpc/client'
import type {
  MyShare,
  MyShares,
  ShareChatInput,
  ShareTurn,
  SharedChat,
  SharedTurn,
} from '../../../contract/shared-chats.ts'
import type { Queryable } from '../../db/database.ts'

/*
  Chats shared as a link (FR-721). A person sends a copy of one Ask chat on purpose, under their
  name: each turn's question, what Ask read, its state, its words and its sources by id. A turn
  that cites a context item that was never published rests on a draft, and is kept as left out,
  with no words. Nothing else of the chat is kept, and no figure: the browser never sends one.

  Anyone signed in opens a live link, while the admin switch `ask.share_chats` is on. Each source
  is read as the reader when the link opens: one they may not read is left out in its place, and a
  turn that rests on one keeps its question and state without its words or what Ask read. A link lasts 90 days; its
  sender stops it, which deletes the copy, and cl_retention_run deletes it once it ends. Row
  security keeps every rule in the database too (db/migrations/0020_shared_chats.sql); the MCP read
  path has no grant on it.
*/

/** Times as ISO 8601, so the app reads them alike. */
const iso = (column: string) => `to_json(${column})#>>'{}'`

/** A turn as it is kept: what the browser sent, or left out, with why. */
type KeptTurn = ShareTurn | { left: 'draft' }

const mineColumns = `id::text, chat_ref as chat, title, ${iso('created_at')} as at,
       ${iso('expires_at')} as until, jsonb_array_length(turns) as turns,
       (select count(*)::int from jsonb_array_elements(turns) t where t ? 'left') as left`

async function sharingOn(tx: Queryable) {
  const [row] = await tx.query<{ on: boolean }>('select cl_share_chats_on() as on')
  return row?.on !== false
}

/** Of these context items, the ones that are published and that the person signed in may read. */
async function readable(tx: Queryable, ids: readonly string[]): Promise<Set<string>> {
  if (!ids.length) return new Set()
  const rows = await tx.query<{ id: string }>(
    `select distinct s.item_id as id from item_version_service s
      where s.item_id = any($1::text[]) and cl_item_open(s.item_id)`,
    [[...new Set(ids)]],
  )
  return new Set(rows.map((r) => r.id))
}

export function createSharedChatsService(tx: Queryable) {
  return {
    /** Keeps a copy of the chat under the sender's name and gives back its link. */
    async create(input: ShareChatInput): Promise<MyShare> {
      if (!(await sharingOn(tx)))
        throw new ORPCError('PRECONDITION_FAILED', {
          message: 'An admin has turned off sharing chats.',
        })
      // A source that was never published is a draft: only its writer reads it.
      const published = await readable(
        tx,
        input.turns.flatMap((t) => t.sources),
      )
      const turns: KeptTurn[] = input.turns.map((t) =>
        t.sources.every((id) => published.has(id)) ? t : { left: 'draft' },
      )
      const [row] = await tx.query<MyShare>(
        `insert into shared_chats (person_id, chat_ref, title, turns)
         values (cl_person(), $1, $2, $3::jsonb)
         returning ${mineColumns}`,
        [input.chat, input.title, JSON.stringify(turns)],
      )
      return row!
    },

    /** Whether chats may be shared now, and the person's own live links, newest first. */
    async mine(): Promise<MyShares> {
      const links = await tx.query<MyShare>(
        `select ${mineColumns} from shared_chats
          where person_id = cl_person() and expires_at > now()
          order by created_at desc, id desc limit 200`,
      )
      return { on: await sharingOn(tx), links }
    },

    /**
     * A shared chat as the person signed in opens it. A link that ended, was stopped, belongs to
     * someone no longer here, or opens while sharing is off, is one that does not exist.
     */
    async read(id: string): Promise<SharedChat> {
      const [row] = await tx.query<{
        id: string
        title: string
        personId: string
        name: string | null
        at: string
        until: string
        mine: boolean
        turns: KeptTurn[]
      }>(
        `select c.id::text, c.title, c.person_id::text as "personId", p.display_name as name,
                ${iso('c.created_at')} as at, ${iso('c.expires_at')} as until,
                c.person_id = cl_person() as mine, c.turns
           from shared_chats c join people p on p.id = c.person_id
          where c.id = $1 and c.expires_at > now() and cl_share_chats_on()
            and p.deactivated_at is null and p.erased_at is null`,
        [id],
      )
      if (!row)
        throw new ORPCError('NOT_FOUND', {
          message: "This link has stopped, or it isn't one of this workspace's.",
        })
      const open = await readable(
        tx,
        row.turns.flatMap((t) => ('left' in t ? [] : t.sources)),
      )
      const turns = row.turns.map((t): SharedTurn => {
        if ('left' in t) return { kind: 'left', why: t.left }
        const sources = t.sources.map((s) => (open.has(s) ? s : null))
        const whole = sources.every((s) => s !== null)
        return {
          kind: 'turn',
          question: t.question,
          read: whole ? t.read : [],
          state: t.state,
          words: whole ? t.words : null,
          sources,
        }
      })
      return {
        id: row.id,
        title: row.title,
        by: { personId: row.personId, name: row.name },
        at: row.at,
        until: row.until,
        mine: row.mine,
        turns,
      }
    },

    /** Stops one of the person's own links: its copy is deleted. */
    async stop(id: string): Promise<{ stopped: boolean }> {
      const rows = await tx.query(
        'delete from shared_chats where id = $1 and person_id = cl_person() returning id',
        [id],
      )
      return { stopped: rows.length > 0 }
    },
  }
}

export type SharedChatsService = ReturnType<typeof createSharedChatsService>
