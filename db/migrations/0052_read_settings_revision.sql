-- 0052_read_settings_revision: a read keeps the settings revision of its source it ran under.
--
-- A cursor is good only for the settings it was left under. A read used to compare its time with
-- the source's last change, which held only while the read kept the source's row locked, so Pause,
-- Save and Disconnect waited for a read in flight. A read now holds no row while it is out, keeps
-- the revision it started under, and rests on an earlier read only under the revision the source
-- has now (`readKindOf` in src/server/modules/connectors/read-kind.ts).
--
-- A read already kept gets the revision it was read under when it came after the source's last
-- change; an older one gets none, and hands on nothing. So does a definitions read in part, whose
-- cursor the core never handed on: a read in part now leaves no cursor.

alter table public.connector_snapshots add column settings_revision integer;

update public.connector_snapshots s set settings_revision = c.revision
  from public.connectors c
 where c.id = s.connector_id
   and (c.changed_at is null or s.fetched_at > c.changed_at)
   and not (c.kind = 'definition_source' and s.status = 'partial');
