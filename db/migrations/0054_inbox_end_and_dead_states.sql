-- 0054_inbox_end_and_dead_states: an Inbox item has an end, and what nothing writes goes.
--
-- - An Inbox item is deleted by the retention run 90 days after it came. `read_at` and
--   `archived_at` had no writer (a card is read and done in `card_reads` and `decisions`), so
--   retention, which deleted on `archived_at`, never deleted a row. Both columns go, and so does
--   the unread index on them.
-- - A deleted domain cannot be restored: no call did it, and the message that promised it is gone.
--   The restore columns, their checks, keys and policy, the guard that let one restore happen once,
--   and the edition reason `area_restored` go. A deletion record is now written once and never
--   changed, as the other records of what happened are. A domain has at most one, since its id
--   stays with history for good.
-- - An evaluation run is never made `estimated` (it is the column's old default): it starts
--   `awaiting_approval` or `queued`.

-- An Inbox item has an end.
drop index public.inbox_unread;
alter table public.inbox_items drop column read_at, drop column archived_at;
create index inbox_items_created on public.inbox_items using btree (created_at);

create or replace function public.cl_retention_run() returns table(what text, n bigint)
    language plpgsql security definer
    set search_path to 'public', 'pg_temp'
    as $$
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

-- A deleted domain is not restored.
drop trigger area_deletions_update on public.area_deletions;
drop function public.area_deletions_guard_update();
drop policy area_deletions_restore on public.area_deletions;
drop index public.area_deletions_open;
alter table public.area_deletions
  drop constraint area_deletions_check,
  drop constraint area_deletions_check1,
  drop column restored_by,
  drop column restored_at,
  drop column restored_edition;
create unique index area_deletions_once on public.area_deletions using btree (area_id);
create trigger area_deletions_update before update on public.area_deletions
  for each row execute function public.cl_forbid_mutation();

-- Nothing writes `area_restored`. The type is made again without it; `edition_open` names the type.
drop function public.edition_open(public.edition_reason, uuid, text, bigint);
alter table public.editions drop constraint editions_check;
alter type public.edition_reason rename to edition_reason_before;
create type public.edition_reason as enum (
    'bootstrap',
    'proposal_accepted',
    'item_retired',
    'vocabulary_changed',
    'area_state_changed',
    'area_map_changed',
    'source_rechecked',
    'rollback',
    'item_restored',
    'area_deleted',
    'decision_undone'
);
alter table public.editions
  alter column reason type public.edition_reason using reason::text::public.edition_reason,
  add constraint editions_check check ((reason = 'rollback'::public.edition_reason) = (restores_seq is not null));
drop type public.edition_reason_before;
create function public.edition_open(p_reason public.edition_reason, p_actor uuid, p_note text DEFAULT NULL::text, p_restores bigint DEFAULT NULL::bigint) returns bigint
    language plpgsql security definer
    set search_path to 'public', 'pg_temp'
    as $$
declare
  v_day text := to_char(now() at time zone 'UTC', 'YYYY-MM-DD');
  v_n   int;
  v_seq bigint;
begin
  perform edition_lock();
  select coalesce(max(split_part(label, '.', 2)::int), 0) + 1 into v_n from editions where label like v_day || '.%';
  insert into editions (label, reason, actor_id, note, restores_seq)
  values (v_day || '.' || v_n, p_reason, p_actor, p_note, p_restores)
  returning seq into v_seq;
  return v_seq;
end $$;

-- A run is never `estimated`.
drop trigger eval_runs_state on public.eval_runs;
drop index public.eval_runs_one_open;
drop index public.eval_runs_incomplete;
drop index public.eval_runs_work;
alter table public.eval_runs alter column state drop default;
alter table public.eval_cells alter column state drop default;
alter table public.eval_run_transitions drop constraint eval_run_transitions_pkey;
alter type public.eval_state rename to eval_state_before;
create type public.eval_state as enum (
    'awaiting_approval',
    'queued',
    'running',
    'finished',
    'failed',
    'cancelled',
    'incomplete'
);
delete from public.eval_run_transitions where from_state::text = 'estimated';
alter table public.eval_run_transitions
  alter column from_state type public.eval_state using from_state::text::public.eval_state,
  alter column to_state type public.eval_state using to_state::text::public.eval_state,
  add primary key (from_state, to_state);
alter table public.eval_runs
  alter column state type public.eval_state using state::text::public.eval_state;
alter table public.eval_cells
  alter column state type public.eval_state using state::text::public.eval_state,
  alter column state set default 'queued';
drop type public.eval_state_before;
create unique index eval_runs_one_open on public.eval_runs using btree (item_version_id, baseline_edition_seq)
  where item_version_id is not null and state = any (array['awaiting_approval', 'queued', 'running']::public.eval_state[]);
create index eval_runs_incomplete on public.eval_runs using btree (finished_at) where state = 'incomplete';
create index eval_runs_work on public.eval_runs using btree (state, created_at)
  where state = any (array['queued', 'running']::public.eval_state[]);
create trigger eval_runs_state before update of state on public.eval_runs
  for each row execute function public.eval_runs_guard_state();
