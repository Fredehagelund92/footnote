-- Two read-only tools that list what there is (FR-351, FR-352): list_definitions, the metrics,
-- dimensions and terms of the live definitions, and list_context, the published context items an
-- agent may see. Both are on for the workspace, like every tool, until an admin switches one off.
insert into public.tool_config (tool, enabled) values
  ('list_definitions', true),
  ('list_context', true);

ALTER TABLE auth.agents
  DROP CONSTRAINT agents_tools_check,
  ADD CONSTRAINT agents_tools_check CHECK (
    (tools <@ ARRAY['get_context', 'find_context', 'read_context', 'report', 'suggest_context',
                    'get_related', 'list_definitions', 'list_context'])
    AND ((kind = 'app') OR (NOT ('suggest_context' = ANY (tools))))
  );

-- A new agent gets every tool its kind may have. An agent that exists already gets the two where
-- it has find_context on, since listing finds what there is as a word search does: an agent an
-- admin kept from searching, or switched off altogether, gets no more than before.
UPDATE auth.agents
   SET tools = tools || ARRAY['list_definitions', 'list_context']
 WHERE 'find_context' = ANY (tools);
