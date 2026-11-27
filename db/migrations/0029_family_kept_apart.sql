-- A family Footnote suggested, whose metrics an owner kept separate when publishing them (FR-142,
-- D1, Keep them separate): the family by the key and name it had, the domain it was in, its
-- variants, each a metric of its own since, who kept them apart and the edition that published
-- them. A family its tool declares is never kept apart here. The next read keeps them apart, since
-- live metrics never make a new family; Definitions lists them, and an owner of the domain or an
-- admin makes them one family from there, once.
CREATE TABLE public.family_kept_apart (
    id uuid DEFAULT uuidv7() NOT NULL,
    family_key text NOT NULL,
    name text NOT NULL,
    area_id text,
    variants text[] NOT NULL,
    kept_by uuid NOT NULL,
    kept_at timestamp with time zone DEFAULT now() NOT NULL,
    kept_in bigint NOT NULL,
    joined_by uuid,
    joined_at timestamp with time zone,
    joined_in bigint,
    CONSTRAINT family_kept_apart_pkey PRIMARY KEY (id),
    CONSTRAINT family_kept_apart_key_check CHECK ((family_key ~ '^group:[a-z0-9_]+$'::text)),
    CONSTRAINT family_kept_apart_name_check CHECK ((btrim(name) <> ''::text)),
    CONSTRAINT family_kept_apart_variants_check CHECK (
      cardinality(variants) >= 2
      AND array_to_string(variants, ' ') ~ '^metric:[a-z0-9_]+( metric:[a-z0-9_]+)*$'::text),
    CONSTRAINT family_kept_apart_joined_check CHECK (
      (joined_by IS NULL) = (joined_at IS NULL) AND (joined_by IS NULL) = (joined_in IS NULL)),
    CONSTRAINT family_kept_apart_area_id_fkey FOREIGN KEY (area_id) REFERENCES public.areas(id),
    CONSTRAINT family_kept_apart_kept_by_fkey FOREIGN KEY (kept_by) REFERENCES public.people(id),
    CONSTRAINT family_kept_apart_joined_by_fkey FOREIGN KEY (joined_by) REFERENCES public.people(id),
    CONSTRAINT family_kept_apart_kept_in_fkey FOREIGN KEY (kept_in) REFERENCES public.editions(seq),
    CONSTRAINT family_kept_apart_joined_in_fkey FOREIGN KEY (joined_in) REFERENCES public.editions(seq)
);

-- A family is kept apart once at a time.
CREATE UNIQUE INDEX family_kept_apart_standing ON public.family_kept_apart USING btree (family_key)
  WHERE (joined_in IS NULL);

-- Kept as it was decided: making the metrics one family is the one change, made once.
CREATE FUNCTION public.family_kept_apart_guard() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'public', 'pg_temp'
    AS $$
begin
  if tg_op = 'DELETE' or old.joined_in is not null
     or (to_jsonb(new) - 'joined_by' - 'joined_at' - 'joined_in')
        <> (to_jsonb(old) - 'joined_by' - 'joined_at' - 'joined_in') then
    raise exception 'kept apart % is kept as it was decided', old.id using errcode = 'restrict_violation';
  end if;
  new.joined_at := now();
  return new;
end $$;

CREATE TRIGGER family_kept_apart_guard BEFORE DELETE OR UPDATE ON public.family_kept_apart
  FOR EACH ROW EXECUTE FUNCTION public.family_kept_apart_guard();
CREATE TRIGGER ao_trunc_family_kept_apart BEFORE TRUNCATE ON public.family_kept_apart
  FOR EACH STATEMENT EXECUTE FUNCTION public.cl_forbid_mutation();

ALTER TABLE public.family_kept_apart ENABLE ROW LEVEL SECURITY;
CREATE POLICY family_kept_apart_read ON public.family_kept_apart FOR SELECT USING (true);
CREATE POLICY family_kept_apart_insert ON public.family_kept_apart FOR INSERT WITH CHECK (
  (kept_by = public.cl_person()) AND (joined_in IS NULL)
  AND (public.cl_is_admin_now() OR coalesce(public.cl_is_owner_now(area_id), false)));
CREATE POLICY family_kept_apart_join ON public.family_kept_apart FOR UPDATE USING (
  (joined_in IS NULL) AND (public.cl_is_admin_now() OR coalesce(public.cl_is_owner_now(area_id), false)))
  WITH CHECK (joined_by = public.cl_person());
