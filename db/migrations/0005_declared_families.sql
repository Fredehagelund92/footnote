-- A family a definition source declares a metric is a variant of (FR-142, D9): the family's name as
-- the source writes it (`meta.footnote.family`), and what tells this variant apart
-- (`meta.footnote.by`, [{"name","ref","value"}]). Read only and replaced at each read; both null when
-- the source declares none, or the declaration was left out as one Footnote cannot keep.
alter table public.definitions
  add column family_name text,
  add column family_by jsonb,
  add constraint definitions_family_check check (
    (family_name is null and family_by is null)
    or (char_length(family_name) between 1 and 200
        and jsonb_typeof(family_by) = 'array'
        and jsonb_array_length(family_by) between 1 and 5));
