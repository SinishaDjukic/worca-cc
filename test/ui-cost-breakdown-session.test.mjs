// test/ui-cost-breakdown-session.test.mjs — hand-off overhead is shown apart from, never instead of, the steps.
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { runCostBreakdown } from '../src/shared/cost/breakdown.mjs';
import { costBreakdownEl } from '../ui/public/cost-breakdown.mjs';
import { decorFromState } from '../ui/public/graph/run-decor.mjs';
import { mountRunGraph } from '../ui/public/graph/run-hosts.mjs';
import { groupedRunningState } from './helpers/session-run-state.mjs';
import { useDomRelease } from './helpers/jsdom-release.mjs';

const steps = [{ key: 'x:n_impl:1', costUsd: 1.73, auxCosts: { session: { usd: 0.03, calls: 3 } } }, { key: 'x:n_review:1', costUsd: 0.68, auxCosts: { session: { usd: 0.03, calls: 2 } } }];

test('one aux line, the agents line excludes it, the total is untouched', () => {
  const b = runCostBreakdown(steps, 2.41);
  assert.deepEqual(b.lines.map((l) => [l.kind, l.label, l.calls]), [['session', 'Session hand-offs', 5]]);
  assert.ok(Math.abs(b.agents - 2.35) < 1e-9);
  assert.equal(b.total, 2.41);
});

// Deviation (correction 8): the master matched /Session hand-offs[\s\S]*5 hand-offs[\s\S]*\$0\.06/, but every row of the
// panel is label · value · note, so the figure comes BEFORE the count; the row's own cells are asserted instead.
test('the breakdown panel renders the row', () => {
  const doc = new JSDOM('<!doctype html><body></body>').window.document;
  const el = costBreakdownEl(doc, runCostBreakdown(steps, 2.41), { fmtUsd: (n) => `$${n.toFixed(2)}` });   // ui/public/cost-breakdown.mjs:32
  const row = el.querySelector('.cost-bd-row[data-kind="session"]');
  assert.deepEqual([...row.children].map((c) => c.textContent), ['Session hand-offs', '$0.06', '5 hand-offs · main agent\'s own share']);
});

// ── v2: an engine without cost, the member card's tooltip, and what a plain card keeps ──
const trackDom = useDomRelease(afterEach);
const fmt = (n) => `$${n.toFixed(2)}`;

// v4: Copilot books no hand-off at all (costSource 'none', so no row). The row meets an engine without cost when a run's
// Claude turns booked hand-offs and the run was resumed on Cursor or Copilot: the panel then knows no agent cost.
test('v2 — hand-offs booked, then the run resumed on an engine without cost: the row keeps its count and reads "—", never a figure (the mock\'s tile)', () => {
  const doc = new JSDOM('<!doctype html><body></body>').window.document;
  const resumed = [{ key: 'x:n_impl:1', costUsd: 0.9, auxCosts: { session: { usd: 0.03, calls: 3 } } }];
  const el = costBreakdownEl(doc, runCostBreakdown(resumed, 0.9), { fmtUsd: fmt, agentsUnknown: true });
  const row = el.querySelector('.cost-bd-row[data-kind="session"]');
  assert.deepEqual([...row.children].map((c) => c.textContent), ['Session hand-offs', '—', '3 hand-offs · main agent\'s own share']);
  const one = costBreakdownEl(doc, runCostBreakdown([{ key: 'k', costUsd: 0.5, auxCosts: { session: { usd: 0.01, calls: 1 } } }], 0.5), { fmtUsd: fmt });
  assert.equal(one.querySelector('[data-kind="session"] .cost-bd-n').textContent, '1 hand-off · main agent\'s own share');
  const away = costBreakdownEl(doc, runCostBreakdown([{ key: 'k', costUsd: 0.5, auxCosts: { away: { usd: 0.1, calls: 2 } } }], 0.5), { fmtUsd: fmt, agentsUnknown: true });
  assert.deepEqual([...away.querySelector('[data-kind="away"]').children].map((c) => c.textContent), ['Away mode', '$0.10', '2 reviews'], 'other aux lines are worca\'s own calls: unchanged');
});

const hand = (usd, calls) => ({ auxCosts: { session: { usd, calls } } });
function memberState(engine = 'claude') {
  const st = groupedRunningState();
  st.runEngine = engine;
  st.steps = st.steps.map((r) => (r.nodeId === 'n_impl' ? { ...r, ...hand(0.02, 1) } : r.nodeId === 'n_review' ? { ...r, ...hand(0.01, 1) } : r));
  st.steps.push({ key: 'x:n_review:2', executionId: 'x:n_review:2', nodeId: 'n_review', ordinal: 2, cycle: 2, status: 'done', activeMs: 1000, costUsd: 0.4, ...hand(0.03, 2) });
  return st;
}

test('v2 — a member card\'s cost tooltip names its hand-offs; one call is singular; a plain card and an unpriced engine get no title', () => {
  const d = decorFromState(memberState(), { live: true, now: 0, sessionVerified: { claude: true } });
  assert.equal(d.totals.n_impl.title, 'incl. $0.02 session hand-off');
  assert.equal(d.totals.n_review.title, 'incl. $0.04 session hand-offs', 'Σ over the member\'s rows (3 calls)');
  assert.equal('title' in d.totals.n_plan, false, 'a card outside the session keeps its shape');
  const cursor = decorFromState(memberState('cursor'), { live: true, now: 0, sessionVerified: { claude: true } });
  assert.equal('title' in cursor.totals.n_impl, false, 'no cost shown, no hand-off figure');
  const zero = memberState();
  zero.steps = zero.steps.map((r) => (r.nodeId === 'n_impl' ? { ...r, auxCosts: { session: { usd: 0, calls: 0 } } } : r));
  assert.equal('title' in decorFromState(zero, { live: true, now: 0 }).totals.n_impl, false, 'no hand-off booked: no title');
});

test('v2 — the monitor paints the tooltip on the card\'s cost, and clears it', () => {
  const dom = trackDom(new JSDOM('<!doctype html><body><div class="run-flow-wrap"><div id="h"></div></div></body>'));
  const doc = dom.window.document;
  const st = memberState();
  const m = mountRunGraph(doc.getElementById('h'), { doc, mode: 'monitor', raf: (fn) => { fn(); return 1; } });
  m.update('run1', st.stepper, { ...decorFromState(st, { live: true, now: 0 }), detail: true });
  const cost = (id) => doc.querySelector(`.node[data-node-id="${id}"] .nrun .cost`);
  assert.equal(cost('n_impl').title, 'incl. $0.02 session hand-off');
  assert.equal(cost('n_plan').hasAttribute('title'), false, 'a plain card gets no title attribute');
  const more = memberState();
  more.steps = more.steps.map((x) => (x.nodeId === 'n_impl' ? { ...x, ...hand(0.02, 2) } : x));
  m.update('run1', more.stepper, { ...decorFromState(more, { live: true, now: 0 }), detail: true });
  assert.equal(cost('n_impl').title, 'incl. $0.02 session hand-offs', 'v4: a second $0 hand-off changes the words, not the cost: the title follows');
  const plain = groupedRunningState();
  m.update('run1', plain.stepper, { ...decorFromState(plain, { live: true, now: 0 }), detail: true });
  assert.equal(cost('n_impl').hasAttribute('title'), false, 'a frame without hand-offs removes it: the card is a plain card again');
});
