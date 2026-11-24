-- Five MCP tools (docs/product.md, section 10): find_context lists what there is when it is given
-- no words, and read_context gives an item's links one step out and in with every read, so
-- list_definitions, list_context and get_related go, with their switches. An agent or a client
-- kept from find_context or read_context gets no more than before.
DELETE FROM public.tool_config WHERE tool IN ('get_related', 'list_definitions', 'list_context');

UPDATE auth.agents
   SET tools = array_remove(array_remove(array_remove(tools, 'get_related'), 'list_definitions'),
                            'list_context')
 WHERE tools && ARRAY['get_related', 'list_definitions', 'list_context'];

ALTER TABLE auth.agents
  DROP CONSTRAINT agents_tools_check,
  ADD CONSTRAINT agents_tools_check CHECK (
    (tools <@ ARRAY['get_context', 'find_context', 'read_context', 'report', 'suggest_context'])
    AND ((kind = 'app') OR (NOT ('suggest_context' = ANY (tools))))
  );

UPDATE public.client_policies
   SET tools_allowed = array_remove(array_remove(array_remove(tools_allowed, 'get_related'),
                                                 'list_definitions'), 'list_context')
 WHERE tools_allowed && ARRAY['get_related', 'list_definitions', 'list_context'];

-- Links runs (get_related off against on) go with the tool. A run made as one is kept, with its
-- cells and what it cost, as a run of the whole set: both of its sides answered on one edition.
UPDATE public.eval_runs SET kind = 'full' WHERE kind = 'links';

ALTER TYPE public.eval_kind RENAME TO eval_kind_before;
CREATE TYPE public.eval_kind AS ENUM (
    'full',
    'scheduled',
    'held_out'
);
ALTER TABLE public.eval_runs
  ALTER COLUMN kind TYPE public.eval_kind USING kind::text::public.eval_kind;
DROP TYPE public.eval_kind_before;
