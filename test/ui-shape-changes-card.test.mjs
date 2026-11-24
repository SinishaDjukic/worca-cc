// test/ui-shape-changes-card.test.mjs — one case per landing row: title, primary label, verb posted
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { renderChangesCard } from '../ui/public/shape/changes-card.mjs';
import { changesCard } from '../src/core/shape/changes.mjs';
import { readStyleCss } from '../src/core/read-style-css.mjs';

const RUN = { pipelineId: 'aaaa0002', title: 'Add a chart', label: 'Run 2', projectDir: '/p', finished: true,
  branch: { source: 'dev', feature: 'worca/charts-2' }, pr: { number: 41, url: 'https://x/pull/41', state: 'OPEN' }, rounds: 1 };
const S = (index, state, over = {}) => ({ index, state, pipelineId: `p${index}`, title: `Part ${index}`,
  branch: { source: 'dev', feature: `worca/c-${index}` }, pr: null, rounds: 1, ...over });
const F = (slices, over = {}) => ({ feature: { id: 'f1', title: 'Charts', base: 'dev', projectDir: '/p', shipPr: null, slices, ...over } });
const merged = { number: 52, url: 'https://x/pull/52', state: 'MERGED' };
const ROWS = [
  ['round', { run: RUN }, 'Changes to Run 2 · same branch, same PR', 'Start round 2', 'Branch worca/charts-2 · PR #41'],
  ['next-plan', F([S(1, 'done'), S(2, 'running'), S(3, 'planned')]), "Changes to Charts · into Run 3's plan", "Add to Run 3's plan", null],
  ['round', F([S(1, 'done'), S(2, 'done'), S(3, 'done', { pr: { number: 52, url: 'https://x/pull/52', state: 'OPEN' } })]),
    'Changes to Run 3 · same branch, before Ship', 'Start round 2', 'Branch worca/c-3 · PR #52'],
  ['follow-up', F([S(1, 'done'), S(2, 'done', { pr: merged })], { shipPr: merged }), 'Follow-up to Charts · Run 3 from dev, own PR', 'Start Run 3', null],
];

for (const [kind, facts, title, start, where] of ROWS) {
  test(`${kind}: "${title}" with primary "${start}"; Start posts {verb:'start'}`, async () => {
    const d = new JSDOM('<!doctype html><body></body>').window.document; const posted = [];
    const card = changesCard({ text: 'make it blue', facts });
    const el = renderChangesCard(d, { state: 'proposed', card }, { onStart: async () => posted.push('start'), onNotNow: async () => posted.push('not-now') });
    assert.equal(el.dataset.landing, kind);
    assert.equal(el.querySelector('.ask-mcard-title').textContent, title);
    assert.equal(el.querySelector('.btn-primary').textContent, start);
    assert.equal(el.querySelector('.ask-changescard-where')?.textContent ?? null, where);
    el.querySelector('.btn-primary').click(); await new Promise((r) => setTimeout(r, 0));
    assert.deepEqual(posted, ['start']);
  });
}

test('applied round names the PR to update; a 409 shows the error and unlocks', async () => {
  const d = new JSDOM('<!doctype html><body></body>').window.document;
  const card = changesCard({ text: 'make it blue', facts: { run: RUN } });
  const done = renderChangesCard(d, { state: 'applied', card: { ...card, result: { round: 2, pr: 41 } } }, { onStart: async () => {}, onNotNow: async () => {} });
  assert.equal(done.querySelector('.ask-changescard-done').textContent, 'Round 2 started · push it to update PR #41');
  const el = renderChangesCard(d, { state: 'proposed', card }, { onStart: async () => { throw { body: { error: 'branch in use' } }; }, onNotNow: async () => {} });
  el.querySelector('.btn-primary').click(); await new Promise((r) => setTimeout(r, 0));
  assert.equal(el.querySelector('.ask-card-err').textContent, 'branch in use');
  assert.equal(el.querySelector('.btn-primary').disabled, false);
});

test('a long Changes or Route title ellipsizes instead of overflowing the card', async () => {
  const { readFileSync } = await import('node:fs');
  const css = readStyleCss();
  const rule = css.split('\n').find((l) => l.includes('.ask-shipcard .ask-mcard-title') && l.includes('text-overflow:ellipsis'));
  assert.ok(rule, 'the shared title fix-up rule exists');
  for (const sel of ['.ask-changescard .ask-mcard-title', '.ask-routecard .ask-mcard-title']) assert.ok(rule.includes(sel), sel);
});

// Shaper requirements s3 (3.C, D12): a shipped feature with agreed requirements updates them before it plans.
const AGREED = [{ id: 'R-po-1', text: 'Export the report' }, { id: 'R-sec-2', text: 'Sign it' }, { id: 'R-ux-1', text: 'Dark' }, { id: 'R-ops-1', text: 'Alert' }];
const SHIPPED = (agreed, over = {}) => F([S(1, 'done'), S(2, 'done', { pr: { number: 52, url: 'https://x/pull/52', state: 'OPEN' } })],
  { shipPr: { number: 52, url: 'https://x/pull/52', state: 'OPEN' }, shipped: true, agreed, acceptance: [], perspectives: ['product', 'qa'], ...over });
test('requirements first: the line under the quote, plural and singular; the primary label is still the landing\'s', () => {
  const d = new JSDOM('<!doctype html><body></body>').window.document;
  for (const [agreed, line] of [[AGREED, 'Requirements first: the 4 agreed requirements are updated before the plan.'],
    [AGREED.slice(0, 1), 'Requirements first: the 1 agreed requirement is updated before the plan.']]) {
    const card = changesCard({ text: 'make it blue', facts: SHIPPED(agreed) });
    assert.equal(card.requirementsFirst.count, agreed.length);
    const el = renderChangesCard(d, { state: 'proposed', card }, { onStart: async () => {}, onNotNow: async () => {} });
    assert.equal(el.querySelector('.ask-changescard-first').textContent, line);
    assert.equal(el.querySelector('.btn-primary').textContent, 'Start round 2');
  }
});

test('requirements first does not apply: not shipped, or no agreed requirements draw today\'s card', () => {
  const d = new JSDOM('<!doctype html><body></body>').window.document;
  const render = (card) => renderChangesCard(d, { state: 'proposed', card }, { onStart: async () => {}, onNotNow: async () => {} }).outerHTML;
  const today = render(changesCard({ text: 'make it blue', facts: SHIPPED([]) }));
  for (const facts of [SHIPPED(AGREED, { shipped: false }), SHIPPED([])]) {
    const card = changesCard({ text: 'make it blue', facts });
    assert.equal('requirementsFirst' in card, false);
    if (facts.feature.shipped) assert.equal(render(card), today);
  }
});

// Small runs C4 (D13): the requirement-change card (type 'req-change').
const RC = { type: 'req-change', featureId: 'f1', featureTitle: 'Reset emails', requirement: 'R-po-3', from: 'send once',
  to: 'reset emails retry once', reason: 'one send is not enough', landsAs: 'running' };
test('C4 req-change card: proposed, applied and declined; Change it is the one primary; the new text once', async () => {
  const { renderReqChangeCard } = await import('../ui/public/shape/changes-card.mjs');
  const d = new JSDOM('<!doctype html><body></body>').window.document;
  const posted = [];
  const el = renderReqChangeCard(d, { state: 'proposed', card: RC }, { onStart: async () => posted.push('start'), onNotNow: async () => posted.push('not-now') });
  assert.equal(el.querySelector('.ask-mcard-kind').textContent, 'Change');
  assert.equal(el.querySelector('.ask-mcard-title').textContent, 'R-po-3');
  assert.equal(el.querySelector('.ask-changescard-quote').textContent, 'one send is not enough');
  assert.equal((el.textContent.match(/reset emails retry once/g) || []).length, 1, 'the new text once');
  assert.equal((el.textContent.match(/R-po-3/g) || []).length, 1, 'the id once');
  assert.deepEqual([...el.querySelectorAll('.btn-primary')].map((b) => b.textContent), ['Change it']);
  assert.equal(el.querySelector('.ask-card-not-now').textContent, 'Not now');
  const marked = [...el.querySelectorAll('.plan-check-row')].filter((r) => r.querySelector('[aria-label="this change"]'));
  assert.deepEqual(marked.map((r) => r.querySelector('.plan-check-id').textContent), ['Running']);
  el.querySelector('.btn-primary').click(); await new Promise((r) => setTimeout(r, 0));
  assert.deepEqual(posted, ['start']);
  const applied = renderReqChangeCard(d, { state: 'applied', card: { ...RC, result: { changes: [] } } }, { onStart: async () => {}, onNotNow: async () => {} });
  assert.equal(applied.querySelector('.ask-changescard-done').textContent, 'Changed: R-po-3');
  assert.doesNotMatch(applied.textContent, /retry once/);
  assert.equal(applied.querySelectorAll('button').length, 0);
  assert.equal(renderReqChangeCard(d, { state: 'declined', card: RC }, {}).textContent, 'Not now: R-po-3');
});

test('C4 req-change card: a refused apply stays proposed, its message in .ask-card-err, the primary enabled', async () => {
  const { renderReqChangeCard } = await import('../ui/public/shape/changes-card.mjs');
  const d = new JSDOM('<!doctype html><body></body>').window.document;
  const el = renderReqChangeCard(d, { state: 'proposed', card: RC }, { onStart: async () => { throw { body: { error: 'R-po-3 changed since: read it again' } }; }, onNotNow: async () => {} });
  el.querySelector('.btn-primary').click(); await new Promise((r) => setTimeout(r, 0));
  assert.equal(el.dataset.reqChangeCard, 'proposed');
  assert.equal(el.querySelector('.ask-card-err').textContent, 'R-po-3 changed since: read it again');
  assert.equal(el.querySelector('.btn-primary').disabled, false);
});
