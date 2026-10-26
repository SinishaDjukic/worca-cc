// test/memory-team-lifecycle.test.mjs — team memory (phase 1a), the lifecycle edges across TWO machines (A = this
// process, B = fixtures/team-memory/machine-child.mjs with its own WORCA_HOME; one bare origin of their own): a former
// team copy re-saved unchanged or brought back by an undo, a switch-off during a push, a rewritten branch, a version
// too big to read, a push the host refuses for one note, and the undo / defragment / failed-push interleavings.
import { test, before, after, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync, chmodSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { useGitSandbox, makeOrigin, cloneAs, git, branchFiles, rejectAllPushes } from './helpers/metrics-git.mjs';
import { useTempHome } from './helpers/temp-home.mjs';
import { gateRead, gateRename, patchFs, afterRenameSyncOnce } from './helpers/fs-gate.mjs';
import { addProject } from '../src/core/projects.mjs';
import { writeProjectSettings } from '../src/core/settings-cascade.mjs';
import { memoryRoot, projectScope, writeMemory, readMemory, removeMemory, listMemory, listSnapshots, restoreSnapshot } from '../src/core/memory-store.mjs';
import { defaultMemoryDeps } from '../src/core/ask/memory-deps.mjs';
import { mountDirs, mountMemory, syncBack, withStoreLock } from '../src/core/memory-sync.mjs';
import { memoryCaps } from '../src/core/settings.mjs';
import { _testing as metricsTesting } from '../src/core/metrics/sync.mjs';
import {
  queueTeamChanges, flushTeamMemory, refreshTeamLayer, teamMemoryStatus, teamMemorySettingChanged, deleteTeamNote, readTeamSnapshot,
  switchTeamMemoryOn, teamClientText, teamChangesFromSync, changedNoteNames, TEAM_MEMORY_BRANCH, TEAM_NOTES_REL, TEAM_MARKER_KEY, _testing,
} from '../src/core/memory-team.mjs';

const skip = process.platform === 'win32' ? 'sh not portable to win32' : false;
const CHILD = resolve(dirname(fileURLToPath(import.meta.url)), 'fixtures/team-memory/machine-child.mjs');
const root = mkdtempSync(join(tmpdir(), 'worca-team-life-'));
const homeB = mkdtempSync(join(tmpdir(), 'worca-home-life-b-'));
useGitSandbox(before, after);
useTempHome(after);
after(() => { rmSync(root, { recursive: true, force: true }); rmSync(homeB, { recursive: true, force: true }); });
afterEach(() => { _testing.reset(); metricsTesting.reset(); });

const NOW = '2026-10-16T10:00:00.000Z';
const LATER = '2026-10-17T10:00:00.000Z';
const noSleep = { sleep: async () => {} };
const note = (description, body) => `---\nname: x\ndescription: ${description}\n---\n${body}\n`;
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
const showOnBranch = (name) => git(bare, 'show', `${TEAM_MEMORY_BRANCH}:${TEAM_NOTES_REL}/${name}.md`);
const writeA = async (name, text, now = NOW) => { await writeMemory(memoryRoot(), projectScope(keyA), name, text, { source: 'user', now }); return queueTeamChanges(keyA, [name], { flush: false }); };
const resaveA = async (name) => { const f = await localA(name); return writeA(name, f.text, LATER); };   // same content, a new `updated`
const localA = (name) => readMemory(memoryRoot(), projectScope(keyA), name);
const rowA = async (name) => (await teamMemoryStatus(keyA)).notes.find((n) => n.name === name);
const LEAK = 'Now page ops-lead@acme.io.';   // the gate blocks it (an email address)

before(async () => {
  bare = makeOrigin(root, 'shop');
  dirA = cloneAs(root, 'machineA', bare, 'shop');
  keyA = (await addProject({ name: 'shop', path: dirA })).find((p) => p.name === 'shop').key;
  writeProjectSettings({ projectDir: dirA }, { 'memory.team': true });
  await writeA('seed', note('Seed', 'Starts the branch.'));
  assert.equal((await flushTeamMemory(keyA, noSleep)).ok, true);
  dirB = cloneAs(root, 'machineB', bare, 'shop');
  await child({ op: 'join', name: 'shop', dir: dirB });
});

test('after a team delete lands, an UNCHANGED re-save of the kept local copy does not put the note back on the team (D12)', { skip }, async () => {
  await writeA('retire-me', note('Read first', 'Removed from the team, kept here.'));
  assert.equal((await flushTeamMemory(keyA, noSleep)).ok, true);
  await deleteTeamNote(keyA, 'retire-me', { flush: false });
  assert.equal((await flushTeamMemory(keyA, noSleep)).ok, true);
  assert.ok(!onBranch().includes('retire-me'), 'the team delete landed');
  await refreshTeamLayer(keyA, { maxAgeMs: 0 });
  // A Memory-page Save without a change, or an Ask remember of the same text.
  const q = await resaveA('retire-me');
  assert.equal((await flushTeamMemory(keyA, noSleep)).ok, true);
  const b = await child({ op: 'refresh', dir: dirB });
  assert.deepEqual(q.queued, [], 'an unchanged re-save is no change');
  assert.ok(!onBranch().includes('retire-me'), 'the team delete stays');
  assert.equal(b.snapshot.notes['retire-me'], undefined, 'and the note does not come back to teammates');
});

test('a copy untracked because the team version is over this machine\'s cap: an unchanged re-save does not revert the teammate\'s newer version (D13)', { skip }, async () => {
  await writeA('big-note', note('Read before X', 'Small version from A.'));
  assert.equal((await flushTeamMemory(keyA, noSleep)).ok, true);
  // B (a larger memory.maxBytesPerFile) grows the note past A's 32 KiB cap.
  const big = note('Read before X', `B's long version.\n${'detail line\n'.repeat(3500)}`);
  assert.equal((await child({ op: 'write', dir: dirB, note: 'big-note', text: big })).ok, true);
  const warn = console.warn; console.warn = () => {};
  try { await refreshTeamLayer(keyA, { maxAgeMs: 0 }); } finally { console.warn = warn; }
  assert.equal((await localA('big-note')).meta.extra[TEAM_MARKER_KEY], undefined, 'untracked once (v6)');
  const q = await resaveA('big-note');
  assert.equal((await flushTeamMemory(keyA, noSleep)).ok, true);
  assert.deepEqual(q.queued, [], 'an unchanged re-save of a former team copy is no change');
  assert.match(showOnBranch('big-note'), /B's long version/, 'the teammate\'s newer version stays on the team');
});

test('switched off while a push is under way: the push lands, but its follow does not delete local notes afterwards (D1)', { skip }, async () => {
  await writeA('kept-off', note('Read first', 'Tracked here, removed by B.'));
  assert.equal((await flushTeamMemory(keyA, noSleep)).ok, true);
  assert.equal((await child({ op: 'teamdelete', dir: dirB, note: 'kept-off' })).ok, true);
  assert.ok(!onBranch().includes('kept-off'));
  await writeA('during-off', note('Read first', 'Pushed while the switch goes off.'));
  let offDone = null;
  const r = await flushTeamMemory(keyA, { ...noSleep, hooks: { beforePush: async ({ attempt }) => {
    if (attempt !== 1) return;
    writeProjectSettings({ projectDir: dirA }, { 'memory.team': null });
    offDone = teamMemorySettingChanged(keyA, dirA);
  } } });
  await offDone;
  writeProjectSettings({ projectDir: dirA }, { 'memory.team': true });   // back on for the next tests
  assert.equal(r.ok, true);
  assert.ok(onBranch().includes('during-off'), 'the push under way landed');
  assert.ok(await localA('kept-off'), 'switched off: nothing is followed any more — the local note stays');
});

test('the branch rewritten (force-pushed back to an older commit): a tracked copy absent from it is untracked and kept, even when an OLD commit once deleted that name (D3)', { skip }, async () => {
  await writeA('phoenix', note('Read first', 'First life.'));
  assert.equal((await flushTeamMemory(keyA, noSleep)).ok, true);
  assert.equal((await child({ op: 'teamdelete', dir: dirB, note: 'phoenix' })).ok, true);   // commit D removes it
  const afterDelete = git(bare, 'rev-parse', TEAM_MEMORY_BRANCH);
  await refreshTeamLayer(keyA, { maxAgeMs: 0 });                  // A's copy follows that deletion (correct)
  assert.equal(await localA('phoenix'), null);
  await writeA('phoenix', note('Read first', 'Second life, written after the deletion.'));
  assert.equal((await flushTeamMemory(keyA, noSleep)).ok, true);   // re-added; A tracks it
  assert.ok((await localA('phoenix')).meta.extra[TEAM_MARKER_KEY]);
  git(bare, 'update-ref', `refs/heads/${TEAM_MEMORY_BRANCH}`, afterDelete);   // a teammate force-pushes the branch back
  const r = await refreshTeamLayer(keyA, { maxAgeMs: 0 });
  assert.deepEqual(r.removed, [], 'nobody deleted the second life');
  const kept = await localA('phoenix');
  assert.ok(kept, 'kept');
  assert.match(kept.body, /Second life/);
});

test('a teammate\'s version this machine cannot read (over the 256 KiB reader cap) is no deletion, even when an old commit once deleted that name (D3)', { skip }, async () => {
  await writeA('cycle', note('Read first', 'First life.'));
  assert.equal((await flushTeamMemory(keyA, noSleep)).ok, true);
  assert.equal((await child({ op: 'teamdelete', dir: dirB, note: 'cycle' })).ok, true);
  await refreshTeamLayer(keyA, { maxAgeMs: 0 });
  await writeA('cycle', note('Read first', 'Second life.'));
  assert.equal((await flushTeamMemory(keyA, noSleep)).ok, true);   // re-added; A tracks it
  // B (a very large memory.maxBytesPerFile) updates it to 300 KiB: on the branch, but past A's reader cap.
  const huge = note('Read first', `B's huge version.\n${'x'.repeat(300 * 1024)}`);
  assert.equal((await child({ op: 'write', dir: dirB, note: 'cycle', text: huge })).ok, true);
  assert.ok(onBranch().includes('cycle'), 'the note is on the branch');
  const r = await refreshTeamLayer(keyA, { maxAgeMs: 0 });
  assert.deepEqual(r.removed, [], 'updated, not deleted: the local copy is never removed');
  assert.ok(await localA('cycle'));
});

// GitHub push protection (secret scanning) answers a push that adds a token it knows with GH013 and the note's path.
function installPushProtection(repo) {
  const hook = join(repo, 'hooks', 'pre-receive');
  mkdirSync(dirname(hook), { recursive: true });
  writeFileSync(hook, [
    '#!/bin/sh',
    'while read old new ref; do',
    `  hits=$(git grep -n -I -E -e 'hvk_[0-9a-f]{32}' "$new" -- ${TEAM_NOTES_REL} 2>/dev/null)`,
    '  if [ -n "$hits" ]; then',
    '    echo "error: GH013: Repository rule violations found for $ref." >&2',
    '    echo "- GITHUB PUSH PROTECTION" >&2',
    '    echo "    - Push cannot contain secrets" >&2',
    '    echo "      -- Voice Provider API Key --" >&2',
    '    echo "       locations:" >&2',
    '    echo "$hits" | while IFS= read -r h; do p=$(echo "$h" | cut -d: -f2); l=$(echo "$h" | cut -d: -f3); echo "         - commit: $new" >&2; echo "           path: $p:$l" >&2; done',
    '    exit 1',
    '  fi',
    'done',
    'exit 0',
  ].join('\n'));
  chmodSync(hook, 0o755);
  return hook;
}

test('a push the host refuses for ONE note (GitHub push protection, GH013) does not stall every other note: that note is blocked, the rest lands (D5)', { skip }, async () => {
  const hook = installPushProtection(bare);
  try {
    // A provider key shape the gate does not know (a made-up `hvk_…`): only the host's scanner catches it.
    const key = `hvk_${'0123456789abcdef'.repeat(2)}`;   // built at run time: no key-shaped literal sits in the repo
    assert.deepEqual((await writeA('shop-admin', note('Read before touching the IVR', `The IVR calls the voice provider with ${key} for the voice job.`))).queued, ['shop-admin']);
    await writeA('innocent', note('Read first', 'Nothing secret here.'));
    const r1 = await flushTeamMemory(keyA, noSleep);
    const r2 = await flushTeamMemory(keyA, noSleep);   // the next flush: a later queue, the 30-min tick
    assert.ok(onBranch().includes('innocent'), `the clean note lands (flushes: ${r1.code || 'ok'}, ${r2.code || 'ok'})`);
    assert.ok(!onBranch().includes('shop-admin'), 'the refused note never lands');
    const row = await rowA('shop-admin');
    assert.equal(row.state, 'blocked', 'the refused note is blocked with the host\'s reason, not retried forever');
    assert.doesNotMatch(JSON.stringify(row), /hvk_0123/, 'the record never repeats the value');
    // A refused edit that carries a team delete: the edit stays here, blocked — the delete under it still goes (D12).
    await writeA('retired-ivr', note('Read before X', 'Old IVR notes.'));
    assert.equal((await flushTeamMemory(keyA, noSleep)).ok, true);
    await deleteTeamNote(keyA, 'retired-ivr', { flush: false });
    await writeA('retired-ivr', note('Read before X', `Now with ${key}.`));
    assert.equal((await flushTeamMemory(keyA, noSleep)).ok, true);
    assert.ok(!onBranch().includes('retired-ivr'), 'removed from the team as the user asked');
    assert.equal((await rowA('retired-ivr')).state, 'blocked');
  } finally { rmSync(hook, { force: true }); }
});

test('switched off while the host refuses a push: the retry with the other notes never goes out (D1)', { skip }, async () => {
  const hook = installPushProtection(bare);
  try {
    const key = `hvk_${'fedcba9876543210'.repeat(2)}`;   // built at run time, like the test above
    await writeA('refused-off', note('Read first', `The IVR calls the voice provider with ${key}.`));
    await writeA('clean-off', note('Read first', 'It would go out in the retry.'));
    const r = await flushTeamMemory(keyA, { ...noSleep, hooks: { beforePush: async () => { writeProjectSettings({ projectDir: dirA }, { 'memory.team': null }); } } });
    assert.equal(r.ok, false, JSON.stringify(r));
    assert.ok(!onBranch().includes('clean-off'), 'nothing queued earlier is pushed after the switch-off');
    await teamMemorySettingChanged(keyA, dirA);   // the switch-off's discard
  } finally {
    rmSync(hook, { force: true });
    writeProjectSettings({ projectDir: dirA }, { 'memory.team': true });   // back on for the next tests
  }
});

test('an edit undone while it is being pushed: once that push lands the undo is shared after it, never followed back (last write wins)', { skip }, async () => {
  const scope = projectScope(keyA);
  await writeA('rev', note('Read first', 'Version one.'));
  assert.equal((await flushTeamMemory(keyA, noSleep)).ok, true);
  const v1 = await localA('rev');   // what the Memory page editor shows (Ask remember keeps it too): the `team:` line included
  await writeMemory(memoryRoot(), scope, 'rev', v1.text.replace('Version one.', 'Version two.'), { source: 'user', now: NOW });
  assert.deepEqual((await queueTeamChanges(keyA, ['rev'], { flush: false })).queued, ['rev']);
  const r = await flushTeamMemory(keyA, { ...noSleep, hooks: { beforePush: async ({ attempt }) => {
    if (attempt !== 1) return;
    await writeMemory(memoryRoot(), scope, 'rev', v1.text, { source: 'user', now: NOW });   // undone while v2 is pushed
    assert.deepEqual((await queueTeamChanges(keyA, ['rev'], { flush: false })).queued, [], 'unchanged since its sync: nothing yet');
  } } });
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.match(showOnBranch('rev'), /Version two\./, 'the push under way landed');
  assert.equal((await rowA('rev')).state, 'pending', 'and the undo is queued after it');
  assert.equal((await flushTeamMemory(keyA, noSleep)).ok, true);
  assert.match(showOnBranch('rev'), /Version one\./);
  await refreshTeamLayer(keyA, { maxAgeMs: 0 });
  assert.match((await localA('rev')).body, /Version one\./, 'the local copy keeps the undo');
});

test('an edit undone during a push that FAILS pushes nothing later: a teammate\'s newer version stays (D13)', { skip }, async () => {
  const scope = projectScope(keyA);
  await writeA('rev2', note('Read first', 'One.'));
  assert.equal((await flushTeamMemory(keyA, noSleep)).ok, true);
  const v1 = await localA('rev2');
  await writeMemory(memoryRoot(), scope, 'rev2', v1.text.replace('One.', 'Two.'), { source: 'user', now: NOW });
  await queueTeamChanges(keyA, ['rev2'], { flush: false });
  const r = await flushTeamMemory(keyA, { ...noSleep, hooks: { beforePush: async ({ attempt }) => {
    if (attempt !== 1) return;
    await writeMemory(memoryRoot(), scope, 'rev2', v1.text, { source: 'user', now: NOW });   // undone while Two is pushed…
    await queueTeamChanges(keyA, ['rev2'], { flush: false });
    rejectAllPushes(bare, 'protected branch hook declined');                                  // …and that push fails
  } } });
  assert.equal(r.code, 'PUSH_REJECTED');
  unlinkSync(join(bare, 'hooks', 'pre-receive'));
  assert.equal((await child({ op: 'write', dir: dirB, note: 'rev2', text: note('Read first', 'Three, from B.') })).ok, true);
  assert.equal((await flushTeamMemory(keyA, noSleep)).ok, true);
  assert.match(showOnBranch('rev2'), /Three, from B\./, 'A\'s unedited copy is never pushed over the teammate');
});

test('a note deleted while its FIRST share is pushed leaves the team even when that push finishes during its queue call', { skip }, async () => {
  await writeA('first', note('Read first', 'Shared once, deleted at once.'));
  let q; let g;
  const r = await flushTeamMemory(keyA, { ...noSleep, hooks: { beforePush: async ({ attempt }) => {
    if (attempt !== 1) return;
    await removeMemory(memoryRoot(), projectScope(keyA), 'first', { source: 'user' });
    g = gateRead((p) => p.includes(keyA) && p.endsWith(join('inflight', 'first.json')));
    q = queueTeamChanges(keyA, ['first'], { flush: false });   // reads the record (no sharedHash yet)…
    await g.atGate;                                              // …then stalls (a busy event loop)
  } } });
  assert.equal(r.ok, true, JSON.stringify(r));                  // landed: finishFlush recorded sharedHash, released the claim
  g.release();
  await q;
  g.restore();
  assert.equal((await flushTeamMemory(keyA, noSleep)).ok, true);
  assert.ok(!onBranch().includes('first'), 'the local deletion reaches the team');
  assert.equal(await rowA('first'), undefined, 'and this machine\'s own deleted note never comes back as a teammate\'s');
});

test('a note or a claim that cannot be READ once (EMFILE, EBUSY) is retried, never taken as a deletion or as a share', { skip }, async () => {
  await writeA('busy', note('Read first', 'v1'));
  assert.equal((await flushTeamMemory(keyA, noSleep)).ok, true);
  await writeA('busy', note('Read first', 'v2'));
  const failOnce = (suffix) => { let armed = true; return patchFs('readFile', (orig) => async (p, ...a) => {
    if (armed && typeof p === 'string' && p.endsWith(suffix)) { armed = false; throw Object.assign(new Error('EMFILE: too many open files'), { code: 'EMFILE' }); }
    return orig(p, ...a);
  }); };
  let restore = failOnce(join('projects', keyA, 'busy.md'));
  try { await flushTeamMemory(keyA, noSleep); } finally { restore(); }
  assert.ok(onBranch().includes('busy'), 'not removed from the team by a transient read error');
  assert.equal((await flushTeamMemory(keyA, noSleep)).ok, true);
  assert.match(showOnBranch('busy'), /v2/, 'the next flush pushes the edit');
  await writeA('retire', note('Read first', 'To be removed from the team.'));
  assert.equal((await flushTeamMemory(keyA, noSleep)).ok, true);
  await deleteTeamNote(keyA, 'retire', { flush: false });
  restore = failOnce(join('inflight', 'retire.json'));
  try { await flushTeamMemory(keyA, noSleep); } finally { restore(); }
  await flushTeamMemory(keyA, noSleep);
  assert.ok(!onBranch().includes('retire'), 'the team delete still goes, never turned into a share');
  assert.equal((await localA('retire')).meta.extra[TEAM_MARKER_KEY], undefined, 'and the local copy stays a plain local note');
});

test('an edit the gate blocked, then undone, never brings back a note this machine removed from the team (D12)', { skip }, async () => {
  const orig = note('Read first', 'Removed from the team, kept here.');
  await writeA('retire-me-2', orig);
  assert.equal((await flushTeamMemory(keyA, noSleep)).ok, true);
  await deleteTeamNote(keyA, 'retire-me-2', { flush: false });
  assert.equal((await flushTeamMemory(keyA, noSleep)).ok, true);
  assert.equal((await writeA('retire-me-2', note('Read first', `Removed from the team, kept here.\n${LEAK}`))).blocked.length, 1, 'an agent adds an email: blocked');
  const q = await writeA('retire-me-2', orig);                       // the user takes it out again: the kept content
  assert.equal((await flushTeamMemory(keyA, noSleep)).ok, true);
  assert.deepEqual(q.queued, [], 'the kept content again is no change');
  assert.ok(!onBranch().includes('retire-me-2'), 'the user\'s own team delete stays');
});

test('a copy untracked because the team version is over this machine\'s cap: a blocked edit undone never reverts the teammate\'s newer version (D13)', { skip }, async () => {
  const small = note('Read before X', 'Small version from A.');
  await writeA('big-note-2', small);
  assert.equal((await flushTeamMemory(keyA, noSleep)).ok, true);
  const big = note('Read before X', `B's long version.\n${'detail line\n'.repeat(3500)}`);
  assert.equal((await child({ op: 'write', dir: dirB, note: 'big-note-2', text: big })).ok, true);
  const warn = console.warn; console.warn = () => {};
  try { await refreshTeamLayer(keyA, { maxAgeMs: 0 }); } finally { console.warn = warn; }
  assert.equal((await writeA('big-note-2', note('Read before X', `Small version from A.\n${LEAK}`))).blocked.length, 1);
  assert.deepEqual((await writeA('big-note-2', small)).queued, [], 'back to the kept content: no change');
  assert.equal((await flushTeamMemory(keyA, noSleep)).ok, true);
  assert.match(showOnBranch('big-note-2'), /B's long version/);
});

for (const [name, edit] of [['td-undo', note('Read first', 'An edit, soon undone.')], ['td-undo-blocked', note('Read first', `Shared once.\n${LEAK}`)]]) {
  test(`a team delete that could not be pushed survives an edit on top that is undone before it is shared (${name}, D12)`, { skip }, async () => {
    const orig = note('Read first', 'Shared once.');
    await writeA(name, orig);
    assert.equal((await flushTeamMemory(keyA, noSleep)).ok, true);
    rejectAllPushes(bare, 'protected branch hook declined');           // the team delete waits
    await deleteTeamNote(keyA, name, { flush: false });
    assert.equal((await flushTeamMemory(keyA, noSleep)).code, 'PUSH_REJECTED');
    await writeA(name, edit);                                            // clean: it carries the delete; blocked: the delete stays
    await writeA(name, orig);                                            // undone: the content the team delete removes
    unlinkSync(join(bare, 'hooks', 'pre-receive'));
    assert.equal((await flushTeamMemory(keyA, noSleep)).ok, true);
    assert.ok(!onBranch().includes(name), 'the team delete the user asked for still goes');
  });
}

test('a restore that only undoes a blocked edit never puts back a note this machine removed from the team (D12, D13)', { skip }, async () => {
  const orig = note('Read first', 'Kept here after a team delete.');
  await writeA('restored-kept', orig);
  assert.equal((await flushTeamMemory(keyA, noSleep)).ok, true);
  await deleteTeamNote(keyA, 'restored-kept', { flush: false });
  assert.equal((await flushTeamMemory(keyA, noSleep)).ok, true);
  assert.equal((await writeA('restored-kept', note('Read first', `Kept here after a team delete.\n${LEAK}`))).blocked.length, 1);
  // A Memory-page restore of the snapshot taken right before that edit: the route queues what changed with `restore`.
  await writeMemory(memoryRoot(), projectScope(keyA), 'restored-kept', orig, { source: 'user', now: NOW });
  assert.deepEqual((await queueTeamChanges(keyA, ['restored-kept'], { restore: true, flush: false })).queued, [], 'back to its kept content: no change');
  assert.equal((await flushTeamMemory(keyA, noSleep)).ok, true);
  assert.ok(!onBranch().includes('restored-kept'), 'the team delete the user made stays');
  assert.equal((await rowA('restored-kept')).state, 'local');
});

for (const [name, last] of [['carry-del', 'deleted'], ['carry-blk', 'blocked']]) {
  test(`a team delete carried by an edit whose push FAILS while a newer edit waits is not lost; a later ${last} edit leaves it queued (D12)`, { skip }, async () => {
    await writeA(name, note('Read first', 'Shared once.'));
    assert.equal((await flushTeamMemory(keyA, noSleep)).ok, true);
    await deleteTeamNote(keyA, name, { flush: false });
    await writeA(name, note('Read first', 'Edit one: carries the team delete.'));
    const r = await flushTeamMemory(keyA, { ...noSleep, hooks: { beforePush: async ({ attempt }) => {
      if (attempt !== 1) return;
      await writeA(name, note('Read first', 'Edit two, queued while edit one is pushed.'));
      rejectAllPushes(bare, 'protected branch hook declined');            // …and edit one's push fails
    } } });
    assert.equal(r.code, 'PUSH_REJECTED');
    unlinkSync(join(bare, 'hooks', 'pre-receive'));
    if (last === 'deleted') await removeMemory(memoryRoot(), projectScope(keyA), name, { source: 'user' });
    else await writeMemory(memoryRoot(), projectScope(keyA), name, note('Read first', LEAK), { source: 'user', now: NOW });
    await queueTeamChanges(keyA, [name], { flush: false });
    assert.equal((await flushTeamMemory(keyA, noSleep)).ok, true);
    assert.ok(!onBranch().includes(name), 'no edit was ever shared on top: the team delete still goes');
  });
}

test('a note the host refused is never pushed again as it is: a Save without an edit costs no push (D5)', { skip }, async () => {
  const hook = installPushProtection(bare);
  try {
    const key = `hvk_${'0123456789abcdef'.repeat(2)}`;   // built at run time: no key-shaped literal sits in the repo
    const text = note('Read before touching the IVR', `The IVR calls the voice provider with ${key}.`);
    await writeA('ivr', text);
    await flushTeamMemory(keyA, noSleep);
    assert.equal((await rowA('ivr')).state, 'blocked');
    let pushes = 0;
    metricsTesting.setGit(async (cwd, args, opts) => { if (args[0] === 'push') pushes++; return metricsTesting.defaultGit(cwd, args, opts); });
    const q = await writeA('ivr', text);                                  // the same text saved again
    const r = await flushTeamMemory(keyA, noSleep);
    assert.deepEqual([q.queued, pushes, r.ok], [[], 0, true]);
  } finally { rmSync(hook, { force: true }); metricsTesting.reset(); }
});

test('a defragment run\'s rewrite that lands while the note is pushed is never shared by the push (D15)', { skip }, async () => {
  await writeA('merged', note('Read first', 'Version one.'));
  assert.equal((await flushTeamMemory(keyA, noSleep)).ok, true);
  await writeA('merged', note('Read first', 'Version two, from an Ask remember.'));
  const r = await flushTeamMemory(keyA, { ...noSleep, hooks: { beforePush: async ({ attempt }) => {
    if (attempt !== 1) return;
    // A defragment run's final sync-back lands: _syncMemoryWith never queues a defragment run's result (D15).
    await writeMemory(memoryRoot(), projectScope(keyA), 'merged', note('Read first', 'Defragmented merge of two notes.'), { source: 'run:defrag', now: NOW });
  } } });
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal((await flushTeamMemory(keyA, noSleep)).ok, true);
  assert.match(showOnBranch('merged'), /Version two/, 'the merge stays on this machine');
  assert.match((await localA('merged')).body, /Defragmented merge/, 'local wins');
});

test('an undo whose queue call is still running when the push lands is shared after it, never followed back', { skip }, async () => {
  const scope = projectScope(keyA);
  await writeA('rev3', note('Read first', 'Version one.'));
  assert.equal((await flushTeamMemory(keyA, noSleep)).ok, true);
  const v1 = await localA('rev3');                                       // the editor shows the `team:` line too
  await writeMemory(memoryRoot(), scope, 'rev3', v1.text.replace('Version one.', 'Version two.'), { source: 'user', now: NOW });
  assert.deepEqual((await queueTeamChanges(keyA, ['rev3'], { flush: false })).queued, ['rev3']);
  let g = null; let q = null; let unhook = () => {};
  const r = await flushTeamMemory(keyA, { ...noSleep, hooks: { beforePush: async ({ attempt }) => {
    if (attempt !== 1) return;
    await writeMemory(memoryRoot(), scope, 'rev3', v1.text, { source: 'user', now: NOW });   // undone while v2 is pushed
    g = gateRead((p) => p.includes(keyA) && p.endsWith(join('inflight', 'rev3.json')));
    q = queueTeamChanges(keyA, ['rev3'], { flush: false });              // reads the record (pending v2), then stalls…
    await g.atGate;
    // …until the push has landed and finishFlush has written that record; then the queue call writes its own.
    unhook = afterRenameSyncOnce((dst) => dst.endsWith(join(keyA, 'status', 'rev3.json')), () => g.release());
  } } });
  await q; g.restore(); unhook();
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.match(showOnBranch('rev3'), /Version two\./, 'the push under way landed');
  assert.equal((await flushTeamMemory(keyA, noSleep)).ok, true);
  assert.match(showOnBranch('rev3'), /Version one\./, 'the undo is shared after it');
  await refreshTeamLayer(keyA, { maxAgeMs: 0 });
  assert.match((await localA('rev3')).body, /Version one\./, 'and the local copy keeps the undo');
});

test('Ask forget in relay mode (the server process) takes the store lock: a marker write never brings the note back', { skip }, async () => {
  await writeA('forgot', note('Read first', 'Remembered, then forgotten during the push.'));
  let g = null;
  const f = flushTeamMemory(keyA, { ...noSleep, hooks: { beforePush: async ({ attempt }) => {
    if (attempt === 1) g = gateRename((dst) => dst.endsWith(join('projects', keyA, 'forgot.md')));   // finishFlush's marker write
  } } });
  for (let i = 0; !g && i < 2000; i++) await new Promise((res) => setTimeout(res, 5));
  assert.ok(g, 'the push reached its beforePush hook');
  await g.atGate;                                                                   // read done, about to rename
  const fg = defaultMemoryDeps({ threadId: 'ask_relay' }).memory.forget(projectScope(keyA), 'forgot');
  await new Promise((res) => setTimeout(res, 20));
  g.release();
  await f; await fg;
  g.restore();
  await queueTeamChanges(keyA, ['forgot'], { flush: false });                       // the server sink queues the forget
  await flushTeamMemory(keyA, noSleep);
  assert.equal(await localA('forgot'), null, 'not recreated');
  assert.ok(!onBranch().includes('forgot'), 'and the team loses it too');
});

// Refine cycle 7 (lifecycle):
test('an edit BLOCKED while the previous version is pushed, then taken out again, never reverts a teammate\'s newer version (D13)', { skip }, async () => {
  const scope = projectScope(keyA);
  await writeA('stale', note('Read first', 'Version one.'));
  assert.equal((await flushTeamMemory(keyA, noSleep)).ok, true);
  const v1 = await localA('stale');                                       // the editor keeps the `team:` line
  await writeMemory(memoryRoot(), scope, 'stale', v1.text.replace('Version one.', 'Version two.'), { source: 'user', now: NOW });
  assert.deepEqual((await queueTeamChanges(keyA, ['stale'], { flush: false })).queued, ['stale']);
  const r = await flushTeamMemory(keyA, { ...noSleep, hooks: { beforePush: async ({ attempt }) => {
    if (attempt !== 1) return;
    const v2 = await localA('stale');
    await writeMemory(memoryRoot(), scope, 'stale', v2.text.replace('Version two.', `Version two.\n${LEAK}`), { source: 'user', now: NOW });
    assert.equal((await queueTeamChanges(keyA, ['stale'], { flush: false })).blocked.length, 1, 'an agent adds an email while v2 is pushed');
  } } });
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.match(showOnBranch('stale'), /Version two\./, 'v2 landed');
  assert.equal((await child({ op: 'write', dir: dirB, note: 'stale', text: note('Read first', 'Version three, from B.') })).ok, true);
  const cur = await localA('stale');
  await writeMemory(memoryRoot(), scope, 'stale', cur.text.replace(`\n${LEAK}`, ''), { source: 'user', now: LATER });   // the user takes the address out
  const q = await queueTeamChanges(keyA, ['stale'], { flush: false });
  assert.equal((await flushTeamMemory(keyA, noSleep)).ok, true);
  assert.match(showOnBranch('stale'), /Version three, from B\./, 'B\'s newer version stays on the team');
  assert.deepEqual(q.queued, [], 'back to exactly what this machine shared: no change');
  await refreshTeamLayer(keyA, { maxAgeMs: 0 });
  assert.match((await localA('stale')).body, /Version three, from B\./, 'and the unedited copy follows the team again');
});

test('an edit queued while the previous version is pushed, its own push failing, then undone, never reverts a teammate\'s newer version (D13)', { skip }, async () => {
  const scope = projectScope(keyA);
  await writeA('stale2', note('Read first', 'Version one.'));
  assert.equal((await flushTeamMemory(keyA, noSleep)).ok, true);
  const v1 = await localA('stale2');
  await writeMemory(memoryRoot(), scope, 'stale2', v1.text.replace('Version one.', 'Version two.'), { source: 'user', now: NOW });
  await queueTeamChanges(keyA, ['stale2'], { flush: false });
  let v2 = null;
  const r = await flushTeamMemory(keyA, { ...noSleep, hooks: { beforePush: async ({ attempt }) => {
    if (attempt !== 1) return;
    v2 = await localA('stale2');
    await writeMemory(memoryRoot(), scope, 'stale2', v2.text.replace('Version two.', 'Version three.'), { source: 'user', now: NOW });
    assert.deepEqual((await queueTeamChanges(keyA, ['stale2'], { flush: false })).queued, ['stale2']);
  } } });
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.match(showOnBranch('stale2'), /Version two\./);
  assert.equal((await child({ op: 'write', dir: dirB, note: 'stale2', text: note('Read first', 'Version four, from B.') })).ok, true);
  rejectAllPushes(bare, 'protected branch hook declined');
  assert.equal((await flushTeamMemory(keyA, noSleep)).code, 'PUSH_REJECTED', 'v3 waits');
  unlinkSync(join(bare, 'hooks', 'pre-receive'));
  const cur = await localA('stale2');
  await writeMemory(memoryRoot(), scope, 'stale2', cur.text.replace('Version three.', 'Version two.'), { source: 'user', now: LATER });   // undone: what the team got
  const q = await queueTeamChanges(keyA, ['stale2'], { flush: false });
  assert.equal((await flushTeamMemory(keyA, noSleep)).ok, true);
  assert.match(showOnBranch('stale2'), /Version four, from B\./, 'B\'s newer version stays on the team');
  assert.deepEqual(q.queued, [], 'v3 never reached the team and was undone: no change');
});

for (const [name, landed] of [['blk-then-del', true], ['blk-then-del-2', false]]) {
  test(`a blocked edit, then a team delete${landed ? '' : ' that could not be pushed yet'}, then the edit taken out again: the note this machine removed from the team does not come back (D12)`, { skip }, async () => {
    const orig = note('Read first', 'Shared once.');
    await writeA(name, orig);
    assert.equal((await flushTeamMemory(keyA, noSleep)).ok, true);
    const v1 = await localA(name);
    assert.equal((await writeA(name, v1.text.replace('Shared once.', `Shared once.\n${LEAK}`))).blocked.length, 1, 'an agent adds an email: blocked');
    if (!landed) rejectAllPushes(bare, 'protected branch hook declined');
    await deleteTeamNote(keyA, name, { flush: false });                    // the user removes the note from the team
    const d = await flushTeamMemory(keyA, noSleep);
    if (landed) { assert.equal(d.ok, true); assert.ok(!onBranch().includes(name), 'the team delete landed'); }
    else { assert.equal(d.code, 'PUSH_REJECTED'); unlinkSync(join(bare, 'hooks', 'pre-receive')); }
    const cur = await localA(name);
    const q = await writeA(name, cur.text.replace(`\n${LEAK}`, ''), LATER);   // then takes the address out again
    assert.equal((await flushTeamMemory(keyA, noSleep)).ok, true);
    assert.ok(!onBranch().includes(name), 'the user\'s own team delete stays');
    assert.deepEqual(q.queued, [], 'the content the team had, which the user removed from it: no change');
  });
}

test('a team delete issued while the note\'s edit is pushed survives an edit on top that is undone before the delete lands (D12)', { skip }, async () => {
  const scope = projectScope(keyA);
  await writeA('g-del', note('Read first', 'One.'));
  assert.equal((await flushTeamMemory(keyA, noSleep)).ok, true);
  const v1 = await localA('g-del');
  await writeMemory(memoryRoot(), scope, 'g-del', v1.text.replace('One.', 'Two.'), { source: 'user', now: NOW });
  await queueTeamChanges(keyA, ['g-del'], { flush: false });
  const r = await flushTeamMemory(keyA, { ...noSleep, hooks: { beforePush: async ({ attempt }) => {
    if (attempt === 1) await deleteTeamNote(keyA, 'g-del', { flush: false });   // the user removes it from the team meanwhile
  } } });
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.match(showOnBranch('g-del'), /Two\./, 'the edit under way landed');
  rejectAllPushes(bare, 'protected branch hook declined');
  assert.equal((await flushTeamMemory(keyA, noSleep)).code, 'PUSH_REJECTED', 'the team delete waits');
  const cur = await localA('g-del');
  assert.deepEqual((await writeA('g-del', cur.text.replace('Two.', 'Three.'))).queued, ['g-del'], 'a clean edit on top carries the delete');
  const q = await writeA('g-del', cur.text, LATER);                                   // undone: what the team delete removes
  unlinkSync(join(bare, 'hooks', 'pre-receive'));
  assert.equal((await flushTeamMemory(keyA, noSleep)).ok, true);
  assert.ok(!onBranch().includes('g-del'), 'the user\'s team delete still goes');
  assert.deepEqual(q.queued, []);
});

test('switched off and on again while offline: deleting an unedited tracked copy before the first fetch still reaches the team (D12)', { skip }, async () => {
  await writeA('r-tracked', note('Read first', 'Shared before the switch-off.'));
  assert.equal((await flushTeamMemory(keyA, noSleep)).ok, true);
  assert.ok((await localA('r-tracked')).meta.extra[TEAM_MARKER_KEY], 'tracked');
  writeProjectSettings({ projectDir: dirA }, { 'memory.team': null });
  await teamMemorySettingChanged(keyA, dirA);                                   // off: the records go, the marker stays
  const url = git(dirA, 'remote', 'get-url', 'origin');
  git(dirA, 'remote', 'set-url', 'origin', join(root, 'nowhere.git'));         // offline
  try {
    await switchTeamMemoryOn(keyA, dirA, () => writeProjectSettings({ projectDir: dirA }, { 'memory.team': true }));
    const first = await teamMemorySettingChanged(keyA, dirA);
    assert.ok(first.error, 'the first fetch fails');
    await removeMemory(memoryRoot(), projectScope(keyA), 'r-tracked', { source: 'user' });   // an agent removes the note
    const q = await queueTeamChanges(keyA, ['r-tracked'], { flush: false });
    git(dirA, 'remote', 'set-url', 'origin', url);                              // online again
    assert.equal((await flushTeamMemory(keyA, noSleep)).ok, true);
    await refreshTeamLayer(keyA, { maxAgeMs: 0 });
    assert.ok(!onBranch().includes('r-tracked'), 'this machine\'s own shared note leaves the team');
    assert.equal(await rowA('r-tracked'), undefined, 'and never comes back here as a teammate\'s note');
    assert.deepEqual(q.queued, ['r-tracked']);
  } finally { git(dirA, 'remote', 'set-url', 'origin', url); }
});

test('a teammate\'s hook longer than this machine\'s hookMaxChars, followed here, then saved without an edit: nothing is pushed (D13)', { skip }, async () => {
  await writeA('long-hook', note('Read first', 'Body.'));
  assert.equal((await flushTeamMemory(keyA, noSleep)).ok, true);
  // A teammate whose memory.hookMaxChars is 300 rewrites the hook (their store keeps all 250 characters).
  const tmp = mkdtempSync(join(root, 'mate-'));
  git(tmp, 'clone', '-q', '-b', TEAM_MEMORY_BRANCH, bare, 'w');
  const w = join(tmp, 'w');
  const hook = `Read before touching the release train: ${'the long reason this hook gives, '.repeat(7)}end.`;
  assert.ok(hook.length > 160 && hook.length < 300);
  writeFileSync(join(w, TEAM_NOTES_REL, 'long-hook.md'), `---\nname: long-hook\ndescription: ${hook}\nupdated: ${LATER}\nauthor: mate\n---\nBody.\n`);
  git(w, '-c', 'user.name=mate', '-c', 'user.email=mate@t', 'commit', '-qam', 'memory: update long-hook');
  git(w, 'push', '-q', 'origin', `HEAD:refs/heads/${TEAM_MEMORY_BRANCH}`);
  const r = await refreshTeamLayer(keyA, { maxAgeMs: 0 });
  assert.deepEqual(r.followed, ['long-hook'], 'A\'s unedited copy follows, hook unclipped');
  const f = await localA('long-hook');
  const q = await writeA('long-hook', f.text, LATER);                      // a Memory-page Save without an edit
  assert.equal((await flushTeamMemory(keyA, noSleep)).ok, true);
  assert.match(showOnBranch('long-hook'), /end\.$/m, 'the teammate\'s whole hook stays on the team');
  assert.deepEqual(q.queued, []);
});

test('a note written again while its LOCAL deletion is pushed, its queue call arriving after that push (an Ask forget, then remember): the new note is shared', { skip }, async () => {
  const scope = projectScope(keyA);
  await writeA('reborn', note('Read first', 'First life.'));
  assert.equal((await flushTeamMemory(keyA, noSleep)).ok, true);
  await removeMemory(memoryRoot(), scope, 'reborn', { source: 'ask:t1' });            // Ask forget …
  assert.deepEqual((await queueTeamChanges(keyA, ['reborn'], { flush: false })).queued, ['reborn']);
  const r = await flushTeamMemory(keyA, { ...noSleep, hooks: { beforePush: async ({ attempt }) => {
    if (attempt !== 1) return;
    // … then remember in the MCP child: the file lands now, the server sink's queue call after this push.
    await writeMemory(memoryRoot(), scope, 'reborn', note('Read first', 'Second life, a new note.'), { source: 'ask:t1', now: NOW });
  } } });
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.ok(!onBranch().includes('reborn'), 'the deletion landed');
  const q = await queueTeamChanges(keyA, ['reborn'], { flush: false });                // the sink, late
  assert.equal((await flushTeamMemory(keyA, noSleep)).ok, true);
  assert.deepEqual(q.queued, ['reborn'], 'a new note written after the deletion is shared like any new note');
  assert.match(showOnBranch('reborn'), /Second life/);
});

// Refine cycle 8 (a run's writable copy): it keeps the `team:` line it had at mount time; the store never takes it.
/** A run of machine A: its writable copy, and a sync-back that queues what it changed — run-harness.mjs `_syncMemoryWith`. */
async function runMount() {
  const dirs = mountDirs({ members: [{ projectKey: keyA, projectName: 'shop' }] });
  const mount = mkdtempSync(join(root, 'run-'));
  const m = await mountMemory({ root: memoryRoot(), mount, dirs });
  let baseline = m.baseline;
  return {
    file: (name) => join(mount, 'project', `${name}.md`),
    sync: async () => {
      const res = await syncBack({ root: memoryRoot(), mount, dirs, baseline, source: 'run:c8', now: LATER, caps: memoryCaps({ projectKey: keyA }), prepare: teamClientText });
      baseline = res.baseline;
      for (const [k, names] of teamChangesFromSync(res, dirs)) await queueTeamChanges(k, names, { flush: false });
      return res;
    },
  };
}

test('a run that mounted a tracked copy before its team delete landed, then rewrote it unchanged, never re-marks it: the local copy stays (D12)', { skip }, async () => {
  await writeA('mount-del', note('Read first', 'Shared, then removed from the team while a run is live.'));
  assert.equal((await flushTeamMemory(keyA, noSleep)).ok, true);
  const run = await runMount();                                           // its writable copy carries the team: line
  await deleteTeamNote(keyA, 'mount-del', { flush: false });              // the user removes it from the team meanwhile…
  assert.equal((await flushTeamMemory(keyA, noSleep)).ok, true);          // …and that lands
  const p = run.file('mount-del');
  writeFileSync(p, `${readFileSync(p, 'utf8')}\n`);                       // the agent rewrites it, content unchanged
  assert.deepEqual((await run.sync()).modified.map((r) => r.name), ['mount-del']);
  assert.equal((await localA('mount-del')).meta.extra[TEAM_MARKER_KEY], undefined, 'the store never takes the mount copy\'s old team: line');
  assert.equal((await flushTeamMemory(keyA, noSleep)).ok, true);
  await refreshTeamLayer(keyA, { maxAgeMs: 0 });
  assert.match((await localA('mount-del'))?.body || '(removed)', /removed from the team while a run is live/, 'the local copy stays (D12)');
  assert.ok(!onBranch().includes('mount-del'));
});

test('a run that shares an edit of a tracked note, then puts it back exactly as it mounted it, shares that undo (last write wins)', { skip }, async () => {
  await writeA('run-undo', note('Read first', 'Version zero.'));
  assert.equal((await flushTeamMemory(keyA, noSleep)).ok, true);
  const run = await runMount();
  const p = run.file('run-undo');
  const t0 = readFileSync(p, 'utf8');                                      // version zero, with its team: line
  writeFileSync(p, t0.replace('Version zero.', 'Version one, by the run.'));
  await run.sync();
  assert.equal((await flushTeamMemory(keyA, noSleep)).ok, true);
  assert.match(showOnBranch('run-undo'), /Version one, by the run\./);
  writeFileSync(p, t0);                                                    // a later node puts it back exactly as mounted
  await run.sync();
  assert.equal((await flushTeamMemory(keyA, noSleep)).ok, true);
  assert.match(showOnBranch('run-undo'), /Version zero\./, 'the undo is shared');
  await refreshTeamLayer(keyA, { maxAgeMs: 0 });
  assert.match((await localA('run-undo')).body, /Version zero\./, 'and the local copy keeps it');
});

test('a restore of a snapshot older than a team delete never re-marks the copy with the snapshot\'s team: line: the next refresh leaves it here (D12)', { skip }, async () => {
  const scope = projectScope(keyA);
  await writeA('old-snap', note('Read first', 'Shared, removed from the team, then an older snapshot restored.'));
  assert.equal((await flushTeamMemory(keyA, noSleep)).ok, true);                        // tracked: its file carries team:
  const had = new Set((await listSnapshots(memoryRoot(), scope)).map((x) => x.id));
  // Its snapshot holds old-snap WITH the line (the real clock: a fixed stamp would sort before the ring's follow snapshots and be pruned).
  await writeA('old-snap-other', note('Read first', 'Another note.'), new Date().toISOString());
  const snap = (await listSnapshots(memoryRoot(), scope)).find((x) => !had.has(x.id));
  await deleteTeamNote(keyA, 'old-snap', { flush: false });
  assert.equal((await flushTeamMemory(keyA, noSleep)).ok, true);                        // the team delete lands: a plain local note
  await withStoreLock(memoryRoot(), async () => {                                       // the Memory-page restore route (Step 9b)
    const before = await listMemory(memoryRoot(), scope);
    await restoreSnapshot(memoryRoot(), scope, snap.id, { source: 'user' });
    await queueTeamChanges(keyA, changedNoteNames(before, await listMemory(memoryRoot(), scope)), { restore: true, flush: false });
  });
  assert.equal((await localA('old-snap')).meta.extra[TEAM_MARKER_KEY], undefined, 'not re-marked');
  assert.equal((await flushTeamMemory(keyA, noSleep)).ok, true);
  await refreshTeamLayer(keyA, { maxAgeMs: 0 });
  assert.ok(await localA('old-snap'), 'the local copy stays (D12)');
  assert.ok(!onBranch().includes('old-snap'), 'and off the team');
});

// Last: it clones machine A's checkout again.
test('the branch rewritten and the checkout cloned again (the head this machine last saw is unknown): a tracked copy nobody deleted stays (D3)', { skip }, async () => {
  await writeA('phoenix-2', note('Read first', 'First life.'));
  assert.equal((await flushTeamMemory(keyA, noSleep)).ok, true);
  assert.equal((await child({ op: 'teamdelete', dir: dirB, note: 'phoenix-2' })).ok, true);   // commit D removes it
  const afterDelete = git(bare, 'rev-parse', TEAM_MEMORY_BRANCH);
  await refreshTeamLayer(keyA, { maxAgeMs: 0 });
  await writeA('phoenix-2', note('Read first', 'Second life, written after the deletion.'));
  assert.equal((await flushTeamMemory(keyA, noSleep)).ok, true);                                // re-added; A tracks it
  const seen = (await readTeamSnapshot(keyA)).headSha;
  git(bare, 'update-ref', `refs/heads/${TEAM_MEMORY_BRANCH}`, afterDelete);                    // force-pushed back
  rmSync(dirA, { recursive: true, force: true });                                              // A clones its checkout again,
  git(dirname(dirA), 'clone', '-q', '--no-local', bare, 'shop');                                // over the transport: reachable objects only
  for (const [k, v] of [['user.name', 'machineA dev'], ['user.email', 'machineA@t'], ['commit.gpgsign', 'false']]) git(dirA, 'config', k, v);
  assert.throws(() => git(dirA, 'cat-file', '-e', `${seen}^{commit}`), 'the head A last saw is unknown to the new clone');
  const r = await refreshTeamLayer(keyA, { maxAgeMs: 0 });
  assert.deepEqual(r.removed, [], 'no removal is proven: nothing is removed');
  assert.match((await localA('phoenix-2'))?.body || '(removed)', /Second life/);
});
