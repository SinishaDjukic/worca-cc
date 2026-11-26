// test/ui-workflow-test-open-example.test.mjs — pre-merge QA (B1 and the "lost click"): opening an example read its 7
// independent reads one after another, about 5 s where git is slow, while the address still named the list. A reload in
// that time came back to the list, and a click looked lost. Now the reads go out together, and the address names the
// example while it opens.
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

/** Every read waits until `release()`, so the test sees which reads are out at once. */
function harness({ exampleStatus = 200 } = {}) {
  const w = new JSDOM('<!doctype html><html data-flags="workflowTests"><body><div id="wfv-tests"></div></body></html>', { url: 'http://localhost/#workflows/wf_a/tests' }).window;
  globalThis.document = w.document;
  const calls = [];
  const waiting = [];
  const bodies = {
    [`GET ${B}`]: { status: 200, body: overview },
    [`GET ${B}/examples/1`]: { status: exampleStatus, body: exampleStatus === 200 ? { example } : { error: 'No example 1.' } },
    'GET /api/workflow-tests/projects': { status: 200, body: { projects: [] } },
    [`GET ${B}/plan?b=draft&tries=1`]: { status: 200, body: { b: { perTryUsd: 0.1 } } },
    [`GET ${B}/judge-models`]: { status: 200, body: { models: [], suggested: null } },
    [`GET ${B}/examples/1/criteria`]: { status: 200, body: { trust: {} } },
  };
  let held = false;
  const fetch = (path, init = {}) => {
    const method = init.method || 'GET';
    calls.push(`${method} ${path}`);
    const out = bodies[`${method} ${path}`] || { status: 404, body: { error: 'not here' } };
    const reply = { ok: out.status < 400, status: out.status, json: async () => out.body };
    if (!held) return Promise.resolve(reply);
    return new Promise((r) => waiting.push(() => r(reply)));
  };
  const win = { location: w.location, history: w.history, localStorage: w.localStorage, setTimeout: () => 0, clearTimeout: () => {} };
  return { w, win, calls, fetch, hold: () => { held = true; }, release: () => { held = false; waiting.splice(0).forEach((f) => f()); },
    root: w.document.getElementById('wfv-tests') };
}
async function boot(h) {
  const { createWorkflowTests } = await import('../ui/public/workflows/tests-app.mjs');
  const ctl = createWorkflowTests({ doc: h.w.document, win: h.win, fetch: h.fetch, safeJson: (r) => r.json(), composer: () => ({ template: () => ({ id: 'wf_a' }) }),
    api: {}, versions: () => ({ showPage: () => ctl.enterList() }), currentView: () => 'workflows', confirmModal: async () => true, openNewPipeline: () => {},
    hdMarkdown: {}, mock: () => false, runPageShows: () => false });
  return ctl;
}

test('an example\'s address opens it: the reads go out together, and the address names the example while it opens', async () => {
  const h = harness();
  const ctl = await boot(h);
  await settle();
  h.hold();
  h.calls.length = 0;
  ctl.route('wf_a', 'tests/1', true);            // a reload or a link on #workflows/wf_a/tests/1
  await settle();
  const reads = [`GET ${B}/examples/1`, 'GET /api/workflow-tests/projects', `GET ${B}/plan?b=draft&tries=1`, `GET ${B}/judge-models`,
    `GET ${B}/examples/1/criteria`];
  for (const r of reads) assert.ok(h.calls.includes(r), `${r} is out before any read came back`);
  assert.equal(h.w.location.hash, '#workflows/wf_a/tests/1', 'a reload now comes back to the example');
  assert.match(h.root.textContent, /Reading the tests…/, 'the page shows the click did something');
  h.release();
  await settle();
  assert.ok(h.root.querySelector('#wft-ex-name'), 'the editor shows');
  assert.equal(h.w.location.hash, '#workflows/wf_a/tests/1');
});

test('an example that cannot be read: the list stays, and its address comes back', async () => {
  const h = harness({ exampleStatus: 404 });
  const ctl = await boot(h);
  await settle();
  ctl.route('wf_a', 'tests/1', true);
  await settle();
  assert.equal(h.root.querySelector('#wft-ex-name'), null);
  assert.equal(h.w.location.hash, '#workflows/wf_a/tests');
  assert.match(h.root.textContent, /Bulk invoice export/, 'the list shows again, not the loading line');
});

for (const [label, sub, hash] of [['the list (the Tests tab)', 'tests', '#workflows/wf_a/tests']]) {
  test(`leaving for ${label} while an example opens: the address follows, and the editor never takes the page over`, async () => {
    const h = harness();
    const ctl = await boot(h);
    await settle();
    h.hold();
    ctl.route('wf_a', 'tests/1', true);
    await settle();
    ctl.route('wf_a', sub, true);
    await settle();
    h.release();
    await settle();
    assert.equal(h.w.location.hash, hash);
    assert.equal(h.root.querySelector('#wft-ex-name'), null);
  });
}
