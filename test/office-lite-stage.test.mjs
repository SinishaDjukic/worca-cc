// test/office-lite-stage.test.mjs — the stage routes an Office file to the simplified preview only when the PDF probe answers
// 501 and the caller passed deps.loadOfficeLite; office-lite.mjs then loads the libraries, fetches the capped bytes, reads,
// renders, and never throws (refusals become the caller's info view, stale renders never mount, blob URLs are revoked).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { loadPreview, OFFICE_NEEDS_LIBREOFFICE } from '../ui/public/artifacts/stage.mjs';
import { LITE_NOTE, LITE_VENDOR, liteReason } from '../ui/public/artifacts/office-lite.mjs';
import { OfficeLiteError } from '../ui/public/artifacts/office-zip.mjs';
import { OFFICE_LITE_LIMITS } from '../src/shared/artifact-kinds.mjs';
import { fixture, manyEntries, respond } from './helpers/office-lite-fixtures.mjs';
import { officeVendor } from './helpers/office-vendor.mjs';

const MD = { marked: (await import('marked')).marked, createDOMPurify: (await import('dompurify')).default };
const realLoad = async () => MD;
const URLS = { text: (r) => `/t/${r}`, raw: (r) => `/raw/${r}`, download: (r) => `/raw/${r}?download=1`, pdf: (r) => `/raw/${r}?as=pdf` };
const loadOfficeLite = () => import('../ui/public/artifacts/office-lite.mjs');

/** A window, its stage, a recording fetch: HEAD answers `heads[url]` (default 200), GET answers `bodies[url]`. */
function harness({ heads = {}, bodies = {} } = {}) {
  const { window: win } = new JSDOM('<!doctype html><html><body><div id="stage"><p>Loading…</p></div></body></html>',
    { runScripts: 'outside-only', pretendToBeVisual: true, url: 'http://localhost:4317/' });
  const vendor = officeVendor(win);
  const calls = [];
  const fetch = async (url, opts = {}) => {
    const method = opts.method || 'GET';
    calls.push(`${method} ${url}`);
    if (method === 'HEAD') {
      const status = heads[url] ?? 200;
      return { ok: status >= 200 && status < 300, status, headers: { get: () => null } };
    }
    const b = bodies[url];
    if (!b) return respond(new Uint8Array(0), { status: 404 });
    return b instanceof Uint8Array ? respond(b) : respond(b.bytes, b.opts);
  };
  const stage = win.document.getElementById('stage');
  const load = (rel, o = {}) => loadPreview({ artifact: { kind: null, relPath: rel }, stage: o.stage || stage, urls: URLS, fetch,
    deps: o.deps || { loadOfficeLite, officeImport: vendor.importer, loadMarkdown: realLoad }, live: o.live });
  return { win, doc: win.document, vendor, calls, fetch, stage, load };
}
const PDF = (rel) => `/raw/${rel}?as=pdf`;
const DL = (rel) => `/raw/${rel}?download=1`;
const fallback = (rel, bytes, extra = {}) => harness({ heads: { [PDF(rel)]: 501 }, bodies: { [DL(rel)]: bytes }, ...extra });
const covers = (revoked, created) => created.every((u) => revoked.includes(u));

test('T-S1 HEAD 200: the converted PDF, one probe, no vendor import', async () => {
  const h = harness();
  const out = await h.load('docs/memo.docx');
  assert.equal(out.state, 'shown');
  assert.equal(h.stage.querySelector('embed[type="application/pdf"]').getAttribute('src'), PDF('docs/memo.docx'));
  assert.deepEqual(h.calls, [`HEAD ${PDF('docs/memo.docx')}`]);
  assert.deepEqual(h.vendor.calls, []);
  assert.equal(h.stage.querySelector('.olp'), null);
});

test('T-S2 only 501 falls back; 413/415/422/404 keep today\'s view without a download; 501 without loadOfficeLite keeps "Install LibreOffice"', async () => {
  const ok = fallback('q3.xlsx', fixture('budget.xlsx'));
  const out = await ok.load('q3.xlsx');
  assert.deepEqual(out, { state: 'shown', media: null, preview: 'office-lite', format: 'sheet' });
  assert.ok(ok.stage.querySelector('.olp'));
  for (const [status, want] of [[413, { state: 'info', reason: 'Too large to preview' }], [415, { state: 'info', reason: 'No preview for this file type' }],
    [422, { state: 'info', reason: 'Could not convert this file' }], [404, { state: 'error', message: 'File not found' }]]) {
    const h = harness({ heads: { [PDF('q3.xlsx')]: status }, bodies: { [DL('q3.xlsx')]: fixture('budget.xlsx') } });
    assert.deepEqual(await h.load('q3.xlsx'), want, String(status));
    assert.deepEqual(h.calls, [`HEAD ${PDF('q3.xlsx')}`], `${status}: no download fetch`);
    assert.deepEqual(h.vendor.calls, []);
  }
  const bare = fallback('q3.xlsx', fixture('budget.xlsx'));
  assert.deepEqual(await bare.load('q3.xlsx', { deps: { loadMarkdown: realLoad } }), { state: 'info', reason: OFFICE_NEEDS_LIBREOFFICE });
  assert.deepEqual(bare.calls, [`HEAD ${PDF('q3.xlsx')}`]);
});

test('T-S3 the banner says LITE_NOTE and its Download probes the download URL; data-office-path per format for all six extensions', async () => {
  const files = { 'a/memo.docx': ['memo.docx', 'docx'], 'a/q.xlsx': ['budget.xlsx', 'sheet'], 'a/t.ods': ['table.ods', 'sheet'],
    'a/d.pptx': ['deck.pptx', 'slides'], 'a/d.odp': ['deck.odp', 'slides'], 'a/n.odt': ['notes.odt', 'text'] };
  for (const [rel, [fx, format]] of Object.entries(files)) {
    const h = fallback(rel, fixture(fx));
    const out = await h.load(rel);
    assert.equal(out.format, format, rel);
    const root = h.stage.querySelector('.olp');
    assert.equal(root.dataset.officePath, format, rel);
    assert.equal(root.querySelector('.olp-banner[role="note"] .olp-note').textContent, LITE_NOTE);
    const dl = root.querySelector('button.btn.btn-sm.olp-dl');
    assert.equal(dl.textContent, 'Download');
    if (rel !== 'a/memo.docx') continue;
    const clicks = [];
    h.win.HTMLAnchorElement.prototype.click = function () { clicks.push([this.getAttribute('href'), this.getAttribute('download')]); };
    h.calls.length = 0;
    dl.click();
    for (let i = 0; i < 5; i++) await new Promise((r) => setTimeout(r, 0));
    assert.deepEqual(h.calls, [`HEAD ${DL(rel)}`]);
    assert.deepEqual(clicks, [[DL(rel), 'memo.docx']]);
  }
  assert.equal(LITE_NOTE, 'Simplified preview — install LibreOffice for full fidelity');
  const fail = harness({ heads: { [PDF('x.odt')]: 501, [DL('x.odt')]: 404 }, bodies: { [DL('x.odt')]: fixture('notes.odt') } });
  await fail.load('x.odt');
  fail.stage.querySelector('.olp-dl').click();
  for (let i = 0; i < 5; i++) await new Promise((r) => setTimeout(r, 0));
  const err = fail.stage.querySelector('.olp-dl-error');
  assert.equal(err.hidden, false);
  assert.equal(err.textContent, 'Download failed: File not found');
});

test('T-S4 refusals become info with their texts: no .olp, nothing left unrevoked', async () => {
  const L = OFFICE_LITE_LIMITS;
  const cases = [
    ['big.xlsx', { bytes: fixture('budget.xlsx'), opts: { contentLength: 60 * 1024 * 1024 } }, 'Too large for the simplified preview (over 50.0 MB). Install LibreOffice to preview it.'],
    ['bomb.xlsx', fixture('bomb.xlsx'), 'Expands past the simplified preview\'s limit (200.0 MB). Install LibreOffice to preview it.'],
    ['many.xlsx', await manyEntries(5001), 'Too many parts for the simplified preview (over 5,000). Install LibreOffice to preview it.'],
    ['dtd.xlsx', fixture('dtd.xlsx'), 'Could not read this file. Install LibreOffice to preview it.'],
    ['junk.pptx', new Uint8Array(2000).fill(9), 'Could not read this file. Install LibreOffice to preview it.'],
  ];
  for (const [rel, body, reason] of cases) {
    const h = fallback(rel, body);
    assert.deepEqual(await h.load(rel), { state: 'info', reason }, rel);
    assert.equal(h.stage.querySelector('.olp'), null, rel);
  }
  const rejects = fallback('q.xlsx', fixture('budget.xlsx'));
  assert.deepEqual(await rejects.load('q.xlsx', { deps: { loadOfficeLite: () => Promise.reject(new Error('404')), officeImport: rejects.vendor.importer } }),
    { state: 'info', reason: OFFICE_NEEDS_LIBREOFFICE });
  const noLib = fallback('q.xlsx', fixture('budget.xlsx'));
  assert.deepEqual(await noLib.load('q.xlsx', { deps: { loadOfficeLite, officeImport: () => Promise.reject(new Error('404')) } }), { state: 'info', reason: OFFICE_NEEDS_LIBREOFFICE });
  assert.ok(!noLib.calls.some((c) => c.includes('download')), 'the libraries load before the bytes');
  const throwing = fallback('q.xlsx', fixture('budget.xlsx'));
  assert.deepEqual(await throwing.load('q.xlsx', { deps: { loadOfficeLite, officeImport: () => { throw new Error('sync'); } } }), { state: 'info', reason: OFFICE_NEEDS_LIBREOFFICE });
  const noGlobal = fallback('q.xlsx', fixture('budget.xlsx'));
  assert.deepEqual(await noGlobal.load('q.xlsx', { deps: { loadOfficeLite, officeImport: async () => ({}) } }), { state: 'info', reason: OFFICE_NEEDS_LIBREOFFICE }, 'an import that sets no global');
  const noMd = fallback('m.docx', fixture('memo.docx'));
  assert.deepEqual(await noMd.load('m.docx', { deps: { loadOfficeLite, officeImport: noMd.vendor.importer } }), { state: 'info', reason: OFFICE_NEEDS_LIBREOFFICE }, 'docx without loadMarkdown');
  // A failure after docx-preview made its blobs: every one is revoked.
  const late = fallback('m.docx', fixture('memo.docx'));
  const brokenPurify = () => ({ addHook() {}, sanitize() { throw new Error('purify'); } });
  const out = await late.load('m.docx', { deps: { loadOfficeLite, officeImport: late.vendor.importer, loadMarkdown: async () => ({ createDOMPurify: brokenPurify }) } });
  assert.deepEqual(out, { state: 'info', reason: 'Could not read this file. Install LibreOffice to preview it.' });
  assert.ok(late.vendor.created.length > 0, 'the case is not vacuous');
  assert.ok(covers(late.vendor.revoked, late.vendor.created));
  assert.equal(late.stage.querySelector('.olp'), null);
  const nf = harness({ heads: { [PDF('n.odt')]: 501 } });
  assert.deepEqual(await nf.load('n.odt'), { state: 'error', message: 'File not found' });
  assert.equal(liteReason(new OfficeLiteError('LOAD_FAILED'), L), OFFICE_NEEDS_LIBREOFFICE);
  assert.equal(liteReason(new Error('x'), L), 'Could not read this file. Install LibreOffice to preview it.');
});

test('T-S5 a docx and a pptx render fetch only the probe and the download; vendor code loads only through officeImport', async () => {
  for (const [rel, fx] of [['r/memo.docx', 'memo.docx'], ['r/deck.pptx', 'deck.pptx']]) {
    const h = fallback(rel, fixture(fx));
    assert.equal((await h.load(rel)).state, 'shown');
    assert.deepEqual(h.calls, [`HEAD ${PDF(rel)}`, `GET ${DL(rel)}`]);
    assert.ok(h.vendor.calls.length >= 1 && h.vendor.calls.every((u) => Object.values(LITE_VENDOR).includes(u)));
    for (const img of h.stage.querySelectorAll('img')) assert.ok(h.vendor.created.includes(img.getAttribute('src')), img.getAttribute('src'));
    if (rel.endsWith('.pptx')) {
      assert.equal(h.stage.querySelector('figure.olp-thumb img').getAttribute('alt'), 'Embedded thumbnail');
      assert.deepEqual([...h.stage.querySelectorAll('.olp-slide-title')].map((t) => t.textContent), ['Slide 1 — Intro', 'Slide 2 — Data', 'Slide 3 — Backup (hidden)']);
    }
  }
});

test('T-S6 a render that goes stale after the fetch, or after the parse, never mounts and revokes its URLs', async () => {
  const h1 = fallback('d.pptx', fixture('deck.pptx'));
  const before1 = h1.stage.innerHTML;
  const out1 = await h1.load('d.pptx', { live: () => !h1.calls.some((c) => c.startsWith('GET')) });
  assert.deepEqual(out1, { state: 'stale' });
  assert.equal(h1.stage.innerHTML, before1);
  assert.equal(h1.vendor.created.length, 0, 'stopped right after the fetch');
  const h2 = fallback('d.pptx', fixture('deck.pptx'));
  const before2 = h2.stage.innerHTML;
  const out2 = await h2.load('d.pptx', { live: () => h2.vendor.created.length === 0 });
  assert.deepEqual(out2, { state: 'stale' });
  assert.equal(h2.stage.innerHTML, before2);
  assert.equal(h2.vendor.created.length, 1, 'the thumbnail URL was made');
  assert.deepEqual(h2.vendor.revoked, h2.vendor.created);
  const h3 = fallback('m.docx', fixture('memo.docx'));
  const out3 = await h3.load('m.docx', { live: () => h3.vendor.created.length === 0 });
  assert.deepEqual(out3, { state: 'stale' });
  assert.ok(h3.vendor.created.length > 0 && covers(h3.vendor.revoked, h3.vendor.created), 'docx-preview\'s image URL too');
});

test('T-S7 a new fallback render revokes the URLs of a disconnected stage, and of its own stage', async () => {
  const h = harness({
    heads: { [PDF('d.pptx')]: 501, [PDF('d.odp')]: 501, [PDF('n.odt')]: 501 },
    bodies: { [DL('d.pptx')]: fixture('deck.pptx'), [DL('d.odp')]: fixture('deck.odp'), [DL('n.odt')]: fixture('notes.odt') },
  });
  const a = h.doc.createElement('div');
  h.doc.body.append(a);
  assert.equal((await h.load('d.pptx', { stage: a })).state, 'shown');
  const first = [...h.vendor.created];
  assert.equal(first.length, 1);
  assert.deepEqual(h.vendor.revoked, []);
  a.remove();
  const b = h.doc.createElement('div');
  h.doc.body.append(b);
  assert.equal((await h.load('n.odt', { stage: b })).state, 'shown');
  assert.deepEqual(h.vendor.revoked, first, 'the disconnected stage\'s thumbnail is revoked');
  assert.equal((await h.load('d.odp', { stage: b })).state, 'shown');
  const second = h.vendor.created[1];
  assert.ok(second && !h.vendor.revoked.includes(second));
  assert.equal((await h.load('n.odt', { stage: b })).state, 'shown');
  assert.ok(h.vendor.revoked.includes(second), 'a render into the same (still connected) stage revokes its previous URLs');
});

test('T-S6b each live() re-check stops the next step: after the module load, the vendor import, the fetch, the zip open and loadMarkdown', async () => {
  /** A docx fallback whose JSZip.loadAsync calls are counted; `flip(step)` ends the render's life at that step. */
  const run = async (step) => {
    const h = fallback('m.docx', fixture('memo.docx'));
    let alive = true;
    const seen = { loads: 0, md: 0 };
    const flip = (s) => { if (s === step) alive = false; };
    const officeImport = async (u) => {
      await h.vendor.importer(u);
      if (u === LITE_VENDOR.jszip && h.win.JSZip && !h.win.JSZip.counted) {
        const Z = h.win.JSZip;
        const orig = Z.loadAsync;
        Z.loadAsync = async (...a) => { seen.loads += 1; const z = await orig.apply(Z, a); flip('zip'); return z; };
        Z.counted = true;
      }
      flip(u === LITE_VENDOR.jszip ? 'import' : 'import-docx');
    };
    const deps = {
      loadOfficeLite: async () => { const m = await loadOfficeLite(); flip('module'); return m; },
      officeImport,
      loadMarkdown: async () => { seen.md += 1; flip('md'); return MD; },
    };
    const fetch = h.fetch;
    const counted = async (url, opts) => { const r = await fetch(url, opts); if ((opts?.method || 'GET') === 'GET') flip('fetch'); return r; };
    const before = h.stage.innerHTML;
    const out = await loadPreview({ artifact: { kind: null, relPath: 'm.docx' }, stage: h.stage, urls: URLS, fetch: counted, deps, live: () => alive });
    assert.deepEqual(out, { state: 'stale' }, step);
    assert.equal(h.stage.innerHTML, before, step);
    return { h, seen };
  };
  const mod = await run('module');
  assert.deepEqual(mod.h.vendor.calls, [], 'no vendor import after the module load went stale');
  const imp = await run('import');
  assert.ok(!imp.h.calls.some((c) => c.startsWith('GET')), 'no download after the import went stale');
  const got = await run('fetch');
  assert.equal(got.seen.loads, 0, 'the archive is not opened after the fetch went stale');
  const zip = await run('zip');
  assert.equal(zip.seen.md, 0, 'markdown is not loaded after the zip open went stale');
  const md = await run('md');
  assert.equal(md.seen.loads, 1, 'docx-preview never parses after loadMarkdown went stale');
  assert.equal(md.h.vendor.created.length, 0);
});
