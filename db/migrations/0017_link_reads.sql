-- Reading a link a person pastes (FR-144): on as installed, and an admin can turn it off; the
-- hosts an admin lists are never read, nor their subdomains; and a person and the workspace may
-- read only so many links. The limits are counted here, so every service process sees them.
insert into public.settings_versions (key, version, value, reason) values
  ('links.read_pages', 1, 'true', 'default: on, and an admin can turn it off (FR-144)'),
  ('links.never_read_hosts', 1, '[]', 'default: no host listed (FR-144)'),
  ('limits.link_reads', 1, '{"person_per_hour": 20, "person_per_day": 60, "workspace_per_day": 300}', 'default (FR-144)');

-- One row a link read, failed or not: who and when, never the address. Kept two days, for the
-- limits only; nobody reads the table, cl_link_read_take counts it.
CREATE TABLE public.link_reads (
    person_id uuid NOT NULL REFERENCES public.people(id) ON DELETE CASCADE,
    read_at timestamp with time zone DEFAULT now() NOT NULL
);
CREATE INDEX link_reads_read_at_idx ON public.link_reads (read_at);
CREATE INDEX link_reads_person_idx ON public.link_reads (person_id, read_at);
ALTER TABLE public.link_reads ENABLE ROW LEVEL SECURITY;

-- Takes one link read for the person, or says which limit refuses it and in how many seconds the
-- next read is possible. One at a time across the workspace, so two processes cannot both pass
-- the last read. The limits are read here, never from the caller.
CREATE FUNCTION public.cl_link_read_take() RETURNS TABLE(refused text, reads integer, wait_seconds integer)
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
declare
  me uuid := cl_person();
  limits jsonb := (select value from settings_current where key = 'limits.link_reads');
  rule record;
  n integer;
  frees timestamptz;
begin
  if me is null then
    raise exception 'a link is read by a person' using errcode = 'insufficient_privilege';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('link_reads', 0));
  delete from link_reads where read_at < now() - interval '2 days';
  for rule in select * from (values
      ('person_hour', (limits->>'person_per_hour')::int, interval '1 hour', true),
      ('person_day', (limits->>'person_per_day')::int, interval '24 hours', true),
      ('workspace_day', (limits->>'workspace_per_day')::int, interval '24 hours', false)
    ) r(name, most, span, own) loop
    select count(*)::int into n from link_reads
     where read_at > now() - rule.span and (not rule.own or person_id = me);
    if rule.most is not null and n >= rule.most then
      -- The read that has to age out of the span before one more fits.
      select read_at + rule.span into frees from link_reads
       where read_at > now() - rule.span and (not rule.own or person_id = me)
       order by read_at offset n - rule.most limit 1;
      return query select rule.name, rule.most, greatest(1, ceil(extract(epoch from frees - now())))::int;
      return;
    end if;
  end loop;
  insert into link_reads (person_id) values (me);
  return query select null::text, null::integer, null::integer;
end $$;

-- Link reads are kept two days.
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
