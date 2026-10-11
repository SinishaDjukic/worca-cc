// test/ui-cost-breakdown.test.mjs — the run cost broken into agents, Away mode, Auto workflow and the
// run title: the header cost's panel, the glance tile and the Overview cost card, on the run page and
// on the History run page. History boot + fixtures: helpers/history-detail-boot.mjs (its generic boot()
// also drives the run page through the socket it captures).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { boot, settle, go, bootDetail, openDetail, DETAIL, PROJECT, secOf, click } from './helpers/history-detail-boot.mjs';
import { runCostBreakdown } from '../src/shared/cost/breakdown.mjs';
import { costBreakdownEl, costSummaryText, awayTotalText } from '../ui/public/cost-breakdown.mjs';
import { checkRows } from './helpers/rows.mjs';

// Task 6's fixture: $3.3319 in all, $0.12 of it two Away mode reviews; one more review stopped (≥$0.0234)
// and two agent turns a pause cut off (≥$0.31) — both lower bounds, apart from every total.
const STEPS = () => ([
  { key: 'x:preflight:1', executionId: 'x:preflight:1', nodeId: 'preflight', status: 'done', costUsd: 0.0419,
    auxCosts: { auto: { usd: 0.0398, calls: 1 }, title: { usd: 0.0021, calls: 1 } } },
  { key: 'n_plan:1', executionId: 'n_plan:1', nodeId: 'n_plan', status: 'done', costUsd: 0.67, auxCosts: { away: { usd: 0.05, calls: 1 } } },
  { key: 'n_impl:1', executionId: 'n_impl:1', nodeId: 'n_impl', status: 'done', costUsd: 1.91,
    auxCosts: { away: { usd: 0.07, calls: 1, floorUsd: 0.0234, stopped: 1 } } },
  { key: 'n_impl:2', executionId: 'n_impl:2', nodeId: 'n_impl', status: 'start', costUsd: 0.71,
    stoppedTurns: { turns: 2, tokens: 21000, floorUsd: 0.31 } },
]);
const OLD_STEPS = () => STEPS().map(({ auxCosts, stoppedTurns, ...s }) => s);   // a run from before the shares were kept
const TOTAL = 3.3319;

/** [label, value, note] per panel row, in order. */
const panelRows = (pop) => [...pop.querySelectorAll('.cost-bd-row')].map((r) => [
  r.querySelector('.cost-bd-l').textContent, r.querySelector('.cost-bd-v').textContent, r.querySelector('.cost-bd-n')?.textContent ?? '']);
const EXPECTED_ROWS = [
  ['Agents', '$3.17', ''],
  ['Away mode', '$0.12', '2 reviews'],
  ['Auto workflow', '$0.04', '1 call'],
  ['Run title', '<$0.01', '1 call'],
  ['Total', '$3.33', ''],
  ['Stopped reviews', '≥$0.02', '1 review · not in total'],
  ['Stopped agent turns', '≥$0.31', '2 turns · not in total'],
];
const glanceCost = (scope) => {
  const tile = [...scope.querySelectorAll('.rd-facts .rd-stats > div')].find((t) => /\$/.test(t.querySelector('b').textContent));
  return tile ? [tile.querySelector('b').textContent, tile.querySelector('span').textContent] : null;
};

// --- the run page: boot, hello, one run; frames through the socket the boot captured ---------------
async function bootRun({ steps = STEPS(), total = TOTAL, hash = 'running/r1/details/overview' } = {}) {
  const ctx = await boot({ fetchHandler: (url) => (url.endsWith('/api/history') ? Promise.resolve({ ok: true, status: 200, json: async () => ({ pipelines: [], ghAvailable: false }) }) : null) });
  const ws = ctx.wsBox.ws;
  ws.dispatch('open', {});
  ctx.frame = (msg) => ws.dispatch('message', { data: JSON.stringify(msg) });
  ctx.frame({ type: 'hello', runs: [] });
  await settle(ctx.window, 4);
  ctx.frame({ type: 'run-created', runId: 'r1', title: 'Rate limit uploads', projectDir: PROJECT, status: 'running', startedAt: '2026-08-19T10:00:00Z', kind: 'run' });
  ctx.frame({ type: 'state', runId: 'r1', id: 'p1', status: 'running', steps, subAgents: [], totalCostUsd: total });
  go(ctx.window, hash);
  await settle(ctx.window, 6);
  ctx.rd = ctx.window.document.querySelector('#run-detail .rd');
  return ctx;
}

test('the panel body: Agents, one row per booked share, Total, then the stopped reviews and cut agent turns apart', () => {
  const { window } = new JSDOM('<!doctype html><body></body>');
  const fmt = (n) => (n > 0 && n < 0.01 ? '<$0.01' : `$${n.toFixed(2)}`);
  const panel = (steps, total) => costBreakdownEl(window.document, runCostBreakdown(steps, total), { fmtUsd: fmt });
  const el = panel(STEPS(), TOTAL);
  assert.ok(el.classList.contains('cost-bd'));
  assert.deepEqual(panelRows(el), EXPECTED_ROWS);
  assert.deepEqual([...el.children].map((c) => c.dataset.kind || c.tagName), ['agents', 'away', 'auto', 'title', 'HR', 'total', 'stopped', 'cut']);
  assert.deepEqual([...el.querySelectorAll('.cost-bd-floor')].map((r) => r.dataset.kind), ['stopped', 'cut']);
  assert.equal(costSummaryText(runCostBreakdown(STEPS(), TOTAL), fmt), 'incl. $0.12 Away mode');
  // A run whose only review stopped: nothing booked to "include", and no "$0.00 · 0 reviews" share row.
  const onlyStopped = [{ key: 'a', costUsd: 1, auxCosts: { away: { usd: 0, calls: 0, floorUsd: 0.03, stopped: 1 } } }];
  assert.equal(costSummaryText(runCostBreakdown(onlyStopped, 1), fmt), '');
  assert.deepEqual(panelRows(panel(onlyStopped, 1)),
    [['Agents', '$1.00', ''], ['Total', '$1.00', ''], ['Stopped reviews', '≥$0.03', '1 review · not in total']]);
  // No list price: "not priced"; a {free} model (floor 0): the count only, never "≥$0.00".
  assert.deepEqual(panelRows(panel([{ key: 'a', costUsd: 1, auxCosts: { away: { usd: 0, calls: 0, stopped: 2 } } }], 1)).at(-1),
    ['Stopped reviews', 'not priced', '2 reviews · not in total']);
  assert.deepEqual(panelRows(panel([{ key: 'a', costUsd: 0, auxCosts: { away: { usd: 0, calls: 0, floorUsd: 0, stopped: 1 } } }], 0)).at(-1),
    ['Stopped reviews', '', '1 review · not in total']);
  assert.deepEqual(panelRows(panel([{ key: 'a', costUsd: 1, stoppedTurns: { turns: 1, tokens: 900, floorUsd: null } }], 1)),
    [['Agents', '$1.00', ''], ['Total', '$1.00', ''], ['Stopped agent turns', 'not priced', '1 turn · not in total']]);
  window.close();
});

test('run page: the header cost opens its breakdown; a repaint keeps it open; a click elsewhere or Escape closes it', async () => {
  const ctx = await bootRun();
  const { window, rd } = ctx;
  const doc = window.document;
  const btn = rd.querySelector('.rd-meta .rd-cost');
  assert.equal(btn.tagName, 'BUTTON', 'the cost is the trigger');
  assert.equal(btn.textContent, '$3.33');
  assert.match(btn.title, /Estimated cost/, 'the estimate tooltip stays');
  const pop = doc.getElementById(btn.getAttribute('aria-controls'));
  assert.ok(pop && pop.classList.contains('cost-pop'));
  assert.equal(pop.parentElement, rd.querySelector('.rd-header'), 'the panel hangs off the header, outside the rebuilt meta line');
  assert.equal(pop.hidden, true);
  assert.equal(btn.getAttribute('aria-expanded'), 'false');
  btn.click();
  assert.equal(pop.hidden, false);
  assert.equal(rd.querySelector('.rd-meta .rd-cost').getAttribute('aria-expanded'), 'true');
  assert.deepEqual(panelRows(pop), EXPECTED_ROWS);
  // Every frame repaints the header (its meta line only when what it says changed): the open panel
  // (the same element) stays open.
  ctx.frame({ type: 'state', runId: 'r1', status: 'running', steps: STEPS(), totalCostUsd: TOTAL });
  await settle(window, 3);
  assert.equal(rd.querySelector('.rd-header > .cost-pop'), pop);
  assert.equal(pop.hidden, false, 'still open after a repaint');
  assert.equal(rd.querySelector('.rd-meta .rd-cost').getAttribute('aria-expanded'), 'true');
  // Same numbers: the panel's rows are not rebuilt (no flicker under the pointer).
  const firstRow = pop.querySelector('.cost-bd-row');
  ctx.frame({ type: 'state', runId: 'r1', status: 'running', steps: STEPS(), totalCostUsd: TOTAL });
  await settle(window, 3);
  assert.equal(pop.querySelector('.cost-bd-row'), firstRow, 'unchanged numbers keep the same rows');
  // New numbers repaint the open panel in place.
  const more = STEPS(); more[2].auxCosts.away = { usd: 0.09, calls: 2, floorUsd: 0.0234, stopped: 1 }; more[2].costUsd = 1.93;
  ctx.frame({ type: 'state', runId: 'r1', status: 'running', steps: more, totalCostUsd: 3.3519 });
  await settle(window, 3);
  assert.deepEqual(panelRows(pop)[1], ['Away mode', '$0.14', '3 reviews']);
  // A click inside the panel keeps it; a click elsewhere closes it.
  click(window, pop.querySelector('.cost-bd-row .cost-bd-l'));
  assert.equal(pop.hidden, false);
  click(window, rd.querySelector('.rd-title'));
  assert.equal(pop.hidden, true);
  // Escape closes an open panel and stays on Details (the capture-phase arm would otherwise go back to the glance).
  rd.querySelector('.rd-meta .rd-cost').click();
  assert.equal(pop.hidden, false);
  const hash = window.location.hash;
  doc.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  await settle(window, 2);
  assert.equal(pop.hidden, true, 'Escape closed the panel');
  assert.equal(window.location.hash, hash, 'and did not leave Details');
  assert.equal(doc.activeElement, rd.querySelector('.rd-meta .rd-cost'), 'focus back on the trigger');
  // With the panel closed, Escape is the page's again.
  doc.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  await settle(window, 2);
  assert.notEqual(window.location.hash, hash);
});

test('run page: the panel\'s Total is the header\'s total, not a re-sum of the steps', async () => {
  const ctx = await bootRun({ total: 3.5 });   // Σ steps is 3.3319: the run total is what the header says
  const { rd } = ctx;
  const btn = rd.querySelector('.rd-meta .rd-cost');
  assert.equal(btn.textContent, '$3.50');
  btn.click();
  const rows = panelRows(rd.querySelector('.rd-header > .cost-pop'));
  assert.deepEqual(rows.find((r) => r[0] === 'Total'), ['Total', '$3.50', '']);
  assert.deepEqual(rows[0], ['Agents', '$3.34', ''], '3.50 − 0.1619');
});

test('run page: agent turns a pause cut off open the breakdown even with no Away mode, Auto workflow or run title', async () => {
  const ctx = await bootRun({ total: 1, steps: [{ key: 'n_impl:1', executionId: 'n_impl:1', nodeId: 'n_impl', status: 'done', costUsd: 1,
    stoppedTurns: { turns: 1, tokens: 21000, floorUsd: 0.07 } }] });
  const { window, rd } = ctx;
  const btn = rd.querySelector('.rd-meta .rd-cost');
  assert.equal(btn.tagName, 'BUTTON');
  btn.click();
  assert.deepEqual(panelRows(rd.querySelector('.rd-header > .cost-pop')),
    [['Agents', '$1.00', ''], ['Total', '$1.00', ''], ['Stopped agent turns', '≥$0.07', '1 turn · not in total']]);
  assert.equal(btn.textContent, '$1.00', 'the lower bound never reaches the header total');
  assert.doesNotMatch(rd.textContent, /incl\./, 'cut turns are no Away mode share');
  go(window, 'running/r1');
  await settle(window, 6);
  assert.deepEqual(glanceCost(rd.querySelector('.rd-glance')), ['$1.00', 'cost']);
});

// --- the run page and the History run page ------------------------------------------------------
const histDetail = (steps) => ({ ...DETAIL, state: { ...DETAIL.state, steps, totalCostUsd: TOTAL } });

test('run page and History: the header cost opens the same breakdown; glance tile and Overview card carry the Away mode share', async () => {
  await checkRows([
    { name: 'run page: the glance cost tile and the Overview cost card carry the Away mode share', run: async () => {
      const ctx = await bootRun();
      const { rd } = ctx;
      const ov = rd.querySelector('.rd-sec[data-sec="overview"] .hd-ov-card-cost') || rd.querySelector('.hd-ov-card-cost');
      assert.ok(ov, 'the Overview cost card renders');
      assert.match(ov.querySelector('.hd-ov-sub').textContent, / · incl\. \$0\.12 Away mode$/);
      go(ctx.window, 'running/r1');
      await settle(ctx.window, 6);
      assert.deepEqual(glanceCost(rd.querySelector('.rd-glance')), ['$3.33', 'incl. $0.12 Away mode']);
    } },
    { name: 'History: the header cost opens the same breakdown; the glance and the Overview carry the share', run: async () => {
      const ctx = await bootDetail({ detail: histDetail(STEPS()) });
      await openDetail(ctx, 'details/overview');
      const doc = ctx.window.document;
      const btn = doc.querySelector('#hist-detail .hd-meta .hd-cost');
      assert.equal(btn.tagName, 'BUTTON');
      assert.equal(btn.textContent, '$3.33');
      const pop = doc.getElementById(btn.getAttribute('aria-controls'));
      assert.equal(pop.parentElement, doc.querySelector('#hist-detail .hd-header'));
      btn.click();
      assert.equal(pop.hidden, false);
      assert.deepEqual(panelRows(pop), EXPECTED_ROWS);
      // Escape closes the panel before History's capture-phase arm can step back to the glance.
      const hash = ctx.window.location.hash;
      doc.dispatchEvent(new ctx.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      await settle(ctx.window, 2);
      assert.equal(pop.hidden, true);
      assert.equal(ctx.window.location.hash, hash);
      const card = secOf(doc, 'overview').querySelector('.hd-ov-card-cost');
      assert.equal(card.querySelector('.hd-ov-sub').textContent, 'across 4 steps · incl. $0.12 Away mode');
      await openDetail(ctx, '');
      assert.deepEqual(glanceCost(doc.querySelector('#hist-detail .hd-glance')), ['$3.33', 'incl. $0.12 Away mode']);
    } },
  ]);
});

test('an old run (no shares kept), live or History: plain cost, no panel, no \'incl.\', no NaN/undefined', async () => {
  await checkRows([
    { name: 'run page, an old run (no shares kept): the plain cost, no panel, no "incl.", no NaN or undefined', run: async () => {
      const ctx = await bootRun({ steps: OLD_STEPS() });
      const { rd } = ctx;
      const seg = rd.querySelector('.rd-meta .rd-cost');
      assert.equal(seg.tagName, 'SPAN');
      assert.equal(seg.textContent, '$3.33');
      assert.equal(rd.querySelector('.cost-bd-btn'), null);
      const pop = rd.querySelector('.rd-header > .cost-pop');
      assert.ok(!pop || (pop.hidden && !pop.childElementCount), 'no panel content');
      assert.doesNotMatch(rd.textContent, /incl\.|NaN|undefined/);
      go(ctx.window, 'running/r1');
      await settle(ctx.window, 6);
      assert.deepEqual(glanceCost(rd.querySelector('.rd-glance')), ['$3.33', 'cost']);
      assert.doesNotMatch(rd.textContent, /incl\.|NaN|undefined/);
    } },
    { name: 'History, an old run: the plain cost and no "incl." anywhere', run: async () => {
      const ctx = await bootDetail({ detail: histDetail(OLD_STEPS()) });
      await openDetail(ctx, 'details/overview');
      const doc = ctx.window.document;
      assert.equal(doc.querySelector('#hist-detail .hd-meta .hd-cost').tagName, 'SPAN');
      assert.equal(secOf(doc, 'overview').querySelector('.hd-ov-card-cost .hd-ov-sub').textContent, 'across 4 steps');
      await openDetail(ctx, '');
      assert.deepEqual(glanceCost(doc.querySelector('#hist-detail .hd-glance')), ['$3.33', 'cost']);
      assert.doesNotMatch(doc.querySelector('#hist-detail').textContent, /incl\.|NaN|undefined/);
    } },
  ]);
});

test('awayTotalText: booked reviews, else the stopped reviews\' lower bound apart, else nothing', () => {
  const fmt = (n) => `$${n.toFixed(2)}`;
  const away = (a) => runCostBreakdown([{ costUsd: 1, auxCosts: { away: a } }]);
  assert.equal(awayTotalText(runCostBreakdown(STEPS(), TOTAL), fmt), '$0.12');
  assert.equal(awayTotalText(away({ usd: 0, calls: 1 }), fmt), '$0.00', 'a $0 review is shown');
  assert.equal(awayTotalText(away({ usd: 0, calls: 0, floorUsd: 0.03, stopped: 1 }), fmt), '≥$0.03 · not in total');
  assert.equal(awayTotalText(away({ usd: 0, calls: 0, stopped: 1 }), fmt), '', 'not priced: no figure');
  assert.equal(awayTotalText(away({ usd: 0, calls: 0, floorUsd: 0, stopped: 1 }), fmt), '', 'a {free} model: never "≥$0.00"');
  assert.equal(awayTotalText(runCostBreakdown(OLD_STEPS(), TOTAL), fmt), '');
});

test('History: "Answered for you" names each review\'s model and cost, and the heading sums the steps\' reviews', async () => {
  const decisions = [
    { questionId: 'c-1', kind: 'clarify', at: '2026-01-01T14:02:00', choice: 'Redis', strategy: 'analysis', model: null,
      reviewId: 'night-decider-ab12cd34', reviewStatus: 'finished', costUsd: 0.05, tokens: 900, executionId: 'n_plan:1', flagged: false, rationale: 'r',
      questions: [{ id: 'store', question: 'Which store?', choice: 'Redis', strategy: 'analysis', confidence: 80, flagged: false, rationale: 'fits' }] },
    { questionId: 'gate-w-2', kind: 'gate', at: '2026-01-01T14:52:00', choice: 'continue', strategy: 'rule', flagged: false, rationale: 'r' },
  ];
  const ctx = await bootDetail({ detail: histDetail(STEPS()),
    arms: (url) => (url.includes('/api/night-decisions') ? Promise.resolve({ ok: true, status: 200, json: async () => ({ decisions }) }) : null) });
  await openDetail(ctx, '');
  await settle(ctx.window, 4);
  const sec = ctx.window.document.querySelector('#hist-detail .hd-night-sec');
  assert.equal(sec.hidden, false);
  assert.deepEqual([...sec.querySelectorAll('.rd-na .rd-slabel')].map((c) => c.textContent),
    ['Clarifying questions · 14:02 · the default model · $0.05', 'Review loop · 14:52 · rule · $0.00']);
  assert.equal(sec.querySelector('h3').textContent, 'Answered for you · 2 answers · $0.12');
});

test('a run on an engine that reports no cost: Agents reads "cost unknown", the Total is worca\'s own calls', () => {
  const { window } = new JSDOM('<!doctype html><body></body>');
  const fmt = (n) => (n > 0 && n < 0.01 ? '<$0.01' : `$${n.toFixed(2)}`);
  const el = costBreakdownEl(window.document, runCostBreakdown(STEPS(), TOTAL), { fmtUsd: fmt, agentsUnknown: true });
  const rows = panelRows(el);
  assert.deepEqual(rows[0], ['Agents', 'cost unknown', '']);
  assert.deepEqual(rows.find((r) => r[0].startsWith('Total')), ["Total (worca's own calls)", '$3.33', '']);
  assert.deepEqual(rows[1], ['Away mode', '$0.12', '2 reviews'], 'worca\'s own helper lines keep their real cost');
  window.close();
});

test('cost unknown, never $0.00: a Cursor run on the run page and in History; a Codex run with 0 still reads $0.00', async () => {
  const runPage = async (runEngine) => {
    const ctx = await boot({ fetchHandler: (url) => (url.endsWith('/api/history') ? Promise.resolve({ ok: true, status: 200, json: async () => ({ pipelines: [], ghAvailable: false }) }) : null) });
    const ws = ctx.wsBox.ws;
    ws.dispatch('open', {});
    const frame = (msg) => ws.dispatch('message', { data: JSON.stringify(msg) });
    frame({ type: 'hello', runs: [] });
    await settle(ctx.window, 4);
    frame({ type: 'run-created', runId: 'r1', title: 'T', projectDir: PROJECT, status: 'running', startedAt: '2026-08-19T10:00:00Z', kind: 'run' });
    frame({ type: 'state', runId: 'r1', id: 'p1', status: 'running', steps: OLD_STEPS(), subAgents: [], totalCostUsd: 0, runEngine });
    go(ctx.window, 'running/r1/details/overview');
    await settle(ctx.window, 6);
    return ctx.window.document.querySelector('#run-detail .rd');
  };
  await checkRows([
    { name: 'run page, Cursor: the header and the Overview card read cost unknown', run: async () => {
      const rd = await runPage('cursor');
      assert.equal(rd.querySelector('.rd-meta .rd-cost').textContent, 'cost unknown');
      assert.match(rd.querySelector('.rd-meta .rd-cost').title, /Cursor reports no cost/);
      assert.equal(rd.querySelector('.hd-ov-card-cost .hd-ov-value').textContent, 'cost unknown');
      assert.doesNotMatch(rd.querySelector('.rd-meta').textContent, /\$0\.00/);
    } },
    { name: 'run page, Codex with 0: $0.00 as today', run: async () => {
      const rd = await runPage('codex');
      assert.equal(rd.querySelector('.rd-meta .rd-cost').textContent, '$0.00');
    } },
    { name: 'History, Cursor: the header and the COST card read cost unknown', run: async () => {
      const ctx = await bootDetail({ detail: { ...DETAIL, state: { ...DETAIL.state, steps: OLD_STEPS(), totalCostUsd: 0, runEngine: 'cursor' } } });
      await openDetail(ctx, 'details/overview');
      const doc = ctx.window.document;
      assert.equal(doc.querySelector('#hist-detail .hd-meta .hd-cost').textContent, 'cost unknown');
      assert.equal(secOf(doc, 'overview').querySelector('.hd-ov-card-cost .hd-ov-value').textContent, 'cost unknown');
    } },
    { name: 'History, a reporting engine with no cost number: the empty header cost and the — card as today', run: async () => {
      const ctx = await bootDetail({ detail: { ...DETAIL, state: { ...DETAIL.state, steps: OLD_STEPS(), totalCostUsd: undefined, runEngine: 'codex' } } });
      await openDetail(ctx, 'details/overview');
      const doc = ctx.window.document;
      assert.equal(doc.querySelector('#hist-detail .hd-meta .hd-cost'), null);
      assert.equal(secOf(doc, 'overview').querySelector('.hd-ov-card-cost .hd-ov-value').textContent, '—');
    } },
  ]);
});
