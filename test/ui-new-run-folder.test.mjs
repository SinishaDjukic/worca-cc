// test/ui-new-run-folder.test.mjs — Projects, any way (P1b): New run for a Folder project.
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { JSDOM } from 'jsdom';
import { useDomRelease } from './helpers/jsdom-release.mjs';
import { fieldErrorText, cardAlertOf } from './helpers/feedback.mjs';

const trackDom = useDomRelease(afterEach);
const htmlPath = fileURLToPath(new URL('../ui/public/index.html', import.meta.url));
const appPath = fileURLToPath(new URL('../ui/public/app.js', import.meta.url));
const PROJECTS = [
  { name: 'proj', path: '/a/proj', exists: true, vcs: 'git', workMode: 'git', key: 'proj-00000001' },
  { name: 'Tax papers 2026', path: '/a/tax', exists: true, vcs: 'none', workMode: 'folder', key: 'tax-papers-1a2b3c4d' },
];
// P1a Task 3 FolderTooBig, answered 413 by POST /api/run (Task 10).
const TOO_BIG = { error: 'Tax papers 2026 is 6.5 GB. The limit is 1 GB.', code: 'FOLDER_TOO_BIG', files: 812, bytes: 6549825126,
  limit: { files: 50000, bytes: 1000000000 }, limitBytes: 1000000000, over: 'bytes' };   // Task 3's default limits and sizeLabel

async function boot({ runReply = null, hash = '' } = {}) {
  const dom = trackDom(new JSDOM(readFileSync(htmlPath, 'utf8'), { url: `http://localhost:4317/${hash ? `#${hash}` : ''}` }));
  const { window } = dom;
  window.Element.prototype.scrollIntoView = function () {};
  const box = { ws: null };
  window.WebSocket = class { constructor() { this.readyState = 1; this._l = {}; box.ws = this; } send() {} close() {} addEventListener(t, fn) { (this._l[t] ||= []).push(fn); } };
  const calls = []; const posted = [];
  window.fetch = (url, opts = {}) => {
    const u = String(url); calls.push(u);
    if (u.includes('/api/projects')) return Promise.resolve({ ok: true, status: 200, json: async () => ({ projects: PROJECTS }) });
    if (u.includes('/api/branches')) return Promise.resolve({ ok: true, status: 200, json: async () => ({ branches: ['main'], current: 'main' }) });
    if (u.endsWith('/api/run') && opts.method === 'POST') {
      posted.push(JSON.parse(opts.body));
      return runReply ? runReply() : Promise.resolve({ ok: true, status: 200, json: async () => ({ runId: 'run-1' }) });
    }
    return Promise.resolve({ ok: true, status: 200, json: async () => ({ config: { steps: {}, customModels: [] }, models: [], efforts: [] }) });
  };
  for (const k of ['window', 'document', 'location', 'localStorage', 'WebSocket', 'fetch', 'navigator']) {
    try { Object.defineProperty(globalThis, k, { value: window[k], configurable: true, writable: true }); } catch { /* read-only */ }
  }
  globalThis.window = window; globalThis.document = window.document;
  await import(pathToFileURL(appPath).href + `?b=${Date.now()}_${Math.random()}`);
  await new Promise((r) => setTimeout(r, 0));
  const recv = (m) => (box.ws._l.message || []).forEach((fn) => fn({ data: JSON.stringify(m) }));
  (box.ws._l.open || []).forEach((fn) => fn());
  return { window, doc: window.document, calls, posted, recv };
}
const tick = (n = 3) => new Promise((r) => { let i = 0; const go = () => (++i >= n ? r() : setTimeout(go, 0)); setTimeout(go, 0); });
const pick = (ctx, path) => { const s = ctx.doc.querySelector('#projectSelect'); s.value = path; s.dispatchEvent(new ctx.window.Event('change', { bubbles: true })); };
const submit = (ctx) => ctx.doc.querySelector('#run-form').dispatchEvent(new ctx.window.Event('submit', { bubbles: true, cancelable: true }));

test('a Folder project: no Branches block, no branch read, no branch fields on the wire; a Git project gets them back', async () => {
  const ctx = await boot();
  pick(ctx, '/a/tax');
  await tick();
  assert.equal(ctx.doc.querySelector('#run-form').dataset.workMode, 'folder');
  assert.ok(!ctx.calls.some((u) => u.startsWith('/api/branches') && u.includes(encodeURIComponent('/a/tax'))));
  ctx.doc.querySelector('#featureBranch').value = 'feat/receipts';
  { const sb = ctx.doc.querySelector('#sourceBranch'); sb.append(new ctx.window.Option('main', 'main', true, true)); sb.value = 'main'; }   // a stale pick from a Git project (v4: without it the sourceBranch assertion below could not fail)
  ctx.doc.querySelector('#sameAsSource').checked = true;
  ctx.doc.querySelector('#prompt').value = 'Rename receipts by date and vendor';
  submit(ctx);
  await tick(6);
  assert.equal(ctx.posted.length, 1);
  assert.equal(ctx.posted[0].projectDir, '/a/tax');
  for (const k of ['sourceBranch', 'featureBranch', 'sameAsSource', 'syncBeforeStart']) assert.equal(k in ctx.posted[0], false, k);
  pick(ctx, '/a/proj');
  await tick();
  assert.equal('workMode' in ctx.doc.querySelector('#run-form').dataset, false);
  assert.ok(ctx.calls.some((u) => u.startsWith('/api/branches') && u.includes(encodeURIComponent('/a/proj'))));
});

test('git goes away: a Git project runs as a Folder one until it is back (U3), without a reload', async () => {
  const ctx = await boot();
  pick(ctx, '/a/proj');
  await tick();
  ctx.recv({ type: 'git', git: { available: false, version: null } });
  await tick();
  assert.equal(ctx.doc.querySelector('#run-form').dataset.workMode, 'folder');
  ctx.recv({ type: 'git', git: { available: true, version: '2.47.0' } });
  await tick();
  assert.equal('workMode' in ctx.doc.querySelector('#run-form').dataset, false);
});

test('a folder too big to copy: the server\'s reason under Project, inside the form, no card alert', async () => {
  const ctx = await boot({ runReply: () => Promise.resolve({ ok: false, status: 413, json: async () => TOO_BIG }) });
  pick(ctx, '/a/tax');
  ctx.doc.querySelector('#prompt').value = 'Rename receipts by date and vendor';
  submit(ctx);
  await tick(8);
  const sel = ctx.doc.querySelector('#projectSelect');
  assert.equal(fieldErrorText(sel), TOO_BIG.error);
  assert.equal(sel.getAttribute('aria-invalid'), 'true');
  assert.equal(cardAlertOf(ctx.doc.querySelector('#run-form')), null);
});

test('the Workspace target never wears the Folder mode; back on Project it does again', async () => {
  const ctx = await boot();
  pick(ctx, '/a/tax');
  await tick();
  ctx.doc.querySelector('button[data-target="workspace"]').click();   // the New run Target segment (index.html HEAD ≈286)
  await tick();
  assert.equal('workMode' in ctx.doc.querySelector('#run-form').dataset, false);
  ctx.doc.querySelector('button[data-target="project"]').click();
  await tick();
  assert.equal(ctx.doc.querySelector('#run-form').dataset.workMode, 'folder');
});

test('a Folder project reads no branches when git comes back (the onGitFlip handler goes through refreshBranches)', async () => {
  const ctx = await boot({ hash: 'new' });   // P0's flip handler re-reads branches only on New run (currentView() === 'new'); a boot at / lands on Chat
  pick(ctx, '/a/tax');
  await tick();
  ctx.recv({ type: 'git', git: { available: false, version: null } });
  await tick();
  ctx.recv({ type: 'git', git: { available: true, version: '2.47.0' } });
  await tick();
  assert.ok(!ctx.calls.some((u) => u.startsWith('/api/branches') && u.includes(encodeURIComponent('/a/tax'))));
});

test("worca's own folder is refused under Project too", async () => {
  const OWN = { error: "This folder is worca's own data folder.", code: 'FOLDER_IS_WORCA_HOME' };
  const ctx = await boot({ runReply: () => Promise.resolve({ ok: false, status: 413, json: async () => OWN }) });
  pick(ctx, '/a/tax');
  ctx.doc.querySelector('#prompt').value = 'Rename receipts by date and vendor';
  submit(ctx);
  await tick(8);
  assert.equal(fieldErrorText(ctx.doc.querySelector('#projectSelect')), OWN.error);
  assert.equal(cardAlertOf(ctx.doc.querySelector('#run-form')), null);
});

test('New run CSS: a Folder target hides the Branches block and every git-only control in the form', () => {
  const css = readFileSync(new URL('../ui/public/style.css', import.meta.url), 'utf8');
  assert.match(css, /#run-form:is\(\[data-work-mode="folder"\],\[data-work-mode="none"\]\) :is\(#branch-fields,\[data-needs-git\]\)\{display:none!important;\}/);
});
