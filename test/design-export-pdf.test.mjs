// test/design-export-pdf.test.mjs — Design P6 Task 4: the deck PDF on the deck path. The page count is the kit's rule
// (`scripts/deck-pdf.py`), the doc Chrome prints holds worca's kit and no model JS (L6.1), the kind and Chrome are
// checked before anything is made, and every refusal leaves no temp folder. Chrome is a fake that writes a PDF.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { useTempHome } from './helpers/temp-home.mjs';
import { createDesign, updateDesign } from '../src/core/design/store.mjs';
import { designWorkDir } from '../src/core/design/paths.mjs';
import { BRIDGE_MARKER } from '../src/core/design/assemble.mjs';
import { countPdfPages, liveSlides, printDeckPdf, ExportRefusal } from '../src/core/design/export.mjs';

useTempHome(after);
const PDF = (n) => Buffer.from(`%PDF-1.7\n<< /Type /Pages /Count ${n} >>\n` + '<< /Type /Page /Parent 1 0 R >>\n'.repeat(n));
const DECK = { v: 1, kind: 'pitch', title: 'T', canvas: { w: 1920, h: 1080 }, notes: '', sections: [{ id: 's1', job: 'One', brief: 'b', parts: ['html', 'js'] }, { id: 's2', job: 'Two', brief: 'b', parts: ['html'] }, { id: 's3', job: 'Skip', brief: 'b', parts: ['html'] }] };
function deck() {
  const d = createDesign({ kind: 'pitch', title: 'Seed deck' }, { by: 'local' }); const w = designWorkDir(d.id);
  const put = (rel, t) => { mkdirSync(dirname(join(w, rel)), { recursive: true }); writeFileSync(join(w, rel), t); };
  put('plan.json', JSON.stringify(DECK)); put('shell.html', '<!doctype html><html><head><!--worca:head--></head><body><deck-stage><!--worca:sections--></deck-stage><!--worca:foot--></body></html>');
  put('sections/s1/index.html', '<section data-section="s1">1</section>'); put('sections/s1/script.js', 'MODELJS()');
  put('sections/s2/index.html', '<section data-section="s2">2</section>'); put('sections/s3/index.html', '<section data-section="s3" data-deck-skip>3</section>');
  return { d: updateDesign(d.id, { status: 'done' }), w };
}
const writes = (pages, seen = {}) => async (chrome, args, o) => { seen.chrome = chrome; seen.doc = readFileSync(fileURLToPath(args.at(-1)), 'utf8'); seen.outFile = o.outFile; seen.timeoutMs = o.timeoutMs; writeFileSync(o.outFile, PDF(pages)); return { ok: true }; };

test('countPdfPages and liveSlides are the deck path\'s rules', () => {
  assert.equal(countPdfPages(PDF(5)), 5);
  const { w } = deck(); assert.equal(liveSlides({ workDir: w, plan: DECK }), 2);
});
test('prints with the kit only: model JS is not in the doc', async () => {
  const { d } = deck(); const seen = {};
  const r = await printDeckPdf({ design: d, plan: DECK, chrome: '/c', run: writes(2, seen) });
  assert.deepEqual([r.pages, r.slides, r.name, seen.timeoutMs], [2, 2, 'seed-deck.pdf', 180000]);
  assert.equal(seen.doc.includes('MODELJS'), false);
  assert.ok(seen.doc.includes('customElements.define'));
  assert.match(seen.doc, /^<!doctype html><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'nonce-/);
  assert.equal(seen.doc.includes(BRIDGE_MARKER), false);
  assert.ok(existsSync(r.file)); const dir = dirname(r.file); r.cleanup(); assert.equal(existsSync(dir), false);
});
test('refusals, and no temp folder left', async () => {
  const { d } = deck(); const made = [];   // the folders this test's own fakes saw: other runs share os.tmpdir()
  const rec = (run) => async (c, a, o) => { made.push(dirname(o.outFile)); return run(c, a, o); };
  const refused = (c) => (e) => e instanceof ExportRefusal && e.code === c && e.status === 422;
  await assert.rejects(printDeckPdf({ design: { ...d, kind: 'web' }, plan: DECK, chrome: '/c', run: rec(writes(2)) }), refused('decks-only'));
  await assert.rejects(printDeckPdf({ design: { ...d, kind: 'video' }, plan: DECK, chrome: '/c', run: rec(writes(2)) }), refused('decks-only'));
  await assert.rejects(printDeckPdf({ design: d, plan: DECK, chrome: null, run: rec(writes(2)) }), refused('no-chrome'));
  await assert.rejects(printDeckPdf({ design: d, plan: DECK, chrome: '/c', run: rec(async () => ({ ok: false, reason: 'timed out' })) }), (e) => refused('no-pdf')(e) && e.message === 'Chrome produced no PDF: timed out.');
  await assert.rejects(printDeckPdf({ design: d, plan: DECK, chrome: '/c', run: rec(writes(3)) }), (e) => refused('page-count')(e) && e.message === 'The PDF came out with 3 pages for 2 slides, so it was not saved.');
  assert.equal(made.length, 2, 'the kind and Chrome checks come before any folder');
  assert.ok(made.every((dir) => !existsSync(dir)));
});
test('a presentation prints too; the signal and the sandbox flag reach Chrome; what was left out comes back', async () => {
  const { d, w } = deck();
  writeFileSync(join(w, 'sections/s2/index.html'), '<section data-section="s2"><img src="https://x.dev/a.png">2</section>');
  const seen = {}; const ac = new AbortController(); const prev = process.env.CHROME_NO_SANDBOX;
  const spy = (run) => async (c, a, o) => { seen.signal = o.signal; seen.args = a; return run(c, a, o); };
  process.env.CHROME_NO_SANDBOX = '1';
  try {
    const r = await printDeckPdf({ design: { ...d, kind: 'presentation' }, plan: DECK, chrome: '/c', signal: ac.signal, run: spy(writes(2)) });
    assert.equal(seen.signal, ac.signal);
    assert.ok(seen.args.includes('--no-sandbox'));
    assert.deepEqual(r.problems, [{ ref: 'https://x.dev/a.png', why: 'remote' }]);
    r.cleanup();
  } finally {
    if (prev === undefined) delete process.env.CHROME_NO_SANDBOX; else process.env.CHROME_NO_SANDBOX = prev;
  }
  if (process.getuid?.() !== 0) {
    (await printDeckPdf({ design: d, plan: DECK, chrome: '/c', run: spy(writes(2)) })).cleanup();
    assert.equal(seen.args.includes('--no-sandbox'), false);
  }
  await assert.rejects(printDeckPdf({ design: d, plan: DECK, chrome: '/c', run: writes(1) }), (e) => e.code === 'page-count' && e.message === 'The PDF came out with 1 page for 2 slides, so it was not saved.');
});
test('liveSlides: a missing section file and a file with no tag print nothing; a leading comment is not a tag', () => {
  const { w } = deck();
  mkdirSync(join(w, 'sections/s4'), { recursive: true }); writeFileSync(join(w, 'sections/s4/index.html'), '<!-- slide four --><section data-section="s4">4</section>');
  mkdirSync(join(w, 'sections/s5'), { recursive: true }); writeFileSync(join(w, 'sections/s5/index.html'), 'just text');
  const plan = { ...DECK, sections: [...DECK.sections, { id: 'gone' }, { id: 's4' }, { id: 's5' }] };
  assert.equal(liveSlides({ workDir: w, plan }), 3);
});
