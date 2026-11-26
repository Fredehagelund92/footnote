-- Why an edition was made: Footnote told apart live families of one name (0024). The value is
-- used by the next migration, so it is added in a transaction of its own.
ALTER TYPE public.edition_reason ADD VALUE 'names_told_apart';
