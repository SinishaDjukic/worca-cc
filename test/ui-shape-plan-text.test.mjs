// test/ui-shape-plan-text.test.mjs — the pure helpers of the plan and question cards (spec §3.3, §3.4)
// and the perspective chips (spec D4).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import {
  SHAPE_ATTENTION, isShapingRun, planStats, perspectiveChangeFeedback, fixFeedback, sectionOwners, defaultAnswers,
  planSummary, checkLine, unmetLine, fixAllFeedback, approveLabel, shaperWait,
  planApproveLabel,
} from '../ui/public/shape/plan-text.mjs';
import { buildPerspectiveChips } from '../ui/public/shape/chips.mjs';
import { PERSPECTIVES } from '../src/shared/shape/perspectives.mjs';

test('SHAPE_ATTENTION and isShapingRun', () => {
  assert.equal(SHAPE_ATTENTION, '~3 min of your time now');
  assert.equal(isShapingRun({ shaping: { stage: 'plan' } }), true);
  assert.equal(isShapingRun({ shaping: 'yes' }), false);
  assert.equal(isShapingRun({}), false);
  assert.equal(isShapingRun(null), false);
});

test('planStats counts ## sections and words outside fenced code', () => {
  const md = '# Title\n\n## Problem and goal\none two three\n\n```js\nconst a = 1; const b = 2;\n```\n\n## Testing\nfour\n### Sub\n';
  assert.deepEqual(planStats(md), { sections: 2, words: 14 });
  assert.deepEqual(planStats(''), { sections: 0, words: 0 });
  assert.deepEqual(planStats(null), { sections: 0, words: 0 });
});

test('perspectiveChangeFeedback names the added and dropped labels', () => {
  const both = perspectiveChangeFeedback(['product', 'architect', 'qa'], ['product', 'qa', 'ux', 'security']);
  assert.match(both, /^Perspectives changed: add UX, Security; drop Architect\. /);
  assert.match(both, /Rewrite the plan for Product, QA, UX, Security:/);
  const added = perspectiveChangeFeedback(['product'], ['product', 'devops']);
  assert.match(added, /^Perspectives changed: add DevOps and infrastructure\. /);
  assert.doesNotMatch(added, /; drop /);
  const dropped = perspectiveChangeFeedback(['product', 'release'], ['product']);
  assert.match(dropped, /^Perspectives changed: drop Release\. /);
});

test('fixFeedback with and without detail', () => {
  assert.equal(fixFeedback({ label: 'Testing names test files', detail: 'no test/… path' }),
    'The shape check fails "Testing names test files": no test/… path. Fix the plan so this check passes.');
  assert.equal(fixFeedback({ label: 'No placeholders' }),
    'The shape check fails "No placeholders". Fix the plan so this check passes.');
});

test('sectionOwners maps a section title (numbered too) to its picked owners', () => {
  assert.deepEqual(sectionOwners('Code layout', ['architect']), ['architect']);
  assert.deepEqual(sectionOwners('3. Code layout', ['architect']), ['architect']);
  assert.deepEqual(sectionOwners('2) Decisions ', ['architect']), ['architect']);
  assert.deepEqual(sectionOwners('Problem and goal', []), ['product'], 'Product is always on');
  assert.deepEqual(sectionOwners('Screens and states', ['architect']), [], 'UX not picked');
  assert.deepEqual(sectionOwners('Architecture', ['architect']), []);
  assert.deepEqual(sectionOwners('', ['architect']), []);
});

test('defaultAnswers picks the recommended option, else the first, else empty', () => {
  const pq = {
    questions: [
      { id: 'q1', question: 'Store?', options: ['sqlite', 'json'], recommended: 'json' },
      { id: 'q2', question: 'Auth?', options: ['none', 'token'], recommended: 'magic' },
      { id: 'q3', question: 'Name?' },
      { question: 'no id', options: ['x'] },
      null,
    ],
  };
  assert.deepEqual(defaultAnswers(pq), {
    answers: [
      { id: 'q1', question: 'Store?', choice: 'json' },
      { id: 'q2', question: 'Auth?', choice: 'none' },
      { id: 'q3', question: 'Name?', choice: '' },
    ],
  });
  assert.deepEqual(defaultAnswers({}), { answers: [] });
  assert.deepEqual(defaultAnswers(null), { answers: [] });
});

// ---------------------------------------------------------------- chips

const newDoc = () => new JSDOM('<!doctype html><body></body>').window.document;
const chips = (el) => [...el.querySelectorAll('.shape-chip')];
const chip = (el, key) => el.querySelector(`.shape-chip[data-perspective="${key}"]`);

test('chips: Product is locked on; fixed keys are locked', () => {
  const { el, value } = buildPerspectiveChips(newDoc(), { picked: ['ux', 'qa'], fixed: ['ux'], collapsed: false });
  assert.equal(el.getAttribute('role'), 'group');
  assert.equal(chips(el).length, PERSPECTIVES.length);
  const product = chip(el, 'product');
  assert.equal(product.disabled, true);
  assert.equal(product.dataset.locked, '1');
  assert.equal(product.getAttribute('aria-pressed'), 'true');
  assert.equal(chip(el, 'ux').disabled, true);
  assert.equal(chip(el, 'ux').dataset.locked, '1');
  assert.equal(chip(el, 'qa').disabled, false);
  assert.equal(chip(el, 'qa').dataset.locked, undefined);
  assert.equal(el.querySelector('.shape-chip-more'), null, 'expanded: no more button');
  assert.deepEqual(value(), ['product', 'qa', 'ux']);
});

test('chips: toggling calls onChange with value() in PERSPECTIVES order', () => {
  const seen = [];
  const { el, value } = buildPerspectiveChips(newDoc(), { picked: ['qa'], collapsed: false, onChange: (v) => seen.push(v) });
  chip(el, 'security').click();
  chip(el, 'architect').click();
  chip(el, 'qa').click();
  assert.deepEqual(seen, [
    ['product', 'qa', 'security'],
    ['product', 'architect', 'qa', 'security'],
    ['product', 'architect', 'security'],
  ]);
  assert.deepEqual(value(), ['product', 'architect', 'security']);
  assert.equal(chip(el, 'architect').classList.contains('on'), true);
  assert.equal(chip(el, 'qa').getAttribute('aria-pressed'), 'false');
});

test('chips: collapsed shows only picked chips plus a "+ N more" button that expands', () => {
  const { el } = buildPerspectiveChips(newDoc(), { picked: ['architect'] });
  assert.deepEqual(chips(el).map((b) => b.dataset.perspective), ['product', 'architect']);
  const more = el.querySelector('.shape-chip-more');
  assert.equal(more.textContent, `+ ${PERSPECTIVES.length - 2} more`);
  more.click();
  assert.equal(chips(el).length, PERSPECTIVES.length);
  assert.equal(el.querySelector('.shape-chip-more'), null);
});

test('planSummary: Problem and goal first paragraph, markdown stripped, capped at 280', () => {
  assert.equal(planSummary('# T\n\nIntro.\n\n## 1. Problem and goal\nWe **ship** the [card](x).\nSecond line.\n\nLater.\n'),
    'We ship the card. Second line.');
  assert.equal(planSummary('# T\n\nJust a preamble.\n\n## Decisions\n| a | b |\n'), 'Just a preamble.');
  assert.equal(planSummary('## Problem and goal\n```\ncode\n```\n- one\n- two\n'), 'one two');
  const long = planSummary(`## Problem and goal\n${'word '.repeat(200)}`);
  assert.ok(long.length <= 280 && long.endsWith('…'));
  assert.equal(planSummary(''), '');
  assert.equal(planSummary('## Problem and goal\nUse `snake_case` and *one* of 2*3.\n'), 'Use snake_case and one of 2*3.');
});

test('checkLine and unmetLine name the count and the short check names', () => {
  const check = { ok: false, passed: 5, total: 8, items: [
    { id: 'sections', label: 'S', pass: false }, { id: 'decisions', label: 'D', pass: false },
    { id: 'tests', label: 'T', pass: false }, { id: 'paths', label: 'P', pass: true }] };
  assert.equal(checkLine(check), 'Shape 5/8 · 3 to fix');
  assert.equal(unmetLine(check), 'Still to fix: missing sections, open decisions, no test plan');
  assert.equal(checkLine({ passed: 8, total: 8, items: [] }), 'Shape 8/8');
  assert.equal(unmetLine({ items: [{ id: 'paths', pass: false }] }), 'Still to fix: file paths not in the repo');
  assert.equal(unmetLine({ items: [] }), '');
  assert.equal(checkLine({ passed: 4, total: 5, items: [{ pass: false }] }, 'Outline'), 'Outline 4/5 · 1 to fix');
  assert.equal(checkLine({ passed: 5, total: 5, items: [] }, 'Outline'), 'Outline 5/5');
  assert.equal(checkLine(null, 'Outline'), 'Outline check');
});

test('fixAllFeedback: one failure equals fixFeedback; several are listed', () => {
  const a = { label: 'A', pass: false, detail: 'x' }; const b = { label: 'B', pass: false }; const ok = { label: 'C', pass: true };
  assert.equal(fixAllFeedback([a, ok]), fixFeedback(a));
  assert.equal(fixAllFeedback([a, b, ok]), 'The shape check fails 2 checks:\n- "A": x\n- "B"\nFix the plan so these checks pass.');
});

test('approveLabel names the outcome; shaperWait only for Shaper steps with the gate on', () => {
  assert.equal(approveLabel({}), 'Approve and build');
  assert.equal(approveLabel({ outline: { slices: [] } }), 'Approve and build', 'the outline label lives in outline-body');
  const shaped = (pq) => ({ shaping: { rounds: [] }, pendingQuestion: pq });
  assert.equal(shaperWait(shaped({ kind: 'plan' }), true), 'plan');
  assert.equal(shaperWait(shaped({ kind: 'questions', questions: [] }), true), 'clarify');
  for (const kind of ['form', 'gate', 'recovery', 'workflow']) assert.equal(shaperWait(shaped({ kind }), true), null, kind);
  assert.equal(shaperWait(shaped({ kind: 'plan' }), false), null, 'gate off');
  assert.equal(shaperWait({ pendingQuestion: { kind: 'plan' } }, true), null, 'unshaped');
  assert.equal(shaperWait(shaped(null), true), null, 'nothing pending');
});

test('buildPerspectiveChips: hidden keys are not offered — no chip, not in value(), not in "+ N more"', () => {
  const open = buildPerspectiveChips(newDoc(), { picked: ['qa', 'fit'], hidden: ['fit'], collapsed: false });
  assert.equal(open.el.querySelectorAll('.shape-chip').length, PERSPECTIVES.length - 1);
  assert.equal(open.el.querySelector('[data-perspective="fit"]'), null);
  assert.deepEqual(open.value(), ['product', 'qa']);
  const shut = buildPerspectiveChips(newDoc(), { picked: ['architect', 'qa'], hidden: ['fit'] });
  assert.equal(shut.el.querySelector('.shape-chip-more').textContent, `+ ${PERSPECTIVES.length - 1 - 3} more`);
});

test('planApproveLabel: open critical/major issues are named on a plan ask only', () => {
  assert.equal(planApproveLabel({}, 1), 'Approve with 1 open issue');
  assert.equal(planApproveLabel({}, 2), 'Approve with 2 open issues');
  assert.equal(planApproveLabel({}, 0), 'Approve and build');
  assert.equal(planApproveLabel({}), 'Approve and build');
  assert.equal(planApproveLabel({ outline: { slices: [] } }, 3), approveLabel({ outline: { slices: [] } }));
});
