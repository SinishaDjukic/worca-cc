// test/design-versions.test.mjs
// Design P5 Task 10: versions as plain copies of work/ (dot entries and symlinks skipped, the last 20 kept), restore
// that brings the source back, clears stale questions, keeps the kit and is itself a new version, and the restore
// route on the receipt: 400 on a bad n or round, 409 while a build is live, a system notice row, a frame, no AI turn.
// One in-process server on the mock engine (test/helpers/design-chat-boot.mjs); its temp home serves the store rows.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, existsSync, mkdirSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { bootDesignChat } from './helpers/design-chat-boot.mjs';

const { call, openWs, waitFrame, mod } = await bootDesignChat(after);
// After the boot, so these open the boot's WORCA_HOME.
const { createDesign, getDesign } = await import('../src/core/design/store.mjs');
const { designDir, designWorkDir, distDir } = await import('../src/core/design/paths.mjs');
const { listVersions, restoreVersion, snapshotVersion } = await import('../src/core/design/versions.mjs');
const seed = (over) => { const d = createDesign({ kind: 'web', title: 'V' }, { by: 'local' }); const w = designWorkDir(d.id);
  mkdirSync(join(w, 'sections/hero'), { recursive: true }); mkdirSync(join(w, '.kit'), { recursive: true }); mkdirSync(join(w, '.asks'), { recursive: true });
  writeFileSync(join(w, 'plan.json'), JSON.stringify({ v: 1, kind: 'web', title: 'T', canvas: { w: 1440 }, notes: '', sections: [{ id: 'hero', job: 'Hero', brief: 'b', parts: ['html'], estHeight: 600 }] }));
  writeFileSync(join(w, 'shell.html'), '<!doctype html><html><head><!--worca:head--></head><body><!--worca:sections--><!--worca:foot--></body></html>');
  writeFileSync(join(w, 'sections/hero/index.html'), '<div data-section="hero">one</div>');
  writeFileSync(join(w, '.kit/CONTRACT.md'), 'kit'); writeFileSync(join(w, '.crew.json'), '[]'); writeFileSync(join(w, '.asks/a_00000000.json'), '{}');
  return { d, w }; };

test('a snapshot copies the source, skips dot entries and bumps the version', async () => {
  const { d } = seed();
  assert.equal(await snapshotVersion({ designId: d.id }), 1);
  assert.equal(getDesign(d.id).version, 1);
  const v = join(designDir(d.id), 'versions/1');
  assert.equal(readFileSync(join(v, 'sections/hero/index.html'), 'utf8'), '<div data-section="hero">one</div>');
  for (const hidden of ['.kit', '.crew.json', '.asks']) assert.equal(existsSync(join(v, hidden)), false, hidden);
});
test('only the last 20 are kept', async () => {
  const { d } = seed();
  for (let i = 0; i < 22; i += 1) await snapshotVersion({ designId: d.id });
  assert.deepEqual(listVersions(d.id).map((x) => x.n), Array.from({ length: 20 }, (_, i) => i + 3));
});
test('restore brings the source back, clears stale questions, keeps the kit, and is itself a new version', async () => {
  const { d, w } = seed();
  await snapshotVersion({ designId: d.id });
  writeFileSync(join(w, 'sections/hero/index.html'), '<div data-section="hero">two</div>');
  mkdirSync(join(w, 'sections/faq')); writeFileSync(join(w, 'sections/faq/index.html'), 'faq');
  await snapshotVersion({ designId: d.id });
  assert.deepEqual(await restoreVersion({ designId: d.id, n: 1 }), { version: 3, restoredFrom: 1 });
  assert.equal(readFileSync(join(w, 'sections/hero/index.html'), 'utf8'), '<div data-section="hero">one</div>');
  assert.equal(existsSync(join(w, 'sections/faq')), false);
  assert.equal(readFileSync(join(w, '.kit/CONTRACT.md'), 'utf8'), 'kit');
  assert.equal(existsSync(join(w, '.asks/a_00000000.json')), false);
  assert.equal(existsSync(join(w, '.crew.json')), false);
  assert.equal(getDesign(d.id).version, 3);
  assert.match(readFileSync(join(distDir(d.id), 'index.html'), 'utf8'), /data-section="hero">one</, 'dist follows the restored source');
});
test('a pruned or unknown version is a 404; a symlink is not copied', async () => {
  const { d, w } = seed();
  await assert.rejects(() => restoreVersion({ designId: d.id, n: 9 }), (e) => e.status === 404);
  try { symlinkSync(join(w, 'plan.json'), join(w, 'link.json')); } catch { return; }   // Windows without the privilege
  await snapshotVersion({ designId: d.id });
  assert.equal(existsSync(join(designDir(d.id), 'versions/1/link.json')), false);
});

/** A design made through POST /api/design (so it has its chat), its work/ seeded as `seed` seeds one, and two
 *  snapshots: versions 1 and 2. */
async function builtOnce() {
  const r = await call('POST', '/api/design', { kind: 'web', title: 'V' });
  assert.equal(r.status, 201);
  const d = r.body.design;
  cpSync(seed().w, designWorkDir(d.id), { recursive: true });
  assert.equal(await snapshotVersion({ designId: d.id }), 1);
  assert.equal(await snapshotVersion({ designId: d.id }), 2);
  return d;
}

test('restore route: 409 while a build runs, 400 on a bad n or round, notice row, frame', async () => {
  const frames = []; const ws = await openWs((f) => frames.push(f));
  const d = await builtOnce();
  assert.equal((await call('POST', `/api/design/${d.id}/versions/abc/restore`, {})).status, 400);
  assert.equal((await call('POST', `/api/design/${d.id}/versions/1/restore`, { round: 0 })).status, 400);
  assert.equal((await call('POST', `/api/design/${d.id}/versions/99/restore`, {})).status, 404);
  mod.designBuilds.live = () => [{ designId: d.id }];   // an own property over the prototype method; deleted below
  assert.deepEqual((await call('POST', `/api/design/${d.id}/versions/1/restore`, {})).status, 409);
  delete mod.designBuilds.live;
  const r = await call('POST', `/api/design/${d.id}/versions/1/restore`, { round: 2 });
  assert.deepEqual([r.status, r.body], [200, { ok: true, version: 3, restoredFrom: 1 }]);
  await waitFrame(frames, (f) => f.type === 'design-restored' && f.designId === d.id);   // before close: the frame may land after the response
  ws.close();
  const snap = (await call('GET', `/api/ask/threads/${d.threadId}`)).body;
  assert.equal(snap.messages.at(-1).text, 'Back to before round 2');
  assert.equal(snap.messages.at(-1).role, 'system');
  assert.equal(snap.inFlight, null, 'no AI turn');
});

// Beyond the plan's rows: each kills a guard the rows above leave unpinned (the mutation check).
test('a stale .tmp and a leftover folder never reach a version, only numbered folders are listed, a link in a version is not restored', async () => {
  const { d, w } = seed();
  const vs = join(designDir(d.id), 'versions');
  mkdirSync(join(vs, '1.tmp')); writeFileSync(join(vs, '1.tmp/stale.txt'), 'x');
  mkdirSync(join(vs, '1')); writeFileSync(join(vs, '1/old.txt'), 'x');
  assert.equal(await snapshotVersion({ designId: d.id }), 1);
  for (const gone of ['1.tmp', '1/stale.txt', '1/old.txt']) assert.equal(existsSync(join(vs, gone)), false, gone);
  assert.equal(existsSync(join(vs, '1/plan.json')), true);
  mkdirSync(join(vs, 'notes'));
  assert.deepEqual(listVersions(d.id).map((x) => x.n), [1], 'only numbered folders are versions');
  try { symlinkSync(join(w, 'shell.html'), join(vs, '1/link.html')); } catch { return; }   // Windows without the privilege
  await restoreVersion({ designId: d.id, n: 1 });
  assert.equal(existsSync(join(w, 'link.html')), false);
});
test('restore route with no round: the notice names an earlier version; a fractional round is a 400; GET lists the versions', async () => {
  const d = await builtOnce();
  assert.equal((await call('POST', `/api/design/${d.id}/versions/1/restore`, { round: 1.5 })).status, 400);
  const r = await call('POST', `/api/design/${d.id}/versions/2/restore`, {});
  assert.deepEqual([r.status, r.body], [200, { ok: true, version: 3, restoredFrom: 2 }]);
  const last = (await call('GET', `/api/ask/threads/${d.threadId}`)).body.messages.at(-1);
  assert.deepEqual([last.role, last.text], ['system', 'Back to an earlier version']);
  assert.deepEqual((await call('GET', `/api/design/${d.id}`)).body.versions.map((v) => v.n), [1, 2, 3]);
});
test('M3 in the real app: a held restore refuses another restore and a hand-off; two real restores never race', async () => {
  const d = await builtOnce();
  let release; const held = mod.designBuilds.whileRestoring(d.id, () => new Promise((res) => { release = res; }));
  const text = 'A restore is running: try again in a moment';
  assert.deepEqual(await call('POST', `/api/design/${d.id}/versions/1/restore`, {}), { status: 409, body: { error: text } });
  assert.deepEqual(await mod.designChatActions.apply({ kind: 'design-start', brief: 'x' }, { threadId: d.threadId, by: 'local' }), { ok: false, notice: text });
  release(); await held;
  const both = await Promise.allSettled([1, 2].map((n) => call('POST', `/api/design/${d.id}/versions/${n}/restore`, {})));
  assert.deepEqual(both.map((x) => x.value.status).sort(), [200, 409]);
  assert.equal(getDesign(d.id).version, 3, 'one restore, one new version');
});
test('a finished round on the real server takes a version', async () => {
  const d = (await call('POST', '/api/design', { kind: 'web', title: 'Round' })).body.design;
  const r = await mod.designChatActions.apply({ kind: 'design-start', brief: 'A landing page' }, { threadId: d.threadId, by: 'local' });
  assert.equal(r.ok, true, JSON.stringify(r));
  await mod.designBuilds.settled();
  r.posted(false);
  assert.equal(getDesign(d.id).version, 1, 'the server hands snapshotVersion to the engine');
  assert.deepEqual(listVersions(d.id).map((x) => x.n), [1]);
});
