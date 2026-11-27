-- A draft a person writes with their agent (Route 1, slice R1a): two MCP tools, write_draft, which
-- writes or changes one of the person's own drafts and never sends it, and read_draft, which reads
-- one back with its revision. Each field of a proposal keeps who last changed it, the person or
-- their agent, at which revision and when, so a write from an agent that read an older revision
-- never overwrites a field the person changed since. Keyed by the marked fields' names
-- (src/domain/proposal-rules.ts); a field nobody changed since this migration has no stamp.
ALTER TABLE public.proposals
  ADD COLUMN field_stamps jsonb DEFAULT '{}'::jsonb NOT NULL,
  ADD CONSTRAINT proposals_field_stamps_check CHECK (jsonb_typeof(field_stamps) = 'object');

-- Both tools are on for the workspace, like every tool, until an admin switches one off.
insert into public.tool_config (tool, enabled) values
  ('write_draft', true),
  ('read_draft', true);

-- They write and read as a person, so an access key, which names nobody, never gets them.
ALTER TABLE auth.agents
  DROP CONSTRAINT agents_tools_check,
  ADD CONSTRAINT agents_tools_check CHECK (
    (tools <@ ARRAY['get_context', 'find_context', 'read_context', 'report', 'suggest_context',
                    'write_draft', 'read_draft'])
    AND ((kind = 'app') OR NOT (tools && ARRAY['suggest_context', 'write_draft', 'read_draft']))
  );

-- A new agent gets every tool its kind may have. An agent that exists already gets the two where
-- it has suggest_context on, since they write drafts as it does: an agent an admin kept from
-- suggesting, or switched off altogether, gets no more than before.
UPDATE auth.agents
   SET tools = tools || ARRAY['write_draft', 'read_draft']
 WHERE 'suggest_context' = ANY (tools);
