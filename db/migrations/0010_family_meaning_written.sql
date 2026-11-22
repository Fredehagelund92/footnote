-- What a family of metrics means has two owner choices now (FR-142, M1): worked out from its
-- variants again (`auto`), or words written for the family (`written`). One variant's own words
-- read as that one variant ("... in EUR"), so they are no choice of their own any more: a family
-- that took them (`member`) has those words, as the variant writes them now, written for it, and
-- one whose variant has gone or has no words is worked out again. Each kept version says the same,
-- revision for revision, so the history reads as the two choices only.

-- The words a variant writes now, by its key; null when it has gone or writes none.
CREATE FUNCTION pg_temp.variant_words(p_key text) RETURNS text
    LANGUAGE sql STABLE
    AS $$
  select nullif(btrim(d.description_copy), '')
    from serving_vocabulary((select seq from live_edition)) t
    join definitions d on d.ref = t.definition_refs[1]
   where t.key = p_key and t.kind = 'metric' $$;

-- The choice and its versions change in place: no new revision, and the kept versions are the
-- same versions, read as written.
ALTER TABLE public.family_meanings DISABLE TRIGGER family_meanings_version;
ALTER TABLE public.family_meaning_versions DISABLE TRIGGER ao_row_family_meaning_versions;

UPDATE public.family_meanings
   SET words = pg_temp.variant_words(member_key),
       choice = CASE WHEN pg_temp.variant_words(member_key) IS NULL THEN 'auto' ELSE 'written' END,
       member_key = NULL
 WHERE choice = 'member';
UPDATE public.family_meaning_versions
   SET words = pg_temp.variant_words(member_key),
       choice = CASE WHEN pg_temp.variant_words(member_key) IS NULL THEN 'auto' ELSE 'written' END,
       member_key = NULL
 WHERE choice = 'member';

ALTER TABLE public.family_meaning_versions ENABLE TRIGGER ao_row_family_meaning_versions;
ALTER TABLE public.family_meanings ENABLE TRIGGER family_meanings_version;

ALTER TABLE public.family_meanings
  DROP CONSTRAINT family_meanings_choice_check,
  DROP COLUMN member_key,
  ADD CONSTRAINT family_meanings_choice_check CHECK (
    (choice = 'auto' AND words IS NULL)
    OR (choice = 'written' AND char_length(btrim(words)) BETWEEN 1 AND 1000));
ALTER TABLE public.family_meaning_versions
  DROP COLUMN member_key,
  ADD CONSTRAINT family_meaning_versions_choice_check CHECK (
    (choice = 'auto' AND words IS NULL) OR (choice = 'written' AND words IS NOT NULL));

CREATE OR REPLACE FUNCTION public.family_meanings_version() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
begin
  insert into family_meaning_versions (family_key, revision, choice, words, made_by)
  values (new.family_key, new.revision, new.choice, new.words,
          coalesce(cl_person(), new.updated_by));
  return null;
end $$;
