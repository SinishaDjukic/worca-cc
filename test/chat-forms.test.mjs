// test/chat-forms.test.mjs — the chat surface for a kind:'form' ask (spec §8):
// the rendered notification (this task) and the /answer grammar (Task 6).
// Pure renderer + router-against-fakes; no server, no orchestrator.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { useTempHome } from './helpers/temp-home.mjs';
import { worcaHome } from '../src/core/projects.mjs';
import { createChatContext } from '../src/core/chat/chat-context.mjs';
import { createCommandRouter } from '../src/core/chat/command-router.mjs';
import { renderQuestion } from '../src/core/chat/renderers.mjs';
import { CHAT_PROJECTION_MAX } from '../src/core/ask-projection.mjs';

useTempHome(after);

const META = { runId: 'run-aaaa2951', title: 'Redesign the empty state' };
const text = (msg) => msg.body.map((s) => s.value).join('\n');

/** A kind:'form' 'question' event (the P2 envelope, ruling X1). */
function formQuestion(over = {}) {
  return {
    id: 'form-x:n_a:1-r1', kind: 'form', agent: 'Designer', nodeId: 'n_a',
    askId: 'form-x_n_a_1-r1',
    form: 'review-mockups', version: 1, title: 'Review mockups', surface: 'any',
    data: { summary: 'Two directions.', images: [{ id: 'a', caption: 'Option A' }, { id: 'b', caption: 'Option B' }] },
    layout: [
      { widget: 'markdown', bind: 'data.summary' },
      { widget: 'select', field: 'verdict', label: 'Verdict' },
      { widget: 'multiselect', field: 'tags', label: 'Tags' },
    ],
    answerSchema: { type: 'object', required: ['verdict'], properties: {
      verdict: { type: 'string', enum: ['approve', 'changes'], default: 'approve' },
      tags: { type: 'array', items: { type: 'string', enum: ['spacing', 'colour', 'copy'] } },
    } },
    files: [],
    ...over,
  };
}

test('renderQuestion: a form ask names the form, prints the projection and the reply command', () => {
  const msg = renderQuestion(META, formQuestion());
  const body = text(msg);
  assert.equal(msg.severity, 'warning');
  assert.match(body, /\*\*Run:\*\* `\*2951`/, 'the run ref is the last 4 id chars');
  assert.match(body, /\*\*Status:\*\* waiting on a form from Designer/);
  assert.match(body, /Review mockups — Designer/, "projectForm's title line");
  assert.match(body, /Two directions\./, 'a display widget contributes its text');
  assert.match(body, /1\. Verdict \{verdict\}/);
  assert.match(body, /2\. Tags \{tags\}/);
  // X9's exact reply format, for the first <= 3 fields with no `when`.
  assert.match(body, /Reply: \/answer \*2951 verdict=<value> \| tags=<a,b>/);
});

test('renderQuestion: a surface:"web" form prints the projection and NO reply command', () => {
  const body = text(renderQuestion(META, formQuestion({ surface: 'web', title: 'Pick a mockup' })));
  assert.match(body, /Pick a mockup — Designer/);
  assert.match(body, /Answer this form in the worca web UI\./);
  assert.equal(/\/answer/.test(body), false, 'a web-only form offers no chat grammar');
});

test('renderQuestion: the projection is capped, and the reply command survives the cap', () => {
  const big = formQuestion({ data: { summary: 'x'.repeat(20000), images: [] } });
  const body = text(renderQuestion(META, big));
  assert.ok(body.length < CHAT_PROJECTION_MAX + 600, `chat message is ${body.length} chars`);
  assert.match(body, /Reply: \/answer \*2951 /, 'the clip never eats the reply command');
  assert.match(body, /1\. Verdict \{verdict\}/, 'the clip never eats the prompts');
  assert.equal((body.match(/^ {3}…$/gm) || []).length, 1, 'exactly one … marker (X9)');
});

test('renderQuestion: a form envelope projectForm cannot render still notifies, by title', () => {
  // A review-list whose schema lost `items` makes promptFields throw (schema.items.properties).
  const junk = formQuestion({
    layout: [{ widget: 'review-list', field: 'r', bind: 'data.images', label: 'R' }],
    answerSchema: { type: 'object', properties: { r: { type: 'array' } } },
  });
  const body = text(renderQuestion(META, junk));
  assert.match(body, /\*\*Status:\*\* waiting on a form from Designer/);
  assert.match(body, /Review mockups — Designer/);
});

test('renderQuestion: clarify and gate arms are byte-identical to before', () => {
  const clarify = text(renderQuestion(META, { kind: 'clarify', questions: [
    { id: 'q1', question: 'Which database?', options: ['postgres', 'sqlite'] },
  ] }));
  assert.match(clarify, /\*\*Status:\*\* has questions/);
  assert.match(clarify, /\*\*Q1\.\*\* Which database\?/);
  assert.match(clarify, /\/answer \*2951 1$/m);
  const gate = text(renderQuestion(META, { kind: 'gate', issues: [{ severity: 'major', title: 'Empty input' }] }));
  assert.match(gate, /\*\*Status:\*\* waiting for approval/);
  assert.match(gate, /\/approve \*2951 to continue/);
});

// ── /answer grammar (P1 C9/C10, ruling X8) ─────────────────────────────────────

const CONFIG = { allowedChatIds: '42' };

/** `answer` may return, or throw — ruling X2 makes a gate-3 rejection a THROW. */
function fixture(pq, { answer } = {}) {
  const calls = [];
  const actions = {
    listRuns: () => [{ runId: 'run-aaaa2951', pipelineId: 'pipe-aaaa2951', title: 'Redesign',
      status: 'running', kind: 'run', projectDir: '/x/worca' }],
    runState: () => null,
    pendingQuestion: () => pq,
    answer: async (runId, id, payload) => { calls.push([runId, id, payload]); if (answer) return answer(payload); return undefined; },
    stop: async () => {}, pause: async () => {}, resume: async () => ({ ok: true }),
    history: async () => [], listProjects: async () => [],
  };
  const chatContext = createChatContext(join(worcaHome(), `cf-${Math.random().toString(36).slice(2)}.json`));
  const router = createCommandRouter({ actions, chatContext, logger: () => {} });
  const send = (t) => router.handleIncoming({
    plugin: 'p', channelId: 'main', platform: 'testchat',
    channelConfig: CONFIG, msg: { chatId: '42', userId: 'u1', text: t, meta: {} },
  });
  return { send, calls };
}

const rejects = (errors) => () => {
  const err = new Error('invalid answer');
  err.code = 'INVALID_ANSWER';
  err.errors = errors;
  throw err;
};

test('/answer: field=value pairs, pipe-separated, reach orch.answer as { values }', async () => {
  const { send, calls } = fixture(formQuestion());
  const reply = text(await send('/answer *2951 verdict=changes | tags=spacing,colour'));
  assert.deepEqual(calls.at(-1), ['run-aaaa2951', 'form-x:n_a:1-r1',
    { values: { verdict: 'changes', tags: ['spacing', 'colour'] } }]);
  assert.match(reply, /Answered the `review-mockups` form/);
});

test('/answer: the run ref is optional when exactly one run is live', async () => {
  const { send, calls } = fixture(formQuestion());
  await send('/answer verdict=approve');
  assert.deepEqual(calls.at(-1)[2], { values: { verdict: 'approve' } });
});

test('/answer: a ONE-FIELD form still takes the bare positional form', async () => {
  const single = formQuestion({
    layout: [{ widget: 'textarea', field: 'notes', label: 'Notes' }],
    answerSchema: { type: 'object', required: ['notes'], properties: { notes: { type: 'string' } } },
  });
  const { send, calls } = fixture(single);
  await send('/answer *2951 ship it, but tighten the spacing');
  assert.deepEqual(calls.at(-1)[2], { values: { notes: 'ship it, but tighten the spacing' } },
    'no unescaped = anywhere -> the whole rest is the one field; a comma is literal in a string');
});

test('/answer: backslash escapes make |, , and = data; a Windows path survives', async () => {
  const q = formQuestion({
    layout: [{ widget: 'textarea', field: 'notes', label: 'Notes' },
      { widget: 'select', field: 'verdict', label: 'Verdict' }],
    answerSchema: { type: 'object', required: ['verdict'], properties: {
      verdict: { type: 'string', enum: ['approve', 'changes'] },
      notes: { type: 'string' } } },
  });
  const { send, calls } = fixture(q);
  await send('/answer *2951 notes=a \\| b \\, c \\= d | verdict=approve');
  assert.deepEqual(calls.at(-1)[2], { values: { notes: 'a | b , c = d', verdict: 'approve' } });

  await send('/answer *2951 notes=C:\\Users\\dev | verdict=approve');
  assert.deepEqual(calls.at(-1)[2], { values: { notes: 'C:\\Users\\dev', verdict: 'approve' } },
    'an escape that is not \\| \\, \\= \\: \\\\ stays two characters (P1 C9)');
});

test('/answer: a comma splits ONLY an array-typed field; in a closed enum it is refused, not split', async () => {
  const q = formQuestion({
    layout: [{ widget: 'textarea', field: 'notes', label: 'Notes' }, { widget: 'multiselect', field: 'tags', label: 'Tags' }],
    answerSchema: { type: 'object', properties: {
      notes: { type: 'string' },
      tags: { type: 'array', items: { type: 'string', enum: ['spacing', 'colour', 'copy'] } } } },
  });
  const { send, calls } = fixture(q);
  await send('/answer *2951 notes=a,b | tags=spacing,copy');
  assert.deepEqual(calls.at(-1)[2], { values: { notes: 'a,b', tags: ['spacing', 'copy'] } },
    'notes is a string, so its comma is literal; tags is an array');
  // A closed-enum select is NOT free text: "a,b" is one token and P1 refuses it as an enum error.
  const closed = fixture(formQuestion());
  const reply = text(await closed.send('/answer *2951 verdict=a,b | tags=spacing'));
  assert.equal(closed.calls.length, 0, 'nothing reached orch.answer');
  assert.match(reply, /`verdict`: "a,b" is not one of: approve, changes/);
});

test('/answer: a review-list is answerable as id:verdict[:note] (ruling X8)', async () => {
  const q = formQuestion({
    data: { steps: [{ id: 's1', title: 'Core' }, { id: 's2', title: 'Engine' }] },
    layout: [{ widget: 'review-list', field: 'steps', bind: 'data.steps', label: 'Per step' }],
    answerSchema: { type: 'object', required: ['steps'], properties: {
      steps: { type: 'array', items: { type: 'object', required: ['id', 'verdict'], properties: {
        id: { type: 'string' },
        verdict: { type: 'string', enum: ['keep', 'drop'], default: 'keep' },
        note: { type: 'string' } } } } } },
  });
  const { send, calls } = fixture(q);
  await send('/answer *2951 steps=s2:drop:too risky');
  assert.deepEqual(calls.at(-1)[2], { values: { steps: [
    { id: 's2', verdict: 'drop', note: 'too risky' },
    { id: 's1', verdict: 'keep' },
  ] } }, 'unlisted items take the default verdict (P1 C9)');
});

test('/answer: CRLF and collapsed whitespace are already normalized by parseCommand', async () => {
  const { send, calls } = fixture(formQuestion());
  await send('/answer *2951 verdict=changes |\r\n tags=spacing');
  assert.deepEqual(calls.at(-1)[2], { values: { verdict: 'changes', tags: ['spacing'] } },
    'parseCommand splits on \\s+, so \\r and newlines never reach the grammar');
});

test('/answer: an unknown field is refused with a usage line and nothing is answered', async () => {
  const { send, calls } = fixture(formQuestion());
  const reply = text(await send('/answer *2951 verdik=approve'));
  assert.match(reply, /verdik/);
  assert.match(reply, /\/answer \*2951 verdict=<value> \| tags=<a,b>/, 'the usage line is the real grammar');
  assert.equal(calls.length, 0, 'nothing reached orch.answer');
});

test('/answer: a gate-3 rejection lists the field errors and the question stays open', async () => {
  const errors = [{ path: 'verdict', code: 'enum', message: 'must be one of approve, changes' }];
  const { send, calls } = fixture(formQuestion(), { answer: rejects(errors) });
  const reply = text(await send('/answer *2951 verdict=changes'));
  assert.equal(calls.length, 1, 'the answer WAS attempted');
  assert.match(reply, /rejected/);
  assert.match(reply, /`verdict`: must be one of approve, changes/);
  assert.match(reply, /still open/);
});

test('/answer: a NON-gate-3 failure is not swallowed as a field error', async () => {
  const { send } = fixture(formQuestion(), { answer: () => { throw new Error('boom'); } });
  const reply = text(await send('/answer *2951 verdict=changes'));
  assert.match(reply, /Command failed: boom/, "the router's existing catch owns it");
});

test('/answer: a surface:"web" form is declined in chat too, and stays open', async () => {
  const { send, calls } = fixture(formQuestion({ surface: 'web' }));
  const reply = text(await send('/answer *2951 verdict=approve'));
  assert.match(reply, /worca web UI/);
  assert.equal(calls.length, 0);
});

test('/answer: the clarify and gate paths are unchanged; /help and /status name the grammar', async () => {
  const clarify = fixture({ id: 'clarify-1', kind: 'clarify', questions: [
    { id: 'q1', question: 'Which db?', options: ['postgres', 'sqlite'] },
  ] });
  await clarify.send('/answer *2951 2');
  assert.deepEqual(clarify.calls.at(-1)[2], { answers: [{ id: 'q1', choice: 'sqlite' }] });

  const gate = fixture({ id: 'gate-9', kind: 'gate' });
  assert.match(text(await gate.send('/answer *2951 1')), /use `\/approve` or `\/retry`/);

  assert.match(text(await clarify.send('/help')), /field=value/);
  const form = fixture(formQuestion());
  assert.match(text(await form.send('/status *2951')), /waiting on the `review-mockups` form/);
});
