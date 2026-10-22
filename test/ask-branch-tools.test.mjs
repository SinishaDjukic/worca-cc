// test/ask-branch-tools.test.mjs
// #527 Phase F: list_branches (fake deps: shape, redaction, row/byte caps, workspace fan-out),
// list_projects.sync, get_run / get_run_progress baseSha + baseMoved, the real
// defaultBranchDeps bundle over git. Its read-only pins are rows of ask-tools' write-free guard.
import { test, after, before } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { useTempHome } from './helpers/temp-home.mjs';
import { createAskTools, AskToolError } from '../src/core/ask/tools.mjs';
import { ASK_LIMITS } from '../src/core/ask/limits.mjs';
import { redactAskText } from '../src/core/ask/redact.mjs';
import { checkRows } from './helpers/rows.mjs';

useTempHome(after);

// settings.json lives under HOME (settings.mjs#settingsFile): a developer's own `sync.remote`
// must never change these results, and nothing here may write their real settings.
const realHome = { HOME: process.env.HOME, USERPROFILE: process.env.USERPROFILE };
const fakeHome = mkdtempSync(join(tmpdir(), 'worca-abt-home-'));
before(() => { process.env.HOME = fakeHome; process.env.USERPROFILE = fakeHome; });
after(() => {
  for (const [k, v] of Object.entries(realHome)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  rmSync(fakeHome, { recursive: true, force: true });
});

const TOKEN = 'ghp_abcdefghijklmnopqrstuvwxyz0123456789';
const SECRET = 'ghp_abcdef';   // any readable part of the token body means it leaked
const baseDeps = (extra = {}) => ({
  limits: ASK_LIMITS,
  redact: redactAskText,
  buildCatalog: async () => ({ projects: [{ key: 'web-00000001', name: 'Web', path: '/p/web' }, { key: 'api-00000002', name: 'Api', path: '/p/api' }], workspaces: [] }),
  ...extra,
});
const row = (name, o = {}) => ({ name, hasLocal: true, hasRemote: true, sha: 'a'.repeat(40), ahead: 0, behind: 0,
  at: '2026-09-30T10:00:00Z', author: 'Ann', subject: `subject of ${name}`, ...o });
const listResult = (projectKey, branches, o = {}) => ({ ok: true, projectKey, remote: 'origin', current: 'main',
  fetchedAt: '2026-09-30T10:00:00.000Z', stale: false, total: branches.length, truncated: false, branches, ...o });

// ── list_branches: fake deps ────────────────────────────────────────────────
test('list_branches pass-through: local/remote/ahead-behind rows, stale + fetchError, truncated; opts reach the dep', async () => {
  await checkRows([
    { name: 'list_branches: local-only, remote-only and ahead/behind rows pass through; opts reach the dep', run: async () => {
      const seen = [];
      const tools = createAskTools(baseDeps({ branches: { async list(key, opts) {
        seen.push({ key, opts });
        return listResult(key, [
          row('local-only', { hasRemote: false }),
          row('remote-only', { hasLocal: false }),
          row('both', { remoteSha: 'b'.repeat(40), ahead: 2, behind: 3 }),
        ]);
      } } }));
      const out = await tools.call('list_branches', { projectKey: 'web-00000001', pattern: ' feat ', limit: 5 });
      assert.deepEqual(seen, [{ key: 'web-00000001', opts: { fresh: true, pattern: 'feat', limit: 5 } }]);
      assert.equal(out.projectKey, 'web-00000001');
      assert.equal(out.remote, 'origin');
      assert.equal(out.current, 'main');
      assert.equal(out.stale, false);
      assert.equal('fetchError' in out, false);
      assert.deepEqual(out.branches.map((b) => [b.name, b.hasLocal, b.hasRemote, b.ahead, b.behind]),
        [['local-only', true, false, 0, 0], ['remote-only', false, true, 0, 0], ['both', true, true, 2, 3]]);
      assert.equal(out.branches[2].remoteSha, 'b'.repeat(40));
      assert.equal('remoteSha' in out.branches[0], false);
      await tools.call('list_branches', { projectKey: 'web-00000001', fresh: false });
      assert.deepEqual(seen[1].opts, { fresh: false, pattern: null, limit: 100 });
    } },
    { name: 'list_branches: stale + fetchError and truncated pass through', run: async () => {
      const tools = createAskTools(baseDeps({ branches: { async list(key) {
        return listResult(key, [row('main')], { stale: true, fetchError: { kind: 'network', message: 'could not resolve host' }, total: 9, truncated: true });
      } } }));
      const out = await tools.call('list_branches', { projectKey: 'web-00000001' });
      assert.equal(out.stale, true);
      assert.deepEqual(out.fetchError, { kind: 'network', message: 'could not resolve host' });
      assert.equal(out.total, 9);
      assert.equal(out.truncated, true);
    } },
  ]);
});

test('list_branches: names and subjects are redacted BEFORE the cut (tokens straddling 255 / 200)', async () => {
  const longName = `${'n'.repeat(244)}/${TOKEN}`;       // the token straddles the 255-char name cut
  const longSubject = `${'s'.repeat(189)} ${TOKEN}`;    // …and the 200-char subject cut
  const tools = createAskTools(baseDeps({ branches: { async list(key) {
    return listResult(key, [row(TOKEN), row(longName, { subject: longSubject })]);
  } } }));
  const out = await tools.call('list_branches', { projectKey: 'web-00000001' });
  const json = JSON.stringify(out);
  assert.ok(!json.includes(SECRET), `no token part survives: ${json}`);
  assert.notEqual(out.branches[0].name, TOKEN);
  assert.ok(out.branches[1].name.length <= 255);
  assert.ok(out.branches[1].subject.length <= 200);
});

test('list_branches workspace fan-out: members[], a failed member becomes {projectKey,error}', async () => {
  await checkRows([
    { name: 'list_branches: a failed member / project becomes {projectKey, error}', run: async () => {
      const tools = createAskTools(baseDeps({ branches: { async list(key) { return { projectKey: key, ok: false, error: 'project folder is missing on disk' }; } } }));
      assert.deepEqual(await tools.call('list_branches', { projectKey: 'web-00000001' }), { projectKey: 'web-00000001', error: 'project folder is missing on disk' });
    } },
    { name: 'list_branches: workspace fan-out returns members[]', run: async () => {
      const seen = [];
      const tools = createAskTools(baseDeps({ branches: {
        async list() { throw new Error('not used'); },
        async listWorkspace(id, opts) {
          seen.push({ id, opts });
          return [listResult('web-00000001', [row('main')]), { projectKey: 'api-00000002', ok: false, error: 'project folder is missing on disk' }];
        },
      } }));
      const out = await tools.call('list_branches', { workspaceId: 'wks-team-0000abcd' });
      assert.equal(out.workspaceId, 'wks-team-0000abcd');
      assert.deepEqual(seen, [{ id: 'wks-team-0000abcd', opts: { fresh: true, pattern: null, limit: 100 } }]);
      assert.deepEqual(out.members.map((m) => m.projectKey), ['web-00000001', 'api-00000002']);
      assert.deepEqual(out.members[0].branches.map((b) => b.name), ['main']);
      assert.equal(out.members[1].error, 'project folder is missing on disk');
    } },
  ]);
});

test('list_branches caps: 40 members × 200 rows stay ≤ 200 rows and ≤ branchListMaxBytes; a single project is capped to limit', async () => {
  await checkRows([
    { name: 'list_branches: 40 members × 200 rows stay ≤ 200 rows in all and ≤ branchListMaxBytes', run: async () => {
      let asked = null;
      const tools = createAskTools(baseDeps({ branches: {
        async list() { throw new Error('not used'); },
        async listWorkspace(id, opts) {
          asked = opts.limit;
          return Array.from({ length: 40 }, (_, m) => listResult(`m${m}-00000000`,
            Array.from({ length: 200 }, (__, i) => row(`feature/${m}-${i}`, { subject: 'x'.repeat(200) })), { total: 200 }));
        },
      } }));
      const out = await tools.call('list_branches', { workspaceId: 'wks-big-0000abcd', limit: 999 });
      assert.ok(asked <= 200, `listWorkspace got limit ${asked}`);
      const rows = out.members.reduce((n, m) => n + m.branches.length, 0);
      assert.ok(rows <= 200, `${rows} rows`);
      const maxBytes = ASK_LIMITS.branchListMaxBytes || 60_000;
      assert.ok(Buffer.byteLength(JSON.stringify(out.members), 'utf8') <= maxBytes);
      assert.ok(out.members.every((m) => m.truncated === true), 'every member lost rows and says so');
    } },
    { name: 'list_branches: a single project is also capped to limit rows', run: async () => {
      const tools = createAskTools(baseDeps({ branches: { async list(key) {
        return listResult(key, Array.from({ length: 50 }, (_, i) => row(`b${i}`)));
      } } }));
      const out = await tools.call('list_branches', { projectKey: 'web-00000001', limit: 10 });
      assert.equal(out.branches.length, 10);
      assert.equal(out.truncated, true);
      assert.deepEqual(out.branches.slice(0, 2).map((b) => b.name), ['b0', 'b1'], 'the newest (first) rows are kept');
    } },
  ]);
});

test('list_branches: unavailable deps, missing scope and unknown targets are AskToolErrors', async () => {
  await assert.rejects(() => createAskTools(baseDeps()).call('list_branches', { projectKey: 'web-00000001' }), (e) => e instanceof AskToolError && /unavailable/.test(e.message));
  const noWs = createAskTools(baseDeps({ branches: { async list() { return null; } } }));
  await assert.rejects(() => noWs.call('list_branches', { workspaceId: 'wks-x-0000abcd' }), (e) => e instanceof AskToolError && /workspace branch listing is unavailable/.test(e.message));
  await assert.rejects(() => noWs.call('list_branches', {}), (e) => e instanceof AskToolError && /projectKey or workspaceId is required/.test(e.message));
  await assert.rejects(() => noWs.call('list_branches', { projectKey: 'zzz-00000000' }), /unknown project "zzz-00000000"/);
  const ws = createAskTools(baseDeps({ branches: { async list() { return null; }, async listWorkspace() { return null; } } }));
  await assert.rejects(() => ws.call('list_branches', { workspaceId: 'wks-x-0000abcd' }), /unknown workspace "wks-x-0000abcd"/);
});

// ── list_projects.sync ──────────────────────────────────────────────────────
test('list_projects gains sync per project from branches.status; a throwing status leaves the output unchanged', async () => {
  const plain = await createAskTools(baseDeps()).call('list_projects', {});
  const tools = createAskTools(baseDeps({ branches: { async status(projects) {
    assert.deepEqual(projects.map((p) => p.key), ['web-00000001', 'api-00000002']);
    return new Map([['web-00000001', { base: `dev/${TOKEN}`, ahead: 1, behind: 2, dirty: false, fetchedAt: '2026-09-30T10:00:00.000Z' }], ['api-00000002', null]]);
  } } }));
  const out = await tools.call('list_projects', {});
  assert.deepEqual(out.projects[0].sync, { base: redactAskText(`dev/${TOKEN}`), ahead: 1, behind: 2, dirty: false, fetchedAt: '2026-09-30T10:00:00.000Z' });
  assert.ok(!out.projects[0].sync.base.includes(SECRET));
  assert.equal('sync' in out.projects[1], false);
  const throwing = createAskTools(baseDeps({ branches: { async status() { throw new Error('boom'); } } }));
  assert.deepEqual(await throwing.call('list_projects', {}), plain);
});

// ── get_run / get_run_progress ──────────────────────────────────────────────
const runRow = (branch) => ({ id: 'abcd1234', project_key: 'web-00000001', title: 'T', status: 'done', branch: JSON.stringify(branch) });
const runDeps = (row, extra = {}) => baseDeps({
  lookupPipelineRow: () => row, findPipelineRowById: () => row,
  readStoreMeta: () => ({ name: 'Web', path: '/p/web' }), totalsFor: () => ({ cost: 0 }), hasDiffPatch: async () => false,
  readRunProgress: async () => ({ runId: row.id, phase: 'done', status: 'done', phases: [], tasks: [], clarify: { questions: [], answers: [] }, reviews: [], stepQuestions: [] }),
  ...extra,
});

test('get_run / get_run_progress: baseSha + baseMoved when recorded (remote wins); without baseSha the keys are unchanged and baseMoved is never called', async () => {
  await checkRows([
    { name: 'get_run / get_run_progress: baseSha + baseMoved when recorded; the recorded remote wins', run: async () => {
      const calls = [];
      const branches = { async baseMoved(a) { calls.push(a); return { commits: 4, fetchedAt: '2026-09-30T10:00:00.000Z' }; } };
      const r = runRow({ source: 'dev', feature: 'worca-cc/x', baseSha: 'c'.repeat(40), startRef: 'd'.repeat(40), sync: { remote: 'upstream' } });
      const tools = createAskTools(runDeps(r, { branches }));
      const run = await tools.call('get_run', { id: 'abcd1234' });
      assert.equal(run.baseSha, 'c'.repeat(40));
      assert.equal(run.startRef, 'd'.repeat(40));
      assert.deepEqual(run.baseMoved, { commits: 4, fetchedAt: '2026-09-30T10:00:00.000Z' });
      assert.deepEqual(calls[0], { projectDir: '/p/web', projectKey: 'web-00000001', source: 'dev', baseSha: 'c'.repeat(40), remote: 'upstream' });
      const prog = await tools.call('get_run_progress', { runId: 'abcd1234' });
      assert.equal(prog.baseSha, 'c'.repeat(40));
      assert.deepEqual(prog.baseMoved, { commits: 4, fetchedAt: '2026-09-30T10:00:00.000Z' });
    } },
    { name: 'get_run without baseSha keeps its keys and never calls baseMoved', run: async () => {
      let called = 0;
      const r = runRow({ source: 'dev', feature: 'worca-cc/x' });
      const plain = await createAskTools(runDeps(r)).call('get_run', { id: 'abcd1234' });
      const tools = createAskTools(runDeps(r, { branches: { async baseMoved() { called += 1; return { commits: 1, fetchedAt: null }; } } }));
      const out = await tools.call('get_run', { id: 'abcd1234' });
      assert.deepEqual(Object.keys(out), Object.keys(plain));
      assert.equal('baseSha' in out || 'baseMoved' in out, false);
      const prog = await tools.call('get_run_progress', { runId: 'abcd1234' });
      assert.equal('baseSha' in prog || 'baseMoved' in prog, false);
      assert.equal(called, 0);
    } },
  ]);
});

// ── open_worktree result fields ─────────────────────────────────────────────
test('open_worktree passes resolvedFrom / stale / fetchedAt through only when present', async () => {
  const base = { worktreeId: 'wt_00000001', path: '/w', projectKey: 'web-00000001', ref: 'origin/feat', commit: 'e'.repeat(40) };
  let next = base;
  const tools = createAskTools(baseDeps({ worktrees: { async open() { return next; } } }));
  assert.deepEqual(await tools.call('open_worktree', { projectKey: 'web-00000001', ref: 'origin/feat' }), base);
  next = { ...base, resolvedFrom: 'feat', stale: true, fetchedAt: '2026-09-30T10:00:00.000Z', runId: null };
  assert.deepEqual(await tools.call('open_worktree', { projectKey: 'web-00000001', ref: 'feat' }),
    { ...base, resolvedFrom: 'feat', stale: true, fetchedAt: '2026-09-30T10:00:00.000Z' });
});

// ── defaultBranchDeps over real git ─────────────────────────────────────────
const tmp = [];
after(() => { for (const d of tmp) rmSync(d, { recursive: true, force: true }); });
const git = (cwd, args) => {
  const r = spawnSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', '-c', 'commit.gpgsign=false', ...args], { cwd, encoding: 'utf8' });
  assert.equal(r.status, 0, `git ${args.join(' ')}: ${r.stderr}`);
  return r.stdout.trim();
};
/** A bare origin with main + feat/remote, and a clone of it with a local-only branch. */
function repoPair() {
  const root = mkdtempSync(join(tmpdir(), 'worca-abt-'));
  tmp.push(root);
  const origin = join(root, 'origin.git');
  const seed = join(root, 'seed');
  const clone = join(root, 'clone');
  mkdirSync(seed);
  git(root, ['init', '-q', '--bare', '-b', 'main', origin]);
  git(seed, ['init', '-q', '-b', 'main']);
  writeFileSync(join(seed, 'a.txt'), 'a\n');
  git(seed, ['add', '-A']); git(seed, ['commit', '-qm', 'init']);
  git(seed, ['remote', 'add', 'origin', origin]);
  git(seed, ['push', '-q', 'origin', 'main']);
  git(root, ['clone', '-q', origin, clone]);
  git(seed, ['checkout', '-qb', 'feat/remote']);
  writeFileSync(join(seed, 'b.txt'), 'b\n');
  git(seed, ['add', '-A']); git(seed, ['commit', '-qm', 'remote feat']);
  git(seed, ['push', '-q', 'origin', 'feat/remote']);
  git(clone, ['branch', 'local-only']);
  return { root, origin, seed, clone };
}

test('defaultBranchDeps: unknown key → null; missing folder → error without git; real list fetches first', async () => {
  const { addProject } = await import('../src/core/projects.mjs');
  const { defaultBranchDeps } = await import('../src/core/ask/branch-deps.mjs');
  const { _testing } = await import('../src/core/git-sync.mjs');
  const b = defaultBranchDeps().branches;
  assert.equal(await b.list('nope-00000000', { fresh: false, limit: 10 }), null);

  const { clone } = repoPair();
  const p = (await addProject({ name: 'abt-real', path: clone })).find((x) => x.name === 'abt-real');
  const out = await b.list(p.key, { fresh: true, limit: 50 });
  assert.equal(out.ok, true);
  assert.equal(out.projectKey, p.key);
  assert.equal(out.remote, 'origin');
  const by = Object.fromEntries(out.branches.map((x) => [x.name, x]));
  assert.equal(by['feat/remote'].hasLocal, false, 'the fetch brought in the remote-only branch');
  assert.equal(by['feat/remote'].hasRemote, true);
  assert.equal(by['local-only'].hasRemote, false);
  assert.equal(by.main.hasLocal && by.main.hasRemote, true);

  const gone = repoPair().clone;
  const pg = (await addProject({ name: 'abt-gone', path: gone })).find((x) => x.name === 'abt-gone');
  rmSync(gone, { recursive: true, force: true });
  let spawned = 0;
  _testing.setRunner(async () => { spawned += 1; return { ok: false, stdout: '', stderr: '', code: 1, timedOut: false }; });
  try {
    assert.deepEqual(await b.list(pg.key, { fresh: true, limit: 10 }), { projectKey: pg.key, ok: false, error: 'project folder is missing on disk' });
    assert.equal(spawned, 0, 'no git in a dead cwd');
  } finally { _testing.reset(); }
});

test('defaultBranchDeps: a workspace with one deleted member lists the others', async () => {
  const { addProject } = await import('../src/core/projects.mjs');
  const { createWorkspace } = await import('../src/core/workspaces.mjs');
  const { defaultBranchDeps } = await import('../src/core/ask/branch-deps.mjs');
  const a = repoPair().clone;
  const c = repoPair().clone;
  await addProject({ name: 'abt-ws-a', path: a });
  await addProject({ name: 'abt-ws-c', path: c });
  const ws = await createWorkspace({ name: 'abt-ws', projectPaths: [a, c] });
  rmSync(c, { recursive: true, force: true });
  const out = await defaultBranchDeps().branches.listWorkspace(ws.id, { fresh: false, limit: 100 });
  assert.equal(out.length, 2);
  const byKey = Object.fromEntries(out.map((m) => [m.projectKey, m]));
  const ia = ws.projectPaths.indexOf(a);
  const ic = ws.projectPaths.indexOf(c);
  assert.equal(byKey[ws.projectKeys[ia]].ok, true);
  assert.ok(byKey[ws.projectKeys[ia]].branches.length >= 1);
  assert.deepEqual(byKey[ws.projectKeys[ic]], { projectKey: ws.projectKeys[ic], ok: false, error: 'project folder is missing on disk' });
  assert.equal(await defaultBranchDeps().branches.listWorkspace('wks-none-0000abcd', { limit: 10 }), null);
});

test('defaultBranchDeps: the workspace fan-out has one deadline — later members are read from the last fetch, marked stale', async () => {
  const { addProject } = await import('../src/core/projects.mjs');
  const { createWorkspace } = await import('../src/core/workspaces.mjs');
  const { defaultBranchDeps } = await import('../src/core/ask/branch-deps.mjs');
  const { _testing } = await import('../src/core/git-sync.mjs');
  const dirs = [repoPair().clone, repoPair().clone, repoPair().clone];
  for (const [i, d] of dirs.entries()) await addProject({ name: `abt-dl-${i}`, path: d });
  const ws = await createWorkspace({ name: 'abt-dl', projectPaths: dirs });
  const fetched = [];
  _testing.setRunner(async (args, o) => {
    if (args[0] !== 'fetch') return _testing.defaultRun(args, o);
    fetched.push(o.cwd);
    await new Promise((r) => setTimeout(r, 150));   // an unreachable remote, slower than the deadline
    return { ok: false, stdout: '', stderr: 'fatal: unable to access: Could not resolve host: github.com', code: 128, timedOut: false };
  });
  const prevCap = process.env.WORCA_FANOUT_CAP;
  process.env.WORCA_FANOUT_CAP = '1';                // one member at a time: the deadline is reached after the first
  try {
    const out = await defaultBranchDeps({ workspaceMs: 100 }).branches.listWorkspace(ws.id, { fresh: true, limit: 30 });
    assert.equal(fetched.length, 1, `only the first member fetched: ${fetched.join(', ')}`);
    assert.equal(out[0].fetchError.kind, 'network');
    for (const m of out.slice(1)) {
      assert.equal(m.ok, true);
      assert.ok(m.branches.length >= 1, 'still listed from local refs');
      assert.equal(m.stale, true);
      assert.equal(m.fetchError.kind, 'timeout');
    }
  } finally {
    _testing.reset();
    if (prevCap === undefined) delete process.env.WORCA_FANOUT_CAP; else process.env.WORCA_FANOUT_CAP = prevCap;
  }
});

test('defaultBranchDeps: an unused member row share goes to a truncated member', async () => {
  const { addProject } = await import('../src/core/projects.mjs');
  const { createWorkspace } = await import('../src/core/workspaces.mjs');
  const { defaultBranchDeps } = await import('../src/core/ask/branch-deps.mjs');
  const few = repoPair().clone;                      // main + local-only (feat/remote was pushed after the clone; no fetch) → 2 names
  const many = repoPair().clone;
  for (let i = 0; i < 7; i++) git(many, ['branch', `extra-${i}`]);   // 9 names
  await addProject({ name: 'abt-rd-few', path: few });
  await addProject({ name: 'abt-rd-many', path: many });
  const ws = await createWorkspace({ name: 'abt-rd', projectPaths: [few, many] });
  const out = await defaultBranchDeps().branches.listWorkspace(ws.id, { fresh: false, limit: 10 });   // 5 each at first
  const by = Object.fromEntries(out.map((m) => [ws.projectPaths[ws.projectKeys.indexOf(m.projectKey)], m]));
  assert.equal(by[few].branches.length, 2);
  assert.equal(by[few].truncated, false);
  assert.equal(by[many].branches.length, 8, 'its own 5 plus the 3 the other member left');
  assert.equal(by[many].truncated, true);
});

test('propose_run singleton: bound to the real resolver — a remote-only source is annotated, a nowhere source names the remote', async () => {
  const { addProject } = await import('../src/core/projects.mjs');
  const { validateProposal } = await import('../src/core/ask/proposal.mjs');
  const { clone } = repoPair();                      // feat/remote was pushed after the clone: only a fetch finds it
  const p = (await addProject({ name: 'abt-prop', path: clone })).find((x) => x.name === 'abt-prop');
  const r = await validateProposal({ projectKey: p.key, brief: 'x', sourceBranch: 'feat/remote' });
  assert.equal(r.ok, true, JSON.stringify(r.errors));
  assert.equal(r.card.sourceBranch, 'feat/remote');
  assert.deepEqual(r.card.sourceRef, { ref: 'origin/feat/remote', remoteOnly: true, behind: 0 });
  const bad = await validateProposal({ projectKey: p.key, brief: 'x', sourceBranch: 'nowhere' });
  assert.equal(bad.ok, false);
  assert.ok(bad.errors.some((e) => /exists neither locally nor on origin/.test(e)), bad.errors.join('; '));
});

test('defaultBranchDeps: a no-credential auth failure gets the child note; a rejected credential passes through', async () => {
  const { addProject } = await import('../src/core/projects.mjs');
  const { defaultBranchDeps } = await import('../src/core/ask/branch-deps.mjs');
  const { _testing } = await import('../src/core/git-sync.mjs');
  const { clone } = repoPair();
  const p = (await addProject({ name: 'abt-auth', path: clone })).find((x) => x.name === 'abt-auth');
  const failFetch = (stderr) => async (args, o) => (args[0] === 'fetch'
    ? { ok: false, stdout: '', stderr, code: 128, timedOut: false }
    : _testing.defaultRun(args, o));
  try {
    _testing.setRunner(failFetch("fatal: could not read Username for 'https://github.com': terminal prompts disabled"));
    const a = await defaultBranchDeps().branches.list(p.key, { fresh: true, limit: 10 });
    assert.equal(a.stale, true);
    assert.equal(a.fetchError.kind, 'auth');
    assert.match(a.fetchError.message, /could not sign in to the remote from the Ask tool process/);
    _testing.forgetProcess();
    _testing.setRunner(failFetch("remote: Invalid username or token.\nfatal: Authentication failed for 'https://github.com/acme/web.git/'"));
    const r = await defaultBranchDeps().branches.list(p.key, { fresh: true, limit: 10 });
    assert.equal(r.stale, true);
    assert.equal(r.fetchError.kind, 'auth');
    assert.match(r.fetchError.message, /Authentication failed/);
  } finally { _testing.reset(); }
});

test('defaultBranchDeps.status: sync for existing projects only; baseMoved counts offline without git status', async () => {
  const { defaultBranchDeps } = await import('../src/core/ask/branch-deps.mjs');
  const { _testing, lastFetchedAt } = await import('../src/core/git-sync.mjs');
  const { clone, seed } = repoPair();
  const baseSha = git(clone, ['rev-parse', 'main']);
  // two commits land on origin/main after the run started
  git(seed, ['checkout', '-q', 'main']);
  for (const n of ['c1', 'c2']) { writeFileSync(join(seed, n), n); git(seed, ['add', '-A']); git(seed, ['commit', '-qm', n]); }
  git(seed, ['push', '-q', 'origin', 'main']);
  git(clone, ['fetch', '-q', 'origin']);
  const b = defaultBranchDeps().branches;
  const m = await b.status([{ key: 'k1', path: clone }, { key: 'k2', path: join(clone, 'nope') }]);
  assert.deepEqual([...m.keys()], ['k1']);
  assert.equal(m.get('k1').base, 'main');
  assert.equal(m.get('k1').behind, 2);
  assert.equal(m.get('k1').ahead, 0);
  assert.equal(m.get('k1').dirty, false);

  const seen = [];
  _testing.setRunner(async (args, o) => { seen.push(args[0]); return _testing.defaultRun(args, o); });
  try {
    const moved = await b.baseMoved({ projectDir: clone, projectKey: null, source: 'main', baseSha });
    assert.equal(moved.commits, 2);
    assert.equal(moved.fetchedAt, await lastFetchedAt(clone, { remote: 'origin' }));
    assert.ok(!seen.includes('status'), `no git status: ${seen.join(',')}`);
    assert.ok(!seen.includes('fetch'), 'no network');
    const none = await b.baseMoved({ projectDir: clone, projectKey: null, source: 'main', baseSha, remote: 'upstream' });
    assert.equal(none.commits, null, 'a missing <remote>/<source> is unknown, never "not moved"');
  } finally { _testing.reset(); }
  assert.equal(await b.baseMoved({ projectDir: clone, source: '-x', baseSha }), null);
});

// P0 Task 10: while git is missing no sync fact is read — list_projects carries no sync, get_run / get_run_progress no baseMoved.
test('git missing: list_projects never asks branches.status, get_run / get_run_progress never ask baseMoved', async () => {
  let status = 0; let moved = 0;
  const branches = { async status() { status += 1; return new Map([['web-00000001', { base: 'dev', ahead: 1, behind: 2, dirty: false, fetchedAt: null }]]); },
    async baseMoved() { moved += 1; return { commits: 4, fetchedAt: null }; } };
  const r = runRow({ source: 'dev', feature: 'worca-cc/x', baseSha: 'c'.repeat(40) });
  const tools = createAskTools(runDeps(r, { branches, gitAvailable: () => false }));
  assert.equal((await tools.call('list_projects', {})).projects.some((p) => 'sync' in p), false);
  assert.equal('baseMoved' in (await tools.call('get_run', { id: 'abcd1234' })), false);
  assert.equal('baseMoved' in (await tools.call('get_run_progress', { runId: 'abcd1234' })), false);
  assert.deepEqual([status, moved], [0, 0]);
});
