// test/ui-workflow-test-stop-checking.test.mjs — board 59 C (approved 2026-11-21): "Check them on these tries" gets "Stop checking" on its
// band; after a stop the band says how many tries Worca checked, with "Check them on these tries". The line stays until a new check or a
// test starts, or the page is left. The view, then the controller (tests-app.mjs) on a fake server.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { renderCompare } from '../ui/public/workflows/test-compare.mjs';
import { compareModel } from '../src/shared/workflow-tests/compare.mjs';

const CHECKING = 'Worca is checking your criteria on these tries. A test can start when it is done.';
const R = { state: 'reliable', n: 20, agree: 19, decides: true };
const crit = (over = {}) => ({ counts: { total: 1, reliable: 1, unreliable: 0, waiting: 0 }, more: 0, checking: false, stoppable: false, checkUsd: 0.4,
  rows: [{ key: '1|k', label: 'Names a success metric', exampleName: 'Bulk invoice export', exact: false, trust: R, a: { met: 1, of: 1 }, b: { met: 0, of: 1 },
    changed: 'worse', unreliableChange: false }], ...over });
const v = { passed: true, basics: [], checks: [], facts: { durationMs: 60000, sentBack: 0 } };
const tries = [{ id: 1, side: 'a', exampleId: 1, status: 'passed', costUsd: 1, verdict: v }, { id: 2, side: 'b', exampleId: 1, status: 'passed', costUsd: 1, verdict: v }];
const NEW = { id: 1, name: 'Bulk invoice export', reason: 'new', criteria: ['Quotes a real customer directly.'] };
const cmp = (over = {}) => ({ run: { id: 7, kind: 'compare', a: 4, b: 'draft', tries: 1, status: 'done', finishedAt: '2026-10-26T10:00:00Z', capUsd: 15, exampleIds: [1] },
  title: 'Your v5 draft compared with v4', labels: { a: 'v4', b: 'v5 draft' }, examples: 1, costUsd: 2,
  model: compareModel({ examples: [{ id: 1, name: 'Bulk invoice export' }], a: { label: 'v4' }, b: { label: 'v5 draft' }, tries }),
  changes: [], fair: [], notes: { unreliableOnly: [], notChecked: [NEW] }, criteria: crit(), ...over });
const NOW = Date.parse('2026-10-26T12:00:00Z');
const click = (n) => n.dispatchEvent(new n.ownerDocument.defaultView.MouseEvent('click', { bubbles: true }));
const btnByText = (root, text) => [...root.querySelectorAll('button')].find((b) => b.textContent === text);
const settle = async () => { for (let i = 0; i < 30; i += 1) await new Promise((r) => setImmediate(r)); };

function bootCmp(c, { stopCheck = null, checkStopped = null } = {}) {
  const { window } = new JSDOM('<!doctype html><div id="r"></div>');
  const doc = window.document;
  const root = doc.getElementById('r');
  const calls = [];
  const actions = { back() {}, testAgain: () => calls.push('testAgain'), open() {}, tryMore() {}, checkCriteria: () => calls.push('checkCriteria'),
    ...(stopCheck ? { stopCheck } : {}) };
  renderCompare(root, c, actions, { doc, now: NOW, checkStopped });
  return { root, calls, again: (d, o = {}) => renderCompare(root, d, actions, { doc, now: NOW, checkStopped, ...o }) };
}

test('board 59 C: the checking band has "Stop checking" (btn btn-sm); one press at a time, also across a repaint', async () => {
  let presses = 0; let done;
  const stopCheck = () => { presses += 1; return new Promise((r) => { done = r; }); };
  const { root, again } = bootCmp(cmp({ criteria: crit({ checking: true, stoppable: true }) }), { stopCheck });
  const band = root.querySelector('.wft-crit-band');
  assert.equal(band.getAttribute('role'), 'status');
  assert.equal(band.querySelector('.wft-crit-band-l').textContent, CHECKING, 'the approved band words (boards 55, 58, 59)');
  const stop = btnByText(band, 'Stop checking');
  assert.equal(stop.className, 'btn btn-sm');
  assert.equal(stop.type, 'button');
  assert.equal(stop.textContent, 'Stop checking', 'its name is its words');
  click(stop);
  click(stop);
  assert.equal(presses, 1, 'a double click stops once');
  assert.equal(stop.disabled, true);
  again(cmp({ criteria: crit({ checking: true, stoppable: true }) }));
  assert.equal(btnByText(root, 'Stop checking').disabled, true, 'still pressed after a repaint');
  done();
  await settle();
  assert.equal(btnByText(root, 'Stop checking').disabled, false, 'given back once the stop answered');
});

test("board 59 C: no Stop on a test's own criteria phase, nor without the action", () => {
  const own = bootCmp(cmp({ criteria: crit({ checking: true, stoppable: false }) }), { stopCheck: () => {} });
  assert.equal(own.root.querySelector('.wft-crit-band-l').textContent, CHECKING);
  assert.equal(btnByText(own.root, 'Stop checking'), undefined);
  const none = bootCmp(cmp({ criteria: crit({ checking: true, stoppable: true }) }));
  assert.equal(btnByText(none.root, 'Stop checking'), undefined);
});

test('board 59 C: after a stop: "You stopped the check. Worca checked N of M tries; …" with "Check them on these tries"', () => {
  const { root, calls, again } = bootCmp(cmp(), { checkStopped: { runId: 7, done: 1, of: 4 } });
  const band = root.querySelector('.wft-crit-band');
  assert.equal(band.getAttribute('role'), 'status');
  assert.equal(band.querySelector('.wft-crit-band-l').textContent, 'You stopped the check. Worca checked 1 of 4 tries; the rest read "Not checked yet".');
  assert.equal(band.querySelector('.wft-crit-band-l svg'), null, 'no icon (board 59)');
  const check = band.querySelector('button');
  assert.deepEqual([check.textContent, check.className], ['Check them on these tries', 'btn btn-sm']);
  click(check);
  assert.deepEqual(calls, ['checkCriteria']);
  again(cmp(), { checkStopped: { runId: 8, done: 1, of: 4 } });
  assert.equal(root.querySelector('.wft-crit-band-l').textContent,
    'Your criteria changed after this test. New criteria show as "Not checked yet" until Worca checks them on these tries.', "another test's stop: not here");
  again(cmp({ criteria: crit({ checking: true, stoppable: true }) }), { checkStopped: { runId: 7, done: 1, of: 4 } });
  assert.equal(root.querySelector('.wft-crit-band-l').textContent, CHECKING, 'a new check shows its band');
});

// ---- The controller ----
function harness(routes) {
  const w = new JSDOM('<!doctype html><html data-flags="workflowTests"><body><div id="wfv-tests"></div></body></html>', { url: 'http://localhost/#workflows' }).window;
  const doc = w.document;
  globalThis.document = doc;
  const calls = [];
  const timers = [];
  const win = { location: w.location, history: w.history, localStorage: w.localStorage,
    setTimeout: (fn) => { timers.push(fn); return timers.length; }, clearTimeout: () => {} };
  const fetch = async (path, init = {}) => {
    const method = init.method || 'GET';
    calls.push([method, path, init.body]);
    const h = routes[`${method} ${path}`];
    const out = (await (typeof h === 'function' ? h() : h)) || { status: 404, body: { error: 'not here' } };
    return { ok: out.status < 400, status: out.status, json: async () => out.body };
  };
  return { doc, win, calls, timers, fetch, root: doc.getElementById('wfv-tests') };
}
const overview = { workflowId: 'wf_a', name: 'Brief writer', ctx: { liveVersionNo: 4, latestVersionNo: 4 },
  columns: [{ use: 4, label: 'v4 · the team uses it' }, { use: 'draft', label: 'v5 draft · yours' }],
  examples: [{ id: 1, name: 'Bulk invoice export', hasRequest: true, files: [], fromAt: null, note: null, tries: 1, basics: 2, checks: 0,
    cells: { 4: { passed: 1, total: 1, stale: false, past: null }, draft: { passed: 1, total: 1, stale: false, past: null } } }], running: null,
  latest: { runId: 7, title: 'Latest test: your v5 draft compared with v4', finishedAt: '2026-10-26T10:00:00Z', examples: 1, tries: 1, costUsd: 2,
    counts: { better: 0, worse: 1, same: 0 }, status: 'done', stopReason: null }, pastRuns: [] };

test('board 59 C: tests-app.mjs: Stop checking calls the stop route, then the line with the real N and M; a new check or leaving clears it', async () => {
  const { createWorkflowTests } = await import('../ui/public/workflows/tests-app.mjs');
  const B = '/api/workflows/wf_a/tests';
  let checking = true;
  const compare = cmp();
  delete compare.criteria;
  const routes = {
    [`GET ${B}`]: { status: 200, body: overview },
    [`GET ${B}/runs/7/compare`]: () => ({ status: 200, body: compare }),
    [`GET ${B}/runs/7/criteria`]: () => ({ status: 200, body: crit({ checking, stoppable: checking }) }),
    [`POST ${B}/runs/7/stop`]: () => { checking = false; return { status: 200, body: { run: { ...compare.run, checked: { done: 2, of: 5 } } } }; },
    [`POST ${B}/runs/7/criteria/check`]: () => { checking = true; return { status: 202, body: { checking: true } }; },
  };
  const h = harness(routes);
  const ctl = createWorkflowTests({ doc: h.doc, win: h.win, fetch: h.fetch, safeJson: (r) => r.json(), composer: () => ({ template: () => ({ id: 'wf_a' }) }),
    api: {}, versions: () => ({ showPage: () => ctl.enterList() }), currentView: () => 'workflows', confirmModal: async () => true, openNewPipeline: () => {},
    hdMarkdown: {}, mock: () => false, runPageShows: () => false });
  ctl.enterList();
  await settle();
  click(h.root.querySelector('.wft-latest'));
  await settle();
  assert.equal(h.root.querySelector('.wft-crit-band-l').textContent, CHECKING);
  click(btnByText(h.root, 'Stop checking'));
  await settle();
  assert.ok(h.calls.some(([m, p]) => m === 'POST' && p === `${B}/runs/7/stop`), 'the existing stop route');
  const sent = h.calls.find(([m, p]) => m === 'POST' && p === `${B}/runs/7/stop`)[2];
  assert.deepEqual(JSON.parse(sent), { only: 'criteria' }, 'review M5: it stops only the check of the criteria');
  const line = 'You stopped the check. Worca checked 2 of 5 tries; the rest read "Not checked yet".';
  assert.equal(h.root.querySelector('.wft-crit-band-l').textContent, line);
  ctl.changed({ type: 'workflow-tests-changed', workflowId: 'wf_a', testRunId: 7 });
  await settle();
  assert.equal(h.root.querySelector('.wft-crit-band-l').textContent, line, 'a repaint keeps it');
  click(btnByText(h.root.querySelector('.wft-crit-band'), 'Check them on these tries'));
  await settle();
  assert.ok(h.calls.some(([m, p]) => m === 'POST' && p === `${B}/runs/7/criteria/check`));
  assert.equal(h.root.querySelector('.wft-crit-band-l').textContent, CHECKING, 'a new check: the line is gone');
  click(btnByText(h.root, 'Stop checking'));
  await settle();
  assert.equal(h.root.querySelector('.wft-crit-band-l').textContent, line);
  click(btnByText(h.root, 'Tests'));   // the crumb: the page is left
  await settle();
  click(h.root.querySelector('.wft-latest'));
  await settle();
  assert.notEqual(h.root.querySelector('.wft-crit-band-l').textContent, line, 'back on the page: the line is gone');
});

test('review M6: after Stop checking, focus moves to "Check them on these tries", never to the page body', () => {
  const { root, again } = bootCmp(cmp({ criteria: crit({ checking: true, stoppable: true }) }), { stopCheck: () => {} });
  const stop = btnByText(root, 'Stop checking');
  stop.focus();
  assert.equal(root.ownerDocument.activeElement, stop);
  again(cmp(), { checkStopped: { runId: 7, done: 1, of: 4 } });
  const check = btnByText(root.querySelector('.wft-crit-band'), 'Check them on these tries');
  assert.equal(root.ownerDocument.activeElement, check);
  assert.equal(check.dataset.busyKey, 'wft-crit-check', 'still busy as every "Check them on these tries"');
});

test('round 5 review M6: after a stop with no count, focus moves to the band that follows (its first button, else the band), never the body', () => {
  // The criteria changed after the test: the usual band and its "Check them on these tries".
  const a = bootCmp(cmp({ criteria: crit({ checking: true, stoppable: true }) }), { stopCheck: () => {} });
  btnByText(a.root, 'Stop checking').focus();
  a.again(cmp(), { checkStopped: { runId: 7 } });
  const band = a.root.querySelector('.wft-crit-band');
  assert.notEqual(band.querySelector('.wft-crit-band-l').textContent.slice(0, 16), 'You stopped the ', 'no count: the usual band, no new words');
  assert.equal(a.root.ownerDocument.activeElement, band.querySelector('button'));
  assert.equal(band.querySelector('button').dataset.busyKey, 'wft-crit-check', 'still busy as every "Check them on these tries"');
  // Every criterion checked: the band has no button, so the band itself takes the focus.
  const b = bootCmp(cmp({ criteria: crit({ checking: true, stoppable: true }) }), { stopCheck: () => {} });
  btnByText(b.root, 'Stop checking').focus();
  b.again(cmp({ notes: { unreliableOnly: [], notChecked: [] } }), { checkStopped: { runId: 7 } });
  const ok = b.root.querySelector('.wft-crit-band');
  assert.equal(ok.querySelector('.wft-crit-band-l').textContent, 'Worca checked your criteria on these tries.');
  assert.equal(b.root.ownerDocument.activeElement, ok);
  assert.equal(ok.getAttribute('tabindex'), '-1');
});

test('round 5 review M6: tests-app.mjs keeps a stop with no count, so the focus moves to the band that follows', async () => {
  const { createWorkflowTests } = await import('../ui/public/workflows/tests-app.mjs');
  const B = '/api/workflows/wf_a/tests';
  let checking = true;
  const compare = cmp();
  delete compare.criteria;
  const routes = {
    [`GET ${B}`]: { status: 200, body: overview },
    [`GET ${B}/runs/7/compare`]: () => ({ status: 200, body: compare }),
    [`GET ${B}/runs/7/criteria`]: () => ({ status: 200, body: crit({ checking, stoppable: checking }) }),
    [`POST ${B}/runs/7/stop`]: () => { checking = false; return { status: 200, body: { run: { ...compare.run, checked: null } } }; },
  };
  const h = harness(routes);
  const ctl = createWorkflowTests({ doc: h.doc, win: h.win, fetch: h.fetch, safeJson: (r) => r.json(), composer: () => ({ template: () => ({ id: 'wf_a' }) }),
    api: {}, versions: () => ({ showPage: () => ctl.enterList() }), currentView: () => 'workflows', confirmModal: async () => true, openNewPipeline: () => {},
    hdMarkdown: {}, mock: () => false, runPageShows: () => false });
  ctl.enterList();
  await settle();
  click(h.root.querySelector('.wft-latest'));
  await settle();
  const stop = btnByText(h.root, 'Stop checking');
  stop.focus();
  click(stop);
  await settle();
  const band = h.root.querySelector('.wft-crit-band');
  assert.notEqual(band.querySelector('.wft-crit-band-l').textContent.slice(0, 16), 'You stopped the ');
  assert.equal(h.doc.activeElement, band.querySelector('button'), 'never the page body');
});
