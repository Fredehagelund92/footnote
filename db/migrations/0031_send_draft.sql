-- One send step for a draft the person writes with their agent: send_draft(draft_id, revision)
-- sends exactly the revision the person said yes to, and suggest_context, which wrote and sent its
-- own words in one call, goes. An agent and a client that had suggest_context on get send_draft;
-- one an admin kept from suggesting gets no more than before. The admin's switch keeps its state,
-- and a standing permission to publish without review (FR-421) now needs send_draft on.
UPDATE public.tool_config SET tool = 'send_draft', updated_at = now() WHERE tool = 'suggest_context';

ALTER TABLE auth.agents DROP CONSTRAINT agents_tools_check;
UPDATE auth.agents
   SET tools = array_replace(tools, 'suggest_context', 'send_draft')
 WHERE 'suggest_context' = ANY (tools);
ALTER TABLE auth.agents
  ADD CONSTRAINT agents_tools_check CHECK (
    (tools <@ ARRAY['get_context', 'find_context', 'read_context', 'report', 'write_draft',
                    'read_draft', 'send_draft'])
    AND ((kind = 'app') OR NOT (tools && ARRAY['write_draft', 'read_draft', 'send_draft']))
  );

UPDATE public.client_policies
   SET tools_allowed = array_replace(tools_allowed, 'suggest_context', 'send_draft')
 WHERE 'suggest_context' = ANY (tools_allowed);

-- A per-tool rate an admin set for suggest_context stays with the send step.
insert into public.settings_versions (key, version, value, reason)
select key, version + 1, (value - 'suggest_context') || jsonb_build_object('send_draft', value -> 'suggest_context'),
       'suggest_context became send_draft'
  from public.settings_current
 where key = 'limits.mcp_rate_per_minute' and value ? 'suggest_context';

-- The question form suggest_context showed in the agent goes with it: no round saves a draft now.
ALTER TABLE public.proposals DROP COLUMN answers_round;

-- The database guard on a decision under a policy names the send step.
CREATE OR REPLACE FUNCTION public.cl_policy_decision_problem(d public.decisions) RETURNS text
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
declare
  pol agent_policies;
  p proposals;
  v item_versions;
  used integer;
begin
  select * into pol from agent_policies where id = d.auto_policy_id for update;
  if not found or pol.ended_at is not null then return 'the policy is off'; end if;
  if not cl_auto_publish_on() then return 'publishing without review is off for the workspace'; end if;
  if d.outcome <> 'accept' or d.proposal_id is null or d.item_version_id is null then
    return 'a policy only publishes a suggestion';
  end if;
  if d.decided_by <> pol.set_by or d.decided_by is distinct from cl_person() then
    return 'the decision is not by the person who set the policy';
  end if;
  if d.area_id is distinct from pol.area_id then return 'the policy is for another domain'; end if;
  if d.capacity::text <> 'owner' or not cl_has_area_role(d.decided_by, pol.area_id, 'owner', now()) then
    return 'the person who set the policy is no longer an owner of the domain';
  end if;
  select * into p from proposals where id = d.proposal_id;
  if p.agent_id is distinct from pol.agent_id or p.channel <> 'mcp' then
    return 'the suggestion is not from the agent of the policy';
  end if;
  if p.action <> 'create' then return 'a policy only publishes new items'; end if;
  select * into v from item_versions where id = d.item_version_id;
  if v.area_id <> pol.area_id or p.area_id is distinct from pol.area_id then
    return 'the policy is for another domain';
  end if;
  if v.risk <> 'low' then return 'a policy only publishes low-risk items'; end if;
  if not exists (select 1 from auth.agents a where a.id = pol.agent_id and a.kind = 'app'
                    and 'send_draft' = any (a.tools)) then
    return 'send_draft is off for the agent';
  end if;
  if not coalesce((select enabled from tool_config where tool = 'send_draft'), false) then
    return 'send_draft is off for the workspace';
  end if;
  select count(*) into used from decisions
   where auto_policy_id = pol.id and decided_at > now() - interval '24 hours';
  if used >= pol.per_day then return 'the policy published its most for today'; end if;
  return null;
end $$;
