-- Families of metrics accepted before 0005 could share a name (FR-138, FR-142): a family's name
-- was no word it held, so two families of one name, published one at a time, both went live, and
-- Definitions showed one name twice. A second family of a name now takes its view's name after it
-- (src/domain/source-names.ts), but nothing renamed the ones live already, and nobody can: no
-- source names a family. This gives each later one a new version by that rule, its key unchanged,
-- all in one edition, so "Forecast Revenue" three times is "Forecast Revenue", "Forecast Revenue
-- (sponsorships)" and "Forecast Revenue (subscriptions)".
--
-- The first holder of a word keeps it: a metric or a dimension, which held their words from the
-- start, else the family accepted first. A later family's other name that an earlier holder has
-- is left out. Its version's digest is worked out as the write path works it out
-- (termDigestContent: canonical JSON, SHA-256). Nobody decided the change, so the guard that wants
-- a decision for each version served is off for this edition, as it is for the first edition and
-- for going back to one.

ALTER TABLE public.vocab_term_service DISABLE TRIGGER vocab_term_service_guard;

DO $$
declare
  f record;
  v_seq bigint;
  v_plain text;
  v_view text;
  v_name text;
  v_aliases text[];
  v_n int;
  v_version uuid;
  v_told jsonb := '[]';
  v_note text := 'Families of one name were told apart: each later one has its view''s name after it.';
begin
  if not exists (select 1 from live_edition) then return; end if;
  -- Every live word, and who holds it: a metric or a dimension first (rank 0), then families in
  -- the order they were accepted.
  create temp table held on commit drop as
    select w.word, w.key,
           case when t.kind = 'metric_group'
                then dense_rank() over (partition by t.kind = 'metric_group' order by t.created_at, t.key collate "C")
                else 0 end as rank
      from cl_vocabulary_words() w join vocab_terms t on t.key = w.key
     where w.origin = 'vocabulary';
  for f in
    select s.term_key as key, v.id, v.name, v.aliases, v.area_id, v.parent_key,
           (select max(h.rank) from held h where h.key = s.term_key) as rank
      from vocab_term_service s join vocab_term_versions v on v.id = s.version_id
      join vocab_terms t on t.key = s.term_key
     where s.editions @> (select seq from live_edition) and t.kind = 'metric_group'
     order by t.created_at, t.key collate "C"
  loop
    v_name := f.name;
    if exists (select 1 from held h
                where h.word = cl_term_word(f.name) and h.key <> f.key and h.rank < f.rank) then
      -- The view of its first variant, in words: `sponsorships` of `sponsorships.forecast_revenue_eur`.
      select btrim(regexp_replace(regexp_replace(d.name, '\.[^.]*$', ''), '_+', ' ', 'g')) into v_view
        from vocab_term_refs r join definitions d on d.ref = r.definition_ref
       where r.version_id = f.id and position('.' in substr(d.name, 2)) > 0
       order by r.definition_ref collate "C" limit 1;
      v_plain := f.name;
      v_n := case when v_view is null then 2 else 1 end;
      loop
        v_name := v_plain || ' (' || concat_ws(' ', v_view, nullif(v_n, 1)::text) || ')';
        exit when not exists (select 1 from held h where h.word = cl_term_word(v_name) and h.key <> f.key);
        v_n := v_n + 1;
      end loop;
    end if;
    v_aliases := array(
      select a from unnest(f.aliases) with ordinality as u(a, n)
       where cl_term_word(a) <> cl_term_word(v_name)
         and not exists (select 1 from held h
                          where h.word = cl_term_word(a) and h.key <> f.key and h.rank < f.rank)
       order by n);
    continue when v_name = f.name and v_aliases = f.aliases;

    if v_seq is null then v_seq := edition_open('names_told_apart', null, v_note); end if;
    insert into vocab_term_versions (term_key, version_no, name, aliases, area_id, parent_key, proposer_id, content_digest)
    values (f.key, (select max(version_no) + 1 from vocab_term_versions where term_key = f.key),
            v_name, v_aliases, f.area_id, f.parent_key, null,
            sha256(convert_to(
              '{"aliases":' || coalesce((select '[' || string_agg(to_json(a)::text, ',' order by n) || ']'
                                           from unnest(v_aliases) with ordinality as u(a, n)), '[]')
              || ',"areaId":' || coalesce(to_json(f.area_id)::text, 'null')
              || ',"definitionRefs":' || coalesce((select '[' || string_agg(to_json(r.definition_ref)::text, ',' order by r.definition_ref collate "C") || ']'
                                                     from vocab_term_refs r where r.version_id = f.id), '[]')
              || ',"key":' || to_json(f.key)::text
              || ',"kind":"metric_group"'
              || ',"name":' || to_json(v_name)::text
              || ',"parentKey":' || coalesce(to_json(f.parent_key)::text, 'null') || '}',
              'UTF8')))
    returning id into v_version;
    insert into vocab_term_refs (version_id, definition_ref)
      select v_version, r.definition_ref from vocab_term_refs r where r.version_id = f.id;
    perform edition_serve_vocab_version(v_seq, v_version);

    delete from held where key = f.key;
    insert into held (word, key, rank)
      select cl_term_word(w), f.key, f.rank from unnest(array[v_name] || v_aliases) as w;
    v_told := v_told || jsonb_build_object('key', f.key, 'from', f.name, 'to', v_name);
  end loop;
  if v_seq is null then return; end if;

  -- As every edition does (editions/release.ts publishEdition and announce).
  perform edition_pin_source_domains(v_seq);
  perform edition_seal(v_seq);
  perform edition_publish(v_seq, null);
  perform cl_topics_adopt_domains();
  insert into outbox_events (topic, area_id, aggregate_type, aggregate_id, payload)
    select 'edition.published', null, 'edition', e.label,
           jsonb_build_object('seq', e.seq, 'label', e.label, 'reason', e.reason)
      from editions e where e.seq = v_seq;
  insert into audit_log (actor_id, actor_kind, action, area_id, subject_type, subject_id, details)
    select null, 'system', 'edition.published', null, 'edition', e.label,
           jsonb_build_object('seq', e.seq, 'reason', e.reason, 'note', e.note)
      from editions e where e.seq = v_seq;
  insert into audit_log (actor_id, actor_kind, action, area_id, subject_type, subject_id, details)
  values (null, 'system', 'names.told_apart', null, 'names', 'live', jsonb_build_object('names', v_told));
end $$;

ALTER TABLE public.vocab_term_service ENABLE TRIGGER vocab_term_service_guard;
