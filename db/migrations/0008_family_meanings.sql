-- What a family of metrics means (FR-142, M1). Declared in the source first: the words a variant's
-- `meta.footnote.family_description` writes for its family, a copy of at most 500 characters, read
-- only and replaced at each read. Else what an owner of the family's domain, or an admin, chose: one
-- variant's own words or words written here for the family, kept with its history like a term's.
-- With neither, Footnote works the meaning out from the variants' words (src/domain/family-meaning.ts).
alter table public.definitions
  add column family_description text,
  add constraint definitions_family_description_check check (
    family_description is null
    or (family_name is not null and char_length(family_description) between 1 and 500
         and btrim(family_description) <> ''));

-- The domain a family is in now: the vocabulary's area map first, the source's hint second, as the
-- catalogue says it (termDomain). Null for a key that names no live family, or a family of none.
CREATE FUNCTION public.cl_family_area(p_key text) RETURNS text
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
  select coalesce(t.area_id, d.area_id)
    from serving_vocabulary((select seq from live_edition)) t
    left join serving_source_domains((select seq from live_edition)) d on d.key = t.key
   where t.key = p_key and t.kind = 'metric_group' $$;

-- An owner's choice of what a family means: worked out again by the rule (`auto`), one variant's
-- own words (`member`, by its key), or words written for the family (`written`).
CREATE TABLE public.family_meanings (
    family_key text NOT NULL,
    choice text NOT NULL,
    member_key text,
    words text,
    revision integer DEFAULT 1 NOT NULL,
    updated_by uuid NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT family_meanings_pkey PRIMARY KEY (family_key),
    CONSTRAINT family_meanings_key_check CHECK ((family_key ~ '^group:[a-z0-9_]+$'::text)),
    CONSTRAINT family_meanings_choice_check CHECK (
      (choice = 'auto' AND member_key IS NULL AND words IS NULL)
      OR (choice = 'member' AND member_key ~ '^metric:[a-z0-9_]+$'::text AND words IS NULL)
      OR (choice = 'written' AND member_key IS NULL
          AND char_length(btrim(words)) BETWEEN 1 AND 1000)),
    CONSTRAINT family_meanings_revision_check CHECK ((revision >= 1)),
    CONSTRAINT family_meanings_updated_by_fkey FOREIGN KEY (updated_by) REFERENCES public.people(id)
);

-- Every choice, as it was made: append only.
CREATE TABLE public.family_meaning_versions (
    id uuid DEFAULT uuidv7() NOT NULL,
    family_key text NOT NULL,
    revision integer NOT NULL,
    choice text NOT NULL,
    member_key text,
    words text,
    made_by uuid NOT NULL,
    made_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT family_meaning_versions_pkey PRIMARY KEY (id),
    CONSTRAINT family_meaning_versions_revision_key UNIQUE (family_key, revision),
    CONSTRAINT family_meaning_versions_family_key_fkey FOREIGN KEY (family_key)
      REFERENCES public.family_meanings(family_key),
    CONSTRAINT family_meaning_versions_made_by_fkey FOREIGN KEY (made_by) REFERENCES public.people(id)
);

CREATE FUNCTION public.family_meanings_version() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
begin
  insert into family_meaning_versions (family_key, revision, choice, member_key, words, made_by)
  values (new.family_key, new.revision, new.choice, new.member_key, new.words,
          coalesce(cl_person(), new.updated_by));
  return null;
end $$;

CREATE TRIGGER family_meanings_version AFTER INSERT OR UPDATE ON public.family_meanings
  FOR EACH ROW EXECUTE FUNCTION public.family_meanings_version();
CREATE TRIGGER ao_row_family_meaning_versions BEFORE DELETE OR UPDATE ON public.family_meaning_versions
  FOR EACH ROW EXECUTE FUNCTION public.cl_forbid_mutation();
CREATE TRIGGER ao_trunc_family_meaning_versions BEFORE TRUNCATE ON public.family_meaning_versions
  FOR EACH STATEMENT EXECUTE FUNCTION public.cl_forbid_mutation();

-- Everyone signed in reads what a family means and how it came to; an owner of its domain now, or
-- an admin, changes it.
ALTER TABLE public.family_meanings ENABLE ROW LEVEL SECURITY;
CREATE POLICY family_meanings_read ON public.family_meanings FOR SELECT USING (true);
CREATE POLICY family_meanings_insert ON public.family_meanings FOR INSERT WITH CHECK (
  (updated_by = public.cl_person()) AND (public.cl_is_admin_now()
    OR coalesce(public.cl_is_owner_now(public.cl_family_area(family_key)), false)));
CREATE POLICY family_meanings_update ON public.family_meanings FOR UPDATE USING (
  public.cl_is_admin_now() OR coalesce(public.cl_is_owner_now(public.cl_family_area(family_key)), false))
  WITH CHECK ((updated_by = public.cl_person()) AND (public.cl_is_admin_now()
    OR coalesce(public.cl_is_owner_now(public.cl_family_area(family_key)), false)));

ALTER TABLE public.family_meaning_versions ENABLE ROW LEVEL SECURITY;
CREATE POLICY family_meaning_versions_read ON public.family_meaning_versions FOR SELECT USING (true);
