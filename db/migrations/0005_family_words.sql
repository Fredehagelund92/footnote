-- A live family of metrics (FR-142) holds its name and other names as words, as a metric or a
-- dimension does (FR-138): two families of one name published one at a time are refused, as two
-- metrics are. What the source calls its variants stays theirs: each variant is a live metric of
-- its own that holds those words, so the family takes none of them.
CREATE OR REPLACE FUNCTION public.cl_vocabulary_words() RETURNS TABLE(word text, origin text, key text, name text, connector_id text)
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
  with live as (
    select s.term_key, t.kind, v.id as version_id, v.name, v.aliases
      from vocab_term_service s
      join vocab_term_versions v on v.id = s.version_id
      join vocab_terms t on t.key = s.term_key
     where s.editions @> (select seq from live_edition) and t.kind in ('metric', 'dimension', 'metric_group'))
  select cl_term_word(w), 'vocabulary', l.term_key, l.name, null::text
    from live l, unnest(array[l.name] || l.aliases) w
  union all
  select cl_term_word(w), 'source', l.term_key, l.name, d.connector_id
    from live l
    join vocab_term_refs r on r.version_id = l.version_id
    join definitions d on d.ref = r.definition_ref and d.missing_since_snapshot is null,
    unnest(array[d.name, d.title] || d.synonyms) w
   where l.kind <> 'metric_group' and w is not null and btrim(w) <> '' $$;
