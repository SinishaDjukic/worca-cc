// test/memory-team-sync.test.mjs — team memory (phase 1a) across TWO machines: A is this process (its WORCA_HOME), B a
// child process with another WORCA_HOME (fixtures/team-memory/machine-child.mjs); both clone ONE bare origin.
import { test, before, after, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, existsSync, unlinkSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { useGitSandbox, makeOrigin, cloneAs, git, branchFiles, rejectAllPushes } from './helpers/metrics-git.mjs';
import { useTempHome } from './helpers/temp-home.mjs';
import { addProject } from '../src/core/projects.mjs';
import { writeProjectSettings } from '../src/core/settings-cascade.mjs';
import { memoryRoot, projectScope, GLOBAL_SCOPE, writeMemory, readMemory, removeMemory, listSnapshots, setMemoryExtra } from '../src/core/memory-store.mjs';
import { _testing as metricsTesting } from '../src/core/metrics/sync.mjs';
import {
  queueTeamChanges, flushTeamMemory, refreshTeamLayer, teamMemoryStatus, teamMemorySettingChanged, teamMemoryRoot, deleteTeamNote,
  readTeamSnapshot, contentHash,
  TEAM_MEMORY_BRANCH, TEAM_NOTES_REL, TEAM_MARKER_KEY, _testing,
} from '../src/core/memory-team.mjs';

const skip = process.platform === 'win32' ? 'pre-receive hooks / sh not portable to win32' : false;
const CHILD = resolve(dirname(fileURLToPath(import.meta.url)), 'fixtures/team-memory/machine-child.mjs');
const root = mkdtempSync(join(tmpdir(), 'worca-team-mem-'));
const homeB = mkdtempSync(join(tmpdir(), 'worca-home-b-'));
useGitSandbox(before, after);   // FIRST: pins HOME / USERPROFILE / GIT_CONFIG_GLOBAL
useTempHome(after);
after(() => { rmSync(root, { recursive: true, force: true }); rmSync(homeB, { recursive: true, force: true }); });
afterEach(() => { _testing.reset(); metricsTesting.reset(); });

const NOW = '2026-10-16T10:00:00.000Z';
const noSleep = { sleep: async () => {} };
const note = (description, body) => `---\nname: x\ndescription: ${description}\n---\n${body}\n`;
const spawnSyncOut = (cwd, args, input) => spawnSync('git', args, { cwd, input, encoding: 'utf8' }).stdout.trim();
function child(args) {
  return new Promise((res, rej) => {
    const c = spawn(process.execPath, [CHILD], { env: { ...process.env, WORCA_HOME: homeB }, stdio: ['pipe', 'pipe', 'inherit'] });
    c.stdin.end(JSON.stringify(args));   // stdin, not argv: Linux caps one argument at 128 KiB (E2BIG)
    let out = '';
    c.stdout.on('data', (d) => { out += d; });
    c.on('error', rej);
    c.on('exit', (code) => {
      if (code !== 0) return rej(new Error(`child exited ${code}: ${out}`));
      try { res(JSON.parse(out)); } catch { rej(new Error(`child printed non-JSON: ${out}`)); }
    });
  });
}

let bare, dirA, dirB, keyA;
const onBranch = () => (branchFiles(bare, TEAM_MEMORY_BRANCH) || []).filter((p) => p.startsWith(`${TEAM_NOTES_REL}/`)).map((p) => p.slice(TEAM_NOTES_REL.length + 1, -3)).sort();
const writeA = async (name, text) => { await writeMemory(memoryRoot(), projectScope(keyA), name, text, { source: 'user', now: NOW }); return queueTeamChanges(keyA, [name], { flush: false }); };
const localA = (name) => readMemory(memoryRoot(), projectScope(keyA), name);

before(async () => {
  bare = makeOrigin(root, 'shop');
  dirA = cloneAs(root, 'machineA', bare, 'shop');
  keyA = (await addProject({ name: 'shop', path: dirA })).find((p) => p.name === 'shop').key;
  writeProjectSettings({ projectDir: dirA }, { 'memory.team': true });
});

test('the first shared note starts the orphan worca-memory branch: README, config, one file per note, no local-only fields', { skip }, async () => {
  assert.equal(branchFiles(bare, TEAM_MEMORY_BRANCH), null, 'nothing exists before anything is shared');
  assert.deepEqual((await writeA('deploy-trap', note('Read before deploying', 'Run migrations before the deploy.'))).queued, ['deploy-trap']);
  const r = await flushTeamMemory(keyA, noSleep);
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.deepEqual(branchFiles(bare, TEAM_MEMORY_BRANCH), ['.worca-memory/config.json', '.worca-memory/notes/deploy-trap.md', 'README.md']);
  assert.equal(git(bare, 'rev-list', '--max-parents=0', '--count', TEAM_MEMORY_BRANCH), '1', 'an orphan: one root');
  const shared = git(bare, 'show', `${TEAM_MEMORY_BRANCH}:${TEAM_NOTES_REL}/deploy-trap.md`);
  assert.match(shared, /^name: deploy-trap$/m);
  assert.match(shared, /^author: machineA dev$/m);
  assert.doesNotMatch(shared, /^(source|team):/m, 'no local run id, no tracking marker');
  assert.match((await localA('deploy-trap')).meta.extra[TEAM_MARKER_KEY], /^[0-9a-f]{40}$/, 'the shared note is now a tracked copy');
});

test('machine B joins: the note loads from B\'s team layer and never enters B\'s local store (the local cap is untouched)', { skip }, async () => {
  dirB = cloneAs(root, 'machineB', bare, 'shop');
  const j = await child({ op: 'join', name: 'shop', dir: dirB });
  assert.deepEqual(Object.keys(j.snapshot.notes), ['deploy-trap']);
  assert.deepEqual(await child({ op: 'local', dir: dirB }), {});
});

test('concurrent push: A\'s first push is rejected non-fast-forward, A refetches, re-applies, and both notes land', { skip }, async () => {
  await writeA('ci-cache', note('Read when CI is slow', 'Clear the cache key when the lockfile changes.'));
  let raced = 0;
  const r = await flushTeamMemory(keyA, { ...noSleep, hooks: { beforePush: async ({ attempt }) => {
    if (attempt !== 1) return;
    raced++;
    const b = await child({ op: 'write', dir: dirB, note: 'flaky-e2e', text: note('Read when e2e is red', 'The e2e suite needs TZ=UTC.') });
    assert.equal(b.ok, true, JSON.stringify(b));
  } } });
  assert.equal(raced, 1);
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(r.attempts, 2, 'first push non-fast-forward; second after fetch + reset + re-apply');
  assert.deepEqual(onBranch(), ['ci-cache', 'deploy-trap', 'flaky-e2e']);
});

test('gate: a note with an email is BLOCKED with its reason and never leaves; the edit that passes is shared', { skip }, async () => {
  const q = await writeA('oncall', note('Read when paging', 'Page bob.smith@acme.io for the database.'));
  assert.deepEqual(q.queued, []);
  assert.match(q.blocked[0].reason, /^line \d+: an email address$/);
  assert.equal((await flushTeamMemory(keyA, noSleep)).pushed, 0);
  assert.ok(!onBranch().includes('oncall'));
  const row = (await teamMemoryStatus(keyA)).notes.find((n) => n.name === 'oncall');
  assert.equal(row.state, 'blocked');
  assert.doesNotMatch(JSON.stringify(row), /bob\.smith/, 'rule and line only');
  assert.deepEqual((await writeA('oncall', note('Read when paging', 'Page the database on-call rotation.'))).queued, ['oncall']);
  assert.equal((await flushTeamMemory(keyA, noSleep)).ok, true);
  assert.ok(onBranch().includes('oncall'));
});

test('same-note edit: last write wins, history keeps both, A\'s unedited copy follows the team; A\'s edited (blocked) copy stays', { skip }, async () => {
  await writeA('ci-cache', note('Read when CI is slow', 'Cache host is 10.0.3.17.'));   // blocked: A's edit stays local
  const b1 = await child({ op: 'write', dir: dirB, note: 'deploy-trap', text: note('Read before deploying', 'Run migrations, THEN warm the cache.') });
  const b2 = await child({ op: 'write', dir: dirB, note: 'ci-cache', text: note('Read when CI is slow', 'B\'s take on the cache.') });
  assert.equal(b1.ok && b2.ok, true, JSON.stringify([b1, b2]));
  assert.equal(git(bare, 'rev-list', '--count', TEAM_MEMORY_BRANCH, '--', `${TEAM_NOTES_REL}/deploy-trap.md`), '2', 'git history keeps A\'s version');
  const r = await refreshTeamLayer(keyA, { maxAgeMs: 0 });
  assert.deepEqual(r.followed, ['deploy-trap']);
  const d = await localA('deploy-trap');
  assert.match(d.body, /THEN warm the cache/);
  assert.equal(d.meta.source, 'team');
  assert.match((await localA('ci-cache')).body, /10\.0\.3\.17/, 'an edited copy is never overwritten');
  assert.equal((await teamMemoryStatus(keyA)).notes.find((n) => n.name === 'ci-cache').state, 'blocked');
});

test('deletions: B forgets its tracked copy ⇒ the team loses it ⇒ A\'s unedited copy goes too (restorable)', { skip }, async () => {
  const f = await child({ op: 'forget', dir: dirB, note: 'deploy-trap' });
  assert.equal(f.ok, true, JSON.stringify(f));
  assert.ok(!onBranch().includes('deploy-trap'));
  const r = await refreshTeamLayer(keyA, { maxAgeMs: 0 });
  assert.deepEqual(r.removed, ['deploy-trap']);
  assert.equal(await localA('deploy-trap'), null);
  // Not `.at(-1)`: the writes above use a fixed NOW, the follow snapshot the real clock — their ids need not sort.
  assert.ok((await listSnapshots(memoryRoot(), projectScope(keyA))).some((s) => s.id.includes('-team') && s.files.includes('deploy-trap.md')), 'the store history keeps it');
});

test('a push follows the team too: a teammate\'s update fetched by A\'s own push lands at once, not after the fetch TTL', { skip }, async () => {
  const b = await child({ op: 'write', dir: dirB, note: 'oncall', text: note('Read when paging', 'Page the on-call rotation, then the DBA.') });
  assert.equal(b.ok, true, JSON.stringify(b));
  await writeA('push-follows', note('Read after a push', 'A push fetches the branch first.'));
  const r = await flushTeamMemory(keyA, noSleep);
  assert.equal(r.ok, true, JSON.stringify(r));
  const o = await localA('oncall');
  assert.match(o.body, /then the DBA/, 'A\'s unedited tracked copy followed during the push');
  assert.equal(o.meta.source, 'team');
  assert.equal((await refreshTeamLayer(keyA)).fetched, false, 'the push left a fresh snapshot: no fetch was needed for it');
});

test('an edit BLOCKED while the previous version is being pushed keeps its blocked record; the clean version lands', { skip }, async () => {
  await writeA('racy', note('Read first', 'Clean text.'));
  const r = await flushTeamMemory(keyA, { ...noSleep, hooks: { beforePush: async ({ attempt }) => {
    if (attempt !== 1) return;
    assert.equal((await writeA('racy', note('Read first', 'Now page ops-lead@acme.io.'))).blocked.length, 1);
  } } });
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.match(git(bare, 'show', `${TEAM_MEMORY_BRANCH}:${TEAM_NOTES_REL}/racy.md`), /Clean text\./, 'what was planned is what landed');
  const row = (await teamMemoryStatus(keyA)).notes.find((n) => n.name === 'racy');
  assert.equal(row.state, 'blocked', 'the push did not overwrite the newer verdict');
  assert.match(row.reason, /an email address/);
});

test('a rejected push (branch protection) keeps the queue and the reason; the next push after the fix lands', { skip }, async () => {
  rejectAllPushes(bare, 'protected branch hook declined');
  await writeA('release-steps', note('Read before a release', 'Tag from main only.'));
  await writeA('late-leak', note('Read first', 'Clean when it was queued.'));
  // Edited before the push without a new queue call (another process, say): the push-time gate settles it.
  await writeMemory(memoryRoot(), projectScope(keyA), 'late-leak', note('Read first', 'Then: page ops-lead@acme.io.'), { source: 'user', now: NOW });
  const r = await flushTeamMemory(keyA, noSleep);
  assert.equal(r.code, 'PUSH_REJECTED');
  assert.match(r.hint, /exempt `worca-memory`/);
  const st = await teamMemoryStatus(keyA);
  assert.equal(st.notes.find((n) => n.name === 'release-steps').state, 'pending');
  assert.equal(st.notes.find((n) => n.name === 'late-leak').state, 'blocked', 'settled before the push: the failed push does not put it back as pending');
  assert.match(st.remote.lastError, /protected branch hook declined/);
  unlinkSync(join(bare, 'hooks', 'pre-receive'));
  assert.equal((await flushTeamMemory(keyA, noSleep)).ok, true);
  assert.ok(onBranch().includes('release-steps'));
});

test('an opted-out project never runs git; switching on uploads nothing that existed; a global note never leaves', { skip }, async () => {
  const bareC = makeOrigin(root, 'billing');
  const dirC = cloneAs(root, 'machineA', bareC, 'billing');
  const keyC = (await addProject({ name: 'billing', path: dirC })).find((p) => p.name === 'billing').key;
  const calls = [];
  metricsTesting.setGit(async (cwd, args, opts) => { calls.push(cwd); return metricsTesting.defaultGit(cwd, args, opts); });
  await writeMemory(memoryRoot(), projectScope(keyC), 'old-note', note('Existed before', 'Written while off.'), { source: 'user', now: NOW });
  assert.deepEqual(await queueTeamChanges(keyC, ['old-note']), { queued: [], blocked: [], skipped: 'disabled' });
  assert.equal((await flushTeamMemory(keyC, noSleep)).skipped, 'disabled');
  assert.equal(await refreshTeamLayer(keyC, { maxAgeMs: 0 }), null);
  assert.deepEqual(calls.filter((c) => c.startsWith(dirC) || c.includes(keyC)), [], 'not one git call for an opted-out project');
  writeProjectSettings({ projectDir: dirC }, { 'memory.team': true });
  await teamMemorySettingChanged(keyC, dirC);
  assert.equal((await flushTeamMemory(keyC, noSleep)).pushed, 0);
  assert.equal(branchFiles(bareC, TEAM_MEMORY_BRANCH), null, 'switching on shared nothing');
  await writeMemory(memoryRoot(), GLOBAL_SCOPE, 'style', note('Commit style', 'Terse subjects.'), { source: 'user', now: NOW });
  await writeMemory(memoryRoot(), projectScope(keyC), 'old-note', note('Existed before', 'Changed after the switch.'), { source: 'user', now: NOW });
  await queueTeamChanges(keyC, ['old-note'], { flush: false });
  assert.equal((await flushTeamMemory(keyC, noSleep)).ok, true);
  assert.deepEqual(branchFiles(bareC, TEAM_MEMORY_BRANCH).filter((p) => p.startsWith(`${TEAM_NOTES_REL}/`)), [`${TEAM_NOTES_REL}/old-note.md`], 'the changed note only — never the global one');
});

test('switching off drops the queue: nothing queued is pushed later, and no fetch happens', { skip }, async () => {
  await writeA('draft', note('Draft', 'Not ready.'));   // queued, not pushed
  writeProjectSettings({ projectDir: dirA }, { 'memory.team': null });
  await teamMemorySettingChanged(keyA, dirA);
  assert.equal((await flushTeamMemory(keyA, noSleep)).skipped, 'disabled');
  assert.equal(existsSync(join(teamMemoryRoot(), 'projects', keyA)), false);
  assert.equal(await refreshTeamLayer(keyA, { maxAgeMs: 0 }), null);
  writeProjectSettings({ projectDir: dirA }, { 'memory.team': true });   // back on for the next test
  assert.equal((await flushTeamMemory(keyA, noSleep)).pushed, 0, 'the dropped intent stays dropped');
  assert.ok(!onBranch().includes('draft'));
});

test('a flush waiting on the lock when the switch goes off pushes nothing (D1: nothing queued earlier leaks out later)', { skip }, async () => {
  await writeA('in-flight', note('Read first', 'Already on its way.'));
  let waiting = null;
  let offDone = null;
  const r = await flushTeamMemory(keyA, { ...noSleep, hooks: { beforePush: async ({ attempt }) => {
    if (attempt !== 1 || waiting) return;
    await writeA('leak-check', note('Queued before the switch', 'Must never reach the team.'));
    waiting = flushTeamMemory(keyA, noSleep);   // passes the on-check now, then waits for this flush's lock
    writeProjectSettings({ projectDir: dirA }, { 'memory.team': null });
    offDone = teamMemorySettingChanged(keyA, dirA);   // never awaited here: it needs the lock this flush holds
  } } });
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.deepEqual(await waiting, { ok: true, skipped: 'disabled', pushed: 0 });
  await offDone;
  assert.ok(onBranch().includes('in-flight'), 'the push already under way lands');
  assert.ok(!onBranch().includes('leak-check'), 'the waiting flush re-checked the switch');
  writeProjectSettings({ projectDir: dirA }, { 'memory.team': true });   // back on for the next test
});

test('the branch deleted on origin: tracked copies stay while it is missing; the next share starts it again, and they stay then too (untracked)', { skip }, async () => {
  git(bare, 'branch', '-D', TEAM_MEMORY_BRANCH);
  const r = await refreshTeamLayer(keyA, { maxAgeMs: 0 });
  assert.equal(r.snapshot.missing, true);
  assert.deepEqual(r.removed, [], 'a missing branch deletes nothing here');
  assert.ok(await localA('release-steps'));
  // Only a share starts it again (D8): a flush of removals alone has nothing to remove on a missing branch.
  await deleteTeamNote(keyA, 'ghost', { flush: false });
  const d = await flushTeamMemory(keyA, noSleep);
  assert.deepEqual([d.ok, d.pushed], [true, 0], JSON.stringify(d));
  assert.equal(branchFiles(bare, TEAM_MEMORY_BRANCH), null, 'a removal never starts the branch');
  assert.deepEqual([...(await _testing.queuedNames(keyA))], [], 'settled: there was nothing to remove');
  await writeA('restart', note('Read after a crash', 'Delete the stale lock first.'));
  assert.equal((await flushTeamMemory(keyA, noSleep)).ok, true);
  assert.deepEqual(onBranch(), ['restart'], 'a fresh orphan carrying the new note');
  // No commit on the new branch removed them: nobody deleted them (D3 follows a deletion, never mere absence).
  const kept = await localA('release-steps');
  assert.ok(kept, 'not removed when the branch started again');
  assert.equal(kept.meta.extra[TEAM_MARKER_KEY], undefined, 'untracked: a plain local note again (an edit shares it)');
  assert.deepEqual((await refreshTeamLayer(keyA, { maxAgeMs: 0 })).removed, [], 'a later refresh removes nothing either');
  assert.equal((await teamMemoryStatus(keyA)).notes.find((n) => n.name === 'release-steps').state, 'local');
});

test('a team delete while the note\'s FIRST share is being pushed: the share lands, then the delete — and the local copy stays (D12)', { skip }, async () => {
  await writeA('second-thoughts', note('Read first', 'Shared, then removed from the team at once.'));
  const r = await flushTeamMemory(keyA, { ...noSleep, hooks: { beforePush: async ({ attempt }) => {
    if (attempt === 1) await deleteTeamNote(keyA, 'second-thoughts', { flush: false });
  } } });
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.ok(onBranch().includes('second-thoughts'), 'the share already under way landed');
  assert.equal((await localA('second-thoughts')).meta.extra[TEAM_MARKER_KEY], undefined, 'never tracked: the team delete was queued meanwhile');
  assert.equal((await flushTeamMemory(keyA, noSleep)).ok, true);
  assert.ok(!onBranch().includes('second-thoughts'), 'then the team delete');
  await refreshTeamLayer(keyA, { maxAgeMs: 0 });
  assert.match((await localA('second-thoughts')).body, /removed from the team at once/, 'the local copy stays, a plain local note');
  assert.equal((await teamMemoryStatus(keyA)).notes.find((n) => n.name === 'second-thoughts').state, 'local');
});

test('a local deletion after a team delete that could not be pushed: the team delete still goes once the push works', { skip }, async () => {
  await writeA('retired', note('Read before X', 'Soon removed from the team.'));
  assert.equal((await flushTeamMemory(keyA, noSleep)).ok, true);
  rejectAllPushes(bare, 'protected branch hook declined');
  await deleteTeamNote(keyA, 'retired', { flush: false });
  assert.equal((await flushTeamMemory(keyA, noSleep)).code, 'PUSH_REJECTED');
  await removeMemory(memoryRoot(), projectScope(keyA), 'retired', { source: 'user' });
  assert.deepEqual((await queueTeamChanges(keyA, ['retired'], { flush: false })).queued, [], 'nothing new to queue: the team delete is still queued');
  unlinkSync(join(bare, 'hooks', 'pre-receive'));
  assert.equal((await flushTeamMemory(keyA, noSleep)).ok, true);
  assert.ok(!onBranch().includes('retired'), 'removed from the team');
});

test('a note that differs from a team note only in case replaces it: one file per name on the branch (a macOS or Windows checkout cannot hold both)', { skip }, async () => {
  const b = await child({ op: 'write', dir: dirB, note: 'Release-Train', text: note('Read before a release', 'B: the train leaves on Tuesdays.') });
  assert.equal(b.ok, true, JSON.stringify(b));
  await writeA('release-train', note('Read before a release', 'A: the train leaves on Thursdays.'));
  const r = await flushTeamMemory(keyA, noSleep);
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.deepEqual(onBranch().filter((n) => n.toLowerCase() === 'release-train'), ['release-train'], 'last write wins across case');
  assert.match(git(bare, 'show', `${TEAM_MEMORY_BRANCH}:${TEAM_NOTES_REL}/release-train.md`), /Thursdays/);
  assert.equal((await teamMemoryStatus(keyA)).notes.find((n) => n.name === 'release-train').state, 'shared');
  const j = await child({ op: 'refresh', dir: dirB });
  assert.deepEqual(j.removed, ['Release-Train'], 'B\'s unedited copy followed the team (its name is gone from the branch)');
  assert.equal((await child({ op: 'local', dir: dirB }))['Release-Train'], undefined);
  assert.match(j.snapshot.notes['release-train'].text, /Thursdays/, 'and A\'s note loads on B as a team note');
});

test('a team delete never costs the local copy, even when something marked it tracked again before the push', { skip }, async () => {
  await writeA('remarked', note('Read first', 'Shared, then removed from the team.'));
  assert.equal((await flushTeamMemory(keyA, noSleep)).ok, true);
  await deleteTeamNote(keyA, 'remarked', { flush: false });
  // Another process (a follow, an adoption) marks the copy tracked again before the delete is pushed.
  const f = await localA('remarked');
  await setMemoryExtra(memoryRoot(), projectScope(keyA), 'remarked', TEAM_MARKER_KEY, contentHash({ ...f.meta, name: 'remarked' }, f.body));
  assert.equal((await flushTeamMemory(keyA, noSleep)).ok, true);
  assert.ok(!onBranch().includes('remarked'));
  await refreshTeamLayer(keyA, { maxAgeMs: 0 });
  const kept = await localA('remarked');
  assert.ok(kept, 'the local copy stays');
  assert.equal(kept.meta.extra[TEAM_MARKER_KEY], undefined, 'as a plain local note');
});

test('offline: a failed fetch is not retried by every caller within the fetch TTL; an explicit refresh retries', { skip }, async () => {
  const snap = await readTeamSnapshot(keyA);
  _testing.writeSnapshot(keyA, { ...snap, fetchedAt: new Date(Date.now() - 3_600_000).toISOString() });   // a stale snapshot
  const url = git(dirA, 'remote', 'get-url', 'origin');
  git(dirA, 'remote', 'set-url', 'origin', join(root, 'nowhere.git'));
  try {
    const failed = await refreshTeamLayer(keyA, { maxAgeMs: 0 });
    assert.equal(failed.fetched, false, 'explicit: tried, failed, the last snapshot serves');
    assert.ok(failed.error, 'and the caller is told why (the run log, `worca memory team on`)');
    let fetches = 0;
    metricsTesting.setGit(async (cwd, args, opts) => { if (args[0] === 'fetch') fetches++; return metricsTesting.defaultGit(cwd, args, opts); });
    await Promise.all([refreshTeamLayer(keyA), refreshTeamLayer(keyA), refreshTeamLayer(keyA)]);
    assert.equal(fetches, 0, 'within the TTL after a failed fetch, nobody fetches again');
  } finally {
    git(dirA, 'remote', 'set-url', 'origin', url);
    metricsTesting.reset();
  }
  assert.equal((await refreshTeamLayer(keyA, { maxAgeMs: 0 })).fetched, true, 'online again: an explicit refresh fetches');
});

test('a directory hand-pushed at a note\'s path never stalls the flushes behind it: the removal takes it out', { skip }, async () => {
  const hand = cloneAs(root, 'machineH', bare, 'shop');
  git(hand, 'checkout', '-q', TEAM_MEMORY_BRANCH);
  mkdirSync(join(hand, '.worca-memory', 'notes', 'dir-note.md'), { recursive: true });
  writeFileSync(join(hand, '.worca-memory', 'notes', 'dir-note.md', 'x'), 'not a note');
  git(hand, 'add', '.');
  git(hand, 'commit', '-q', '-m', 'a hand push');
  git(hand, 'push', '-q', 'origin', TEAM_MEMORY_BRANCH);
  await deleteTeamNote(keyA, 'dir-note', { flush: false });
  await writeA('behind-it', note('Read after', 'Queued behind the removal.'));
  const r = await flushTeamMemory(keyA, noSleep);
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.deepEqual(branchFiles(bare, TEAM_MEMORY_BRANCH).filter((p) => p.includes('dir-note')), [], 'the directory is gone');
  assert.ok(onBranch().includes('behind-it'));
});

test('case twins hand-pushed to the branch never stall a flush that stages nothing, and neither spelling is followed (m3)', { skip }, async () => {
  const hand = cloneAs(root, 'machineT', bare, 'shop');
  git(hand, 'checkout', '-q', TEAM_MEMORY_BRANCH);
  // Both spellings straight into the index: a macOS or Windows checkout could never hold the two files.
  for (const name of ['Twin', 'twin']) {
    const sha = spawnSyncOut(hand, ['hash-object', '-w', '--stdin'], `---\nname: ${name}\ndescription: ${name}\n---\n${name} body\n`);
    git(hand, 'update-index', '--add', '--cacheinfo', `100644,${sha},${TEAM_NOTES_REL}/${name}.md`);
  }
  git(hand, 'commit', '-q', '-m', 'twins by hand');
  git(hand, 'push', '-q', 'origin', TEAM_MEMORY_BRANCH);
  try {
    await deleteTeamNote(keyA, 'never-shared', { flush: false });   // a removal the branch never held: nothing to stage
    const r = await flushTeamMemory(keyA, noSleep);
    assert.equal(r.ok, true, JSON.stringify(r));
    const snap = (await refreshTeamLayer(keyA, { maxAgeMs: 0 })).snapshot;
    assert.deepEqual(Object.keys(snap.notes).filter((n) => n.toLowerCase() === 'twin'), [], 'skipped until one of them is removed');
  } finally {
    git(hand, 'rm', '-q', '--cached', `${TEAM_NOTES_REL}/Twin.md`, `${TEAM_NOTES_REL}/twin.md`);
    git(hand, 'commit', '-q', '-m', 'twins removed');
    git(hand, 'push', '-q', 'origin', TEAM_MEMORY_BRANCH);
  }
});

test('a host refusal that names no note: the batch is pushed by halves, the refused note is blocked (rule remote), the rest lands (m4, D5)', { skip }, async () => {
  // A pre-receive policy that rejects one note's content and names only the commit, never a path.
  writeFileSync(join(bare, 'hooks', 'pre-receive'), '#!/bin/sh\nwhile read old new ref; do\n  if git grep -q FORBIDDEN "$new" -- .worca-memory/notes/ 2>/dev/null; then echo "policy: commit $new rejected" >&2; exit 1; fi\ndone\nexit 0\n', { mode: 0o755 });
  try {
    for (const n of ['bis-a', 'bis-b', 'bis-c', 'bis-d']) await writeA(n, note(`About ${n}`, `${n} is fine.`));
    await writeA('bis-bad', note('About bis-bad', 'This one is FORBIDDEN by the host.'));
    const r = await flushTeamMemory(keyA, noSleep);
    assert.equal(r.code, 'PUSH_REJECTED', JSON.stringify(r));
    for (const n of ['bis-a', 'bis-b', 'bis-c', 'bis-d']) assert.ok(onBranch().includes(n), `${n} landed`);
    assert.ok(!onBranch().includes('bis-bad'));
    const row = (await teamMemoryStatus(keyA)).notes.find((n) => n.name === 'bis-bad');
    assert.equal(row.state, 'blocked');
    assert.deepEqual(row.findings.map((f) => f.rule), ['remote']);
    assert.equal((await flushTeamMemory(keyA, noSleep)).pushed, 0, 'never retried as it is');
    // A refusal of every push (branch protection) pins no note: the whole batch waits, every note pending.
    rejectAllPushes(bare, 'protected branch hook declined');
    for (const n of ['bis-e', 'bis-f']) await writeA(n, note(`About ${n}`, `${n} is fine.`));
    assert.equal((await flushTeamMemory(keyA, noSleep)).code, 'PUSH_REJECTED');
    const st = await teamMemoryStatus(keyA);
    assert.deepEqual(['bis-e', 'bis-f'].map((n) => st.notes.find((x) => x.name === n).state), ['pending', 'pending']);
  } finally { unlinkSync(join(bare, 'hooks', 'pre-receive')); }
  assert.equal((await flushTeamMemory(keyA, noSleep)).ok, true);
});
