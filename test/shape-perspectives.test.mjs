import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  PERSPECTIVES, SECTIONS, sectionsFor, missingSections, splitSections, blankFences, ownersOf,
  normalizePerspectives, perspectivesBlock, PERSPECTIVE_KEYS,
  FIT_KEY, FIT_RULES, perspectiveByKey, withProjectFit, chipsHiddenFor,
} from '../src/shared/shape/perspectives.mjs';
import { checkShape } from '../src/shared/shape/shape.mjs';
import { wellShapedPlan } from './helpers/shape-plan.mjs';

test('every perspective has at least one section, and every section key is known', () => {
  const keys = new Set(SECTIONS.map((s) => s.key));
  for (const p of PERSPECTIVES) {
    assert.ok(p.sections.length > 0, p.key);
    for (const s of p.sections) assert.ok(keys.has(s), `${p.key} → ${s}`);
  }
});

test('sectionsFor keeps the §3.1 order and renumbers', () => {
  const got = sectionsFor(['qa', 'architect']).map((s) => `${s.n}. ${s.title}`);
  assert.deepEqual(got, ['1. Problem and goal', '2. Decisions', '3. Code layout', '4. Testing', '5. Out of scope', '6. Open questions']);
});

test('Product is always included, even when not asked for', () => {
  assert.equal(sectionsFor([])[0].key, 'problem');
  assert.ok(sectionsFor(['ux']).some((s) => s.key === 'problem'));
});

test('missingSections matches headings with or without numbers, case-insensitively', () => {
  const md = '# T\n## 1. Problem and goal\nx\n## testing\n## 3. Out of scope\n## Open questions\n';
  assert.deepEqual(missingSections(md, ['product']), []);
  assert.deepEqual(missingSections(md, ['product', 'security']), ['Threats']);
});

test('every perspective but Product has a unique checklist prefix', () => {
  const prefixes = PERSPECTIVES.filter((p) => p.key !== 'product').map((p) => p.checklist);
  assert.ok(prefixes.every((p) => /^[a-z]+$/.test(p)));
  assert.equal(new Set(prefixes).size, prefixes.length);
  assert.equal(PERSPECTIVES.find((p) => p.key === 'product').checklist, undefined);
});

test('splitSections: keys by title, numbers optional, fenced headings ignored', () => {
  const s = splitSections('# T\n## 1. Problem and goal\nx\n```\n## Testing\n```\n## testing\ny\n');
  assert.deepEqual(s.map((x) => x.key), [null, 'problem', 'testing']);
  assert.equal(blankFences('a\n```\nb\n```\nc'), 'a\n\n\n\nc');
});

test('ownersOf: Product owns Problem; Testing is QA only when picked', () => {
  assert.deepEqual(ownersOf('problem', []), ['product']);
  assert.deepEqual(ownersOf('testing', ['architect']), []);
  assert.deepEqual(ownersOf('testing', ['qa']), ['qa']);
});

test('the eight perspectives keep their labels', () => {
  assert.deepEqual(PERSPECTIVES.map((p) => p.label), ['Product', 'Architect', 'QA', 'UX', 'Security', 'DevOps and infrastructure', 'Release', 'Project fit']);
});

test('fit: the Fit section and the five R-fit rules', () => {
  const fit = perspectiveByKey(FIT_KEY);
  assert.equal(FIT_KEY, 'fit');
  assert.equal(fit.label, 'Project fit');
  assert.equal(fit.checklist, 'fit');
  assert.deepEqual(fit.sections, ['fit']);
  assert.equal(fit.rules, FIT_RULES);
  assert.equal(FIT_RULES.length, 5);
  assert.match(FIT_RULES[0], /^No second component where one exists/);
  assert.match(FIT_RULES[1], /^No new engine state unless an open spec names it/);
  assert.match(FIT_RULES[2], /^Wording matches the existing surfaces/);
  assert.match(FIT_RULES[3], /^No known bug/);
  assert.match(FIT_RULES[4], /^No conflict with an open spec/);
  assert.deepEqual(sectionsFor(['architect', 'fit']).map((s) => s.title),
    ['Problem and goal', 'Decisions', 'Code layout', 'Fit', 'Testing', 'Out of scope', 'Open questions']);
  const block = perspectivesBlock(['product', 'fit']);
  for (let i = 0; i < 5; i++) assert.ok(block.includes(`\`R-fit-${i + 1}\` ${FIT_RULES[i]}`), `R-fit-${i + 1}`);
  assert.match(block, /^\d+\. Fit \(Project fit\)$/m);
  assert.match(block, /"Fit" has two lists, "Reused" and "New"/);
  assert.doesNotMatch(perspectivesBlock(['product', 'qa']), /R-fit|"Fit"/);
});

test('the shape check requires the Fit section when fit is picked, and only then', () => {
  const md = wellShapedPlan();
  assert.deepEqual(missingSections(md, ['product', 'architect', 'qa']), []);
  assert.deepEqual(missingSections(md, ['product', 'architect', 'qa', 'fit']), ['Fit']);
  const sections = (perspectives) => checkShape(md, { perspectives, size: 'medium' }).items.find((i) => i.id === 'sections');
  assert.equal(sections(['product', 'architect', 'qa']).pass, true);
  const picked = sections(['product', 'architect', 'qa', 'fit']);
  assert.equal(picked.pass, false);
  assert.match(picked.detail, /Missing: Fit/);
});

test('withProjectFit: on with a brief, dropped without one; chipsHiddenFor follows the pick', () => {
  assert.deepEqual(withProjectFit(['product', 'architect', 'qa'], true), ['product', 'architect', 'qa', 'fit']);
  assert.deepEqual(withProjectFit(['product', 'qa', 'fit'], false), ['product', 'qa']);
  assert.deepEqual(withProjectFit(['product', 'ux'], false), ['product', 'ux']);
  assert.deepEqual(chipsHiddenFor(['product', 'fit']), []);
  assert.deepEqual(chipsHiddenFor(['product']), ['fit']);
  assert.deepEqual(chipsHiddenFor(undefined), ['fit']);
});

test('normalizePerspectives: PERSPECTIVES order, Product first, duplicates collapsed', () => {
  assert.deepEqual(normalizePerspectives(['qa', 'product', 'qa']), { ok: true, perspectives: ['product', 'qa'] });
  assert.deepEqual(normalizePerspectives([]), { ok: true, perspectives: ['product'] });
});

test('normalizePerspectives rejects an unknown key, naming it and the known keys, and a non-array', () => {
  const bad = normalizePerspectives(['ops']);
  assert.equal(bad.ok, false);
  assert.match(bad.error, /ops/);
  for (const k of PERSPECTIVE_KEYS) assert.ok(bad.error.includes(k), k);
  assert.equal(normalizePerspectives('qa').ok, false);
  assert.equal(normalizePerspectives(undefined).ok, false);
});

test('perspectivesBlock for Product and QA lists only their sections and checklist', () => {
  const block = perspectivesBlock(['product', 'qa']);
  for (const line of ['1. Problem and goal (Product)', '2. Testing (QA)', '3. Out of scope (Product)', '4. Open questions']) {
    assert.ok(block.split('\n').includes(line), line);
  }
  assert.ok(block.includes('R-qa-1'));
  assert.ok(!/^\d+\. (Decisions|Code layout|Threats)/m.test(block));
  assert.ok(!block.includes('As the refiner'));
});

test('perspectivesBlock for Product, Architect and Security adds their sections and checklists', () => {
  const block = perspectivesBlock(['product', 'architect', 'security']);
  for (const title of ['Decisions', 'Code layout', 'Threats']) assert.match(block, new RegExp(`^\\d+\\. ${title}`, 'm'));
  assert.ok(block.includes('R-arch-1') && block.includes('R-sec-1'));
});

test('perspectivesBlock: refiner appends the refiner line; an invalid list gives an empty block', () => {
  assert.match(perspectivesBlock(['product', 'qa'], { refiner: true }), /As the refiner, check the plan/);
  assert.equal(perspectivesBlock(['nope']), '');
  assert.equal(perspectivesBlock(null), '');
});
