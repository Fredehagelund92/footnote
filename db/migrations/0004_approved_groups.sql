-- The groups a definitions source reads are the organisation's approved set, for the sources the
-- server's configuration selects too. A group taken out of the set keeps the domain it was mapped
-- to, so choosing it again restores the mapping: `kept_domains` holds those groups, each as a
-- chosen scope ({"id","title","domain"}), and never one the set reads.
alter table public.connectors
  add column kept_domains jsonb not null default '[]'::jsonb,
  add constraint connectors_kept_domains_check check (
    jsonb_typeof(kept_domains) = 'array' and jsonb_array_length(kept_domains) <= 2000);

-- A ninth alert rule (FR-621): a read finds a group that the approved set leaves out and that is
-- new since the set was chosen, and a card goes to the admins.
alter table public.alert_rules drop constraint alert_rules_rule_check;
alter table public.alert_rules add constraint alert_rules_rule_check check (rule = any (array[
  'gap'::text, 'saved'::text, 'disagree'::text, 'share'::text, 'fail'::text, 'spend'::text,
  'sync'::text, 'views'::text, 'due'::text]));
alter table public.obs_caught_weekly drop constraint obs_caught_weekly_kind_check;
alter table public.obs_caught_weekly add constraint obs_caught_weekly_kind_check check (
  (line = 'saved'::text and kind = any (array['publish'::text, 'archive'::text, 'restore'::text,
    'sync'::text, 'check_date'::text]))
  or (line = 'alert'::text and kind = any (array['gap'::text, 'saved'::text, 'disagree'::text,
    'share'::text, 'fail'::text, 'spend'::text, 'sync'::text, 'views'::text, 'due'::text])));
insert into public.alert_rules (rule, enabled, threshold, audience) values
  ('views', true, null, 'admins');
