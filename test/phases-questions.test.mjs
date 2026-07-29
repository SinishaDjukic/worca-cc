// test/phases-questions.test.mjs
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { questionsPromptBlock } from '../src/core/phases.mjs';
import { readQuestionsFile } from '../src/core/protocol.mjs';
import { runClaude } from '../src/core/claude-runner.mjs';

const dirs = [];
async function tmp() { const d = await mkdtemp(join(tmpdir(), 'worca-cc-qph-')); dirs.push(d); return d; }
after(async () => Promise.all(dirs.map((d) => rm(d, { recursive: true, force: true }))));

test('questionsPromptBlock: disabled => empty string (prompts byte-identical)', () => {
  assert.equal(questionsPromptBlock({}), '');
  assert.equal(questionsPromptBlock({ questionsEnabled: false, questionsFile: '/x.json' }), '');
  assert.equal(questionsPromptBlock(null), '');
});

test('questionsPromptBlock: round 1 carries the path, the STOP rule, and MOCK_ASK', () => {
  const block = questionsPromptBlock({ questionsEnabled: true, questionsFile: '/pd/questions-1-s0_0-c1-r1.json' });
  assert.match(block, /## Asking the user \(enabled\)/);
  assert.match(block, /\/pd\/questions-1-s0_0-c1-r1\.json/);
  assert.match(block, /STOP immediately/);
  assert.match(block, /^MOCK_ASK: \/pd\/questions-1-s0_0-c1-r1\.json$/m);
});

test('questionsPromptBlock: later rounds inject answers and drop MOCK_ASK', () => {
  const block = questionsPromptBlock({
    questionsEnabled: true,
    questionsFile: '/pd/questions-1-s0_0-c1-r2.json',
    questionsAnswered: [{ id: 'q1', question: 'Pick?', choice: 'B' }],
  });
  assert.match(block, /Already answered — DO NOT ask these again/);
  assert.match(block, /\*\*Q:\*\* Pick\? — \*\*A:\*\* B/);
  assert.doesNotMatch(block, /MOCK_ASK/);
});

test('questionsPromptBlock: exhausted rounds => closing note, no file path', () => {
  const block = questionsPromptBlock({
    questionsEnabled: true, questionsFile: null,
    questionsAnswered: [{ id: 'q1', question: 'Pick?', choice: 'B' }],
  });
  assert.match(block, /No more question rounds/);
  assert.doesNotMatch(block, /questions-.*\.json/);
});

test('readQuestionsFile: missing => empty, not malformed; bad JSON => malformed; valid normalizes with clarify caps', async () => {
  const d = await tmp();
  assert.deepEqual(await readQuestionsFile(join(d, 'nope.json')), { questions: [], malformed: false });
  await writeFile(join(d, 'bad.json'), 'not json at all', 'utf8');
  assert.deepEqual(await readQuestionsFile(join(d, 'bad.json')), { questions: [], malformed: true });
  await writeFile(join(d, 'q.json'), JSON.stringify({
    questions: [{ id: 'a', question: 'Q?', options: ['x', 'y', '', 'z', 'w', 'v'] }],
  }), 'utf8');
  const { questions, malformed } = await readQuestionsFile(join(d, 'q.json'));
  assert.equal(malformed, false);
  assert.equal(questions.length, 1);
  assert.deepEqual(questions[0].options, ['x', 'y', 'z', 'w']); // blanks dropped, capped at 4
  assert.equal(questions[0].allowFreeText, true);
});

test('runMock MOCK_ASK: writes one canned question and performs NO role side effects', async () => {
  const d = await tmp();
  const qPath = join(d, 'questions-0-n1-c1-r1.json');
  const outPath = join(d, 'plan.md');
  const { exitCode } = await runClaude({
    cwd: d, mock: true,
    prompt: `MOCK_ROLE: planner-plan\nMOCK_OUT: ${outPath}\nMOCK_ASK: ${qPath}\n`,
  });
  assert.equal(exitCode, 0);
  const { questions } = await readQuestionsFile(qPath);
  assert.equal(questions.length, 1);
  await assert.rejects(readFile(outPath, 'utf8'), undefined, 'role side effect must be skipped when asking');
});
