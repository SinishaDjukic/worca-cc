// test/ui-workflow-test-trust-report.test.mjs — board 13 (How reliable is Worca's checking?), P4-M4's early states (approved
// 2026-11-20), user decisions 4 and 5, board 1's card on the Tests list, the address and the controller.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { readFileSync } from 'node:fs';
import { renderTrustReport } from '../ui/public/workflows/criteria-pages.mjs';
import { renderTestsPage, testsAddress, TESTS_ROUTE_RE } from '../ui/public/workflows/tests-view.mjs';
import { trustReportModel } from '../src/shared/workflow-tests/criteria-report.mjs';

const dom = () => { const { document: doc } = new JSDOM('<!doctype html><div id="r"></div>').window; return { doc, root: doc.getElementById('r') }; };
const NOOP = { fix: () => {}, confirm: () => {}, back: () => {} };
const texts = (root, sel) => [...root.querySelectorAll(sel)].map((x) => x.textContent);
const btnByText = (root, text) => [...root.querySelectorAll('button')].find((b) => b.textContent === text);
const crit = (id, text, trust) => ({ exampleId: id, exampleName: `E${id}`, criterionId: `k_${id}`, text, trust });

test('board 13: tiles, six tests with their states, what to do', () => {
  const { doc, root } = dom();
  const m = trustReportModel({ criteria: [
    { exampleId: 1, exampleName: 'B', criterionId: 'k_1', text: 'Names a metric', trust: { state: 'reliable', n: 20, agree: 18, decides: true } },
    { exampleId: 2, exampleName: 'P', criterionId: 'k_2', text: 'Proposes a test within 4 weeks', trust: { state: 'unreliable', n: 10, agree: 6, decides: false } }],
  rounds: [], pairs: [], proofs: { found: 214, of: 216 }, lastAt: '2026-10-19T10:00:00Z', costUsd: 1.8 });
  const fixed = [];
  renderTrustReport(root, m, { fix: (e, c) => fixed.push([e, c]), confirm: () => {}, back: () => {} }, { doc, dateText: () => '19 Oct' });
  assert.equal(root.querySelector('.wft-title').textContent, "How reliable is Worca's checking?");
  assert.equal(root.querySelector('.subtitle').textContent,
    'Worca uses AI to check your criteria. AI can be wrong, so Worca tests its own checking in six ways. The results show where you can trust it and where you should not.');
  assert.deepEqual(texts(root, '.wft-tile-label'), ['Agrees with people', 'Planted mistakes caught', 'Criteria you can trust']);
  assert.deepEqual(texts(root, '.wft-tile-value'), ['80%', '—', '1 of 2'], 'P4-M4: nothing planted yet is "—"');
  assert.deepEqual(texts(root, '.wft-tile-sub'), ['of 30 answers', 'not tested yet', '1 unreliable (shown, does not decide)']);
  assert.equal(root.querySelectorAll('.wft-tr-test').length, 6);
  assert.deepEqual(texts(root, '.wft-tr-test b'), ['Planted mistakes', 'Asked again', 'Order swapped', 'Longer is not better', 'Proof for every verdict', 'Agreement with people']);
  assert.deepEqual(texts(root, '.wft-tr-dot'), ['1', '2', '3', '4', '5', '6']);
  assert.match(root.textContent, /They run again whenever the checking model or a criterion changes\. Last run 19 Oct · cost \$1\.80\./);
  assert.equal(root.querySelector('.wft-tr-tests .hint .code').textContent, '$1.80');
  // board 13: 214 of 216 verdicts with proof is green Good (fix round 1: from AGREE_MIN); the six tests come before What to do
  const proof = root.querySelectorAll('.wft-tr-test')[4];
  assert.deepEqual([proof.querySelector('.badge').className, proof.querySelector('.badge').textContent], ['badge green', 'Good']);
  assert.equal(proof.querySelector('.wft-tr-line').textContent, '214 of 216 verdicts had proof. 2 were not counted.');
  const people = root.querySelectorAll('.wft-tr-test')[5];
  assert.deepEqual([people.querySelector('.badge').className, people.querySelector('.wft-tr-line').textContent], ['badge green', '80% of 30 answers']);
  const order = [...root.querySelector('.wft-page').children].map((x) => x.className);
  assert.ok(order.indexOf('card wft-tr-tests') < order.indexOf('card wft-tr-todo'));
  assert.equal(root.querySelector('.wft-tr-todo-row').textContent, '"Proposes a test within 4 weeks" is unreliable.Fix the criterion');
  root.querySelector('button.wft-tr-fix').click();
  assert.deepEqual(fixed, [[2, 'k_2']]);
});

test("board 13 / P4-M4 part 3: counted badges (user decision 4), Both missed on one criterion, and no colleagues' line", () => {
  const { doc, root } = dom();
  const cards = (miss) => [{ planted: null, met: true }, ...Array.from({ length: 6 }, (_, i) => ({ planted: `p${i}`, met: i < miss }))];
  const rounds = [
    { criterionText: 'Names a success metric with a number', cards: cards(0), same: { n: 4, of: 4 }, padding: { n: 4, of: 4 } },
    { criterionText: 'Asks which part matters most before writing', cards: cards(2), same: { n: 4, of: 4 }, padding: { n: 4, of: 4 } },
  ];
  const m = trustReportModel({ criteria: [
    crit(1, 'Names a success metric with a number', { state: 'reliable', n: 10, agree: 9 }),
    crit(2, 'Asks which part matters most before writing', { state: 'confirm', n: 4, agree: 3 }),
    crit(3, 'Explains the legal reason for each data field', { state: 'collecting', n: 0, agree: 0 })], rounds, lastAt: '2026-10-19T10:00:00Z', costUsd: 0.4 });
  renderTrustReport(root, m, NOOP, { doc, dateText: () => '19 Oct' });
  assert.deepEqual(texts(root, '.wft-tile-value'), ['86%', '10 of 12', '1 of 3']);
  assert.deepEqual(texts(root, '.wft-tile-sub'), ['of 14 answers', 'the 2 missed are on one criterion', '2 wait for your answers']);
  assert.doesNotMatch(root.textContent, /people agree with each other|colleagues/, 'Part 5 brings colleagues');
  const rows = root.querySelectorAll('.wft-tr-test');
  assert.deepEqual([rows[0].querySelector('.badge').className, rows[0].querySelector('.badge').textContent], ['badge red', '2 missed']);
  assert.equal(rows[0].querySelector('.wft-tr-line').textContent, '10 of 12 caught. Both missed on "Asks which part matters most before writing".');
  assert.deepEqual([rows[5].querySelector('.badge').textContent, rows[5].querySelector('.wft-tr-line').textContent], ['Good', '86% of 14 answers']);
  assert.equal(rows[5].querySelector('p').textContent, 'From your Agree and Disagree answers and "Check the checker".');
  assert.deepEqual([rows[2].querySelector('.badge').className, rows[2].querySelector('.badge').textContent], ['badge', 'Not run yet']);
  assert.equal(rows[2].querySelector('.wft-tr-line'), null, 'a test not run yet has only its badge');
});

test('fix round 1: board 13 order swapped at 17 of 18 pairs is Good; below the bar, order and proof are red with their count', () => {
  const { doc, root } = dom();
  const pairs = (same, of) => Array.from({ length: of }, (_, i) => ({ winner: i < same ? 'a' : 'unsure' }));
  const base = { criteria: [crit(1, 'T', { state: 'reliable', n: 10, agree: 9 })] };
  renderTrustReport(root, trustReportModel({ ...base, pairs: pairs(17, 18) }), NOOP, { doc });
  let order = root.querySelectorAll('.wft-tr-test')[2];
  assert.deepEqual([order.querySelector('.badge').className, order.querySelector('.badge').textContent, order.querySelector('.wft-tr-line').textContent],
    ['badge green', 'Good', 'Same winner in 17 of 18 pairs']);
  renderTrustReport(root, trustReportModel({ ...base, pairs: pairs(7, 10), proofs: { found: 150, of: 216 } }), NOOP, { doc });
  order = root.querySelectorAll('.wft-tr-test')[2];
  const proof = root.querySelectorAll('.wft-tr-test')[4];
  assert.deepEqual([order.querySelector('.badge').className, order.querySelector('.badge').textContent], ['badge red', '3 changes']);
  assert.deepEqual([proof.querySelector('.badge').className, proof.querySelector('.badge').textContent], ['badge red', '66 without proof']);
});

test('fix round 1: an exact-only workflow opens the report the card promised (tiles, the six tests), not "No criteria yet"; criteria without a model read "—"', () => {
  const { doc, root } = dom();
  renderTrustReport(root, trustReportModel({ exactChecks: 2 }), NOOP, { doc });
  assert.equal(root.querySelector('.wft-tr-none'), null);
  assert.equal(root.querySelector('.wft-tr-info'), null);
  assert.deepEqual(texts(root, '.wft-tile-value'), ['—', '—', '2 of 2']);
  assert.equal(root.querySelectorAll('.wft-tr-test').length, 6);
  renderTrustReport(root, trustReportModel({ criteria: [crit(1, 'T', null)] }), NOOP, { doc });
  assert.deepEqual(texts(root, '.wft-tile-value'), ['—', '—', '—'], 'never "0 of 0"');
  assert.ok(root.querySelectorAll('.wft-tile-value')[2].classList.contains('is-none'));
});

test('P4-M4 state 1: no criteria yet: one card, "Go to the examples" goes back to the list; no tiles, no tests', () => {
  const { doc, root } = dom();
  let back = 0;
  renderTrustReport(root, trustReportModel({}), { ...NOOP, back: () => { back += 1; } }, { doc });
  assert.equal(root.querySelector('.wft-tr-none h2').textContent, 'No criteria yet');
  assert.equal(root.querySelector('.wft-tr-none p').textContent,
    'Worca tests its own checking once an example has criteria. Add one to an example in your own words, for example "names a goal with a number".');
  assert.equal(root.querySelector('.wft-tiles'), null);
  assert.equal(root.querySelector('.wft-tr-tests'), null);
  btnByText(root, 'Go to the examples').click();
  btnByText(root, 'Tests').click();
  assert.equal(back, 2);
});

test('P4-M4 state 2: criteria but no answers: the blue box, "—" tiles, What to do before the six tests, every test Not run yet', () => {
  const { doc, root } = dom();
  const fresh = { state: 'confirm', n: 0, agree: 0 };
  const m = trustReportModel({ criteria: [crit(1, 'Names a success metric with a number, and how to measure it', fresh),
    crit(2, 'Explains the legal reason for each data field', fresh), crit(3, 'Asks which part matters most before writing', fresh)] });
  assert.equal(m.state, 'no-answers');
  const confirmed = [];
  renderTrustReport(root, m, { ...NOOP, confirm: (e, c) => confirmed.push([e, c]) }, { doc });
  assert.equal(root.querySelector('.wft-tr-info h2').textContent, 'Worca needs your answers first: confirm each new criterion.');
  assert.equal(root.querySelector('.wft-tr-info span').textContent, 'Each one takes 4 answers. Until then, the tests below have little to go on.');
  assert.deepEqual(texts(root, '.wft-tile-value'), ['—', '—', '0 of 3']);
  assert.deepEqual(texts(root, '.wft-tile-sub'), ['no answers yet', 'not tested yet', '3 wait for your answers']);
  assert.deepEqual([...root.querySelectorAll('.wft-tile-value')].map((v) => v.classList.contains('is-none')), [true, true, false]);
  const order = [...root.querySelector('.wft-page').children].map((x) => x.className);
  assert.ok(order.indexOf('card wft-tr-todo') < order.indexOf('card wft-tr-tests'), 'P4-M4: What to do comes first');
  assert.deepEqual(texts(root, '.wft-tr-todo-row > span'), [
    '"Names a success metric with a number, and how to measure it" is new. Confirm 4 results so Worca knows it judges it your way.',
    '"Explains the legal reason for each data field" is new. Confirm 4 results so Worca knows it judges it your way.',
    '"Asks which part matters most before writing" is new. Confirm 4 results so Worca knows it judges it your way.']);
  const confirm = root.querySelectorAll('button.wft-tr-confirm');
  assert.deepEqual([...confirm].map((b) => [b.className.includes('badge amber'), b.textContent]), Array(3).fill([true, 'Confirm 4 results']));
  confirm[1].click();
  assert.deepEqual(confirmed, [[2, 'k_2']]);
  assert.equal(root.querySelector('.wft-tr-tests .hint').textContent, 'They run again whenever the checking model or a criterion changes. Not run yet.');
  assert.deepEqual(texts(root, '.wft-tr-test .badge'), Array(6).fill('Not run yet'));
});

test('user decision 5: 1 to 9 answers: the people test reads the real numbers and what Worca needs, with a grey badge', () => {
  const { doc, root } = dom();
  const m = trustReportModel({ criteria: [crit(1, 'T', { state: 'collecting', n: 6, agree: 6 })] });
  renderTrustReport(root, m, NOOP, { doc });
  const people = root.querySelectorAll('.wft-tr-test')[5];
  assert.deepEqual([people.querySelector('.badge').className, people.querySelector('.badge').textContent], ['badge', 'Needs your answers']);
  assert.equal(people.querySelector('.wft-tr-line').textContent, '100% · of 6 answers (Worca needs 10)');
  assert.deepEqual(texts(root, '.wft-tile-value').slice(0, 1), ['100%']);
  assert.equal(root.querySelector('.wft-tr-info'), null, 'answers exist: no blue box');
});

test("board 1: the Tests list's card \"Can you trust Worca's checking?\" opens the report; none without criteria", () => {
  const { doc, root } = dom();
  const overview = (trust) => ({ workflowId: 'wf', name: 'W', needsProject: false, ctx: {}, draftSameAs: null, columns: [{ use: 'draft', label: 'Your draft · yours' }],
    examples: [{ id: 1, name: 'Bulk', hasRequest: true, files: [], tries: 3, basics: 3, checks: 0, criteria: 2, cells: {}, project: null, ready: true }],
    running: null, latest: null, pastRuns: [], trust });
  let opened = 0;
  renderTestsPage(root, overview({ total: 12, reliable: 10, unreliable: 1, waiting: 1 }), { openTrust: () => { opened += 1; } }, { doc });
  const card = root.querySelector('.wft-trust-card');
  assert.equal(card.querySelector('.wft-trust-title').textContent, "Can you trust Worca's checking?");
  assert.equal(card.querySelector('.hint').textContent, 'Reliable for 10 of 12 criteria. 1 is unreliable, 1 needs your answers.');
  assert.equal(card.tagName, 'BUTTON');
  assert.equal(card.getAttribute('aria-label'), "Can you trust Worca's checking? Reliable for 10 of 12 criteria. 1 is unreliable, 1 needs your answers.", 'fix round 1: the two parts read apart');
  card.click();
  assert.equal(opened, 1);
  const kids = [...root.querySelector('.wft-page').children].map((x) => x.className);
  assert.ok(kids.indexOf('card wft-table') < kids.indexOf('wft-cards') && kids.indexOf('wft-cards') < kids.indexOf('hint wft-foot'), 'after the table, before Why 3 tries');
  renderTestsPage(root, overview({ total: 0, reliable: 0, unreliable: 0, waiting: 0 }), {}, { doc });
  assert.equal(root.querySelector('.wft-trust-card'), null);
  renderTestsPage(root, overview(undefined), {}, { doc });
  assert.equal(root.querySelector('.wft-trust-card'), null);
});

test("the report's address, and the route that opens it after a reload", () => {
  assert.equal(testsAddress({ workflowId: 'wf_a', shown: true, view: 'trust' }), '#workflows/wf_a/tests/trust');
  assert.equal(TESTS_ROUTE_RE.exec('tests/trust')[5], 'trust');
  assert.deepEqual([...TESTS_ROUTE_RE.exec('tests/4/checker/7')].slice(1, 5), [undefined, undefined, '4', '7'], 'Task 22\'s form still matches');
  assert.equal(TESTS_ROUTE_RE.exec('tests/trusts'), null);
});

function harness(routes) {
  const w = new JSDOM('<!doctype html><html data-flags="workflowTests"><body><div id="wfv-tests"></div></body></html>', { url: 'http://localhost/#workflows' }).window;
  const doc = w.document;
  globalThis.document = doc;
  const calls = [];
  const win = { location: w.location, history: w.history, localStorage: w.localStorage, setTimeout: () => 0, clearTimeout: () => {} };
  const fetch = async (path, init = {}) => {
    const method = init.method || 'GET';
    const body = init.body ? JSON.parse(init.body) : undefined;
    calls.push([method, path, body]);
    const h = routes[`${method} ${path}`];
    const out = (await (typeof h === 'function' ? h(body) : h)) || { status: 404, body: { error: 'not here' } };
    return { ok: out.status < 400, status: out.status, json: async () => out.body };
  };
  return { doc, win, calls, fetch, root: doc.getElementById('wfv-tests') };
}
const settle = async () => { for (let i = 0; i < 30; i += 1) await new Promise((r) => setImmediate(r)); };

test('tests-app.mjs: the card opens the report at its address; Fix the criterion starts Check the checker of it; Tests goes back', async () => {
  const { createWorkflowTests } = await import('../ui/public/workflows/tests-app.mjs');
  const B = '/api/workflows/wf_a/tests';
  let report = trustReportModel({ criteria: [crit(4, 'Proposes a test within 4 weeks', { state: 'unreliable', n: 10, agree: 6 }),
    crit(5, 'Explains the legal reason', { state: 'confirm', n: 0, agree: 0 })] });
  const list = { workflowId: 'wf_a', name: 'W', needsProject: false, ctx: {}, draftSameAs: null, columns: [{ use: 'draft', label: 'Your draft' }],
    examples: [{ id: 4, name: 'Bulk', hasRequest: true, files: [], tries: 3, basics: 3, checks: 0, criteria: 1, cells: {}, project: null, ready: true }],
    running: null, latest: null, pastRuns: [], trust: { total: 1, reliable: 0, unreliable: 1, waiting: 0 } };
  const h = harness({
    [`GET ${B}`]: { status: 200, body: list },
    [`GET ${B}/trust`]: () => ({ status: 200, body: report }),
    [`POST ${B}/examples/5/checker`]: { status: 409, body: { error: 'Worca is already checking this criterion.' } },
    [`POST ${B}/examples/4/checker`]: { status: 201, body: { round: { id: 9, status: 'making' } } },
    [`GET ${B}/examples/4/checker/9`]: { status: 200, body: { round: { id: 9, criterionId: 'k_4', status: 'making' }, exampleName: 'E4', criterion: 'Proposes a test within 4 weeks',
      cards: [], left: 0, auto: { same: { n: 0, of: 0 }, padding: { n: 0, of: 0 }, proof: { n: 0, of: 0 } }, costUsd: 0, canUse: false } },
  });
  const ctl = createWorkflowTests({ doc: h.doc, win: h.win, fetch: h.fetch, safeJson: (r) => r.json(), composer: () => ({ template: () => ({ id: 'wf_a' }) }),
    api: {}, versions: () => ({ showPage: () => ctl.enterList() }), currentView: () => 'workflows', confirmModal: async () => true, openNewPipeline: () => {},
    hdMarkdown: {}, mock: () => false, runPageShows: () => false });
  ctl.route('wf_a', 'tests/trust', true);
  await settle();
  assert.equal(h.win.location.hash, '#workflows/wf_a/tests/trust');
  assert.equal(h.root.querySelector('.wft-title').textContent, "How reliable is Worca's checking?");
  // fix round 1: the workflow-tests-changed frame repaints the report
  report = trustReportModel({ criteria: [crit(4, 'Proposes a test within 4 weeks', { state: 'reliable', n: 10, agree: 9 })] });
  ctl.changed({ workflowId: 'wf_a', testRunId: 3 });
  await settle();
  assert.equal(h.root.querySelector('.wft-tr-todo'), null, 'read again: nothing left to do');
  assert.equal(h.calls.filter(([m, p]) => m === 'GET' && p === `${B}/trust`).length, 2);
  report = trustReportModel({ criteria: [crit(4, 'Proposes a test within 4 weeks', { state: 'unreliable', n: 10, agree: 6 }),
    crit(5, 'Explains the legal reason', { state: 'confirm', n: 0, agree: 0 })] });
  ctl.changed({ workflowId: 'wf_a', testRunId: 3 });
  await settle();
  h.root.querySelector('button.wft-tr-confirm').click();   // Confirm 4 results starts Check the checker of that criterion
  await settle();
  assert.deepEqual(h.calls.filter(([m]) => m === 'POST').map(([, p, b]) => [p, b]), [[`${B}/examples/5/checker`, { criterionId: 'k_5' }]]);
  assert.equal(h.win.location.hash, '#workflows/wf_a/tests/trust', 'refused (409): the report stays');
  btnByText(h.root, 'Tests').click();
  await settle();
  assert.equal(h.win.location.hash, '#workflows/wf_a/tests');
  h.root.querySelector('.wft-trust-card').click();
  await settle();
  assert.equal(h.win.location.hash, '#workflows/wf_a/tests/trust');
  h.root.querySelector('button.wft-tr-fix').click();
  await settle();
  assert.deepEqual(h.calls.filter(([m]) => m === 'POST').map(([, p, b]) => [p, b]).at(-1), [`${B}/examples/4/checker`, { criterionId: 'k_4' }]);
  assert.equal(h.win.location.hash, '#workflows/wf_a/tests/4/checker/9');
  assert.equal(h.root.querySelector('.wft-cc-crit').textContent, 'Proposes a test within 4 weeks');
});

test("tests-app.mjs wires Compare's By criterion link \"How Worca tests its own checking\" to the report", () => {
  const ctl = readFileSync(new URL('../ui/public/workflows/tests-app.mjs', import.meta.url), 'utf8');
  assert.match(ctl, /trust: \(\) => wftShow\('trust'\)/);
  assert.match(ctl, /openTrust: \(\) => wftShow\('trust'\)/);
});

test("final review M12: Check the checker opened from the report goes Back to the report; its crumb still opens the example", async () => {
  const { createWorkflowTests } = await import('../ui/public/workflows/tests-app.mjs');
  const { NO_SOURCE_TEXT } = await import('../src/shared/workflow-tests/criteria-text.mjs');
  const B = '/api/workflows/wf_a/tests';
  const report = trustReportModel({ criteria: [crit(4, 'Proposes a test within 4 weeks', { state: 'unreliable', n: 10, agree: 6 })] });
  const h = harness({
    [`GET ${B}/trust`]: { status: 200, body: report },
    [`POST ${B}/examples/4/checker`]: { status: 422, body: { error: NO_SOURCE_TEXT } },
  });
  const ctl = createWorkflowTests({ doc: h.doc, win: h.win, fetch: h.fetch, safeJson: (r) => r.json(), composer: () => ({ template: () => ({ id: 'wf_a' }) }),
    api: {}, versions: () => ({ showPage: () => ctl.enterList() }), currentView: () => 'workflows', confirmModal: async () => true, openNewPipeline: () => {},
    hdMarkdown: {}, mock: () => false, runPageShows: () => false });
  ctl.route('wf_a', 'tests/trust', true);
  await settle();
  h.root.querySelector('button.wft-tr-fix').click();
  await settle();
  assert.equal(h.root.querySelector('.wft-cc-state h2').textContent, 'Worca needs a good result first');
  btnByText(h.root, 'Back').click();
  await settle();
  assert.equal(h.win.location.hash, '#workflows/wf_a/tests/trust', 'back where it was opened');
  assert.equal(h.root.querySelector('.wft-title').textContent, "How reliable is Worca's checking?");
  h.root.querySelector('button.wft-tr-fix').click();
  await settle();
  btnByText(h.root, 'Example: E4').click();
  await settle();
  assert.ok(h.calls.some(([m, p]) => m === 'GET' && p === `${B}/examples/4`), 'the crumb names the example and opens it');
});
