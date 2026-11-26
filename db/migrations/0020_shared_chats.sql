-- Sharing an Ask chat as a link (FR-721): a person sends a copy of one chat on purpose, under
-- their name, and anyone signed in who has the link may open it. The copy holds each turn's
-- question, what Ask read, its state, its words and its sources by id, never a figure; a turn that
-- rests on a draft is kept as left out, with no words. A link lasts 90 days, its sender stops it
-- by deleting it, and an admin switch, on as installed, turns sharing off: then no link is made
-- and none opens. The MCP read path has no grant on it, and nothing an edition holds is built
-- from it.
insert into public.settings_versions (key, version, value, reason) values
  ('ask.share_chats', 1, 'true', 'default: on, and an admin can turn it off (FR-721)');

-- Whether chats may be shared now: on as installed, and when the setting is missing.
CREATE FUNCTION public.cl_share_chats_on() RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
  select coalesce((select value <> 'false'::jsonb from settings_current where key = 'ask.share_chats'), true) $$;

CREATE TABLE public.shared_chats (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    person_id uuid NOT NULL REFERENCES public.people(id),
    -- The chat's id in its sender's browser, so their History can say it is shared.
    chat_ref text NOT NULL,
    title text NOT NULL,
    turns jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    expires_at timestamp with time zone DEFAULT (now() + interval '90 days') NOT NULL,
    CONSTRAINT shared_chats_pkey PRIMARY KEY (id),
    CONSTRAINT shared_chats_chat_ref_check CHECK (chat_ref ~ '^[A-Za-z0-9_-]{1,80}$'),
    CONSTRAINT shared_chats_title_check CHECK (char_length(btrim(title)) BETWEEN 1 AND 500),
    CONSTRAINT shared_chats_turns_check CHECK (jsonb_typeof(turns) = 'array' AND jsonb_array_length(turns) BETWEEN 1 AND 100),
    CONSTRAINT shared_chats_life_check CHECK (expires_at > created_at AND expires_at <= created_at + interval '90 days')
);
CREATE INDEX shared_chats_person ON public.shared_chats (person_id, created_at);
CREATE INDEX shared_chats_expires ON public.shared_chats (expires_at);
ALTER TABLE public.shared_chats ENABLE ROW LEVEL SECURITY;
-- A person shares as themselves, while sharing is on.
CREATE POLICY shared_chats_insert ON public.shared_chats FOR INSERT
  WITH CHECK (person_id = public.cl_person() AND public.cl_share_chats_on());
-- Its sender reads their own links, to stop them; anyone signed in opens a live one, while
-- sharing is on.
CREATE POLICY shared_chats_read ON public.shared_chats FOR SELECT
  USING (person_id = public.cl_person()
         OR (public.cl_person() IS NOT NULL AND expires_at > now() AND public.cl_share_chats_on()));
-- Only its sender stops a link, and stopping it deletes the copy.
CREATE POLICY shared_chats_delete ON public.shared_chats FOR DELETE
  USING (person_id = public.cl_person());

-- Link reads are kept two days, and a shared chat until its link ends.
CREATE OR REPLACE FUNCTION public.cl_retention_run() RETURNS TABLE(what text, n bigint)
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
declare
  v_delivery int := (select (value #>> '{}')::int from settings_current where key = 'retention.delivery_days');
  v_requests int := (select (value #>> '{}')::int from settings_current where key = 'retention.request_log_days');
  v_outbox   int := (select (value #>> '{}')::int from settings_current where key = 'retention.outbox_days');
  v_notes    int := (select (value #>> '{}')::int from settings_current where key = 'retention.note_days');
  part record; cutoff timestamptz; dropped bigint := 0; k bigint;
begin
  if v_delivery is null or v_requests is null or v_outbox is null or v_notes is null
     or least(v_delivery, v_requests, v_outbox, v_notes) < 1 then
    raise exception 'retention periods must be set and at least one day' using errcode = '22023';
  end if;
  delete from gap_notes where created_hour < now() - make_interval(days => v_notes);                get diagnostics k = row_count; return query select 'gap_notes', k;
  update feedback set note = null where note is not null and created_hour < now() - make_interval(days => v_notes); get diagnostics k = row_count; return query select 'feedback_notes', k;
  delete from idempotency_keys where expires_at < now();                 get diagnostics k = row_count; return query select 'idempotency_keys', k;
  delete from llm_spend_daily where expires_at < now();                  get diagnostics k = row_count; return query select 'llm_spend_daily', k;
  delete from link_reads where read_at < now() - interval '2 days';      get diagnostics k = row_count; return query select 'link_reads', k;
  delete from shared_chats where expires_at <= now();                    get diagnostics k = row_count; return query select 'shared_chats', k;
  delete from inbox_items where created_at < now() - interval '90 days'; get diagnostics k = row_count; return query select 'inbox_items', k;
  delete from outbox_events where relayed_at < now() - make_interval(days => v_outbox); get diagnostics k = row_count; return query select 'outbox_events', k;
  for part in select c.relname, p.relname as parent, pg_get_expr(c.relpartbound, c.oid) as bound
                from pg_inherits i join pg_class c on c.oid = i.inhrelid join pg_class p on p.oid = i.inhparent
               where p.relname in ('deliveries', 'mcp_requests') and p.relnamespace = 'public'::regnamespace loop
    cutoff := (regexp_match(part.bound, 'TO \(''([^'']+)''\)'))[1]::timestamptz;      -- upper bound of the partition
    if cutoff < now() - make_interval(days => case part.parent when 'deliveries' then v_delivery else v_requests end) then
      execute format('alter table %I detach partition %I', part.parent, part.relname);
      execute format('drop table %I', part.relname); dropped := dropped + 1;
    end if;
  end loop;
  return query select 'partitions_dropped', dropped;
end $$;
