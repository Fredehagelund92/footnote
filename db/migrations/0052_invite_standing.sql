-- 0052_invite_standing: whether an invite will let its person in, and with what, asked in one place.
--
-- - auth.accept_invite held the rule alone: an open invite in time is refused when its sender has
--   lost the authority to make it, and gives only the domains its sender may still give. The People
--   list and the link page did not know it, so an invite whose sender had left was listed as
--   Invited, its link page named its domains, and the sign-in refused it.
-- - invite_standing(invite) is that rule: open; expired; or void, when it would let nobody in (its
--   sender can no longer make it, the address is a member already, or the person was erased); with
--   the domains it gives. The list, the link page and accept_invite all read it.
-- - An admin who sends a void invite again becomes its sender, so the new link works. Anyone else
--   who sends it again keeps the sender, as before.

-- An invite's standing: accepted or revoked once closed; else void, expired or open, in that order,
-- with why a void one lets nobody in. An erased person never comes back, and one an admin removed
-- comes back only on an admin's invite. The domains are those it names that still exist and that
-- its sender may still give: any, for an admin or the operator; else those the sender still owns.
create function public.invite_standing(p_invite invites, out standing text, out why text, out area_ids text[])
    language plpgsql stable security definer
    set search_path to 'public', 'pg_temp'
    as $$
declare
  sender_admin boolean := p_invite.invited_by is null or cl_is_admin(p_invite.invited_by, now());
  person people;
begin
  select coalesce(array_agg(a.id order by a.id), '{}') into area_ids from areas a
   where a.id = any(p_invite.area_ids) and a.archived_at is null
     and (sender_admin or cl_has_area_role(p_invite.invited_by, a.id, 'owner', now()));
  select * into person from people where email = p_invite.email;
  standing := 'void';
  if p_invite.accepted_at is not null then
    standing := 'accepted';
  elsif p_invite.revoked_at is not null then
    standing := 'revoked';
  elsif person.erased_at is not null then
    why := 'erased';
  elsif person.id is not null and person.deactivated_at is null then
    why := 'member';
  elsif (person.id is not null and not sender_admin)
     or (p_invite.role = 'admin' and not sender_admin)
     or (p_invite.role = 'member' and not sender_admin and cardinality(area_ids) = 0) then
    why := 'sender';
  elsif p_invite.expires_at <= now() then
    standing := 'expired';
  else
    standing := 'open';
  end if;
end $$;

revoke all on function public.invite_standing(invites) from public;

-- What an invite is never changes: its address, role, domains and start. Its sender changes once
-- in one case: an admin sends again an invite its sender can no longer make, and becomes its sender.
create or replace function public.invites_guard() returns trigger
    language plpgsql
    set search_path to 'public', 'pg_temp'
    as $$
begin
  if old.accepted_at is not null or old.revoked_at is not null then
    raise exception 'invite % is closed', old.id using errcode = 'check_violation';
  end if;
  if (new.email, new.role, new.area_ids, new.created_at)
     is distinct from (old.email, old.role, old.area_ids, old.created_at)
     or (new.invited_by is distinct from old.invited_by
         and not coalesce(new.invited_by = cl_person() and cl_is_admin_now()
                          and (invite_standing(old)).why = 'sender', false)) then
    raise exception 'invite % may only be sent again, revoked or accepted', old.id
      using errcode = 'check_violation';
  end if;
  return new;
end $$;

-- As in 0014, with invite_standing deciding: only an open invite is accepted, and it gives the
-- domains its standing names.
create or replace function auth.accept_invite(p_email text, p_name text) returns uuid
    language plpgsql security definer
    set search_path to 'public', 'pg_temp'
    as $$
declare
  invite invites;
  standing record;
  person uuid;
  area text;
  sender_kind text;
  name text := nullif(btrim(p_name), '');
begin
  perform pg_advisory_xact_lock(hashtextextended('heed.roles', 0));
  select * into invite from invites
   where email = lower(btrim(p_email)) and accepted_at is null and revoked_at is null
   for update;
  if invite.id is null then return null; end if;
  select * into standing from invite_standing(invite);
  if standing.standing <> 'open' then return null; end if;
  sender_kind := case when invite.invited_by is null then 'service' else 'person' end;
  select id into person from people where email = invite.email;
  if person is null then
    insert into people(email, display_name) values (invite.email, coalesce(name, invite.email))
      returning id into person;
  else
    update people set deactivated_at = null where id = person and deactivated_at is not null;
  end if;
  update invites set accepted_at = now(), accepted_by = person where id = invite.id;
  insert into audit_log(actor_id, actor_kind, action, subject_type, subject_id, details, source)
    values (person, 'person', 'invite.accepted', 'invite', invite.id::text,
            jsonb_build_object('person', person, 'role', invite.role, 'areas', to_jsonb(invite.area_ids)), 'named');
  if invite.role = 'admin' and not exists (select 1 from global_role_grants g
       where g.person_id = person and g.role = 'administrator' and g.valid_at @> now()) then
    insert into global_role_grants(person_id, role, granted_by) values (person, 'administrator', invite.invited_by);
    insert into audit_log(actor_id, actor_kind, action, subject_type, subject_id, details, reason, source)
      values (invite.invited_by, sender_kind, 'role.granted', 'person', person::text,
              jsonb_build_object('role', 'administrator'), 'Invited', 'named');
  end if;
  foreach area in array standing.area_ids loop
    if not cl_has_area_role(person, area, 'owner', now()) then
      insert into area_assignments(area_id, person_id, role, granted_by) values (area, person, 'owner', invite.invited_by);
      insert into audit_log(actor_id, actor_kind, action, area_id, subject_type, subject_id, details, reason, source)
        values (invite.invited_by, sender_kind, 'assignment.granted', area, 'person', person::text,
                jsonb_build_object('role', 'owner'), 'Invited', 'named');
    end if;
  end loop;
  return person;
end $$;

-- What an invite link's sign-in screen names, by the SHA-256 of the link's token: the address, the
-- role and the domains it gives, while it is open. Nothing for any other token, alike whatever the
-- reason, a void invite included. Runs as the owner: nobody is signed in yet.
create or replace function auth.invite_by_token(p_token_hash text)
    returns table(email text, role text, areas jsonb, expires_at timestamp with time zone)
    language sql stable security definer
    set search_path to 'public', 'pg_temp'
    as $$
  select i.email, i.role,
         coalesce((select jsonb_agg(jsonb_build_object('id', a.id, 'name', a.name) order by a.name, a.id)
                     from areas a where a.id = any(s.area_ids)), '[]'::jsonb),
         i.expires_at
    from invites i cross join lateral invite_standing(i) s
   where i.token_hash = p_token_hash and s.standing = 'open' $$;
