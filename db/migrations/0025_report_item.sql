-- An agent's report keeps the context item it names (FR-602, agent-side review, finding 5): the
-- owner's Inbox card and Observability show the reported item, not only its domain. A report never
-- names a person, so the item is the only thing it gains.
ALTER TABLE public.feedback ADD COLUMN item_id text REFERENCES public.items(id);

-- A get_context reply of the last 90 days by its id, with the one domain its question was about
-- (null when none or several): a report on a reply that does not exist is refused in words, and one
-- whose reply has no single domain says who sees it. Nothing else of the reply leaves.
CREATE FUNCTION public.serving_reply(p_id uuid) RETURNS TABLE(area_id text)
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
  select t.area_id from deliveries d left join topics t on t.id = d.topic_id
   where d.id = p_id and d.delivered_hour > now() - interval '90 days'
   limit 1 $$;
