-- One definitions integration is on at a time (CON-120): Cube, dbt MetricFlow or any
-- other connector whose kind is definitions. One is on while it is switched on and connected; a
-- paused or disconnected one is off. An install that reads two keeps the first connected, the
-- server's demo only when it is the only one, turns the others off and says so once, in the
-- history log, for each one it turned off.
WITH ranked AS (
  SELECT id, name, row_number() OVER (ORDER BY type = 'demo', created_at, id) AS n
    FROM public.connectors
   WHERE kind = 'definition_source' AND enabled),
kept AS (SELECT name FROM ranked WHERE n = 1),
turned AS (
  UPDATE public.connectors c SET enabled = false
    FROM ranked r
   WHERE r.id = c.id AND r.n > 1
  RETURNING c.id, c.name)
INSERT INTO public.audit_log (actor_kind, action, subject_type, subject_id, details)
SELECT 'system', 'source.paused', 'source', t.id,
       jsonb_build_object('reason',
         'Only one definitions integration is on at a time. ' || k.name
           || ' stays on, so this one was turned off. To read this one instead, turn '
           || k.name || ' off, then turn this one on.')
  FROM turned t CROSS JOIN kept k;

CREATE UNIQUE INDEX connectors_one_definitions_source ON public.connectors (kind)
  WHERE kind = 'definition_source' AND enabled;

-- What is served is what the definitions integration that is on defines. A term whose definitions
-- all come from an integration that is off is neither listed nor served, and holds no word, so the
-- integration turned on in its place can name the same metrics; it comes back when its
-- integration is on again. A family is off when every variant it has is, and a value when its
-- dimension is. A definition its integration no longer lists (`missing`) is not off: it is shown as
-- gone, as before.
CREATE OR REPLACE FUNCTION public.serving_vocabulary(p_seq bigint) RETURNS TABLE(key text, kind public.term_kind, parent_key text, name text, aliases text[], area_id text, definition_refs text[])
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
  with served as (
    select t.key, t.kind, v.parent_key, v.name, v.aliases, v.area_id,
           coalesce((select array_agg(r.definition_ref order by r.definition_ref collate "C")
                       from vocab_term_refs r where r.version_id = v.id
                        and not exists (select 1 from definitions d join connectors c on c.id = d.connector_id
                                         where d.ref = r.definition_ref and not c.enabled)), '{}') as refs,
           exists (select 1 from vocab_term_refs r where r.version_id = v.id) as named
      from vocab_term_service s join vocab_term_versions v on v.id = s.version_id join vocab_terms t on t.key = s.term_key
     where s.editions @> p_seq),
  off as (select o.key from served o where o.named and o.refs = '{}')
  select t.key, t.kind, t.parent_key, t.name, t.aliases, t.area_id, t.refs
    from served t
   where t.key not in (select key from off)
     and not (t.kind = 'metric_group'
              and exists (select 1 from served m where m.parent_key = t.key)
              and not exists (select 1 from served m where m.parent_key = t.key
                                                       and m.key not in (select key from off)))
     and not (t.kind = 'dimension_value' and t.parent_key in (select key from off)) $$;

-- Only what is served holds a word (FR-138): a term of an integration that is off holds none.
CREATE OR REPLACE FUNCTION public.cl_vocabulary_words() RETURNS TABLE(word text, origin text, key text, name text, connector_id text)
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
  with live as (
    select t.key as term_key, t.kind, t.name, t.aliases, t.definition_refs
      from serving_vocabulary((select seq from live_edition)) t
     where t.kind in ('metric', 'dimension', 'metric_group'))
  select cl_term_word(w), 'vocabulary', l.term_key, l.name, null::text
    from live l, unnest(array[l.name] || l.aliases) w
  union all
  select cl_term_word(w), 'source', l.term_key, l.name, d.connector_id
    from live l
    join definitions d on d.ref = any(l.definition_refs) and d.missing_since_snapshot is null,
    unnest(array[d.name, d.title] || d.synonyms) w
   where l.kind <> 'metric_group' and w is not null and btrim(w) <> '' $$;

-- What is served changes when an integration is turned on or off, as it does after a read: the
-- bundle a server keeps is made again.
CREATE OR REPLACE FUNCTION public.serving_terms_mark() RETURNS text
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$ select (select count(*) from term_versions)::text || ':'
                 || coalesce((select id::text from connector_snapshots order by id desc limit 1), '') || ':'
                 || coalesce((select string_agg(id, ',' order by id) from connectors
                               where kind = 'definition_source' and enabled), '') $$;
