-- An agent may write many drafts from one document for the person to review and publish together
-- (FR-121): one person's agents may save 50 new drafts in 24 hours and keep 50 waiting unsent, the
-- most one Publish takes, up from 10 and 20. A value an admin set stays as they set it.
insert into public.settings_versions (key, version, value, reason)
select key, version + 1, '{"open": 50, "per_day": 50}', 'default: 50, the most one Publish takes (FR-121)'
  from public.settings_current
 where key = 'limits.agent_drafts' and value = '{"open": 20, "per_day": 10}'::jsonb;
