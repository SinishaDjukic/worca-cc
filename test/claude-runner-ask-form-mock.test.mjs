// test/claude-runner-ask-form-mock.test.mjs
// The offline mock's ONE new marker (spec §4, E16 / ruling X10): MOCK_ASK_FORM carries
// a one-line {"form","data"} payload that is written VERBATIM — to MOCK_ASK by a
// producer, to MOCK_OUT by the clarify role. Without it, today's canned bodies are
// written byte for byte; an unparseable marker degrades to them, never throws.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runClaude } from '../src/core/claude-runner.mjs';

const tmp = () => mkdtemp(join(tmpdir(), 'worca-ask-form-mock-'));
const FORM = { form: 'review-mockups', data: { summary: 'Two directions.', images: [{ id: 'a', file: 'mockups/a.png' }] } };

test('producer arm: MOCK_ASK + MOCK_ASK_FORM writes the form payload verbatim and stops', async () => {
  const dir = await tmp();
  const file = join(dir, 'q-r1.json');
  const logs = [];
  const out = await runClaude({ cwd: dir, mock: true, systemPrompt: 'MOCK_ROLE: implementer\n',
    prompt: `Do the work.\n\nMOCK_ASK: ${file}\nMOCK_ASK_FORM: ${JSON.stringify(FORM)}\n`, onEvent: (e) => logs.push(e) });
  assert.deepEqual(out, { text: '[mock] asked questions', exitCode: 0 }, 'the resolved text the ask-mock pins read is unchanged');
  assert.deepEqual(JSON.parse(await readFile(file, 'utf8')), FORM);
  assert.ok(logs.some((e) => e.type === 'assistant' && /form ask written/.test(e.text)), 'the log line names the form arm');
});

test('producer arm: WITHOUT the form marker the canned questions body is byte-identical to today', async () => {
  const dir = await tmp();
  const file = join(dir, 'q-r1.json');
  await runClaude({ cwd: dir, mock: true, systemPrompt: 'MOCK_ROLE: implementer\n', prompt: `Work.\n\nMOCK_ASK: ${file}\n`, onEvent: () => {} });
  assert.equal(await readFile(file, 'utf8'), JSON.stringify({
    questions: [{ id: 'q1', question: 'Mock question from implementer?', options: ['Option A', 'Option B'], allowFreeText: true }],
  }, null, 2) + '\n');
});

test('producer arm: an UNPARSEABLE form marker degrades to the canned body, never throws', async () => {
  const dir = await tmp();
  const file = join(dir, 'q-r1.json');
  await runClaude({ cwd: dir, mock: true, systemPrompt: 'MOCK_ROLE: implementer\n',
    prompt: `Work.\n\nMOCK_ASK: ${file}\nMOCK_ASK_FORM: {not json\n`, onEvent: () => {} });
  assert.ok(Array.isArray(JSON.parse(await readFile(file, 'utf8')).questions));
});

test('clarify arm: MOCK_ROLE clarify + MOCK_OUT + MOCK_ASK_FORM writes the form to the answers port', async () => {
  const dir = await tmp();
  const out = join(dir, 'clarify.json');
  const logs = [];
  const r = await runClaude({ cwd: dir, mock: true,
    systemPrompt: `You clarify.\n\nMOCK_ROLE: clarify\nMOCK_ASK_FORM: ${JSON.stringify(FORM)}\n`,
    prompt: `MOCK_ROLE: clarify\nMOCK_OUT: ${out}\nMOCK_PRIOR: 0\n`, onEvent: (e) => logs.push(e) });
  assert.equal(r.exitCode, 0);
  assert.deepEqual(JSON.parse(await readFile(out, 'utf8')), FORM);
  assert.ok(logs.some((e) => e.type === 'assistant' && /asking with a form/.test(e.text)));
});

test('clarify arm: without the form marker the canned two questions are written as today', async () => {
  const dir = await tmp();
  const out = join(dir, 'clarify.json');
  await runClaude({ cwd: dir, mock: true, systemPrompt: 'MOCK_ROLE: clarify\n',
    prompt: `MOCK_OUT: ${out}\nMOCK_PRIOR: 0\n`, onEvent: () => {} });
  const body = JSON.parse(await readFile(out, 'utf8'));
  assert.equal(body.questions.length, 2);
  assert.equal(body.questions[0].id, 'invalid-input');
});
