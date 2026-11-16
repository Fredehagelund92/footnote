-- 0056_item_index_version: the library index reads each entry's version by its id.
--
-- - The library's rows (src/server/modules/library/service.ts) found each entry's version by
--   joining item_versions on the number inside the entry, a condition PostgreSQL cannot estimate:
--   it planned every join after it for 7 rows instead of about 1,500, and built each entry once
--   more for every version an item ever had.
-- - v_item_index now gives the version's id beside the entry, so the rows read it from there.
--   The view is otherwise as before: the new column is last, as a replaced view requires.

CREATE OR REPLACE VIEW public.v_item_index AS
 SELECT l.id,
    l.audience_groups,
    jsonb_build_object('id', l.id, 'kind', l.kind, 'areaId', l.area_id, 'status', l.status, 'version', l.version_no, 'title', l.title, 'summary', l.summary, 'scope', jsonb_build_object('metrics', COALESCE(( SELECT jsonb_agg(substr(m.metric_key, 8) ORDER BY m.metric_key) AS jsonb_agg
           FROM public.item_version_metrics m
          WHERE (m.version_id = l.version_id)), '[]'::jsonb), 'dimensions', COALESCE(( SELECT jsonb_agg(substr(d.dimension_key, 5) ORDER BY d.dimension_key) AS jsonb_agg
           FROM public.item_version_dimensions d
          WHERE (d.version_id = l.version_id)), '[]'::jsonb), 'dimensionValues', COALESCE(( SELECT jsonb_agg(jsonb_build_object('dimension', substr(d.dimension_key, 5), 'value', split_part(d.value_key, '/'::text, 2)) ORDER BY d.value_key) AS jsonb_agg
           FROM public.item_version_dimension_values d
          WHERE (d.version_id = l.version_id)), '[]'::jsonb)), 'validity', jsonb_build_object('start', l.valid_from, 'end', l.valid_until), 'reviewDate', l.review_date, 'reviewQuestion',
        CASE
            WHEN (((l.kind)::text = 'issue'::text) AND (l.valid_until IS NULL)) THEN 'still_going_on'::text
            ELSE 'still_correct'::text
        END, 'checkFlag', f.flag, 'ownerId', l.owner_id, 'proposerId', l.proposer_id, 'updatedAt', to_char((l.updated_at AT TIME ZONE 'UTC'::text), 'YYYY-MM-DD"T"HH24:MI:SS"Z"'::text)) AS entry,
    l.version_id
   FROM (public.v_item_list l
     LEFT JOIN ( SELECT DISTINCT ON (o.item_id) o.item_id,
            o.flag
           FROM public.v_overlay_on o
          WHERE ((o.kind = 'flag_on'::text) AND (o.item_id IS NOT NULL))
          ORDER BY o.item_id, (o.flag = 'source_missing'::public.source_flag) DESC) f ON ((f.item_id = l.id)));
