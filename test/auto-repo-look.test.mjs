// test/auto-repo-look.test.mjs — the throwaway detached checkout the chat's classifier reads.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { useTempHome } from './helpers/temp-home.mjs';
import { gitDir } from './helpers/git-dir.mjs';
import { openRepoLook, openWorkspaceRepoLook, sweepRepoLooks, REPO_LOOK_DIRNAME, REPO_LOOK_MAX_MEMBERS } from '../src/core/auto/repo-look.mjs';
import { runGitCapture } from '../src/core/worktree.mjs';

useTempHome(after);
const base = () => mkdtempSync(join(tmpdir(), 'worca-look-base-'));
// git records the REALPATH of a checkout (`/private/var/…` for a `/var/…` tmpdir on macOS), so
// registrations are matched by the unique dir NAME, never by the path string.
const registered = async (projectDir, cwd) => (await runGitCapture(projectDir, ['worktree', 'list', '--porcelain'])).stdout.includes(basename(cwd));

test('a directory without a git repository yields null (text-only classification)', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'worca-look-nogit-'));
  assert.equal(await openRepoLook(dir, base()), null);
  assert.equal(await openRepoLook('', base()), null);
  assert.equal(await openRepoLook(gitDir('look-nobase'), ''), null);
});

test('a git project yields a detached checkout under baseDir that close() removes (idempotent)', async () => {
  const projectDir = gitDir('look');
  const baseDir = base();
  // Deliberately NO signal: a caller without one (tests, a deps bundle built without a lifetime signal)
  // must still get a checkout — spawn rejects `signal: null`, so the module must omit the key (Facts).
  const look = await openRepoLook(projectDir, baseDir);
  assert.ok(look && look.cwd.startsWith(baseDir), 'the checkout lives under baseDir');
  assert.ok(basename(look.cwd).startsWith(`${REPO_LOOK_DIRNAME}-`), 'named auto-look-<hex>');
  assert.ok(readdirSync(baseDir).includes(basename(look.cwd)));
  assert.notEqual(look.cwd, projectDir, 'never the live checkout');
  assert.ok(existsSync(join(look.cwd, '.git')), 'a real worktree (.git is a pointer FILE there)');
  const head = await runGitCapture(look.cwd, ['rev-parse', '--abbrev-ref', 'HEAD']);
  assert.equal(head.stdout.trim(), 'HEAD', 'detached: no branch is created or locked');
  assert.equal(await registered(projectDir, look.cwd), true, 'git knows the worktree');
  await look.close();
  assert.equal(existsSync(look.cwd), false, 'removed');
  assert.equal(await registered(projectDir, look.cwd), false, 'unregistered');
  await look.close();   // a second close is a no-op
  assert.equal(existsSync(look.cwd), false);
});

test('an already-aborted signal yields null and leaves nothing behind', async () => {
  const projectDir = gitDir('look-abort');
  const baseDir = base();
  const ctrl = new AbortController(); ctrl.abort();
  const notes = [];
  assert.equal(await openRepoLook(projectDir, baseDir, { signal: ctrl.signal, log: (m) => notes.push(m) }), null);
  assert.ok(notes.some((m) => /repo look unavailable/.test(m)), 'the fallback is logged');
  assert.ok(!readdirSync(baseDir).some((n) => n.startsWith(`${REPO_LOOK_DIRNAME}-`)), 'no checkout left behind');
  assert.equal(await registered(projectDir, `${REPO_LOOK_DIRNAME}-`), false, 'nothing registered on the project');
});

// ── Workspace look + sweep (D-W7) ─────────────────────────────────────────────────────────
const lookDirs = (baseDir) => (existsSync(baseDir) ? readdirSync(baseDir).filter((n) => n.startsWith(`${REPO_LOOK_DIRNAME}-`)) : []);
const age = (dir, ms = 2 * 3_600_000) => { const t = new Date(Date.now() - ms); utimesSync(dir, t, t); };

test('openWorkspaceRepoLook checks out each member at repos/<key>; close() removes all of it', async () => {
  const a = gitDir('wlook-a');
  const b = gitDir('wlook-b');
  const baseDir = base();
  const look = await openWorkspaceRepoLook([{ projectKey: 'alpha', projectDir: a }, { projectKey: 'beta', projectDir: b }], baseDir);
  assert.ok(look && look.cwd.startsWith(baseDir), 'the parent lives under baseDir');
  assert.ok(basename(look.cwd).startsWith(`${REPO_LOOK_DIRNAME}-`), 'named auto-look-<hex>');
  assert.deepEqual(look.members, ['alpha', 'beta']);
  assert.deepEqual(readdirSync(join(look.cwd, 'repos')).sort(), ['alpha', 'beta']);
  for (const [key, dir] of [['alpha', a], ['beta', b]]) {
    const wt = join(look.cwd, 'repos', key);
    assert.ok(existsSync(join(wt, '.git')), `${key} is a real worktree`);
    assert.equal((await runGitCapture(wt, ['rev-parse', '--abbrev-ref', 'HEAD'])).stdout.trim(), 'HEAD', 'detached');
    assert.equal(await registered(dir, look.cwd), true, `${key}'s repo knows the worktree`);
  }
  await look.close();
  assert.equal(existsSync(look.cwd), false, 'the parent dir is gone');
  assert.equal(await registered(a, look.cwd), false, 'unregistered in alpha');
  assert.equal(await registered(b, look.cwd), false, 'unregistered in beta');
  await look.close();   // idempotent
});

test('openWorkspaceRepoLook skips a non-git member', async () => {
  const a = gitDir('wlook-git');
  const plain = mkdtempSync(join(tmpdir(), 'worca-look-plain-'));
  const notes = [];
  const look = await openWorkspaceRepoLook([{ projectKey: 'alpha', projectDir: a }, { projectKey: 'plain', projectDir: plain }], base(), { log: (m) => notes.push(m) });
  assert.deepEqual(look.members, ['alpha']);
  assert.deepEqual(readdirSync(join(look.cwd, 'repos')), ['alpha']);
  assert.ok(notes.some((m) => /plain has no git repository/.test(m)));
  await look.close();
});

test('openWorkspaceRepoLook honours the maxMembers cap', async () => {
  const members = ['m1', 'm2', 'm3'].map((k) => ({ projectKey: k, projectDir: gitDir(`wlook-${k}`) }));
  const notes = [];
  const look = await openWorkspaceRepoLook(members, base(), { maxMembers: 2, log: (m) => notes.push(m) });
  assert.deepEqual(look.members, ['m1', 'm2']);
  assert.deepEqual(readdirSync(join(look.cwd, 'repos')).sort(), ['m1', 'm2']);
  assert.ok(notes.some((m) => /1 member\(s\) past the 2-checkout cap/.test(m)));
  assert.equal(await registered(members[2].projectDir, look.cwd), false);
  await look.close();
  assert.equal(REPO_LOOK_MAX_MEMBERS, 8);
});

test('openWorkspaceRepoLook with a pre-aborted signal yields null and leaves nothing behind', async () => {
  const a = gitDir('wlook-pre');
  const baseDir = base();
  const ctrl = new AbortController(); ctrl.abort();
  assert.equal(await openWorkspaceRepoLook([{ projectKey: 'alpha', projectDir: a }], baseDir, { signal: ctrl.signal }), null);
  assert.deepEqual(lookDirs(baseDir), []);
  assert.equal(await registered(a, `${REPO_LOOK_DIRNAME}-`), false);
});

test('openWorkspaceRepoLook aborted after the first checkout yields null and leaves nothing behind', async () => {
  const a = gitDir('wlook-mid-a');
  const b = gitDir('wlook-mid-b');
  const baseDir = base();
  const ctrl = new AbortController();
  // The signal trips when the loop reads the SECOND member — alpha is already checked out by then.
  const members = [{ projectKey: 'alpha', projectDir: a }, {
    get projectKey() { ctrl.abort(); return 'beta'; },
    projectDir: b,
  }];
  assert.equal(await openWorkspaceRepoLook(members, baseDir, { signal: ctrl.signal }), null);
  assert.deepEqual(lookDirs(baseDir), [], 'no parent dir left');
  assert.equal(await registered(a, `${REPO_LOOK_DIRNAME}-`), false, 'alpha\'s checkout was unregistered');
  assert.equal(await registered(b, `${REPO_LOOK_DIRNAME}-`), false, 'beta was never checked out');
});

test('openWorkspaceRepoLook with no usable member yields null and leaves no dir', async () => {
  const baseDir = base();
  const plain = mkdtempSync(join(tmpdir(), 'worca-look-plain2-'));
  assert.equal(await openWorkspaceRepoLook([{ projectKey: 'plain', projectDir: plain }], baseDir), null);
  assert.deepEqual(lookDirs(baseDir), []);
  assert.equal(await openWorkspaceRepoLook([], baseDir), null);
  assert.equal(await openWorkspaceRepoLook([{ projectKey: 'x', projectDir: gitDir('wlook-nobase') }], ''), null);
});

test('sweepRepoLooks removes stale single-project and workspace looks, keeps fresh ones, tolerates garbage', async () => {
  // baseDir under the un-realpath'd tmpdir(): git records /private/var/… on macOS, so the sweep must realpath.
  const baseDir = base();
  const single = gitDir('sweep-single');
  const wa = gitDir('sweep-wa');
  const wb = gitDir('sweep-wb');
  const fresh = gitDir('sweep-fresh');
  const stale1 = await openRepoLook(single, baseDir);
  const stale2 = await openWorkspaceRepoLook([{ projectKey: 'a', projectDir: wa }, { projectKey: 'b', projectDir: wb }], baseDir);
  const live = await openRepoLook(fresh, baseDir);
  const garbage = join(baseDir, `${REPO_LOOK_DIRNAME}-deadbeef`);
  mkdirSync(garbage);
  writeFileSync(join(garbage, '.git'), 'not a gitdir pointer\n');
  const unrelated = join(baseDir, 'something-else');
  mkdirSync(unrelated);
  for (const d of [stale1.cwd, stale2.cwd, garbage, unrelated]) age(d);

  const res = await sweepRepoLooks(baseDir);
  assert.deepEqual(res.removed.sort(), [stale1.cwd, stale2.cwd, garbage].sort());
  assert.deepEqual(res.failed, []);
  for (const d of [stale1.cwd, stale2.cwd, garbage]) assert.equal(existsSync(d), false, `${d} removed`);
  assert.equal(existsSync(live.cwd), true, 'a fresh look is kept');
  assert.equal(existsSync(unrelated), true, 'a non-look dir is untouched');
  assert.equal(await registered(single, stale1.cwd), false, 'single-project look unregistered');
  assert.equal(await registered(wa, stale2.cwd), false, 'workspace look unregistered in a');
  assert.equal(await registered(wb, stale2.cwd), false, 'workspace look unregistered in b');
  assert.equal(await registered(fresh, live.cwd), true, 'the fresh look stays registered');
  await live.close();
});

test('sweepRepoLooks on a missing baseDir returns empty lists; log is optional', async () => {
  const missing = join(tmpdir(), `worca-look-missing-${Date.now()}`);
  assert.deepEqual(await sweepRepoLooks(missing, { log: undefined }), { removed: [], failed: [] });
  assert.deepEqual(await sweepRepoLooks(''), { removed: [], failed: [] });
  const baseDir = base();
  const garbage = join(baseDir, `${REPO_LOOK_DIRNAME}-cafebabe`);
  mkdirSync(join(garbage, 'repos', 'x'), { recursive: true });
  writeFileSync(join(garbage, 'repos', 'x', '.git'), 'gitdir: relative/nonsense\n');
  age(garbage);
  const warnings = [];
  const res = await sweepRepoLooks(baseDir, { log: (level, msg) => warnings.push([level, msg]) });
  assert.deepEqual(res, { removed: [garbage], failed: [] });
  assert.ok(warnings.some(([level, msg]) => level === 'warn' && /no readable \.git file/.test(msg)));
});
