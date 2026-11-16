-- 0056_workspace_calendar: the workspace's calendar, which Ask and agents read dates on.
--
-- `calendar.fiscal_year_start` is when the fiscal year starts, a month and a day; a fiscal year is
-- named by the calendar year it ends in, so with 1 April FY26 is 1 Apr 2025 to 31 Mar 2026. Null
-- until an admin sets it: until then Ask reads a fiscal year as the calendar year and says so, and
-- get_context asks for the days. `calendar.time_zone` is the time zone today is counted in, UTC
-- until an admin sets another; days stay calendar days. The service reads the same defaults when a
-- key is missing, so these two versions are all this migration adds.

insert into public.settings_versions (key, version, value, reason) values
  ('calendar.fiscal_year_start', 1, 'null', 'default: fiscal years read as calendar years'),
  ('calendar.time_zone', 1, '"UTC"', 'default (NFR-048)');
