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
const flagsOn = (window) => applyFlags({ runTags: true, runLabels: true }, window.document);

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

test('live run page: one set of cost tag chips (in the facts row) after repeated paints, none with the flag off', async () => {
  const ctx = await bootApp();
  flagsOn(ctx.window);
  helloRun(ctx, { runId: 'run-t1', pipelineId: 'aaaa0001', tags: ['client:acme'] });
  ctx.go('running/run-t1');
  await ctx.settle();
  helloRun(ctx, { runId: 'run-t1', pipelineId: 'aaaa0001', tags: ['client:acme'] });
  await ctx.settle();
  const doc = ctx.window.document;
  assert.deepEqual([...doc.querySelectorAll('#run-detail .rd-kv [data-fact="tags"] .tag-chip')].map((c) => c.textContent), ['client:acme']);
  assert.equal(doc.querySelectorAll('#run-detail .rd-page-meta .tag-chip, #run-detail .rd-facts .tag-chip').length, 0);
  applyFlags({ runTags: false }, doc);
  helloRun(ctx, { runId: 'run-t1', pipelineId: 'aaaa0001', tags: ['client:acme'] });
  await ctx.settle();
  assert.equal(doc.querySelectorAll('#run-detail .rd-kv .tag-chip, #run-detail .rd-facts .tag-chip').length, 0);
  assert.equal(doc.querySelector('#run-detail .rd-kv [data-fact="tags"]').hidden, true, 'the empty row hides');
});

test('finished run page: chips in the Cost tags row + Edit cost tags, an editor that survives a repaint, a PUT, and the server\'s list after Save', async () => {
  const puts = [];
  let answer = () => okRes({ tags: ['client:globex'], changed: true });
  // The dimensions answer is held back: when it lands, costTagsFact's callback repaints the glance alone (below).
  let releaseDims;
  const dimsHeld = new Promise((r) => { releaseDims = r; });
  const detail = { ...DETAIL, state: { ...DETAIL.state, tags: ['client:acme'] } };
  const ctx = await bootDetail({ detail, arms: (url, opts) => {
    if (url.startsWith('/api/tag-dimensions')) return dimsHeld.then(() => ({ ok: true, status: 200, json: async () => ({ dims: [] }) }));
    if (url.endsWith(`/api/runs/${ROW.id}/tags`) && opts.method === 'PUT') { puts.push(JSON.parse(opts.body)); return answer(); }
    if (url.endsWith('/api/tags')) return okRes({ keys: [], values: {} });
    return null;
  } });
  flagsOn(ctx.window);
  await openDetail(ctx, null);
  await deliverRows(ctx, [ROW]);
  const doc = ctx.window.document;
  // The landing page's Cost tags row carries the chips and, last, the editor; Details › Overview has both (D15, D16).
  // Run 3 (D8): the Cost tags row is the facts block's last row.
  const row2 = () => doc.querySelector('#hist-detail .rd-kv [data-fact="tags"] > .rd-kv-v > .rd-cost-row');
  const facts = () => [...doc.querySelectorAll('#hist-detail .rd-kv [data-fact="tags"] .tag-chip')].map((c) => c.textContent);
  assert.equal(row2().querySelectorAll('.hd-tags').length, 1, 'two header paints, one tag box');
  assert.equal(row2().querySelectorAll('.hd-tags .tag-chip').length, 0, 'no duplicate chips beside the button');
  assert.deepEqual(facts(), ['client:acme']);
  assert.deepEqual([...doc.querySelectorAll('#hist-detail .hd-row2 .hd-tags .tag-chip')].map((c) => c.textContent), ['client:acme']);
  const edit = row2().querySelector('.hd-tags-edit');
  assert.equal(edit.textContent, 'Edit');
  assert.equal(edit.getAttribute('aria-label'), 'Edit cost tags');
  click(ctx.window, edit);
  const input = () => row2().querySelector('.hd-tags .tag-input-text');
  input().value = 'client:globex';
  input().dispatchEvent(new ctx.window.KeyboardEvent('keydown', { key: 'Enter', cancelable: true }));
  await deliverRows(ctx, [ROW]);
  assert.equal(row2().querySelectorAll('.hd-tags').length, 1);
  assert.deepEqual([...row2().querySelectorAll('.hd-tags .tag-input .tag-chip')].map((c) => c.firstChild.textContent), ['client:globex'], 'the open editor kept its chip');
  // One more glance repaint with the editor open (the dimensions answer lands): the same input stays and keeps focus.
  const typing = input();
  typing.focus();
  releaseDims();
  await settle(ctx.window, 4);
  assert.equal(input(), typing, 'the same input element');
  assert.ok(typing.isConnected);
  assert.equal(doc.activeElement, typing, 'focus survives the repaint');
  // A history broadcast repaints the header (paintHdHeaderMeta → paintHdTags): the held editor is not moved, so focus stays.
  await deliverRows(ctx, [ROW]);
  assert.equal(input(), typing);
  assert.equal(doc.activeElement, typing, 'focus survives a header repaint');
  answer = () => fail(400, { error: 'tags: "x:" needs a value after the colon' });
  click(ctx.window, row2().querySelector('.hd-tags-save'));
  await settle(ctx.window, 4);
  assert.equal(row2().querySelector('.hd-tags .tag-input-hint').textContent, 'tags: "x:" needs a value after the colon');
  answer = () => okRes({ tags: ['client:globex'], changed: true });
  click(ctx.window, row2().querySelector('.hd-tags-save'));
  await settle(ctx.window, 4);
  assert.deepEqual(puts.at(-1), { tags: ['client:globex'] });
  assert.equal(row2().querySelector('.hd-tags .tag-input'), null, 'back to the button');
  assert.deepEqual(facts(), ['client:globex'], 'the facts tile repaints after a Save');
  assert.deepEqual([...doc.querySelectorAll('#hist-detail .hd-row2 .hd-tags .tag-chip')].map((c) => c.textContent), ['client:globex']);
});

test('finished run page: "Add cost tags" when the run has none; no tag UI with the flag off', async () => {
  const ctx = await bootDetail({ detail: { ...DETAIL, state: { ...DETAIL.state, tags: [] } } });
  await openDetail(ctx, null);
  const doc = ctx.window.document;
  assert.equal(doc.querySelector('#hist-detail .hd-tags'), null, 'flag off: nothing');
  assert.equal(doc.querySelector('#hist-detail .rd-cost-row'), null, 'flag off: no Cost tags row');
  flagsOn(ctx.window);
  await deliverRows(ctx, [ROW]);
  // D16: with no tags the row still shows, so "Add cost tags" stays reachable.
  const row = doc.querySelector('#hist-detail .rd-kv [data-fact="tags"] > .rd-kv-v > .rd-cost-row');
  assert.equal(row.closest('.rd-kv-row').querySelector('.rd-kv-k').textContent, 'Cost tags');
  assert.equal(row.querySelector('.rd-cost-row-label'), null, 'the dt names the row');
  assert.equal(row.lastElementChild.querySelector('.hd-tags-edit').textContent, 'Add');
  for (const [host, word] of [['.rd-kv [data-fact="tags"] > .rd-kv-v > .rd-cost-row', 'Add'], ['.hd-row2', 'Add cost tags']]) {
    const edit = doc.querySelector(`#hist-detail ${host} .hd-tags-edit`);
    assert.equal(edit.textContent, word, host);
    // B7: the one button component, quiet — like "Add to group…" — never a link-styled button.
    assert.deepEqual([...edit.classList], ['btn', 'btn-sm', 'btn-quiet', 'hd-tags-edit'], host);
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

test('the Tags label follows the policy: "(optional)" while it is off, "mandatory tags required" while it is on', async () => {
  const opt = (ctx) => ctx.doc.querySelector('.run-tags-field .opt').textContent;
  const cc = [{ key: 'cc', label: 'Cost centre', values: ['4410'], required: true }];
  const none = await bootForm({ dims: () => ({ source: null, home: null, dims: [] }) });
  flagsOn(none.window);
  assert.equal(opt(none), '(optional)', 'no dimensions: optional');
  const off = await bootForm({ dims: () => ({ source: 'settings', home: null, enforce: false, dims: cc }) });
  flagsOn(off.window);
  assert.equal(opt(off), '(optional)', 'policy off: optional, even with a tag ticked Mandatory');
  const on = await bootForm({ dims: () => ({ source: 'settings', home: null, enforce: true, dims: cc }) });
  flagsOn(on.window);
  assert.equal(opt(on), '· mandatory cost tags required', 'policy on: the field says so');
  const onNoneTicked = await bootForm({ dims: () => ({ source: 'settings', home: null, enforce: true, dims: [{ ...cc[0], required: false }] }) });
  flagsOn(onNoneTicked.window);
  assert.equal(opt(onNoneTicked), '(optional)', 'policy on but no tag ticked Mandatory: still optional');
});

test('policy off: a run without a tag ticked Mandatory starts quietly — no warning, nothing blocked', async () => {
  const ctx = await bootForm({ dims: () => ({ source: 'policy', home: 'acme/web', enforce: false, dims: [{ key: 'cc', label: 'Cost centre', values: ['4410'], required: true }] }) });
  flagsOn(ctx.window);
  assert.equal(ctx.doc.getElementById('runTagDimsWarn').hidden, true, 'no "is required" warning under the field');
  const body = await submit(ctx);
  assert.equal(body.tags, undefined, 'the run is posted with no tags');
  for (const toast of ctx.doc.querySelectorAll('.toast')) {   // the run page opens, so no "Run started" toast (F-24)
    assert.doesNotMatch(toast.textContent, /Missing required tag/);
    assert.doesNotMatch(toast.className, /warn/);
  }
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

// ── Run labels (slice 1): the .rd-labels row under the run page status ──

test('run labels, live page: one .rd-labels row right after .rd-sheet-head across 3 repaints', async () => {
  const ctx = await bootApp();
  flagsOn(ctx.window);
  for (let i = 0; i < 3; i++) {
    helloRun(ctx, { runId: 'run-l1', pipelineId: 'aaaa0001', labels: ['hotfix'] });
    if (i === 0) ctx.go('running/run-l1');
    await ctx.settle();
  }
  const doc = ctx.window.document;
  const rows = doc.querySelectorAll('#run-detail .rd-labels');
  assert.equal(rows.length, 1, 'three header paints, one row');
  assert.ok(rows[0].parentElement.matches('.rd-kv [data-fact="labels"] > .rd-kv-v'), 'in the facts block\'s Labels row');
  assert.equal(rows[0].closest('.rd-kv-row').hidden, false);
  assert.deepEqual([...rows[0].querySelectorAll('.label-chip-t')].map((c) => c.textContent), ['hotfix']);
  const edit = rows[0].querySelector('.rd-labels-edit');
  assert.equal(edit.textContent, 'Add');
  assert.ok(edit.querySelector('svg'), 'the plus icon');
  assert.equal(edit.getAttribute('aria-label'), 'Edit labels');
});

test('run 4 D12: an empty Labels row states "None" before "Add"; a labelled row has no "None"', async () => {
  const empty = await bootDetail({ detail: { ...DETAIL, state: { ...DETAIL.state, labels: [] } } });
  flagsOn(empty.window);
  await openDetail(empty, null);
  await deliverRows(empty, [{ ...ROW, labels: [] }]);
  const row = empty.window.document.querySelector('#hist-detail .hd-glance [data-fact="labels"] .rd-labels');
  assert.deepEqual([...row.children].map((c) => [c.className.split(' ').find((n) => n.startsWith('rd-labels-')), c.textContent]),
    [['rd-labels-none', 'None'], ['rd-labels-edit', 'Add']]);
  const live = await bootApp();
  flagsOn(live.window);
  helloRun(live, { runId: 'run-l2', pipelineId: 'aaaa0002', labels: ['hotfix'] });
  live.go('running/run-l2');
  await live.settle();
  assert.equal(live.window.document.querySelector('#run-detail .rd-labels .rd-labels-none'), null);
});

test('run labels, finished page: × PUTs the set without the word; a picker tick posts a one-run delta; one row stays', async () => {
  const puts = [];
  const posts = [];
  const detail = { ...DETAIL, state: { ...DETAIL.state, labels: ['hotfix', 'spike'] } };
  const ctx = await bootDetail({ detail, arms: (url, opts) => {
    if (url.endsWith(`/api/runs/${ROW.id}/labels`) && opts.method === 'PUT') { puts.push(JSON.parse(opts.body)); return okRes({ labels: ['spike'], changed: true }); }
    if (url.endsWith('/api/runs/bulk/labels') && opts.method === 'POST') {
      posts.push(JSON.parse(opts.body));
      return okRes({ runs: [{ id: ROW.id, labels: ['spike', 'release'], changed: true }], missing: [] });
    }
    if (url.endsWith('/api/labels')) return okRes({ labels: [{ label: 'release', count: 1 }] });
    return null;
  } });
  flagsOn(ctx.window);
  await openDetail(ctx, null);
  await deliverRows(ctx, [ROW]);
  const doc = ctx.window.document;
  const row = () => doc.querySelector('#hist-detail .hd-glance .rd-labels');
  assert.ok(row().parentElement.matches('.rd-kv [data-fact="labels"] > .rd-kv-v'));
  click(ctx.window, row().querySelector('.label-x'));
  await settle(ctx.window, 6);
  assert.deepEqual(puts, [{ labels: ['spike'] }]);
  assert.deepEqual([...row().querySelectorAll('.label-chip-t')].map((c) => c.textContent), ['spike']);
  click(ctx.window, row().querySelector('.rd-labels-edit'));
  await settle(ctx.window, 6);
  const box = doc.querySelector('.label-picker .lp-row[data-label="release"] .lp-check');
  box.checked = true;
  box.dispatchEvent(new ctx.window.Event('change', { bubbles: true }));
  await settle(ctx.window, 6);
  assert.deepEqual(posts, [{ pipelineIds: [ROW.id], add: ['release'] }]);
  assert.equal(doc.querySelectorAll('#hist-detail .hd-glance .rd-labels').length, 1);
  assert.deepEqual([...row().querySelectorAll('.label-chip-t')].map((c) => c.textContent), ['spike', 'release']);
  // The toggle rebuilt the row's button: the open picker follows it (Esc refocuses it; a second press closes it).
  doc.querySelector('.label-picker').dispatchEvent(new ctx.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  assert.equal(doc.activeElement, row().querySelector('.rd-labels-edit'));
  click(ctx.window, row().querySelector('.rd-labels-edit'));
  await settle(ctx.window, 6);
  const box2 = doc.querySelector('.label-picker .lp-row[data-label="release"] .lp-check');
  box2.checked = false;
  box2.dispatchEvent(new ctx.window.Event('change', { bubbles: true }));
  await settle(ctx.window, 6);
  click(ctx.window, row().querySelector('.rd-labels-edit'));
  await settle(ctx.window, 6);
  assert.equal(doc.querySelector('.label-picker'), null, 'a press on the rebuilt button closes the picker');
});

test('run labels, finished page: "Add label" when the run has none; no row with the flag off', async () => {
  const ctx = await bootDetail({ detail: { ...DETAIL, state: { ...DETAIL.state, labels: [] } } });
  await openDetail(ctx, null);
  const doc = ctx.window.document;
  assert.equal(doc.querySelector('#hist-detail .rd-labels'), null, 'flag off: nothing');
  flagsOn(ctx.window);
  await deliverRows(ctx, [ROW]);
  const add = doc.querySelector('#hist-detail .hd-glance .rd-labels .rd-labels-edit');
  assert.equal(add.textContent, 'Add');
  assert.equal(add.getAttribute('aria-label'), 'Add a label');
  assert.equal(doc.querySelectorAll('#hist-detail .hd-glance .label-chip').length, 0);
});

test('suggestionsFor: required policy key first, then policy keys, then project keys; values from the policy list', async () => {
  const { suggestionsFor } = await import('../ui/public/tag-input.mjs');
  const dims = [{ key: 'team', values: [], required: false }, { key: 'client', values: [], required: true }, { key: 'cc', values: ['4410', '4420'], required: false }];
  const vocab = { keys: [{ key: 'epic', count: 9, valued: true }, { key: 'cache', count: 3, valued: true }], values: { epic: [] } };
  assert.deepEqual(suggestionsFor('c', vocab, 8, dims), ['client:', 'cc:', 'cache:']);
  assert.deepEqual(suggestionsFor('cc:44', vocab, 8, dims), ['cc:4410', 'cc:4420']);
});

test('New run (#923): the field starts from the project\'s defaults, and a start does not carry its own tags into the next run', async () => {
  const dims = { dims: [{ key: 'client', label: 'Client', values: [], required: true }, { key: 'cc', label: 'Cost centre', values: [], required: false }],
    enforce: false, prefill: ['client:acme'], autofill: { tags: ['client:acme', 'team:ops'], from: 'defaults' } };
  const ctx = await bootForm({ tagsFor: () => ['team:ops'], dims: () => dims });
  flagsOn(ctx.window);
  const slot = (key) => ctx.doc.querySelector(`#runTagDimsField .tag-dim-slot[data-key="${key}"] .tag-dim-input`);
  assert.deepEqual(formChips(ctx.doc), ['team:ops']);
  assert.equal(slot('client').value, 'acme');
  const input = ctx.doc.querySelector('#runTagsField .tag-input-text');
  input.value = 'project:redesign';
  input.dispatchEvent(new ctx.window.KeyboardEvent('keydown', { key: 'Enter', cancelable: true }));
  for (const [key, v] of [['client', 'initech'], ['cc', '4410']]) { slot(key).value = v; slot(key).dispatchEvent(new ctx.window.Event('input')); }
  assert.deepEqual((await submit(ctx)).tags, ['cc:4410', 'client:initech', 'project:redesign', 'team:ops']);
  assert.deepEqual(formChips(ctx.doc), ['team:ops'], 'the run just started is not copied: the defaults come back');
  assert.equal(slot('client').value, 'initech', 'a mandatory slot keeps the value just used');
  assert.equal(slot('cc').value, '', 'an optional slot is not copied');
});
test('New run: a value typed into a slot survives switching the project away and back (no auto-fill overwrites it)', async () => {
  const ctx = await bootForm({ dims: (q) => ({ dims: [{ key: 'client', label: 'Client', values: [], required: true }], enforce: false,
    prefill: q.get('projectDir') === '/a/web' ? ['client:acme'] : ['client:globex'], autofill: { tags: [], from: null } }) });
  flagsOn(ctx.window);
  const slot = () => ctx.doc.querySelector('#runTagDimsField .tag-dim-input');
  assert.equal(slot().value, 'acme');
  slot().value = 'initech'; slot().dispatchEvent(new ctx.window.Event('input'));
  const pick = async (i) => {
    const sel = ctx.doc.getElementById('projectSelect');
    sel.selectedIndex = i; sel.dispatchEvent(new ctx.window.Event('change', { bubbles: true }));
    for (let n = 0; n < 12; n++) await tick();
  };
  const web = ctx.doc.getElementById('projectSelect').selectedIndex;
  await pick([...ctx.doc.getElementById('projectSelect').options].findIndex((o) => o.textContent.includes('api')));
  assert.equal(slot().value, 'initech');
  await pick(web);
  assert.equal(slot().value, 'initech', 'the typed value is kept after the round trip');
});
test('New run: a cleared slot stays empty after a round trip, and an untouched pre-filled slot does not cross projects', async () => {
  const ctx = await bootForm({ dims: (q) => ({ dims: [{ key: 'client', label: 'Client', values: [], required: true }, { key: 'cc', label: 'Cost centre', values: [], required: false }],
    enforce: false, prefill: q.get('projectDir') === '/a/web' ? ['cc:4410', 'client:acme'] : ['client:globex'], autofill: { tags: [], from: null } }) });
  flagsOn(ctx.window);
  const slot = (key) => ctx.doc.querySelector(`#runTagDimsField .tag-dim-slot[data-key="${key}"] .tag-dim-input`);
  const pick = async (i) => {
    const sel = ctx.doc.getElementById('projectSelect');
    sel.selectedIndex = i; sel.dispatchEvent(new ctx.window.Event('change', { bubbles: true }));
    for (let n = 0; n < 12; n++) await tick();
  };
  const opts = () => [...ctx.doc.getElementById('projectSelect').options];
  const web = ctx.doc.getElementById('projectSelect').selectedIndex;
  const api = opts().findIndex((o) => o.textContent.includes('api'));
  assert.equal(slot('cc').value, '4410');
  slot('client').value = ''; slot('client').dispatchEvent(new ctx.window.Event('input'));
  await pick(api);
  assert.equal(slot('client').value, '', 'the cleared slot is not refilled by the next project');
  assert.equal(slot('cc').value, '', 'the untouched pre-filled cc does not cross into a project that has none');
  await pick(web);
  assert.equal(slot('client').value, '', 'the cleared slot is still empty after the round trip');
  assert.equal(slot('cc').value, '4410', 'the untouched slot takes this project\'s fill again');
});
test('style.css: the Cost tags row wraps; the old in-tile rules are gone', () => {
  const css = readFileSync(new URL('../ui/public/style.css', import.meta.url), 'utf8');
  assert.match(css, /\.rd-cost-row\{display:flex;flex-wrap:wrap;/);
  assert.doesNotMatch(css, /\.rd-cost-tags\b/);
});

test('run page head: time, cost and changes tiles only; one Cost tags row under them with "client · missing"; no "Tags" text anywhere', async () => {
  const dims = { dims: [{ key: 'client', label: 'Client', values: [], required: true }], enforce: false, prefill: [], autofill: { tags: [], from: null } };
  // run-page-boot returns the handler's value AS the fetch Response (:45-48), so answer with a Response-like object.
  const ctx = await bootApp({ fetchHandler: (url) => (url.startsWith('/api/tag-dimensions')
    ? Promise.resolve({ ok: true, status: 200, json: async () => dims }) : null) });
  flagsOn(ctx.window);
  helloRun(ctx, { runId: 'run-m1', pipelineId: 'aaaa0002', tags: ['team:web'], projectDir: '/tmp/acme' });
  ctx.go('running/run-m1'); await ctx.settle(); await ctx.settle();
  const doc = ctx.window.document;
  const tiles = [...doc.querySelectorAll('#run-detail .rd-facts .rd-stats > div > span')].map((s) => s.textContent);
  assert.equal(tiles.includes('cost tags'), false, 'no cost tags tile');
  assert.equal(doc.querySelectorAll('#run-detail .rd-stats .tag-chip').length, 0);
  const row = doc.querySelector('#run-detail .rd-kv [data-fact="tags"] > .rd-kv-v > .rd-cost-row');
  assert.ok(row, 'the row sits in the facts block');
  assert.equal(doc.querySelector('#run-detail .rd-facts .rd-cost-row'), null, 'not under the tiles any more');
  assert.equal(row.querySelector('.rd-cost-row-label'), null);
  assert.equal(row.closest('.rd-kv-row').querySelector('.rd-kv-k').textContent, 'Cost tags');
  assert.deepEqual([...row.querySelectorAll(':scope > .tag-chip')].map((c) => c.textContent), ['team:web', 'client · missing']);
  assert.ok(row.querySelector(':scope > .tag-missing'));
  assert.equal(row.querySelector('.hd-tags-edit'), null, 'the live page has no editor (D16)');
  assert.equal(doc.querySelectorAll('#run-detail .rd-page-meta .tag-chip').length, 0);
  // "Cost tags" has a lowercase t, so /\bTags\b/ does not match it.
  // "no visible text reads 'Tags' outside identifiers": text nodes and labelling attributes of the whole booted page
  const walker = doc.createTreeWalker(doc.body, ctx.window.NodeFilter.SHOW_TEXT);
  const bad = [];
  for (let n = walker.nextNode(); n; n = walker.nextNode()) if (/\bTags\b/.test(n.textContent) && !n.parentElement.closest('script,style')) bad.push(n.textContent.trim());
  for (const el of doc.body.querySelectorAll('[aria-label],[placeholder],[title]'))
    for (const a of ['aria-label', 'placeholder', 'title']) if (/\bTags\b/.test(el.getAttribute(a) || '')) bad.push(`${a}=${el.getAttribute(a)}`);
  assert.deepEqual(bad, []);
});

test('finished run page: the Cost tags row holds the chips, the missing key and the Edit control last; the meta line has no tag box', async () => {
  const dims = { dims: [{ key: 'client', label: 'Client', values: [], required: true }], enforce: false, prefill: [], autofill: { tags: [], from: null } };
  const detail = { ...DETAIL, state: { ...DETAIL.state, tags: ['team:web'] } };
  const ctx = await bootDetail({ detail, arms: (url) => (url.startsWith('/api/tag-dimensions') ? okRes(dims) : null) });
  flagsOn(ctx.window);
  await openDetail(ctx, null);
  await deliverRows(ctx, [ROW]);
  await settle(ctx.window, 4);
  const doc = ctx.window.document;
  const row = doc.querySelector('#hist-detail .rd-kv [data-fact="tags"] > .rd-kv-v > .rd-cost-row');
  assert.deepEqual([...row.querySelectorAll(':scope > .tag-chip')].map((c) => c.textContent), ['team:web', 'client · missing']);
  assert.ok(row.lastElementChild.classList.contains('hd-tags'), 'the control is the row\'s last item');
  assert.equal(row.lastElementChild.querySelector('.hd-tags-edit').textContent, 'Edit');
  // Brief §2.4: the tiles stay time, cost and changes; no tags tile.
  const tiles = [...doc.querySelectorAll('#hist-detail .rd-facts .rd-stats > div > span')].map((t) => t.textContent);
  assert.ok(tiles.length && tiles.every((t) => !/tag/i.test(t)), tiles.join(', '));
  assert.equal(doc.querySelector('#hist-detail .rd-facts .rd-cost-row'), null);
  assert.equal(doc.querySelector('#hist-detail .hd-glance .rd-page-meta .hd-tags'), null);
});
