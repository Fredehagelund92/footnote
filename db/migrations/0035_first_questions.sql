-- The first unanswered questions (the cold first use scout, call 4). While fewer than five people
-- have signed in, each question an agent finds nothing for shows to its owners at once: a count
-- can then point to nobody the owner does not already know, and a person trying the product alone
-- asks once or twice. From the fifth person on, the set number in the set period counts again
-- (gaps.no_item_threshold, FR-606 case 1).

-- Whether fewer than five people have ever signed in, off the demo. The demo's invented team has
-- never signed in, and its week of questions is counted as any team's (its sandbox domain is what
-- only the demo's seed makes).
CREATE FUNCTION public.cl_few_people() RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
  select (select count(*) < 5 from people where last_signed_in_at is not null)
     and not exists (select 1 from areas where is_demo)
$$;

-- The same detection, with case 1 at one call while few people have signed in. Runs are taken one
-- at a time, since the read path now starts one beside the scheduled job (below): two at once
-- would each count the same feedback. A run the read path starts (cl.gaps_questions set) counts
-- questions only: a changed definition (case 4) waits for the job, as it always has.
CREATE OR REPLACE FUNCTION public.cl_gaps_detect() RETURNS TABLE(what text, n bigint)
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
declare
  v_rule jsonb := (select value from settings_current where key = 'gaps.no_item_threshold');
  v_calls int := (v_rule ->> 'calls')::int;
  v_days int := (v_rule ->> 'days')::int;
  v_kept int := (select (value #>> '{}')::int from settings_current where key = 'retention.delivery_days');
  r record; k bigint; g uuid; v_topic uuid;
begin
  if v_calls is null or v_days is null or v_kept is null or least(v_calls, v_days, v_kept) < 1 then
    raise exception 'gaps.no_item_threshold and retention.delivery_days must be set and at least one' using errcode = '22023';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('cl.gaps_detect', 0));
  -- While few people have signed in, one call that found nothing is enough.
  if cl_few_people() then v_calls := 1; end if;

  -- Case 1: enough agent calls about one scope found nothing within the period, whatever month
  -- their dates start in. A check failure is not a gap (FR-319), and calls from before that scope
  -- was covered do not count again.
  k := 0;
  for r in
    select t.area_id, t.metric_keys, t.value_keys, t.dimension_keys,
           min(d.delivered_hour) as first_hour, max(d.delivered_hour) as last_hour,
           (array_agg(d.topic_id order by d.delivered_hour desc, t.month desc, d.topic_id))[1] as latest
      from deliveries d join topics t on t.id = d.topic_id
     where d.caller = 'agent' and d.status = 'no_match'
       and d.delivered_hour >= date_trunc('hour', now(), 'UTC') - make_interval(days => v_days)
       and d.delivered_hour > coalesce((
             select max(x.status_since) from gaps x join topics xt on xt.id = x.topic_id
              where xt.area_id is not distinct from t.area_id and xt.metric_keys = t.metric_keys
                and xt.value_keys = t.value_keys and xt.dimension_keys = t.dimension_keys
                and x.type = 'missing' and x.status = 'resolved'), '-infinity')
     group by t.area_id, t.metric_keys, t.value_keys, t.dimension_keys
    having count(*) >= v_calls
  loop
    select x.topic_id into v_topic
      from gaps x join topics xt on xt.id = x.topic_id
     where xt.area_id is not distinct from r.area_id and xt.metric_keys = r.metric_keys
       and xt.value_keys = r.value_keys and xt.dimension_keys = r.dimension_keys
       and x.type = 'missing' and x.status in ('open', 'wont_fix')
     order by x.status_since desc, x.created_at desc
     limit 1;
    perform cl_gap_touch(coalesce(v_topic, r.latest), 'missing', 1::smallint, r.last_hour, r.first_hour);
    k := k + 1;
  end loop;
  return query select 'case_1_no_item_topics', k;

  -- Case 3: negative feedback on an agent delivery. Its note moves under the notes' row security.
  -- Feedback older than the kept deliveries can no longer find its topic.
  k := 0;
  for r in
    select f.id, f.verdict, f.note, f.created_hour, d.topic_id
      from feedback f join deliveries d on d.id = f.delivery_id
     where f.gap_id is null and f.verdict <> 'helpful' and d.caller = 'agent' and d.topic_id is not null
       and f.created_hour >= now() - make_interval(days => v_kept)
     order by f.created_hour, f.id
  loop
    g := cl_gap_touch(r.topic_id,
           case r.verdict when 'wrong' then 'incorrect' when 'missing' then 'missing' else 'unclear_question' end::gap_type,
           3::smallint, r.created_hour, null, 1, r.note, 'feedback');
    update feedback set gap_id = g, note = null where id = r.id;
    k := k + 1;
  end loop;
  return query select 'case_3_feedback', k;

  -- Case 4: a source definition changed (not a first sighting or a reappearance with the same
  -- mark). Recent topics about a metric defined there may now hold outdated context.
  k := 0;
  if current_setting('cl.gaps_questions', true) is distinct from 'on' then
    for r in
      select distinct t.id as topic_id, s.fetched_at
        from definition_marks m
        join connector_snapshots s on s.id = m.snapshot_id
        join lateral (select p.change_mark from definition_marks p join connector_snapshots ps on ps.id = p.snapshot_id
                       where p.definition_ref = m.definition_ref and ps.fetched_at < s.fetched_at
                       order by ps.fetched_at desc limit 1) prev on prev.change_mark <> m.change_mark
        join vocab_term_refs tr on tr.definition_ref = m.definition_ref
        join vocab_term_versions v on v.id = tr.version_id
        join topics t on v.term_key = any(t.metric_keys)
                     and t.month >= (date_trunc('month', s.fetched_at at time zone 'UTC') - interval '1 month')::date
       where s.fetched_at >= now() - make_interval(days => v_days)
    loop
      perform cl_gap_touch(r.topic_id, 'outdated', 4::smallint, r.fetched_at);
      k := k + 1;
    end loop;
  end if;
  return query select 'case_4_definition_topics', k;

  -- Weekly no-item calls of every gap still in play, from the counts of every month of its scope
  -- since it was seen.
  insert into gap_weekly_counts (gap_id, week, no_item_calls)
  select x.id, c.week, sum(c.no_item_calls)
    from gaps x
    join topics xt on xt.id = x.topic_id
    join topics t on t.area_id is not distinct from xt.area_id and t.metric_keys = xt.metric_keys
                 and t.value_keys = xt.value_keys and t.dimension_keys = xt.dimension_keys
    join topic_week_counts c on c.topic_id = t.id and c.status = 'no_match'
   where x.type = 'missing' and x.status in ('open', 'wont_fix')
     and c.week >= date_trunc('week', x.first_seen)::date
   group by x.id, c.week
  having sum(c.no_item_calls) > 0
  on conflict (gap_id, week) do update set no_item_calls = excluded.no_item_calls
   where gap_weekly_counts.no_item_calls is distinct from excluded.no_item_calls;
  get diagnostics k = row_count;
  return query select 'weekly_counts_updated', k;
end $$;

-- What the read path calls after an agent's call found nothing, or an agent's report said an
-- answer was wrong, missing or unclear: the detection now, not at the job's next turn, while few
-- people have signed in. From the fifth person on it does nothing, and the job counts as before.
CREATE FUNCTION public.serving_first_questions() RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
begin
  if cl_few_people() then
    perform set_config('cl.gaps_questions', 'on', true);
    perform cl_gaps_detect();
  end if;
end $$;
