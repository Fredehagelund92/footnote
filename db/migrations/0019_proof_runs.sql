-- The proof (`footnote prove`): the same questions asked three ways, with no context, with one
-- plain file and with Footnote, recorded as one run of its own kind. Only its command works it,
-- as a held-out run, and the run keeps counts and digests, never a question's words.
ALTER TYPE public.eval_kind ADD VALUE 'proof';
