-- Edit then publish (FR-137): an owner of a suggestion's domain, or an admin, may write their own
-- words into a suggestion waiting for their review, to publish it as itself. The words are a new
-- version that supersedes the one sent and names its editor; its writer stays, so the sender
-- keeps the credit. Every other version stays fixed after submit, as before.
CREATE OR REPLACE FUNCTION public.proposals_guard_state() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
declare
  edit_ok boolean := false;
begin
  if old.discarded_at is not null then
    -- A deleted draft comes back only as its deleter's undo, within the window: nothing else changes.
    if new.discarded_at is null and old.discarded_by = cl_person()
       and now() < cl_undo_until(old.discarded_at)
       and (to_jsonb(new) - '{discarded_at,discarded_by,revision,updated_at}'::text[])
             = (to_jsonb(old) - '{discarded_at,discarded_by,revision,updated_at}'::text[]) then
      new.discarded_by := null;
      if new.revision = old.revision then new.revision := old.revision + 1; end if;
      return new;
    end if;
    raise exception 'proposal % was discarded', old.id using errcode = 'check_violation';
  end if;
  -- Whoever deletes a draft is recorded with it, for the Deleted list.
  if new.discarded_at is not null then new.discarded_by := cl_person(); end if;
  if new.state is distinct from old.state
     and not exists (select 1 from proposal_transitions t where t.from_state = old.state and t.to_state = new.state) then
    raise exception 'proposal % cannot move from % to %', old.id, old.state, new.state using errcode = 'check_violation';
  end if;
  -- After submit the version is fixed, except for a review edit: a new version of the same item, edited by the person
  -- making this change, that supersedes the submitted one and keeps its content.
  if old.item_version_id is not null and new.item_version_id is distinct from old.item_version_id and old.state <> 'changes_requested' then
    edit_ok := coalesce(
       old.state in ('submitted', 'in_review') and new.state = old.state and old.action in ('create', 'change')
       and new.item_id = old.item_id
       and exists (select 1 from item_versions v where v.id = new.item_version_id and v.item_id = old.item_id
                     and v.supersedes_version_id = old.item_version_id and v.edited_by = cl_person() and not v.is_recheck
                     and exists (select 1 from item_versions o where o.id = old.item_version_id
                                   and cl_has_area_role(cl_person(), o.area_id, 'owner', now()))
                     and (v.area_id = (select o.area_id from item_versions o where o.id = old.item_version_id)
                          or cl_is_admin(cl_person(), now())
                          or cl_has_area_role(cl_person(), v.area_id, 'owner', now()))
                     and ((v.proposer_id is distinct from cl_person()
                           and cl_item_version_kept(new.item_version_id) = cl_item_version_kept(old.item_version_id))
                          or (cl_item_version_kept(new.item_version_id) - 'replaces' - 'conflicts'
                                = cl_item_version_kept(old.item_version_id) - 'replaces' - 'conflicts'
                              and cl_item_version_kept(new.item_version_id) <> cl_item_version_kept(old.item_version_id)
                              and (cl_item_version_kept(new.item_version_id) -> 'replaces')
                                    @> (cl_item_version_kept(old.item_version_id) -> 'replaces')
                              and (cl_item_version_kept(new.item_version_id) -> 'conflicts')
                                    @> (cl_item_version_kept(old.item_version_id) -> 'conflicts')))), false);
    -- Edit then publish: an admin, or an owner of its domain before and after, writes their own words
    -- into someone else's suggestion that waits for them, to publish it. The new version keeps its
    -- writer, and names who edited it.
    edit_ok := edit_ok or coalesce(
       old.state in ('submitted', 'in_review') and new.state = old.state and old.action in ('create', 'change')
       and new.item_id = old.item_id
       and exists (select 1 from item_versions v join item_versions o on o.id = old.item_version_id
                    where v.id = new.item_version_id and v.item_id = old.item_id
                      and v.supersedes_version_id = old.item_version_id and v.edited_by = cl_person()
                      and not v.is_recheck
                      and v.proposer_id is not distinct from o.proposer_id
                      and v.proposer_id is distinct from cl_person()
                      and (cl_is_admin(cl_person(), now())
                           or (cl_has_area_role(cl_person(), o.area_id, 'owner', now())
                               and cl_has_area_role(cl_person(), v.area_id, 'owner', now())))), false);
    if not edit_ok then
      raise exception 'proposal % version is fixed after submit', old.id using errcode = 'check_violation';
    end if;
  end if;
  if new.revision = old.revision then new.revision := old.revision + 1; end if;
  return new;
end $$;
