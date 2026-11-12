// test/design-export.test.mjs — Design P6 Task 2: the export stem (one safe name on every OS), the standalone page
// (no bridge, local refs inlined, what was left out comes back), the zip of dist/ (one top folder, forward slashes,
// UTF-8 names, links skipped, the writer awaited, an abort stops it), the finished-round rule and the problems header.
// Design P7 Task 12: `exportHtml` is async; a deck goes through the kit's bundler, whose failures and a missing kit file
// are 422 refusals.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdirSync, readFileSync, rmSync, writeFileSync, symlinkSync, unlinkSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes } from 'node:crypto';
import { unzipSync, strFromU8 } from 'fflate';
import { useTempHome } from './helpers/temp-home.mjs';
import { checkRows } from './helpers/rows.mjs';
import { PLAN, SHELL, seedDone } from './helpers/design-export-seed.mjs';
import { designWorkDir, distDir } from '../src/core/design/paths.mjs';
import { assembleDesign, BRIDGE_MARKER } from '../src/core/design/assemble.mjs';
import { exportHtml, zipDist, requireExportable, ExportRefusal, encodeProblems, listDistFiles, printDeckPdf } from '../src/core/design/export.mjs';
import { createDesign, updateDesign } from '../src/core/design/store.mjs';
import { thumbStillCss } from '../src/core/design/kinds.mjs';
import { createThumbs, thumbUrl } from '../src/core/design/thumb.mjs';
import { exportStem } from '../src/shared/design-names.mjs';

useTempHome(after);
const DECK = { v: 1, kind: 'pitch', title: 'T', canvas: { w: 1920, h: 1080 }, notes: '', sections: [{ id: 's1', job: 'One', brief: 'b', parts: ['html'] }] };
/** A done pitch: its kit staged (empty files, as design-export-pdf's `deck()`), `dist/` assembled. */
function seedPitch() {
  const d = createDesign({ kind: 'pitch', title: 'Seed deck' }, { by: 'local' }); const w = designWorkDir(d.id);
  const put = (rel, t) => { mkdirSync(dirname(join(w, rel)), { recursive: true }); writeFileSync(join(w, rel), t); };
  put('plan.json', JSON.stringify(DECK)); put('shell.html', SHELL);
  for (const name of ['deck-stage.js', 'deck-pipeline.js', 'deck-enhance.js']) put(`.kit/${name}`, '');
  put('sections/s1/index.html', '<section data-section="s1" data-label="One">1</section>');
  assembleDesign({ workDir: w, plan: DECK, mode: 'dist' });
  return updateDesign(d.id, { status: 'done' });
}
/** Runs `fn` with console.error captured; returns what it logged. */
async function logged(fn) {
  const lines = []; const was = console.error; console.error = (...a) => { lines.push(a.join(' ')); };
  try { await fn(); } finally { console.error = was; }
  return lines.join('\n');
}
test('exportStem: one safe name on every OS', async () => {
  await checkRows([['Q4 roadmap review', 'q4-roadmap-review'], ['A/B test: v1.2', 'a-b-test-v1.2'], ['CON', 'file-con'], ['com1', 'file-com1'], ['日本語のページ', 'file'], ['...', 'file'], ['🚀 Launch', 'launch'], ['Café Menü', 'cafe-menu'], ['con.x', 'file-con.x'], ['x'.repeat(200), 'x'.repeat(60)]]
    .map(([t, want]) => ({ name: t, run: () => assert.equal(exportStem(t), want) })));
});
test('standalone: no bridge, the page stands alone, problems come back', async () => {
  const r = await exportHtml(seedDone());
  assert.equal(r.name, 'ship-radar.html');
  assert.equal(r.html.includes(BRIDGE_MARKER), false);
  assert.ok(r.html.includes('src="data:image/png;base64,'));
  assert.deepEqual(r.problems, [{ ref: 'https://x.dev/a.png', why: 'remote' }]);
});
test('a document\'s HTML export holds its contents list and worca\'s fonts inline', async () => {
  const d = seedDone({
    'sections/hero/index.html': '<section data-section="hero"><h2 id="hero-title">Hero</h2></section>',
    'tokens.css': "@font-face{font-family:'Poppins';src:url(assets/worca/poppins-latin-400-normal.woff2) format('woff2')}",
    'assets/worca/poppins-latin-400-normal.woff2': 'wOF2',
  }, { kind: 'document' });
  const r = await exportHtml(d);
  assert.ok(r.html.includes('data:font/woff2;base64,'));
  assert.ok(r.html.includes('data-worca-toc'));
  assert.ok(r.html.includes('@page{size:A4'));
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
test('requireExportable and exportHtml: done without dist/index.html, or not done, refuses', async () => {
  const refused = (e) => e instanceof ExportRefusal && e.status === 409 && e.code === 'not-done';
  const d = seedDone();
  await assert.rejects(exportHtml({ ...d, status: 'stopped' }), refused);
  unlinkSync(join(distDir(d.id), 'index.html'));
  assert.throws(() => requireExportable(d), refused);
});
test('listDistFiles leaves dot names out', () => {
  const d = seedDone(); writeFileSync(join(distDir(d.id), '.hidden'), 'x'); writeFileSync(join(distDir(d.id), 'assets', '.x'), 'x');
  assert.deepEqual(listDistFiles(distDir(d.id)), ['assets/logo.png', 'index.html', 'sections/hero/assets/é a.svg']);
});
test('a missing, broken or other-kind plan.json refuses the html export as not done', async () => {
  const refused = (e) => e instanceof ExportRefusal && e.status === 409 && e.code === 'not-done';
  for (const text of [null, '{']) {
    const d = seedDone(); const p = join(designWorkDir(d.id), 'plan.json');
    if (text === null) unlinkSync(p); else writeFileSync(p, text);
    await assert.rejects(exportHtml(d), refused, String(text));
  }
  await assert.rejects(exportHtml({ ...seedDone(), kind: 'presentation' }), refused, 'kind');
});
test('a pitch whose bundler fails is a 422 bundle, its whole message only in the log; an abort stays an abort', async () => {
  const failing = () => { const c = new EventEmitter(); c.stderr = new EventEmitter(); queueMicrotask(() => { c.stderr.emit('data', Buffer.from('[build] ✗ EACCES /srv/secret\n')); c.emit('close', 1, null); }); return c; };
  const d = seedPitch();
  const log = await logged(() => assert.rejects(exportHtml(d, { spawnImpl: failing }), (e) => e instanceof ExportRefusal && e.status === 422 && e.code === 'bundle' && e.message === 'Could not bundle the deck.'));
  assert.match(log, /Could not bundle the deck: EACCES \/srv\/secret/);
  const ac = new AbortController();
  const slow = (cmd, args, opts) => { const c = new EventEmitter(); c.stderr = new EventEmitter(); c.kill = () => queueMicrotask(() => c.emit('close', null, 'SIGKILL')); opts.signal?.addEventListener('abort', () => c.kill()); queueMicrotask(() => ac.abort()); return c; };
  const quiet = await logged(() => assert.rejects(exportHtml(d, { signal: ac.signal, spawnImpl: slow }), (e) => !(e instanceof ExportRefusal) && e.name === 'AbortError'));
  assert.equal(quiet, '');
});
test('a pitch whose kit is gone is a 422 kit, naming the file and no path, for the html and the PDF alike', async () => {
  const d = seedPitch(); rmSync(join(designWorkDir(d.id), '.kit'), { recursive: true, force: true });
  const kit = (e) => e instanceof ExportRefusal && e.status === 422 && e.code === 'kit'
    && e.message === 'The kit file deck-stage.js is missing. Start a new round to stage it again.' && !e.message.includes(designWorkDir(d.id));
  await assert.rejects(exportHtml(d, { spawnImpl: () => { throw new Error('no spawn'); } }), kit);
  await assert.rejects(printDeckPdf({ design: d, plan: DECK, chrome: '/no/chrome', run: async () => { throw new Error('no print'); } }), kit);
});
test('a deck\'s thumbnail shows its stage, with no script run', async () => {
  const d = seedPitch(); const docs = [];
  const run = async (chrome, args, o) => { docs.push(readFileSync(fileURLToPath(args.at(-1)), 'utf8')); writeFileSync(o.outFile, 'PNG'); return { ok: true }; };
  createThumbs({ chrome: () => '/c', queue: { run: (fn) => fn() }, run }).ensure(d);
  for (let i = 0; i < 100 && thumbUrl(d.id) === null; i++) await new Promise((r) => setTimeout(r, 10));
  assert.equal(docs.length, 1);
  assert.ok(docs[0].includes(`<style>${thumbStillCss('pitch')}</style>`)); assert.equal(docs[0].includes('<script'), false);
});
