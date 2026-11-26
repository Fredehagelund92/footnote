-- Published without review (FR-421, FR-326): a version an owner's permission published was read by
-- nobody before agents got it, so what agents read says so and never calls it checked. The served
-- review carries whether its accept decision was made under a permission (auto_policy_id). A
-- function's result columns cannot change in place, so both are made again; grants.sql grants
-- them again after migrations.
DROP FUNCTION public.serving_reviews(bigint);
DROP FUNCTION public.cl_version_review(uuid);

CREATE FUNCTION public.cl_version_review(p_version uuid) RETURNS TABLE(accepted_on date, accepted_as public.decision_capacity, accepted_area text, accepted_by uuid, first_edition text, without_review boolean)
    LANGUAGE sql STABLE
    SET search_path TO 'public', 'pg_temp'
    AS $$
  select (d.decided_at at time zone 'UTC')::date, d.capacity, d.area_id, d.decided_by, f.label,
         d.auto_policy_id is not null
    from (select 1) one
    left join lateral (select x.decided_at, x.capacity, x.area_id, x.decided_by, x.auto_policy_id from decisions x
       where x.item_version_id = p_version and x.outcome = 'accept'
       order by x.decided_at desc, x.id desc limit 1) d on true
    left join lateral (select e.label from item_version_service o join editions e on e.seq = lower(o.editions)
       where o.version_id = p_version order by lower(o.editions) limit 1) f on true $$;

CREATE FUNCTION public.serving_reviews(p_seq bigint) RETURNS TABLE(item_id text, accepted_on date, accepted_as public.decision_capacity, accepted_area text, first_edition text, without_review boolean)
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
  select s.item_id, r.accepted_on, r.accepted_as, r.accepted_area, r.first_edition, r.without_review
    from item_version_service s cross join lateral cl_version_review(s.version_id) r
   where s.editions @> p_seq $$;
