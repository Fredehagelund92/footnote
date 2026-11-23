-- A family of metrics can be split back into separate metrics (FR-142, D2-D4). What a term is
-- part of, a metric's family or a value's dimension, is part of each version of it, as its name
-- is (the version's digest covered it already): a split serves new versions of the variants
-- without the family, and every edition before still reads the family whole.
ALTER TABLE public.vocab_term_versions ADD COLUMN parent_key text;

ALTER TABLE public.vocab_term_versions DISABLE TRIGGER ao_row_vocab_term_versions;
UPDATE public.vocab_term_versions v SET parent_key = t.parent_key
  FROM public.vocab_terms t WHERE t.key = v.term_key AND t.parent_key IS NOT NULL;
ALTER TABLE public.vocab_term_versions ENABLE TRIGGER ao_row_vocab_term_versions;

-- A metric is in a family or a group, or none; a value is in the dimension its key names; any
-- other term is in none. The key's prefix says the term's kind (vocab_terms_check).
ALTER TABLE public.vocab_term_versions
  ADD CONSTRAINT vocab_term_versions_parent_key_fkey FOREIGN KEY (parent_key) REFERENCES public.vocab_terms(key),
  ADD CONSTRAINT vocab_term_versions_parent_check CHECK (
    CASE WHEN term_key ~ '^metric:' THEN parent_key IS NULL OR parent_key ~ '^group:[a-z0-9_]+$'
         WHEN term_key ~ '^val:' THEN parent_key = 'dim:' || split_part(substr(term_key, 5), '/', 1)
         ELSE parent_key IS NULL END);

-- A value's dimension is in its key, so a version that names none is in that one.
CREATE FUNCTION public.vocab_term_versions_parent() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'public', 'pg_temp'
    AS $$
begin
  if new.parent_key is null and new.term_key ~ '^val:' then
    new.parent_key := 'dim:' || split_part(substr(new.term_key, 5), '/', 1);
  end if;
  return new;
end $$;

CREATE TRIGGER vocab_term_versions_parent BEFORE INSERT ON public.vocab_term_versions
  FOR EACH ROW EXECUTE FUNCTION public.vocab_term_versions_parent();

ALTER TABLE public.vocab_terms DROP CONSTRAINT vocab_terms_check;
ALTER TABLE public.vocab_terms DROP COLUMN parent_key;
ALTER TABLE public.vocab_terms ADD CONSTRAINT vocab_terms_check CHECK (
  ((kind = 'metric_group'::public.term_kind) AND (key ~ '^group:[a-z0-9_]+$'::text))
  OR ((kind = 'metric'::public.term_kind) AND (key ~ '^metric:[a-z0-9_]+$'::text))
  OR ((kind = 'dimension'::public.term_kind) AND (key ~ '^dim:[a-z0-9_]+$'::text))
  OR ((kind = 'dimension_value'::public.term_kind) AND (key ~ '^val:[a-z0-9_]+/[a-z0-9_]+$'::text)));

CREATE OR REPLACE FUNCTION public.serving_vocabulary(p_seq bigint) RETURNS TABLE(key text, kind public.term_kind, parent_key text, name text, aliases text[], area_id text, definition_refs text[])
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
  select t.key, t.kind, v.parent_key, v.name, v.aliases, v.area_id,
         coalesce((select array_agg(r.definition_ref order by r.definition_ref collate "C")
                     from vocab_term_refs r where r.version_id = v.id), '{}')
    from vocab_term_service s join vocab_term_versions v on v.id = s.version_id join vocab_terms t on t.key = s.term_key
   where s.editions @> p_seq $$;

CREATE OR REPLACE FUNCTION public.cl_scopes_overlap(a jsonb, b jsonb) RETURNS boolean
    LANGUAGE sql STABLE
    SET search_path TO 'public', 'pg_temp'
    AS $$
  select
    (jsonb_array_length(coalesce(a->'scope'->'metrics','[]')) + jsonb_array_length(coalesce(a->'scope'->'dimensionValues','[]'))
       + jsonb_array_length(coalesce(a->'scope'->'dimensions','[]')) > 0) and
    (jsonb_array_length(coalesce(b->'scope'->'metrics','[]')) + jsonb_array_length(coalesce(b->'scope'->'dimensionValues','[]'))
       + jsonb_array_length(coalesce(b->'scope'->'dimensions','[]')) > 0) and
    (a->'validity'->>'start') < coalesce(b->'validity'->>'end','9999-12-31') and
    (b->'validity'->>'start') < coalesce(a->'validity'->>'end','9999-12-31') and
    (jsonb_array_length(coalesce(a->'scope'->'metrics','[]'))=0 or
     jsonb_array_length(coalesce(b->'scope'->'metrics','[]'))=0 or exists (
       select 1 from jsonb_array_elements_text(a->'scope'->'metrics') x,
                     jsonb_array_elements_text(b->'scope'->'metrics') y
       where x=y or exists (select 1 from vocab_term_service s join vocab_term_versions t on t.id=s.version_id
         where s.editions @> (select seq from live_edition)
           and ((t.term_key=x and t.parent_key=y) or (t.term_key=y and t.parent_key=x))))) and
    not exists (
      select 1 from jsonb_array_elements(coalesce(a->'scope'->'dimensionValues','[]')) x
      where exists(select 1 from jsonb_array_elements(coalesce(b->'scope'->'dimensionValues','[]')) y
                   where y->>'dimension'=x->>'dimension')
        and not exists(select 1 from jsonb_array_elements(coalesce(a->'scope'->'dimensionValues','[]')) ax,
                                     jsonb_array_elements(coalesce(b->'scope'->'dimensionValues','[]')) by_
                       where ax->>'dimension'=x->>'dimension' and by_->>'dimension'=x->>'dimension' and ax->>'value'=by_->>'value')) $$;

CREATE OR REPLACE FUNCTION public.cl_area_deletion_plan(p_area text) RETURNS jsonb
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
declare v_live bigint := (select seq from live_edition); v_plan jsonb;
begin
  if not cl_is_admin_now() then
    raise exception 'only an administrator reads what deleting a domain does' using errcode = 'insufficient_privilege';
  end if;
  with live_terms as (
    select s.term_key as key, s.version_id, t.kind, v.parent_key, v.name, v.area_id
      from vocab_term_service s join vocab_term_versions v on v.id = s.version_id
      join vocab_terms t on t.key = s.term_key
     where s.editions @> v_live),
  other_items as (
    select v.id from item_version_service s join item_versions v on v.id = s.version_id
     where s.editions @> v_live and v.area_id <> p_area),
  used as (
    select m.metric_key as key from item_version_metrics m join other_items o on o.id = m.version_id
    union select d.dimension_key from item_version_dimension_values d join other_items o on o.id = d.version_id
    union select d.value_key from item_version_dimension_values d join other_items o on o.id = d.version_id
    union select d.dimension_key from item_version_dimensions d join other_items o on o.id = d.version_id)
  select jsonb_build_object(
    'items', coalesce((
      select jsonb_agg(jsonb_build_object('id', s.item_id, 'versionId', v.id,
                                          'title', case when cl_audience_allows(v.audience_groups) then v.title end,
                                          'withheld', not cl_audience_allows(v.audience_groups), 'kind', v.kind,
                                          'proposerId', v.proposer_id)
                       order by not cl_audience_allows(v.audience_groups), v.title, s.item_id)
        from item_version_service s join item_versions v on v.id = s.version_id
       where s.editions @> v_live and v.area_id = p_area), '[]'::jsonb),
    'terms', coalesce((
      select jsonb_agg(jsonb_build_object('key', t.key, 'versionId', t.version_id, 'name', t.name, 'kind', t.kind,
                                          'parentKey', t.parent_key,
                                          'usedElsewhere', exists (select 1 from used u where u.key = t.key))
                       order by t.name, t.key)
        from live_terms t where t.area_id = p_area), '[]'::jsonb),
    'parentsOfOthers', coalesce((
      select jsonb_agg(distinct t.parent_key) from live_terms t
       where t.parent_key is not null and t.area_id is distinct from p_area), '[]'::jsonb),
    'sourceTerms', coalesce((
      select jsonb_agg(jsonb_build_object('key', t.key, 'name', t.name, 'kind', t.kind) order by t.name, t.key)
        from live_terms t join source_domain_service d on d.term_key = t.key and d.editions @> v_live
       where t.area_id is null and d.area_id = p_area), '[]'::jsonb),
    'openProposals', coalesce((
      select jsonb_agg(jsonb_build_object('id', p.id, 'number', p.number, 'subject', p.subject, 'revision', p.revision,
                                          'proposerId', p.proposer_id,
                                          'title', case when o.open
                                                   then coalesce(iv.title, tv.name, p.draft->>'title', p.draft->>'name', 'Untitled') end,
                                          'withheld', not o.open)
                       order by not o.open, p.number)
        from proposals p left join item_versions iv on iv.id = p.item_version_id
        left join vocab_term_versions tv on tv.id = p.vocab_version_id
        cross join lateral (select cl_item_open(p.item_id) and cl_version_open(p.item_version_id) as open) o
       where p.area_id = p_area and p.discarded_at is null and p.state in ('submitted', 'in_review', 'changes_requested')),
      '[]'::jsonb),
    'drafts', coalesce((
      select jsonb_agg(jsonb_build_object('id', p.id, 'proposerId', p.proposer_id, 'author', a.display_name,
                                          'title', coalesce(nullif(btrim(p.draft->>'title'), ''), 'Untitled draft'))
                       order by p.created_at, p.id)
        from proposals p join people a on a.id = p.proposer_id
       where p.area_id = p_area and p.discarded_at is null and p.state = 'draft'), '[]'::jsonb),
    'team', coalesce((
      select jsonb_agg(jsonb_build_object('personId', x.person_id, 'name', a.display_name, 'role', x.role)
                       order by x.role, a.display_name, x.person_id)
        from area_assignments x join people a on a.id = x.person_id
       where x.area_id = p_area and x.valid_at @> now()), '[]'::jsonb),
    'sourceMembers', (select count(*) from definitions where area_hint = p_area and missing_since_snapshot is null),
    'history', (select h.history from cl_area_holdings(p_area) h))
  into v_plan;
  return v_plan;
end $$;

-- A family split back into its variants (FR-142, D2-D4): which family, the domain it was in, the
-- variants it had and the context items about it then, who split it, and the edition that did.
-- While a split stands, items about the family keep reaching agents through its former variants,
-- each flagged for its owner to check; joining the variants again ends it. Only an owner of the
-- family's domain or an admin splits a family or joins it again, and never one its tool declares.
CREATE TABLE public.family_splits (
    id uuid DEFAULT uuidv7() NOT NULL,
    family_key text NOT NULL,
    name text NOT NULL,
    area_id text,
    variants text[] NOT NULL,
    items text[] DEFAULT '{}'::text[] NOT NULL,
    split_by uuid NOT NULL,
    split_at timestamp with time zone DEFAULT now() NOT NULL,
    split_in bigint NOT NULL,
    joined_by uuid,
    joined_at timestamp with time zone,
    joined_in bigint,
    CONSTRAINT family_splits_pkey PRIMARY KEY (id),
    CONSTRAINT family_splits_key_check CHECK ((family_key ~ '^group:[a-z0-9_]+$'::text)),
    CONSTRAINT family_splits_name_check CHECK ((btrim(name) <> ''::text)),
    CONSTRAINT family_splits_variants_check CHECK (
      cardinality(variants) >= 2
      AND array_to_string(variants, ' ') ~ '^metric:[a-z0-9_]+( metric:[a-z0-9_]+)*$'::text),
    CONSTRAINT family_splits_joined_check CHECK (
      (joined_by IS NULL) = (joined_at IS NULL) AND (joined_by IS NULL) = (joined_in IS NULL)),
    CONSTRAINT family_splits_family_key_fkey FOREIGN KEY (family_key) REFERENCES public.vocab_terms(key),
    CONSTRAINT family_splits_split_by_fkey FOREIGN KEY (split_by) REFERENCES public.people(id),
    CONSTRAINT family_splits_joined_by_fkey FOREIGN KEY (joined_by) REFERENCES public.people(id),
    CONSTRAINT family_splits_split_in_fkey FOREIGN KEY (split_in) REFERENCES public.editions(seq),
    CONSTRAINT family_splits_joined_in_fkey FOREIGN KEY (joined_in) REFERENCES public.editions(seq)
);

-- One split stands for a family at a time.
CREATE UNIQUE INDEX family_splits_standing ON public.family_splits USING btree (family_key)
  WHERE (joined_in IS NULL);

-- A split is kept as it was made: joining its variants again is the one change, made once.
CREATE FUNCTION public.family_splits_guard() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'public', 'pg_temp'
    AS $$
begin
  if tg_op = 'DELETE' or old.joined_in is not null
     or (to_jsonb(new) - 'joined_by' - 'joined_at' - 'joined_in')
        <> (to_jsonb(old) - 'joined_by' - 'joined_at' - 'joined_in') then
    raise exception 'split % is kept as it was made', old.id using errcode = 'restrict_violation';
  end if;
  new.joined_at := now();
  return new;
end $$;

CREATE TRIGGER family_splits_guard BEFORE DELETE OR UPDATE ON public.family_splits
  FOR EACH ROW EXECUTE FUNCTION public.family_splits_guard();
CREATE TRIGGER ao_trunc_family_splits BEFORE TRUNCATE ON public.family_splits
  FOR EACH STATEMENT EXECUTE FUNCTION public.cl_forbid_mutation();

ALTER TABLE public.family_splits ENABLE ROW LEVEL SECURITY;
CREATE POLICY family_splits_read ON public.family_splits FOR SELECT USING (true);
CREATE POLICY family_splits_insert ON public.family_splits FOR INSERT WITH CHECK (
  (split_by = public.cl_person()) AND (joined_in IS NULL)
  AND (public.cl_is_admin_now() OR coalesce(public.cl_is_owner_now(area_id), false)));
CREATE POLICY family_splits_join ON public.family_splits FOR UPDATE USING (
  (joined_in IS NULL) AND (public.cl_is_admin_now() OR coalesce(public.cl_is_owner_now(area_id), false)))
  WITH CHECK (joined_by = public.cl_person());

-- Takes a family out of service in an edition: an owner of its domain or an admin, as for what it
-- means (family_meanings). A term of any other kind is retired by deleting its domain.
CREATE FUNCTION public.edition_close_family(p_seq bigint, p_key text) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
begin
  if not exists (select 1 from serving_vocabulary((select seq from live_edition)) t
                  where t.key = p_key and t.kind = 'metric_group' and cardinality(t.definition_refs) > 0) then
    raise exception '% is no family agents get now', p_key using errcode = 'no_data_found';
  end if;
  if not (cl_is_admin_now() or coalesce(cl_is_owner_now(cl_family_area(p_key)), false)) then
    raise exception 'only an owner of its domain or an administrator splits a family'
      using errcode = 'insufficient_privilege';
  end if;
  update vocab_term_service set editions = int8range(lower(editions), p_seq)
   where term_key = p_key and upper_inf(editions);
end $$;

-- The families split back into their metrics as an edition has them (FR-142): a family the edition
-- does not serve because of a split. The edition that last ended its service is the split's, or a
-- rollback edition, which has the content of the edition it restores, so that one is read the same
-- way. A family closed for any other reason is not split, and a split joined since reads as it is
-- served. Serving and the service read splits only through here.
CREATE FUNCTION public.serving_family_splits(p_seq bigint) RETURNS TABLE(id uuid, family_key text, name text, area_id text, variants text[], items text[], split_in bigint, split_at timestamp with time zone, joined_in bigint)
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
  with recursive ended(key, edition) as (
    select f.key, (select max(upper(s.editions)) from vocab_term_service s
                    where s.term_key = f.key and upper(s.editions) <= p_seq)
      from (select distinct family_key as key from family_splits) f
     where not exists (select 1 from vocab_term_service s
                        where s.term_key = f.key and s.editions @> p_seq)
    union
    select e.key, (select max(upper(s.editions)) from vocab_term_service s
                    where s.term_key = e.key and upper(s.editions) <= ed.restores_seq)
      from ended e join editions ed on ed.seq = e.edition and ed.restores_seq is not null)
  select distinct on (x.family_key) x.id, x.family_key, x.name, x.area_id, x.variants, x.items, x.split_in, x.split_at, x.joined_in
    from family_splits x join ended e on e.key = x.family_key and e.edition = x.split_in
   order by x.family_key, x.split_in desc, x.split_at desc $$;
