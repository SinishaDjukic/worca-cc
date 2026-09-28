// test/protocol-ask-payload.test.mjs
// Spec §4: the ask FILE protocol grows a second payload shape, {form, data}, and
// the legacy {questions} shape keeps its exact behaviour — same caps, same
// tolerance, same normalization. The legacy readers are untouched; this pins that.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { classifyAskPayload, readAskFile, readQuestionsFile } from '../src/core/protocol.mjs';

const dirs = [];
async function tmp() { const d = await mkdtemp(join(tmpdir(), 'worca-cc-askpay-')); dirs.push(d); return d; }
after(async () => Promise.all(dirs.map((d) => rm(d, { recursive: true, force: true, maxRetries: 3 }))));

test('classifyAskPayload: the LEGACY shape normalizes exactly as today (caps, blanks, allowFreeText)', () => {
  const out = classifyAskPayload({ questions: [{ id: 'a', question: 'Q?', options: ['x', 'y', '', 'z', 'w', 'v'] }] });
  assert.equal(out.kind, 'questions');
  assert.deepEqual(out.questions[0].options, ['x', 'y', 'z', 'w']);
  assert.equal(out.questions[0].allowFreeText, true);
});

test('classifyAskPayload: an EMPTY legacy list is still the legacy shape (the clarifier says "nothing to ask")', () => {
  assert.deepEqual(classifyAskPayload({ questions: [] }), { kind: 'questions', questions: [] });
});

test('classifyAskPayload: the FORM shape', () => {
  const out = classifyAskPayload({ form: 'review-mockups', data: { summary: 'Two directions.' } });
  assert.deepEqual(out, { kind: 'form', form: 'review-mockups', data: { summary: 'Two directions.' } });
  assert.deepEqual(classifyAskPayload({ form: ' spaced ' }), { kind: 'form', form: 'spaced', data: {} },
    'a form with no data is an empty object, not undefined — gate 2 validates it against the schema');
});

test('classifyAskPayload: BOTH keys => the LEGACY path wins (a payload today accepts never changes meaning)', () => {
  const out = classifyAskPayload({ questions: [{ id: 'a', question: 'Q?', options: ['x', 'y'] }], form: 'f' });
  assert.equal(out.kind, 'questions');
});

test('classifyAskPayload: anything else is kind "none"', () => {
  for (const v of [null, undefined, 42, 'text', [], {}, { form: '' }, { form: 7 }, { questions: 'nope' }]) {
    assert.equal(classifyAskPayload(v).kind, 'none', JSON.stringify(v));
  }
});

test('readAskFile: missing => none/not-malformed; garbage => none/malformed; fenced JSON parses', async () => {
  const d = await tmp();
  assert.deepEqual(await readAskFile(join(d, 'nope.json')), { kind: 'none', malformed: false });
  await writeFile(join(d, 'bad.json'), 'not json at all', 'utf8');
  assert.deepEqual(await readAskFile(join(d, 'bad.json')), { kind: 'none', malformed: true });
  await writeFile(join(d, 'fenced.json'), '```json\n{"form":"f","data":{"a":1}}\n```\n', 'utf8');
  assert.deepEqual(await readAskFile(join(d, 'fenced.json')),
    { kind: 'form', form: 'f', data: { a: 1 }, malformed: false }, 'safeParseJson tolerance applies to BOTH shapes');
});

test('REGRESSION: readQuestionsFile is untouched by a form payload', async () => {
  const d = await tmp();
  const p = join(d, 'form.json');
  await writeFile(p, JSON.stringify({ form: 'f', data: {} }), 'utf8');
  assert.deepEqual(await readQuestionsFile(p), { questions: [], malformed: false },
    'the legacy reader sees no questions and does NOT report malformed — byte-for-byte today');
});
