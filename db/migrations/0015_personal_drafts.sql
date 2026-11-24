-- Drafts are personal (FR-139): only the person who wrote a draft reads it or changes it. Owners of
-- its domain and admins read a suggestion once it is sent, as before, and every other state too.
-- A draft that names nobody (a content source's) is read by no person: a source only sends.
DROP POLICY proposals_read ON public.proposals;
CREATE POLICY proposals_read ON public.proposals FOR SELECT USING (
  ((state = 'accepted'::public.proposal_state) AND public.cl_item_open(item_id) AND public.cl_version_open(item_version_id))
  OR (proposer_id = public.cl_person())
  OR ((state <> 'draft'::public.proposal_state) AND (public.cl_is_admin_now() OR public.cl_is_owner_now(area_id)))
);

DROP POLICY proposals_write ON public.proposals;
CREATE POLICY proposals_write ON public.proposals
  USING ((proposer_id = public.cl_person())
         OR ((state <> 'draft'::public.proposal_state) AND (public.cl_is_admin_now() OR public.cl_is_owner_now(area_id))))
  WITH CHECK ((proposer_id = public.cl_person())
              OR ((state <> 'draft'::public.proposal_state) AND (public.cl_is_admin_now() OR public.cl_is_owner_now(area_id))));

-- A test question is attached to a draft by its writer only; owners and admins attach one to a
-- suggestion that waits for them, as before.
DROP POLICY proposal_tests_attach ON public.proposal_tests;
CREATE POLICY proposal_tests_attach ON public.proposal_tests FOR INSERT WITH CHECK ((EXISTS ( SELECT 1
   FROM public.proposals p
  WHERE ((p.id = proposal_tests.proposal_id) AND (p.discarded_at IS NULL) AND (((p.state = 'draft'::public.proposal_state) AND (p.proposer_id = public.cl_person())) OR ((p.state = ANY (ARRAY['submitted'::public.proposal_state, 'in_review'::public.proposal_state, 'changes_requested'::public.proposal_state])) AND (public.cl_is_admin_now() OR public.cl_is_owner_now(p.area_id))))))));
DROP POLICY proposal_tests_detach ON public.proposal_tests;
CREATE POLICY proposal_tests_detach ON public.proposal_tests FOR DELETE USING ((EXISTS ( SELECT 1
   FROM public.proposals p
  WHERE ((p.id = proposal_tests.proposal_id) AND (p.discarded_at IS NULL) AND (((p.state = 'draft'::public.proposal_state) AND (p.proposer_id = public.cl_person())) OR ((p.state = ANY (ARRAY['submitted'::public.proposal_state, 'in_review'::public.proposal_state, 'changes_requested'::public.proposal_state])) AND (public.cl_is_admin_now() OR public.cl_is_owner_now(p.area_id))))))));

-- The drafts of people who left, for an admin to clear: counted per person, never read.
CREATE FUNCTION public.cl_left_drafts() RETURNS TABLE(person_id uuid, drafts integer)
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
  select p.proposer_id, count(*)::int
    from proposals p join people pe on pe.id = p.proposer_id
   where cl_is_admin_now() and pe.deactivated_at is not null and pe.erased_at is null
     and p.state = 'draft' and p.discarded_at is null
   group by p.proposer_id $$;

-- An admin deletes every open draft of someone who left, by count: nobody reads them first. Each
-- draft's history says it was deleted, and the History log says how many, and whose.
CREATE FUNCTION public.cl_clear_left_drafts(p_person uuid) RETURNS integer
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
declare
  cleared integer;
  name text;
begin
  if not cl_is_admin_now() then
    raise exception 'only an admin clears the drafts of someone who left' using errcode = 'insufficient_privilege';
  end if;
  select display_name into name from people where id = p_person and deactivated_at is not null and erased_at is null;
  if not found then
    raise exception 'person % has not left', p_person using errcode = 'check_violation';
  end if;
  with gone as (
    update proposals set discarded_at = now()
     where proposer_id = p_person and state = 'draft' and discarded_at is null
     returning id
  ), told as (
    insert into proposal_events (proposal_id, actor_id, kind, data)
    select id, cl_person(), 'discarded', '{"left": true}'::jsonb from gone
    returning 1
  )
  select count(*)::int into cleared from told;
  if cleared > 0 then
    insert into audit_log (actor_id, actor_kind, action, subject_type, subject_id, details, source)
    values (cl_person(), 'person', 'drafts.cleared', 'person', p_person::text,
            jsonb_build_object('drafts', cleared, 'name', name), 'named');
  end if;
  return cleared;
end $$;

-- What deleting a domain does, as an admin reads it: its drafts only by count, and their writers' ids
-- to tell, never a draft's id, title or writer's name.
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
    'drafts', (select count(*)::int from proposals p
       where p.area_id = p_area and p.discarded_at is null and p.state = 'draft'),
    'draftWriters', coalesce((
      select jsonb_agg(w.proposer_id order by w.proposer_id)
        from (select distinct p.proposer_id from proposals p
               where p.area_id = p_area and p.discarded_at is null and p.state = 'draft') w), '[]'::jsonb),
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
