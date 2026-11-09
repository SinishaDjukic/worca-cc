// test/design-export.test.mjs — Design P6 Task 2: the export stem (one safe name on every OS), the standalone page
// (no bridge, local refs inlined, what was left out comes back), the zip of dist/ (one top folder, forward slashes,
// UTF-8 names, links skipped, the writer awaited, an abort stops it), the finished-round rule and the problems header.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync, symlinkSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { unzipSync, strFromU8 } from 'fflate';
import { useTempHome } from './helpers/temp-home.mjs';
import { checkRows } from './helpers/rows.mjs';
import { PLAN, seedDone } from './helpers/design-export-seed.mjs';
import { designWorkDir, distDir } from '../src/core/design/paths.mjs';
import { assembleDesign, BRIDGE_MARKER } from '../src/core/design/assemble.mjs';
import { exportHtml, zipDist, requireExportable, ExportRefusal, encodeProblems, listDistFiles } from '../src/core/design/export.mjs';
import { exportStem } from '../src/shared/design-names.mjs';

useTempHome(after);
test('exportStem: one safe name on every OS', async () => {
  await checkRows([['Q4 roadmap review', 'q4-roadmap-review'], ['A/B test: v1.2', 'a-b-test-v1.2'], ['CON', 'file-con'], ['com1', 'file-com1'], ['日本語のページ', 'file'], ['...', 'file'], ['🚀 Launch', 'launch'], ['Café Menü', 'cafe-menu'], ['con.x', 'file-con.x'], ['x'.repeat(200), 'x'.repeat(60)]]
    .map(([t, want]) => ({ name: t, run: () => assert.equal(exportStem(t), want) })));
});
test('standalone: no bridge, the page stands alone, problems come back', () => {
  const r = exportHtml(seedDone());
  assert.equal(r.name, 'ship-radar.html');
  assert.equal(r.html.includes(BRIDGE_MARKER), false);
  assert.ok(r.html.includes('src="data:image/png;base64,'));
  assert.deepEqual(r.problems, [{ ref: 'https://x.dev/a.png', why: 'remote' }]);
});
const unzip = async (d) => { const chunks = []; await zipDist({ dist: distDir(d.id), root: 'ship-radar', write: (c) => { chunks.push(Buffer.from(c)); } }); return unzipSync(new Uint8Array(Buffer.concat(chunks))); };
test('zip: forward slashes under one folder, every dist file, UTF-8 names, no bridge', async () => {
  const files = await unzip(seedDone());
  assert.deepEqual(Object.keys(files).sort(), ['ship-radar/assets/logo.png', 'ship-radar/index.html', 'ship-radar/sections/hero/assets/é a.svg']);
  assert.equal(strFromU8(files['ship-radar/assets/logo.png']), 'PNG');
  for (const [k, v] of Object.entries(files)) { assert.equal(k.includes('\\'), false, k); assert.equal(strFromU8(v).includes(BRIDGE_MARKER), false, k); }
});
test('zip: waits for the writer and stops on abort', async () => {
  const d = seedDone({ 'assets/big.bin': randomBytes(1024 * 1024).toString('hex') });
  assembleDesign({ workDir: designWorkDir(d.id), plan: PLAN, mode: 'dist' });
  let inFlight = false;
  await zipDist({ dist: distDir(d.id), root: 'r', write: async () => { assert.equal(inFlight, false); inFlight = true; await new Promise(setImmediate); inFlight = false; } });
  const ac = new AbortController(); let n = 0;
  await assert.rejects(zipDist({ dist: distDir(d.id), root: 'r', signal: ac.signal, write: () => { n += 1; ac.abort(); } }), { name: 'AbortError' });
  const seen = n; await new Promise(setImmediate); assert.equal(n, seen);
});
test('zip skips links', { skip: process.platform === 'win32' ? 'POSIX' : false }, async () => {
  const d = seedDone(); symlinkSync('/etc/hosts', join(distDir(d.id), 'assets', 'x.txt'));
  assert.equal('ship-radar/assets/x.txt' in await unzip(d), false);
});
test('requireExportable: only a finished round', () => {
  const d = seedDone();
  assert.equal(requireExportable(d), undefined);
  for (const status of ['empty', 'planning', 'building', 'integrating', 'paused', 'stopped', 'error', 'interrupted']) assert.throws(() => requireExportable({ ...d, status }), (e) => e instanceof ExportRefusal && e.status === 409 && e.code === 'not-done', status);
});
test('encodeProblems fits a header, keeping the true total', () => {
  const many = Array.from({ length: 500 }, (_, i) => ({ ref: `日本語/${i}/${'x'.repeat(300)}`, why: 'missing' }));
  const v = encodeProblems(many);
  assert.ok(v.length <= 6000);
  const o = JSON.parse(decodeURIComponent(v));
  assert.equal(o.total, 500); assert.ok(o.shown.length <= 20); assert.ok(o.shown[0].ref.length <= 120);
});
test('exportStem: accents inside a word drop, and a cut never ends on a dash', () => {
  assert.equal(exportStem('Naïve Résumé'), 'naive-resume');
  assert.equal(exportStem(`${'a'.repeat(59)} b`), 'a'.repeat(59));
  assert.equal(exportStem(`🚀 ${'x'.repeat(70)}`), 'x'.repeat(60));
});
test('zip: nothing is written after an abort, and the file count comes back', async () => {
  const d = seedDone();
  assert.deepEqual(await zipDist({ dist: distDir(d.id), root: 'r', write: () => {} }), { files: 3 });
  const ac = new AbortController(); let n = 0;
  await assert.rejects(zipDist({ dist: distDir(d.id), root: 'r', signal: ac.signal, write: () => { n += 1; ac.abort(); } }), { name: 'AbortError' });
  assert.equal(n, 1);
});
test('encodeProblems: long refs drop shown entries, a cut through an emoji still encodes', () => {
  const v = encodeProblems(Array.from({ length: 30 }, () => ({ ref: '日'.repeat(200), why: 'missing' })));
  assert.ok(v.length <= 6000, String(v.length));
  const wide = JSON.parse(decodeURIComponent(v));
  assert.equal(wide.total, 30); assert.ok(wide.shown.length >= 1 && wide.shown.length < 20, String(wide.shown.length));
  const o = JSON.parse(decodeURIComponent(encodeProblems([{ ref: `${'a'.repeat(119)}🚀`, why: 'missing' }])));
  assert.equal(o.total, 1); assert.ok(o.shown[0].ref.length <= 120); assert.ok(o.shown[0].ref.startsWith('a'.repeat(119)));
});
test('requireExportable and exportHtml: done without dist/index.html, or not done, refuses', () => {
  const refused = (e) => e instanceof ExportRefusal && e.status === 409 && e.code === 'not-done';
  const d = seedDone();
  assert.throws(() => exportHtml({ ...d, status: 'stopped' }), refused);
  unlinkSync(join(distDir(d.id), 'index.html'));
  assert.throws(() => requireExportable(d), refused);
});
test('listDistFiles leaves dot names out', () => {
  const d = seedDone(); writeFileSync(join(distDir(d.id), '.hidden'), 'x'); writeFileSync(join(distDir(d.id), 'assets', '.x'), 'x');
  assert.deepEqual(listDistFiles(distDir(d.id)), ['assets/logo.png', 'index.html', 'sections/hero/assets/é a.svg']);
});
test('a missing, broken or other-kind plan.json refuses the html export as not done', () => {
  const refused = (e) => e instanceof ExportRefusal && e.status === 409 && e.code === 'not-done';
  for (const text of [null, '{']) {
    const d = seedDone(); const p = join(designWorkDir(d.id), 'plan.json');
    if (text === null) unlinkSync(p); else writeFileSync(p, text);
    assert.throws(() => exportHtml(d), refused, String(text));
  }
  assert.throws(() => exportHtml({ ...seedDone(), kind: 'presentation' }), refused, 'kind');
});
