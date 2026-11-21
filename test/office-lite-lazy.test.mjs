// test/office-lite-lazy.test.mjs — the simplified Office preview stays lazy: no static path reaches its modules (I7), the vendor
// libraries load only when a fallback render needs them (docx-preview only for .docx), once per window, and docx-preview
// always finds JSZip whatever format opened first, leaving no global behind (I10).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';
import { readIndexHtml } from '../src/core/read-index-html.mjs';
import { renderOfficeLite, loadOfficeLibs, LITE_VENDOR } from '../ui/public/artifacts/office-lite.mjs';
import { fixture, respond } from './helpers/office-lite-fixtures.mjs';
import { officeVendor, VENDOR_FILES } from './helpers/office-vendor.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const PUBLIC = path.join(ROOT, 'ui/public');
const walk = (d, out = []) => { for (const e of readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); e.isDirectory() ? walk(p, out) : /\.(mjs|js)$/.test(e.name) && out.push(p); } return out; };
const OFFICE_FAMILY = /office-(?:lite|zip|xml|sheet|slides|text|docx)\.mjs/;
const STATIC_IMPORT_RE = /\b(?:import|export)\b[^;'"()]*?\bfrom\s*['"]([^'"]+)['"]|\bimport\s+['"]([^'"]+)['"]/g;
const MD = { marked: (await import('marked')).marked, createDOMPurify: (await import('dompurify')).default };

test('T-L1 static scan: only the office-* family imports itself; app.js has the one dynamic import; vendor URLs live in office-lite.mjs', () => {
  const files = walk(PUBLIC);
  const family = files.filter((f) => /^office-[a-z]+\.mjs$/.test(path.basename(f)) && path.dirname(f) === path.join(PUBLIC, 'artifacts'));
  assert.equal(family.length, 7, 'the seven office modules exist');
  for (const f of files) {
    if (family.includes(f)) continue;
    const src = readFileSync(f, 'utf8');
    for (const m of src.matchAll(STATIC_IMPORT_RE)) assert.ok(!OFFICE_FAMILY.test(m[1] || m[2]), `${path.relative(ROOT, f)} statically imports ${m[1] || m[2]}`);
    for (const url of Object.values(LITE_VENDOR)) assert.ok(!src.includes(url) || f.endsWith('office-lite.mjs'), `${path.relative(ROOT, f)} names ${url}`);
  }
  for (const f of family.filter((x) => !x.endsWith('office-lite.mjs'))) {
    for (const url of Object.values(LITE_VENDOR)) assert.ok(!readFileSync(f, 'utf8').includes(url), `${path.basename(f)} names ${url}`);
  }
  assert.ok(!readFileSync(path.join(PUBLIC, 'artifacts/stage.mjs'), 'utf8').includes('office-lite.mjs'));
  const app = readFileSync(path.join(PUBLIC, 'app.js'), 'utf8');
  assert.equal(app.split("import('./artifacts/office-lite.mjs')").length - 1, 1);
  assert.ok(!readIndexHtml().includes('office-'), 'the page never loads an office module');
  assert.deepEqual(Object.keys(VENDOR_FILES).sort(), Object.values(LITE_VENDOR).sort(), 'the test vendor maps the same URLs');
});

function win() {
  return new JSDOM('<!doctype html><body><div id="s"></div></body>', { runScripts: 'outside-only', pretendToBeVisual: true, url: 'http://localhost:4317/' }).window;
}
async function render(w, vendor, name, fx) {
  const stage = w.document.getElementById('s');
  return renderOfficeLite({ name, stage, url: `/${name}`, downloadUrl: `/${name}?download=1`, fetch: async () => respond(fixture(fx)),
    deps: { officeImport: vendor.importer, loadMarkdown: async () => MD } });
}

test('T-L2 xlsx, pptx and odt import only JSZip; docx imports JSZip then docx-preview, in that order', async () => {
  for (const [name, fx] of [['q.xlsx', 'budget.xlsx'], ['d.pptx', 'deck.pptx'], ['n.odt', 'notes.odt']]) {
    const w = win();
    const vendor = officeVendor(w);
    assert.equal((await render(w, vendor, name, fx)).state, 'shown', name);
    assert.deepEqual(vendor.calls, [LITE_VENDOR.jszip], name);
  }
  const w = win();
  const vendor = officeVendor(w);
  assert.equal((await render(w, vendor, 'm.docx', 'memo.docx')).state, 'shown');
  assert.deepEqual(vendor.calls, [LITE_VENDOR.jszip, LITE_VENDOR.docx]);
});

test('T-L3 memoised per window, failures retried, and xlsx-then-docx in one window still renders the docx with no globals left', async () => {
  const w = win();
  const vendor = officeVendor(w);
  await render(w, vendor, 'q.xlsx', 'budget.xlsx');
  await render(w, vendor, 'n.odt', 'notes.odt');
  assert.deepEqual(vendor.calls, [LITE_VENDOR.jszip], 'one import per URL');
  assert.equal(w.JSZip, undefined);
  const out = await render(w, vendor, 'm.docx', 'memo.docx');
  assert.equal(out.state, 'shown');
  assert.ok(w.document.querySelector('.olp .docx-wrapper'), 'docx-preview captured JSZip although jszip was not evaluated again');
  assert.deepEqual(vendor.calls, [LITE_VENDOR.jszip, LITE_VENDOR.docx]);
  assert.equal(w.JSZip, undefined);
  assert.equal(w.docx, undefined);
  await render(w, vendor, 'm.docx', 'memo.docx');
  assert.equal(vendor.calls.length, 2, 'docx-preview is memoised too');

  const w2 = win();
  const v2 = officeVendor(w2);
  v2.failNext(LITE_VENDOR.jszip);
  assert.equal((await render(w2, v2, 'q.xlsx', 'budget.xlsx')).state, 'info');
  assert.equal((await render(w2, v2, 'q.xlsx', 'budget.xlsx')).state, 'shown', 'a failed import is not remembered');
  v2.failNext(LITE_VENDOR.docx);
  assert.equal((await render(w2, v2, 'm.docx', 'memo.docx')).state, 'info');
  assert.equal(w2.JSZip, undefined, 'the restored global is deleted on failure too');
  assert.equal((await render(w2, v2, 'm.docx', 'memo.docx')).state, 'shown');
  assert.deepEqual(v2.calls, [LITE_VENDOR.jszip, LITE_VENDOR.jszip, LITE_VENDOR.docx, LITE_VENDOR.docx]);

  const w3 = win();
  const v3 = officeVendor(w3);
  const libs = await loadOfficeLibs(w3, { importer: v3.importer });
  assert.equal(typeof libs.JSZip.loadAsync, 'function');
  assert.equal(libs.docx, undefined);
  await assert.rejects(loadOfficeLibs(win(), { importer: async () => ({}) }), (e) => e.code === 'LOAD_FAILED');
});

test('T-L4 two renders loading in one window share each library load: both get JSZip, and docx beside xlsx still renders the docx', async () => {
  const w = win();
  const vendor = officeVendor(w);
  const both = await Promise.allSettled([loadOfficeLibs(w, { importer: vendor.importer }), loadOfficeLibs(w, { importer: vendor.importer })]);
  assert.deepEqual(both.map((r) => r.status), ['fulfilled', 'fulfilled'], 'the second load waits for the first, never reads a deleted global');
  assert.equal(both[0].value.JSZip, both[1].value.JSZip);
  const docx = await Promise.allSettled([loadOfficeLibs(w, { importer: vendor.importer, docx: true }), loadOfficeLibs(w, { importer: vendor.importer, docx: true })]);
  assert.deepEqual(docx.map((r) => r.status), ['fulfilled', 'fulfilled']);
  assert.equal(docx[0].value.docx, docx[1].value.docx);
  assert.deepEqual(vendor.calls, [LITE_VENDOR.jszip, LITE_VENDOR.docx], 'one import per URL');
  assert.equal(w.JSZip, undefined);
  assert.equal(w.docx, undefined);

  const w2 = win();
  const v2 = officeVendor(w2);
  const outs = await Promise.all([render(w2, v2, 'm.docx', 'memo.docx'), render(w2, v2, 'q.xlsx', 'budget.xlsx')]);
  assert.equal(outs[1].state, 'shown', 'the xlsx is not told to install LibreOffice');
  const w2b = w2.document.createElement('div');
  w2.document.body.append(w2b);
  const later = await renderOfficeLite({ name: 'm.docx', stage: w2b, url: '/m.docx', downloadUrl: '/m.docx?download=1', fetch: async () => respond(fixture('memo.docx')),
    deps: { officeImport: v2.importer, loadMarkdown: async () => MD } });
  assert.equal(later.state, 'shown', 'docx-preview was evaluated with JSZip on the window');
  assert.ok(w2b.querySelector('.docx-wrapper'));
  assert.equal(w2.JSZip, undefined);

  const w3 = win();
  const v3 = officeVendor(w3);
  v3.failNext(LITE_VENDOR.jszip);
  await assert.rejects(loadOfficeLibs(w3, { importer: v3.importer }), (e) => e.code === 'LOAD_FAILED');
  assert.equal(typeof (await loadOfficeLibs(w3, { importer: v3.importer })).JSZip.loadAsync, 'function', 'a rejected load is not memoised');
});
