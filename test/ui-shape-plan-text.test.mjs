// test/ui-shape-plan-text.test.mjs — the pure helpers of the plan and question cards (spec §3.3, §3.4)
// and the perspective chips (spec D4).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import {
  SHAPE_ATTENTION, isShapingRun, planStats, perspectiveChangeFeedback, fixFeedback, sectionOwners, defaultAnswers,
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
