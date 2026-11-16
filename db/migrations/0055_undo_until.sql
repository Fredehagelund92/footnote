-- 0055_undo_until: the undo window, asked in one place.
--
-- - `limits.undo_seconds` was read in six places: the policies on decision_undos, card_states,
--   item_changes and term_changes, the deleted-draft branch of proposals_guard_state, and the
--   service's own check of a conflict decision, which defaulted to 0 where the others said 15.
-- - cl_undo_until(at) is that rule: when an undo of something done at `at` stops being taken. Each
--   of them reads it, and the service reads it to tell the screens how long they may offer Undo.
-- - A conflict decision is undone by its maker, once, in the window, as a change to items is: the
--   policy held only who decided, so two overlapping Undo requests both passed.

create function public.cl_undo_until(at timestamptz) returns timestamptz
    language sql stable
    set search_path to 'public', 'pg_temp'
    as $$
  select at + make_interval(secs => coalesce(
           (select (value #>> '{}')::int from settings_current where key = 'limits.undo_seconds'), 15))
$$;

drop policy decision_undos_insert on public.decision_undos;
create policy decision_undos_insert on public.decision_undos for insert
    with check (undone_by = public.cl_person()
           and exists (select 1 from public.decisions d
                        where d.id = decision_undos.decision_id
                          and ((d.decided_by = public.cl_person() and now() < public.cl_undo_until(d.decided_at))
                               or (d.auto_policy_id is not null
                                   and (public.cl_is_owner_now(d.area_id) or public.cl_is_admin_now())))));

drop policy card_states_delete on public.card_states;
create policy card_states_delete on public.card_states for delete
    using (decided_by = public.cl_person() and now() < public.cl_undo_until(decided_at));

drop policy item_changes_undo on public.item_changes;
create policy item_changes_undo on public.item_changes for update
    using (made_by = public.cl_person() and undone_at is null and now() < public.cl_undo_until(made_at))
    with check (made_by = public.cl_person() and undone_at is not null);

drop policy term_changes_undo on public.term_changes;
create policy term_changes_undo on public.term_changes for update
    using (made_by = public.cl_person() and undone_at is null and now() < public.cl_undo_until(made_at))
    with check (made_by = public.cl_person() and undone_at is not null);

drop policy conflict_decisions_undo on public.conflict_decisions;
create policy conflict_decisions_undo on public.conflict_decisions for update
    using (decided_by = public.cl_person() and undone_at is null and now() < public.cl_undo_until(decided_at))
    with check (decided_by = public.cl_person() and undone_at is not null);

create or replace function public.proposals_guard_state() returns trigger
    language plpgsql
    as $$
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
    if not edit_ok then
      raise exception 'proposal % version is fixed after submit', old.id using errcode = 'check_violation';
    end if;
  end if;
  if new.revision = old.revision then new.revision := old.revision + 1; end if;
  return new;
end $$;
