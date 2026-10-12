import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseWorcaFrontMatter, renderWorcaFrontMatter, validateWorcaFrontMatter, frontMatterFromAnswers, normalizeAnswers, withWaiver } from '../src/shared/spec-builder/front-matter.mjs';

const FM = { kind: 'feature', size: 'medium', signals: ['risky'], roles: ['product', 'architect', 'qa', 'ux'], flag: { key: 'customDashboard', stage: 'beta' }, levels: 'advanced', generatedBy: 'spec-builder@2' };

test('round trip: render → parse gives the same object and the body after the fence', () => {
  const md = `${renderWorcaFrontMatter(FM)}# Title\n\nBody\n`;
  const r = parseWorcaFrontMatter(md);
  assert.equal(r.ok, true);
  assert.deepEqual(r.fm, FM);
  assert.equal(r.body, '# Title\n\nBody\n');
});

test('the §3.1 sample, comments included, parses', () => {
  const md = '---\nworca:\n  kind: feature            # feature | fix\n  size: medium\n  signals: [risky]         # optional\n  roles: [product, architect, qa, ux]\n  flag: { key: customDashboard, stage: beta }   # optional\n  levels: advanced\n  generatedBy: spec-builder@2\n---\n# T\n';
  assert.deepEqual(parseWorcaFrontMatter(md).fm, FM);
});

test('unknown keys are dropped, not errors', () => {
  const r = validateWorcaFrontMatter({ ...FM, colour: 'blue' });
  assert.equal(r.ok, true);
  assert.equal('colour' in r.fm, false);
});

test('bad values are rejected with one error each', () => {
  const r = validateWorcaFrontMatter({ kind: 'epic', size: 'huge', roles: ['product', 'wizard'], signals: ['shiny'], levels: 'god' });
  assert.equal(r.ok, false);
  assert.deepEqual(r.errors, [
    'worca.kind must be one of feature, fix, refactor, infra, docs',
    'worca.size must be one of small, medium, large',
    'worca.signals has an unknown value: shiny',
    'worca.roles has an unknown role: wizard',
    'worca.levels must be one of simple, advanced, expert, all',
  ]);
});

test('roles must include product', () => {
  assert.deepEqual(validateWorcaFrontMatter({ kind: 'fix', size: 'small', roles: ['qa'] }).errors, ['worca.roles must include product']);
});

test('a spec with no worca: block → null', () => {
  assert.equal(parseWorcaFrontMatter('# Just a spec\n'), null);
  assert.equal(parseWorcaFrontMatter('---\nname: agent\n---\n# x'), null);
});

test('answers → front-matter: Security adds risky, Product is forced, the role order is canonical', () => {
  const fm = frontMatterFromAnswers(normalizeAnswers({ idea: 'Add X', kind: 'fix', size: 'small', roles: ['security', 'qa'] }));
  assert.deepEqual(fm, { kind: 'fix', size: 'small', signals: ['risky'], roles: ['product', 'qa', 'security'], generatedBy: 'spec-builder@2', mode: 'draft' });
});

test('mode and shapeWaived round-trip; checklists cannot be waived', () => {
  const fm = { kind: 'feature', size: 'medium', roles: ['product', 'qa'], generatedBy: 'spec-builder@2', mode: 'reshape',
    shapeWaived: [{ id: 'testable', reason: 'QA owns the numbers, "later"' }] };
  const md = `${renderWorcaFrontMatter(fm)}# T\n`;
  assert.deepEqual(parseWorcaFrontMatter(md).fm, fm);
  const bad = md.replace('id: testable', 'id: checklists');
  assert.match(parseWorcaFrontMatter(bad).errors[0], /checklists check can't be waived/);
  assert.equal(parseWorcaFrontMatter(withWaiver(md, 'paths', 'generated file')).fm.shapeWaived.length, 2);
  assert.equal(withWaiver(md, 'checklists', 'x'), md);
});

test('v1 specs still parse; a bad mode is an error', () => {
  const md = '---\nworca:\n  kind: fix\n  size: small\n  roles: [product]\n  generatedBy: spec-builder@1\n---\n# T\n';
  assert.equal(parseWorcaFrontMatter(md).ok, true);
  assert.deepEqual(validateWorcaFrontMatter({ kind: 'fix', size: 'small', roles: ['product'], mode: 'wild' }).errors, ['worca.mode must be one of draft, reshape']);
});

test('normalizeAnswers keeps the idea newlines (CRLF normalised) and drops goal/areas/levels', () => {
  const a = normalizeAnswers({ idea: '  line one\r\nline two\rthree\u0001  ', mode: 'reshape', goal: 'x', areas: ['a'], levels: 'all' });
  assert.equal(a.idea, 'line one\nline two\nthree');
  assert.equal(a.mode, 'reshape');
  assert.equal(normalizeAnswers({}).mode, 'draft');
  assert.deepEqual(Object.keys(a).sort(), ['flag', 'idea', 'kind', 'mode', 'roles', 'size']);
});
