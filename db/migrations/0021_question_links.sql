-- A question an owner passes on as a link: Ask someone who knows, on a Nothing written yet card
-- (its gap's topic) or a Due for a check card (its item). Footnote sends nothing: the owner copies
-- the link and pastes it where the company talks. Its id is its address, so only who was given the
-- link opens it, signed in. A link keeps the day it was last copied, never who copied or opened it.
ALTER TYPE public.creation_channel ADD VALUE 'question';

CREATE TABLE public.question_links (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    gap_id uuid REFERENCES public.gaps(id),
    item_id text REFERENCES public.items(id),
    -- The domain whose owners pass it on and get the answers.
    area_id text NOT NULL REFERENCES public.areas(id),
    copied_on date DEFAULT ((now() AT TIME ZONE 'UTC'::text))::date NOT NULL,
    CONSTRAINT question_links_pkey PRIMARY KEY (id),
    CONSTRAINT question_links_id_check CHECK ((uuid_extract_version(id) = 4)),
    CONSTRAINT question_links_one_card CHECK (((gap_id IS NULL) <> (item_id IS NULL)))
);
-- One link a card: copied again, it is the same link, copied on a new day.
CREATE UNIQUE INDEX question_links_gap ON public.question_links (gap_id) WHERE (gap_id IS NOT NULL);
CREATE UNIQUE INDEX question_links_item ON public.question_links (item_id) WHERE (item_id IS NOT NULL);
ALTER TABLE public.question_links ENABLE ROW LEVEL SECURITY;
-- Anyone signed in opens a link they were given; only an owner of its domain or an admin makes one.
CREATE POLICY question_links_read ON public.question_links FOR SELECT USING ((public.cl_person() IS NOT NULL));
CREATE POLICY question_links_insert ON public.question_links FOR INSERT
    WITH CHECK ((public.cl_is_admin_now() OR public.cl_is_owner_now(area_id)));
CREATE POLICY question_links_copy ON public.question_links FOR UPDATE
    USING ((public.cl_is_admin_now() OR public.cl_is_owner_now(area_id)))
    WITH CHECK ((public.cl_is_admin_now() OR public.cl_is_owner_now(area_id)));

-- What a person answered on a Due for a check card's link, under their name: still true, it ended
-- on a day, or they don't know, with their words and a link if they gave them. The owner reads it
-- on the card and still does the check. Agents never read any of it: nothing here is granted to
-- the serving or the analytics role. An answer about a Nothing written yet card is a suggestion
-- instead, sent with the channel `question`.
CREATE TABLE public.question_answers (
    id uuid DEFAULT uuidv7() NOT NULL,
    link_id uuid NOT NULL REFERENCES public.question_links(id),
    person_id uuid DEFAULT public.cl_person() NOT NULL REFERENCES public.people(id),
    area_id text NOT NULL,
    answer text NOT NULL,
    ended_on date,
    words text,
    link text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT question_answers_pkey PRIMARY KEY (id),
    CONSTRAINT question_answers_answer_check CHECK ((answer = ANY (ARRAY['still_true'::text, 'ended'::text, 'unknown'::text]))),
    CONSTRAINT question_answers_ended_check CHECK (((answer = 'ended'::text) = (ended_on IS NOT NULL))),
    CONSTRAINT question_answers_words_check CHECK (((words IS NULL) OR ((char_length(btrim(words)) >= 1) AND (char_length(words) <= 2000)))),
    CONSTRAINT question_answers_link_check CHECK (((link IS NULL) OR ((link ~ '^https?://'::text) AND (char_length(link) <= 2000))))
);
CREATE INDEX question_answers_link ON public.question_answers (link_id, created_at);
CREATE INDEX question_answers_person ON public.question_answers (person_id, created_at);
CREATE TRIGGER ao_row_question_answers BEFORE DELETE OR UPDATE ON public.question_answers FOR EACH ROW EXECUTE FUNCTION public.cl_forbid_mutation();
CREATE TRIGGER ao_trunc_question_answers BEFORE TRUNCATE ON public.question_answers FOR EACH STATEMENT EXECUTE FUNCTION public.cl_forbid_mutation();
ALTER TABLE public.question_answers ENABLE ROW LEVEL SECURITY;
-- A person answers as themselves, on a link to an item; the domain is the link's.
CREATE POLICY question_answers_insert ON public.question_answers FOR INSERT
    WITH CHECK (((person_id = public.cl_person()) AND EXISTS (SELECT 1 FROM public.question_links l
        WHERE ((l.id = question_answers.link_id) AND (l.item_id IS NOT NULL) AND (l.area_id = question_answers.area_id)))));
-- Its sender reads it, and so do the owners of its domain and the admins.
CREATE POLICY question_answers_read ON public.question_answers FOR SELECT
    USING (((person_id = public.cl_person()) OR public.cl_is_admin_now() OR public.cl_is_owner_now(area_id)));
