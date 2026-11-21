-- A metric that is one variant of a family (FR-142): what its source read of it as a variant. The
-- shape is the digest of its calculation with the literals its filters compare left out, the same
-- for every variant of a family; `variant_by` holds those literals, each with the column or
-- dimension it is compared with ([{"name","ref","value"}]). Both are null for any other definition.
alter table public.definitions
  add column variant_shape text,
  add column variant_by jsonb,
  add constraint definitions_variant_check check (
    (variant_shape is null and variant_by is null)
    or (variant_shape ~ '^[a-f0-9]{64}$' and jsonb_typeof(variant_by) = 'array'
        and jsonb_array_length(variant_by) between 1 and 5));

-- An item may apply to a family (`group:` keys, FR-142): its scope names the family by its whole key,
-- since only a metric's id is the key without its prefix. Both views kept every metric key's last
-- part, which cut a family's key in the middle.
CREATE OR REPLACE VIEW public.v_item_doc AS
 SELECT l.id,
    l.status,
    l.area_id,
    l.kind,
    l.updated_at,
    l.title,
    (jsonb_strip_nulls(jsonb_build_object('body', l.body, 'summaryMarkup', l.summary_markup, 'bodyMarkup', l.body_markup)) || jsonb_build_object('id', l.id, 'kind', l.kind, 'areaId', l.area_id, 'status', l.status, 'version', l.version_no, 'title', l.title, 'summary', l.summary, 'references', COALESCE(( SELECT jsonb_agg(r.definition_ref ORDER BY r.definition_ref) AS jsonb_agg
           FROM public.item_version_refs r
          WHERE (r.version_id = l.version_id)), '[]'::jsonb), 'scope', jsonb_build_object('metrics', COALESCE(( SELECT jsonb_agg(CASE WHEN (m.metric_key ~~ 'metric:%'::text) THEN substr(m.metric_key, 8) ELSE m.metric_key END ORDER BY m.metric_key) AS jsonb_agg
           FROM public.item_version_metrics m
          WHERE (m.version_id = l.version_id)), '[]'::jsonb), 'dimensions', COALESCE(( SELECT jsonb_agg(substr(d.dimension_key, 5) ORDER BY d.dimension_key) AS jsonb_agg
           FROM public.item_version_dimensions d
          WHERE (d.version_id = l.version_id)), '[]'::jsonb), 'dimensionValues', COALESCE(( SELECT jsonb_agg(jsonb_build_object('dimension', substr(d.dimension_key, 5), 'value', split_part(d.value_key, '/'::text, 2)) ORDER BY d.value_key) AS jsonb_agg
           FROM public.item_version_dimension_values d
          WHERE (d.version_id = l.version_id)), '[]'::jsonb)), 'validity', jsonb_build_object('start', l.valid_from, 'end', l.valid_until), 'reviewDate', l.review_date, 'reviewQuestion',
        CASE
            WHEN (((l.kind)::text = 'issue'::text) AND (l.valid_until IS NULL)) THEN 'still_going_on'::text
            ELSE 'still_correct'::text
        END, 'evidence', COALESCE(( SELECT jsonb_agg(jsonb_build_object('url', ev.url, 'quote', ev.quote, 'date', ev.read_on) ORDER BY ev."position") AS jsonb_agg
           FROM public.item_version_evidence ev
          WHERE (ev.version_id = l.version_id)), '[]'::jsonb), 'claimLevel', l.claim, 'riskLevel', l.risk, 'notToConclude', l.not_to_conclude, 'checkFlag', f.flag, 'audience',
        CASE
            WHEN (l.audience_groups IS NULL) THEN jsonb_build_object('kind', 'everyone')
            ELSE jsonb_build_object('kind', 'groups', 'groups', to_jsonb(l.audience_groups))
        END, 'changeMarks', COALESCE(( SELECT jsonb_object_agg(r.definition_ref, r.change_mark) AS jsonb_object_agg
           FROM public.item_version_refs r
          WHERE (r.version_id = l.version_id)), '{}'::jsonb), 'ownerId', l.owner_id, 'proposerId', l.proposer_id, 'createdVia', l.created_via, 'createdAt', to_char((l.created_at AT TIME ZONE 'UTC'::text), 'YYYY-MM-DD"T"HH24:MI:SS"Z"'::text), 'updatedAt', to_char((l.updated_at AT TIME ZONE 'UTC'::text), 'YYYY-MM-DD"T"HH24:MI:SS"Z"'::text))) AS doc,
    l.version_id,
    l.summary,
    l.valid_from,
    l.audience_groups
   FROM (public.v_item_current_all l
     LEFT JOIN ( SELECT DISTINCT ON (o.item_id) o.item_id,
            o.flag
           FROM public.v_overlay_on o
          WHERE ((o.kind = 'flag_on'::text) AND (o.item_id IS NOT NULL))
          ORDER BY o.item_id, (o.flag = 'source_missing'::public.source_flag) DESC) f ON ((f.item_id = l.id)));

CREATE OR REPLACE VIEW public.v_item_index AS
 SELECT l.id,
    l.audience_groups,
    jsonb_build_object('id', l.id, 'kind', l.kind, 'areaId', l.area_id, 'status', l.status, 'version', l.version_no, 'title', l.title, 'summary', l.summary, 'scope', jsonb_build_object('metrics', COALESCE(( SELECT jsonb_agg(CASE WHEN (m.metric_key ~~ 'metric:%'::text) THEN substr(m.metric_key, 8) ELSE m.metric_key END ORDER BY m.metric_key) AS jsonb_agg
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
