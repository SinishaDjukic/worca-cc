// test/memory-proposals.test.mjs — #943: an ordinary run's memory is FROZEN at its start (memory-loaded), and what its
// agents write into the writable copy becomes PROPOSALS a person approves or rejects; nothing reaches the store on its
// own. Pure over temp dirs: the store root, the frozen set, the writable copy and the rules copy are all injected.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile, writeFile, mkdir, unlink, readdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { useTempHome } from './helpers/temp-home.mjs';
import { mountMemory, readFrozenSet, frozenManifest, writeFrozenCopies, renderRoleNotes, syncHash } from '../src/core/memory-sync.mjs';
import { captureProposals, listProposals, approveProposal, rejectProposal, proposalsDir } from '../src/core/memory-proposals.mjs';
import { writeMemory, readMemory, listMemory, GLOBAL_SCOPE, projectScope } from '../src/core/memory-store.mjs';

useTempHome(after);
const cleanup = [];
after(async () => { for (const d of cleanup) await rm(d, { recursive: true, force: true }); });

const NOW = '2026-10-31T10:00:00.000Z';
const RUN = 'run-0001';
const PK = 'shop-0000abcd';
const DIRS = [
  { scope: GLOBAL_SCOPE, rel: 'global', label: 'Global' },
  { scope: projectScope(PK), rel: 'project', label: 'Project shop' },
];
const sha256 = (t) => createHash('sha256').update(t, 'utf8').digest('hex');
const refs = (list) => list.map((r) => `${r.scope}/${r.name}:${r.kind}`).sort();

async function tmp(prefix) {
  const d = await mkdtemp(join(tmpdir(), prefix));
  cleanup.push(d);
  return d;
}

/** A store with global/testing + project/lesson, frozen at "run start" exactly as the harness does it: mountMemory
 *  into memory-loaded, then the writable + rules copies from readFrozenSet. */
async function fixture() {
  const base = await tmp('worca-prop-');
  const root = join(base, 'store');
  const loaded = join(base, 'run', 'memory-loaded');
  const mount = join(base, 'run', 'memory');
  const rules = join(base, 'cwd', '.claude', 'rules', 'worca');
  await writeMemory(root, GLOBAL_SCOPE, 'testing', 'How the suite runs.\n', { source: 'user', now: NOW });
  await writeMemory(root, projectScope(PK), 'lesson', 'Run npm ci first.\n', { source: 'user', now: NOW });
  await mountMemory({ root, mount: loaded, dirs: DIRS });
  const entries = await readFrozenSet(loaded);
  const baseline = await writeFrozenCopies({ entries, mount, rules, dirs: DIRS });
  const frozenText = (path) => entries.find((e) => e.path === path).text;
  const capture = (o = {}) => captureProposals({ root, runId: RUN, mount, dirs: DIRS, baseline, entries, executionId: 'x:implementer:1', agentKey: 'implementer', now: NOW, ...o });
  return { root, loaded, mount, rules, entries, baseline, frozenText, capture };
}

// ── captureProposals ──────────────────────────────────────────────────────────

test('captureProposals: a new note and an edit become write proposals; the store is untouched; the writable copy goes back to the frozen set', async () => {
  const { root, mount, frozenText, capture } = await fixture();
  await writeFile(join(mount, 'project', 'ci-trap.md'), 'Pin TZ=UTC in CI.\n');
  await writeFile(join(mount, 'global', 'testing.md'), 'How the suite runs — with npm ci.\n');
  const r = await capture();
  assert.deepEqual(refs(r.proposed), ['global/testing:write', 'project/ci-trap:write']);
  assert.deepEqual(r.rejected, []);
  // The store never sees them.
  assert.equal(await readMemory(root, projectScope(PK), 'ci-trap'), null);
  assert.equal((await readMemory(root, GLOBAL_SCOPE, 'testing')).text, frozenText('global/testing.md'));
  // Back to the frozen set.
  assert.equal(existsSync(join(mount, 'project', 'ci-trap.md')), false, 'a new file goes');
  assert.equal(await readFile(join(mount, 'global', 'testing.md'), 'utf8'), frozenText('global/testing.md'), 'an edit gets its frozen text back');
  // The pending proposals.
  assert.ok(existsSync(join(proposalsDir(root), `${RUN}.json`)));
  const items = await listProposals(root, { runId: RUN });
  assert.equal(items.length, 2);
  const ci = items.find((i) => i.name === 'ci-trap');
  assert.equal(ci.scope, `projects/${PK}`); assert.equal(ci.rel, 'project'); assert.equal(ci.kind, 'write');
  assert.equal(ci.text, 'Pin TZ=UTC in CI.\n'); assert.equal(ci.baseHash, null); assert.equal(ci.current, null);
  assert.equal(ci.runId, RUN); assert.equal(ci.executionId, 'x:implementer:1'); assert.equal(ci.agentKey, 'implementer'); assert.equal(ci.at, NOW);
  assert.equal(ci.stale, false, 'a new note whose name the store still does not hold is not stale');
  assert.match(ci.id, /^[0-9a-f]{16}$/);
  const t = items.find((i) => i.name === 'testing');
  assert.equal(t.scope, 'global');
  assert.equal(t.baseHash, syncHash(frozenText('global/testing.md')));
  assert.equal(t.stale, false);
  assert.equal(t.current, frozenText('global/testing.md'));
});

test('captureProposals: an EMPTIED note and a DELETED file are delete proposals, and both come back in the writable copy', async () => {
  const { root, mount, frozenText, capture } = await fixture();
  await writeFile(join(mount, 'global', 'testing.md'), '  \n');
  await unlink(join(mount, 'project', 'lesson.md'));
  const r = await capture();
  assert.deepEqual(refs(r.proposed), ['global/testing:delete', 'project/lesson:delete']);
  assert.equal(await readFile(join(mount, 'global', 'testing.md'), 'utf8'), frozenText('global/testing.md'));
  assert.equal(await readFile(join(mount, 'project', 'lesson.md'), 'utf8'), frozenText('project/lesson.md'));
  const items = await listProposals(root, { runId: RUN });
  assert.ok(items.every((i) => i.kind === 'delete' && i.text === null), JSON.stringify(items));
});

test('captureProposals: a new EMPTY file is ignored and removed; an unchanged copy proposes nothing and writes no file', async () => {
  const { root, mount, capture } = await fixture();
  await writeFile(join(mount, 'project', 'blank.md'), '\n   \n');
  const r = await capture();
  assert.deepEqual(r.proposed, []);
  assert.deepEqual(r.rejected, []);
  assert.equal(existsSync(join(mount, 'project', 'blank.md')), false);
  assert.equal(existsSync(join(proposalsDir(root), `${RUN}.json`)), false, 'nothing proposed, no proposals file');
  assert.deepEqual(await listProposals(root), []);
});

test('captureProposals: a file whose name is not a memory name is rejected, removed and never proposed', async () => {
  const { root, mount, capture } = await fixture();
  await writeFile(join(mount, 'global', 'my notes.md'), 'Spaces are not allowed.\n');
  const r = await capture();
  assert.deepEqual(r.proposed, []);
  assert.equal(r.rejected.length, 1);
  assert.equal(r.rejected[0].scope, 'global');
  assert.equal(r.rejected[0].name, 'my notes');
  assert.match(r.rejected[0].reason, /invalid name/);
  assert.equal(existsSync(join(mount, 'global', 'my notes.md')), false);
  assert.deepEqual(await listProposals(root, { runId: RUN }), []);
});

test('captureProposals: a later step\'s change to the same note REPLACES the earlier proposal (one item per note per run)', async () => {
  const { root, mount, capture } = await fixture();
  await writeFile(join(mount, 'project', 'ci-trap.md'), 'v1\n');
  await capture({ executionId: 'x:implementer:1' });
  const [first] = await listProposals(root, { runId: RUN });
  await writeFile(join(mount, 'project', 'ci-trap.md'), 'v2\n');
  await capture({ executionId: 'x:implementer:2', now: '2026-10-31T11:00:00.000Z' });
  const items = await listProposals(root, { runId: RUN });
  assert.equal(items.length, 1);
  assert.equal(items[0].id, first.id, 'the same id: run + scope + name');
  assert.equal(items[0].text, 'v2\n');
  assert.equal(items[0].executionId, 'x:implementer:2');
  // An edit that later turns into an emptying replaces it as a deletion of a NEW note → ignored as a new empty file.
  await writeFile(join(mount, 'project', 'ci-trap.md'), '');
  const r = await capture({ executionId: 'x:implementer:3' });
  assert.deepEqual(r.proposed, [], 'a new note emptied again is a new empty file, not a deletion');
  assert.equal((await listProposals(root, { runId: RUN }))[0].text, 'v2\n', 'the earlier proposal stays');
});

test('listProposals: every run without runId, one run with it, oldest first', async () => {
  const { root, mount, capture } = await fixture();
  await writeFile(join(mount, 'project', 'a.md'), 'A.\n');
  await capture({ now: '2026-10-31T12:00:00.000Z' });
  await writeFile(join(mount, 'project', 'b.md'), 'B.\n');
  await capture({ runId: 'run-0002', now: '2026-10-31T09:00:00.000Z' });
  assert.deepEqual((await listProposals(root)).map((i) => `${i.runId}:${i.name}`), ['run-0002:b', `${RUN}:a`]);
  assert.deepEqual((await listProposals(root, { runId: 'run-0002' })).map((i) => i.name), ['b']);
  assert.deepEqual(await listProposals(root, { runId: 'run-none' }), []);
});

// ── approve / reject ─────────────────────────────────────────────────────────

test('approveProposal: writes the store with source run:<runId>, drops the proposal (the file goes with the last one)', async () => {
  const { root, mount, capture } = await fixture();
  await writeFile(join(mount, 'project', 'ci-trap.md'), 'Pin TZ=UTC in CI.\n');
  await writeFile(join(mount, 'global', 'style.md'), 'Terse commit subjects.\n');
  await capture();
  const items = await listProposals(root, { runId: RUN });
  const ci = items.find((i) => i.name === 'ci-trap');
  const res = await approveProposal(root, ci.id, { now: NOW });
  assert.equal(res.applied, true);
  assert.equal(res.item.id, ci.id);
  assert.deepEqual(res.scope, projectScope(PK));
  const stored = await readMemory(root, projectScope(PK), 'ci-trap');
  assert.equal(stored.meta.source, `run:${RUN}`);
  assert.match(stored.body, /Pin TZ=UTC in CI\./);
  assert.deepEqual((await listProposals(root, { runId: RUN })).map((i) => i.name), ['style'], 'only the approved one is dropped');
  assert.equal(await approveProposal(root, ci.id), null, 'approving it twice finds nothing');
  const st = (await listProposals(root, { runId: RUN }))[0];
  await approveProposal(root, st.id, { now: NOW });
  assert.equal((await readMemory(root, GLOBAL_SCOPE, 'style')).meta.source, `run:${RUN}`);
  assert.equal(existsSync(join(proposalsDir(root), `${RUN}.json`)), false, 'the run\'s file is removed once empty');
  assert.equal(await approveProposal(root, 'not-an-id'), null);
  assert.equal(await approveProposal(root, '0123456789abcdef'), null);
});

test('approveProposal of a deletion removes the note from the store', async () => {
  const { root, mount, capture } = await fixture();
  await writeFile(join(mount, 'project', 'lesson.md'), '');
  await capture();
  const [p] = await listProposals(root, { runId: RUN });
  assert.equal(p.kind, 'delete');
  const res = await approveProposal(root, p.id, { now: NOW });
  assert.equal(res.applied, true);
  assert.equal(await readMemory(root, projectScope(PK), 'lesson'), null);
  assert.deepEqual((await listMemory(root, GLOBAL_SCOPE)).map((e) => e.name), ['testing'], 'the other scope is untouched');
});

test('rejectProposal drops the proposal and leaves the store as it was', async () => {
  const { root, mount, frozenText, capture } = await fixture();
  await writeFile(join(mount, 'global', 'testing.md'), 'Rewritten.\n');
  await capture();
  const [p] = await listProposals(root, { runId: RUN });
  const dropped = await rejectProposal(root, p.id);
  assert.equal(dropped.id, p.id);
  assert.deepEqual(await listProposals(root, { runId: RUN }), []);
  assert.equal(existsSync(join(proposalsDir(root), `${RUN}.json`)), false);
  assert.equal((await readMemory(root, GLOBAL_SCOPE, 'testing')).text, frozenText('global/testing.md'));
  assert.equal(await rejectProposal(root, p.id), null, 'gone');
});

test('stale: true once the store copy changed since the run started (an edit, a deletion, a new note of the same name)', async () => {
  const { root, mount, capture } = await fixture();
  await writeFile(join(mount, 'global', 'testing.md'), 'The run\'s version.\n');
  await writeFile(join(mount, 'project', 'lesson.md'), '');
  await writeFile(join(mount, 'project', 'ci-trap.md'), 'New.\n');
  await capture();
  assert.ok((await listProposals(root, { runId: RUN })).every((i) => i.stale === false));
  await writeMemory(root, GLOBAL_SCOPE, 'testing', 'Changed in Chat mid-run.\n', { source: 'ask', now: NOW });
  await writeMemory(root, projectScope(PK), 'ci-trap', 'Someone else wrote it first.\n', { source: 'user', now: NOW });
  await rm(join(root, 'projects', PK, 'lesson.md'));
  const by = Object.fromEntries((await listProposals(root, { runId: RUN })).map((i) => [i.name, i]));
  assert.equal(by.testing.stale, true); assert.match(by.testing.current, /Changed in Chat mid-run\./);
  assert.equal(by['ci-trap'].stale, true);
  assert.equal(by.lesson.stale, true); assert.equal(by.lesson.current, null);
  // Approving a stale one still applies it: the person decided.
  await approveProposal(root, by.testing.id, { now: NOW });
  assert.match((await readMemory(root, GLOBAL_SCOPE, 'testing')).body, /The run's version\./);
});

// ── the frozen set ───────────────────────────────────────────────────────────

async function frozenDir() {
  const dir = join(await tmp('worca-frozen-'), 'memory-loaded');
  const put = async (rel, text) => { await mkdir(join(dir, ...rel.split('/').slice(0, -1)), { recursive: true }); await writeFile(join(dir, ...rel.split('/')), text); };
  await put('global/a.md', '---\nname: a\ndescription: Always on\n---\nRule A.\n');
  await put('global/r.md', '---\nname: r\ndescription: For reviewers\nroles: Reviewer, planner\n---\nCheck the migration order.\n');
  await put('project/p.md', '---\nname: p\ndescription: Scoped\npaths: src/**\n---\nRule P.\n');
  await put('team/t.md', '---\nname: t\ndescription: Team\n---\nTeam rule.\n');
  await put('global/notes.txt', 'not a note');
  await writeFile(join(dir, 'top.md'), 'a note outside every scope folder');
  return dir;
}

test('readFrozenSet: every note under a scope folder, sorted by path, with sha256, bytes, roles and alwaysOn; a missing set is []', async () => {
  const dir = await frozenDir();
  const set = await readFrozenSet(dir);
  assert.deepEqual(set.map((e) => e.path), ['global/a.md', 'global/r.md', 'project/p.md', 'team/t.md'], 'no .txt, no top-level file');
  const by = Object.fromEntries(set.map((e) => [e.name, e]));
  assert.equal(by.a.rel, 'global');
  assert.equal(by.a.sha256, sha256(by.a.text));
  assert.equal(by.a.bytes, Buffer.byteLength(by.a.text));
  assert.deepEqual(by.r.roles, ['reviewer', 'planner'], 'lower-cased');
  assert.deepEqual(by.a.roles, []);
  assert.equal(by.a.alwaysOn, true);
  assert.equal(by.r.alwaysOn, false, 'a role note is not always on');
  assert.equal(by.p.alwaysOn, false, 'a paths note is not always on');
  assert.equal(by.t.rel, 'team');
  assert.deepEqual(await readFrozenSet(join(dir, 'missing')), []);
});

test('frozenManifest: the set hash is stable for identical input and changes with any file; roles ride only the role notes', async () => {
  const dir = await frozenDir();
  const m1 = frozenManifest(await readFrozenSet(dir));
  const m2 = frozenManifest(await readFrozenSet(dir));
  assert.match(m1.set, /^[0-9a-f]{64}$/);
  assert.equal(m1.set, m2.set);
  assert.deepEqual(m1, m2);
  assert.equal(m1.files.length, 4);
  assert.deepEqual(m1.files.find((f) => f.path === 'global/r.md').roles, ['reviewer', 'planner']);
  assert.equal('roles' in m1.files.find((f) => f.path === 'global/a.md'), false);
  assert.deepEqual(Object.keys(m1.files[0]).sort(), ['bytes', 'path', 'sha256']);
  await writeFile(join(dir, 'global', 'a.md'), '---\nname: a\n---\nRule A, changed.\n');
  assert.notEqual(frozenManifest(await readFrozenSet(dir)).set, m1.set);
  assert.equal(frozenManifest([]).set, sha256(''), 'an empty set has a hash too');
});

test('writeFrozenCopies: the writable copy holds the local notes (role notes included, no team); the rules copy every non-role note (team included) behind the sentinel', async () => {
  const dir = await frozenDir();
  const entries = await readFrozenSet(dir);
  const base = await tmp('worca-copies-');
  const mount = join(base, 'memory');
  const rules = join(base, 'cwd', '.claude', 'rules', 'worca');
  await mkdir(join(mount, 'global'), { recursive: true });
  await writeFile(join(mount, 'global', 'leftover.md'), 'from an earlier segment');
  const baseline = await writeFrozenCopies({ entries, mount, rules, dirs: DIRS });
  assert.deepEqual(Object.keys(baseline).sort(), ['global/a.md', 'global/r.md', 'project/p.md']);
  assert.equal(baseline['global/a.md'], syncHash(entries.find((e) => e.name === 'a').text));
  assert.deepEqual((await readdir(join(mount, 'global'))).sort(), ['a.md', 'r.md'], 'removed first: no leftover');
  assert.deepEqual(await readdir(join(mount, 'project')), ['p.md']);
  assert.equal(existsSync(join(mount, 'team')), false, 'team notes never enter the writable copy');
  assert.equal(existsSync(join(mount, '.gitignore')), false);
  assert.equal(await readFile(join(rules, '.gitignore'), 'utf8'), '*\n');
  assert.deepEqual(await readdir(join(rules, 'global')), ['a.md'], 'the role note stays out of the rules copy');
  assert.deepEqual(await readdir(join(rules, 'project')), ['p.md']);
  assert.deepEqual(await readdir(join(rules, 'team')), ['t.md']);
  // A scope with no note still exists in both copies, empty (as mountMemory makes them).
  const only = await writeFrozenCopies({ entries: entries.filter((e) => e.rel !== 'project'), mount, rules, dirs: DIRS });
  assert.deepEqual(await readdir(join(mount, 'project')), []);
  assert.deepEqual(await readdir(join(rules, 'project')), []);
  assert.equal(only['project/p.md'], undefined);
});

test('renderRoleNotes: the bodies of the notes kept for one role, for that role only', async () => {
  const entries = await readFrozenSet(await frozenDir());
  const block = renderRoleNotes(entries, 'reviewer');
  assert.ok(block.startsWith('## Worca memory for the reviewer role\n'), block);
  assert.match(block, /### global\/r\.md\n\nCheck the migration order\./);
  assert.ok(!block.includes('roles:'), 'the body only, never the frontmatter');
  assert.ok(!block.includes('Rule A.'), 'an always-on note is not repeated');
  assert.equal(renderRoleNotes(entries, 'REVIEWER'), block, 'the role is case-insensitive');
  assert.match(renderRoleNotes(entries, 'planner'), /^## Worca memory for the planner role/);
  assert.equal(renderRoleNotes(entries, 'implementer'), '');
  assert.equal(renderRoleNotes(entries, null), '');
  assert.equal(renderRoleNotes([], 'reviewer'), '');
});
