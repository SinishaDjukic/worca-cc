import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseWorcaFrontMatter, renderWorcaFrontMatter, validateWorcaFrontMatter, frontMatterFromAnswers, normalizeAnswers } from '../src/shared/spec-builder/front-matter.mjs';

const FM = { kind: 'feature', size: 'medium', signals: ['risky'], roles: ['product', 'architect', 'qa', 'ux'], flag: { key: 'customDashboard', stage: 'beta' }, levels: 'advanced', generatedBy: 'spec-builder@1' };

test('round trip: render → parse gives the same object and the body after the fence', () => {
  const md = `${renderWorcaFrontMatter(FM)}# Title\n\nBody\n`;
  const r = parseWorcaFrontMatter(md);
  assert.equal(r.ok, true);
  assert.deepEqual(r.fm, FM);
  assert.equal(r.body, '# Title\n\nBody\n');
});

test('the §3.1 sample, comments included, parses', () => {
  const md = '---\nworca:\n  kind: feature            # feature | fix\n  size: medium\n  signals: [risky]         # optional\n  roles: [product, architect, qa, ux]\n  flag: { key: customDashboard, stage: beta }   # optional\n  levels: advanced\n  generatedBy: spec-builder@1\n---\n# T\n';
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
  const fm = frontMatterFromAnswers(normalizeAnswers({ goal: 'Add X', kind: 'fix', size: 'small', roles: ['security', 'qa'] }));
  assert.deepEqual(fm, { kind: 'fix', size: 'small', signals: ['risky'], roles: ['product', 'qa', 'security'], generatedBy: 'spec-builder@1' });
});
