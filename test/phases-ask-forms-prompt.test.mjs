// test/phases-ask-forms-prompt.test.mjs
// Spec §4's prompt contract, and the one thing that matters more than the new
// text: an agent with NO forms must see today's bytes. test/phases-questions.test.mjs
// and test/graph-prompt-parity.test.mjs are the other half of that pin (the 11
// shipped sidecars declare no forms, so their snapshots must not move).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { questionsPromptBlock, askFormsBlock, formRepairBlock, runOpts } from '../src/core/phases.mjs';

const FORM = {
  version: 2, title: 'Review mockups',
  data: { type: 'object', required: ['images'], properties: { images: { type: 'array', items: { type: 'object' } } } },
  answer: { type: 'object', required: ['verdict'], properties: { verdict: { type: 'string', enum: ['approve', 'changes'] } } },
  layout: [{ widget: 'select', field: 'verdict' }],
  example: { images: [{ id: 'a', file: 'mockups/a.png' }] },
};
const FORMS = { 'review-mockups': FORM };

test('askFormsBlock: empty in, empty out — the no-forms path costs zero bytes', () => {
  assert.equal(askFormsBlock(null), '');
  assert.equal(askFormsBlock({}), '');
  assert.equal(askFormsBlock(undefined, { path: '/pd/q.json' }), '');
});

test('askFormsBlock: ids, version, title, BOTH schemas and the example', () => {
  const b = askFormsBlock(FORMS, { path: '/pd/questions-x-n1-c1-r1.json' });
  assert.match(b, /## Forms you may ask with/);
  assert.match(b, /`review-mockups`/);
  assert.match(b, /version 2/);
  assert.match(b, /Review mockups/);
  assert.match(b, /\{"form":"<id>","data":\{…\}\}/, 'the payload shape is spelled out');
  assert.match(b, /\/pd\/questions-x-n1-c1-r1\.json/);
  assert.match(b, /"required": \[\s*"images"\s*\]/, 'the data schema is rendered');
  assert.match(b, /"approve"/, 'the answer schema is rendered');
  assert.match(b, /mockups\/a\.png/, 'the example is rendered');
  assert.match(b, /\{"form","version","values"\}/, 'what comes back is named');
  assert.equal(askFormsBlock(FORMS).includes('write {"form"'), false,
    'with no path (the clarifier: its Ports block names the file) the write line is omitted');
});

test('questionsPromptBlock: WITHOUT askForms the block is byte-identical to today', () => {
  const ctx = { questionsEnabled: true, questionsFile: '/pd/q-r1.json' };
  const before = questionsPromptBlock(ctx);
  assert.equal(questionsPromptBlock({ ...ctx, askForms: null }), before);
  assert.equal(questionsPromptBlock({ ...ctx, askForms: {} }), before);
  assert.equal(questionsPromptBlock({ ...ctx, formAnswers: [] }), before);
  assert.match(before, /^MOCK_ASK: \/pd\/q-r1\.json$/m, 'today\'s marker is still last');
});

test('questionsPromptBlock: WITH askForms the forms section follows the legacy directive', () => {
  const b = questionsPromptBlock({ questionsEnabled: true, questionsFile: '/pd/q-r1.json', askForms: FORMS });
  assert.match(b, /## Asking the user \(enabled\)/);
  assert.match(b, /STOP immediately/, 'the legacy directive survives unchanged');
  assert.match(b, /## Forms you may ask with/);
  assert.ok(b.indexOf('STOP immediately') < b.indexOf('## Forms you may ask with'), 'legacy first, forms after');
  assert.match(b, /^MOCK_ASK: \/pd\/q-r1\.json$/m);
});

test('questionsPromptBlock: prior FORM answers come back as the exact resume payload', () => {
  const b = questionsPromptBlock({
    questionsEnabled: true, questionsFile: '/pd/q-r2.json', askForms: FORMS,
    formAnswers: [{ form: 'review-mockups', version: 2, values: { verdict: 'changes' } }],
  });
  assert.match(b, /## Your form answers/);
  assert.match(b, /"form": "review-mockups"/);
  assert.match(b, /"verdict": "changes"/);
  assert.doesNotMatch(b, /^MOCK_ASK:/m, 'a resumed round drops MOCK_ASK exactly as a legacy resume does');
});

test('formRepairBlock: absent => empty; present => the errors, the schema and the SAME file', () => {
  assert.equal(formRepairBlock({}), '');
  assert.equal(formRepairBlock(null), '');
  const b = formRepairBlock({ formRepair: {
    form: 'review-mockups',
    errors: [{ path: 'data.images', code: 'required', message: 'images is required' }],
    schema: FORM.data, file: '/pd/q-r1.json',
  } });
  assert.match(b, /## Your form ask was refused/);
  assert.match(b, /review-mockups/);
  assert.match(b, /- data\.images: images is required/);
  assert.match(b, /"required": \[\s*"images"\s*\]/);
  assert.match(b, /\/pd\/q-r1\.json/);
});

test('runOpts: the repair block rides the prompt, and is empty when there is nothing to repair', () => {
  const base = { projectDir: '/p', claudeOpts: {} };
  const plain = runOpts(base, { role: 'r', prompt: 'BODY', systemPrompt: 's', allowedTools: [] });
  assert.equal(plain.prompt, 'BODY', 'no questions, no repair => the prompt is untouched');
  const repairing = runOpts({ ...base, formRepair: { form: 'f', errors: [], schema: {}, file: '/pd/q.json' } },
    { role: 'r', prompt: 'BODY', systemPrompt: 's', allowedTools: [] });
  assert.match(repairing.prompt, /^BODY/);
  assert.match(repairing.prompt, /## Your form ask was refused/);
});
