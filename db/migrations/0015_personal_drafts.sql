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
