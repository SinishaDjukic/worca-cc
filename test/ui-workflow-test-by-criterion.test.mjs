// test/ui-workflow-test-by-criterion.test.mjs — board 12: one row per criterion, coloured when it changed and decides; board 5: the
// "By example · By criterion" tabs and the "Worca's checking" line in Compare.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { renderByCriterion } from '../ui/public/workflows/criteria-pages.mjs';
import { renderCompare } from '../ui/public/workflows/test-compare.mjs';
import { compareModel } from '../src/shared/workflow-tests/compare.mjs';

const R = { state: 'reliable', n: 20, agree: 19, decides: true };
const data = { counts: { total: 3, reliable: 2, unreliable: 1, waiting: 0 }, more: 4, checking: false, rows: [
  { key: '1|k', label: 'Names a success metric', exampleName: 'Bulk invoice export', exact: false, trust: R, a: { met: 3, of: 3 }, b: { met: 1, of: 3 }, changed: 'worse', unreliableChange: false },
  { key: '2|k', label: 'Proposes a test within 4 weeks', exampleName: 'Pricing page A/B test', exact: false, trust: { state: 'unreliable', n: 10, agree: 6, decides: false },
    a: { met: 3, of: 3 }, b: { met: 3, of: 3 }, changed: null, unreliableChange: false },
  { key: '1|c', label: "Mentions that today's export stops at 200 invoices", exampleName: 'Bulk invoice export', exact: true, trust: { state: 'exact', decides: true },
    a: { met: 3, of: 3 }, b: { met: 2, of: 3 }, changed: null, unreliableChange: false },
] };

test('the legend, the rows with their example, counts and trust, and the collapsed line', () => {
  const { document: doc } = new JSDOM('<!doctype html><div id="r"></div>').window;
  const root = doc.getElementById('r');
  renderByCriterion(root, data, { doc, labels: { a: 'v4', b: 'v5' } });
  assert.match(root.textContent, /Can you trust Worca's checking of each criterion\?/);
  assert.deepEqual([...root.querySelectorAll('.wft-bc-legend-grid > div')].map((d) => d.textContent), [
    'ReliableWorca agrees with people almost every time and catches the mistakes planted on purpose.',
    'Confirm 4 resultsNew criterion. It counts, but you have not confirmed that Worca judges it right.',
    'UnreliableAfter at least 10 answers, Worca often judges differently from people. It still runs and is shown, but does not decide better or worse until you fix it.',
  ]);
  assert.deepEqual([...root.querySelectorAll('.wft-bc-row.is-head > span')].map((x) => x.textContent), ['Criterion', 'v4 met', 'v5 met', "Worca's checking"]);
  const rows = [...root.querySelectorAll('.wft-bc-row:not(.is-head):not(.is-more)')];
  assert.equal(rows[0].querySelector('b').textContent, 'Names a success metric');
  assert.equal(rows[0].querySelector('.wft-bc-ex').textContent, 'Bulk invoice export');
  assert.ok(rows[0].classList.contains('is-worse'));
  assert.deepEqual([...rows[0].querySelectorAll('.wft-bc-n')].map((x) => x.textContent), ['3 of 3', '1 of 3']);
  assert.match(rows[0].textContent, /Reliable[\s\S]*Agrees with people 19 of 20 times/, 'board 12: "Agrees with people", the column says whose');
  assert.match(rows[1].textContent, /Unreliable[\s\S]*Agrees with people 6 of 10 times/);
  assert.match(rows[2].textContent, /Can be checked exactly/);
  assert.equal(rows[2].querySelector('.wft-exact').textContent, 'Can be checked exactly');
  assert.equal(rows[2].querySelector('.badge').textContent, 'Reliable');
  assert.equal(root.querySelector('.wft-bc-more').textContent, '4 more criteria, all met in every try by both versions');
  assert.equal(root.querySelector('.wft-bc-foot').textContent,
    'Rows with a coloured background changed between the versions. If a change shows only in unreliable criteria, Compare says so instead of calling it better or worse.');
});

test('one version (Try it once): no "<A> met" column; one more criterion says "criterion"', () => {
  const { document: doc } = new JSDOM('<!doctype html><div id="r"></div>').window;
  const root = doc.getElementById('r');
  renderByCriterion(root, { ...data, more: 1, rows: [{ ...data.rows[1], a: null }] }, { doc, labels: { a: null, b: 'your draft' } });
  assert.deepEqual([...root.querySelectorAll('.wft-bc-row.is-head > span')].map((x) => x.textContent), ['Criterion', 'your draft met', "Worca's checking"]);
  assert.ok(root.querySelector('.wft-bc-rows').classList.contains('is-one'));
  assert.equal(root.querySelector('.wft-bc-more').textContent, '1 more criterion, all met in every try', 'fix round 1: one version, so no "by both versions"');
  renderByCriterion(root, { ...data, more: 4, rows: [] }, { doc, labels: { a: null, b: 'your draft' } });
  assert.equal(root.querySelector('.wft-bc-more').textContent, '4 more criteria, all met in every try');
});

const v = { passed: true, basics: [], checks: [], facts: { durationMs: 60000, sentBack: 0 } };
const tries = [{ id: 1, side: 'a', exampleId: 1, status: 'passed', costUsd: 1, verdict: v }, { id: 2, side: 'b', exampleId: 1, status: 'passed', costUsd: 1, verdict: v }];
const cmp = (over = {}) => ({ run: { id: 7, kind: 'compare', a: 4, b: 'draft', tries: 1, status: 'done', finishedAt: '2026-10-26T10:00:00Z', capUsd: 15, exampleIds: [1] },
  title: 'Your v5 draft compared with v4', labels: { a: 'v4', b: 'v5 draft' }, examples: 1, costUsd: 2,
  model: compareModel({ examples: [{ id: 1, name: 'Bulk invoice export' }], a: { label: 'v4' }, b: { label: 'v5 draft' }, tries }),
  changes: [], fair: [], criteria: { ...data, counts: { total: 12, reliable: 10, unreliable: 1, waiting: 1 } }, ...over });
const NOW = Date.parse('2026-10-26T12:00:00Z');
const click = (n) => n.dispatchEvent(new n.ownerDocument.defaultView.MouseEvent('click', { bubbles: true }));
const key = (n, k) => n.dispatchEvent(new n.ownerDocument.defaultView.KeyboardEvent('keydown', { key: k, bubbles: true }));

test('board 5: with criteria, the tabs and the line; By criterion paints full width, and stays on a repaint; without, the heading as before', () => {
  const { window } = new JSDOM('<!doctype html><div id="r"></div>');
  const doc = window.document;
  const root = doc.getElementById('r');
  const actions = { back() {}, testAgain() {}, open() {}, tryMore() {} };
  renderCompare(root, cmp(), actions, { doc, now: NOW });
  const tabs = () => [...root.querySelectorAll('.wft-by-tabs [role="tab"]')];
  assert.equal(root.querySelector('.wft-by-tabs').getAttribute('aria-label'), 'Show results');
  assert.deepEqual(tabs().map((t) => [t.textContent, t.getAttribute('aria-selected')]), [['By example', 'true'], ['By criterion', 'false']]);
  assert.equal(root.querySelector('.wft-by-title'), null, 'the tabs name the view');
  const line = root.querySelector('.wft-changes .wft-check-line');
  assert.equal(line.querySelector('b').textContent, "Worca's checking");
  assert.equal(line.textContent,
    "Worca's checking is reliable for 10 of 12 criteria. 1 unreliable criterion is shown, but does not decide better or worse. See by criterion");
  tabs()[1].focus();   // a browser focuses a clicked button; jsdom does not
  click(tabs()[1]);
  const shown = () => [root.querySelector('.wft-by-crit').hidden, root.querySelector('.wft-by .wft-table').hidden,
    root.querySelector('.wft-tiles').hidden, root.querySelector('.wft-changes').hidden];
  assert.deepEqual(shown(), [false, true, true, true], 'board 12: the criteria take the page under the tabs');
  assert.match(root.querySelector('.wft-by-crit').textContent, /Can you trust Worca's checking of each criterion\?/);
  assert.equal(root.querySelectorAll('.wft-by-crit .wft-bc-row:not(.is-head):not(.is-more)').length, 3);
  assert.equal(doc.activeElement, tabs()[1]);
  renderCompare(root, cmp(), actions, { doc, now: NOW });   // a frame repaints the page
  assert.deepEqual(tabs().map((t) => t.getAttribute('aria-selected')), ['false', 'true'], 'a repaint keeps By criterion');
  assert.deepEqual(shown(), [false, true, true, true]);
  assert.equal(doc.activeElement, tabs()[1], 'and the focus');
  key(tabs()[1], 'ArrowLeft');
  assert.deepEqual(tabs().map((t) => t.getAttribute('aria-selected')), ['true', 'false']);
  assert.deepEqual(shown(), [true, false, false, false]);
  assert.equal(doc.activeElement, tabs()[0]);
  click(root.querySelector('.wft-check-line button'));   // See by criterion
  assert.deepEqual(tabs().map((t) => t.getAttribute('aria-selected')), ['false', 'true']);
  assert.equal(doc.activeElement, tabs()[1]);
  renderCompare(root, { ...cmp(), run: { ...cmp().run, id: 8 } }, actions, { doc, now: NOW });
  assert.deepEqual(tabs().map((t) => t.getAttribute('aria-selected')), ['true', 'false'], 'another test opens on By example');

  const plain = doc.createElement('div');
  renderCompare(plain, cmp({ criteria: null }), actions, { doc, now: NOW });
  assert.equal(plain.querySelector('.wft-by-tabs'), null);
  assert.equal(plain.querySelector('.wft-check-line'), null);
  assert.equal(plain.querySelector('.wft-by-title').textContent, 'By example', 'G9: one view keeps its heading');
  const none = doc.createElement('div');
  renderCompare(none, cmp({ criteria: { ...data, counts: { total: 0, reliable: 0, unreliable: 0, waiting: 0 }, rows: [], more: 0 } }), actions, { doc, now: NOW });
  assert.equal(none.querySelector('.wft-by-tabs'), null, 'no criteria: no tabs');
});

// P4-M5 (approved): the states of the criteria lines in Compare, By criterion's not-checked rows, and the progress line.
test('P4-M5 By criterion: "—" when a side has no checked try; a new criterion is "Not checked yet", added after this test', () => {
  const { document: doc } = new JSDOM('<!doctype html><div id="r"></div>').window;
  const root = doc.getElementById('r');
  renderByCriterion(root, { ...data, more: 0, rows: [
    { key: '1|k:5', label: 'Says who may export, and why', exampleName: 'Bulk invoice export', exact: false, trust: { state: 'collecting', n: 3, agree: 3, decides: false },
      a: { met: 0, of: 0 }, b: { met: 2, of: 3 }, changed: null, unreliableChange: false, uneven: true, reason: 'unchecked' },
    { key: '3|k:6', label: 'Names who asked for the feature', exampleName: 'A feature we already have', exact: false, trust: { state: 'confirm', n: 0, agree: 0, decides: true },
      a: { met: 0, of: 0 }, b: { met: 0, of: 0 }, changed: null, unreliableChange: false, uneven: true, reason: 'new' },
  ] }, { doc, labels: { a: 'v4', b: 'v5' } });
  const rows = [...root.querySelectorAll('.wft-bc-row:not(.is-head)')];
  const cells = (r) => [...r.querySelectorAll('.wft-bc-n')].map((x) => [x.textContent, x.getAttribute('aria-label')]);
  assert.deepEqual(cells(rows[0]), [['—', 'No checked try'], ['2 of 3', null]]);
  assert.deepEqual([rows[0].querySelector('.badge').textContent, rows[0].querySelector('small').textContent],
    ['Needs your answers', 'Not checked on every try, so it does not decide yet']);
  assert.deepEqual(cells(rows[1]), [['Not checked yet', null], ['Not checked yet', null]]);
  assert.deepEqual([rows[1].querySelector('.badge').textContent, rows[1].querySelector('small').textContent], ['Confirm 4 results', 'Added after this test']);
});

const NEW = { id: 3, name: 'A feature we already have', reason: 'new', criteria: ['Names who asked for the feature'] };
const UNCHECKED = { id: 1, name: 'Bulk invoice export', reason: 'unchecked', criteria: ['Names a success metric'] };
const notes = (over = {}) => ({ unreliableOnly: [], notChecked: [NEW, UNCHECKED], ...over });
function bootCmp(c) {
  const { window } = new JSDOM('<!doctype html><div id="r"></div>');
  const doc = window.document;
  const root = doc.getElementById('r');
  const calls = [];
  const actions = { back() {}, testAgain: () => calls.push('testAgain'), open() {}, tryMore() {}, checkCriteria: () => calls.push('checkCriteria') };
  renderCompare(root, c, actions, { doc, now: NOW });
  return { root, calls, again: (d) => renderCompare(root, d, actions, { doc, now: NOW }) };
}

test('P4-M5 Compare: criteria changed after the test, with the price of checking them; the line for criteria not checked on every try', () => {
  const { root, calls } = bootCmp(cmp({ notes: notes(), criteria: { ...cmp().criteria, checkUsd: 0.4 } }));
  const band = root.querySelector('.wft-crit-band');
  assert.equal(band.querySelector('.wft-crit-band-l').textContent,
    'Your criteria changed after this test. New criteria show as "Not checked yet" until Worca checks them on these tries.');
  const price = band.querySelector('button');
  assert.equal(price.textContent, 'Check them on these tries (about $0.40)');
  assert.equal(price.querySelector('.code').textContent, '$0.40');
  click(price);
  const fair = [...root.querySelectorAll('.wft-changes .wft-fair')].at(-1);
  assert.equal(fair.textContent, 'Not checked on every try, so it does not decide yet: "Names a success metric" in Bulk invoice export. Check them on these tries');
  click(fair.querySelector('button'));
  assert.deepEqual(calls, ['checkCriteria', 'checkCriteria']);
  const order = [...root.querySelector('.wft-changes').children].map((n) => n.className);
  assert.ok(order.indexOf('wft-fair') < order.indexOf('hint wft-check-line'), "the fair lines, then Worca's checking (board P4-M5)");
  assert.ok(root.querySelector('.wft-crit-band').compareDocumentPosition(root.querySelector('.wft-tiles')) & 4, 'the band is above the tiles');

  const unknown = bootCmp(cmp({ notes: notes({ notChecked: [NEW] }), criteria: { ...cmp().criteria, checkUsd: null } }));
  assert.equal(unknown.root.querySelector('.wft-crit-band button').textContent, 'Check them on these tries (cost not known yet)');
  assert.equal(unknown.root.querySelector('.wft-changes .wft-fair'), null);
  const none = bootCmp(cmp({ notes: notes({ notChecked: [] }) }));
  assert.equal(none.root.querySelector('.wft-crit-band'), null);
});

test('P4-M5 Compare: while Worca checks, the band says so and nothing starts; when it ends, it says it checked', () => {
  const c = cmp({ notes: notes(), criteria: { ...cmp().criteria, checkUsd: 0.4, checking: true } });
  const { root, again } = bootCmp(c);
  const band = root.querySelector('.wft-crit-band');
  assert.equal(band.getAttribute('role'), 'status');
  assert.equal(band.textContent, 'Worca is checking your criteria on these tries. A test can start when it is done.', 'board 59 C: the band words it draws (board 58)');
  assert.equal([...root.querySelectorAll('button')].filter((b) => /Check them/.test(b.textContent)).length, 0, 'no second check');
  assert.equal([...root.querySelectorAll('.wft-acts button')].find((b) => b.textContent === 'Test again').disabled, true);
  again(cmp({ notes: notes({ notChecked: [] }), criteria: { ...cmp().criteria, checkUsd: 0 } }));
  assert.equal(root.querySelector('.wft-crit-band').textContent, 'Worca checked your criteria on these tries.');
  assert.equal(root.querySelector('.wft-crit-band').getAttribute('role'), 'status');
  again(cmp({ notes: notes({ notChecked: [] }), criteria: { ...cmp().criteria, checkUsd: 0 } }));
  assert.equal(root.querySelector('.wft-crit-band').textContent, 'Worca checked your criteria on these tries.', 'a later frame keeps it');
  again({ ...cmp({ notes: notes({ notChecked: [] }) }), run: { ...cmp().run, id: 8 } });
  assert.equal(root.querySelector('.wft-crit-band'), null, 'another test: no such line');
});

test('P4-M5 Compare: a test at its own cost limit checks nothing more: Test again instead of the check', () => {
  const { root, calls } = bootCmp(cmp({ notes: notes(), costUsd: 15, criteria: { ...cmp().criteria, checkUsd: 0.4 } }));
  const band = root.querySelector('.wft-crit-band');
  assert.equal(band.querySelector('.wft-crit-band-l').textContent, 'This test reached its cost limit, so Worca checks nothing more on it. Test again to check your criteria.');
  assert.equal([...root.querySelectorAll('button')].filter((b) => /Check them/.test(b.textContent)).length, 0);
  assert.match(root.querySelector('.wft-changes').textContent, /Not checked on every try, so it does not decide yet: "Names a success metric" in Bulk invoice export\./,
    'the criteria not checked are still said (the run can end done although its criteria phase stopped)');
  click(band.querySelector('button'));
  assert.deepEqual(calls, ['testAgain']);
});

test("P4-M5 Compare: a change only in unreliable criteria, in In short and the example's row; the cost of some checks is not known", () => {
  const rows = [{ ...data.rows[1], key: '1|k:2', exampleName: 'Bulk invoice export', unreliableChange: true }];
  const { root } = bootCmp(cmp({ costUnknown: true, notes: notes({ notChecked: [], unreliableOnly: [{ id: 1, name: 'Bulk invoice export' }] }),
    criteria: { ...cmp().criteria, rows } }));
  assert.equal(root.querySelector('.wft-titles .hint').textContent, '1 example, 1 try each · ready 2 hours ago · cost $2.00 · the cost of some checks is not known');
  assert.match(root.querySelector('.wft-short p').textContent,
    /v5 draft differs from v4 on 1 example only in a criterion Worca cannot judge reliably yet: Bulk invoice export\.$/);
  assert.equal(root.querySelector('.wft-crow2:not(.is-head) .wft-why').textContent,
    'Differs only in "Proposes a test within 4 weeks", which Worca cannot judge reliably yet');
});

test('P4-M5 progress: after the last try, the line while Worca checks the criteria of earlier tries', async () => {
  const { renderTestProgress } = await import('../ui/public/workflows/test-progress.mjs');
  const { window } = new JSDOM('<!doctype html><div id="r"></div>');
  const doc = window.document;
  const root = doc.getElementById('r');
  const p = { run: { id: 9, kind: 'compare', a: 4, b: 'draft', tries: 3, status: 'running', stopReason: null, stopDetail: null, exampleIds: [1] }, title: 'T',
    rows: [{ exampleId: 1, name: 'Bulk invoice export', label: null, dots: ['passed'], summary: 'Done' }], done: 18, total: 18, costUsd: 1, estimateUsd: 2, capUsd: 15,
    minutesLeft: null, quick: null, criteriaPhase: { done: 7, of: 12 } };
  const actions = { back() {}, stop() {}, continue() {}, open() {} };
  renderTestProgress(root, p, actions, { doc });
  const line = root.querySelector('.wft-crit-phase');
  assert.equal(line.getAttribute('role'), 'status');
  assert.deepEqual([line.querySelector('b').textContent, line.querySelector('.hint').textContent], ['Checking your criteria on earlier tries', '7 of 12 tries']);
  renderTestProgress(root, { ...p, criteriaPhase: null }, actions, { doc });
  assert.equal(root.querySelector('.wft-crit-phase'), null);
  renderTestProgress(root, { ...p, criteriaPhase: { done: 0, of: 0 } }, actions, { doc });
  assert.equal(root.querySelector('.wft-crit-phase'), null, 'fix round 1: no earlier try to check, no line');
});

test('fix round 1: while Worca checks, Try 3 more is disabled as Test again is; the green band only once every criterion is checked', () => {
  const t = (id, side, status) => ({ id, side, exampleId: 1, status, costUsd: 1, verdict: { ...v, passed: status === 'passed' } });
  const luck = [t(1, 'a', 'passed'), t(2, 'a', 'passed'), t(3, 'a', 'failed'), t(4, 'b', 'passed'), t(5, 'b', 'passed'), t(6, 'b', 'passed')];
  const model = compareModel({ examples: [{ id: 1, name: 'Bulk invoice export' }], a: { label: 'v4' }, b: { label: 'v5 draft' }, tries: luck });
  const at = (over) => cmp({ model, run: { ...cmp().run, tries: 3 }, ...over });
  const { root, again } = bootCmp(at({ notes: notes(), criteria: { ...cmp().criteria, checkUsd: 0.4, checking: true } }));
  const more = () => [...root.querySelectorAll('.wft-why button')].find((b) => b.textContent === 'Try 3 more');
  assert.equal(more().disabled, true, 'no test of the workflow starts while Worca checks');
  again(at({ notes: notes({ notChecked: [UNCHECKED] }), criteria: { ...cmp().criteria, checkUsd: 0.1 } }));
  assert.equal(more().disabled, false, 'the check is over');
  assert.equal(root.querySelector('.wft-crit-band'), null, 'a criterion is still not checked on every try: no "Worca checked your criteria"');
  assert.match(root.querySelector('.wft-changes').textContent, /Not checked on every try, so it does not decide yet/);
  again(at({ notes: notes({ notChecked: [] }), criteria: { ...cmp().criteria, checkUsd: 0 } }));
  assert.equal(root.querySelector('.wft-crit-band').textContent, 'Worca checked your criteria on these tries.');
});

test('tests-app.mjs (P4-Q15): Check them on these tries posts the check, repaints, and reads again every 2 s while Worca checks', async () => {
  const { readFileSync } = await import('node:fs');
  const ctl = readFileSync(new URL('../ui/public/workflows/tests-app.mjs', import.meta.url), 'utf8');
  assert.ok(/checkCriteria: async \(\) => \{[\s\S]*?wftCall\('POST', `\$\{wftBase\(id\)\}\/runs\/\$\{run\.id\}\/criteria\/check`, \{\}\)/.test(ctl));
  assert.ok(/function wftPollCriteria\(id, runId\) \{[\s\S]*?r\.ok && r\.data\.checking\) \{ win\.setTimeout\(tick, 2000\); return; \}/.test(ctl));
});
