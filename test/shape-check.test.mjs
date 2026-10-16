import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkShape, SHAPE_LABELS, SHAPE_IDS } from '../src/shared/shape/shape.mjs';
import { wellShapedPlan, WELL_SHAPED_PATHS } from './helpers/shape-plan.mjs';

const GROUND = [...WELL_SHAPED_PATHS.map((path) => ({ path, found: true, isNew: false })),
  { path: 'src/charts.mjs', found: false, isNew: true }, { path: 'test/charts.test.mjs', found: false, isNew: true }];
const shape = (md, o = {}) => checkShape(md, { perspectives: ['product', 'architect', 'qa'], size: 'medium', grounding: GROUND, ...o });
const fail = (md, o) => shape(md, o).items.filter((i) => !i.pass).map((i) => i.id);

test('the well-shaped fixture passes 8 of 8', () => {
  const r = shape(wellShapedPlan());
  assert.equal(r.ok, true);
  assert.equal(r.passed, 8);
  assert.deepEqual(r.found, [...WELL_SHAPED_PATHS]);
});

test('each check fails on its own fixture', () => {
  const good = wellShapedPlan();
  assert.deepEqual(fail(wellShapedPlan({ failing: 'testable' })), ['testable']);
  assert.deepEqual(fail(good.replace('## 5. Out of scope', '## 5. Later')), ['sections']);
  // "Maybe", not "TBD": a TBD row also trips `placeholders`
  assert.deepEqual(fail(good.replace('| 2 | The chart builder lives in `src/charts.mjs` (new). |', '| 2 | Maybe a chart builder |')), ['decisions', 'grounded']);
  assert.deepEqual(fail(good.replace('| 2 | The chart builder lives in `src/charts.mjs` (new). |', '| 2 | TBD |')), ['decisions', 'placeholders', 'grounded']);
  assert.deepEqual(fail(good.replace('## 6. Open questions', '```\n## 6. Open questions\n```')), ['sections']);   // a fenced heading is not a section
  assert.equal(fail(good.replace('People want a chart', 'People want a chart (see <https://example.com/x>)')).length, 0);
  assert.deepEqual(fail(good.replace('`src/app.mjs`: registers', '`src/nope.mjs`: registers')), ['paths']);
  assert.deepEqual(fail(good.replace('`test/charts.test.mjs` (new)', '`test/other.test.mjs` (new)')), ['tests']);
  assert.deepEqual(fail(good.replace('People want a chart', 'TODO: people want a chart')), ['placeholders']);
  assert.deepEqual(fail(good.replace('- [ ] R-arch-1 Charts are stored as definitions, not images.\n', '')), ['checklists']);
  assert.deepEqual(fail(good, { grounding: GROUND.filter((g) => g.path !== 'src/app.mjs').concat({ path: 'src/app.mjs', found: false }) }), ['paths', 'grounded']);
});

test('grounding is matched by path:line, in either order (R21)', () => {
  const bad = { path: 'src/app.mjs', line: 999, found: false, isNew: false };
  const line = '- `src/app.mjs:999`: past the end of the file.\n';
  const anchor = '- `src/app.mjs`: registers';                 // the plain, found mention in Code layout
  for (const where of ['before', 'after']) {
    // the bad :999 reference sits before or after the good plain mention, in the same section
    const md = wellShapedPlan().replace(anchor, where === 'before' ? `${line}${anchor}` : anchor)
      .replace('\n### Checklist\n\n- [ ] R-arch-1', where === 'after' ? `${line}\n### Checklist\n\n- [ ] R-arch-1` : '\n### Checklist\n\n- [ ] R-arch-1');
    const r = shape(md, { grounding: [...GROUND, bad] });
    assert.deepEqual(r.items.filter((i) => !i.pass).map((i) => i.id), ['paths']);
    assert.match(r.items.find((i) => i.id === 'paths').detail, /src\/app\.mjs:999/);
  }
  assert.equal(shape(wellShapedPlan(), { grounding: null }).items.find((i) => i.id === 'paths').pass, true);   // null: not checked
});

test('sections are perspective-dependent; duplicate ids fail checklists; waivers count except checklists', () => {
  assert.deepEqual(checkShape(wellShapedPlan(), { perspectives: ['product', 'architect', 'qa', 'security'], grounding: GROUND })
    .items.filter((i) => !i.pass).map((i) => i.id), ['sections', 'checklists']);
  assert.deepEqual(fail(wellShapedPlan().replace('R-qa-2', 'R-qa-1')), ['checklists']);
  const r = shape(wellShapedPlan({ failing: 'testable' }), { waived: [{ id: 'testable' }] });
  assert.equal(r.ok, true);
  assert.equal(r.items.find((i) => i.id === 'testable').waived, true);
  const noList = shape(wellShapedPlan().replace('- [ ] R-arch-1 Charts are stored as definitions, not images.\n', ''), { waived: [{ id: 'checklists' }] });
  assert.equal(noList.ok, false);
  assert.equal(noList.items.find((i) => i.id === 'checklists').waivable, false);
  assert.equal(noList.items.find((i) => i.id === 'checklists').waived, undefined);
});

test('a Why column is allowed: decisions reads the Decision column, grounded the whole row (R25)', () => {
  const md = wellShapedPlan().replace('| # | Decision |\n|---|---|', '| # | Decision | Why |\n|---|---|---|')
    .replace('never as images. |', 'never as images. | Smaller rows. |').replace('`src/charts.mjs` (new). |', '`src/charts.mjs` (new). | One place. |');
  assert.deepEqual(fail(md), []);
  assert.deepEqual(fail(md.replace('| 2 | The chart builder lives in `src/charts.mjs` (new). | One place. |', '| 2 | Maybe a builder | `src/app.mjs` has room |')), ['decisions']);
});

test('the check ids are the eight labelled checks, and no label says "role"', () => {
  assert.deepEqual(SHAPE_IDS, ['sections', 'testable', 'decisions', 'paths', 'tests', 'placeholders', 'checklists', 'grounded']);
  assert.deepEqual(Object.keys(SHAPE_LABELS).sort(), [...SHAPE_IDS].sort());
  assert.ok(Object.values(SHAPE_LABELS).every((l) => !/\brole/i.test(l)));
});

test('a stray checklist id names a perspective the plan does not have', () => {
  const md = wellShapedPlan().replace('- [ ] R-qa-2', '- [ ] R-sec-1');
  const r = shape(md);
  assert.match(r.items.find((i) => i.id === 'checklists').detail, /R-sec-1 names a perspective this plan does not have/);
});
