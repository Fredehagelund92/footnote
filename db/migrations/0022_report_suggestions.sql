-- The right words from a report in Ask (FR-622): a person who reports a context item may write the
-- words it should say, and they go to its owners as a suggestion on the item, which waits for an
-- owner like any other. The report names that suggestion, so its Reported card leads to its
-- review. A report is never changed, so the suggestion is made first, in the same transaction, and
-- only its sender's own suggestion on the same item may be named.
ALTER TABLE public.reports ADD COLUMN proposal_id uuid REFERENCES public.proposals(id);
ALTER TABLE public.reports ADD CONSTRAINT reports_proposal_check
  CHECK (proposal_id IS NULL OR (part = 'item' AND correction IS NOT NULL));

DROP POLICY reports_insert ON public.reports;
CREATE POLICY reports_insert ON public.reports FOR INSERT WITH CHECK (
  person_id = public.cl_person() AND public.cl_item_open(item_id)
  AND (proposal_id IS NULL OR EXISTS (
    SELECT 1 FROM public.proposals p
     WHERE p.id = proposal_id AND p.proposer_id = public.cl_person() AND p.item_id = reports.item_id)));
