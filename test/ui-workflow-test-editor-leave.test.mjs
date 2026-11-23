// test/ui-workflow-test-editor-leave.test.mjs — pre-merge QA. B5: an example's changes not saved were dropped without a
// word on Cancel, the Tests crumb, a page switch or closing the tab; now leaving asks first (as the canvas does), and the
// browser asks before the tab closes. B6: a file over 5 MB was refused as "Request body too large."; now the editor says
// the store's own rule before anything is sent.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

const settle = async () => { for (let i = 0; i < 30; i += 1) await new Promise((r) => setImmediate(r)); };
const B = '/api/workflows/wf_a/tests';
const overview = { workflowId: 'wf_a', name: 'Brief writer', ctx: { liveVersionNo: 1, latestVersionNo: 1 },
  columns: [{ use: 1, label: 'v1 · the team uses it' }, { use: 'draft', label: 'v2 draft · yours' }],
  examples: [{ id: 1, name: 'Bulk invoice export', hasRequest: true, files: [], fromAt: null, note: null, tries: 0, basics: 2, checks: 0,
    cells: {} }], running: null, latest: null, pastRuns: [] };
const example = { id: 1, name: 'Bulk invoice export', request: 'Write the brief.', files: [], answers: [], basics: { minWords: null, maxWords: null },
  checks: [], criteria: [], judge: null, project: null, liked: null };

function harness() {
  const w = new JSDOM('<!doctype html><html data-flags="workflowTests"><body><div id="wfv-tests"></div></body></html>', { url: 'http://localhost/#workflows/wf_a/tests' }).window;
  globalThis.document = w.document;
  const calls = [];
  const bodies = {
    [`GET ${B}`]: { status: 200, body: overview },
    [`GET ${B}/examples/1`]: { status: 200, body: { example } },
    'GET /api/workflow-tests/projects': { status: 200, body: { projects: [] } },
    [`GET ${B}/plan?b=draft&tries=1`]: { status: 200, body: { b: { perTryUsd: 0.1 } } },
    [`GET ${B}/judge-models`]: { status: 200, body: { models: [], suggested: null } },
    [`GET ${B}/examples/1/criteria`]: { status: 200, body: { trust: {} } },
  };
  const fetch = async (path, init = {}) => {
    const method = init.method || 'GET';
    calls.push(`${method} ${path}`);
    const out = bodies[`${method} ${path}`] || { status: 404, body: { error: 'not here' } };
    return { ok: out.status < 400, status: out.status, json: async () => out.body };
  };
  const listeners = {};
  const win = { location: w.location, history: w.history, localStorage: w.localStorage, setTimeout: () => 0, clearTimeout: () => {},
    addEventListener: (type, fn) => { (listeners[type] ||= []).push(fn); } };
  return { w, win, calls, fetch, listeners, root: w.document.getElementById('wfv-tests') };
}
async function openEditor({ answer = true } = {}) {
  const h = harness();
  const asked = [];
  const { createWorkflowTests } = await import('../ui/public/workflows/tests-app.mjs');
  const ctl = createWorkflowTests({ doc: h.w.document, win: h.win, fetch: h.fetch, safeJson: (r) => r.json(), composer: () => ({ template: () => ({ id: 'wf_a' }) }),
    api: {}, versions: () => ({ showPage: () => ctl.enterList() }), currentView: () => 'workflows',
    confirmModal: async (o) => { asked.push(o.title); return answer; }, openNewPipeline: () => {}, hdMarkdown: {}, mock: () => false, runPageShows: () => false });
  await settle();
  ctl.route('wf_a', 'tests/1', true);
  await settle();
  assert.ok(h.root.querySelector('#wft-ex-name'), 'the editor shows');
  return { h, ctl, asked };
}
const type = (h, sel, text) => { const i = h.root.querySelector(sel); i.value = text; i.dispatchEvent(new h.w.Event('input', { bubbles: true })); };
const button = (h, label) => [...h.root.querySelectorAll('button')].find((b) => b.textContent.trim() === label);
const unload = (h) => { const e = { returnValue: undefined, prevented: false, preventDefault() { this.prevented = true; } }; for (const f of h.listeners.beforeunload || []) f(e); return e; };

test('no change: Cancel leaves at once, and closing the tab asks nothing', async () => {
  const { h, asked } = await openEditor();
  assert.equal(unload(h).prevented, false);
  button(h, 'Cancel').click();
  await settle();
  assert.deepEqual(asked, []);
  assert.equal(h.root.querySelector('#wft-ex-name'), null, 'back on the list');
});

for (const label of ['Cancel', 'Tests']) {
  test(`a changed name: ${label} asks first; "keep editing" stays with the change, Discard leaves`, async () => {
    const kept = await openEditor({ answer: false });
    type(kept.h, '#wft-ex-name', 'Bulk invoice export, Q4');
    button(kept.h, label).click();
    await settle();
    assert.deepEqual(kept.asked, ['Discard your changes to this example?']);
    assert.equal(kept.h.root.querySelector('#wft-ex-name').value, 'Bulk invoice export, Q4', 'still editing, the change kept');

    const left = await openEditor({ answer: true });
    type(left.h, '#wft-ex-name', 'Bulk invoice export, Q4');
    button(left.h, label).click();
    await settle();
    assert.equal(left.h.root.querySelector('#wft-ex-name'), null, 'Discard: back on the list');
  });
}

test('a changed example: a page switch asks through guardLeave, and closing the tab asks the browser\'s question', async () => {
  const { h, ctl, asked } = await openEditor({ answer: false });
  type(h, '#wft-ex-request', 'Write the brief, and quote Dana.');
  assert.equal(await ctl.guardLeave(), false, 'kept editing: the page does not switch');
  assert.deepEqual(asked, ['Discard your changes to this example?']);
  const e = unload(h);
  assert.equal(e.prevented, true);
  assert.equal(e.returnValue, '');
});

test('B6: a file over 5 MB is refused in the editor with the store\'s words, and nothing is sent', async () => {
  const { h } = await openEditor();
  const picker = h.root.querySelector('#wft-ex-file');
  const big = { name: 'export.csv', size: 5 * 1024 * 1024 + 1, arrayBuffer: async () => new ArrayBuffer(0) };
  Object.defineProperty(picker, 'files', { configurable: true, get: () => [big] });
  h.calls.length = 0;
  picker.dispatchEvent(new h.w.Event('change'));
  await settle();
  assert.equal(h.root.querySelector('.wft-error').textContent, 'The file export.csv is larger than 5 MB.', 'the file name keeps its own case');
  assert.deepEqual(h.calls.filter((c) => c.startsWith('POST')), [], 'no upload, no save');
});
