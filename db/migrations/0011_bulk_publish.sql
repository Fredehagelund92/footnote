-- Drafts are published from the Context list too (FR-139): a Publish of many drafts is one change
-- in the History log, and its Undo takes back what it published and what it sent to the owners.
ALTER TABLE public.item_changes
  DROP CONSTRAINT item_changes_action_check,
  ADD CONSTRAINT item_changes_action_check CHECK (
    action = ANY (ARRAY['archived', 'deleted', 'moved', 'kind', 'owners', 'checked', 'published'])
  );
