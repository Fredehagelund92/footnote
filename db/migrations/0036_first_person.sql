-- The first person of a workspace on its own data (the cold first use scout, call 2). The picker
-- of such an install has no sample people: its first visitor says who they are, and this makes
-- them its admin, once. Taken under the lock the picker's other people are made under, so two
-- first visits at once make one person; whoever comes second is told someone is there already.
CREATE FUNCTION auth.first_person(p_email text, p_name text) RETURNS uuid
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
declare person uuid;
begin
  perform pg_advisory_xact_lock(hashtextextended('footnote.dev_people', 0));
  if exists (select 1 from people) then return null; end if;
  insert into people(email, display_name) values (lower(p_email), btrim(p_name)) returning id into person;
  insert into auth.dev_people(person_id) values (person);
  insert into global_role_grants(person_id, role) values (person, 'administrator');
  return person;
end $$;

REVOKE ALL ON FUNCTION auth.first_person(p_email text, p_name text) FROM PUBLIC;
