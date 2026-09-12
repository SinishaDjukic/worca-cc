import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { mountDirs, mountMemory, baselineKey, validateMemoryScope, MEMORY_SCOPES } from '../src/core/memory-sync.mjs';
import { MEMORY_DEFRAG_WORKFLOW_ID } from '../src/core/graph/builtin-workflows.mjs';
import { writeMemory, GLOBAL_SCOPE, projectScope, hashText, listMemoryDir } from '../src/core/memory-store.mjs';

const CAPS = { softBytesPerFile: 8192, hardBytesPerFile: 32768, maxFilesPerScope: 50, indexMaxBytes: 4096, hookMaxChars: 160 };
const NOW = '2026-09-09T10:00:00.000Z';
const dirs = [];
after(() => Promise.all(dirs.map((d) => rm(d, { recursive: true, force: true }))));
async function tmp(p = 'worca-mem-sync-') { const d = await mkdtemp(join(tmpdir(), p)); dirs.push(d); return d; }
const MEMBERS = [{ projectKey: 'beta-2222bbbb', projectName: 'Beta' }, { projectKey: 'alpha-1111aaaa', projectName: 'Alpha' }];

test('mountDirs: single run = global + project; workspace = global + one per member (sorted); memoryScope filters', () => {
  assert.deepEqual(mountDirs({ members: [MEMBERS[0]], isWorkspace: false }), [
    { scope: GLOBAL_SCOPE, rel: 'global', label: 'Global' },
    { scope: projectScope('beta-2222bbbb'), rel: 'project', label: 'Project Beta' },
  ]);
  assert.deepEqual(mountDirs({ members: MEMBERS, isWorkspace: true }).map((d) => d.rel), ['global', 'projects/alpha-1111aaaa', 'projects/beta-2222bbbb']);
  assert.deepEqual(mountDirs({ members: [MEMBERS[0]], isWorkspace: false, memoryScope: 'global' }).map((d) => d.rel), ['global']);
  assert.deepEqual(mountDirs({ members: [MEMBERS[0]], isWorkspace: false, memoryScope: 'project' }).map((d) => d.rel), ['project']);
  assert.throws(() => mountDirs({ members: MEMBERS, isWorkspace: true, memoryScope: 'project' }), /single-project/);
});

test('mountMemory: copies every scope file, creates empty dirs, returns a hash baseline; a remount clears stale files', async () => {
  const root = await tmp('worca-mem-root-');
  const mount = join(await tmp(), 'memory');
  await writeMemory(root, GLOBAL_SCOPE, 'testing', 'T', { source: 'user', now: NOW, caps: CAPS });
  await writeMemory(root, projectScope('beta-2222bbbb'), 'conv', 'C', { source: 'user', now: NOW, caps: CAPS });
  const d = mountDirs({ members: [MEMBERS[0]], isWorkspace: false });
  const m = await mountMemory({ root, mount, dirs: d });
  assert.equal(m.files, 2);
  const tText = await readFile(join(mount, 'global', 'testing.md'), 'utf8');
  assert.equal(tText, await readFile(join(root, 'global', 'testing.md'), 'utf8'));
  assert.deepEqual(Object.keys(m.baseline).sort(), ['global/testing.md', 'project/conv.md']);
  assert.equal(m.baseline[baselineKey('global', 'testing')], hashText(tText));
  // A stale file in the mount (from a previous segment) is gone after a remount.
  await writeFile(join(mount, 'project', 'stale.md'), 'x');
  const m2 = await mountMemory({ root, mount, dirs: d });
  assert.equal(existsSync(join(mount, 'project', 'stale.md')), false);
  assert.equal(m2.files, 2);
});

test('mountMemory: an empty / missing store still creates every mount dir with no files', async () => {
  const root = join(await tmp(), 'never-created');
  const mount = join(await tmp(), 'memory');
  const m = await mountMemory({ root, mount, dirs: mountDirs({ members: MEMBERS, isWorkspace: true }) });
  assert.equal(m.files, 0);
  assert.deepEqual(m.baseline, {});
  for (const rel of ['global', 'projects/alpha-1111aaaa', 'projects/beta-2222bbbb']) assert.ok(existsSync(join(mount, rel)), rel);
  assert.deepEqual(await listMemoryDir(join(mount, 'global')), []);
});

import { mkdir } from 'node:fs/promises';
import { syncBack, memoryTotals } from '../src/core/memory-sync.mjs';
import { readMemory, listMemory, listSnapshots, readScopeState } from '../src/core/memory-store.mjs';

async function fixture() {
  const root = await tmp('worca-mem-root-');
  const mount = join(await tmp(), 'memory');
  await writeMemory(root, GLOBAL_SCOPE, 'testing', 'T1', { source: 'user', now: NOW, caps: CAPS });
  await writeMemory(root, projectScope('beta-2222bbbb'), 'conv', 'C1', { source: 'user', now: NOW, caps: CAPS });
  const d = mountDirs({ members: [MEMBERS[0]], isWorkspace: false });
  const m = await mountMemory({ root, mount, dirs: d });
  const warns = [];
  const sync = (over = {}) => syncBack({ root, mount, dirs: d, baseline: m.baseline, source: 'run:p1', now: '2026-09-09T11:00:00.000Z', caps: CAPS, onWarn: (w) => warns.push(w), ...over });
  return { root, mount, d, m, warns, sync };
}
const refs = (list) => list.map((r) => `${r.scope}/${r.name}`);

test('syncBack: nothing changed ⇒ empty result, same baseline, no store write', async () => {
  const { root, m, sync } = await fixture();
  const before = await readScopeState(root, GLOBAL_SCOPE);
  const r = await sync();
  assert.equal(r.total, 0);
  assert.deepEqual(r.baseline, m.baseline);
  assert.deepEqual(await readScopeState(root, GLOBAL_SCOPE), before);
  assert.deepEqual(await listSnapshots(root, GLOBAL_SCOPE), [], 'no snapshot when nothing is written');
});

test('syncBack: a new file without frontmatter lands repaired in the store AND the mount; baseline follows the repaired text', async () => {
  const { root, mount, warns, sync } = await fixture();
  await writeFile(join(mount, 'project', 'traps.md'), 'The build needs npm ci.\n');
  await writeFile(join(mount, 'project', 'notes.md'), '---\nname: other\ndescription: d\n---\nb\n');
  const r = await sync();
  assert.deepEqual(refs(r.added), ['project/notes', 'project/traps']);
  assert.equal(r.total, 2);
  const stored = await readMemory(root, projectScope('beta-2222bbbb'), 'traps');
  assert.equal(stored.meta.source, 'run:p1');
  assert.equal(stored.meta.description, 'The build needs npm ci.');
  assert.equal(await readFile(join(mount, 'project', 'traps.md'), 'utf8'), stored.text, 'the mount is rewritten with the repaired text');
  assert.equal(r.baseline['project/traps.md'], hashText(stored.text));
  assert.equal((await readMemory(root, projectScope('beta-2222bbbb'), 'notes')).meta.name, 'notes', 'the declared name is repaired to the stem');
  assert.equal(warns.filter((w) => /project\/notes\.md declares name "other" — repaired to the filename stem "notes"/.test(w)).length, 1, warns.join('\n'));
  assert.equal((await readScopeState(root, projectScope('beta-2222bbbb'))).writesSinceDefrag, 3);
  const snaps = await listSnapshots(root, projectScope('beta-2222bbbb'));
  assert.equal(snaps.length, 1, 'ONE snapshot per scope per sync');
  assert.deepEqual(snaps[0].files, ['conv.md'], 'it holds the PRE-sync scope');
});

test('syncBack: modified + deleted (store unchanged) are mirrored; a second sync is a no-op', async () => {
  const { root, mount, sync } = await fixture();
  const cur = await readFile(join(mount, 'global', 'testing.md'), 'utf8');
  await writeFile(join(mount, 'global', 'testing.md'), cur.replace(/T1\n$/, 'T2\n'));
  await rm(join(mount, 'project', 'conv.md'));
  const r = await sync();
  assert.deepEqual(refs(r.modified), ['global/testing']);
  assert.deepEqual(refs(r.deleted), ['project/conv']);
  assert.match((await readMemory(root, GLOBAL_SCOPE, 'testing')).body, /T2/);
  assert.equal(await readMemory(root, projectScope('beta-2222bbbb'), 'conv'), null);
  assert.equal((await listSnapshots(root, projectScope('beta-2222bbbb'))).length, 1, 'the deletion was snapshotted');
  const r2 = await syncBack({ root, mount, dirs: mountDirs({ members: [MEMBERS[0]], isWorkspace: false }), baseline: r.baseline, source: 'run:p1', now: NOW, caps: CAPS });
  assert.equal(r2.total, 0);
});

test('syncBack: store changed since mount ⇒ run wins on a modified file (warned), a mount deletion is NOT mirrored (warned)', async () => {
  const { root, mount, warns, sync } = await fixture();
  await writeMemory(root, GLOBAL_SCOPE, 'testing', 'T-from-ask', { source: 'ask:t9', now: NOW, caps: CAPS });
  await writeMemory(root, projectScope('beta-2222bbbb'), 'conv', 'C-from-ask', { source: 'ask:t9', now: NOW, caps: CAPS });
  const cur = await readFile(join(mount, 'global', 'testing.md'), 'utf8');
  await writeFile(join(mount, 'global', 'testing.md'), cur.replace(/T1\n$/, 'T-from-run\n'));
  await rm(join(mount, 'project', 'conv.md'));
  const r = await sync();
  assert.match((await readMemory(root, GLOBAL_SCOPE, 'testing')).body, /T-from-run/, 'run wins');
  assert.match((await readMemory(root, projectScope('beta-2222bbbb'), 'conv')).body, /C-from-ask/, 'kept');
  assert.deepEqual(refs(r.deleted), []);
  assert.equal(warns.length, 2, warns.join('\n'));
  assert.match(warns[0], /global\/testing\.md.*changed in the store since this run mounted it.*run's version wins/);
  assert.match(warns[1], /project\/conv\.md.*deleted by the run but changed in the store.*kept/);
  assert.equal('project/conv.md' in r.baseline, false, 'dropped from the baseline so it is not re-reported');
});

test('syncBack: rejections — invalid name, over the hard cap, case twin, scope full — never touch the store', async () => {
  const { root, mount, sync } = await fixture();
  await writeFile(join(mount, 'global', 'bad name.md'), 'x');
  await writeFile(join(mount, 'global', 'huge.md'), 'h'.repeat(CAPS.hardBytesPerFile + 1));
  // A case twin can NOT be built inside one directory on a case-insensitive FS
  // (macOS/APFS and Windows fold a capitalised twin into the existing lower-case
  // file and overwrite it). Build it the way it really happens instead: the run
  // creates `traps` in the mount while an Ask write lands `Traps` in the store.
  await writeFile(join(mount, 'project', 'traps.md'), 'The build needs npm ci.\n');
  await writeMemory(root, projectScope('beta-2222bbbb'), 'Traps', 'T', { source: 'ask:t9', now: NOW, caps: CAPS });
  const r = await sync();
  const rej = Object.fromEntries(r.rejected.map((x) => [`${x.scope}/${x.name}`, x.reason]));
  assert.match(rej['global/bad name'], /invalid name/);
  assert.match(rej['global/huge'], /over the 32768-byte cap/);
  assert.match(rej['project/traps'], /differ only by case/);
  assert.deepEqual((await listMemory(root, GLOBAL_SCOPE)).map((e) => e.name), ['testing']);
  assert.deepEqual((await listMemory(root, projectScope('beta-2222bbbb'))).map((e) => e.name), ['Traps', 'conv']);
  assert.equal(r.total, 0);
  assert.ok(r.baseline['global/huge.md'], 'a rejected file is baselined so it is reported once, not on every sync');
  // scope full
  const small = { ...CAPS, maxFilesPerScope: 2 };
  await writeFile(join(mount, 'global', 'one.md'), '1');
  await writeFile(join(mount, 'global', 'two.md'), '2');
  const r2 = await sync({ baseline: r.baseline, caps: small });
  assert.deepEqual(refs(r2.added), ['global/one']);
  assert.match(r2.rejected.find((x) => x.name === 'two').reason, /scope is full \(2 files\)/);
  assert.deepEqual(r2.rejected.map((x) => x.name), ['two'], 'junk and the still-too-big file are reported once, not on every sync');
});

test('syncBack: a rejected file is retried when its text or the cap changes, and lands as ADDED', async () => {
  const { mount, sync } = await fixture();
  await writeFile(join(mount, 'global', 'huge.md'), 'h'.repeat(CAPS.hardBytesPerFile + 1));
  const r1 = await sync();
  assert.deepEqual(r1.rejected.map((x) => x.name), ['huge']);
  const r2 = await sync({ baseline: r1.baseline, caps: { ...CAPS, hardBytesPerFile: CAPS.hardBytesPerFile * 4 } });
  assert.deepEqual(refs(r2.added), ['global/huge'], 'a raised cap retries the same text');
  assert.deepEqual(r2.rejected, []);
  await writeFile(join(mount, 'global', 'big2.md'), 'b'.repeat(CAPS.hardBytesPerFile + 1));
  const r3 = await sync({ baseline: r2.baseline });
  assert.deepEqual(r3.rejected.map((x) => x.name), ['big2']);
  await writeFile(join(mount, 'global', 'big2.md'), 'Now it fits.\n');
  const r4 = await sync({ baseline: r3.baseline });
  assert.deepEqual(refs(r4.added), ['global/big2'], 'the store never took it, so it is ADDED, not modified');
  assert.deepEqual(r4.rejected, []);
});

test('syncBack: a store-side write failure rejects that file only; the rest of the sync proceeds', async () => {
  const { root, mount, sync } = await fixture();
  await mkdir(join(root, 'global', 'blocked.md'), { recursive: true });   // the store path is a DIRECTORY: every write to it fails
  await writeFile(join(mount, 'global', 'blocked.md'), 'Blocked.\n');
  await writeFile(join(mount, 'global', 'zlater.md'), 'Later.\n');
  const r = await sync();
  assert.match(r.rejected.find((x) => x.name === 'blocked').reason, /could not write to the store \(E[A-Z]+\)/);
  assert.deepEqual(refs(r.added), ['global/zlater'], 'one file failing never aborts the sync');
  assert.ok(String(r.baseline['global/blocked.md']).startsWith('rejected:'), 'reported once, retried when the text changes');
});

test('withStoreLock: two syncs on one root run one after the other, never interleaved', async () => {
  const { root, mount, sync } = await fixture();
  await writeFile(join(mount, 'global', 'race.md'), 'Race.\n');
  const [a, b] = await Promise.all([sync(), sync()]);
  assert.deepEqual((await listMemory(root, GLOBAL_SCOPE)).map((e) => e.name), ['race', 'testing'], 'one race file in the store');
  assert.deepEqual([...refs(a.added), ...refs(b.added)], ['global/race'], 'the second sync sees the first one in the store: added ONCE');
  assert.deepEqual([...refs(a.modified), ...refs(b.modified)], ['global/race'], 'the serialised second sync re-writes it as a modification');
  assert.deepEqual(memoryTotals([
    { added: [1], modified: [], deleted: [1, 2], rejected: [] },
    { added: [], modified: [1], deleted: [], rejected: [1] },
  ]), { added: 1, modified: 1, deleted: 2, rejected: 1 });
});

test('syncBack: a mount dir that no longer exists is skipped — never read as "every file deleted"', async () => {
  const { root, mount, m, warns, sync } = await fixture();
  await rm(join(mount, 'global'), { recursive: true, force: true });
  const r = await sync();
  assert.deepEqual(r.deleted, []);
  assert.deepEqual((await listMemory(root, GLOBAL_SCOPE)).map((e) => e.name), ['testing'], 'the store is untouched');
  assert.equal(r.baseline['global/testing.md'], m.baseline['global/testing.md'], 'the baseline is kept for the next sync');
  assert.equal(warns.filter((w) => /mount dir global is missing/.test(w)).length, 1, warns.join('\n'));
});

test('syncBack: junk in the STORE scope never blocks an agent write; the snapshot covers the files the scope serves', async () => {
  const { root, mount, warns, sync } = await fixture();
  // A user-dropped file whose name is not a memory name. It is not a memory file, so it
  // is neither served nor snapshotted — and it must not make the scope unwritable.
  await writeFile(join(root, 'global', 'my notes.md'), 'Dropped in by hand.\n');
  await writeFile(join(mount, 'global', 'lesson.md'), 'Run npm ci first.\n');
  const r = await sync();
  assert.deepEqual(r.rejected, [], JSON.stringify(r.rejected));
  assert.deepEqual(refs(r.added), ['global/lesson']);
  assert.match((await readMemory(root, GLOBAL_SCOPE, 'lesson')).body, /npm ci/);
  const snaps = await listSnapshots(root, GLOBAL_SCOPE);
  assert.equal(snaps.length, 1, 'ONE snapshot per scope per sync');
  assert.deepEqual(snaps[0].files, ['testing.md'], 'the junk file is not a memory file: not snapshotted');
  assert.deepEqual(warns, [], warns.join('\n'));
  assert.equal(existsSync(join(root, 'global', 'my notes.md')), true, 'and it is left where the user put it');
});

test('validateMemoryScope: the §7.3 matrix, one reason per refusal', () => {
  assert.deepEqual([...MEMORY_SCOPES], ['global', 'project']);
  const D = MEMORY_DEFRAG_WORKFLOW_ID;
  assert.equal(validateMemoryScope({ workflowId: 'wf_default' }), null);
  assert.equal(validateMemoryScope({ workflowId: 'wf_default', memoryScope: undefined, isWorkspace: true }), null);
  assert.equal(validateMemoryScope({ workflowId: D, memoryScope: 'global' }), null);
  assert.equal(validateMemoryScope({ workflowId: D, memoryScope: 'project' }), null);
  assert.equal(validateMemoryScope({ workflowId: D, memoryScope: 'both' }), 'memoryScope must be "global" or "project"');
  assert.equal(validateMemoryScope({ workflowId: D, memoryScope: 42 }), 'memoryScope must be "global" or "project"');
  assert.equal(validateMemoryScope({ workflowId: 'wf_default', memoryScope: 'global' }), `memoryScope is only valid with the Memory defragment workflow (${D})`);
  assert.equal(validateMemoryScope({ workflowId: D }), 'the Memory defragment workflow needs memoryScope ("global" or "project")');
  assert.equal(validateMemoryScope({ workflowId: D, memoryScope: '' }), 'the Memory defragment workflow needs memoryScope ("global" or "project")');
  assert.equal(validateMemoryScope({ workflowId: D, memoryScope: 'global', isWorkspace: true }), 'a memory defragment run targets one project, not a workspace');
  assert.equal(validateMemoryScope({ workflowId: D, memoryScope: 'project', isWorkspace: true }), 'a memory defragment run targets one project, not a workspace');
  assert.equal(validateMemoryScope({}), null, 'no workflow, no scope: nothing to say (the caller defaults the workflow)');
});

test('marker: a rejected overwrite remembers the STORE hash, so a later mount deletion still mirrors (spec §5 step 5)', async () => {
  const root = await tmp('worca-mem-root-'); const mount = await tmp('worca-mem-mount-');
  const dirs = mountDirs({ members: [] });                                  // global only
  await writeMemory(root, GLOBAL_SCOPE, 'a', 'Rule A.\n', { source: 'user', now: NOW, caps: CAPS });
  const storeHash = (await listMemory(root, GLOBAL_SCOPE))[0].hash;
  const { baseline } = await mountMemory({ root, mount, dirs });
  const big = `---\nname: a\n---\n${'x'.repeat(CAPS.hardBytesPerFile + 1)}\n`;
  await writeFile(join(mount, 'global', 'a.md'), big);
  const s1 = await syncBack({ root, mount, dirs, baseline, source: 'run:p1', now: NOW, caps: CAPS });
  assert.equal(s1.rejected.length, 1);
  assert.match(s1.baseline['global/a.md'], /^rejected:[0-9a-f]{40}:[0-9a-f]{40}$/, 'mount hash AND store hash');
  assert.ok(s1.baseline['global/a.md'].endsWith(`:${storeHash}`));
  const s1b = await syncBack({ root, mount, dirs, baseline: s1.baseline, source: 'run:p1', now: NOW, caps: CAPS });
  assert.equal(s1b.rejected.length, 0, 'the same text is not reported twice');
  assert.equal(s1b.baseline['global/a.md'], s1.baseline['global/a.md'], 'and the marker is stable');
  await rm(join(mount, 'global', 'a.md'));
  const warnings = [];
  const s2 = await syncBack({ root, mount, dirs, baseline: s1b.baseline, source: 'run:p1', now: NOW, caps: CAPS, onWarn: (w) => warnings.push(w) });
  assert.deepEqual(s2.deleted, [{ scope: 'global', name: 'a' }], 'the store was unchanged since the mount, so the deletion mirrors');
  assert.equal(await readMemory(root, GLOBAL_SCOPE, 'a'), null);
  assert.deepEqual(warnings.filter((w) => /kept/.test(w)), []);
});

test('marker: the store changed between the rejection and the deletion ⇒ kept + warned; a legacy two-part marker keeps P1 behaviour', async () => {
  const root = await tmp('worca-mem-root-'); const mount = await tmp('worca-mem-mount-');
  const dirs = mountDirs({ members: [] });
  await writeMemory(root, GLOBAL_SCOPE, 'a', 'Rule A.\n', { source: 'user', now: NOW, caps: CAPS });
  const { baseline } = await mountMemory({ root, mount, dirs });
  await writeFile(join(mount, 'global', 'a.md'), `---\nname: a\n---\n${'x'.repeat(CAPS.hardBytesPerFile + 1)}\n`);
  const s1 = await syncBack({ root, mount, dirs, baseline, source: 'run:p1', now: NOW, caps: CAPS });
  await writeMemory(root, GLOBAL_SCOPE, 'a', 'Rule A, edited by the user.\n', { source: 'user', now: NOW, caps: CAPS });
  await rm(join(mount, 'global', 'a.md'));
  const warnings = [];
  const s2 = await syncBack({ root, mount, dirs, baseline: s1.baseline, source: 'run:p1', now: NOW, caps: CAPS, onWarn: (w) => warnings.push(w) });
  assert.deepEqual(s2.deleted, []);
  assert.ok(await readMemory(root, GLOBAL_SCOPE, 'a'), 'the user edit survives');
  assert.ok(warnings.some((w) => /changed in the store since this run mounted it — kept/.test(w)), warnings.join('\n'));
  // Legacy: a P1 ledger marker without the store hash — the store never vouched for anything.
  const legacy = { 'global/a.md': 'rejected:deadbeefdeadbeefdeadbeefdeadbeefdeadbeef' };
  const w3 = [];
  const s3 = await syncBack({ root, mount, dirs, baseline: legacy, source: 'run:p1', now: NOW, caps: CAPS, onWarn: (w) => w3.push(w) });
  assert.deepEqual(s3.deleted, []);
  assert.ok(w3.some((w) => /deleted by the run after a rejected write — the store's version is kept/.test(w)), w3.join('\n'));
  assert.ok(await readMemory(root, GLOBAL_SCOPE, 'a'));
});

test('B19: an EMPTIED mount file is a deletion (store unchanged ⇒ removed; store changed ⇒ kept + warned); a new empty file is ignored', async () => {
  const root = await tmp('worca-mem-root-'); const mount = await tmp('worca-mem-mount-');
  const mdirs = mountDirs({ members: [] });
  await writeMemory(root, GLOBAL_SCOPE, 'gone', 'Rule.\n', { source: 'user', now: NOW, caps: CAPS });
  await writeMemory(root, GLOBAL_SCOPE, 'kept', 'Rule.\n', { source: 'user', now: NOW, caps: CAPS });
  const { baseline } = await mountMemory({ root, mount, dirs: mdirs });
  await writeFile(join(mount, 'global', 'gone.md'), '');
  await writeFile(join(mount, 'global', 'kept.md'), '\n');
  await writeFile(join(mount, 'global', 'new.md'), '');
  await writeMemory(root, GLOBAL_SCOPE, 'kept', 'Rule, edited.\n', { source: 'user', now: NOW, caps: CAPS });
  const warnings = [];
  const s = await syncBack({ root, mount, dirs: mdirs, baseline, source: 'run:p1', now: NOW, caps: CAPS, onWarn: (w) => warnings.push(w) });
  assert.deepEqual(s.deleted, [{ scope: 'global', name: 'gone' }]);
  assert.deepEqual(s.added, []); assert.deepEqual(s.modified, []); assert.deepEqual(s.rejected, []);
  assert.equal(await readMemory(root, GLOBAL_SCOPE, 'gone'), null);
  assert.ok(await readMemory(root, GLOBAL_SCOPE, 'kept'), 'the user edit survives');
  assert.ok(warnings.some((w) => /global\/kept\.md was deleted by the run but changed in the store/.test(w)), warnings.join('\n'));
  assert.equal(Object.keys(s.baseline).includes('global/new.md'), false, 'a new empty file never enters the baseline');
  const s2 = await syncBack({ root, mount, dirs: mdirs, baseline: s.baseline, source: 'run:p1', now: NOW, caps: CAPS, onWarn: (w) => warnings.push(w) });
  assert.equal(s2.total + s2.rejected.length, 0, 'stable: the empty files are not re-reported');
});

test('B19 runs BEFORE the scope-full pre-check: a new EMPTY mount file in a full scope is ignored, not rejected', async () => {
  // The pre-check must not see a file the run emptied: reading comes first, then B19, then the cap.
  const root = await tmp('worca-mem-root-'); const mount = await tmp('worca-mem-mount-');
  const mdirs = mountDirs({ members: [] });
  const small = { ...CAPS, maxFilesPerScope: 2 };
  await writeMemory(root, GLOBAL_SCOPE, 'one', 'Rule one.\n', { source: 'user', now: NOW, caps: small });
  await writeMemory(root, GLOBAL_SCOPE, 'two', 'Rule two.\n', { source: 'user', now: NOW, caps: small });
  const { baseline } = await mountMemory({ root, mount, dirs: mdirs });
  await writeFile(join(mount, 'global', 'new.md'), '');
  const warnings = [];
  const s = await syncBack({ root, mount, dirs: mdirs, baseline, source: 'run:p1', now: NOW, caps: small, onWarn: (w) => warnings.push(w) });
  assert.deepEqual(s.rejected, [], 'an emptied new file is never reported as "scope is full"');
  assert.deepEqual(s.added, []); assert.deepEqual(s.modified, []); assert.deepEqual(s.deleted, []);
  assert.equal(Object.keys(s.baseline).includes('global/new.md'), false, 'a new empty file never enters the baseline');
  assert.deepEqual((await listMemory(root, GLOBAL_SCOPE)).map((e) => e.name), ['one', 'two']);
});

test('a file rejected, then accepted after a store edit, still warns that the run\'s version wins', async () => {
  // The conflict warning compares the STORE hash the baseline vouches for — not the raw baseline
  // value — so it still fires for a key whose last sync was a rejection (spec §5 step 5).
  const root = await tmp('worca-mem-root-'); const mount = await tmp('worca-mem-mount-');
  const mdirs = mountDirs({ members: [] });
  await writeMemory(root, GLOBAL_SCOPE, 'a', 'Rule A.\n', { source: 'user', now: NOW, caps: CAPS });
  const { baseline } = await mountMemory({ root, mount, dirs: mdirs });
  await writeFile(join(mount, 'global', 'a.md'), `---\nname: a\n---\n${'x'.repeat(CAPS.hardBytesPerFile + 1)}\n`);
  const s1 = await syncBack({ root, mount, dirs: mdirs, baseline, source: 'run:p1', now: NOW, caps: CAPS });
  assert.equal(s1.rejected.length, 1);
  await writeMemory(root, GLOBAL_SCOPE, 'a', 'Rule A, edited by the user.\n', { source: 'user', now: NOW, caps: CAPS });
  await writeFile(join(mount, 'global', 'a.md'), '---\nname: a\n---\nRule A, trimmed by the run.\n');
  const warnings = [];
  const s2 = await syncBack({ root, mount, dirs: mdirs, baseline: s1.baseline, source: 'run:p1', now: NOW, caps: CAPS, onWarn: (w) => warnings.push(w) });
  assert.deepEqual(s2.modified, [{ scope: 'global', name: 'a' }]);
  assert.ok(warnings.some((w) => /global\/a\.md changed in the store since this run mounted it — the run's version wins/.test(w)), warnings.join('\n'));
  assert.match((await readMemory(root, GLOBAL_SCOPE, 'a')).body, /trimmed by the run/);
});
