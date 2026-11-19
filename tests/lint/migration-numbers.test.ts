import { spawnSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, describe, expect, it } from 'vitest'
import { migrationNumberProblems } from '../../scripts/check-migration-numbers.ts'

/*
  CI's early check of migration numbers (scripts/check-migration-numbers.ts) fails a pull request
  that took a number its base branch already has, before any database starts. Each rule is shown
  failing on its own, then the script is run on a real git history.
*/

const renumber = 'Rebase onto the base branch and run `npm run db:renumber`'
const base = ['0001_baseline.sql', '0002_people.sql']
const preSquash = [
  '0001_baseline.sql',
  '0002_edition_digest_byte_order.sql',
  '0003_agent_wording.sql',
  '0004_agent_contract.sql',
  '0005_review_path.sql',
  '0006_inbox_and_undo.sql',
  '0007_comments.sql',
  '0008_context_items.sql',
  '0009_terms.sql',
  '0010_about_starts_empty.sql',
  '0011_serving_terms.sql',
  '0012_people_and_invites.sql',
  '0013_named_reports.sql',
  '0014_oidc_sign_in.sql',
  '0015_observability.sql',
  '0016_source_channel.sql',
  '0017_content_sources.sql',
  '0018_settings_agents.sql',
  '0019_saved_questions.sql',
  '0020_cube_interface_3.sql',
  '0021_content_full_reads.sql',
  '0022_alerts.sql',
  '0023_term_mentions.sql',
  '0024_source_activity.sql',
  '0025_figures.sql',
  '0026_access_keys.sql',
  '0027_source_disconnect.sql',
  '0028_withdrawn_in_comments.sql',
  '0029_obs_weekly.sql',
  '0030_records_asked.sql',
  '0031_obs_snapshots.sql',
  '0032_anchored_comments.sql',
  '0033_obs_caught.sql',
  '0034_agent_names.sql',
  '0035_conflict_decisions.sql',
  '0036_agent_policies.sql',
  '0037_records_asked_catalogue.sql',
  '0038_records_asked_conflicts.sql',
  '0039_word_comparison.sql',
  '0040_dbt_file_location.sql',
  '0041_records_asked_analysis.sql',
  '0042_names_left_out.sql',
  '0043_ask_loop_limits.sql',
  '0044_topic_value_index.sql',
  '0045_observability_pins.sql',
  '0046_saved_view_keys.sql',
  '0047_source_view_lists.sql',
  '0048_source_read_state.sql',
  '0049_agent_connection_state.sql',
  '0050_eval_run_transitions.sql',
  '0051_gap_states.sql',
  '0052_read_settings_revision.sql',
  '0053_invite_standing.sql',
  '0054_inbox_end_and_dead_states.sql',
  '0055_undo_until.sql',
  '0056_item_index_version.sql',
  '0057_workspace_calendar.sql',
  '0058_footnote_names.sql',
]

describe('the migration numbers of a change', () => {
  it('pass the next number, and no new migration at all', () => {
    expect(migrationNumberProblems(base, [...base, '0003_mine.sql'])).toEqual([])
    expect(migrationNumberProblems(base, base)).toEqual([])
  })

  it('fail a new migration that takes a number the base branch already has', () => {
    const problems = migrationNumberProblems(base, [...base, '0002_mine.sql'])
    expect(problems).toEqual([
      expect.stringMatching(
        /^db\/migrations\/0002_mine\.sql takes number 0002, which the base branch already gives 0002_people\.sql\. /,
      ),
    ])
    expect(problems[0]).toContain(renumber)
  })

  it('fail two new migrations that share a number', () => {
    expect(migrationNumberProblems(base, [...base, '0003_a.sql', '0003_b.sql'])).toEqual([
      expect.stringMatching(/^0003_a\.sql and 0003_b\.sql share number 0003\. Rebase/),
    ])
  })

  it('fail renaming or deleting a migration the base branch has', () => {
    expect(migrationNumberProblems(base, ['0001_baseline.sql', '0002_persons.sql'])).toEqual([
      expect.stringMatching(/^db\/migrations\/0002_people\.sql is on the base branch but not/),
    ])
  })

  it('fail a db/migrations/latest.txt that does not name the last file', () => {
    const head = [...base, '0003_mine.sql']
    expect(migrationNumberProblems(base, head, '0003_mine.sql\n')).toEqual([])
    expect(migrationNumberProblems(base, head, '0002_people.sql\n')).toEqual([
      'db/migrations/latest.txt names 0002_people.sql, but the last migration is 0003_mine.sql. Run `npm run db:renumber`, which writes it.',
    ])
  })

  it('fail a gap or a badly named file', () => {
    expect(migrationNumberProblems(base, [...base, '0004_mine.sql'])).toEqual([
      expect.stringMatching(/^Migration file 0004_mine\.sql must be numbered 0003/),
    ])
    expect(migrationNumberProblems(base, [...base, '0003-mine.sql'])).toEqual([
      expect.stringMatching(/^Migration file 0003-mine\.sql must be named NNNN_snake_case\.sql/),
    ])
  })

  it('pass the one squash of the exact old list into 0001_schema.sql', () => {
    expect(migrationNumberProblems(preSquash, ['0001_schema.sql'], '0001_schema.sql\n')).toEqual([])
  })

  it('refuse a second squash, once the base holds the baseline', () => {
    for (const held of [['0001_schema.sql'], ['0001_schema.sql', '0002_x.sql']]) {
      const problems = migrationNumberProblems(held, ['0001_other.sql'])
      expect(problems).toContainEqual(
        expect.stringMatching(/^db\/migrations\/0001_schema\.sql is on the base branch but not/),
      )
    }
  })

  it('refuse a squash of a base that is not the exact old list', () => {
    expect(migrationNumberProblems(base, ['0001_schema.sql'])).toEqual([
      expect.stringMatching(/^db\/migrations\/0001_baseline\.sql is on the base branch but not/),
      expect.stringMatching(/^db\/migrations\/0002_people\.sql is on the base branch but not/),
    ])
    expect(migrationNumberProblems(preSquash.slice(0, -1), ['0001_schema.sql'])).not.toEqual([])
  })
})

describe('the check on a real git history', () => {
  const root = mkdtempSync(join(tmpdir(), 'footnote-migration-numbers-'))
  const script = fileURLToPath(new URL('../../scripts/check-migration-numbers.ts', import.meta.url))
  afterAll(() => rmSync(root, { recursive: true, force: true }))
  const git = (...args: string[]) => {
    const run = spawnSync('git', ['-C', root, ...args], { encoding: 'utf8' })
    expect(run.status, run.stderr).toBe(0)
    return run.stdout.trim()
  }
  const add = (name: string) => {
    mkdirSync(join(root, 'db/migrations'), { recursive: true })
    writeFileSync(join(root, 'db/migrations', name), `-- ${name}\n`)
  }
  const identity = ['-c', 'user.name=Test', '-c', 'user.email=test@example.com']
  const commit = (message: string) => {
    git('add', '-A')
    git(...identity, 'commit', '-qm', message)
    return git('rev-parse', 'HEAD')
  }
  const check = (from: string, to: string) =>
    spawnSync(process.execPath, [script, from, to], { cwd: root, encoding: 'utf8' })

  it('passes a clean number and fails one the base branch took first', () => {
    git('init', '-q', '-b', 'main')
    add('0001_baseline.sql')
    add('0002_people.sql')
    const main = commit('main')
    git('checkout', '-q', '-b', 'mine')
    add('0003_mine.sql')
    const clean = check(main, commit('mine'))
    expect(clean.status, clean.stderr).toBe(0)
    expect(clean.stdout).toMatch(/^Migration numbers: every file has its own number/)

    // Another pull request took 0003 first. The commit CI tests merges this branch into main, as
    // GitHub does for a pull request or a merge queue entry; its first parent is main.
    git('checkout', '-q', 'main')
    add('0003_theirs.sql')
    const theirs = commit('theirs')
    git(...identity, 'merge', '-q', '--no-ff', '-m', 'merge', 'mine')
    const clash = check(theirs, 'HEAD')
    expect(clash.status).toBe(1)
    expect(clash.stderr).toMatch(
      /do not fit:\n- db\/migrations\/0003_mine\.sql takes number 0003, which the base branch already gives 0003_theirs\.sql\. Rebase onto the base branch and run `npm run db:renumber`/,
    )
  })

  it('fails a latest.txt that names a file before the last', () => {
    const before = git('rev-parse', 'HEAD')
    writeFileSync(join(root, 'db/migrations/latest.txt'), '0002_people.sql\n')
    const stale = check(before, commit('stale latest.txt'))
    expect(stale.status).toBe(1)
    expect(stale.stderr).toMatch(/latest\.txt names 0002_people\.sql, but the last migration is/)
  })
})
