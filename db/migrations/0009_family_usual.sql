-- The usual variant of a family of metrics (FR-142, F3): the one agents read when a question names
-- none of the values its variants are told apart by ("Revenue" means Revenue (EUR) web). An owner
-- of the family's domain, or an admin, picks it, or none, and every pick is kept. With none, agents
-- ask which one is meant.
CREATE TABLE public.family_usual (
    family_key text NOT NULL,
    member_key text,
    revision integer DEFAULT 1 NOT NULL,
    updated_by uuid NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT family_usual_pkey PRIMARY KEY (family_key),
    CONSTRAINT family_usual_key_check CHECK ((family_key ~ '^group:[a-z0-9_]+$'::text)),
    CONSTRAINT family_usual_member_check CHECK (
      (member_key IS NULL) OR (member_key ~ '^metric:[a-z0-9_]+$'::text)),
    CONSTRAINT family_usual_revision_check CHECK ((revision >= 1)),
    CONSTRAINT family_usual_updated_by_fkey FOREIGN KEY (updated_by) REFERENCES public.people(id)
);

-- Every pick, as it was made: append only.
CREATE TABLE public.family_usual_versions (
    id uuid DEFAULT uuidv7() NOT NULL,
    family_key text NOT NULL,
    revision integer NOT NULL,
    member_key text,
    made_by uuid NOT NULL,
    made_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT family_usual_versions_pkey PRIMARY KEY (id),
    CONSTRAINT family_usual_versions_revision_key UNIQUE (family_key, revision),
    CONSTRAINT family_usual_versions_family_key_fkey FOREIGN KEY (family_key)
      REFERENCES public.family_usual(family_key),
    CONSTRAINT family_usual_versions_made_by_fkey FOREIGN KEY (made_by) REFERENCES public.people(id)
);

CREATE FUNCTION public.family_usual_version() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
begin
  insert into family_usual_versions (family_key, revision, member_key, made_by)
  values (new.family_key, new.revision, new.member_key, coalesce(cl_person(), new.updated_by));
  return null;
end $$;

CREATE TRIGGER family_usual_version AFTER INSERT OR UPDATE ON public.family_usual
  FOR EACH ROW EXECUTE FUNCTION public.family_usual_version();
CREATE TRIGGER ao_row_family_usual_versions BEFORE DELETE OR UPDATE ON public.family_usual_versions
  FOR EACH ROW EXECUTE FUNCTION public.cl_forbid_mutation();
CREATE TRIGGER ao_trunc_family_usual_versions BEFORE TRUNCATE ON public.family_usual_versions
  FOR EACH STATEMENT EXECUTE FUNCTION public.cl_forbid_mutation();

-- Everyone signed in reads it; an owner of the family's domain now, or an admin, changes it.
ALTER TABLE public.family_usual ENABLE ROW LEVEL SECURITY;
CREATE POLICY family_usual_read ON public.family_usual FOR SELECT USING (true);
CREATE POLICY family_usual_insert ON public.family_usual FOR INSERT WITH CHECK (
  (updated_by = public.cl_person()) AND (public.cl_is_admin_now()
    OR coalesce(public.cl_is_owner_now(public.cl_family_area(family_key)), false)));
CREATE POLICY family_usual_update ON public.family_usual FOR UPDATE USING (
  public.cl_is_admin_now() OR coalesce(public.cl_is_owner_now(public.cl_family_area(family_key)), false))
  WITH CHECK ((updated_by = public.cl_person()) AND (public.cl_is_admin_now()
    OR coalesce(public.cl_is_owner_now(public.cl_family_area(family_key)), false)));

ALTER TABLE public.family_usual_versions ENABLE ROW LEVEL SECURITY;
CREATE POLICY family_usual_versions_read ON public.family_usual_versions FOR SELECT USING (true);
