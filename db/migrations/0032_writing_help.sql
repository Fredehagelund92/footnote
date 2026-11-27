-- Writing help (Route 3, slice S1): Footnote's own help for writing one draft, in a dock beside
-- the editor. A model changes the fields of the person's own draft, as the person, through the
-- write path an agent's write_draft uses, and never sends it. The draft's words go to the model
-- provider set for Ask, so it is off as installed and an admin turns it on. A person may use it
-- only so many times a day, and paste only so much at once.
insert into public.settings_versions (key, version, value, reason) values
  ('writing_help.on', 1, 'false', 'default: off until an admin turns it on, since a draft''s words then go to the model provider'),
  ('limits.writing_help', 1, '{"turns_per_day": 40, "paste_characters": 12000}', 'default');

-- Its model calls are counted on their own in the spend ledger, under the same monthly limit as
-- each other feature starts with.
insert into public.settings_versions (key, version, value, reason)
select key, version + 1, value || '{"writing_help": 250000000}'::jsonb, 'writing help has a monthly limit of its own'
  from public.settings_current
 where key = 'limits.llm_feature_monthly_micros' and not (value ? 'writing_help');

-- A draft started in writing help says so, as one started in the form or by an agent does.
ALTER TYPE public.creation_channel ADD VALUE 'writing_help';

-- Writing help is a writer of a draft's fields beside the person's agent and a content source's
-- read: the owner sees which fields only it wrote.
ALTER TABLE public.proposals
  DROP CONSTRAINT proposals_provenance_check,
  ADD CONSTRAINT proposals_provenance_check CHECK (((provenance IS NULL) OR ((jsonb_typeof(provenance) = 'object'::text) AND ((provenance ->> 'by'::text) = ANY (ARRAY['agent'::text, 'source'::text, 'writing_help'::text])) AND (jsonb_typeof((provenance -> 'fields'::text)) = 'object'::text) AND (jsonb_typeof((provenance -> 'flags'::text)) = 'array'::text))));

-- One row a turn of writing help, finished or not: who and when, never a word of it. Kept two
-- days, for the daily limit only; nobody reads the table, cl_writing_help_turn_take counts it.
CREATE TABLE public.writing_help_turns (
    person_id uuid NOT NULL REFERENCES public.people(id) ON DELETE CASCADE,
    taken_at timestamp with time zone DEFAULT now() NOT NULL
);
CREATE INDEX writing_help_turns_person_idx ON public.writing_help_turns (person_id, taken_at);
CREATE INDEX writing_help_turns_taken_at_idx ON public.writing_help_turns (taken_at);
ALTER TABLE public.writing_help_turns ENABLE ROW LEVEL SECURITY;

-- Takes one turn for the person, or says how many they took in the last 24 hours and in how many
-- seconds the next one is possible. One at a time for a person, so two requests cannot both pass
-- the last turn. The limit is read here, never from the caller.
CREATE FUNCTION public.cl_writing_help_turn_take() RETURNS TABLE(refused boolean, turns integer, wait_seconds integer)
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
declare
  me uuid := cl_person();
  most integer := coalesce((select (value->>'turns_per_day')::int from settings_current where key = 'limits.writing_help'), 40);
  n integer;
  frees timestamptz;
begin
  if me is null then
    raise exception 'a turn of writing help is taken by a person' using errcode = 'insufficient_privilege';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('writing_help_turn:' || me::text, 0));
  select count(*)::int into n from writing_help_turns
   where person_id = me and taken_at > now() - interval '24 hours';
  if n >= most then
    -- The turn that has to age out of the day before one more fits.
    select taken_at + interval '24 hours' into frees from writing_help_turns
     where person_id = me and taken_at > now() - interval '24 hours'
     order by taken_at offset n - most limit 1;
    return query select true, most, greatest(1, ceil(extract(epoch from frees - now())))::int;
    return;
  end if;
  insert into writing_help_turns (person_id) values (me);
  return query select false, n + 1, null::integer;
end $$;

-- Turns of writing help are kept two days, as link reads are.
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
  delete from writing_help_turns where taken_at < now() - interval '2 days'; get diagnostics k = row_count; return query select 'writing_help_turns', k;
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
