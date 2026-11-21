-- What a metric is built from, as its source names it (CON-207): the definitions it takes as
-- inputs, by ref, and the columns of its view its own calculation reads, by name. Names only, never
-- the calculation: a column is one identifier, so no part of an expression fits. Read only and
-- replaced at each read; both null when the source does not say. The refs index finds what a
-- definition is used by.
alter table public.definitions
  add column built_from_refs text[],
  add column built_from_columns text[],
  add constraint definitions_built_from_check check (
    (built_from_refs is null) = (built_from_columns is null)
    and coalesce(cardinality(built_from_refs), 0) <= 50
    and coalesce(cardinality(built_from_columns), 0) <= 50
    and coalesce(array_to_string(built_from_refs, ' '), '')
        ~ '^([a-z][a-z0-9_]*:[A-Za-z0-9_.:/-]+( |$))*$'
    and coalesce(array_to_string(built_from_columns, ' '), '')
        ~ '^([A-Za-z_][A-Za-z0-9_]{0,99}( |$))*$');

create index definitions_built_from_refs on public.definitions using gin (built_from_refs);
