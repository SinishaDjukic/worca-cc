import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createSpecValidator, SPEC_ERRORS, SPEC_MAX_BYTES } from '../src/core/ask/spec-proposal.mjs';
import { renderWorcaFrontMatter } from '../src/shared/spec-builder/front-matter.mjs';
import { sectionsFor } from '../src/shared/spec-builder/roles.mjs';
import { mockSpecMarkdown, MOCK_SPEC_QUESTIONS } from '../src/core/spec-builder/mock-spec.mjs';

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

const ground = async () => [{ path: 'src/app.mjs', found: true }, { path: 'src/store.mjs', found: true }, { path: 'test/app.test.mjs', found: true }];
const parent = createSpecValidator({ projectOf: async () => PROJECT, checkPaths: ground });

test('questions xor markdown', async () => {
  assert.deepEqual((await validate({ questions: MOCK_SPEC_QUESTIONS, markdown: good() }, ctx)).errors, [SPEC_ERRORS.both]);
  assert.deepEqual((await validate({}, ctx)).errors, [SPEC_ERRORS.markdown]);
  const r = await validate({ questions: MOCK_SPEC_QUESTIONS }, ctx);
  assert.equal(r.card.type, 'spec-questions');
  assert.deepEqual(r.card.questions, MOCK_SPEC_QUESTIONS.map((q) => ({ ...q, options: [...q.options] })));
});

test('question limits', async () => {
  const q = MOCK_SPEC_QUESTIONS[0];
  assert.deepEqual((await validate({ questions: [q, { ...q, id: 'b' }, { ...q, id: 'c' }, { ...q, id: 'd' }] }, ctx)).errors, [SPEC_ERRORS.questions]);
  assert.match((await validate({ questions: [{ ...q, options: ['only one'] }] }, ctx)).errors[0], /options must be 2–4/);
  assert.match((await validate({ questions: [{ ...q, why: '' }] }, ctx)).errors[0], /why is required/);
});

test('the child rejects a shape failure until its budget is spent; the parent mints it with shape and grounding', async () => {
  const child = createSpecValidator({ projectOf: async () => PROJECT, checkPaths: ground, enforceShape: true, shapeBudget: 1 });
  const md = mockSpecMarkdown({ failing: 'testable' });
  const first = await child({ markdown: md }, ctx);
  assert.equal(first.ok, false);
  assert.match(first.errors[0], /^shape check testable failed/);
  assert.equal((await child({ markdown: md }, ctx)).ok, true);
  const card = (await parent({ markdown: md }, ctx)).card;
  assert.equal(card.shape.ok, false);
  assert.equal(card.grounding.length, 3);
  assert.equal((await parent({ markdown: mockSpecMarkdown() }, ctx)).card.shape.ok, true);
});

test('no grounding reader or no resolved project: grounding is null, and a good spec is not rejected (R21)', async () => {
  for (const child of [createSpecValidator({ projectOf: async () => PROJECT, enforceShape: true }),
    createSpecValidator({ projectOf: async () => null, checkPaths: ground, enforceShape: true })]) {
    const r = await child({ markdown: mockSpecMarkdown() }, ctx);
    assert.equal(r.ok, true);
    assert.equal(r.card.grounding, null);
    assert.equal(r.card.shape.ok, true);
  }
});
