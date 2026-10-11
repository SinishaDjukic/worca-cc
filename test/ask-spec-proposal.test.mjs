import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createSpecValidator, SPEC_ERRORS, SPEC_MAX_BYTES } from '../src/core/ask/spec-proposal.mjs';
import { renderWorcaFrontMatter } from '../src/shared/spec-builder/front-matter.mjs';
import { sectionsFor } from '../src/shared/spec-builder/roles.mjs';

const FM = { kind: 'feature', size: 'medium', roles: ['product', 'qa'], generatedBy: 'spec-builder@1' };
const good = (fm = FM) => `${renderWorcaFrontMatter(fm)}# Dark mode\n\n${sectionsFor(fm.roles).map((s) => `## ${s.n}. ${s.title}\n\nx\n`).join('\n')}`;
const PROJECT = { key: 'app-0000abcd', name: 'app', path: '/tmp/app' };
const validate = createSpecValidator({ projectOf: async (k) => (k === PROJECT.key ? PROJECT : null), estimate: (fm) => ({ recipe: 'stub', size: fm.size }) });
const ctx = { projectKey: PROJECT.key };

test('a good spec → a spec card with the validated front-matter and the estimate', async () => {
  const r = await validate({ markdown: good(), path: 'plans/dark-mode-design.md' }, ctx);
  assert.equal(r.ok, true);
  assert.equal(r.card.type, 'spec');
  assert.equal(r.card.title, 'Dark mode');
  assert.deepEqual(r.card.frontMatter, FM);
  assert.deepEqual(r.card.estimate, { recipe: 'stub', size: 'medium' });
  assert.equal(r.card.projectDir, '/tmp/app');
  assert.equal(r.card.path, 'plans/dark-mode-design.md');
});

test('a missing role section is rejected', async () => {
  const md = good().replace('## 2. Testing', '## 2. Tests');
  assert.deepEqual(await validate({ markdown: md }, ctx), { ok: false, errors: [SPEC_ERRORS.section('Testing')] });
});

test('oversize markdown is rejected', async () => {
  const md = good() + 'x'.repeat(SPEC_MAX_BYTES);
  assert.deepEqual((await validate({ markdown: md }, ctx)).errors, [SPEC_ERRORS.size]);
});

test('a path outside plans/ is rejected', async () => {
  for (const path of ['../etc/x.md', 'src/x.md', 'plans/a/b.md', 'plans/x.txt', '/abs/plans/x.md']) {
    assert.deepEqual((await validate({ markdown: good(), path }, ctx)).errors, [SPEC_ERRORS.path], path);
  }
});

test('no block, bad block, no pinned project, non-object input', async () => {
  assert.deepEqual((await validate({ markdown: '# x' }, ctx)).errors, [SPEC_ERRORS.frontMatter]);
  assert.match((await validate({ markdown: good({ ...FM, size: 'huge' }) }, ctx)).errors[0], /worca\.size/);
  assert.deepEqual((await validate({ markdown: good() }, {})).errors, [SPEC_ERRORS.project]);
  assert.deepEqual(await validate(null, ctx), { ok: false, errors: [SPEC_ERRORS.markdown] });
});
