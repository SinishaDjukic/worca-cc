import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ROLES, SECTIONS, sectionsFor, missingSections, splitSections, blankFences, ownersOf } from '../src/shared/spec-builder/roles.mjs';

test('every role has at least one section, and every section key is known', () => {
  const keys = new Set(SECTIONS.map((s) => s.key));
  for (const r of ROLES) {
    assert.ok(r.sections.length > 0, r.key);
    for (const s of r.sections) assert.ok(keys.has(s), `${r.key} → ${s}`);
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

test('every role but Product has a unique checklist prefix', () => {
  const prefixes = ROLES.filter((r) => r.key !== 'product').map((r) => r.checklist);
  assert.ok(prefixes.every((p) => /^[a-z]+$/.test(p)));
  assert.equal(new Set(prefixes).size, prefixes.length);
  assert.equal(ROLES.find((r) => r.key === 'product').checklist, undefined);
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
