-- How the data writes a dimension's value (values without figures, V1): `NO` for Norway, as an
-- agent's filter passes it after it queried its data tool. People write it with the value, and it
-- is a version of the value like its name and other names. It is never read in a question's words,
-- since `NO` is also the word "no". Only a value has it, and at most five.
ALTER TABLE public.vocab_term_versions ADD COLUMN written_as text[] DEFAULT '{}'::text[] NOT NULL;
ALTER TABLE public.vocab_term_versions ADD CONSTRAINT vocab_term_versions_written_as_check
  CHECK (cardinality(written_as) <= 5 AND array_position(written_as, NULL) IS NULL);

-- The values a writer added in "Applies to" that no vocabulary has yet ("Add Norway to Market"),
-- each by the key the item's scope names it with and its name: they ride with the suggestion and
-- are published with the item. The proposal's own, as its reason is: never part of the item.
ALTER TABLE public.proposals ADD COLUMN new_values jsonb DEFAULT '[]'::jsonb NOT NULL;
ALTER TABLE public.proposals ADD CONSTRAINT proposals_new_values_check
  CHECK (jsonb_typeof(new_values) = 'array' AND jsonb_array_length(new_values) <= 50);

-- The live vocabulary as serving reads it gives how the data writes each value, so an agent's
-- filter that passes `NO` finds Norway: the same function, with one column more, since serving
-- reads the vocabulary only through it. Its result changes, so it is made again; the grants that
-- follow every migration give it to its roles again.
DROP FUNCTION public.serving_vocabulary(bigint);
CREATE FUNCTION public.serving_vocabulary(p_seq bigint) RETURNS TABLE(key text, kind public.term_kind, parent_key text, name text, aliases text[], area_id text, definition_refs text[], written_as text[])
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
  with served as (
    select t.key, t.kind, v.parent_key, v.name, v.aliases, v.area_id, v.written_as,
           coalesce((select array_agg(r.definition_ref order by r.definition_ref collate "C")
                       from vocab_term_refs r where r.version_id = v.id
                        and not exists (select 1 from definitions d join connectors c on c.id = d.connector_id
                                         where d.ref = r.definition_ref and not c.enabled)), '{}') as refs,
           exists (select 1 from vocab_term_refs r where r.version_id = v.id) as named
      from vocab_term_service s join vocab_term_versions v on v.id = s.version_id join vocab_terms t on t.key = s.term_key
     where s.editions @> p_seq),
  off as (select o.key from served o where o.named and o.refs = '{}')
  select t.key, t.kind, t.parent_key, t.name, t.aliases, t.area_id, t.refs, t.written_as
    from served t
   where t.key not in (select key from off)
     and not (t.kind = 'metric_group'
              and exists (select 1 from served m where m.parent_key = t.key)
              and not exists (select 1 from served m where m.parent_key = t.key
                                                       and m.key not in (select key from off)))
     and not (t.kind = 'dimension_value' and t.parent_key in (select key from off)) $$;
