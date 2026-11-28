-- A source with no link (the cold first use scout, call 1). What lives in someone's head or in a
-- chat thread has no address to open: its source is then one line that says who or what says so
-- (FR-116). Such a source has no url, and its quote is that line. A link stays an http or https
-- address, as before.
ALTER TABLE public.item_version_evidence ALTER COLUMN url DROP NOT NULL;
ALTER TABLE public.item_version_evidence DROP CONSTRAINT item_version_evidence_url_check;
ALTER TABLE public.item_version_evidence
  ADD CONSTRAINT item_version_evidence_url_check
  CHECK (url IS NULL OR ((url ~ '^https?://'::text) AND (char_length(url) <= 2000)));
