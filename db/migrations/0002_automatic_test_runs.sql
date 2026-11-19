-- Test runs on a real model start only when an administrator starts them (decision 6): the weekly
-- run, the runs a change outside the review gate queues, and the resumes of a run the service
-- started all wait until an administrator turns this on, having seen what a run is estimated to
-- cost.
insert into public.settings_versions (key, version, value, reason) values
  ('evals.automatic_runs', 1, 'false', 'default: off until an administrator turns it on, after seeing the estimated cost (decision 6)');
