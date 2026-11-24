-- Figures in Ask leave version 1 (FR-716 and CON-612 withdrawn): Footnote reads no business figure
-- and keeps none. A source keeps no figures settings and has no data contact, and a named report is
-- about a context item or the answer. A figure report already sent stays as a report about its
-- context item, for that item's owners: the data contact who also heard it is gone with figures.

-- The figure parts of who reads a report, and of who closes one, go first: they name the columns.
DROP POLICY card_states_insert_contact ON public.card_states;
DROP POLICY card_states_read_contact ON public.card_states;
DROP POLICY reports_read ON public.reports;
CREATE POLICY reports_read ON public.reports FOR SELECT USING (
  (person_id = public.cl_person()) OR public.cl_is_admin_now() OR public.cl_is_owner_now(area_id)
);

CREATE OR REPLACE FUNCTION public.cl_report_outcome(p_report uuid) RETURNS TABLE(outcome text, decided_at timestamp with time zone)
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
  with r as (
    select * from reports
     where id = p_report
       and (person_id = cl_person() or cl_is_admin_now() or cl_is_owner_now(area_id))
  )
  select x.outcome, x.at from (
    select 'not_a_problem'::text as outcome, c.decided_at as at
      from r join card_states c on c.card = 'report:' || r.id::text
    union all
    select case when d.outcome = 'retire' then 'archived'
                when v.is_recheck then 'checked'
                else 'changed' end,
           d.decided_at
      from r join item_versions v on v.item_id = r.item_id
             join decisions d on d.item_version_id = v.id
     where d.outcome in ('accept', 'retire') and d.decided_at > r.created_at
       and not exists (select 1 from decision_undos u where u.decision_id = d.id)
  ) x
  order by x.at limit 1 $$;

DROP FUNCTION public.cl_figure_disputes(text, text, text[], date, date);
DROP FUNCTION public.cl_closes_figure_report(text);
DROP FUNCTION public.cl_is_figure_contact(text);

-- Reports are append-only; this one rewrite is the migration's own.
ALTER TABLE public.reports
  DROP CONSTRAINT reports_figure_check,
  DROP CONSTRAINT reports_part_check;
ALTER TABLE public.reports DISABLE TRIGGER ao_row_reports;
UPDATE public.reports SET part = 'item' WHERE part = 'figure';
ALTER TABLE public.reports ENABLE TRIGGER ao_row_reports;

DROP INDEX public.reports_figure;
ALTER TABLE public.reports
  DROP CONSTRAINT reports_figure_days_check,
  DROP CONSTRAINT reports_figure_metric_check,
  DROP CONSTRAINT reports_figure_route_check,
  DROP CONSTRAINT reports_figure_source_fkey,
  DROP COLUMN figure_source,
  DROP COLUMN figure_metric,
  DROP COLUMN figure_values,
  DROP COLUMN figure_from,
  DROP COLUMN figure_to,
  DROP COLUMN figure_route,
  ADD CONSTRAINT reports_part_check CHECK ((part = ANY (ARRAY['item'::text, 'answer'::text])));

-- A source's figures settings and its data contact. A token they named stays in the secret store
-- the server keeps, which this database cannot reach: whoever runs the server may remove it.
ALTER TABLE public.connectors DROP CONSTRAINT connectors_figures_secret_ref;
UPDATE public.connectors SET capabilities = capabilities - 'figures' WHERE capabilities ? 'figures';
ALTER TABLE public.connectors
  DROP CONSTRAINT connectors_data_contact_id_fkey,
  DROP COLUMN data_contact_id;
