// test/step-questions-forms.test.mjs
// Spec §9: a form ask persists as the FULL RESOLVED SNAPSHOT into the same
// schemaless JSON TEXT columns the legacy Q&A uses — no migration, and every
// legacy reader keeps working on a form row (E13). WORCA_HOME is mandatory:
// getDb() migrates whatever home it finds.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { useTempHome } from './helpers/temp-home.mjs';
import { seedPipelineRow } from './helpers/db-seed.mjs';
import { getDb } from '../src/core/db.mjs';
import {
  writeClarify, readClarifyRow, writeStepQuestions, readStepQuestions, readPipelineExtras,
} from '../src/core/artifacts.mjs';

useTempHome(after);

/** The pipelines row every clarify / step_questions write needs (FK): the same raw
 *  insert the clarify and delete fixtures use (db-seed.mjs), keyed on a caller-chosen id. */
function pipeline(id) { seedPipelineRow({ id, projectKey: 'demo-00000001' }); return id; }

const ASK = {
  kind: 'form', askId: 'questions-x_n1_1-r1', form: 'review-mockups', version: 2, title: 'Review mockups',
  surface: 'any',
  data: { summary: 'Two directions.', images: [{ id: 'a', file: 'mockups/a.png' }] },
  layout: [{ widget: 'gallery', bind: 'data.images', field: 'picked' }],
  answerSchema: { type: 'object', required: ['picked'], properties: { picked: { type: 'string', enum: ['a'] } } },
  fileRefs: [{ path: 'data.images[0].file', rel: 'mockups/a.png' }],
  files: [{ index: 0, rel: 'mockups/a.png', name: 'a.png', mime: 'image/png', bytes: 12, sha256: 'b'.repeat(64) }],
};
const ANSWER = { kind: 'form', form: 'review-mockups', version: 2, values: { picked: 'a' } };

test('step_questions: a form round round-trips the WHOLE ask plus its values', async () => {
  const id = pipeline('p-form-1');
  await writeStepQuestions(id, 'x:n1:1', 1, { agentKey: 'implementer', nodeId: 'n1', questions: ASK });
  await writeStepQuestions(id, 'x:n1:1', 1, { agentKey: 'implementer', nodeId: 'n1', answers: ANSWER });
  const [row] = readStepQuestions(id);
  assert.equal(row.nodeId, 'n1');
  assert.equal(row.round, 1);
  assert.equal(row.ask.kind, 'form');
  assert.equal(row.ask.askId, 'questions-x_n1_1-r1', 'X3: History builds its file URLs from the PERSISTED askId');
  assert.equal(row.ask.surface, 'any', 'X3: surface survives the round trip');
  assert.equal('id' in row.ask, false, 'the question id is the only field the persisted ask drops');
  assert.deepEqual(row.ask.layout, ASK.layout);
  assert.deepEqual(row.ask.answerSchema, ASK.answerSchema);
  assert.deepEqual(row.ask.fileRefs, ASK.fileRefs, 'X16: the lookup table survives the round trip');
  assert.deepEqual(row.ask.files, ASK.files);
  assert.equal(row.ask.fileRefs.length, row.ask.files.length, 'fileRefs[i] still lines up with files[i]');
  assert.deepEqual(row.ask.values, { picked: 'a' }, '§9: the snapshot carries the answer');
  assert.deepEqual(row.formAnswer, { form: 'review-mockups', version: 2, values: { picked: 'a' } });
  assert.deepEqual(row.questions, [], 'the legacy arrays stay empty — every existing reader is unchanged');
  assert.deepEqual(row.answers, []);
});

test('step_questions: an UNANSWERED form round has ask.values === null', async () => {
  const id = pipeline('p-form-2');
  await writeStepQuestions(id, 'x:n1:1', 1, { agentKey: 'a', nodeId: 'n1', questions: ASK });
  const [row] = readStepQuestions(id);
  assert.equal(row.ask.values, null);
  assert.equal(row.formAnswer, null);
});

test('REGRESSION: a LEGACY row is unchanged and gains no ask key', async () => {
  const id = pipeline('p-legacy-1');
  await writeStepQuestions(id, 'x:n1:1', 1, { agentKey: 'a', nodeId: 'n1',
    questions: { questions: [{ id: 'q1', question: 'Q?', options: ['A', 'B'], allowFreeText: true }] } });
  await writeStepQuestions(id, 'x:n1:1', 1, { agentKey: 'a', nodeId: 'n1',
    answers: { answers: [{ id: 'q1', question: 'Q?', choice: 'B' }] } });
  const [row] = readStepQuestions(id);
  assert.equal(row.questions.length, 1);
  assert.deepEqual(row.answers, [{ id: 'q1', question: 'Q?', choice: 'B' }]);
  assert.equal('ask' in row, false, 'a legacy row gains NO key — its wire shape is byte-identical to today');
  assert.equal('formAnswer' in row, false);
  assert.deepEqual(row, { stepKey: 'x:n1:1', round: 1, nodeId: 'n1', agentKey: 'a',
    questions: [{ id: 'q1', question: 'Q?', options: ['A', 'B'], allowFreeText: true }],
    answers: [{ id: 'q1', question: 'Q?', choice: 'B' }] }, 'the exact legacy row shape (the pin test/step-questions-db.test.mjs also holds)');
});

test('clarify: the same shape, and readPipelineExtras exposes it beside the legacy halves', async () => {
  const id = pipeline('p-form-3');
  await writeClarify(id, { questions: ASK });
  await writeClarify(id, { answers: ANSWER });
  const rowRaw = readClarifyRow(id);
  assert.equal(rowRaw.questions.kind, 'form', 'readClarifyRow keeps returning the RAW parsed objects');
  const extras = readPipelineExtras(id);
  assert.equal(extras.clarify.ask.form, 'review-mockups');
  assert.deepEqual(extras.clarify.ask.values, { picked: 'a' });
  assert.deepEqual(extras.clarify.questions, [], 'a form ask contributes no legacy questions');
  assert.deepEqual(extras.clarify.answers, []);
  assert.ok(Array.isArray(extras.reviews));
  assert.ok(Array.isArray(extras.stepQuestions));
});

test('REGRESSION: a legacy clarify row still unwraps to plain arrays', async () => {
  const id = pipeline('p-legacy-2');
  await writeClarify(id, { questions: { questions: [{ id: 'q1', question: 'Q?', options: ['A'] }] } });
  await writeClarify(id, { answers: { answers: [{ id: 'q1', question: 'Q?', choice: 'A' }] } });
  const extras = readPipelineExtras(id);
  assert.equal(extras.clarify.questions.length, 1);
  assert.equal(extras.clarify.answers[0].choice, 'A');
  assert.equal('ask' in extras.clarify, false, 'a legacy clarify row gains no key');
  assert.deepEqual(extras.clarify, { questions: [{ id: 'q1', question: 'Q?', options: ['A'] }],
    answers: [{ id: 'q1', question: 'Q?', choice: 'A' }] });
});

test('NO MIGRATION: the two tables still have exactly their v11 columns', () => {
  const cols = (t) => getDb().prepare(`PRAGMA table_info(${t})`).all().map((c) => c.name).sort();
  assert.deepEqual(cols('clarify'), ['answers', 'pipeline_id', 'questions']);
  assert.deepEqual(cols('step_questions'),
    ['agent_key', 'answers', 'node_id', 'pipeline_id', 'questions', 'round', 'step_key']);
});
