// test/memory-team.test.mjs — team memory (phase 1a) without a remote: the content hash and branch form, the gate at
// queue time, team deletes and forced shares in the queue, the note states, the mount (precedence, cap, pending
// intents, single / workspace layouts), following the team, the switch-off, the branch reader's guards, and
// remove-project cleanup. Pushing and fetching is test/memory-team-sync.test.mjs.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, existsSync, readdirSync, readFileSync, mkdirSync, writeFileSync, symlinkSync, renameSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, sep } from 'node:path';
import { execSync } from 'node:child_process';
import { JSDOM } from 'jsdom';
import { useTempHome } from './helpers/temp-home.mjs';
import { gateRead, gateCopy, patchFs } from './helpers/fs-gate.mjs';
import { renderSeedReview, collectSeedDecisions } from '../ui/public/memory-view.mjs';
import { gitDir } from './helpers/git-dir.mjs';
import { addProject, removeProject } from '../src/core/projects.mjs';
import { writeProjectSettings } from '../src/core/settings-cascade.mjs';
import { memoryRoot, projectScope, writeMemory, readMemory, removeMemory, setMemoryExtra, listSnapshots, listMemory, restoreSnapshot, snapshotScope } from '../src/core/memory-store.mjs';
import { mountDirs, mountMemory, refreshMount } from '../src/core/memory-sync.mjs';
import { defaultMemoryDeps, refreshAskMemoryMount } from '../src/core/ask/memory-deps.mjs';
import {
  contentHash, teamNoteText, noteFindings, queueTeamChanges, flushTeamMemory, teamMemoryStatus, mountTeamLayer, teamMountNames, teamMountNotes, teamMountRel, teamChangesFromSync,
  changedNoteNames, isTeamMemoryOn, deleteTeamNote, teamMemorySettingChanged, teamListing, readTeamNote, recordExistingNotes, switchTeamMemoryOn,
  teamNoteStates, teamOnlyLoad, memoryLoadPlan, memoryLoadPlans, loadFilteredDirs, holdApplies, previewTeamSeed, seedTeamMemory, undoTeamSeed, readSeedOffer, dismissSeedOffer, resolveTeamClash,
  TEAM_MARKER_KEY, _testing,
} from '../src/core/memory-team.mjs';
import { createWorkspace } from '../src/core/workspaces.mjs';
import { withQueuedLock } from '../src/core/metrics/sync.mjs';
import { withStoreLock } from '../src/core/memory-sync.mjs';

const symlinks = process.platform === 'win32' ? 'symlinks need privileges on win32' : false;
useTempHome(after);
const tmp = mkdtempSync(join(tmpdir(), 'worca-team-unit-'));
after(() => rmSync(tmp, { recursive: true, force: true }));
const NOW = '2026-10-16T10:00:00.000Z';
const KEY = 'shop-0000000a';
const KEY2 = 'billing-0000000b';
const on = (projectKey) => writeProjectSettings({ projectKey }, { 'memory.team': true });
const note = (description, body) => `---\nname: x\ndescription: ${description}\n---\n${body}\n`;   // repair forces the name
const put = (key, name, text) => writeMemory(memoryRoot(), projectScope(key), name, text, { source: 'user', now: NOW });
/** A team.json the way a fetch writes it: each note through the module's own reader; `deleted` = the notes a commit removed. */
const snapshotOf = (notes, deleted = []) => ({ schema: 1, branch: 'worca-memory', headSha: 'f'.repeat(40), fetchedAt: NOW, missing: false, deleted,
  notes: Object.fromEntries(Object.entries(notes).map(([name, o]) => [name,
    _testing.noteEntry(name, teamNoteText({ name, description: o.desc ?? name, paths: [], updated: o.updated ?? NOW }, o.body ?? `${name} body`, { author: 'mate' }))])) });

test('contentHash: name, description, paths and body only — never source, updated, the marker or other extras', () => {
  const meta = { name: 'trap', description: 'Read before deploying', paths: ['src/**'], source: 'run:1', updated: NOW, extra: { team: 'x', owner: 'y' } };
  const h = contentHash(meta, 'Body.\n');
  assert.equal(contentHash({ ...meta, source: 'ask:2', updated: '2027-01-01T00:00:00.000Z', extra: {} }, 'Body.'), h);
  for (const other of [{ ...meta, description: 'other' }, { ...meta, paths: [] }]) assert.notEqual(contentHash(other, 'Body.\n'), h);
  assert.notEqual(contentHash(meta, 'Body!\n'), h);
});

test('teamNoteText: the branch file has no source and no local extras, and names its author', () => {
  const t = teamNoteText({ name: 'trap', description: 'd', paths: ['a/**'], source: 'run:1', updated: NOW, extra: { team: 'x' } }, 'Body.', { author: 'Ana' });
  assert.equal(t, `---\nname: trap\ndescription: d\npaths: a/**\nupdated: ${NOW}\nauthor: Ana\n---\nBody.\n`);
});

test('noteFindings: the gate covers every field the branch file carries — `updated` too (a hand-edited store file)', () => {
  const meta = { name: 'trap', description: 'd', paths: ['a/**'], updated: NOW };
  assert.deepEqual(noteFindings(meta, 'Body.\n'), []);
  assert.deepEqual(noteFindings({ ...meta, updated: `ghp_${'a1'.repeat(18)}` }, 'Body.\n').map((f) => [f.field, f.rule]), [['updated', 'api-token']]);
  // m17: the gate checks what is pushed — a control character the renderer turns into a space hides nothing
  const hidden = { ...meta, description: 'DB_PASSWORD\x01=Xk9pLmQ2wErT77' };
  assert.match(teamNoteText(hidden, 'Body.\n'), /DB_PASSWORD =Xk9/);
  assert.deepEqual(noteFindings(hidden, 'Body.\n').map((f) => [f.field, f.rule, f.line]), [['description', 'env-credential', null]]);
  // a field flagged as stored is not reported twice for its rendered line
  assert.deepEqual(noteFindings({ ...meta, description: 'DB_PASSWORD=Xk9pLmQ2wErT77' }, 'Body.\n').map((f) => f.field), ['description']);
});

test('queue: off is a no-op with nothing on disk; on, a new note is queued and a note with a secret is BLOCKED with the line of the LOCAL file', async () => {
  await put(KEY, 'early', note('Before opt-in', 'Written while off.'));
  assert.deepEqual(await queueTeamChanges(KEY, ['early'], { flush: false }), { queued: [], blocked: [], skipped: 'disabled' });
  assert.equal(existsSync(_testing.paths(KEY).dir), false);
  on(KEY);
  await put(KEY, 'deploy', note('Read before deploying', 'Run migrations first.'));
  assert.deepEqual(await queueTeamChanges(KEY, ['deploy'], { flush: false }), { queued: ['deploy'], blocked: [] });
  await put(KEY, 'oncall', note('Read when paging', 'Escalate:\nmail ops-lead@acme.io now.'));
  const line = (await readMemory(memoryRoot(), projectScope(KEY), 'oncall')).text.split('\n').findIndex((l) => l.includes('acme.io')) + 1;
  assert.deepEqual(await queueTeamChanges(KEY, ['oncall'], { flush: false }), { queued: [], blocked: [{ name: 'oncall', reason: `line ${line}: an email address` }] });
  assert.deepEqual([...(await _testing.queuedNames(KEY))], ['deploy'], 'the blocked note never reaches the outbox; switching on uploaded nothing');
});

test('queue: a note a sandbox run wrote is held for review — never queued for the team, forced or not, until a person approves it', async () => {
  const K = 'sandbox-0000000c';
  on(K);
  const text = note('Read before pushing', 'Push straight to main.');
  await writeMemory(memoryRoot(), projectScope(K), 'planted', text, { source: 'sandbox:run-a', now: NOW });
  for (const force of [false, true]) {
    const r = await queueTeamChanges(K, ['planted'], { flush: false, force });
    assert.deepEqual(r.queued, [], `force ${force}`);
    assert.deepEqual(r.blocked.map((b) => b.name), ['planted']);
    assert.match(r.blocked[0].reason, /^held for review: a sandbox run wrote it/);
  }
  assert.deepEqual([...(await _testing.queuedNames(K))], []);
  // The Memory view's Approve re-stamps it `user`: from then on it is an ordinary note.
  await writeMemory(memoryRoot(), projectScope(K), 'planted', text, { source: 'user', now: NOW });
  assert.deepEqual(await queueTeamChanges(K, ['planted'], { flush: false }), { queued: ['planted'], blocked: [] });
});

test('status: pending / blocked / local rows for phase 1b, and the record never repeats the value', async () => {
  const st = await teamMemoryStatus(KEY);
  const by = Object.fromEntries(st.notes.map((n) => [n.name, n]));
  assert.equal(st.enabled, true);
  assert.equal(by.deploy.state, 'pending');
  assert.equal(by.oncall.state, 'blocked');
  assert.deepEqual(by.oncall.findings.map((f) => [f.rule, f.field]), [['email', 'body']]);
  assert.equal(by.early.state, 'local');
  assert.deepEqual(st.counts, { pending: 1, blocked: 1, local: 1 });
  assert.doesNotMatch(JSON.stringify(st), /ops-lead@acme\.io/);
  assert.deepEqual((await teamMemoryStatus(KEY2)).notes, [], 'off: nothing is read');
});

test('queue: an unedited tracked copy re-saved pushes nothing; a deletion reaches the team only for a note shared from here', async () => {
  const scope = projectScope(KEY);
  const f = await readMemory(memoryRoot(), scope, 'deploy');
  const h = contentHash({ ...f.meta, name: 'deploy' }, f.body);
  await setMemoryExtra(memoryRoot(), scope, 'deploy', TEAM_MARKER_KEY, h);   // what a successful push leaves
  _testing.markShared(KEY, 'deploy', h);
  rmSync(join(_testing.paths(KEY).outbox, 'deploy.json'), { force: true });
  assert.deepEqual((await queueTeamChanges(KEY, ['deploy'], { flush: false })).queued, [], 'unchanged since its sync: it could revert a teammate');
  await removeMemory(memoryRoot(), scope, 'deploy', { source: 'user' });
  assert.deepEqual((await queueTeamChanges(KEY, ['deploy'], { flush: false })).queued, ['deploy'], 'a note this machine shared');
  await removeMemory(memoryRoot(), scope, 'early', { source: 'user' });
  assert.deepEqual((await queueTeamChanges(KEY, ['early'], { flush: false })).queued, [], 'never shared from here');
});

test('queue: a note deleted while its FIRST share is in flight is queued for removal, not cancelled (the push may land)', async () => {
  const K = 'race-0000000e';
  on(K);
  await put(K, 'fresh', note('Brand new', 'First version.'));
  assert.deepEqual((await queueTeamChanges(K, ['fresh'], { flush: false })).queued, ['fresh']);
  const { outbox, inflight } = _testing.paths(K);
  mkdirSync(inflight, { recursive: true });
  writeFileSync(join(inflight, 'fresh.json'), readFileSync(join(outbox, 'fresh.json')));   // what claimEntries does
  rmSync(join(outbox, 'fresh.json'));
  await removeMemory(memoryRoot(), projectScope(K), 'fresh', { source: 'user' });
  assert.deepEqual((await queueTeamChanges(K, ['fresh'], { flush: false })).queued, ['fresh'], 'kept: the in-flight push may still create it');
  assert.equal((await teamMemoryStatus(K)).notes.find((n) => n.name === 'fresh').state, 'deleting');
  rmSync(join(inflight, 'fresh.json'));                      // that push failed: nothing reached the team
  assert.deepEqual((await queueTeamChanges(K, ['fresh'], { flush: false })).queued, [], 'nothing in flight, never shared: cancelled');
  assert.equal(existsSync(join(_testing.paths(K).status, 'fresh.json')), false, 'and its record is gone');
});

test('mount: unshadowed team notes (case-insensitive), newest teamMaxFiles first; team/ on one project, team/<key>/ per workspace member', async () => {
  on(KEY2);
  writeProjectSettings({ projectKey: KEY }, { 'memory.teamMaxFiles': 2 });
  await put(KEY, 'Conventions', note('local wins', 'Mine.'));
  _testing.writeSnapshot(KEY, snapshotOf({ conventions: { updated: '2026-10-16T09:00:00.000Z' }, a: { updated: '2026-10-15T00:00:00.000Z' },
    b: { updated: '2026-10-16T08:00:00.000Z' }, c: { updated: '2026-10-14T00:00:00.000Z' } }));
  _testing.writeSnapshot(KEY2, snapshotOf({ billing: {} }));
  const single = join(tmp, 'single');
  mkdirSync(join(single, 'team', 'keep-me'), { recursive: true });
  writeFileSync(join(single, 'team', 'stale.md'), 'x');
  assert.deepEqual(await mountTeamLayer({ rules: single, dirs: mountDirs({ members: [{ projectKey: KEY, projectName: 'Shop' }] }) }), [{ key: KEY, rel: 'team', count: 2, load: 'both' }]);
  assert.deepEqual(readdirSync(join(single, 'team')).sort(), ['a.md', 'b.md', 'keep-me'], 'shadowed, past the cap and stale files gone; sub-dirs kept');
  assert.match(readFileSync(join(single, 'team', 'b.md'), 'utf8'), /^author: mate$/m);
  const rows = Object.fromEntries((await teamMemoryStatus(KEY)).notes.map((n) => [n.name, n]));
  assert.deepEqual([rows.Conventions.state, rows.Conventions.shadows, rows.conventions.mounted], ['local', true, false], 'the status says what the mount does: a local note shadows a team note whatever its case');
  const ws = join(tmp, 'ws');
  const members = [{ projectKey: KEY, projectName: 'Shop' }, { projectKey: KEY2, projectName: 'Billing' }, { projectKey: 'off-0000000c', projectName: 'Off' }];
  const w = await mountTeamLayer({ rules: ws, dirs: mountDirs({ members, isWorkspace: true }) });
  assert.deepEqual(w.map((t) => [t.rel, t.count]), [[`team/${KEY2}`, 1], [`team/${KEY}`, 2]]);
  assert.equal(existsSync(join(ws, 'team', 'off-0000000c')), false, 'a member that is off gets nothing');
});

test('a team.json that is valid JSON but holds a broken entry serves its other notes; a workspace member that cannot be mounted never stops the next one', async () => {
  const K = 'badsnap-0000002d';
  const K2 = 'nextsnap-0000002e';
  on(K);
  on(K2);
  const good = snapshotOf({ ok: {} });
  _testing.writeSnapshot(K, { ...good, notes: { ...good.notes, a: null, b: 'not an entry', c: { text: 1 } } });
  _testing.writeSnapshot(K2, snapshotOf({ next: {} }));
  assert.deepEqual((await teamListing(K)).map((n) => n.name), ['ok'], 'list_memory');
  assert.equal(await readTeamNote(K, 'a'), null, 'read_memory');
  assert.deepEqual((await teamMemoryStatus(K)).notes.map((n) => [n.name, n.state]), [['ok', 'team']], 'the status');
  assert.deepEqual((await teamMountNotes(K)).map((n) => n.name), ['ok'], 'the mount');
  const rules = join(tmp, 'badmember');
  const dirs = mountDirs({ members: [{ projectKey: K, projectName: 'Bad' }, { projectKey: K2, projectName: 'Next' }], isWorkspace: true }).filter((d) => d.scope?.kind === 'project');
  mkdirSync(join(rules, 'team'), { recursive: true });
  writeFileSync(join(rules, ...teamMountRel(dirs[0]).split('/')), 'a file where the first member\'s folder goes');
  const warnings = []; const orig = console.warn; console.warn = (...a) => warnings.push(a.join(' '));
  let mounted;
  try { mounted = await mountTeamLayer({ rules, dirs }); } finally { console.warn = orig; }
  assert.deepEqual(mounted.map((m) => [m.key, m.count]), [[dirs[1].scope.projectKey, 1]]);
  assert.equal(warnings.length, 1, warnings.join('\n'));
});

test('team notes only ("only"): shared and pending local notes load, plain / held / blocked ones do not and shadow nothing; one cap over both; global notes and the store untouched', async () => {
  const K = 'teamonly-0000003a';
  writeProjectSettings({ projectKey: K }, { 'memory.team': 'only', 'memory.teamMaxFiles': 4 });
  const scope = projectScope(K);
  await put(K, 'shared', note('s', 'Tracked.'));
  const f = await readMemory(memoryRoot(), scope, 'shared');
  const h = contentHash({ ...f.meta, name: 'shared' }, f.body);
  await setMemoryExtra(memoryRoot(), scope, 'shared', TEAM_MARKER_KEY, h);
  _testing.markShared(K, 'shared', h);
  await put(K, 'fresh', note('f', 'New, on its way.'));
  await put(K, 'plain', note('p', 'Mine only.'));
  await put(K, 'Clash', note('c', 'My clash.'));
  await put(K, 'secret', note('x', 'Mail ops-lead@acme.io.'));
  await queueTeamChanges(K, ['fresh', 'secret'], { flush: false });
  await writeMemory(memoryRoot(), { kind: 'global' }, 'style', note('g', 'Global.'), { source: 'user', now: NOW });
  _testing.writeSnapshot(K, snapshotOf({ shared: { body: 'Tracked.' }, clash: { updated: '2026-10-16T09:00:00.000Z' }, mate: { updated: '2026-10-16T08:00:00.000Z' },
    old: { updated: '2020-01-01T00:00:00.000Z' } }));
  const plan = await memoryLoadPlan(K);
  assert.deepEqual([plan.load, [...plan.localNames].sort(), plan.team.map((n) => n.name).sort()], ['team', ['fresh', 'shared'], ['clash', 'mate']],
    'blocked / plain / held stay out; the team\'s clash loads; four in all, the oldest team note past the cap');
  const rows = Object.fromEntries((await teamMemoryStatus(K)).notes.map((n) => [n.name, n.mounted]));
  assert.deepEqual(rows, { Clash: false, clash: true, fresh: true, mate: true, old: false, plain: false, secret: false, shared: true });
  assert.equal((await teamMemoryStatus(K)).load, 'team');
  assert.equal((await teamListing(K)).find((n) => n.name === 'clash').shadowed, false, 'a local note that does not load shadows nothing');
  // The mount: the filter in both copies, the global dir as it is.
  const dirs = mountDirs({ members: [{ projectKey: K, projectName: 'Only' }] });
  const plans = await memoryLoadPlans(dirs);
  const m = await mountMemory({ root: memoryRoot(), mount: join(tmp, 'only-w'), dirs: loadFilteredDirs(dirs, plans) });
  assert.deepEqual(readdirSync(join(tmp, 'only-w', 'project')).sort(), ['fresh.md', 'shared.md']);
  assert.deepEqual(Object.keys(m.baseline).sort(), ['global/style.md', 'project/fresh.md', 'project/shared.md'], 'a note left out is never in the baseline');
  const rules = join(tmp, 'only-r');
  mkdirSync(join(rules, 'project'), { recursive: true });
  writeFileSync(join(rules, 'project', 'plain.md'), 'stale');
  await refreshMount({ root: memoryRoot(), mount: rules, dirs: loadFilteredDirs(dirs, plans) });
  assert.deepEqual(readdirSync(join(rules, 'project')).sort(), ['fresh.md', 'shared.md'], 'a copy of a note that no longer loads is unlinked');
  assert.deepEqual(await mountTeamLayer({ rules, dirs, plans }), [{ key: K, rel: 'team', count: 2, load: 'team' }]);
  // Ask: the mount, list_memory and read_memory follow the same plan.
  const base = await refreshAskMemoryMount({ projectKey: K, projectName: 'Only' });
  assert.deepEqual([readdirSync(join(base, '.claude', 'rules', 'worca', 'project')).sort(), readdirSync(join(base, '.claude', 'rules', 'worca', 'team')).sort()],
    [['fresh.md', 'shared.md'], ['clash.md', 'mate.md']]);
  const mem = defaultMemoryDeps({ threadId: 't' }).memory;
  assert.deepEqual((await mem.list(scope)).map((e) => e.name).sort(), ['fresh', 'shared']);
  assert.equal(await mem.read(scope, 'plain'), null, 'not this chat\'s memory: read_memory falls back to the team');
  assert.ok(await mem.read(scope, 'shared'));
  assert.ok(await readMemory(memoryRoot(), scope, 'plain'), 'the store keeps every note');
  // Both again: every local note loads, the team rule of before.
  writeProjectSettings({ projectKey: K }, { 'memory.team': true });
  const both = await memoryLoadPlan(K);
  assert.deepEqual([both.load, both.localNames, both.team.map((n) => n.name).sort()], ['both', null, ['mate', 'old']]);
  writeProjectSettings({ projectKey: K }, { 'memory.team': null });
  assert.deepEqual(await memoryLoadPlan(K), { load: 'local', localNames: null, team: [] });
});

test('a workspace mixes modes per member: a Team member is filtered, a Both member and the global dir are not', async () => {
  const A = 'wsteam-0000003b', B = 'wsboth-0000003c';
  writeProjectSettings({ projectKey: A }, { 'memory.team': 'only' });
  on(B);
  await put(A, 'a-local', note('a', 'A only.'));
  await put(B, 'b-local', note('b', 'B only.'));
  _testing.writeSnapshot(A, snapshotOf({ 'a-team': {} }));
  _testing.writeSnapshot(B, snapshotOf({ 'b-team': {} }));
  const dirs = mountDirs({ members: [{ projectKey: A, projectName: 'A' }, { projectKey: B, projectName: 'B' }], isWorkspace: true });
  const plans = await memoryLoadPlans(dirs);
  const filtered = loadFilteredDirs(dirs, plans);
  assert.deepEqual(filtered.map((d) => [d.rel, d.only ? [...d.only] : null]), [['global', null], [`projects/${B}`, null], [`projects/${A}`, []]], 'members sorted by key');
  const rules = join(tmp, 'ws-mixed');
  assert.deepEqual((await mountTeamLayer({ rules, dirs, plans })).map((t) => [t.rel, t.count, t.load]), [[`team/${B}`, 1, 'both'], [`team/${A}`, 1, 'team']]);
});

test('teamOnlyLoad: pending loads before its push, a queued removal still hides the team copy, case-insensitive shadowing, no caps given loads all', () => {
  const snapshot = { notes: { Deploy: { updated: '2026-10-15T00:00:00.000Z', bytes: 10 }, gone: { updated: '2026-10-15T00:00:00.000Z', bytes: 10 },
    big: { updated: '2026-10-17T00:00:00.000Z', bytes: 40_000 } } };
  const rows = [{ name: 'deploy', local: true, state: 'pending', updated: '2026-10-16T00:00:00.000Z' }, { name: 'mine', local: true, state: 'local', updated: '2026-10-16T00:00:00.000Z' }];
  const r = teamOnlyLoad({ rows, snapshot, queued: ['deploy', 'gone'], maxBytes: 32768 });
  assert.deepEqual([[...r.local], [...r.team]], [['deploy'], []]);
  assert.deepEqual([...teamOnlyLoad({ rows: [], snapshot }).team].sort(), ['Deploy', 'big', 'gone']);
});

test('teamMountNames: shadowing is case-insensitive, a note over the local per-file cap never loads, newest first, capped', () => {
  const notes = { a: { updated: '2026-10-14T00:00:00.000Z', bytes: 10 }, B: { updated: '2026-10-16T00:00:00.000Z', bytes: 10 },
    big: { updated: '2026-10-17T00:00:00.000Z', bytes: 40_000 }, c: { updated: '2026-10-15T00:00:00.000Z', bytes: 10 } };
  assert.deepEqual(teamMountNames(notes, ['b'], { maxBytes: 32768 }), ['c', 'a']);
  assert.deepEqual(teamMountNames(notes, [], { maxFiles: 2, maxBytes: 32768 }), ['B', 'c']);
  assert.deepEqual(teamMountNames(notes, []), ['big', 'B', 'c', 'a'], 'no caps given: everything, newest first');
});

test('follow the team: an unedited tracked copy takes the team version or goes with a deletion COMMIT; a merely absent one is untracked, kept; edited, queued and plain copies stay; a missing branch deletes nothing', async () => {
  const K = 'follow-0000000d';
  on(K);
  const scope = projectScope(K);
  const track = async (name, text) => {
    await put(K, name, text);
    const f = await readMemory(memoryRoot(), scope, name);
    const h = contentHash({ ...f.meta, name }, f.body);
    await setMemoryExtra(memoryRoot(), scope, name, TEAM_MARKER_KEY, h);
    _testing.markShared(K, name, h);
  };
  await track('updated', note('u', 'old'));
  await track('deleted', note('d', 'gone soon'));
  await track('absent', note('a', 'the branch was started again without me'));
  await track('edited', note('e', 'v1'));
  await put(K, 'edited', note('e', 'v2 local edit'));            // keeps its v1 marker: edited since the sync
  await track('queued', note('q', 'v1'));
  mkdirSync(_testing.paths(K).outbox, { recursive: true });
  writeFileSync(join(_testing.paths(K).outbox, 'queued.json'), JSON.stringify({ op: 'sync' }));
  await put(K, 'plain', note('p', 'same as team'));
  const snap = snapshotOf({ updated: { desc: 'u', body: 'new from mate' }, edited: { desc: 'e', body: 'mate v3' }, queued: { desc: 'q', body: 'mate v2' }, plain: { desc: 'p', body: 'same as team' } }, ['deleted']);
  const none = { followed: [], removed: [], adopted: [], untracked: [] };
  assert.deepEqual(await _testing.reconcileTracked(K, { ...snap, missing: true, notes: {} }, { at: NOW }), none);
  assert.deepEqual(await _testing.reconcileTracked(K, { ...snap, notes: {}, deleted: null }, { at: NOW }), none, 'git could not tell what was deleted: nothing is removed or untracked');
  assert.deepEqual(await _testing.reconcileTracked(K, snap, { at: NOW }), { followed: ['updated'], removed: ['deleted'], adopted: ['plain'], untracked: ['absent'] });
  const u = await readMemory(memoryRoot(), scope, 'updated');
  assert.match(u.body, /new from mate/);
  assert.equal(u.meta.source, 'team');
  assert.equal(u.meta.extra[TEAM_MARKER_KEY], snap.notes.updated.hash);
  assert.equal(await readMemory(memoryRoot(), scope, 'deleted'), null);
  const kept = await readMemory(memoryRoot(), scope, 'absent');
  assert.match(kept.body, /started again without me/, 'never deleted by anyone: the file stays');
  assert.equal(kept.meta.extra[TEAM_MARKER_KEY], undefined, 'as a plain local note (an edit shares it again)');
  assert.match((await readMemory(memoryRoot(), scope, 'edited')).body, /v2 local edit/, 'the local edit wins');
  assert.match((await readMemory(memoryRoot(), scope, 'queued')).body, /v1/, 'a share on its way wins');
  assert.equal((await readMemory(memoryRoot(), scope, 'plain')).meta.extra[TEAM_MARKER_KEY], snap.notes.plain.hash, 'an identical plain note starts tracking');
});

test('a tracked copy whose record was dropped (switched off and on) gets it back: deleting it still reaches the team', async () => {
  const K = 'relost-0000000f';
  on(K);
  const scope = projectScope(K);
  await put(K, 'kept', note('k', 'Shared before the switch-off.'));
  const f = await readMemory(memoryRoot(), scope, 'kept');
  const h = contentHash({ ...f.meta, name: 'kept' }, f.body);
  await setMemoryExtra(memoryRoot(), scope, 'kept', TEAM_MARKER_KEY, h);   // tracked, but no status record: off, then on again
  const snap = snapshotOf({ kept: { desc: 'k', body: 'Shared before the switch-off.' } });
  assert.equal(snap.notes.kept.hash, h, 'in sync with the team');
  assert.deepEqual(await _testing.reconcileTracked(K, snap, { at: NOW }), { followed: [], removed: [], adopted: [], untracked: [] });
  await removeMemory(memoryRoot(), scope, 'kept', { source: 'user' });
  assert.deepEqual((await queueTeamChanges(K, ['kept'], { flush: false })).queued, ['kept'], 'the record came back: the deletion is queued for the team');
});

test('queue: a team delete waiting to be pushed survives a local deletion, a blocked edit and a re-save; a clean edit supersedes it', async () => {
  const K = 'teamdel-00000010';
  on(K);
  const scope = projectScope(K);
  const { outbox, inflight } = _testing.paths(K);
  const op = (name, dir = outbox) => (existsSync(join(dir, `${name}.json`)) ? JSON.parse(readFileSync(join(dir, `${name}.json`), 'utf8')).op : null);
  for (const name of ['gone', 'leaky', 'resaved', 'edited', 'pushing']) {
    await put(K, name, note(name, `${name} v1`));
    const f = await readMemory(memoryRoot(), scope, name);
    const h = contentHash({ ...f.meta, name }, f.body);
    await setMemoryExtra(memoryRoot(), scope, name, TEAM_MARKER_KEY, h);
    _testing.markShared(K, name, h);
    await deleteTeamNote(K, name, { flush: false, now: NOW });
    assert.equal((await readMemory(memoryRoot(), scope, name)).meta.extra[TEAM_MARKER_KEY], undefined, 'the local copy is a plain local note now');
  }
  await removeMemory(memoryRoot(), scope, 'gone', { source: 'user' });
  assert.deepEqual((await queueTeamChanges(K, ['gone'], { flush: false })).queued, []);
  assert.equal(op('gone'), 'delete', 'a local deletion never cancels the team delete');
  await put(K, 'leaky', note('leaky', 'Now mail ops-lead@acme.io.'));
  assert.equal((await queueTeamChanges(K, ['leaky'], { flush: false })).blocked.length, 1);
  assert.equal(op('leaky'), 'delete', 'a blocked edit never cancels it either');
  await put(K, 'resaved', note('resaved', 'resaved v1'));                // the same content saved again
  assert.deepEqual((await queueTeamChanges(K, ['resaved'], { flush: false })).queued, []);
  assert.equal(op('resaved'), 'delete', 'nor does a re-save of the content it removes');
  await put(K, 'edited', note('edited', 'edited v2'));
  assert.deepEqual((await queueTeamChanges(K, ['edited'], { flush: false })).queued, ['edited']);
  assert.equal(op('edited'), 'sync', 'a clean edit is shared again on top of it');
  mkdirSync(inflight, { recursive: true });
  writeFileSync(join(inflight, 'pushing.json'), readFileSync(join(outbox, 'pushing.json')));   // what claimEntries does
  rmSync(join(outbox, 'pushing.json'));
  await removeMemory(memoryRoot(), scope, 'pushing', { source: 'user' });
  assert.deepEqual((await queueTeamChanges(K, ['pushing'], { flush: false })).queued, ['pushing']);
  assert.equal(op('pushing'), 'delete', 'gone while the team delete is pushed: if that push fails, the delete goes next');
  assert.equal((await teamMemoryStatus(K)).notes.find((n) => n.name === 'gone').state, 'deleting');
});

test('switching off drops the queue at once, even while a push holds the lock; switched on again meanwhile, the new queue stays', async () => {
  const K = 'offwait-00000011';
  on(K);
  await put(K, 'queued', note('q', 'Queued before the switch-off.'));
  assert.deepEqual((await queueTeamChanges(K, ['queued'], { flush: false })).queued, ['queued']);
  mkdirSync(_testing.paths(K).inflight, { recursive: true });
  writeFileSync(join(_testing.paths(K).inflight, 'claimed.json'), JSON.stringify({ op: 'sync' }));   // a running push's claim
  let release;
  const held = withQueuedLock(_testing.paths(K).lock, () => new Promise((r) => { release = r; }));   // a long push
  await new Promise((r) => setImmediate(r));
  writeProjectSettings({ projectKey: K }, { 'memory.team': null });
  const off = teamMemorySettingChanged(K);
  // The discard removes outbox/, then inflight/ (two awaits): wait for both — the long push still holds the lock.
  for (let i = 0; i < 100 && (existsSync(join(_testing.paths(K).outbox, 'queued.json')) || existsSync(join(_testing.paths(K).inflight, 'claimed.json'))); i++) await new Promise((r) => setTimeout(r, 10));
  assert.equal(existsSync(join(_testing.paths(K).outbox, 'queued.json')), false, 'gone before the lock was free');
  assert.equal(existsSync(join(_testing.paths(K).inflight, 'claimed.json')), false, 'a running push\'s claims too: a failed push has nothing to put back');
  on(K);
  await put(K, 'later', note('l', 'Queued after switching on again.'));
  assert.deepEqual((await queueTeamChanges(K, ['later'], { flush: false })).queued, ['later']);
  release();
  await held;
  await off;
  assert.deepEqual([...(await _testing.queuedNames(K))], ['later'], 'the discard re-checked the switch inside the lock');
});

test('a team version over this machine\'s per-file cap is not followed: the copy is untracked once, not retried every refresh', async () => {
  const K = 'bigteam-00000012';
  on(K);
  writeProjectSettings({ projectKey: K }, { 'memory.maxBytesPerFile': 2000 });
  const scope = projectScope(K);
  await put(K, 'big', note('b', 'Small here.'));
  const f = await readMemory(memoryRoot(), scope, 'big');
  const h = contentHash({ ...f.meta, name: 'big' }, f.body);
  await setMemoryExtra(memoryRoot(), scope, 'big', TEAM_MARKER_KEY, h);
  _testing.markShared(K, 'big', h);
  const snap = snapshotOf({ big: { desc: 'b', body: 'x'.repeat(3000) } });
  const warnings = []; const orig = console.warn; console.warn = (...a) => warnings.push(a.join(' '));
  try {
    assert.deepEqual((await _testing.reconcileTracked(K, snap, { at: NOW })).followed, []);
    assert.deepEqual((await _testing.reconcileTracked(K, snap, { at: NOW })).followed, []);
  } finally { console.warn = orig; }
  assert.equal(warnings.length, 1, warnings.join('\n'));
  assert.match(warnings[0], /ETOOBIG.*plain local note/);
  const after = await readMemory(memoryRoot(), scope, 'big');
  assert.match(after.body, /Small here/);
  assert.equal(after.meta.extra[TEAM_MARKER_KEY], undefined);
});

test('a note this machine is removing from the team never loads back as a team note: mount, status, list and read skip it', async () => {
  const K = 'pending-00000013';
  on(K);
  _testing.writeSnapshot(K, snapshotOf({ dropped: { desc: 'd', body: 'Being removed.' }, kept: { desc: 'k', body: 'Stays.' } }));
  mkdirSync(_testing.paths(K).outbox, { recursive: true });
  writeFileSync(join(_testing.paths(K).outbox, 'dropped.json'), JSON.stringify({ op: 'sync' }));   // an agent emptied it: its removal is queued
  const rules = join(tmp, 'pending');
  await mountTeamLayer({ rules, dirs: mountDirs({ members: [{ projectKey: K, projectName: 'P' }] }) });
  assert.deepEqual(readdirSync(join(rules, 'team')), ['kept.md'], 'the run that deleted it does not load it back');
  const rows = Object.fromEntries((await teamMemoryStatus(K)).notes.map((n) => [n.name, n]));
  assert.deepEqual([rows.dropped.state, rows.dropped.mounted], ['deleting', false]);
  assert.deepEqual((await teamListing(K)).map((n) => n.name), ['kept']);
  assert.equal(await readTeamNote(K, 'dropped'), null);
  assert.ok(await readTeamNote(K, 'kept'));
});

test('queue: a restore forces an OLDER tracked version it brought back, and a re-save leaves that share in place; at its last synced version it is no change', async () => {
  const K = 'forced-00000014';
  on(K);
  const scope = projectScope(K);
  await put(K, 'restored', note('r', 'Version one.'));
  const f = await readMemory(memoryRoot(), scope, 'restored');
  const h = contentHash({ ...f.meta, name: 'restored' }, f.body);
  await setMemoryExtra(memoryRoot(), scope, 'restored', TEAM_MARKER_KEY, h);   // version one as a restore brings it back: its own marker
  _testing.markShared(K, 'restored', h);
  assert.deepEqual((await queueTeamChanges(K, ['restored'], { restore: true, flush: false })).queued, [], 'what this machine last synced: no change, it keeps following the team');
  _testing.markShared(K, 'restored', 'e'.repeat(40), { followed: true });      // a teammate's newer version, followed here since
  assert.deepEqual((await queueTeamChanges(K, ['restored'], { restore: true, flush: false })).queued, [], 'a restore is whole-scope: it never reverts a teammate\'s version for the team — the copy follows the team again');
  _testing.markShared(K, 'restored', 'f'.repeat(40));                          // a newer version this machine pushed since
  assert.deepEqual((await queueTeamChanges(K, ['restored'], { restore: true, flush: false })).queued, ['restored'], 'an older tracked version over this machine\'s own push is forced: the next follow would undo the restore');
  assert.deepEqual((await queueTeamChanges(K, ['restored'], { flush: false })).queued, [], 'a re-save is no change…');
  assert.equal(JSON.parse(readFileSync(join(_testing.paths(K).outbox, 'restored.json'), 'utf8')).force, true, '…and leaves the forced share in place');
});

test('queue: two quick writes of one note queue the newer one — an older verdict never deletes a newer intent', async () => {
  const K = 'quick-00000015';
  on(K);
  await put(K, 'twice', note('t', 'Now page ops-lead@acme.io.'));   // a version the gate blocks
  const first = queueTeamChanges(K, ['twice'], { flush: false });
  await put(K, 'twice', note('t', 'Page the on-call rotation.'));   // the clean edit lands while the first call runs
  const second = queueTeamChanges(K, ['twice'], { flush: false });
  await Promise.all([first, second]);
  assert.deepEqual([...(await _testing.queuedNames(K))], ['twice'], 'the clean edit is queued');
  assert.equal((await teamMemoryStatus(K)).notes.find((n) => n.name === 'twice').state, 'pending');
});

test('a team delete queued, then an edit the gate blocks: the status row says what is queued — the team delete — not "pending"', async () => {
  const K = 'r6-0000000a';
  on(K);
  const scope = projectScope(K);
  await put(K, 'retired', note('r', 'Shared once.'));
  const f = await readMemory(memoryRoot(), scope, 'retired');
  const h = contentHash({ ...f.meta, name: 'retired' }, f.body);
  await setMemoryExtra(memoryRoot(), scope, 'retired', TEAM_MARKER_KEY, h);
  _testing.markShared(K, 'retired', h);
  await deleteTeamNote(K, 'retired', { flush: false, now: NOW });
  await put(K, 'retired', note('r', 'Now mail ops-lead@acme.io.'));
  assert.equal((await queueTeamChanges(K, ['retired'], { flush: false })).blocked.length, 1);
  assert.equal(JSON.parse(readFileSync(join(_testing.paths(K).outbox, 'retired.json'), 'utf8')).op, 'delete', 'the team delete is what is queued (D12)');
  assert.equal((await teamMemoryStatus(K)).notes.find((n) => n.name === 'retired').state, 'deleting');
});

test('a team note this machine is removing under another case (its tracked `Deploy` deleted; the team holds `deploy`) is hidden from Ask list/read as from the mount', async () => {
  const K = 'r8-0000000c';
  on(K);
  const text = teamNoteText({ name: 'deploy', description: 'd', paths: [], updated: NOW }, 'B replaced Deploy with deploy.', { author: 'mate' });
  _testing.writeSnapshot(K, { schema: 1, branch: 'worca-memory', headSha: 'f'.repeat(40), fetchedAt: NOW, missing: false, deleted: ['Deploy'], notes: { deploy: _testing.noteEntry('deploy', text) } });
  mkdirSync(_testing.paths(K).outbox, { recursive: true });
  writeFileSync(join(_testing.paths(K).outbox, 'Deploy.json'), JSON.stringify({ op: 'sync' }));   // the push removes every case variant (D9)
  assert.deepEqual(await teamMountNotes(K), [], 'the mount hides it (case-insensitive)');
  assert.deepEqual((await teamListing(K)).map((n) => n.name), [], 'list_memory agrees');
  assert.equal(await readTeamNote(K, 'deploy'), null, 'read_memory agrees');
});

test('teammates\' updates followed here never push this machine\'s OWN undo history out of the 20-snapshot ring', async () => {
  const K = 'r7-0000000b';
  on(K);
  const scope = projectScope(K);
  // Increasing stamps: same-second snapshot ids sort `-team` before `-user`, which would hide an eviction.
  const at = (i) => `2026-10-16T1${String(Math.floor(i / 60))}:${String(i % 60).padStart(2, '0')}:00.000Z`;
  await writeMemory(memoryRoot(), scope, 'mine', note('m', 'Good version (local only).'), { source: 'user', now: at(0) });
  await writeMemory(memoryRoot(), scope, 'shared', note('s', 'v0'), { source: 'user', now: at(1) });
  const f = await readMemory(memoryRoot(), scope, 'shared');
  const h = contentHash({ ...f.meta, name: 'shared' }, f.body);
  await setMemoryExtra(memoryRoot(), scope, 'shared', TEAM_MARKER_KEY, h);
  _testing.markShared(K, 'shared', h);
  // An agent overwrites the local-only note badly: the snapshot taken before that write holds the good version.
  await writeMemory(memoryRoot(), scope, 'mine', note('m', 'Bad overwrite.'), { source: 'run:1', now: at(2) });
  const holdsGood = async () => {
    for (const s of await listSnapshots(memoryRoot(), scope)) {
      if (s.files.includes('mine.md') && /Good version/.test(readFileSync(join(s.dir, 'mine.md'), 'utf8'))) return true;
    }
    return false;
  };
  assert.equal(await holdsGood(), true);
  for (let i = 1; i <= 20; i++) {   // a busy afternoon: 20 refreshes, each following one teammate update
    const text = teamNoteText({ name: 'shared', description: 's', paths: [], updated: at(10 + i) }, `v${i} from a teammate`, { author: 'mate' });
    const snap = { schema: 1, branch: 'worca-memory', headSha: 'f'.repeat(40), fetchedAt: at(10 + i), missing: false, deleted: [], notes: { shared: _testing.noteEntry('shared', text) } };
    assert.deepEqual((await _testing.reconcileTracked(K, snap, { at: at(10 + i) })).followed, ['shared']);
  }
  assert.equal(await holdsGood(), true, 'the good version of a local-only note is still restorable');
});

test('switching on records the notes that exist: a Save without an edit never uploads one, a real edit does (D1)', async () => {
  const K = 'optin-00000016';
  await put(K, 'before', note('b', 'Written before opt-in.'));
  assert.equal(await recordExistingNotes(K), 1, 'still off: what exists is recorded right before the switch is written');
  on(K);
  assert.equal(await recordExistingNotes(K), 0, 'already on: nothing to record');
  await put(K, 'before', note('b', 'Written before opt-in.'));   // the Memory page's Save without an edit
  assert.deepEqual((await queueTeamChanges(K, ['before'], { flush: false })).queued, [], 'an existing note is never uploaded by a re-save');
  assert.equal((await teamMemoryStatus(K)).notes.find((n) => n.name === 'before').state, 'local');
  await put(K, 'before', note('b', 'Changed after opt-in.'));
  assert.deepEqual((await queueTeamChanges(K, ['before'], { flush: false })).queued, ['before'], 'a real edit is shared');
});

const entryOf = (key, name) => { const p = join(_testing.paths(key).outbox, `${name}.json`); return existsSync(p) ? JSON.parse(readFileSync(p, 'utf8')) : null; };
const tracked = async (key, name, text) => {   // what a successful push leaves: marker + record
  await put(key, name, text);
  const f = await readMemory(memoryRoot(), projectScope(key), name);
  const h = contentHash({ ...f.meta, name }, f.body);
  await setMemoryExtra(memoryRoot(), projectScope(key), name, TEAM_MARKER_KEY, h);
  _testing.markShared(key, name, h);
};

test('a follow never overwrites or removes an edit another process lands while the scope is snapshotted (m5: the store\'s compare-and-swap)', async () => {
  const K = 'followcas-0000002c';
  on(K);
  for (const [name, deleted] of [['zeta', []], ['gone', ['gone']]]) {
    await tracked(K, name, note(name, `${name} v1`));
    // The follow's snapshot parks on this note: another process (a CLI run's sync-back) edits it meanwhile.
    const g = gateCopy((src, dst) => src.endsWith(`${sep}${name}.md`) && /-team(-\d+)?[\\/][a-z]+\.md$/.test(dst));
    let r;
    try {
      const p = _testing.reconcileTracked(K, snapshotOf(deleted.length ? {} : { [name]: { body: `${name} v2 from a teammate` } }, deleted), { at: NOW });
      await g.atGate;
      await put(K, name, note(name, `${name}: my edit`));
      g.release();
      r = await p;
    } finally { g.restore(); }
    assert.deepEqual([r.followed, r.removed], [[], []], `${name}: nothing followed`);
    assert.match((await readMemory(memoryRoot(), projectScope(K), name)).body, new RegExp(`${name}: my edit`), `${name}: the edit stays`);
  }
});

test('a team delete issued while a queue call for the same note is running survives that older verdict — a clean one or a blocked one (D12)', async () => {
  for (const [K, text] of [['tdrace-0000001a', 'x v2, a clean edit'], ['tdrace-0000001b', 'Now page ops-lead@acme.io.']]) {
    on(K);
    await tracked(K, 'x', note('x', 'x v1'));
    await put(K, 'x', note('x', text));                                   // its queue call is about to run
    const g = gateRead((p) => p.includes(K) && p.endsWith(join('inflight', 'x.json')));
    const q = queueTeamChanges(K, ['x'], { flush: false });
    await g.atGate;                                                       // that call has read outbox/: no delete there yet
    const d = deleteTeamNote(K, 'x', { flush: false, now: NOW });         // the user's LATER action
    await new Promise((r) => setTimeout(r, 20));
    g.release();
    await Promise.all([q, d]);
    g.restore();
    assert.equal(entryOf(K, 'x')?.op, 'delete', `${text}: the team delete, the latest action, stays queued`);
  }
});

test('a team delete typed in another case acts on the note as this machine spells it — else as the team does: the local copy stays, its name unchanged (D12)', async () => {
  const K = 'tdcase-0000002c';
  on(K);
  await tracked(K, 'deploy', note('d', 'Shared once.'));
  await deleteTeamNote(K, 'Deploy', { flush: false, now: NOW });
  const f = await readMemory(memoryRoot(), projectScope(K), 'deploy');
  assert.equal(f.meta.name, 'deploy');
  assert.equal(f.meta.extra[TEAM_MARKER_KEY], undefined, 'its marker is dropped: it never follows this deletion (a case-sensitive disk would keep it)');
  _testing.writeSnapshot(K, snapshotOf({ Release: {} }));                  // only the team holds this one
  await deleteTeamNote(K, 'release', { flush: false, now: NOW });
  assert.deepEqual(readdirSync(_testing.paths(K).outbox).sort(), ['Release.json', 'deploy.json']);
});

test('a team delete a queue call puts back never outlives a switch-off that landed during that call\'s reads (D1)', async () => {
  const K = 'offdrop-0000002f';
  on(K);
  await tracked(K, 's', note('s', 's v1'));
  await deleteTeamNote(K, 's', { flush: false, now: NOW });
  await put(K, 's', note('s', 's v2, a clean edit'));
  await queueTeamChanges(K, ['s'], { flush: false });                     // the edit carries the team delete
  await put(K, 's', note('s', 'Now page ops-lead@acme.io.'));             // blocked: its queue call puts the delete back…
  const g = gateRead((p) => p.includes(K) && p.endsWith(join('inflight', 's.json')));
  const q = queueTeamChanges(K, ['s'], { flush: false });
  await g.atGate;                                                         // …after its reads
  writeProjectSettings({ projectKey: K }, { 'memory.team': null });
  await teamMemorySettingChanged(K);                                      // the switch-off's discard lands meanwhile
  g.release();
  await q;
  g.restore();
  assert.equal(entryOf(K, 's'), null, 'no intent is written after the switch-off');
});

test('the restore route (a queue call inside the store lock) never deadlocks with a team delete waiting its turn', async () => {
  const K = 'tdlock-00000021';
  on(K);
  await put(K, 'a', note('a', 'a v1'));
  await put(K, 'b', note('b', 'b v1'));
  const g = gateRead((p) => p.includes(K) && p.endsWith(join('inflight', 'a.json')));
  const q = queueTeamChanges(K, ['a'], { flush: false });                  // a queue call, parked
  await g.atGate;
  const d = deleteTeamNote(K, 'b', { flush: false, now: NOW });            // a team delete waiting its turn behind it
  const restore = withStoreLock(memoryRoot(), () => queueTeamChanges(K, ['a'], { force: true, flush: false }));   // the restore route's shape
  await new Promise((r) => setTimeout(r, 20));
  g.release();
  let deadlock;   // cleared once settled: an armed 5 s timer would hold the process after the file's last test
  const done = await Promise.race([Promise.all([q, d, restore]).then(() => 'done'), new Promise((r) => { deadlock = setTimeout(() => r('deadlock'), 5000); })])
    .finally(() => clearTimeout(deadlock));
  g.restore();
  assert.equal(done, 'done');
  assert.equal(entryOf(K, 'b')?.op, 'delete');
});

test('a claim is never lost where hard links fail (FAT/exFAT, some network mounts): a failed push and a dead claim both go back', async () => {
  const K = 'nolink-0000001c';   // not a registered project: the flush fails NO_LOCAL_PROJECT and puts its claims back
  on(K);
  await put(K, 'z', note('z', 'Queued, then a failed push.'));
  assert.deepEqual((await queueTeamChanges(K, ['z'], { flush: false })).queued, ['z']);
  let restore = patchFs('link', () => async () => { throw Object.assign(new Error('operation not supported'), { code: 'ENOTSUP' }); });
  let r;
  try { r = await flushTeamMemory(K); } finally { restore(); }
  assert.equal(r.code, 'NO_LOCAL_PROJECT');
  assert.deepEqual([...(await _testing.queuedNames(K))], ['z'], 'still queued after the failed push');
  assert.equal((await teamMemoryStatus(K)).notes.find((n) => n.name === 'z').state, 'pending');
  const { outbox, inflight } = _testing.paths(K);
  mkdirSync(inflight, { recursive: true });
  renameSync(join(outbox, 'z.json'), join(inflight, 'z.json'));             // claimed by a flush that then died
  restore = patchFs('link', () => async () => { throw Object.assign(new Error('operation not permitted'), { code: 'EPERM' }); });
  try { await flushTeamMemory(K); } finally { restore(); }
  assert.deepEqual([...(await _testing.queuedNames(K))], ['z'], 'a dead claim goes back too');
});

test('a queued team delete under a clean edit is not lost when that edit is then deleted or blocked (D12: only a SHARED edit cancels it)', async () => {
  for (const [K, after] of [['superdel-0000001f', 'deleted'], ['superdel-00000020', 'blocked']]) {
    on(K);
    await tracked(K, 's', note('s', 's v1'));                             // the team holds s v1
    await deleteTeamNote(K, 's', { flush: false, now: NOW });             // removed from the team; the push waits (offline)
    await put(K, 's', note('s', 's v2, a clean edit'));
    assert.deepEqual((await queueTeamChanges(K, ['s'], { flush: false })).queued, ['s']);
    assert.deepEqual([entryOf(K, 's').op, entryOf(K, 's').teamDelete], ['sync', true], 'the delete rides under the edit until it is shared');
    if (after === 'deleted') await removeMemory(memoryRoot(), projectScope(K), 's', { source: 'user' });
    else await put(K, 's', note('s', 'Now page ops-lead@acme.io.'));
    await queueTeamChanges(K, ['s'], { flush: false });
    assert.equal(entryOf(K, 's')?.op, 'delete', `${after}: the team still holds s v1, which the user removed from it`);
    assert.equal((await teamMemoryStatus(K)).notes.find((n) => n.name === 's').state, 'deleting');
  }
});

test('a failed push never overwrites a BLOCKED verdict written while it was failing', async () => {
  const K = 'failblk-0000001e';
  on(K);
  await put(K, 'v', note('v', 'Clean when queued.'));
  assert.deepEqual((await queueTeamChanges(K, ['v'], { flush: false })).queued, ['v']);
  const g = gateRead((p) => p.includes(K) && p.endsWith(join('status', 'v.json')));
  const f = flushTeamMemory(K);                                            // fails NO_LOCAL_PROJECT
  if (await Promise.race([g.atGate.then(() => 'gate'), f.then(() => 'done')]) === 'done') g.restore();   // no async read: no window
  await put(K, 'v', note('v', 'Then: page ops-lead@acme.io.'));
  assert.equal((await queueTeamChanges(K, ['v'], { flush: false })).blocked.length, 1);
  g.release();
  await f;
  g.restore();
  assert.equal((await teamMemoryStatus(K)).notes.find((n) => n.name === 'v').state, 'blocked');
});

test('a tracked copy edited while the project was off gets the opt-in baseline too: a Save without an edit uploads nothing (D1)', async () => {
  const K = 'offedit-00000023';
  on(K);
  await tracked(K, 'deploy', note('d', 'Team text.'));
  writeProjectSettings({ projectKey: K }, { 'memory.team': null });
  await teamMemorySettingChanged(K);                                                    // off: the records go, the marker stays
  const t0 = (await readMemory(memoryRoot(), projectScope(K), 'deploy')).text;
  await put(K, 'deploy', t0.replace('Team text.', 'Edited while sharing was off.'));   // the `team:` line rides along
  assert.equal(await recordExistingNotes(K), 1, 'recorded: it no longer matches its marker');
  on(K);
  await put(K, 'deploy', (await readMemory(memoryRoot(), projectScope(K), 'deploy')).text);   // a Save without an edit
  assert.deepEqual((await queueTeamChanges(K, ['deploy'], { flush: false })).queued, [], 'the edit made while off stays here');
  await put(K, 'deploy', t0.replace('Team text.', 'A real edit after switching on.'));
  assert.deepEqual((await queueTeamChanges(K, ['deploy'], { flush: false })).queued, ['deploy'], 'a real edit is shared');
});

test('an edit that never reached the team, then undone, is no change: the baseline holds and a team delete under it comes back (D1, D12)', async () => {
  const K = 'undo-00000025';
  await put(K, 'base', note('b', 'At opt-in.'));
  assert.equal(await recordExistingNotes(K), 1);
  on(K);
  await put(K, 'base', note('b', 'Now page ops-lead@acme.io.'));
  assert.equal((await queueTeamChanges(K, ['base'], { flush: false })).blocked.length, 1);
  await put(K, 'base', note('b', 'At opt-in.'));                                       // the user takes the address out again
  assert.deepEqual((await queueTeamChanges(K, ['base'], { flush: false })).queued, [], 'blocked, then undone: no change');
  await put(K, 'base', note('b', 'A clean edit whose push is still waiting.'));
  assert.deepEqual((await queueTeamChanges(K, ['base'], { flush: false })).queued, ['base']);
  await put(K, 'base', note('b', 'At opt-in.'));
  assert.deepEqual((await queueTeamChanges(K, ['base'], { flush: false })).queued, [], 'queued, then undone before its push: no change');
  assert.equal(entryOf(K, 'base'), null, 'and the queued share is gone');
  assert.equal((await teamMemoryStatus(K)).notes.find((n) => n.name === 'base').state, 'local');
  await tracked(K, 'gone', note('g', 'Shared once.'));
  await deleteTeamNote(K, 'gone', { flush: false, now: NOW });                         // its push waits (offline)
  await put(K, 'gone', note('g', 'An edit on top.'));
  await queueTeamChanges(K, ['gone'], { flush: false });
  assert.deepEqual([entryOf(K, 'gone').op, entryOf(K, 'gone').teamDelete], ['sync', true]);
  await put(K, 'gone', note('g', 'Shared once.'));                                     // undone before it was shared
  assert.deepEqual((await queueTeamChanges(K, ['gone'], { flush: false })).queued, []);
  assert.equal(entryOf(K, 'gone')?.op, 'delete', 'the team delete is back (D12)');
  assert.equal((await teamMemoryStatus(K)).notes.find((n) => n.name === 'gone').state, 'deleting');
});

test('a restore that only undoes an edit that never reached the team uploads nothing: blocked or still queued (D1, D13)', async () => {
  const K = 'restore-00000026';
  const scope = projectScope(K);
  await put(K, 'legacy', note('l', 'Written before opt-in.'));
  assert.equal(await recordExistingNotes(K), 1);
  on(K);
  const ids = async () => (await listSnapshots(memoryRoot(), scope)).map((s) => s.id);
  // The Memory-page restore route (Step 9b): one store lock for the restore, its diff and its queue.
  const restore = async (id) => withStoreLock(memoryRoot(), async () => {
    const before = await listMemory(memoryRoot(), scope);
    await restoreSnapshot(memoryRoot(), scope, id, { source: 'user' });
    return queueTeamChanges(K, changedNoteNames(before, await listMemory(memoryRoot(), scope)), { restore: true, flush: false });
  });
  for (const edit of ['Now page ops-lead@acme.io.', 'A clean edit whose push is still waiting.']) {
    const had = new Set(await ids());
    await put(K, 'legacy', note('l', edit));                          // an agent's write: blocked, or queued (offline)
    const taken = (await ids()).find((id) => !had.has(id));            // the snapshot that write took first
    await queueTeamChanges(K, ['legacy'], { flush: false });
    assert.deepEqual((await restore(taken)).queued, [], `${edit}: the restore takes it back to what existed at opt-in`);
    assert.equal(entryOf(K, 'legacy'), null, 'nothing queued');
    assert.equal((await teamMemoryStatus(K)).notes.find((n) => n.name === 'legacy').state, 'local');
  }
});

test('a note that existed at opt-in, deleted here and brought back unchanged, uploads nothing; changed, it is shared (D1)', async () => {
  const K = 'regone-00000027';
  const text = note('g', 'Written before opt-in.');
  await put(K, 'gone', text);
  assert.equal(await recordExistingNotes(K), 1);
  on(K);
  await removeMemory(memoryRoot(), projectScope(K), 'gone', { source: 'user' });
  assert.deepEqual((await queueTeamChanges(K, ['gone'], { flush: false })).queued, [], 'never shared: nothing to tell the team');
  await put(K, 'gone', text);                                         // a restore, or an Ask remember of the same text
  assert.deepEqual((await queueTeamChanges(K, ['gone'], { restore: true, flush: false })).queued, [], 'back unchanged: no change');
  assert.equal((await teamMemoryStatus(K)).notes.find((n) => n.name === 'gone').state, 'local');
  await put(K, 'gone', note('g', 'Written again, changed.'));
  assert.deepEqual((await queueTeamChanges(K, ['gone'], { flush: false })).queued, ['gone'], 'a changed note is shared');
});

test('a restore never removes a teammate\'s version from the team: a tracked copy it deletes leaves the team only when this machine pushed the team\'s version; any other deletion still does (D12)', async () => {
  const K = 'rdel-00000029';
  on(K);
  for (const [name, followed] of [['mine', false], ['theirs', true], ['agent-gone', true]]) {
    await put(K, name, note(name, `${name} body`));
    const f = await readMemory(memoryRoot(), projectScope(K), name);
    const h = contentHash({ ...f.meta, name }, f.body);
    await setMemoryExtra(memoryRoot(), projectScope(K), name, TEAM_MARKER_KEY, h);
    _testing.markShared(K, name, h, { followed });                       // followed: the team's version is a teammate's
    await removeMemory(memoryRoot(), projectScope(K), name, { source: 'user' });
  }
  assert.deepEqual((await queueTeamChanges(K, ['mine', 'theirs'], { restore: true, flush: false })).queued, ['mine'], 'a restore of an older snapshot: only this machine\'s own pushed version leaves the team');
  assert.equal(entryOf(K, 'theirs'), null, 'the teammate\'s version stays on the team');
  assert.deepEqual((await queueTeamChanges(K, ['agent-gone'], { flush: false })).queued, ['agent-gone'], 'an ordinary deletion of a tracked copy reaches the team as before');
});

test('switched off, then on again while the switch-off is still discarding: the new opt-in baseline survives (D1)', async () => {
  const K = 'toggle-00000024';
  const dir = gitDir('teamtoggle');
  execSync('git remote add origin https://git.example.invalid/acme/toggle.git', { cwd: dir });
  const switchOn = () => switchTeamMemoryOn(K, dir, () => writeProjectSettings({ projectKey: K }, { 'memory.team': true }));
  await put(K, 'legacy', note('l', 'Written before opt-in.'));
  await switchOn();
  writeProjectSettings({ projectKey: K }, { 'memory.team': null });                     // PATCH off: written …
  const keyDir = _testing.paths(K).dir;
  let reached, release;
  const atGate = new Promise((r) => { reached = r; });
  const gate = new Promise((r) => { release = r; });
  const restore = patchFs('rm', (orig) => async (p, o) => { if (p === keyDir) { reached(); await gate; } return orig(p, o); });
  try {
    const off = teamMemorySettingChanged(K);                                             // … its discard runs in the background
    await atGate;                                                                         // past its "still off?" check (a slow worktree removal)
    const again = switchOn();                                                             // PATCH on at once: waits for that lock
    await new Promise((r) => setTimeout(r, 20));
    release();
    await off;
    await again;
  } finally { restore(); }
  assert.equal(isTeamMemoryOn(K), true);
  await put(K, 'legacy', note('l', 'Written before opt-in.'));                           // a Save without an edit
  assert.deepEqual((await queueTeamChanges(K, ['legacy'], { flush: false })).queued, [], 'an existing note is never uploaded by a re-save');
});

test('the switch refuses a project team memory can never sync: no git, a Folder project with a typed team repo, no origin (D8)', async () => {
  const { projectSlug } = await import('../src/core/metrics/sync.mjs');
  const { writeTeamRepo } = await import('../src/core/config.mjs');
  const refused = (code) => ({ code, status: 400 });
  const writeSwitch = () => assert.fail('a refused switch never writes the setting');
  // git missing: projectSlug reads .git/config itself and says hasOrigin, but every fetch and push needs git.
  const withOrigin = gitDir('teamnogit');
  execSync('git remote add origin https://git.example.invalid/acme/nogit.git', { cwd: withOrigin });
  const prev = process.env.WORCA_GIT;
  process.env.WORCA_GIT = '0';
  try {
    assert.equal((await projectSlug(withOrigin)).hasOrigin, true, 'the HTTPS path answers from .git/config');
    await assert.rejects(switchTeamMemoryOn('nogit-00000031', withOrigin, writeSwitch), refused('NO_GIT'));
  } finally { if (prev === undefined) delete process.env.WORCA_GIT; else process.env.WORCA_GIT = prev; }
  assert.equal(isTeamMemoryOn('nogit-00000031'), false);
  // A Folder project (no .git) whose team repo was typed: projectSlug takes the typed repo, team memory has no transport.
  const folder = mkdtempSync(join(tmp, 'folder-'));
  const fp = (await addProject({ name: 'teamfolder', path: folder })).find((x) => x.name === 'teamfolder');
  assert.equal(fp.vcs, 'none');
  writeTeamRepo(fp.key, 'acme/typed-folder');
  assert.equal((await projectSlug(folder)).hasOrigin, true, 'the typed repo answers hasOrigin');
  await assert.rejects(switchTeamMemoryOn(fp.key, folder, writeSwitch), refused('FOLDER_PROJECT'));
  const st = await teamMemoryStatus(fp.key);
  assert.deepEqual([st.enabled, st.canStart, st.startError?.code], [false, false, 'FOLDER_PROJECT']);
  await removeProject('teamfolder');
  // A git project without origin: refused as before; with origin it starts.
  const bare = gitDir('teamnoorigin');
  await assert.rejects(switchTeamMemoryOn('noorigin-00000032', bare, writeSwitch), { ...refused('NO_ORIGIN'), message: /origin/ });
  execSync('git remote add origin https://git.example.invalid/acme/noorigin.git', { cwd: bare });
  const gp = (await addProject({ name: 'teamorigin', path: bare })).find((x) => x.name === 'teamorigin');
  assert.deepEqual([(await teamMemoryStatus(gp.key)).canStart, (await teamMemoryStatus(gp.key)).startError], [true, null]);
  await removeProject('teamorigin');
});

test('teamChangesFromSync keeps project dirs only (a global note never leaves); changedNoteNames is the store diff', () => {
  const dirs = mountDirs({ members: [{ projectKey: KEY, projectName: 'Shop' }, { projectKey: KEY2, projectName: 'Billing' }], isWorkspace: true });
  const res = { added: [{ scope: 'global', name: 'style' }, { scope: `projects/${KEY}`, name: 'a' }], modified: [{ scope: `projects/${KEY2}`, name: 'b' }], deleted: [{ scope: `projects/${KEY}`, name: 'c' }] };
  assert.deepEqual(Object.fromEntries(teamChangesFromSync(res, dirs)), { [KEY]: ['a', 'c'], [KEY2]: ['b'] });
  assert.deepEqual(changedNoteNames([{ name: 'a', hash: '1' }, { name: 'b', hash: '2' }, { name: 'd', hash: '5' }],
    [{ name: 'a', hash: '1' }, { name: 'b', hash: '3' }, { name: 'c', hash: '4' }]), ['b', 'c', 'd']);
});

test('the branch reader never follows a committed symlink, a junk name or a giant file', { skip: symlinks }, async () => {
  const wt = join(tmp, 'wt');
  const notes = join(wt, '.worca-memory', 'notes');
  mkdirSync(notes, { recursive: true });
  writeFileSync(join(notes, 'ok.md'), teamNoteText({ name: 'ok', description: 'fine', paths: [], updated: NOW }, 'Fine.'));
  writeFileSync(join(tmp, 'secret.txt'), 'key material');
  symlinkSync(join(tmp, 'secret.txt'), join(notes, 'link.md'));
  writeFileSync(join(notes, 'my notes.md'), 'junk name');
  writeFileSync(join(notes, 'huge.md'), 'x'.repeat(300 * 1024));
  assert.deepEqual(Object.keys(await _testing.readTeamNotes(wt)), ['ok']);
  const evil = join(tmp, 'wt2');
  mkdirSync(join(evil, '.worca-memory'), { recursive: true });
  symlinkSync(notes, join(evil, '.worca-memory', 'notes'));
  assert.deepEqual(Object.keys(await _testing.readTeamNotes(evil)), [], 'a symlinked notes dir is never walked');
});

test('the branch reader skips case twins (git knows both spellings) and caps how many notes and bytes it reads (m3, m15)', async () => {
  const wt = join(tmp, 'wt-twins');
  const notes = join(wt, '.worca-memory', 'notes');
  mkdirSync(notes, { recursive: true });
  const text = (name) => teamNoteText({ name, description: name, paths: [], updated: NOW }, `${name} body`);
  for (const name of ['alpha', 'beta', 'gamma']) writeFileSync(join(notes, `${name}.md`), text(name));
  writeFileSync(join(notes, 'twin.md'), text('twin'));   // a case-insensitive checkout holds one file for both
  execSync('git init -q && git add -A', { cwd: wt, stdio: 'ignore' });
  const sha = execSync('git hash-object -w --stdin', { cwd: wt, input: text('Twin') }).toString().trim();
  execSync(`git update-index --add --cacheinfo 100644,${sha},.worca-memory/notes/Twin.md`, { cwd: wt, stdio: 'ignore' });
  const warns = [];
  const warn = console.warn;
  const gitEnv = process.env.WORCA_GIT;
  console.warn = (m) => warns.push(String(m));
  process.env.WORCA_GIT = '1';   // git is probed at server start; this process never probed it
  try {
    assert.deepEqual(Object.keys(await _testing.readTeamNotes(wt)).sort(), ['alpha', 'beta', 'gamma'], 'neither spelling of a twin is read');
    assert.match(warns.join('\n'), /differ only in case \(twin\)/);
    assert.deepEqual(Object.keys(await _testing.readTeamNotes(wt, { maxFiles: 2 })), ['alpha', 'beta'], 'at most maxFiles notes, in name order');
    const one = Buffer.byteLength(text('alpha'));
    assert.deepEqual(Object.keys(await _testing.readTeamNotes(wt, { maxBytes: one * 2 + 1 })), ['alpha', 'beta'], 'at most maxBytes in all');
    assert.equal(warns.filter((m) => /more notes than this machine reads/.test(m)).length, 2, 'the cap is warned about');
  } finally {
    console.warn = warn;
    if (gitEnv === undefined) delete process.env.WORCA_GIT; else process.env.WORCA_GIT = gitEnv;
  }
});

test('a note named like an Object.prototype member (constructor, toString, __proto__) is a note like any other: no phantom team copy, never emptied by a follow', async () => {
  const K = 'proto-0000002b';
  on(K);
  const scope = projectScope(K);
  for (const name of ['constructor', 'toString', 'plain-note']) await tracked(K, name, note(name, `${name} body, shared once`));
  // The branch was deleted and started again: none of them is on it, and no commit removed one (D3).
  assert.deepEqual(await _testing.reconcileTracked(K, snapshotOf({}), { at: NOW }), { followed: [], removed: [], adopted: [], untracked: ['constructor', 'plain-note', 'toString'] });
  for (const name of ['constructor', 'toString']) {
    const f = await readMemory(memoryRoot(), scope, name);
    assert.match(f.body, new RegExp(`${name} body, shared once`), `${name}: the content stays`);
    assert.equal(f.meta.extra[TEAM_MARKER_KEY], undefined, `${name}: as a plain local note`);
  }
  await tracked(K, 'constructor', note('constructor', 'constructor body, shared again'));
  assert.deepEqual(await _testing.reconcileTracked(K, snapshotOf({}, ['constructor']), { at: NOW }), { followed: [], removed: ['constructor'], adopted: [], untracked: [] });
  assert.equal(await readMemory(memoryRoot(), scope, 'constructor'), null, 'a teammate\'s deletion removes the file, never empties it');
  _testing.writeSnapshot(K, snapshotOf({ ok: {} }));
  assert.equal(await readTeamNote(K, 'constructor'), null, 'Ask reads no phantom teammate\'s note');
  const row = (await teamMemoryStatus(K)).notes.find((n) => n.name === 'toString');
  assert.deepEqual([row.state, row.team, row.shadows], ['local', false, false], 'no phantom team row');
  // A branch file named `__proto__.md` is one more note, never the prototype of the map the reader builds.
  const wt = join(tmp, 'wt-proto');
  mkdirSync(join(wt, '.worca-memory', 'notes'), { recursive: true });
  for (const name of ['__proto__', 'ok']) writeFileSync(join(wt, '.worca-memory', 'notes', `${name}.md`), teamNoteText({ name, description: name, paths: [], updated: NOW }, `${name} body`));
  const read = await _testing.readTeamNotes(wt);
  assert.deepEqual(Object.keys(read).sort(), ['__proto__', 'ok']);
  assert.deepEqual(Object.keys(JSON.parse(JSON.stringify(read))).sort(), ['__proto__', 'ok'], 'team.json keeps it');
  assert.match(read.__proto__.text, /__proto__ body/);
});

test('remove + add again: the project comes back OFF and its local team state is gone', async () => {
  const dir = gitDir('teamrm');
  const p = (await addProject({ name: 'teamrm', path: dir })).find((x) => x.name === 'teamrm');   // addProject returns the list
  writeProjectSettings({ projectDir: dir }, { 'memory.team': true });
  mkdirSync(_testing.paths(p.key).outbox, { recursive: true });
  await removeProject('teamrm');
  assert.equal(isTeamMemoryOn(p.key), false);
  assert.equal(existsSync(_testing.paths(p.key).dir), false);
  await addProject({ name: 'teamrm', path: dir });
  assert.equal(isTeamMemoryOn(p.key), false, 'a re-added project starts off like a new one');
  // A project a workspace still has as a member goes off too: nothing could switch it off once it is not registered.
  const a = gitDir('teamws-a');
  const b = gitDir('teamws-b');
  const pa = (await addProject({ name: 'teamws-a', path: a })).find((x) => x.name === 'teamws-a');
  await addProject({ name: 'teamws-b', path: b });
  await createWorkspace({ name: 'team ws', projectPaths: [a, b] });
  writeProjectSettings({ projectDir: a }, { 'memory.team': true });
  mkdirSync(_testing.paths(pa.key).outbox, { recursive: true });
  await removeProject('teamws-a');
  assert.equal(isTeamMemoryOn(pa.key), false);
  assert.equal(existsSync(_testing.paths(pa.key).dir), false);
});

// ── phase 1b: holds, seeding without a remote, Undo, the offer ──────────────────────────────────────────────────────
test('holdApplies: a hold lasts while the team holds the name (any case) — and while no snapshot says otherwise', () => {
  assert.equal(holdApplies(null, 'build'), true, 'never fetched: the next fetch decides');
  assert.equal(holdApplies({ missing: true, notes: {} }, 'build'), false, 'the branch is gone');
  assert.equal(holdApplies(snapshotOf({ Build: {} }), 'build'), true);
  assert.equal(holdApplies(snapshotOf({ other: {} }), 'build'), false, 'a teammate deleted it');
});

/** A project that had `notes` before its switch-on (each gets 1a's `kept` baseline), on, with `team` as its snapshot. */
async function seeded(K, notes, team) {
  for (const [name, [desc, body]] of Object.entries(notes)) await put(K, name, note(desc, body));
  await recordExistingNotes(K);
  on(K);
  _testing.writeSnapshot(K, snapshotOf(team));
}
const decide = (pv, name, action) => { const n = pv.notes.find((x) => x.name === name); return { name, action, hash: n.hash, teamHash: n.team?.hash ?? null }; };
const rowOf = async (K, name) => (await teamMemoryStatus(K)).notes.find((n) => n.name === name);

test('1b hold: a skipped clash is HELD — an edit queues nothing; once the team drops the name it is a plain local note and the next edit is shared', async () => {
  const K = 'hold-0000000c';
  await seeded(K, { build: ['How to build', 'Mine: make all.'] }, { build: { desc: 'How to build', body: 'Theirs: npm run build.' } });
  const pv = await previewTeamSeed(K);   // no registered checkout: the refresh keeps the snapshot as it is
  assert.equal(pv.notes.find((n) => n.name === 'build').team.same, false);
  const r = await seedTeamMemory(K, [decide(pv, 'build', 'skip')]);
  assert.deepEqual([r.held, r.shared, r.flush], [['build'], [], null]);
  assert.equal((await rowOf(K, 'build')).state, 'held');
  await put(K, 'build', note('How to build', 'Mine: make all -j8.'));   // mine or an agent's
  assert.deepEqual(await queueTeamChanges(K, ['build'], { flush: false }), { queued: [], blocked: [] });
  assert.deepEqual([...(await _testing.queuedNames(K))], []);
  assert.equal((await rowOf(K, 'build')).state, 'held');
  _testing.writeSnapshot(K, snapshotOf({}, ['build']));                 // a teammate deleted their note
  assert.equal((await rowOf(K, 'build')).state, 'local');
  await put(K, 'build', note('How to build', 'Mine: make all -j16.'));
  assert.deepEqual((await queueTeamChanges(K, ['build'], { flush: false })).queued, ['build'], 'the hold is over: 1a shares the edit');
});

test('1b hold: deleting a held note here ends the hold and leaves the team\'s version — no team delete is queued', async () => {
  const K = 'hold-0000000d';
  await seeded(K, { lint: ['How to lint', 'Mine.'] }, { lint: { desc: 'How to lint', body: 'Theirs.' } });
  await seedTeamMemory(K, [decide(await previewTeamSeed(K), 'lint', 'skip')]);
  // As if this machine had shared an earlier version of it: 1a takes such a deletion to the team (D12); a hold never does.
  const record = join(_testing.paths(K).status, 'lint.json');
  writeFileSync(record, JSON.stringify({ ...JSON.parse(readFileSync(record, 'utf8')), sharedHash: 'e'.repeat(40) }));
  await removeMemory(memoryRoot(), projectScope(K), 'lint', { source: 'user' });
  assert.deepEqual(await queueTeamChanges(K, ['lint'], { flush: false }), { queued: [], blocked: [] });
  assert.deepEqual([...(await _testing.queuedNames(K))], []);
  const row = await rowOf(K, 'lint');
  assert.deepEqual([row.state, row.mounted], ['team', true], 'the team\'s version loads here again');
});

test('teamNoteStates: a held record shows `held` while the team holds the name, `local` once it does not; a queued intent wins', () => {
  const local = [{ name: 'a', hash: 'h1', marker: null, updated: null }];
  const statuses = { a: { state: 'held', hash: 'h1' } };
  const stateOfA = (o) => teamNoteStates({ local, statuses, ...o }).find((r) => r.name === 'a').state;   // 'A' (a team row) sorts first
  assert.equal(stateOfA({ snapshot: snapshotOf({ A: {} }) }), 'held');
  assert.equal(stateOfA({ snapshot: snapshotOf({}) }), 'local');
  assert.equal(stateOfA({ queued: new Set(['a']), snapshot: snapshotOf({ a: {} }) }), 'pending');
});

test('1b offer: pending until dismissed or a seeding is finished; it survives a switch-off (offered once per project)', async () => {
  const K = 'offer-0000000e';
  await seeded(K, { a: ['About a', 'A.'] }, {});
  assert.equal(await readSeedOffer(K), 'pending');
  assert.deepEqual((await teamMemoryStatus(K)).seed, { offer: 'pending', last: null });
  await dismissSeedOffer(K);
  assert.equal(await readSeedOffer(K), 'dismissed');
  writeProjectSettings({ projectKey: K }, { 'memory.team': null });
  await teamMemorySettingChanged(K);   // off: projects/<key> is discarded
  assert.equal(existsSync(_testing.paths(K).dir), false);
  on(K);
  assert.equal(await readSeedOffer(K), 'dismissed', 'never offered again for this project on this machine');
  writeProjectSettings({ projectKey: K }, { 'memory.team': null });
  await assert.rejects(dismissSeedOffer(K), (err) => err.code === 'DISABLED');
});

test('1b take team (a case variant too): my copy becomes the team\'s version, tracked, nothing queued; Undo puts mine back as a plain local note', async () => {
  const K = 'take-0000000f';
  await seeded(K, { deploy: ['Deploy steps', 'Mine: ./deploy.sh'] }, { Deploy: { desc: 'Deploy steps', body: 'Theirs: npm run deploy.' } });
  const pv = await previewTeamSeed(K);
  assert.equal(pv.notes.find((n) => n.name === 'deploy').team.name, 'Deploy', 'clashes are case-insensitive (D9)');
  const r = await seedTeamMemory(K, [decide(pv, 'deploy', 'take-team')]);
  assert.deepEqual([r.tookTeam, r.flush], [['Deploy'], null]);
  assert.deepEqual((await listMemory(memoryRoot(), projectScope(K))).map((e) => e.name), ['Deploy']);
  const f = await readMemory(memoryRoot(), projectScope(K), 'Deploy');
  assert.match(f.body, /Theirs: npm run deploy\./);
  assert.equal(f.meta.extra[TEAM_MARKER_KEY], contentHash({ ...f.meta, name: 'Deploy' }, f.body), 'a tracked copy');
  assert.equal((await rowOf(K, 'Deploy')).state, 'shared');
  assert.deepEqual([...(await _testing.queuedNames(K))], []);
  assert.ok((await listSnapshots(memoryRoot(), projectScope(K))).some((s) => s.id === r.snapshotId && /-seed(-\d+)?$/.test(s.id)));
  const u = await undoTeamSeed(K);
  assert.deepEqual(u.restored, ['deploy']);
  assert.deepEqual((await listMemory(memoryRoot(), projectScope(K))).map((e) => e.name), ['deploy']);
  assert.match((await readMemory(memoryRoot(), projectScope(K), 'deploy')).body, /Mine: \.\/deploy\.sh/);
  const row = await rowOf(K, 'deploy');
  assert.deepEqual([row.state, row.shadows], ['local', true]);
  assert.deepEqual([...(await _testing.queuedNames(K))], [], 'Undo pushes nothing');
  assert.equal((await teamMemoryStatus(K)).seed.last, null);
  await assert.rejects(undoTeamSeed(K), (err) => err.code === 'ENOSEED');
});

test('1b compare-and-swap: a note edited, or a team version changed, since the review is STALE — nothing written', async () => {
  const K = 'stale-00000010';
  await seeded(K, { a: ['About a', 'A one.'], b: ['About b', 'Mine.'] }, { b: { desc: 'About b', body: 'Theirs one.' } });
  const pv = await previewTeamSeed(K);
  await put(K, 'a', note('About a', 'A two.'));
  _testing.writeSnapshot(K, snapshotOf({ b: { desc: 'About b', body: 'Theirs two.' } }));
  const snaps = (await listSnapshots(memoryRoot(), projectScope(K))).length;
  await assert.rejects(seedTeamMemory(K, [decide(pv, 'a', 'share'), decide(pv, 'b', 'take-team')]),
    (err) => err.code === 'STALE' && err.names.join() === 'a,b');
  assert.equal((await listSnapshots(memoryRoot(), projectScope(K))).length, snaps, 'no snapshot');
  assert.equal((await teamMemoryStatus(K)).seed.last, null, 'no journal');
  assert.equal(await readSeedOffer(K), 'pending');
});

test('1b: a note the remote refused is never seeded (D5) — listed as blocked; a share of it is STALE', async () => {
  const K = 'remote-00000011';
  await seeded(K, { leak: ['About leak', 'Looks clean to the gate.'] }, {});
  const f = await readMemory(memoryRoot(), projectScope(K), 'leak');
  const hash = contentHash({ ...f.meta, name: 'leak' }, f.body);
  writeFileSync(join(_testing.paths(K).status, 'leak.json'), JSON.stringify({ state: 'blocked', hash, sharedHash: null, reason: 'the remote refused it (secret scanning or a repository rule)',
    findings: [{ rule: 'remote', kind: 'remote', label: 'refused by the remote', field: 'body', line: null }], error: null, at: NOW }));
  const pv = await previewTeamSeed(K);
  assert.match(pv.notes.find((n) => n.name === 'leak').blocked.reason, /remote refused/);
  await assert.rejects(seedTeamMemory(K, [decide(pv, 'leak', 'share')]), (err) => err.code === 'STALE');
  // A recorded verdict is blocked whatever its findings say: listed with its reason.
  writeFileSync(join(_testing.paths(K).status, 'leak.json'), JSON.stringify({ state: 'blocked', hash, sharedHash: null, reason: 'refused earlier', findings: [], error: null, at: NOW }));
  assert.equal((await previewTeamSeed(K)).notes.find((n) => n.name === 'leak').blocked?.reason, 'refused earlier');
});

test('1b validation: decisions are a non-empty list of valid names, known actions and reviewed hashes; skip and take-team need a team version', async () => {
  const K = 'valid-00000012';
  await seeded(K, { a: ['About a', 'A.'] }, {});
  const h = 'a'.repeat(40);
  for (const bad of [undefined, [], [{ name: 'my note', action: 'share', hash: h }], [{ name: 'a', action: 'publish', hash: h }], [{ name: 'a', action: 'share' }],
    [{ name: 'a', action: 'share', hash: h }, { name: 'A', action: 'share', hash: h }]]) {
    await assert.rejects(seedTeamMemory(K, bad), (err) => err.code === 'EBADREQ', JSON.stringify(bad));
  }
  const pv = await previewTeamSeed(K);
  await assert.rejects(seedTeamMemory(K, [decide(pv, 'a', 'skip')]), (err) => err.code === 'EBADREQ' && /holds no note/.test(err.message));
  await assert.rejects(resolveTeamClash(K, decide(pv, 'a', 'share')), (err) => err.code === 'EBADREQ', 'Compare needs a team version');
});

test('1b Undo cancels a share that has not landed (push nothing) and releases the holds; the notes stay as they are', async () => {
  const K = 'undo-00000013';
  await seeded(K, { a: ['About a', 'A.'], lint: ['How to lint', 'Mine.'] }, { lint: { desc: 'How to lint', body: 'Theirs.' } });
  const pv = await previewTeamSeed(K);
  const r = await seedTeamMemory(K, [decide(pv, 'a', 'share'), decide(pv, 'lint', 'skip')]);
  assert.deepEqual([r.shared, r.flush.ok, r.flush.code], [['a'], false, 'NO_LOCAL_PROJECT']);
  assert.equal((await rowOf(K, 'a')).state, 'pending');
  const u = await undoTeamSeed(K);
  assert.deepEqual([u.cancelled, u.restored, u.released], [['a'], [], ['lint']]);
  assert.deepEqual([...(await _testing.queuedNames(K))], []);
  assert.deepEqual([(await rowOf(K, 'a')).state, (await rowOf(K, 'lint')).state], ['local', 'local']);
  // Both are plain local notes with their content as the baseline: a re-save uploads nothing.
  for (const n of ['a', 'lint']) await put(K, n, (await readMemory(memoryRoot(), projectScope(K), n)).text);
  assert.deepEqual((await queueTeamChanges(K, ['a', 'lint'], { flush: false })).queued, []);
});

test('1b: a note recorded BLOCKED is never a decision — listed as blocked even when the team holds its name, so the dialog\'s defaults commit', async () => {
  const K = 'blkclash-00000014';
  await seeded(K, { alpha: ['About alpha', 'Clean.'], oncall: ['Paging', 'Mine, clean.'] }, { oncall: { desc: 'Paging', body: 'Theirs.' } });
  await put(K, 'oncall', note('Paging', 'Mail ops-lead@acme.io.'));   // an edit after opt-in that the gate blocks
  assert.equal((await queueTeamChanges(K, ['oncall'], { flush: false })).blocked.length, 1);
  const pv = await previewTeamSeed(K);
  const oncall = pv.notes.find((n) => n.name === 'oncall');
  assert.deepEqual([oncall.state, !!oncall.blocked, oncall.team.same], ['blocked', true, false]);
  const box = renderSeedReview(pv, { doc: new JSDOM('<!doctype html><body></body>').window.document });
  box.querySelector('.mem-seed-check[data-name="alpha"]').checked = true;
  const decisions = collectSeedDecisions(box);
  assert.deepEqual(decisions.map((d) => [d.name, d.action]), [['alpha', 'share']], 'the blocked note is no clash to decide');
  const r = await seedTeamMemory(K, decisions);
  assert.deepEqual([r.shared, r.held], [['alpha'], []]);
  assert.equal((await rowOf(K, 'oncall')).state, 'blocked', 'it stays here, blocked');
});

test('1b hold: a held note edited, then deleted, keeps both baselines — writing back the edited text, or the text from before the seeding, uploads nothing', async () => {
  const K = 'heldbase-00000015';
  await seeded(K, { build: ['How to build', 'Mine, v0.'] }, { build: { desc: 'How to build', body: 'Theirs.' } });
  const v0 = (await readMemory(memoryRoot(), projectScope(K), 'build')).text;
  await seedTeamMemory(K, [decide(await previewTeamSeed(K), 'build', 'skip')]);
  await put(K, 'build', note('How to build', 'Mine, v1.'));   // held: the record follows the content
  assert.deepEqual((await queueTeamChanges(K, ['build'], { flush: false })).queued, []);
  const v1 = (await readMemory(memoryRoot(), projectScope(K), 'build')).text;
  await removeMemory(memoryRoot(), projectScope(K), 'build', { source: 'user' });
  assert.deepEqual((await queueTeamChanges(K, ['build'], { flush: false })).queued, [], 'the hold ends: nothing reaches the team');
  for (const [text, what] of [[v1, 'the edited text'], [v0, 'the text from before the seeding'], [v1, 'the edited text again']]) {
    await put(K, 'build', text);   // a History restore, an Ask remember of the old text
    assert.deepEqual((await queueTeamChanges(K, ['build'], { flush: false, restore: true })).queued, [], what);
  }
  assert.deepEqual([...(await _testing.queuedNames(K))], []);
});

test('1b take team keeps the note\'s opt-in baseline: a History restore of the seeding\'s snapshot brings my text back and uploads nothing — and deleting that note then leaves the team\'s version alone', async () => {
  const K = 'takebase-00000016';
  await seeded(K, { build: ['How to build', 'Mine, from before opt-in.'] }, { build: { desc: 'How to build', body: 'Theirs.' } });
  const r = await seedTeamMemory(K, [decide(await previewTeamSeed(K), 'build', 'take-team')]);
  const scope = projectScope(K);
  const before = await listMemory(memoryRoot(), scope);
  await restoreSnapshot(memoryRoot(), scope, r.snapshotId, { source: 'user' });
  const changed = changedNoteNames(before, await listMemory(memoryRoot(), scope));
  assert.deepEqual(changed, ['build']);
  assert.deepEqual(await queueTeamChanges(K, changed, { restore: true, source: 'user', flush: false }), { queued: [], blocked: [] });
  const row = await rowOf(K, 'build');
  assert.deepEqual([row.state, row.shadows], ['local', true]);
  // My note, never shared, is a plain local note again: removing it here is no team delete of the teammate's version.
  await removeMemory(memoryRoot(), scope, 'build', { source: 'user' });
  assert.deepEqual(await queueTeamChanges(K, ['build'], { flush: false }), { queued: [], blocked: [] });
  const gone = await rowOf(K, 'build');
  assert.deepEqual([gone.state, gone.mounted], ['team', true], 'the team\'s version loads here again');
});

test('1b take team\'s opt-in baseline outlives what 1a does to the tracked copy since — a teammate\'s update or deletion followed, the branch started again, a team version too big to follow, an edit taken out again: a History restore of the seeding\'s snapshot still uploads nothing (D1, D13)', async () => {
  const follow = async (K, snap, key) => { _testing.writeSnapshot(K, snap); return (await _testing.reconcileTracked(K, snap, { at: NOW }))[key]; };
  const theirs = (body) => snapshotOf({ build: { desc: 'How to build', body } });
  const editTakenOut = async (K, edit) => {
    const taken = (await readMemory(memoryRoot(), projectScope(K), 'build')).text;
    await put(K, 'build', taken.replace('Theirs v1.', edit));   // an edit of the taken copy (its marker rides along): blocked, or queued
    await queueTeamChanges(K, ['build'], { flush: false });
    await put(K, 'build', taken);                                // taken out again: the team's version, as synced
    assert.deepEqual((await queueTeamChanges(K, ['build'], { flush: false })).queued, [], edit);
    assert.equal((await rowOf(K, 'build')).state, 'shared', edit);
  };
  const steps = [
    ['a teammate\'s update followed', async (K) => assert.deepEqual(await follow(K, theirs('Theirs v2, a teammate\'s update.'), 'followed'), ['build'])],
    ['a teammate\'s deletion followed', async (K) => assert.deepEqual(await follow(K, snapshotOf({}, ['build']), 'removed'), ['build'])],
    ['the branch started again without it', async (K) => assert.deepEqual(await follow(K, snapshotOf({}), 'untracked'), ['build'])],
    ['a team version over this machine\'s cap', async (K) => {
      writeProjectSettings({ projectKey: K }, { 'memory.maxBytesPerFile': 4096 });
      await follow(K, theirs(`Theirs: ${'x'.repeat(6000)}`), 'followed');
      assert.equal((await readMemory(memoryRoot(), projectScope(K), 'build')).meta.extra[TEAM_MARKER_KEY], undefined, 'untracked, never followed');
    }],
    ['a blocked edit taken out again', (K) => editTakenOut(K, 'Page ops-lead@acme.io now.')],
    ['a queued edit taken out again', (K) => editTakenOut(K, 'A clean edit, its push still waiting.')],
  ];
  for (const [i, [step, act]] of steps.entries()) {
    const K = `tkstep${i}-0000003${i}`;
    await seeded(K, { build: ['How to build', 'Mine, from before opt-in.'] }, { build: { desc: 'How to build', body: 'Theirs v1.' } });
    const r = await seedTeamMemory(K, [decide(await previewTeamSeed(K), 'build', 'take-team')]);
    await act(K);
    const scope = projectScope(K);
    const before = await listMemory(memoryRoot(), scope);
    await restoreSnapshot(memoryRoot(), scope, r.snapshotId, { source: 'user' });
    assert.match((await readMemory(memoryRoot(), scope, 'build')).body, /Mine, from before opt-in\./);
    const changed = changedNoteNames(before, await listMemory(memoryRoot(), scope));
    assert.deepEqual(await queueTeamChanges(K, changed, { restore: true, source: 'user', flush: false }), { queued: [], blocked: [] }, step);
    assert.deepEqual([...(await _testing.queuedNames(K))], [], `${step}: my text from before opt-in never goes to the team`);
  }
});

test('1b take team of a case variant keeps my spelling\'s baseline: a History restore of the seeding\'s snapshot queues nothing — on a case-sensitive disk too', async () => {
  const K = 'takecase-00000036';
  await seeded(K, { deploy: ['Deploy steps', 'Mine: ./deploy.sh'] }, { Deploy: { desc: 'Deploy steps', body: 'Theirs: npm run deploy.' } });
  const r = await seedTeamMemory(K, [decide(await previewTeamSeed(K), 'deploy', 'take-team')]);
  const scope = projectScope(K);
  const before = await listMemory(memoryRoot(), scope);
  await restoreSnapshot(memoryRoot(), scope, r.snapshotId, { source: 'user' });
  await queueTeamChanges(K, changedNoteNames(before, await listMemory(memoryRoot(), scope)), { restore: true, source: 'user', flush: false });
  // On a case-sensitive disk `deploy` has a record of its own: without a baseline it would be queued, and its push
  // replaces the team's `Deploy.md` (D9: one file per name, case-insensitively).
  assert.deepEqual([...(await _testing.queuedNames(K))], []);
});

test('a note adopted as the team\'s (the same text) keeps its opt-in baseline through a teammate\'s update: a History restore from before the adoption uploads nothing (D1, D13)', async () => {
  const K = 'adoptbase-00000033';
  await seeded(K, { build: ['How to build', 'Same text.'] }, {});
  const scope = projectScope(K);
  const pre = await snapshotScope(memoryRoot(), scope, { source: 'user', now: NOW });   // my note, unmarked
  const same = snapshotOf({ build: { desc: 'How to build', body: 'Same text.' } });
  assert.deepEqual((await _testing.reconcileTracked(K, same, { at: NOW })).adopted, ['build']);
  const update = snapshotOf({ build: { desc: 'How to build', body: 'Theirs v2.' } });
  _testing.writeSnapshot(K, update);
  assert.deepEqual((await _testing.reconcileTracked(K, update, { at: NOW })).followed, ['build']);
  const before = await listMemory(memoryRoot(), scope);
  await restoreSnapshot(memoryRoot(), scope, pre, { source: 'user' });
  assert.deepEqual(await queueTeamChanges(K, changedNoteNames(before, await listMemory(memoryRoot(), scope)), { restore: true, source: 'user', flush: false }), { queued: [], blocked: [] });
  assert.deepEqual([...(await _testing.queuedNames(K))], []);
});

test('D12 still holds for a TRACKED copy back at its baseline after a blocked edit: it keeps its team copy, so deleting it here reaches the team', async () => {
  const K = 'edgeoff-0000001e';
  const scope = projectScope(K);
  // A tracked copy (marker S) edited while the project was off: that edit is its opt-in baseline; the next fetch brings
  // its sharedHash back (reconcileTracked).
  await put(K, 'trap', note('About trap', 'Synced.'));
  const synced = await readMemory(memoryRoot(), scope, 'trap');
  await setMemoryExtra(memoryRoot(), scope, 'trap', TEAM_MARKER_KEY, contentHash({ ...synced.meta, name: 'trap' }, synced.body));
  const marked = (await readMemory(memoryRoot(), scope, 'trap')).text;
  const edited = marked.replace('Synced.', 'Edited while off.');
  await put(K, 'trap', edited);
  await recordExistingNotes(K);
  on(K);
  await _testing.reconcileTracked(K, snapshotOf({ trap: { desc: 'About trap', body: 'Synced.' } }));
  await put(K, 'trap', marked.replace('Synced.', 'Mail ops-lead@acme.io.'));
  assert.equal((await queueTeamChanges(K, ['trap'], { flush: false })).blocked.length, 1);
  await put(K, 'trap', edited);   // the blocked edit undone: no change
  assert.deepEqual((await queueTeamChanges(K, ['trap'], { flush: false })).queued, []);
  await removeMemory(memoryRoot(), scope, 'trap', { source: 'user' });
  assert.deepEqual((await queueTeamChanges(K, ['trap'], { flush: false })).queued, ['trap'], 'a team delete, as for any tracked copy');
});

test('1b Undo keeps a note\'s baselines: a held note it releases, one it puts back and one whose share it cancels upload nothing when their text from before the seeding comes back', async () => {
  const K = 'undobase-00000017';
  const names = ['lint', 'build', 'docs'];
  await seeded(K, Object.fromEntries(names.map((n) => [n, [`About ${n}`, 'Mine, v0.']])), Object.fromEntries(names.map((n) => [n, { desc: `About ${n}`, body: 'Theirs.' }])));
  const v0 = {};
  for (const n of names) v0[n] = (await readMemory(memoryRoot(), projectScope(K), n)).text;
  const pv = await previewTeamSeed(K);
  await seedTeamMemory(K, names.map((n) => decide(pv, n, 'skip')));
  for (const n of names) await put(K, n, note(`About ${n}`, 'Mine, v1, edited while held.'));
  assert.deepEqual((await queueTeamChanges(K, names, { flush: false })).queued, []);
  // A later seeding takes the team's version of `build` and keeps mine of `docs` (no checkout: its push fails). Undo puts
  // the edited `build` back and cancels the share of `docs` — each with its baseline.
  const pv2 = await previewTeamSeed(K);
  await seedTeamMemory(K, [decide(pv2, 'build', 'take-team'), decide(pv2, 'docs', 'share')]);
  const u = await undoTeamSeed(K);
  assert.deepEqual([u.restored, u.cancelled], [['build'], ['docs']]);
  // The first seeding's journal is gone (Undo covers the last one): release `lint` as Undo would, through a third seeding.
  await seedTeamMemory(K, [decide(await previewTeamSeed(K), 'lint', 'skip')]);
  assert.deepEqual((await undoTeamSeed(K)).released, ['lint']);
  for (const n of names) {
    await put(K, n, v0[n]);   // a History restore of the text from before the first seeding
    assert.deepEqual((await queueTeamChanges(K, [n], { flush: false, restore: true })).queued, [], n);
    await put(K, n, note(`About ${n}`, 'Mine, v1, edited while held.'));   // and then of the text Undo left
    assert.deepEqual((await queueTeamChanges(K, [n], { flush: false, restore: true })).queued, [], `${n}: both baselines hold`);
  }
});

test('1b Undo that cannot snapshot the scope first writes nothing: every note waits for Undo again', async () => {
  const K = 'undosnap-0000001c';
  await seeded(K, { alpha: ['About alpha', 'Mine alpha.'] }, { alpha: { desc: 'About alpha', body: 'Theirs alpha.' } });
  await seedTeamMemory(K, [decide(await previewTeamSeed(K), 'alpha', 'take-team')]);
  const restore = patchFs('cp', (orig) => async (src, dst, ...a) => {
    if (/-seed-undo(-\d+)?[\\/]/.test(String(dst))) throw Object.assign(new Error('ENOSPC: no space left on device'), { code: 'ENOSPC' });
    return orig(src, dst, ...a);
  });
  let u;
  try { u = await undoTeamSeed(K); } finally { restore(); }
  assert.deepEqual([u.restored, u.failed.map((f) => f.name)], [[], ['alpha']]);
  assert.match(u.failed[0].error, /ENOSPC/);
  assert.match((await readMemory(memoryRoot(), projectScope(K), 'alpha')).body, /Theirs alpha\./, 'nothing was overwritten without a snapshot');
  assert.ok((await teamMemoryStatus(K)).seed.last, 'the journal stays');
});

test('1b: switched off while a seeding applies — nothing is shared, and the one-time offer stays', async () => {
  const K = 'seedoff-0000001d';
  await seeded(K, { alpha: ['About alpha', 'A.'] }, {});
  const pv = await previewTeamSeed(K);
  const g = gateCopy((src, dst) => src.endsWith(`${sep}alpha.md`) && /-seed(-\d+)?[\\/]alpha\.md$/.test(dst));
  let r;
  try {
    const p = seedTeamMemory(K, [decide(pv, 'alpha', 'share')]);
    await g.atGate;
    writeProjectSettings({ projectKey: K }, { 'memory.team': null });
    g.release();
    r = await p;
  } finally { g.restore(); }
  assert.deepEqual([r.shared, r.flush], [[], null]);
  assert.equal(await readSeedOffer(K), 'pending');
});

test('1b take team never overwrites an edit another process lands while the scope is snapshotted: STALE, and the edit stays', async () => {
  const K = 'xproca-00000018';
  await seeded(K, { alpha: ['About alpha', 'Mine alpha.'], zeta: ['About zeta', 'Zeta.'] }, { alpha: { desc: 'About alpha', body: 'Theirs alpha.' } });
  const pv = await previewTeamSeed(K);
  // The seeding's snapshot copies alpha.md, then parks on zeta.md: the review is checked, nothing is written yet.
  const g = gateCopy((src, dst) => src.endsWith(`${sep}zeta.md`) && /-seed(-\d+)?[\\/]zeta\.md$/.test(dst));
  try {
    const p = seedTeamMemory(K, [decide(pv, 'alpha', 'take-team')]);
    await g.atGate;
    await put(K, 'alpha', note('About alpha', 'Another process wrote this.'));   // a CLI run's sync-back: its own store lock
    g.release();
    await assert.rejects(p, (err) => err.code === 'STALE' && err.names.join() === 'alpha');
  } finally { g.restore(); }
  assert.match((await readMemory(memoryRoot(), projectScope(K), 'alpha')).body, /Another process wrote this\./);
  assert.equal((await teamMemoryStatus(K)).seed.last, null, 'no journal');
  assert.equal(await readSeedOffer(K), 'pending');
});

test('1b Undo never overwrites an edit another process lands while it snapshots the scope: that note waits for Undo again, which keeps the edit in History — and leaves the notes it already put back alone', async () => {
  const K = 'xprocb-00000019';
  await seeded(K, { alpha: ['About alpha', 'Mine alpha.'], beta: ['About beta', 'Mine beta.'], zeta: ['About zeta', 'Zeta.'] },
    { alpha: { desc: 'About alpha', body: 'Theirs alpha.' }, beta: { desc: 'About beta', body: 'Theirs beta.' } });
  const pv = await previewTeamSeed(K);
  await seedTeamMemory(K, [decide(pv, 'alpha', 'take-team'), decide(pv, 'beta', 'take-team')]);
  const g = gateCopy((src, dst) => src.endsWith(`${sep}zeta.md`) && /-seed-undo(-\d+)?[\\/]zeta\.md$/.test(dst));
  let u;
  try {
    const p = undoTeamSeed(K);
    await g.atGate;
    await put(K, 'alpha', note('About alpha', 'Another process wrote this.'));
    g.release();
    u = await p;
  } finally { g.restore(); }
  assert.deepEqual([u.restored, u.failed.map((f) => f.name)], [['beta'], ['alpha']]);
  assert.match((await readMemory(memoryRoot(), projectScope(K), 'alpha')).body, /Another process wrote this\./);
  assert.equal((await teamMemoryStatus(K)).seed.last?.tookTeam, 2, 'the journal stays, and the Team view still names the seeding as it was');
  await put(K, 'beta', note('About beta', 'My edit after the Undo.'));   // beta is mine again
  assert.deepEqual((await queueTeamChanges(K, ['beta'], { flush: false })).queued, ['beta']);
  assert.deepEqual((await undoTeamSeed(K)).restored, ['alpha'], 'Undo again puts my note back');
  assert.match((await readMemory(memoryRoot(), projectScope(K), 'alpha')).body, /Mine alpha\./);
  assert.match((await readMemory(memoryRoot(), projectScope(K), 'beta')).body, /My edit after the Undo\./, 'never reverted again');
  const kept = (await listSnapshots(memoryRoot(), projectScope(K))).filter((s) => existsSync(join(s.dir, 'alpha.md')) && /Another process wrote this/.test(readFileSync(join(s.dir, 'alpha.md'), 'utf8')));
  assert.ok(kept.length, 'the other process\'s edit is in History');
});

test('1b: a share is checked against the branch as it is now — when that fetch fails nothing is shared (FETCH_FAILED); take team still applies', async () => {
  const K = 'offline-0000001a';
  await seeded(K, { alpha: ['About alpha', 'A.'], build: ['How to build', 'Mine.'] }, { build: { desc: 'How to build', body: 'Theirs.' } });
  const pv = await previewTeamSeed(K);
  const projectDir = mkdtempSync(join(tmp, 'no-checkout-'));   // git fetch fails here: not a repository
  await assert.rejects(seedTeamMemory(K, [decide(pv, 'alpha', 'share')], { projectDir }), (err) => err.code === 'FETCH_FAILED' && /try again/.test(err.message));
  await assert.rejects(resolveTeamClash(K, decide(pv, 'build', 'share'), { projectDir }), (err) => err.code === 'FETCH_FAILED', 'keep mine');
  assert.deepEqual([...(await _testing.queuedNames(K))], []);
  assert.deepEqual([(await teamMemoryStatus(K)).seed.last, await readSeedOffer(K)], [null, 'pending'], 'nothing recorded');
  const r = await seedTeamMemory(K, [decide(pv, 'build', 'take-team')], { projectDir });
  assert.deepEqual([r.tookTeam, r.shared], [['build'], []]);
});

test('1b take team of a team note over this machine\'s per-file cap: the preview says so, and the commit refuses (ETOOBIG) before it writes anything', async () => {
  const K = 'toobig-0000001b';
  await seeded(K, { big: ['Big one', 'Mine, small.'] }, { Big: { desc: 'Big one', body: `Theirs: ${'x'.repeat(6000)}` } });
  writeProjectSettings({ projectKey: K }, { 'memory.maxBytesPerFile': 4096 });
  const pv = await previewTeamSeed(K);
  const n = pv.notes.find((x) => x.name === 'big');
  assert.deepEqual([n.team.name, n.team.tooBig], ['Big', true]);
  const snaps = (await listSnapshots(memoryRoot(), projectScope(K))).length;
  await assert.rejects(seedTeamMemory(K, [decide(pv, 'big', 'take-team')]), (err) => err.code === 'ETOOBIG');
  assert.equal((await listSnapshots(memoryRoot(), projectScope(K))).length, snaps, 'no snapshot');
  assert.equal(existsSync(_testing.paths(K).seedJournal), false, 'no journal');
  assert.match((await readMemory(memoryRoot(), projectScope(K), 'big')).body, /Mine, small\./, 'my note (a case variant of the team\'s) is untouched');
  assert.equal(await readSeedOffer(K), 'pending');
});
