// test/folder-apply.test.mjs — the server in-process + real mock folder runs.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createRequire, syncBuiltinESMExports } from 'node:module';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync, renameSync, readdirSync, chmodSync, statSync, lstatSync, symlinkSync, readlinkSync, realpathSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join, basename, sep } from 'node:path';
import { useTempHome } from './helpers/temp-home.mjs';
import { ENGINES } from './helpers/engines.mjs';
import { seedPipeline } from './helpers/db-seed.mjs';
import { addProject, worcaHome, displayPath } from '../src/core/projects.mjs';
import { getDb } from '../src/core/db.mjs';
import { readPipelineStateById } from '../src/core/artifacts.mjs';
import { folderMemberTarget } from '../src/core/folder-apply.mjs';
import { withFlipper } from './helpers/folder-flipper.mjs';

useTempHome(after);
const dirs = [];
after(() => { for (const d of dirs) rmSync(d, { recursive: true, force: true }); });
let srv, base;
before(async () => {
  const { app } = await import('../ui/server.mjs');               // imported, not run as main: binds no port of its own
  srv = http.createServer(app); await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${srv.address().port}`;
});
after(async () => { if (srv) await new Promise((r) => srv.close(r)); });
const api = async (method, path, body) => {
  const r = await fetch(`${base}${path}`, { method, headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, body: await r.json().catch(() => null) };
};
const okVerifier = async () => ({ status: 'ok', issues: [], review: { issues: [] }, summary: '' });
// Every producer node runs it, so it is idempotent: the copy ends with notes.txt 'hello world\n', new.txt 'new\n',
// old.txt and docs/ deleted.
const defaultEdit = (c) => {
  writeFileSync(join(c, 'notes.txt'), 'hello world\n'); writeFileSync(join(c, 'new.txt'), 'new\n');
  rmSync(join(c, 'old.txt'), { force: true }); rmSync(join(c, 'docs'), { recursive: true, force: true });
};
async function finished(edit = defaultEdit, seed = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'worca-fapply-')); dirs.push(dir);
  writeFileSync(join(dir, 'notes.txt'), 'hello\n'); writeFileSync(join(dir, 'old.txt'), 'old\n');
  mkdirSync(join(dir, 'docs')); writeFileSync(join(dir, 'docs', 'a.md'), '# A\n');
  for (const [p, body] of Object.entries(seed)) writeFileSync(join(dir, p), body);
  await addProject({ name: basename(dir), path: dir });
  let orch;
  orch = ENGINES[0].create({ projectDir: dir, workMode: 'folder', prompt: 'demo', auto: true, claude: { mock: true },
    runners: { producer: async () => { await edit(orch.runCwd); return { status: 'ok' }; }, verifier: okVerifier } });
  assert.equal((await orch.run()).status, 'done');
  return { dir, id: orch.state.id, pdir: orch.pipeline.dir, copy: orch.getState().branch.copyDir };
}
const ALL = [{ path: 'docs/a.md', change: 'deleted', size: 4 }, { path: 'new.txt', change: 'added', size: 4 },
  { path: 'notes.txt', change: 'modified', size: 12 }, { path: 'old.txt', change: 'deleted', size: 4 }];

test('Changes lists the copy; apply-plan skips a file changed in the folder since the run started (inclusive lists); the patch route', async () => {
  const { dir, id } = await finished();
  assert.deepEqual((await api('GET', `/api/runs/${id}/changes`)).body, { state: 'pending', files: ALL, counts: { added: 1, modified: 1, deleted: 2 } });
  writeFileSync(join(dir, 'notes.txt'), 'mine\n');
  assert.deepEqual((await api('GET', `/api/runs/${id}/apply-plan`)).body,
    { target: dir, displayTarget: displayPath(dir), add: ['new.txt'], update: ['notes.txt'], delete: ['docs/a.md', 'old.txt'], skipped: [{ path: 'notes.txt', reason: 'changed-in-folder' }] });
  const p = await fetch(`${base}/api/runs/${id}/changes/patch`);
  assert.equal(p.status, 200); assert.match(p.headers.get('content-type'), /^text\/plain/);
  assert.match(await p.text(), /^diff --git a\/docs\/a\.md b\/docs\/a\.md\ndeleted file mode 100644\n--- a\/docs\/a\.md\n\+\+\+ \/dev\/null\n/);
});

test('Apply writes added and updated files, deletes removed ones, keeps the folder\'s own edit, saves the skipped version, releases the copy; a second Apply is refused', async () => {
  const { dir, id, pdir } = await finished();
  writeFileSync(join(dir, 'notes.txt'), 'mine\n');
  const r = await api('POST', `/api/runs/${id}/apply`);
  assert.deepEqual([r.status, r.body], [200, { applied: 3, skipped: [{ path: 'notes.txt', reason: 'changed-in-folder' }] }]);
  assert.equal(readFileSync(join(dir, 'new.txt'), 'utf8'), 'new\n');
  assert.equal(readFileSync(join(dir, 'notes.txt'), 'utf8'), 'mine\n');
  assert.deepEqual([existsSync(join(dir, 'old.txt')), existsSync(join(dir, 'docs'))], [false, false]);
  assert.equal(readFileSync(join(pdir, 'skipped', 'notes.txt'), 'utf8'), 'hello world\n');
  assert.equal(existsSync(join(worcaHome(), 'runs', id)), false);
  const after = (await api('GET', `/api/runs/${id}/changes`)).body;
  assert.equal(after.state, 'applied'); assert.equal(typeof after.appliedAt, 'string');
  assert.deepEqual(after.skipped, [{ path: 'notes.txt', reason: 'changed-in-folder' }]);
  assert.equal(JSON.parse(readFileSync(join(pdir, 'changes.json'), 'utf8')).state, 'applied', 'readChangesFile carries the state (P5 S6)');
  writeFileSync(join(dir, 'new.txt'), 'user edit\n');
  const again = await api('POST', `/api/runs/${id}/apply`);
  assert.deepEqual([again.status, again.body.code, again.body.state], [409, 'CHANGES_SETTLED', 'applied']);
  assert.equal(readFileSync(join(dir, 'new.txt'), 'utf8'), 'user edit\n', 'a second apply writes nothing');
});

test('Apply re-scans the copy: a file made in the copy after the run (its terminal opens there) is applied, never lost with the copy', async () => {
  const { dir, id, copy } = await finished();
  writeFileSync(join(copy, 'extra.txt'), 'e\n');
  assert.ok((await api('GET', `/api/runs/${id}/apply-plan`)).body.add.includes('extra.txt'), 'the plan lists it');
  const r = await api('POST', `/api/runs/${id}/apply`);
  assert.deepEqual([r.status, r.body.applied, r.body.skipped], [200, 5, []]);
  assert.equal(readFileSync(join(dir, 'extra.txt'), 'utf8'), 'e\n');
});

test('a file created in the folder at an added path, and an updated file deleted meanwhile, are skipped', async () => {
  const { dir, id } = await finished();
  writeFileSync(join(dir, 'new.txt'), 'theirs\n'); rmSync(join(dir, 'notes.txt'));
  assert.deepEqual((await api('GET', `/api/runs/${id}/apply-plan`)).body.skipped,
    [{ path: 'new.txt', reason: 'changed-in-folder' }, { path: 'notes.txt', reason: 'changed-in-folder' }]);
  await api('POST', `/api/runs/${id}/apply`);
  assert.equal(readFileSync(join(dir, 'new.txt'), 'utf8'), 'theirs\n');
});

test('a folder the run deleted stays when the user added a file to it meanwhile', async () => {
  const { dir, id } = await finished();
  writeFileSync(join(dir, 'docs', 'user.md'), 'u\n');
  await api('POST', `/api/runs/${id}/apply`);
  assert.deepEqual([existsSync(join(dir, 'docs', 'a.md')), existsSync(join(dir, 'docs', 'user.md'))], [false, true]);
});

test('Discard removes the copy and leaves the folder alone; Apply and Discard after it are refused', async () => {
  const { dir, id } = await finished();
  assert.deepEqual((await api('POST', `/api/runs/${id}/discard`)).body, { ok: true });
  assert.deepEqual([readFileSync(join(dir, 'notes.txt'), 'utf8'), existsSync(join(dir, 'old.txt')), existsSync(join(dir, 'new.txt'))], ['hello\n', true, false]);
  assert.equal(existsSync(join(worcaHome(), 'runs', id)), false);
  for (const verb of ['apply', 'discard']) {
    const r = await api('POST', `/api/runs/${id}/${verb}`);
    assert.deepEqual([r.status, r.body.code, r.body.state], [409, 'CHANGES_SETTLED', 'discarded']);
  }
});

test('refusals: a git run, a paused folder run, a foreign memberKey; folderMemberTarget answers the one member', async () => {
  const plain = mkdtempSync(join(tmpdir(), 'worca-fapply-seed-')); dirs.push(plain);
  const git = await seedPipeline(plain, { status: 'done', branch: { source: 'main', feature: 'worca-cc/x' } });
  assert.deepEqual((await api('GET', `/api/runs/${git.id}/changes`)).body, { error: 'This run does not work on a copy.', code: 'NOT_FOLDER_RUN' });
  const paused = await seedPipeline(plain, { status: 'paused', branch: { workMode: 'folder', runRootMode: 'detached' } });
  assert.deepEqual((await api('POST', `/api/runs/${paused.id}/apply`)).body, { error: 'The run has not finished.', code: 'RUN_NOT_FINISHED' });
  const { id, dir, copy, pdir } = await finished();
  assert.equal((await api('GET', `/api/runs/${id}/changes?memberKey=other-00000001`)).status, 400);
  const t = folderMemberTarget(readPipelineStateById(id), null, pdir);
  assert.deepEqual([t.realDir, t.copyDir, t.files.changes], [dir, copy, join(pdir, 'changes.json')]);
});

test('payloads: History rows, the detail state, the chat card and the terminal carry the folder facts; a git row carries none', async () => {
  const { id, copy } = await finished();
  const plain = mkdtempSync(join(tmpdir(), 'worca-fapply-git-')); dirs.push(plain);
  const git = await seedPipeline(plain, { status: 'done', branch: { source: 'main', feature: 'worca-cc/y' } });
  const rows = (await api('GET', '/api/history')).body.pipelines;        // as test/history-api.test.mjs reads it (j.pipelines)
  const mine = rows.find((r) => r.id === id); const theirs = rows.find((r) => r.id === git.id);
  assert.deepEqual([mine.workMode, mine.changes], ['folder', { state: 'pending', counts: { added: 1, modified: 1, deleted: 2 } }]);
  assert.equal('workMode' in theirs, false);
  const key = getDb().prepare('SELECT project_key FROM pipelines WHERE id = ?').get(id).project_key;
  const detail = (await api('GET', `/api/history/${key}/${id}`)).body.state;
  assert.deepEqual([detail.workMode, detail.changes.state], ['folder', 'pending']);
  assert.deepEqual((await api('GET', `/api/ask/runs/${id}`)).body.extras.changes, { state: 'pending', counts: { added: 1, modified: 1, deleted: 2 } });
  const { terminalTargets } = await import('../src/core/terminal/context.mjs');
  const row = getDb().prepare('SELECT * FROM pipelines WHERE id = ?').get(id);
  assert.deepEqual(terminalTargets(row).members.map((m) => [m.state, m.cwd]), [['worktree', copy]]);
});

test('case-insensitive volumes: a rename that changes only case applies (delete first, then add)', { skip: process.platform === 'linux' }, async () => {
  const { dir, id } = await finished(async (c) => { if (!readdirSync(c).includes('NOTES.txt')) renameSync(join(c, 'notes.txt'), join(c, 'NOTES.txt')); });
  assert.deepEqual((await api('GET', `/api/runs/${id}/apply-plan`)).body.skipped, []);
  await api('POST', `/api/runs/${id}/apply`);
  assert.ok(readdirSync(dir).includes('NOTES.txt') && !readdirSync(dir).includes('notes.txt'));
});

// v4 rows. APFS folds Unicode normalization as well as case: a case-fold of the names cannot see this rename.
test('normalization-insensitive volumes: a rename to the other Unicode spelling, with an edit, applies', { skip: process.platform !== 'darwin' }, async () => {
  const NFC = 'caf\u00e9.txt'; const NFD = 'cafe\u0301.txt';
  const { dir, id } = await finished(async (c) => { if (readdirSync(c).includes(NFC)) { renameSync(join(c, NFC), join(c, NFD)); writeFileSync(join(c, NFD), 'edited\n'); } }, { [NFC]: 'hello\n' });
  assert.deepEqual((await api('GET', `/api/runs/${id}/apply-plan`)).body.skipped, []);
  await api('POST', `/api/runs/${id}/apply`);
  assert.equal(readFileSync(join(dir, NFD), 'utf8'), 'edited\n');
  assert.deepEqual(readdirSync(dir).filter((n) => n.normalize('NFC') === NFC), [NFD], 'one file, in the run\'s spelling');
});

test('POSIX: a file whose mode the user changed in the folder since the run started is skipped and keeps its mode', { skip: process.platform === 'win32' }, async () => {
  const { dir, id } = await finished();
  chmodSync(join(dir, 'notes.txt'), 0o600);
  const r = await api('POST', `/api/runs/${id}/apply`);
  assert.deepEqual(r.body.skipped, [{ path: 'notes.txt', reason: 'changed-in-folder' }]);
  assert.deepEqual([readFileSync(join(dir, 'notes.txt'), 'utf8'), statSync(join(dir, 'notes.txt')).mode & 0o777], ['hello\n', 0o600]);
});

test('a run whose changes file is gone: Changes answers no changes; plan, Apply and Discard answer NO_CHANGES', async () => {
  const { id, pdir } = await finished();
  rmSync(join(pdir, 'changes.json'));
  assert.deepEqual(await api('GET', `/api/runs/${id}/changes`), { status: 404, body: { error: 'no changes' } });
  for (const [method, verb] of [['GET', 'apply-plan'], ['POST', 'apply'], ['POST', 'discard']]) {
    assert.deepEqual(await api(method, `/api/runs/${id}/${verb}`), { status: 404, body: { error: "The run's changes are gone.", code: 'NO_CHANGES' } }, verb);
  }
});

test('displayTarget is home-relative (S22) when the folder sits under the home', async () => {
  const { dir, id } = await finished();
  const prev = process.env.HOME; process.env.HOME = join(dir, '..');
  let body;
  try { body = (await api('GET', `/api/runs/${id}/apply-plan`)).body; } finally { process.env.HOME = prev; }
  assert.deepEqual([body.target, body.displayTarget], [dir, process.platform === 'win32' ? dir : `~/${basename(dir)}`]);
});

// v5 rows: a type change in the copy — the conflict is the apply's own delete, so it is decided after step 4.
test('a file the run turned into a folder of the same name applies; when the user edited that file meanwhile both are skipped', async () => {
  const toDir = (c) => { if (statSync(join(c, 'x')).isFile()) { rmSync(join(c, 'x')); mkdirSync(join(c, 'x')); writeFileSync(join(c, 'x', 'y'), 'y\n'); } };
  const a = await finished(toDir, { x: 'x\n' });
  assert.deepEqual((await api('GET', `/api/runs/${a.id}/apply-plan`)).body.skipped, [], 'the plan predicts the apply');
  assert.deepEqual((await api('POST', `/api/runs/${a.id}/apply`)).body, { applied: 2, skipped: [] });
  assert.equal(readFileSync(join(a.dir, 'x', 'y'), 'utf8'), 'y\n');
  assert.equal(existsSync(join(a.pdir, 'skipped')), false);
  const b = await finished(toDir, { x: 'x\n' });
  writeFileSync(join(b.dir, 'x'), 'mine\n');
  const both = [{ path: 'x', reason: 'changed-in-folder' }, { path: 'x/y', reason: 'changed-in-folder' }];
  assert.deepEqual((await api('GET', `/api/runs/${b.id}/apply-plan`)).body.skipped, both);
  assert.deepEqual((await api('POST', `/api/runs/${b.id}/apply`)).body.skipped, both);
  assert.deepEqual([readFileSync(join(b.dir, 'x'), 'utf8'), readFileSync(join(b.pdir, 'skipped', 'x', 'y'), 'utf8')], ['mine\n', 'y\n']);
});

test('a folder the run turned into a file of the same name applies; a user file added to that folder, or an edit in it, keeps the folder', async () => {
  const toFile = (c) => { if (statSync(join(c, 'docs')).isDirectory()) { rmSync(join(c, 'docs'), { recursive: true }); writeFileSync(join(c, 'docs'), 'D\n'); } };
  const a = await finished(toFile);
  assert.deepEqual((await api('GET', `/api/runs/${a.id}/apply-plan`)).body.skipped, [], 'the plan predicts the apply');
  assert.deepEqual((await api('POST', `/api/runs/${a.id}/apply`)).body, { applied: 2, skipped: [] });
  assert.equal(readFileSync(join(a.dir, 'docs'), 'utf8'), 'D\n');
  const b = await finished(toFile);
  writeFileSync(join(b.dir, 'docs', 'user.md'), 'u\n');
  assert.deepEqual((await api('GET', `/api/runs/${b.id}/apply-plan`)).body.skipped, [{ path: 'docs', reason: 'changed-in-folder' }]);
  assert.deepEqual((await api('POST', `/api/runs/${b.id}/apply`)).body, { applied: 1, skipped: [{ path: 'docs', reason: 'changed-in-folder' }] });
  assert.deepEqual([existsSync(join(b.dir, 'docs', 'a.md')), readFileSync(join(b.dir, 'docs', 'user.md'), 'utf8'), readFileSync(join(b.pdir, 'skipped', 'docs'), 'utf8')], [false, 'u\n', 'D\n']);
  const c = await finished(toFile);
  writeFileSync(join(c.dir, 'docs', 'a.md'), 'mine\n');
  assert.deepEqual((await api('GET', `/api/runs/${c.id}/apply-plan`)).body.skipped, [{ path: 'docs', reason: 'changed-in-folder' }, { path: 'docs/a.md', reason: 'changed-in-folder' }]);
  await api('POST', `/api/runs/${c.id}/apply`);
  assert.equal(readFileSync(join(c.dir, 'docs', 'a.md'), 'utf8'), 'mine\n');
});

// v5 rows: per-path read errors are per-file outcomes (POSIX; root reads everything).
const noChmod = process.platform === 'win32' || process.getuid?.() === 0;
test('POSIX: a file the user made unreadable in the folder is changed-in-folder, never a 500; the other files apply', { skip: noChmod }, async () => {
  const locked = [];
  try {
    const a = await finished();
    for (const p of ['notes.txt', 'old.txt']) { chmodSync(join(a.dir, p), 0o000); locked.push(join(a.dir, p)); }
    const both = [{ path: 'notes.txt', reason: 'changed-in-folder' }, { path: 'old.txt', reason: 'changed-in-folder' }];
    const plan = await api('GET', `/api/runs/${a.id}/apply-plan`);
    assert.deepEqual([plan.status, plan.body.skipped], [200, both]);
    assert.deepEqual(await api('POST', `/api/runs/${a.id}/apply`), { status: 200, body: { applied: 2, skipped: both } });
    assert.deepEqual([readFileSync(join(a.dir, 'new.txt'), 'utf8'), existsSync(join(a.dir, 'docs')), readFileSync(join(a.pdir, 'skipped', 'notes.txt'), 'utf8')], ['new\n', false, 'hello world\n']);
    const b = await finished();                                     // an unreadable folder: its file is not "already gone"
    chmodSync(join(b.dir, 'docs'), 0o000); locked.push(join(b.dir, 'docs'));
    assert.deepEqual((await api('POST', `/api/runs/${b.id}/apply`)).body, { applied: 3, skipped: [{ path: 'docs/a.md', reason: 'changed-in-folder' }] });
  } finally { for (const p of locked) { try { chmodSync(p, 0o755); } catch { /* released with the copy */ } } }
});

test('POSIX: a file the agent made unreadable in the copy is failed (not saved), never a 500 after the deletes ran; a modified one is still listed', { skip: noChmod }, async () => {
  const locked = [];
  const lockAfter = (p) => (c) => { if (locked.length) return; defaultEdit(c); chmodSync(join(c, p), 0o000); locked.push(join(c, p)); };
  try {
    const a = await finished(lockAfter('new.txt'));
    const r = await api('POST', `/api/runs/${a.id}/apply`);
    assert.deepEqual([r.status, r.body.applied, r.body.skipped.map((s) => [s.path, s.reason, typeof s.message])], [200, 3, [['new.txt', 'failed', 'string']]]);
    assert.deepEqual([readFileSync(join(a.dir, 'notes.txt'), 'utf8'), existsSync(join(a.dir, 'old.txt')), existsSync(join(a.pdir, 'skipped'))], ['hello world\n', false, false]);
    locked.length = 0;
    const b = await finished(lockAfter('notes.txt'));
    assert.deepEqual((await api('GET', `/api/runs/${b.id}/changes`)).body.files.map((f) => `${f.change} ${f.path}`), ['deleted docs/a.md', 'added new.txt', 'modified notes.txt', 'deleted old.txt']);
    const s = await api('POST', `/api/runs/${b.id}/apply`);
    assert.deepEqual([s.status, s.body.applied, s.body.skipped.map((x) => [x.path, x.reason])], [200, 3, [['notes.txt', 'failed']]]);
    assert.equal(readFileSync(join(b.dir, 'notes.txt'), 'utf8'), 'hello\n');
  } finally { for (const p of locked) { try { chmodSync(p, 0o644); } catch { /* released with the copy */ } } }
});

// v5 row: A-m6 pinned without a production hook. The temp file of one target is created with `open` from
// node:fs/promises (folder-copy.mjs copyHandle); a builtin's ESM bindings follow its CommonJS object after
// syncBuiltinESMExports(), so the hook runs right before that temp file is created, inside Apply.
const fspCjs = createRequire(import.meta.url)('node:fs/promises');
async function withTempCopyHook(hook, fn) {
  const orig = fspCjs.open;
  fspCjs.open = async (p, ...rest) => { if (/\.worca-[0-9a-f]{8}\.tmp$/.test(String(p))) await hook(String(p)); return orig(p, ...rest); };
  syncBuiltinESMExports();
  try { return await fn(); } finally { fspCjs.open = orig; syncBuiltinESMExports(); }
}
test('A-m6: right before its rename a target is re-hashed, and its folder re-checked against links', async () => {
  const a = await finished();
  const r = await withTempCopyHook(async (tmp) => { if (tmp.includes('.notes.txt.')) writeFileSync(join(a.dir, 'notes.txt'), 'mine\n'); },
    () => api('POST', `/api/runs/${a.id}/apply`));
  assert.deepEqual(r.body, { applied: 3, skipped: [{ path: 'notes.txt', reason: 'changed-in-folder' }] });
  assert.deepEqual([readFileSync(join(a.dir, 'notes.txt'), 'utf8'), readFileSync(join(a.pdir, 'skipped', 'notes.txt'), 'utf8')], ['mine\n', 'hello world\n']);
  if (process.platform === 'win32') return;                       // a junction swap needs its own row
  const b = await finished((c) => { mkdirSync(join(c, 'sub'), { recursive: true }); writeFileSync(join(c, 'sub', 'n.txt'), 'n\n'); });
  const outside = mkdtempSync(join(tmpdir(), 'worca-fapply-out-')); dirs.push(outside);
  const s = await withTempCopyHook(async (tmp) => { if (tmp.includes('.n.txt.')) { rmSync(join(b.dir, 'sub'), { recursive: true }); symlinkSync(outside, join(b.dir, 'sub')); } },
    () => api('POST', `/api/runs/${b.id}/apply`));
  assert.deepEqual(s.body, { applied: 0, skipped: [{ path: 'sub/n.txt', reason: 'changed-in-folder' }] });
  assert.deepEqual(readdirSync(outside), [], 'nothing written through the link');
});

// v5 rows: wiring no row pinned before.
test('Archive (DELETE /api/runs/:id) waits for the run lock and names its actor; an archived run answers 404 on every folder route', async () => {
  const { id, dir } = await finished();
  const { withRunLock } = await import('../src/core/checkout.mjs');
  const key = getDb().prepare('SELECT project_key FROM pipelines WHERE id = ?').get(id).project_key;
  const archivedAt = () => getDb().prepare('SELECT archived_at FROM pipelines WHERE id = ?').get(id).archived_at;
  const prev = process.env.WORCA_IDENTITY_NAME; process.env.WORCA_IDENTITY_NAME = 'ada@example.com';
  let del;
  try {
    await withRunLock(id, async () => {                              // an Apply holding the lock
      del = api('DELETE', `/api/runs/${id}?projectKey=${key}`);
      await new Promise((r) => setTimeout(r, 300));
      assert.equal(archivedAt(), null, 'the archive waits for the lock');
    });
    assert.equal((await del).status, 200);
  } finally { if (prev === undefined) delete process.env.WORCA_IDENTITY_NAME; else process.env.WORCA_IDENTITY_NAME = prev; }
  const events = getDb().prepare('SELECT text, actor FROM pipeline_events WHERE pipeline_id = ?').all(id).map((e) => ({ ...e }));
  assert.deepEqual(events.filter((e) => e.text.startsWith('Discarded')),
    [{ text: `Discarded the run's changes (archived) by ada@example.com; \`${dir}\` was not touched.`, actor: 'ada@example.com' }]);
  for (const [method, path] of [['GET', 'changes'], ['GET', 'changes/patch'], ['GET', 'apply-plan'], ['POST', 'apply'], ['POST', 'discard']]) {
    assert.deepEqual(await api(method, `/api/runs/${id}/${path}`), { status: 404, body: { error: 'pipeline not found' } }, path);
  }
});

test('COPY_MISSING: a copy or a manifest removed by hand answers 409 on apply-plan and Apply, and the folder is untouched', async () => {
  const gone = { status: 409, body: { error: "The run's copy is gone.", code: 'COPY_MISSING' } };
  for (const remove of [(f) => f.copy, (f) => join(f.pdir, 'folder-manifest.json')]) {
    const f = await finished();
    rmSync(remove(f), { recursive: true, force: true });
    for (const [method, verb] of [['GET', 'apply-plan'], ['POST', 'apply']]) assert.deepEqual(await api(method, `/api/runs/${f.id}/${verb}`), gone, verb);
    assert.deepEqual([readFileSync(join(f.dir, 'notes.txt'), 'utf8'), existsSync(join(f.dir, 'old.txt')), existsSync(join(f.dir, 'new.txt'))], ['hello\n', true, false]);
  }
});

test('FOLDER_MISSING: a folder moved away after the run answers 409 on apply-plan and Apply; its old path is never recreated and the copy stays', async () => {
  const f = await finished();
  const away = `${f.dir}-away`; renameSync(f.dir, away); dirs.push(away);
  const missing = { status: 409, body: { error: `The folder is missing: ${f.dir}`, code: 'FOLDER_MISSING' } };
  for (const [method, verb] of [['GET', 'apply-plan'], ['POST', 'apply']]) assert.deepEqual(await api(method, `/api/runs/${f.id}/${verb}`), missing, verb);
  assert.deepEqual([existsSync(f.dir), existsSync(f.copy)], [false, true]);
  assert.equal((await api('GET', `/api/runs/${f.id}/changes`)).body.state, 'pending');
});

test('a forged manifest key climbing out of the folder refuses the whole manifest: 409 COPY_MISSING on apply-plan and Apply; the outside file stays, its text never reaches changes.patch, nothing is written', async () => {
  const f = await finished();
  const out = mkdtempSync(join(tmpdir(), 'worca-fapply-out-')); dirs.push(out);
  writeFileSync(join(out, 'outside.txt'), 'precious\n');
  const key = `../${basename(out)}/outside.txt`;                  // listed `deleted`: the copy has no such file
  const st = statSync(join(out, 'outside.txt'));
  const mfPath = join(f.pdir, 'folder-manifest.json');
  const mf = JSON.parse(readFileSync(mfPath, 'utf8'));
  mf.files[key] = { sha1: createHash('sha1').update('precious\n').digest('hex'), size: st.size, mtimeMs: st.mtimeMs, mode: st.mode & 0o777 };
  writeFileSync(mfPath, JSON.stringify(mf) + '\n');
  const gone = { status: 409, body: { error: "The run's copy is gone.", code: 'COPY_MISSING' } };
  for (const [method, verb] of [['GET', 'apply-plan'], ['POST', 'apply']]) assert.deepEqual(await api(method, `/api/runs/${f.id}/${verb}`), gone, verb);
  assert.equal(readFileSync(join(out, 'outside.txt'), 'utf8'), 'precious\n');
  assert.doesNotMatch(readFileSync(join(f.pdir, 'changes.patch'), 'utf8'), /precious/);
  assert.deepEqual([readFileSync(join(f.dir, 'notes.txt'), 'utf8'), existsSync(join(f.dir, 'old.txt')), existsSync(join(f.dir, 'new.txt'))], ['hello\n', true, false]);
});

// Every regular file under `dir` (links never followed) whose text holds `needle`.
const filesHolding = (dir, needle) => readdirSync(dir, { recursive: true }).map((r) => join(dir, String(r)))
  .filter((p) => lstatSync(p).isFile() && readFileSync(p, 'utf8').includes(needle));

test('POSIX: a link the agent plants at changes.patch is never read: Discard leaves it unread, the patch route and the context bundle answer no patch', { skip: process.platform === 'win32' }, async () => {
  const { readRunContextBundle } = await import('../src/core/results.mjs');
  const f = await finished();
  const out = mkdtempSync(join(tmpdir(), 'worca-fapply-out-')); dirs.push(out);
  writeFileSync(join(out, 'secret.txt'), 'CANARY-PATCH\n');
  rmSync(join(f.pdir, 'changes.patch')); symlinkSync(join(out, 'secret.txt'), join(f.pdir, 'changes.patch'));
  assert.deepEqual(await api('GET', `/api/runs/${f.id}/changes/patch`), { status: 404, body: { error: 'no changes' } });
  assert.equal((await readRunContextBundle(f.pdir, f.id)).diffPatch, null);
  assert.equal((await api('POST', `/api/runs/${f.id}/discard`)).status, 200);
  assert.equal(JSON.parse(readFileSync(join(f.pdir, 'changes.json'), 'utf8')).state, 'discarded');
  assert.deepEqual(filesHolding(f.pdir, 'CANARY-PATCH'), []);
  assert.equal(readFileSync(join(out, 'secret.txt'), 'utf8'), 'CANARY-PATCH\n');
});

test('POSIX: a link the agent plants at changes.json is never read: Changes, apply-plan, Apply and Discard answer no changes, and its target never lands in the pipeline dir', { skip: process.platform === 'win32' }, async () => {
  const f = await finished();
  const out = mkdtempSync(join(tmpdir(), 'worca-fapply-out-')); dirs.push(out);
  const real = JSON.parse(readFileSync(join(f.pdir, 'changes.json'), 'utf8'));
  writeFileSync(join(out, 'secret.json'), JSON.stringify({ ...real, secret: 'CANARY-JSON' }));
  rmSync(join(f.pdir, 'changes.json')); symlinkSync(join(out, 'secret.json'), join(f.pdir, 'changes.json'));
  assert.deepEqual(await api('GET', `/api/runs/${f.id}/changes`), { status: 404, body: { error: 'no changes' } });
  const none = { status: 404, body: { error: "The run's changes are gone.", code: 'NO_CHANGES' } };
  for (const [method, verb] of [['GET', 'apply-plan'], ['POST', 'apply'], ['POST', 'discard']]) assert.deepEqual(await api(method, `/api/runs/${f.id}/${verb}`), none, verb);
  assert.deepEqual(filesHolding(f.pdir, 'CANARY-JSON'), []);
  assert.deepEqual([readFileSync(join(f.dir, 'notes.txt'), 'utf8'), existsSync(join(f.dir, 'new.txt'))], ['hello\n', false]);
});

// Hosted isolation: the pipeline dir is writable by the agent's uid; the server saves skipped files there under its own.
test('POSIX: a link planted at or under skipped/ in the pipeline dir is never followed: the outside dir stays, the skipped version is saved inside the pipeline dir', { skip: process.platform === 'win32' }, async () => {
  const addSub = (c) => { defaultEdit(c); mkdirSync(join(c, 'sub'), { recursive: true }); writeFileSync(join(c, 'sub', 'n.txt'), 'run\n'); };
  for (const at of ['skipped', 'skipped/sub']) {
    const a = await finished(addSub);
    const out = mkdtempSync(join(tmpdir(), 'worca-fapply-out-')); dirs.push(out);
    const victim = at === 'skipped' ? join(out, 'sub', 'n.txt') : join(out, 'n.txt');   // where the link leads the save
    mkdirSync(victim, { recursive: true }); writeFileSync(join(victim, 'precious.txt'), 'keep\n');
    if (at === 'skipped/sub') mkdirSync(join(a.pdir, 'skipped'));
    symlinkSync(out, join(a.pdir, ...at.split('/')));
    mkdirSync(join(a.dir, 'sub')); writeFileSync(join(a.dir, 'sub', 'n.txt'), 'mine\n');   // the add is changed in the folder
    const r = await api('POST', `/api/runs/${a.id}/apply`);
    assert.deepEqual([r.status, r.body.skipped], [200, [{ path: 'sub/n.txt', reason: 'changed-in-folder' }]], at);
    assert.equal(readFileSync(join(victim, 'precious.txt'), 'utf8'), 'keep\n', at);
    assert.deepEqual([lstatSync(join(a.pdir, 'skipped')).isSymbolicLink(), lstatSync(join(a.pdir, 'skipped', 'sub')).isSymbolicLink()], [false, false], at);
    const saved = join(a.pdir, 'skipped', 'sub', 'n.txt');
    assert.equal(readFileSync(saved, 'utf8'), 'run\n', at);
    assert.ok(realpathSync(saved).startsWith(realpathSync(a.pdir)), at);
  }
});

test('POSIX: links the agent plants at the changes files\' temp names in the pipeline dir are never written through (a run that changed nothing)', { skip: process.platform === 'win32' }, async () => {
  const names = ['changes.json.tmp', 'changes.patch.tmp'];
  const out = mkdtempSync(join(tmpdir(), 'worca-fapply-out-')); dirs.push(out);
  for (const n of names) writeFileSync(join(out, n), 'keep\n');
  const dir = mkdtempSync(join(tmpdir(), 'worca-fapply-')); dirs.push(dir); writeFileSync(join(dir, 'a.txt'), 'a\n');
  await addProject({ name: basename(dir), path: dir });
  let orch;
  const plant = () => { for (const n of names) if (!existsSync(join(orch.pipeline.dir, n))) symlinkSync(join(out, n), join(orch.pipeline.dir, n)); };
  orch = ENGINES[0].create({ projectDir: dir, workMode: 'folder', prompt: 'demo', auto: true, claude: { mock: true },
    runners: { producer: async () => { plant(); return { status: 'ok' }; }, verifier: okVerifier } });
  assert.equal((await orch.run()).status, 'done');
  for (const n of names) assert.equal(readFileSync(join(out, n), 'utf8'), 'keep\n', n);
  assert.equal(JSON.parse(readFileSync(join(orch.pipeline.dir, 'changes.json'), 'utf8')).state, 'discarded', 'the settle still lands');
});

test('Apply and Discard close the run\'s terminals and actions first, before the changes are touched', async () => {
  const { _testing: T } = await import('../ui/server.mjs');
  const orig = T.terminals.closeWhere;
  for (const verb of ['apply', 'discard']) {
    const { id, dir, pdir } = await finished();
    const seen = [];
    T.terminals.closeWhere = function (pred, ...rest) {
      if (pred({ runId: id, member: null })) seen.push([JSON.parse(readFileSync(join(pdir, 'changes.json'), 'utf8')).state, existsSync(join(dir, 'new.txt'))]);
      return orig.call(this, pred, ...rest);
    };
    try { assert.equal((await api('POST', `/api/runs/${id}/${verb}`)).status, 200); } finally { T.terminals.closeWhere = orig; }
    assert.deepEqual(seen, [['pending', false]], verb);
  }
});

test('the overview agent\'s context bundle of a folder run carries its changes.patch', async () => {
  const { readRunContextBundle } = await import('../src/core/results.mjs');
  const { id, pdir } = await finished();
  assert.equal(existsSync(join(pdir, 'diff-patch.patch')), false);
  assert.equal((await readRunContextBundle(pdir, id)).diffPatch, readFileSync(join(pdir, 'changes.patch'), 'utf8'));
});

test('case-insensitive volumes: a folder renamed only in case applies with its new name', { skip: process.platform === 'linux' }, async () => {
  const { dir, id } = await finished((c) => { if (readdirSync(c).includes('docs')) renameSync(join(c, 'docs'), join(c, 'Docs')); });
  assert.deepEqual((await api('POST', `/api/runs/${id}/apply`)).body, { applied: 2, skipped: [] });
  assert.deepEqual([readdirSync(dir).filter((n) => n.toLowerCase() === 'docs'), readFileSync(join(dir, 'Docs', 'a.md'), 'utf8')], [['Docs'], '# A\n']);
});

// v5 rows: the dev + ino exception off macOS (a case-only rename with an edit), the prune after a delete whose file
// was already gone, and an agent-made link by either spelling of the copy path.
test('case-insensitive volumes: a rename that changes only case, with an edit, applies (dev + ino)', { skip: process.platform === 'linux' }, async () => {
  const { dir, id } = await finished(async (c) => { if (!readdirSync(c).includes('NOTES.txt')) { renameSync(join(c, 'notes.txt'), join(c, 'NOTES.txt')); writeFileSync(join(c, 'NOTES.txt'), 'edited\n'); } });
  assert.deepEqual((await api('GET', `/api/runs/${id}/apply-plan`)).body.skipped, []);
  await api('POST', `/api/runs/${id}/apply`);
  assert.ok(readdirSync(dir).includes('NOTES.txt') && !readdirSync(dir).includes('notes.txt'));
  assert.equal(readFileSync(join(dir, 'NOTES.txt'), 'utf8'), 'edited\n', 'only dev + ino tells this add from a file the user made');
});

test('a folder the run deleted goes even when the user already deleted its last file', async () => {
  const { dir, id } = await finished();
  rmSync(join(dir, 'docs', 'a.md'));
  const r = await api('POST', `/api/runs/${id}/apply`);
  assert.deepEqual([r.status, r.body.skipped], [200, []]);
  assert.equal(existsSync(join(dir, 'docs')), false, 'a delete whose real file was already gone prunes its emptied folder too');
});

test('POSIX: an agent-made absolute link into the copy, by either spelling of its path, points into the folder', { skip: process.platform === 'win32' }, async () => {
  const { dir, id } = await finished(async (c) => {
    defaultEdit(c);
    if (!readdirSync(c).includes('real-link')) symlinkSync(join(realpathSync(c), 'new.txt'), join(c, 'real-link'));   // macOS: /private/var/…
    if (!readdirSync(c).includes('plain-link')) symlinkSync(join(c, 'new.txt'), join(c, 'plain-link'));
  });
  await api('POST', `/api/runs/${id}/apply`);
  assert.deepEqual([readlinkSync(join(dir, 'real-link')), readlinkSync(join(dir, 'plain-link'))], [join(dir, 'new.txt'), join(dir, 'new.txt')]);
});

// v5 rows (cycle 4, lane M): a folder the run turned into a file whose only file the user already deleted, and step 5's
// ancestor re-check (a delete step 4 could not run leaves the old link standing; without the re-check the run's new file
// was written through it, into another folder of the project).
test('a folder the run turned into a file applies when the user already deleted its only file; an empty folder the user made in it keeps the folder', async () => {
  const toFile = (c) => { if (statSync(join(c, 'docs')).isDirectory()) { rmSync(join(c, 'docs'), { recursive: true }); writeFileSync(join(c, 'docs'), 'D\n'); } };
  const a = await finished(toFile);
  rmSync(join(a.dir, 'docs', 'a.md'));
  assert.deepEqual((await api('GET', `/api/runs/${a.id}/apply-plan`)).body.skipped, [], 'the plan predicts the apply');
  assert.deepEqual((await api('POST', `/api/runs/${a.id}/apply`)).body, { applied: 2, skipped: [] });
  assert.equal(readFileSync(join(a.dir, 'docs'), 'utf8'), 'D\n');
  const b = await finished(toFile);
  mkdirSync(join(b.dir, 'docs', 'empty'));                          // an empty folder the user made: step 4 keeps docs/
  assert.deepEqual((await api('GET', `/api/runs/${b.id}/apply-plan`)).body.skipped, [{ path: 'docs', reason: 'changed-in-folder' }]);
});

test('POSIX: a link the run turned into a folder, whose delete fails, is never written through (step 5 re-checks the ancestors)', { skip: noChmod }, async () => {
  const dir = mkdtempSync(join(tmpdir(), 'worca-fapply-')); dirs.push(dir);
  mkdirSync(join(dir, 'inner')); mkdirSync(join(dir, 'sub')); symlinkSync('../inner', join(dir, 'sub', 'data'));
  await addProject({ name: basename(dir), path: dir });
  const toDir = (c) => {
    if (!readdirSync(join(c, 'sub'), { withFileTypes: true }).find((e) => e.name === 'data').isSymbolicLink()) return;
    rmSync(join(c, 'sub', 'data')); mkdirSync(join(c, 'sub', 'data')); writeFileSync(join(c, 'sub', 'data', 'f.txt'), 'f\n');
  };
  let orch;
  orch = ENGINES[0].create({ projectDir: dir, workMode: 'folder', prompt: 'demo', auto: true, claude: { mock: true },
    runners: { producer: async () => { toDir(orch.runCwd); return { status: 'ok' }; }, verifier: okVerifier } });
  assert.equal((await orch.run()).status, 'done');
  chmodSync(join(dir, 'sub'), 0o555);                               // step 4's unlink of sub/data fails (EACCES)
  try {
    const r = await api('POST', `/api/runs/${orch.state.id}/apply`);
    assert.deepEqual(r.body.skipped.map((s) => [s.path, s.reason]), [['sub/data', 'failed'], ['sub/data/f.txt', 'changed-in-folder']]);
    assert.deepEqual(readdirSync(join(dir, 'inner')), [], 'nothing written through the link');
    assert.equal(readFileSync(join(orch.pipeline.dir, 'skipped', 'sub', 'data', 'f.txt'), 'utf8'), 'f\n');
  } finally { chmodSync(join(dir, 'sub'), 0o755); }
});

// v6: an unreadable FOLDER in the copy is not "deleted" (its subtree was skipped by the walk).
test('POSIX: a folder the agent made unreadable in the copy deletes nothing in the folder; its files are failed', { skip: noChmod }, async () => {
  const locked = [];
  try {
    const a = await finished((c) => { if (locked.length) return; writeFileSync(join(c, 'notes.txt'), 'hello world\n'); chmodSync(join(c, 'docs'), 0o000); locked.push(join(c, 'docs')); });
    const plan = await api('GET', `/api/runs/${a.id}/apply-plan`);
    assert.deepEqual([plan.status, plan.body.delete], [200, []], 'nothing under the unreadable folder is listed as deleted');
    const r = await api('POST', `/api/runs/${a.id}/apply`);
    assert.deepEqual([r.status, r.body.applied, r.body.skipped.map((s) => [s.path, s.reason])], [200, 1, [['docs/a.md', 'failed']]]);
    assert.equal(readFileSync(join(a.dir, 'docs', 'a.md'), 'utf8'), '# A\n', "the user's file stays");
  } finally { for (const p of locked) { try { chmodSync(p, 0o755); } catch { /* released with the copy */ } } }
});

// v6: a skipped file whose copy is unreadable is failed (not saved) — never a 500 after the deletes ran.
test('POSIX: a copy file the agent made unreadable and the user changed in the folder is failed, never a 500', { skip: noChmod }, async () => {
  const locked = [];
  const lockAfter = (p) => (c) => { if (locked.length) return; defaultEdit(c); chmodSync(join(c, p), 0o000); locked.push(join(c, p)); };
  try {
    const a = await finished(lockAfter('notes.txt'));
    writeFileSync(join(a.dir, 'notes.txt'), 'mine\n');
    const r = await api('POST', `/api/runs/${a.id}/apply`);
    assert.deepEqual([r.status, r.body.applied, r.body.skipped?.map((s) => [s.path, s.reason])], [200, 3, [['notes.txt', 'failed']]]);
    assert.deepEqual([readFileSync(join(a.dir, 'notes.txt'), 'utf8'), existsSync(join(a.pdir, 'skipped', 'notes.txt'))], ['mine\n', false]);
  } finally { for (const p of locked) { try { chmodSync(p, 0o644); } catch { /* released with the copy */ } } }
});

// v6: a type change combined with a case change: the ancestor / the emptied folder is the delete's own entry (dev + ino).
test('case-insensitive volumes: a file turned into a folder, and a folder into a file, of another case, apply', { skip: process.platform === 'linux' }, async () => {
  const a = await finished((c) => { if (readdirSync(c).includes('Data')) { rmSync(join(c, 'Data')); mkdirSync(join(c, 'data')); writeFileSync(join(c, 'data', 'f.txt'), 'f\n'); } }, { Data: 'D\n' });
  assert.deepEqual((await api('GET', `/api/runs/${a.id}/apply-plan`)).body.skipped, [], 'the plan predicts the apply');
  assert.deepEqual((await api('POST', `/api/runs/${a.id}/apply`)).body, { applied: 2, skipped: [] });
  assert.deepEqual([readdirSync(a.dir).includes('data'), readFileSync(join(a.dir, 'data', 'f.txt'), 'utf8')], [true, 'f\n']);
  const b = await finished((c) => { if (readdirSync(c).includes('docs')) { rmSync(join(c, 'docs'), { recursive: true }); writeFileSync(join(c, 'Docs'), 'D\n'); } });
  assert.deepEqual((await api('GET', `/api/runs/${b.id}/apply-plan`)).body.skipped, [], 'the plan predicts the apply');
  assert.deepEqual((await api('POST', `/api/runs/${b.id}/apply`)).body, { applied: 2, skipped: [] });
  assert.deepEqual([readdirSync(b.dir).includes('Docs'), readFileSync(join(b.dir, 'Docs'), 'utf8')], [true, 'D\n']);
});

// v6: on POSIX a backslash is part of a name.
test('POSIX: a file name holding a backslash applies (it is a name, not a path)', { skip: process.platform === 'win32' }, async () => {
  const a = await finished((c) => { writeFileSync(join(c, 'a\\b.txt'), 'bs\n'); });
  const plan = await api('GET', `/api/runs/${a.id}/apply-plan`);
  assert.deepEqual([plan.status, plan.body.add, plan.body.skipped], [200, ['a\\b.txt'], []]);
  assert.deepEqual((await api('POST', `/api/runs/${a.id}/apply`)).body, { applied: 1, skipped: [] });
  assert.equal(readFileSync(join(a.dir, 'a\\b.txt'), 'utf8'), 'bs\n');
});

// v7: a FIFO at a deleted path, a 240-byte name, a folder renamed in case and made unreadable, Archive and the run's
// terminals (Task 8), the replace-before-save retry, the link branch's A-m6 check.
test('POSIX: a FIFO the user put at a path the run deleted never hangs apply-plan or Apply (nor the run lock)', { skip: process.platform === 'win32' }, async () => {
  const { execFileSync } = await import('node:child_process');
  const { openSync, closeSync, constants: fsc } = await import('node:fs');
  const a = await finished();
  rmSync(join(a.dir, 'old.txt')); execFileSync('mkfifo', [join(a.dir, 'old.txt')]);
  const within = (p) => Promise.race([p, new Promise((r) => setTimeout(() => r({ status: 'hung' }), 4000))]);
  try {
    const plan = await within(api('GET', `/api/runs/${a.id}/apply-plan`));
    assert.deepEqual([plan.status, plan.body?.skipped], [200, [{ path: 'old.txt', reason: 'changed-in-folder' }]]);
    const r = await within(api('POST', `/api/runs/${a.id}/apply`));
    assert.deepEqual([r.status, r.body], [200, { applied: 3, skipped: [{ path: 'old.txt', reason: 'changed-in-folder' }] }]);
  } finally { for (let i = 0; i < 4; i++) { try { closeSync(openSync(join(a.dir, 'old.txt'), fsc.O_WRONLY | fsc.O_NONBLOCK)); } catch { break; } } }
});

test('a file with a 240-byte name applies (its temp file stays under NAME_MAX)', { skip: process.platform === 'win32' }, async () => {
  const long = `${'L'.repeat(240)}.txt`;
  const a = await finished((c) => { defaultEdit(c); writeFileSync(join(c, long), 'long\n'); });
  assert.deepEqual((await api('POST', `/api/runs/${a.id}/apply`)).body, { applied: 5, skipped: [] });
  assert.equal(readFileSync(join(a.dir, long), 'utf8'), 'long\n');
});

test('case-insensitive volumes: a folder the agent renamed in case and made unreadable deletes nothing in the folder', { skip: process.platform !== 'darwin' || noChmod }, async () => {
  const locked = [];
  try {
    const a = await finished((c) => { if (locked.length) return; renameSync(join(c, 'docs'), join(c, 'Docs')); chmodSync(join(c, 'Docs'), 0o000); locked.push(join(c, 'Docs')); });
    const r = await api('POST', `/api/runs/${a.id}/apply`);
    assert.deepEqual([r.status, r.body.applied, r.body.skipped.map((s) => [s.path, s.reason])], [200, 0, [['docs/a.md', 'failed']]]);
    assert.equal(readFileSync(join(a.dir, 'docs', 'a.md'), 'utf8'), '# A\n', "the user's file stays");
  } finally { for (const p of locked) { try { chmodSync(p, 0o755); } catch { /* released with the copy */ } } }
});

test('Archive of a pending folder run closes the run\'s terminals first, as Discard does (its copy goes with the run root)', async () => {
  const { _testing: T } = await import('../ui/server.mjs');
  const orig = T.terminals.closeWhere;
  const { id, dir, copy } = await finished();
  const seen = [];
  T.terminals.closeWhere = function (pred, ...rest) {
    if (pred({ runId: id, member: null })) seen.push(existsSync(copy));
    return orig.call(this, pred, ...rest);
  };
  try { assert.equal((await api('DELETE', `/api/runs/${id}?projectDir=${encodeURIComponent(dir)}`)).status, 200); } finally { T.terminals.closeWhere = orig; }
  assert.deepEqual(seen, [true], 'closed while the copy still existed');
  assert.equal(existsSync(copy), false);
});

test('POSIX: a retry after a save under skipped/ failed is safe: what the first attempt saved there is replaced', { skip: process.platform === 'win32' }, async () => {
  const a = await finished((c) => { defaultEdit(c); if (!readdirSync(c).includes('lnk')) symlinkSync('notes.txt', join(c, 'lnk')); writeFileSync(join(c, 'z.txt'), 'z\n'); });
  writeFileSync(join(a.dir, 'lnk'), 'mine\n'); writeFileSync(join(a.dir, 'z.txt'), 'theirs\n');   // both adds: changed in the folder
  let first = true;
  const orig = fspCjs.open;
  fspCjs.open = async (p, ...rest) => { if (first && String(p).endsWith(join('skipped', 'z.txt'))) { first = false; throw Object.assign(new Error('disk full'), { code: 'ENOSPC' }); } return orig(p, ...rest); };
  syncBuiltinESMExports();
  let r1;
  try { r1 = await api('POST', `/api/runs/${a.id}/apply`); } finally { fspCjs.open = orig; syncBuiltinESMExports(); }
  assert.equal(r1.status, 500);
  assert.equal(readlinkSync(join(a.pdir, 'skipped', 'lnk')), 'notes.txt', 'the first attempt saved the link');
  const r2 = await api('POST', `/api/runs/${a.id}/apply`);
  assert.deepEqual([r2.status, r2.body.skipped], [200, [{ path: 'lnk', reason: 'changed-in-folder' }, { path: 'z.txt', reason: 'changed-in-folder' }]]);
  assert.deepEqual([readlinkSync(join(a.pdir, 'skipped', 'lnk')), readFileSync(join(a.pdir, 'skipped', 'z.txt'), 'utf8')], ['notes.txt', 'z\n']);
});

test('POSIX: A-m6 in the link branch: a file the user made at an added link\'s path while Apply ran is never unlinked', { skip: process.platform === 'win32' }, async () => {
  const a = await finished((c) => { defaultEdit(c); writeFileSync(join(c, 'a.txt'), 'a\n'); if (!readdirSync(c).includes('lnk')) symlinkSync('new.txt', join(c, 'lnk')); });
  const r = await withTempCopyHook(async (tmp) => { if (tmp.includes('.a.txt.')) writeFileSync(join(a.dir, 'lnk'), 'mine\n'); },
    () => api('POST', `/api/runs/${a.id}/apply`));
  assert.deepEqual(r.body, { applied: 5, skipped: [{ path: 'lnk', reason: 'changed-in-folder' }] });
  assert.deepEqual([readFileSync(join(a.dir, 'lnk'), 'utf8'), readlinkSync(join(a.pdir, 'skipped', 'lnk'))], ['mine\n', 'new.txt']);
});

// v8: Archive closes nothing when archivePipeline refuses the row as active.
test('Archive of a folder run still running (in another process) is refused and leaves its terminals open', async () => {
  const { _testing: T } = await import('../ui/server.mjs');
  const dir = mkdtempSync(join(tmpdir(), 'worca-fapply-')); dirs.push(dir); writeFileSync(join(dir, 'a.txt'), 'a\n');
  await addProject({ name: basename(dir), path: dir });
  let release; const gate = new Promise((r) => { release = r; });
  let entered; const inside = new Promise((r) => { entered = r; });
  const orch = ENGINES[0].create({ projectDir: dir, workMode: 'folder', prompt: 'demo', auto: true, claude: { mock: true },
    runners: { producer: async () => { entered(); await gate; return { status: 'ok' }; }, verifier: okVerifier } });
  const done = orch.run(); await inside;
  const id = orch.state.id; const seen = []; const orig = T.terminals.closeWhere;
  T.terminals.closeWhere = function (pred, ...rest) { if (pred({ runId: id, member: null })) seen.push('closed'); return orig.call(this, pred, ...rest); };
  try {
    const key = getDb().prepare('SELECT project_key FROM pipelines WHERE id = ?').get(id).project_key;
    assert.equal((await api('DELETE', `/api/runs/${id}?projectKey=${key}`)).status, 409);
  } finally { T.terminals.closeWhere = orig; release(); }
  assert.deepEqual(seen, [], 'a refused Archive closes nothing');
  assert.equal((await done).status, 'done');
});

// Hosted isolation: `runs/` is group-writable, so an agent (or a process it left behind) can rename the copy, or the
// `repos/` above it, and link a server-only folder in its place after the run.
const canaryDir = (over = {}) => {
  const d = mkdtempSync(join(tmpdir(), 'worca-fapply-canary-')); dirs.push(d);
  for (const n of ['notes.txt', 'new.txt', 'secret.txt']) writeFileSync(join(d, n), over[n] ?? 'CANARY\n');
  return d;
};
// Runs `hook(path)` before every call of fs/promises' `name` (the modules' named imports follow syncBuiltinESMExports).
async function withFspHook(name, hook, fn) {
  const orig = fspCjs[name];
  fspCjs[name] = async (...a) => { await hook(String(a[0])); return orig(...a); };
  syncBuiltinESMExports();
  try { return await fn(); } finally { fspCjs[name] = orig; syncBuiltinESMExports(); }
}
const snapDir = (d) => readdirSync(d, { recursive: true }).map(String).sort()
  .map((r) => [r, lstatSync(join(d, r)).isFile() ? readFileSync(join(d, r), 'utf8') : null]);
test('POSIX: a copy (or repos/) swapped for a link after the run answers 409 COPY_MISSING on apply-plan and Apply: the folder gains no file, the link target is untouched', { skip: process.platform === 'win32' }, async () => {
  const gone = { status: 409, body: { error: "The run's copy is gone.", code: 'COPY_MISSING' } };
  for (const shape of ['copy', 'repos']) {
    const f = await finished();
    const canary = canaryDir();
    const at = shape === 'copy' ? f.copy : join(f.copy, '..');
    if (shape === 'repos') { mkdirSync(join(canary, basename(f.copy))); for (const n of ['notes.txt', 'new.txt']) writeFileSync(join(canary, basename(f.copy), n), 'CANARY\n'); }
    const before = snapDir(canary);
    renameSync(at, `${at}-moved`); symlinkSync(canary, at);
    for (const [method, verb] of [['GET', 'apply-plan'], ['POST', 'apply']]) assert.deepEqual(await api(method, `/api/runs/${f.id}/${verb}`), gone, `${shape}: ${verb}`);
    assert.deepEqual([readFileSync(join(f.dir, 'notes.txt'), 'utf8'), existsSync(join(f.dir, 'old.txt')), existsSync(join(f.dir, 'new.txt')), existsSync(join(f.dir, 'secret.txt'))], ['hello\n', true, false, false], shape);
    assert.deepEqual(filesHolding(f.pdir, 'CANARY'), [], `${shape}: nothing of the link target reaches the pipeline dir`);
    assert.deepEqual(snapDir(canary), before, `${shape}: the link target is untouched`);
  }
});

test('POSIX: a copy swapped for a link while Apply writes is never read: no byte of the link target reaches the folder or skipped/', { skip: process.platform === 'win32' }, async () => {
  const f = await finished();
  // the link target's notes.txt equals the folder's: read through the link, the update would pass as already in place
  const canary = canaryDir({ 'notes.txt': 'hello\n' }); const before = snapDir(canary);
  let swapped = false;
  const r = await withTempCopyHook(async () => {
    if (swapped) return;
    swapped = true; renameSync(f.copy, `${f.copy}-moved`); symlinkSync(canary, f.copy);
  }, () => api('POST', `/api/runs/${f.id}/apply`));
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.ok(swapped, 'the swap ran inside Apply');
  assert.deepEqual(r.body.skipped.map((s) => s.path), ['new.txt', 'notes.txt'], JSON.stringify(r.body));
  assert.deepEqual(filesHolding(f.dir, 'CANARY'), [], 'the folder');
  assert.deepEqual(filesHolding(f.pdir, 'CANARY'), [], 'the pipeline dir (skipped/, changes.patch)');
  assert.deepEqual([readFileSync(join(f.dir, 'notes.txt'), 'utf8'), existsSync(join(f.dir, 'new.txt'))], ['hello\n', false]);
  assert.deepEqual(snapDir(canary), before, 'the link target is untouched');
});

test('POSIX: a copy swapped for a link while Apply scans it: changes.patch keeps the copy side inside the checked root, nothing is applied from the link', { skip: process.platform === 'win32' }, async () => {
  const f = await finished();
  const canary = canaryDir(); const before = snapDir(canary);
  let swapped = false;
  const r = await withFspHook('open', async (p) => {
    if (swapped || !p.startsWith(f.copy + sep)) return;
    swapped = true; renameSync(f.copy, `${f.copy}-moved`); symlinkSync(canary, f.copy);
  }, () => api('POST', `/api/runs/${f.id}/apply`));
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.ok(swapped, 'the swap ran inside the scan');
  assert.deepEqual(filesHolding(f.dir, 'CANARY'), [], 'the folder');
  assert.deepEqual(filesHolding(f.pdir, 'CANARY'), [], 'the pipeline dir (changes.patch)');
  assert.deepEqual(snapDir(canary), before, 'the link target is untouched');
});

test('POSIX: a folder inside the copy swapped for a link while Apply writes is never read through', { skip: process.platform === 'win32' }, async () => {
  const f = await finished((c) => { defaultEdit(c); mkdirSync(join(c, 'sub'), { recursive: true }); writeFileSync(join(c, 'sub', 'new.txt'), 'sub\n'); });
  const canary = canaryDir(); const before = snapDir(canary);
  let swapped = false;
  const r = await withTempCopyHook(async (tmp) => {
    if (swapped || basename(join(tmp, '..')) !== 'sub') return;
    swapped = true; renameSync(join(f.copy, 'sub'), join(f.copy, 'sub-moved')); symlinkSync(canary, join(f.copy, 'sub'));
  }, () => api('POST', `/api/runs/${f.id}/apply`));
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.ok(swapped, 'the swap ran inside Apply');
  assert.deepEqual(r.body.skipped.map((s) => s.path), ['sub/new.txt'], JSON.stringify(r.body));
  assert.deepEqual(filesHolding(f.dir, 'CANARY'), [], 'the folder');
  assert.deepEqual(filesHolding(f.pdir, 'CANARY'), [], 'the pipeline dir (skipped/)');
  assert.deepEqual(snapDir(canary), before, 'the link target is untouched');
});

// M2 (hosted isolation): a process the agent left behind swaps a changed FILE of the copy (never its folder) for a link
// to a server-only file between Apply's checks of it and its copy. Each case is a run whose copy changes one file; the
// swap runs at that file's `mkdir(<its folder>)` in step 5, after its lstat and its hash. Temp files are read before removal.
const TMP_RE = /\.worca-[0-9a-f]{8}\.tmp$/;
test('POSIX: a copy file swapped for a link (or rewritten) inside Apply\'s write window is skipped: no byte of the link target reaches the folder, a temp file or skipped/', { skip: process.platform === 'win32' }, async () => {
  const cases = [
    { name: 'notes.txt', edit: (c) => writeFileSync(join(c, 'notes.txt'), 'hello world\n'), swap: 'link' },
    { name: 'new.txt', edit: (c) => writeFileSync(join(c, 'new.txt'), 'new\n'), swap: 'link' },
    { name: 'notes.txt', edit: (c) => writeFileSync(join(c, 'notes.txt'), 'hello world\n'), swap: 'rewrite' },
  ];
  for (const { name, edit, swap } of cases) {
    const f = await finished(edit);
    const canary = canaryDir(); const before = snapDir(canary);
    const realDirs = new Set([f.dir, realpathSync(f.dir)]);
    let swapped = false; const temps = [];
    const r = await withFspHook('rm', async (p) => { if (TMP_RE.test(p) && existsSync(p)) temps.push(readFileSync(p, 'utf8')); },
      () => withFspHook('mkdir', async (p) => {
        if (swapped || !realDirs.has(p)) return;
        swapped = true;
        const at = join(f.copy, name);
        if (swap === 'link') { renameSync(at, `${at}-moved`); symlinkSync(join(canary, 'secret.txt'), at); } else writeFileSync(at, 'later\n');
      }, () => api('POST', `/api/runs/${f.id}/apply`)));
    const label = `${swap} ${name}`;
    assert.ok(swapped, `${label}: the swap ran inside Apply`);
    assert.deepEqual([r.status, r.body], [200, { applied: 0, skipped: [{ path: name, reason: 'changed-in-folder' }] }], label);
    assert.deepEqual(filesHolding(f.dir, 'CANARY'), [], `${label}: the folder`);
    assert.deepEqual(filesHolding(f.pdir, 'CANARY'), [], `${label}: the pipeline dir (skipped/, changes.patch)`);
    assert.deepEqual(temps.filter((t) => t.includes('CANARY')), [], `${label}: a temp file in the folder`);
    assert.deepEqual([readFileSync(join(f.dir, 'notes.txt'), 'utf8'), existsSync(join(f.dir, 'new.txt'))], ['hello\n', false], `${label}: the folder is untouched`);
    if (swap === 'rewrite') assert.equal(readFileSync(join(f.pdir, 'skipped', name), 'utf8'), 'later\n', `${label}: the copy's version is saved`);
    assert.deepEqual(snapDir(canary), before, `${label}: the link target is untouched`);
  }
});

test('POSIX: a copy file swapped for a link while its skipped version is saved is never copied through the link', { skip: process.platform === 'win32' }, async () => {
  const f = await finished();
  writeFileSync(join(f.dir, 'new.txt'), 'theirs\n');                // the add is skipped: changed in the folder
  const canary = canaryDir(); const before = snapDir(canary);
  let swapped = false;
  const r = await withFspHook('rm', async (p) => {
    if (swapped || !p.endsWith(join('skipped', 'new.txt'))) return;
    swapped = true; renameSync(join(f.copy, 'new.txt'), join(f.copy, 'new.txt-moved')); symlinkSync(join(canary, 'secret.txt'), join(f.copy, 'new.txt'));
  }, () => api('POST', `/api/runs/${f.id}/apply`));
  assert.ok(swapped, 'the swap ran inside the save');
  assert.deepEqual([r.status, r.body], [200, { applied: 3, skipped: [{ path: 'new.txt', reason: 'changed-in-folder' }] }]);
  assert.equal(readFileSync(join(f.pdir, 'skipped', 'new.txt'), 'utf8'), 'new\n', 'the bytes of the file the save checked');
  assert.deepEqual(filesHolding(f.pdir, 'CANARY'), [], 'the pipeline dir (skipped/)');
  assert.deepEqual(filesHolding(f.dir, 'CANARY'), [], 'the folder');
  assert.equal(readFileSync(join(f.dir, 'new.txt'), 'utf8'), 'theirs\n');
  assert.deepEqual(snapDir(canary), before, 'the link target is untouched');
});

// M3 (hosted isolation): a FOLDER of the copy swapped for a link exactly while Apply lstats and opens a file under it
// (helpers/folder-flipper.mjs): every realpath check sees the real folder, so only each handle's real path tells.
test('POSIX, M3: a copy folder that is a link exactly while Apply lstats and opens a file under it: no byte of the link target reaches the folder, skipped/ or changes.patch, and every other file applies and saves as before', { skip: process.platform === 'win32' }, async () => {
  const f = await finished((c) => {
    defaultEdit(c); mkdirSync(join(c, 'sub'), { recursive: true });
    writeFileSync(join(c, 'sub', 'x.txt'), 'run x\n'); writeFileSync(join(c, 'sub', 'y.txt'), 'run y\n'); writeFileSync(join(c, 'sub', 'z.txt'), 'run z\n');
  });
  writeFileSync(join(f.dir, 'notes.txt'), 'mine\n');                 // skipped: its save reads the copy as before
  mkdirSync(join(f.dir, 'sub')); writeFileSync(join(f.dir, 'sub', 'x.txt'), 'user x\n');   // skipped: its save meets the link
  writeFileSync(join(f.dir, 'sub', 'z.txt'), 'same\n');              // read through the link, z.txt would pass as already in place
  const canary = mkdtempSync(join(tmpdir(), 'worca-fapply-canary-')); dirs.push(canary);
  for (const n of ['x.txt', 'y.txt']) writeFileSync(join(canary, n), 'CANARY\n');
  writeFileSync(join(canary, 'z.txt'), 'same\n');
  const before = snapDir(canary);
  const { result: r, flips } = await withFlipper({ folder: join(f.copy, 'sub'), target: canary, paths: ['x.txt', 'y.txt', 'z.txt'].map((n) => join(f.copy, 'sub', n)) },
    () => api('POST', `/api/runs/${f.id}/apply`));
  assert.ok(flips > 0, 'the flipper ran inside Apply');
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.deepEqual([r.body.applied, r.body.skipped.map((s) => s.path)], [3, ['notes.txt', 'sub/x.txt', 'sub/y.txt', 'sub/z.txt']], JSON.stringify(r.body));
  assert.deepEqual([readFileSync(join(f.dir, 'new.txt'), 'utf8'), existsSync(join(f.dir, 'old.txt')), existsSync(join(f.dir, 'docs', 'a.md'))], ['new\n', false, false],
    'the add and the deletes applied: every real and copy read inside its root');
  assert.deepEqual([readFileSync(join(f.dir, 'notes.txt'), 'utf8'), readFileSync(join(f.pdir, 'skipped', 'notes.txt'), 'utf8')], ['mine\n', 'hello world\n'], 'the skipped save read the copy');
  assert.deepEqual([readFileSync(join(f.dir, 'sub', 'x.txt'), 'utf8'), existsSync(join(f.dir, 'sub', 'y.txt')), readFileSync(join(f.dir, 'sub', 'z.txt'), 'utf8')], ['user x\n', false, 'same\n']);
  assert.deepEqual(filesHolding(f.dir, 'CANARY'), [], 'the folder');
  assert.deepEqual(filesHolding(f.pdir, 'CANARY'), [], 'the pipeline dir (skipped/, changes.patch)');
  assert.deepEqual(snapDir(canary), before, 'the link target is untouched');
});

test('POSIX, M3: a folder of the user\'s folder that is a link exactly while Apply reads a file under it (to a file equal to the run\'s start) never passes as unchanged: the user\'s edit stays, the run\'s version is saved', { skip: process.platform === 'win32' }, async () => {
  const f = await finished((c) => { writeFileSync(join(c, 'docs', 'a.md'), '# A run\n'); });
  writeFileSync(join(f.dir, 'docs', 'a.md'), '# A user\n');          // the user's edit: changed in the folder since the run started
  const canary = mkdtempSync(join(tmpdir(), 'worca-fapply-canary-')); dirs.push(canary);
  writeFileSync(join(canary, 'a.md'), '# A\n');                      // the run's start: read through the link, the edit is hidden
  const before = snapDir(canary);
  const { result: r, flips } = await withFlipper({ folder: join(f.dir, 'docs'), target: canary, paths: [join(f.dir, 'docs', 'a.md')] },
    () => api('POST', `/api/runs/${f.id}/apply`));
  assert.ok(flips > 0, 'the flipper ran inside Apply');
  assert.deepEqual([r.status, r.body], [200, { applied: 0, skipped: [{ path: 'docs/a.md', reason: 'changed-in-folder' }] }], JSON.stringify(r.body));
  assert.deepEqual([readFileSync(join(f.dir, 'docs', 'a.md'), 'utf8'), readFileSync(join(f.pdir, 'skipped', 'docs', 'a.md'), 'utf8')], ['# A user\n', '# A run\n']);
  assert.deepEqual(snapDir(canary), before, 'the link target is untouched');
});
