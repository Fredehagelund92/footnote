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

-- What the data writes for each term served in an edition. Serving reads the vocabulary through functions
-- (serving_vocabulary), never the service table, so this is one more of them.
CREATE FUNCTION public.serving_written_as(p_seq bigint) RETURNS TABLE(key text, written_as text[])
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
  select s.term_key, v.written_as
    from vocab_term_service s join vocab_term_versions v on v.id = s.version_id
   where s.editions @> p_seq $$;
