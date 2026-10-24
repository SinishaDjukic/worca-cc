// test/automations-workspace-prs.test.mjs — the end of a workspace automation's fix (automationDraftPr in ui/server.mjs)
// against a fake GitHub: one draft PR per member the run changed (an untouched member gets none), each pushed and
// opened in its own repository on its own base, `Closes #N` only in the issue's own repository's PR, Watch PR on
// each, and the PRs cross-linked. Every git and gh call is answered by the stub, so nothing leaves the machine.
import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { _testing as server } from '../ui/server.mjs';
import { _testing as gitInfo } from '../src/core/git-info.mjs';
import { _resetForTests, getDb } from '../src/core/db.mjs';
import { readMemberPrStates } from '../src/core/artifacts.mjs';
import { seedWorkspacePipeline } from './helpers/db-seed.mjs';

const WK = 'wks-shop-00000001';
let home, prevHome, runId, dirs;

before(async () => {
  home = await mkdtemp(join(tmpdir(), 'worca-cc-autwspr-'));
  prevHome = process.env.WORCA_HOME; process.env.WORCA_HOME = home;
  _resetForTests();
  dirs = {};
  for (const n of ['api', 'web', 'docs']) dirs[n] = await mkdtemp(join(tmpdir(), `worca-cc-autwspr-${n}-`));
  const members = [
    { projectKey: 'api-00000001', projectDir: dirs.api, projectName: 'api' },
    { projectKey: 'docs-00000003', projectDir: dirs.docs, projectName: 'docs' },
    { projectKey: 'web-00000002', projectDir: dirs.web, projectName: 'web' },
  ];
  const branches = {
    'api-00000001': { source: 'main', feature: 'worca-cc/fix-7-api', branchKept: true },
    'docs-00000003': { source: 'main', feature: 'worca-cc/fix-7-docs', branchKept: true },
    'web-00000002': { source: 'dev', feature: 'worca-cc/fix-7-web', branchKept: true },
  };
  ({ id: runId } = await seedWorkspacePipeline(dirs.api, WK, {
    title: 'Fix #7: Checkout crashes', status: 'done', workspaceName: 'Shop',
    projects: members, projectKeys: members.map((m) => m.projectKey), branches, branch: { ...branches['api-00000001'] },
  }, members));
  // The run came from issue #7 in o/web (an automation's source, sources.mjs).
  getDb().prepare("UPDATE pipelines SET source_type = 'github', source_ref = ? WHERE id = ?").run(JSON.stringify({
    forge: 'github', kind: 'issue', repo: 'o/web', number: 7, taskId: 'o/web#7', url: 'https://github.com/o/web/issues/7', title: 'Checkout crashes',
  }), runId);
});
after(async () => {
  gitInfo.reset(); _resetForTests();
  if (prevHome === undefined) delete process.env.WORCA_HOME; else process.env.WORCA_HOME = prevHome;
  await rm(home, { recursive: true, force: true });
  for (const d of Object.values(dirs)) await rm(d, { recursive: true, force: true });
});
beforeEach(() => gitInfo.reset());

/** A fake git and gh. Each repository's name comes from its directory; `ahead` is how many commits the run made
 *  there (docs: none, the planner left it alone). Every call lands in `seen` with its directory. */
function stub(seen, { failPushIn = null, ahead = { api: 2, web: 1, docs: 0 } } = {}) {
  const nameOf = (cwd) => Object.keys(dirs).find((k) => dirs[k] === cwd) || 'api';
  const bodies = {};
  gitInfo.setRunner((cmd, args, opts = {}) => {
    const repo = nameOf(opts.cwd);
    seen.push({ argv: [cmd, ...args], repo });
    const ok = (stdout = '') => Promise.resolve({ ok: true, stdout, stderr: '', code: 0 });
    if (cmd === 'gh' && args[0] === '--version') return ok('gh 2');
    if (cmd === 'git' && args[0] === 'remote') return ok(`origin\thttps://github.com/o/${repo}.git (fetch)\norigin\thttps://github.com/o/${repo}.git (push)\n`);
    if (cmd === 'git' && args[0] === 'for-each-ref') return ok('refs/remotes/origin/main\nrefs/remotes/origin/dev\n');
    if (cmd === 'git' && args[0] === 'rev-parse' && args.includes('--verify')) return ok('abc123\n');
    if (cmd === 'git' && args[0] === 'rev-list' && args[1] === '--count') return ok(`${ahead[repo]}\n`);
    if (cmd === 'git' && args[0] === 'push') return opts.cwd === failPushIn ? Promise.resolve({ ok: false, stdout: '', stderr: 'denied', code: 1 }) : ok();
    if (cmd === 'gh' && args[0] === 'pr' && args[1] === 'create') {
      const url = `https://github.com/o/${repo}/pull/${repo === 'web' ? 12 : 11}`;
      const i = args.indexOf('--body');
      bodies[url] = i >= 0 ? args[i + 1] : '';
      return ok(`${url}\n`);
    }
    if (cmd === 'gh' && args[0] === 'pr' && args[1] === 'view' && args.includes('body')) return ok(`${bodies[args[2]] ?? ''}\n`);
    if (cmd === 'gh' && args[0] === 'pr' && args[1] === 'edit') { bodies[args[2]] = args[args.indexOf('--body') + 1]; return ok(); }
    return ok();
  });
  return bodies;
}

test('one draft PR per changed member, only the issue\'s repository closes it, each watched, all cross-linked', async () => {
  const seen = [];
  const bodies = stub(seen);
  const out = await server.automationDraftPr(runId);
  assert.equal(out.ok, true, JSON.stringify(out));
  assert.deepEqual(out.prs.map((p) => [p.name, p.url, p.closes]), [
    ['api', 'https://github.com/o/api/pull/11', false],
    ['web', 'https://github.com/o/web/pull/12', true],
  ]);
  assert.equal(out.url, 'https://github.com/o/web/pull/12', 'the issue\'s own repository\'s PR');
  // The untouched member: never pushed, no PR.
  assert.equal(seen.filter((c) => c.repo === 'docs' && (c.argv[1] === 'push' || c.argv[2] === 'create')).length, 0);
  // Each pushed and opened in its own repository, as a draft, on its own base.
  const creates = seen.filter((c) => c.argv[0] === 'gh' && c.argv[2] === 'create');
  assert.deepEqual(creates.map((c) => c.repo), ['api', 'web']);
  for (const c of creates) assert.ok(c.argv.includes('--draft'), `${c.repo} is a draft`);
  const baseOf = (c) => c.argv[c.argv.indexOf('--base') + 1];
  assert.deepEqual(creates.map(baseOf), ['main', 'dev']);
  assert.deepEqual(seen.filter((c) => c.argv[1] === 'push').map((c) => [c.repo, c.argv.at(-1)]),
    [['api', 'worca-cc/fix-7-api'], ['web', 'worca-cc/fix-7-web']]);
  // Closes only where the issue lives.
  assert.match(bodies['https://github.com/o/web/pull/12'], /Closes #7/);
  assert.doesNotMatch(bodies['https://github.com/o/api/pull/11'], /Closes/);
  // Recorded per member, and each PR lists the other.
  const prs = readMemberPrStates(runId);
  assert.equal(prs['api-00000001'].url, 'https://github.com/o/api/pull/11');
  assert.equal(prs['web-00000002'].url, 'https://github.com/o/web/pull/12');
  assert.equal(prs['docs-00000003'], undefined);
  assert.match(bodies['https://github.com/o/api/pull/11'], /worca:related-prs[\s\S]*web: https:\/\/github\.com\/o\/web\/pull\/12/);
  assert.match(bodies['https://github.com/o/web/pull/12'], /worca:related-prs[\s\S]*api: https:\/\/github\.com\/o\/api\/pull\/11/);
  // Watch PR follows each PR, with its member.
  const watches = getDb().prepare('SELECT pr_url, member_key, enabled FROM pr_watches ORDER BY pr_url').all().map((r) => ({ ...r }));
  assert.deepEqual(watches.map((w) => [w.pr_url, w.member_key, !!w.enabled]), [
    ['https://github.com/o/api/pull/11', 'api-00000001', true],
    ['https://github.com/o/web/pull/12', 'web-00000002', true],
  ]);
});

test('a member whose push fails is reported, the others still open; nothing changed at all is a failure', async () => {
  getDb().exec('DELETE FROM pipeline_member_prs; DELETE FROM pr_watches');
  const seen = [];
  stub(seen, { failPushIn: dirs.api });
  const out = await server.automationDraftPr(runId);
  assert.equal(out.ok, true);
  assert.deepEqual(out.prs.map((p) => [p.name, p.url]), [['api', null], ['web', 'https://github.com/o/web/pull/12']]);
  assert.match(out.prs[0].error, /git push failed: denied/);
  // A run that changed no member opens nothing.
  stub([], { ahead: { api: 0, web: 0, docs: 0 } });
  const empty = await server.automationDraftPr(runId);
  assert.deepEqual(empty, { ok: false, error: 'the run changed no repository' });
});
