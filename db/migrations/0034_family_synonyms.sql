-- Another name for a family of metrics (FR-138, FR-142): Definitions shows a family as one metric,
-- with a box to give it another name, as a metric has, but synonyms came before families and
-- every check on what one means took a metric or a dimension only. The service refused a family
-- as a request it could not read, and the box said only that the word was not added. A synonym
-- may now mean a family, as it may a metric: the write guard takes one agents get now, and a
-- synonym of a live family is no conflict to agents. Agents read it among the family's other
-- names (src/domain/served-terms.ts).

CREATE OR REPLACE FUNCTION public.terms_guard() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
declare
  -- A stored generated column is computed after this trigger: the word is worked out here.
  v_word text := cl_term_word(new.name);
  restoring boolean := tg_op = 'UPDATE' and old.deleted_at is not null and new.deleted_at is null;
  claims boolean := tg_op = 'INSERT' or restoring
                    or (new.deleted_at is null and (v_word <> old.word
                        or new.same_as_key is distinct from old.same_as_key
                        or new.same_as_term is distinct from old.same_as_term));
begin
  if tg_op = 'UPDATE' then
    if new.id <> old.id or new.created_by <> old.created_by or new.created_at <> old.created_at then
      raise exception 'a term keeps its id and who wrote it' using errcode = 'check_violation';
    end if;
    if old.deleted_at is not null and not restoring then
      raise exception 'term % was deleted: restore it first', old.id using errcode = 'check_violation';
    end if;
    if new.deleted_at is not null and old.deleted_at is null then
      if exists (select 1 from terms s where s.same_as_term = new.id and s.deleted_at is null) then
        raise exception 'delete the synonyms of term % with it', new.id using errcode = 'check_violation';
      end if;
      new.deleted_by := cl_person();
    end if;
    if restoring then
      new.deleted_by := null;
      new.deleted_with := null;
    end if;
    new.revision := old.revision + 1;
    new.updated_at := now();
  end if;
  if new.deleted_at is null then
    if new.same_as_key is not null and not exists (
         select 1 from vocab_term_service s join vocab_terms t on t.key = s.term_key
          where s.term_key = new.same_as_key and t.kind in ('metric', 'metric_group', 'dimension')
            and s.editions @> (select seq from live_edition)) and claims then
      raise exception 'a synonym means a metric, a family of metrics or a dimension agents get now' using errcode = 'foreign_key_violation';
    end if;
    if new.same_as_term is not null and not exists (
         select 1 from terms t where t.id = new.same_as_term and t.deleted_at is null and t.meaning is not null) then
      raise exception 'a synonym means a term with its own meaning' using errcode = 'check_violation';
    end if;
    if new.meaning is null and exists (
         select 1 from terms s where s.same_as_term = new.id and s.deleted_at is null) then
      raise exception 'other words mean term %: it keeps its own meaning', new.id using errcode = 'check_violation';
    end if;
    -- A synonym's domain is what it means.
    if new.meaning is null then
      new.area_id := cl_term_target_area(new.same_as_key, new.same_as_term);
    end if;
    if claims and exists (select 1 from cl_vocabulary_words() w where w.word = v_word) then
      raise exception 'the word "%" already means a metric or a dimension', btrim(new.name)
        using errcode = 'unique_violation', constraint = 'terms_vocabulary_word';
    end if;
  end if;
  return new;
end $$;

CREATE OR REPLACE FUNCTION public.serving_terms() RETURNS TABLE(id text, name text, meaning text, same_as text, area_id text, written_on text, written_as text, conflict boolean, also_means text[])
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
  with words as materialized (select w.word, w.key from cl_vocabulary_words() w),
  live as materialized (
    select s.term_key as key
      from vocab_term_service s join vocab_terms t on t.key = s.term_key
     where s.editions @> (select seq from live_edition) and t.kind in ('metric', 'metric_group', 'dimension'))
  select t.id::text, t.name, t.meaning,
         coalesce(t.same_as_key, 'term:' || t.same_as_term::text),
         t.area_id,
         to_char(t.updated_at at time zone 'UTC', 'YYYY-MM-DD'),
         case when t.area_id is not null and cl_has_area_role(t.updated_by, t.area_id, 'owner', t.updated_at) then 'owner'
              when cl_is_admin(t.updated_by, t.updated_at) then 'administrator'
              when t.area_id is null then 'administrator'
              else 'owner' end,
         exists (select 1 from words w where w.word = t.word and w.key is distinct from t.same_as_key)
           or (t.same_as_key is not null and not exists (select 1 from live l where l.key = t.same_as_key)),
         array(select distinct w.key from words w
                where w.word = t.word and w.key is distinct from t.same_as_key order by w.key)
    from terms t
   where t.deleted_at is null
   order by t.word $$;
