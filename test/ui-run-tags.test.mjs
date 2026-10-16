// test/ui-run-tags.test.mjs — run tags in the web UI (#718), behind the experimental `runTags` flag:
// the New run form (project defaults, payload, reset after a start, an Ask handoff), the live run page's
// chips, the finished run page's chips and editor, and nothing at all while the flag is off.
// The New run boot is test/ui-engine-default-prefill.test.mjs's; the run pages use the shared helpers.
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { JSDOM } from 'jsdom';
import { useDomRelease } from './helpers/jsdom-release.mjs';
import { bootApp, helloRun } from './helpers/run-page-boot.mjs';
import { bootDetail, openDetail, deliverRows, settle, click, ok as okRes, fail, ROW, DETAIL } from './helpers/history-detail-boot.mjs';
import { applyFlags } from '../ui/public/flags.mjs';
import { renderIndexHtml } from '../src/core/index-html.mjs';

const trackDom = useDomRelease(afterEach);
const htmlPath = fileURLToPath(new URL('../ui/public/index.html', import.meta.url));
const appPath = fileURLToPath(new URL('../ui/public/app.js', import.meta.url));
const PROJECTS = [{ name: 'web', path: '/a/web', exists: true }, { name: 'api', path: '/a/api', exists: true }];
const ok = (body, status = 200) => ({ ok: status < 400, status, json: async () => body });
const tick = () => new Promise((r) => setTimeout(r, 0));
const flagsOn = (window) => applyFlags({ runTags: true }, window.document);

async function bootForm({ tagsFor = () => [], dims = null, runResponse = null } = {}) {
  const dom = trackDom(new JSDOM(readFileSync(htmlPath, 'utf8'), { url: 'http://localhost:4317/' }));
  const { window } = dom;
  window.Element.prototype.scrollIntoView = function () {};
  let lastWs = null;
  window.WebSocket = class {
    constructor() { this.readyState = 1; this._l = {}; lastWs = this; }
    send() {} close() {}
    addEventListener(t, fn) { (this._l[t] ||= []).push(fn); }
  };
  const posted = [];
  const puts = [];
  window.fetch = (url, opts = {}) => {
    const u = String(url);
    const method = opts.method || 'GET';
    if (u.includes('/tags/defaults') && method === 'PUT') { puts.push(JSON.parse(opts.body)); return Promise.resolve(ok(JSON.parse(opts.body))); }
    if (u.includes('/api/run-defaults')) {
      const dir = new URL(u, 'http://x').searchParams.get('projectDir') || '';
      return Promise.resolve(ok({ engine: { value: 'claude', source: 'default' }, steps: { claude: {}, codex: {} },
        projectKey: dir ? `${dir.split('/').pop()}-00000001` : null, tags: tagsFor(dir) }));
    }
    if (dims && u.includes('/api/tag-dimensions')) return Promise.resolve(ok(dims(new URL(u, 'http://x').searchParams)));
    if (u.includes('/api/tags')) return Promise.resolve(ok({ keys: [], values: {} }));
    if (u.includes('/api/projects')) return Promise.resolve(ok({ projects: PROJECTS }));
    if (u.includes('/api/workspaces')) return Promise.resolve(ok({ workspaces: [] }));
    if (u.includes('/api/branches')) return Promise.resolve(ok({ branches: ['dev'], current: 'dev' }));
    if (u.endsWith('/api/run') && method === 'POST') {
      posted.push(JSON.parse(opts.body));
      if (runResponse) { const { status, body } = runResponse(posted.length); return Promise.resolve(ok(body, status)); }
      return Promise.resolve(ok({ runId: `r${posted.length}` }));
    }
    return Promise.resolve(ok({ config: { steps: {}, customModels: [] }, models: [], efforts: [] }));
  };
  for (const k of ['window', 'document', 'location', 'localStorage', 'WebSocket', 'fetch', 'navigator']) {
    try { Object.defineProperty(globalThis, k, { value: window[k], configurable: true, writable: true }); } catch { /* read-only */ }
  }
  globalThis.window = window; globalThis.document = window.document;
  window.localStorage.clear();
  window.localStorage.setItem('worca-cc.runTarget', 'project');
  window.localStorage.setItem('worca-cc.lastProject', 'web');
  await import(pathToFileURL(appPath).href + `?b=${Date.now()}_${Math.random()}`);
  await tick();
  lastWs._l.open?.forEach((fn) => fn());
  for (let i = 0; i < 8; i++) await tick();
  return { window, doc: window.document, posted, puts };
}
const formChips = (doc) => [...doc.querySelectorAll('#runTagsField .tag-chip')].map((c) => c.firstChild.textContent);
async function submit(ctx) {
  ctx.doc.querySelector('#prompt').value = 'do work';
  const n = ctx.posted.length;
  ctx.doc.querySelector('#run-form').dispatchEvent(new ctx.window.Event('submit', { bubbles: true, cancelable: true }));
  for (let i = 0; i < 40 && ctx.posted.length === n; i++) await tick();
  for (let i = 0; i < 6; i++) await tick();
  return ctx.posted.at(-1);
}

test('New run: the project\'s defaults prefill the field, ride the body, and come back after a start', async () => {
  const ctx = await bootForm({ tagsFor: (dir) => (dir === '/a/web' ? ['client:acme'] : []) });
  flagsOn(ctx.window);
  assert.deepEqual(formChips(ctx.doc), ['client:acme']);
  assert.equal(ctx.doc.getElementById('runTagsSaveDefault').hidden, false);
  const input = ctx.doc.querySelector('#runTagsField .tag-input-text');
  input.value = 'Team: Web';
  input.dispatchEvent(new ctx.window.KeyboardEvent('keydown', { key: 'Enter', cancelable: true }));
  input.value = 'client:';
  input.dispatchEvent(new ctx.window.KeyboardEvent('keydown', { key: 'Enter', cancelable: true }));
  assert.deepEqual((await submit(ctx)).tags, ['client:acme', 'team:web']);
  assert.deepEqual(formChips(ctx.doc), ['client:acme'], 'the next run starts from the defaults again');
  assert.equal(input.value, '', 'no leftover uncommitted text');
  assert.equal(input.hasAttribute('aria-invalid'), false);
  ctx.doc.querySelector('#runTagsField .tag-x').click();
  assert.equal(Object.hasOwn(await submit(ctx), 'tags'), false, 'no chip: no tags key');
});

test('New run: an Ask handoff\'s tags survive the project defaults that load after it', async () => {
  const ctx = await bootForm({ tagsFor: (dir) => (dir === '/a/api' ? ['team:web'] : []) });
  flagsOn(ctx.window);
  ctx.window.__np.openNewPipeline({ target: 'project', projectDir: '/a/api', workflowId: 'wf_default', guardrailsId: 'normal',
    prompt: 'x', title: 'X', featureBranch: '', tags: ['client:acme'] });
  ctx.window.dispatchEvent(new ctx.window.Event('hashchange'));
  for (let i = 0; i < 12; i++) await tick();
  assert.deepEqual(formChips(ctx.doc), ['client:acme']);
});

test('New run with the flag off: no tags key in the body; the CSS gate hides every tag control', async () => {
  const ctx = await bootForm({ tagsFor: () => ['client:acme'] });
  assert.equal(Object.hasOwn(await submit(ctx), 'tags'), false);
  const html = renderIndexHtml(readFileSync(htmlPath, 'utf8'), 'system', 'expert', { runTags: false });
  const gates = /<style id="flag-gates">([^<]*)<\/style>/.exec(html);
  assert.ok(gates && gates[1].includes('[data-flag~="runTags"]'), gates ? gates[1] : html.slice(0, 400));
});

test('live run page: one set of tag chips after repeated header paints, none with the flag off', async () => {
  const ctx = await bootApp();
  flagsOn(ctx.window);
  helloRun(ctx, { runId: 'run-t1', pipelineId: 'aaaa0001', tags: ['client:acme'] });
  ctx.go('running/run-t1');
  await ctx.settle();
  helloRun(ctx, { runId: 'run-t1', pipelineId: 'aaaa0001', tags: ['client:acme'] });
  await ctx.settle();
  const doc = ctx.window.document;
  assert.deepEqual([...doc.querySelectorAll('#run-detail .rd-page-meta .tag-chip')].map((c) => c.textContent), ['client:acme']);
  applyFlags({ runTags: false }, doc);
  helloRun(ctx, { runId: 'run-t1', pipelineId: 'aaaa0001', tags: ['client:acme'] });
  await ctx.settle();
  assert.equal(doc.querySelectorAll('#run-detail .rd-page-meta .tag-chip').length, 0);
});

test('finished run page: chips + Edit tags, an editor that survives a repaint, a PUT, and the server\'s list after Save', async () => {
  const puts = [];
  let answer = () => okRes({ tags: ['client:globex'], changed: true });
  const detail = { ...DETAIL, state: { ...DETAIL.state, tags: ['client:acme'] } };
  const ctx = await bootDetail({ detail, arms: (url, opts) => {
    if (url.endsWith(`/api/runs/${ROW.id}/tags`) && opts.method === 'PUT') { puts.push(JSON.parse(opts.body)); return answer(); }
    if (url.endsWith('/api/tags')) return okRes({ keys: [], values: {} });
    return null;
  } });
  flagsOn(ctx.window);
  await openDetail(ctx, null);
  await deliverRows(ctx, [ROW]);
  const doc = ctx.window.document;
  // The landing page's head (the glance) carries the chips and the editor; Details › Overview too.
  const row2 = () => doc.querySelector('#hist-detail .hd-glance .rd-page-meta');
  assert.equal(row2().querySelectorAll('.hd-tags').length, 1, 'two header paints, one tag box');
  assert.deepEqual([...row2().querySelectorAll('.hd-tags .tag-chip')].map((c) => c.textContent), ['client:acme']);
  assert.deepEqual([...doc.querySelectorAll('#hist-detail .hd-row2 .hd-tags .tag-chip')].map((c) => c.textContent), ['client:acme']);
  const edit = row2().querySelector('.hd-tags-edit');
  assert.equal(edit.textContent, 'Edit tags');
  click(ctx.window, edit);
  const input = () => row2().querySelector('.hd-tags .tag-input-text');
  input().value = 'client:globex';
  input().dispatchEvent(new ctx.window.KeyboardEvent('keydown', { key: 'Enter', cancelable: true }));
  await deliverRows(ctx, [ROW]);
  assert.equal(row2().querySelectorAll('.hd-tags').length, 1);
  assert.deepEqual([...row2().querySelectorAll('.hd-tags .tag-input .tag-chip')].map((c) => c.firstChild.textContent), ['client:globex'], 'the open editor kept its chip');
  answer = () => fail(400, { error: 'tags: "x:" needs a value after the colon' });
  click(ctx.window, row2().querySelector('.hd-tags-save'));
  await settle(ctx.window, 4);
  assert.equal(row2().querySelector('.hd-tags .tag-input-hint').textContent, 'tags: "x:" needs a value after the colon');
  answer = () => okRes({ tags: ['client:globex'], changed: true });
  click(ctx.window, row2().querySelector('.hd-tags-save'));
  await settle(ctx.window, 4);
  assert.deepEqual(puts.at(-1), { tags: ['client:globex'] });
  assert.equal(row2().querySelector('.hd-tags .tag-input'), null, 'back to chips');
  assert.deepEqual([...row2().querySelectorAll('.hd-tags .tag-chip')].map((c) => c.textContent), ['client:globex']);
  assert.deepEqual([...doc.querySelectorAll('#hist-detail .hd-row2 .hd-tags .tag-chip')].map((c) => c.textContent), ['client:globex']);
});

test('finished run page: "Add tags" when the run has none; no tag UI with the flag off', async () => {
  const ctx = await bootDetail({ detail: { ...DETAIL, state: { ...DETAIL.state, tags: [] } } });
  await openDetail(ctx, null);
  const doc = ctx.window.document;
  assert.equal(doc.querySelector('#hist-detail .hd-tags'), null, 'flag off: nothing');
  flagsOn(ctx.window);
  await deliverRows(ctx, [ROW]);
  for (const host of ['.hd-glance .rd-page-meta', '.hd-row2']) {
    assert.equal(doc.querySelector(`#hist-detail ${host} .hd-tags-edit`).textContent, 'Add tags', host);
    assert.equal(doc.querySelectorAll(`#hist-detail ${host} .tag-chip`).length, 0, host);
  }
});

test('No dimensions configured: no slot UI beyond the free-form field', async () => {
  const ctx = await bootForm({ dims: () => ({ source: null, home: null, dims: [] }) });
  flagsOn(ctx.window);
  assert.equal(ctx.doc.getElementById('runTagDimsField').hidden, true);
  assert.equal(ctx.doc.querySelectorAll('.tag-dim-slot').length, 0);
  assert.doesNotMatch(ctx.doc.querySelector('#run-form').textContent, /Cost centre/);
});

test('the Tags label says "(optional)" only while no configured tag is mandatory', async () => {
  const opt = (ctx) => ctx.doc.querySelector('.run-tags-field .opt');
  const none = await bootForm({ dims: () => ({ source: null, home: null, dims: [] }) });
  flagsOn(none.window);
  assert.equal(opt(none).hidden, false, 'no dimensions: tags are optional');
  const optionalDim = await bootForm({ dims: () => ({ source: 'settings', home: null, dims: [{ key: 'team', label: 'Team', values: [], required: false }] }) });
  flagsOn(optionalDim.window);
  assert.equal(opt(optionalDim).hidden, false, 'only optional dimensions: still optional');
  const mandatory = await bootForm({ dims: () => ({ source: 'settings', home: null, dims: [{ key: 'cc', label: 'Cost centre', values: ['4410'], required: true }] }) });
  flagsOn(mandatory.window);
  assert.equal(opt(mandatory).hidden, true, 'a mandatory tag: the field is not optional');
});

test('enforcement off: start without a mandatory tag succeeds and warns (today)', async () => {
  const ctx = await bootForm({ dims: () => ({ source: 'policy', home: 'acme/web', dims: [{ key: 'cc', label: 'Cost centre', values: ['4410'], required: true }] }) });
  flagsOn(ctx.window);
  const slots = [...ctx.doc.querySelectorAll('#runTagDimsField .tag-dim-slot')];
  assert.deepEqual(slots.map((s) => s.querySelector('.tag-dim-label').textContent), ['Cost centre']);
  const body = await submit(ctx);
  assert.equal(body.tags, undefined, 'the run is posted with no tags — never blocked');
  const toast = [...ctx.doc.querySelectorAll('.toast')].at(-1);
  assert.match(toast.textContent, /Missing required tag: Cost centre/);
  assert.match(toast.className, /warn/);
});

test('enforced: a pre-filled mandatory tag shows as a chosen value; Start is enabled and posts it', async () => {
  const ctx = await bootForm({ dims: () => ({ source: 'settings', home: null, enforce: true, prefill: ['cc:4410'],
    dims: [{ key: 'cc', label: 'Cost centre', values: ['4410', '4420'], required: true }] }) });
  flagsOn(ctx.window);
  const sel = ctx.doc.querySelector('.tag-dim-slot[data-key="cc"] select');
  assert.equal(sel.value, '4410');
  assert.equal(ctx.doc.getElementById('start-btn').disabled, false);
  const body = await submit(ctx);
  assert.deepEqual(body.tags, ['cc:4410']);
});

test('enforced: nothing to pre-fill → Start disabled with "Add Cost centre to start" under the field; picking enables it', async () => {
  const ctx = await bootForm({ dims: () => ({ source: 'settings', home: null, enforce: true, prefill: [],
    dims: [{ key: 'cc', label: 'Cost centre', values: ['4410'], required: true }] }) });
  flagsOn(ctx.window);
  const start = ctx.doc.getElementById('start-btn');
  const warn = ctx.doc.getElementById('runTagDimsWarn');
  assert.equal(start.disabled, true);
  assert.equal(start.title, 'Add Cost centre to start');
  assert.equal(warn.textContent, 'Add Cost centre to start');
  assert.equal(warn.hidden, false);
  const sel = ctx.doc.querySelector('.tag-dim-slot[data-key="cc"] select');
  sel.value = '4410'; sel.dispatchEvent(new ctx.window.Event('change', { bubbles: true }));
  assert.equal(start.disabled, false);
  assert.equal(start.title, '');
  assert.equal(warn.hidden, true);
});

test('a 422 with fields.tags shows the reason under the tag field, not a card alert', async () => {
  const reason = 'Cost centre "9999" is not one of its values (4410)';
  const ctx = await bootForm({ dims: () => ({ source: 'settings', home: null, enforce: false, prefill: [], dims: [] }),
    runResponse: () => ({ status: 422, body: { error: reason, fields: { tags: reason } } }) });
  flagsOn(ctx.window);
  await submit(ctx);
  const warn = ctx.doc.getElementById('runTagDimsWarn');
  assert.equal(warn.textContent, reason);
  assert.equal(warn.hidden, false);
  assert.equal([...ctx.doc.querySelectorAll('.card-alert')].some((n) => n.textContent.includes(reason)), false, 'no card alert carries it');
  assert.equal(ctx.doc.getElementById('start-btn').disabled, false, 'the button is usable again');
});

test('runTags off: no slots shown, Start enabled, no tags posted (unchanged)', async () => {
  const ctx = await bootForm({ dims: () => ({ source: 'settings', home: null, enforce: false, prefill: ['cc:4410'],
    dims: [{ key: 'cc', label: 'Cost centre', values: ['4410'], required: true }] }) });
  assert.equal(ctx.doc.getElementById('start-btn').disabled, false);
  const body = await submit(ctx);
  assert.equal(body.tags, undefined);
});

test('A filled slot rides the body with the free-form tags; a default cc:4410 lands in the slot', async () => {
  const ctx = await bootForm({ tagsFor: (dir) => (dir === '/a/web' ? ['cc:4410', 'client:acme'] : []), dims: () => ({ source: 'settings', home: null, dims: [{ key: 'cc', label: 'Cost centre', values: [], required: true }] }) });
  flagsOn(ctx.window);
  const input = ctx.doc.querySelector('#runTagDimsField .tag-dim-input');
  assert.equal(input.value, '4410', 'the project default lands in its slot');
  assert.deepEqual(formChips(ctx.doc), ['client:acme'], 'not in the free-form field too');
  input.value = '4420'; input.dispatchEvent(new ctx.window.Event('input'));
  assert.deepEqual((await submit(ctx)).tags, ['cc:4420', 'client:acme']);
});

test('Save as project default keeps the value typed in a dimension slot', async () => {
  const ctx = await bootForm({ tagsFor: (dir) => (dir === '/a/web' ? ['client:acme'] : []), dims: () => ({ source: 'settings', home: null, dims: [{ key: 'cc', label: 'Cost centre', values: [], required: true }] }) });
  flagsOn(ctx.window);
  const input = ctx.doc.querySelector('#runTagDimsField .tag-dim-input');
  input.value = '4420'; input.dispatchEvent(new ctx.window.Event('input'));
  ctx.doc.getElementById('runTagsSaveDefault').click();
  for (let i = 0; i < 6; i++) await tick();
  assert.deepEqual(ctx.puts.at(-1)?.tags?.slice().sort(), ['cc:4420', 'client:acme']);
  await submit(ctx);
  assert.equal(ctx.doc.querySelector('#runTagDimsField .tag-dim-input').value, '4420', 'the saved default comes back in its slot');
  assert.deepEqual(formChips(ctx.doc), ['client:acme']);
});

test('A workspace run with no workspace picked shows no slots, even when a project configures dimensions', async () => {
  const ctx = await bootForm({ dims: (q) => (q.get('projectDir') ? { source: 'policy', home: 'acme/web', dims: [{ key: 'cc', label: 'Cost centre', values: [], required: true }] } : { dims: [{ key: 'cc', label: 'Cost centre', values: [], required: true }] }) });
  flagsOn(ctx.window);
  assert.equal(ctx.doc.querySelectorAll('.tag-dim-slot').length, 1, 'the project target has its slot');
  ctx.doc.querySelector('#target-seg button[data-target="workspace"]').click();
  for (let i = 0; i < 8; i++) await tick();
  assert.equal(ctx.doc.querySelectorAll('.tag-dim-slot').length, 0);
});
