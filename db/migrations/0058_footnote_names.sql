-- 0058_footnote_names: what the database keeps under the product's former name, Heed, says Footnote
-- (docs/rename-checklist.md, step 10).
--
-- Four functions take an advisory lock whose key names the product: auth.bootstrap_person takes
-- `heed.dev_people`, and auth.accept_invite, auth.join_by_group and auth.sync_group_admin take
-- `heed.roles`, the lock the service takes around the same changes. Each is defined again from its
-- own definition with only the key changed, so nothing else about it moves, and `create or
-- replace` keeps its owner and grants. The service takes the new keys from this release on.
--
-- The built-in test runs' agent family was `heed` and is `footnote`: the rows already counted move,
-- and both checks take the new value in place of the old.

do $$
declare
  f regprocedure;
  definition text;
begin
  foreach f in array array[
    'auth.bootstrap_person(text, text, public.global_role[])',
    'auth.accept_invite(text, text)',
    'auth.join_by_group(text, text)',
    'auth.sync_group_admin(uuid, boolean)'
  ]::regprocedure[] loop
    definition := pg_get_functiondef(f);
    if position('''heed.' in definition) = 0 then
      raise exception '% takes no lock named after Heed', f;
    end if;
    execute replace(replace(definition, '''heed.roles''', '''footnote.roles'''),
                    '''heed.dev_people''', '''footnote.dev_people''');
  end loop;
end $$;

alter table public.mcp_requests drop constraint mcp_requests_app_family_check;
update public.mcp_requests set app_family = 'footnote' where app_family = 'heed';
alter table public.mcp_requests add constraint mcp_requests_app_family_check
  check (app_family in ('claude_code', 'claude_ai', 'chatgpt', 'codex', 'cursor', 'vscode_copilot',
                        'windsurf', 'gemini_cli', 'goose', 'footnote', 'other', 'unknown'));

alter table public.deliveries drop constraint deliveries_app_family_check;
update public.deliveries set app_family = 'footnote' where app_family = 'heed';
alter table public.deliveries add constraint deliveries_app_family_check
  check (app_family in ('claude_code', 'claude_ai', 'chatgpt', 'codex', 'cursor', 'vscode_copilot',
                        'windsurf', 'gemini_cli', 'goose', 'footnote', 'other', 'unknown'));
