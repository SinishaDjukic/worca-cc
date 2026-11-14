// test/prompt-check-grade-route.test.mjs — POST /api/prompt-check/grade (ui/routes/prompt-check/grade-route.mjs).
// Boots the app in-process with WORCA_MOCK, a temp HOME (settings.json) and WORCA_HOME (the DB), and injects a
// counting runner through _setGradeRunnerForTest, so no model is ever spawned.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { useTempHome } from './helpers/temp-home.mjs';

useTempHome(after);
const HOME = mkdtempSync(join(tmpdir(), 'worca-cc-pc-home-'));
const saved = { HOME: process.env.HOME, USERPROFILE: process.env.USERPROFILE };
process.env.HOME = HOME;
process.env.USERPROFILE = HOME;
process.env.WORCA_TEST_ALLOW_HOME_FALLBACK = '1';
process.env.WORCA_MOCK = '1';

const { _setGradeRunnerForTest, GRADE_ERRORS } = await import('../src/core/prompt-check/grade.mjs');
const { _setGradeBucketForTest } = await import('../ui/routes/prompt-check/grade-route.mjs');
const { normalizeAssessment } = await import('../src/shared/prompt-check/assessment.mjs');
const { textHash } = await import('../src/shared/prompt-check/filter.mjs');
const { setChatPrefs, setTotalCostLimitUsd } = await import('../src/core/settings.mjs');
const { recordAskCostDelta } = await import('../src/core/cost-budget.mjs');
const { TokenBucket } = await import('../src/core/chat/rate-limiter.mjs');

let srv;
let port;
before(async () => {
  const mod = await import('../ui/server.mjs');
  srv = mod.server;
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  port = srv.address().port;
});
after(async () => {
  _setGradeRunnerForTest(null);
  _setGradeBucketForTest(null);
  if (srv) await new Promise((r) => srv.close(r));
  for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  delete process.env.WORCA_TEST_ALLOW_HOME_FALLBACK;
  delete process.env.WORCA_MOCK;
  rmSync(HOME, { recursive: true, force: true });
});

const TASK = 'Add a CSV export button to the Insights page so that a team lead can share the weekly cost with finance.';
const MODEL = 'claude-haiku-test';
let seq = 0;
const body = (o = {}) => ({ requestId: `r-${++seq}`, surface: { kind: 'chat', id: `th_${seq}` }, text: TASK, ...o });
const post = async (b) => {
  const r = await fetch(`http://127.0.0.1:${port}/api/prompt-check/grade`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(b) });
  return { status: r.status, body: await r.json() };
};
function counting(reply = { kind: 'implementation', grade: 'clear', confidence: 0.9, size: 'small' }) {
  const calls = [];
  const run = async (o) => { calls.push(o); return { text: JSON.stringify(reply) }; };
  return { calls, run };
}
function withRunner(t, run, pick = () => MODEL) {
  _setGradeRunnerForTest(run, pick);
  t.after(() => _setGradeRunnerForTest(null));
}
const promptCheck = (on) => setChatPrefs({ promptCheck: on });

test('validation: each 400 message, with 0 runner calls', async (t) => {
  await promptCheck(true);
  const { calls, run } = counting();
  withRunner(t, run);
  const cases = [
    [{ requestId: '' }, 'requestId is required'],
    [{ requestId: 'x'.repeat(65) }, 'requestId is required'],
    [{ requestId: 7 }, 'requestId is required'],
    [{ surface: null }, 'surface is required'],
    [{ surface: { kind: 'nope', id: 'a' } }, 'surface is required'],
    [{ surface: { kind: 'chat', id: '' } }, 'surface is required'],
    [{ surface: { kind: 'chat', id: 'x'.repeat(129) } }, 'surface is required'],
    [{ text: '   ' }, 'text is required'],
    [{ text: 5 }, 'text is required'],
    [{ text: 'a'.repeat(20_001) }, 'text is too long'],
    [{ window: ['a', 'b', 'c'] }, 'window has too many messages'],
    [{ engine: 'nope' }, 'unknown engine'],
    [{ chatModel: 'x; rm -rf /' }, 'chatModel is invalid'],
    [{ chatModel: 'x'.repeat(101) }, 'chatModel is invalid'],
    [{ chatModel: '-oProxyCommand' }, 'chatModel is invalid'],
  ];
  for (const [patch, error] of cases) {
    const r = await post(body(patch));
    assert.equal(r.status, 400, error);
    assert.deepEqual(r.body, { error });
  }
  assert.equal(calls.length, 0);
});

test('setting off → source off, and the runner is called 0 times', async (t) => {
  await promptCheck(false);
  const { calls, run } = counting();
  withRunner(t, run);
  const b = body();
  const r = await post(b);
  assert.equal(r.status, 200);
  assert.deepEqual(r.body, { requestId: b.requestId, source: 'off' });
  assert.equal(calls.length, 0);
});

test('a skip → skipped with 0 runner calls; a run-card surface is graded even for a question', async (t) => {
  await promptCheck(true);
  const { calls, run } = counting();
  withRunner(t, run);
  const q = 'What does the review step do?';
  const b = body({ text: q });
  const r = await post(b);
  assert.deepEqual(r.body, { requestId: b.requestId, textHash: textHash(q), source: 'skipped', skip: 'short-question' });
  assert.equal(calls.length, 0);
  const forced = await post(body({ text: q, forceTask: true }));
  assert.equal(forced.body.skip, 'short-question', 'a chat surface ignores a client forceTask');
  assert.equal(calls.length, 0);
  const card = await post(body({ text: q, surface: { kind: 'run-card', id: 'c1' } }));
  assert.equal(card.status, 200);
  assert.equal(card.body.source, 'model');
  assert.equal(calls.length, 1);
  assert.equal(card.body.assessment.isTask, true);
});

test('two overlapping requests on one surface: the first answers superseded; another surface is unaffected', async (t) => {
  await promptCheck(true);
  let resolveStarted;
  const started = new Promise((r) => { resolveStarted = r; });
  withRunner(t, (o) => {
    if (o.prompt.includes('BLOCKME')) {
      resolveStarted();
      return new Promise((ok, no) => o.signal.addEventListener('abort', () => no(o.signal.reason)));
    }
    return Promise.resolve({ text: '{"kind":"bug","grade":"clear","confidence":0.8}' });
  });
  const first = post(body({ surface: { kind: 'chat', id: 'same' }, text: `${TASK} BLOCKME` }));
  await started;
  const other = await post(body({ surface: { kind: 'chat', id: 'other' } }));
  assert.equal(other.body.source, 'model');
  const second = await post(body({ surface: { kind: 'chat', id: 'same' } }));
  assert.equal(second.body.source, 'model');
  const r1 = await first;
  assert.equal(r1.status, 200);
  assert.deepEqual(Object.keys(r1.body).sort(), ['requestId', 'source']);
  assert.equal(r1.body.source, 'superseded');
});

test('no model → deterministic with model unavailable; budget blocked → total cost limit reached', async (t) => {
  await promptCheck(true);
  const { calls, run } = counting();
  withRunner(t, run, () => null);
  const r = await post(body());
  assert.equal(r.body.source, 'deterministic');
  assert.equal(r.body.error, 'model unavailable');
  assert.equal(r.body.assessment.grade, null);
  assert.equal(calls.length, 0);
  _setGradeRunnerForTest(run, () => MODEL);
  await setTotalCostLimitUsd(1);
  recordAskCostDelta({ threadId: 'th_budget', amountUsd: 5 });
  t.after(() => setTotalCostLimitUsd(''));
  const b = await post(body());
  assert.equal(b.body.source, 'deterministic');
  assert.equal(b.body.error, 'total cost limit reached');
  assert.equal(calls.length, 0);
  await setTotalCostLimitUsd('');
});

test('a hostile reply reaches the browser only normalized, with no other key', async (t) => {
  await promptCheck(true);
  const reply = {
    isTask: true, kind: 'bug', confidence: 0.9, grade: 'needs-detail', size: 'medium', taskKind: 'plan-complete-small',
    openDecisions: ['o'.repeat(10_000), 'Which page?'], minorKinds: ['<img src=x onerror=alert(1)>'],
    perspectives: [{ id: 'security', reason: '<img src=x onerror=alert(1)>' }], extra: 'secret', html: '<script>x</script>',
  };
  withRunner(t, async () => ({ text: JSON.stringify(reply) }));
  const b = body();
  const r = await post(b);
  assert.equal(r.status, 200);
  assert.deepEqual(r.body, { requestId: b.requestId, textHash: textHash(TASK), source: 'model',
    assessment: normalizeAssessment({ ...reply, source: 'model' }, { text: TASK }) });
  assert.equal(r.body.assessment.taskKind, 'prompt');
  assert.equal(r.body.assessment.openDecisions[0].length, 160);
});

test('a runner error carrying the prompt → model call failed, nothing logged with the text; a throw in the handler → 500, then a second request answers', async (t) => {
  await promptCheck(true);
  const lines = [];
  const keep = {};
  for (const k of ['log', 'warn', 'error', 'debug', 'info']) {
    keep[k] = console[k];
    console[k] = (...a) => lines.push(a.map((x) => (x instanceof Error ? `${x.message} ${x.stack}` : String(x))).join(' '));
  }
  t.after(() => Object.assign(console, keep));
  const secret = 'Add the zebra-8812 importer to the projects page so that admins can bulk-add repos';
  withRunner(t, async (o) => { throw new Error(`failed on ${o.prompt}`); });
  const r = await post(body({ text: secret }));
  assert.equal(r.body.source, 'deterministic');
  assert.equal(r.body.error, 'model call failed');
  assert.ok(GRADE_ERRORS.includes(r.body.error));
  _setGradeRunnerForTest(async () => ({ text: '{}' }), () => { throw new Error(`pick failed ${secret}`); });
  const boom = await post(body({ text: secret }));
  assert.equal(boom.status, 500);
  assert.deepEqual(boom.body, { error: 'prompt check failed' });
  _setGradeRunnerForTest(async () => ({ text: '{"kind":"idea","grade":"clear"}' }), () => MODEL);
  const again = await post(body({ text: secret }));
  assert.equal(again.status, 200);
  assert.equal(again.body.source, 'model');
  Object.assign(console, keep);
  for (const l of lines) assert.ok(!l.includes('zebra-8812'), l);
});

test('the bucket: 60 distinct task texts answer 200, the 61st answers 429 (frozen clock)', async (t) => {
  await promptCheck(true);
  const { calls, run } = counting();
  withRunner(t, run);
  _setGradeBucketForTest(new TokenBucket(60, { now: () => 0 }));
  t.after(() => _setGradeBucketForTest(null));
  for (let i = 0; i < 60; i++) {
    const r = await post(body({ text: `${TASK} Variant ${i} of the export with column set ${i * 7}.`, surface: { kind: 'new-run', id: `n${i}` } }));
    assert.equal(r.status, 200, `request ${i + 1}`);
  }
  const last = await post(body({ text: `${TASK} One more variant.`, surface: { kind: 'new-run', id: 'n61' } }));
  assert.equal(last.status, 429);
  assert.deepEqual(last.body, { error: 'too many checks, try again in a moment' });
  assert.equal(calls.length, 60);
});

test('chatModel: used only where the engine says CHAT_MODEL; never on Claude or a fixed-model engine', async (t) => {
  await promptCheck(true);
  const { calls, run } = counting();
  _setGradeRunnerForTest(run);   // the real gradeModel (suggestionModel)
  t.after(() => _setGradeRunnerForTest(null));
  await post(body({ engine: 'codex', chatModel: 'gpt-chat-big' }));
  assert.equal(calls.at(-1).model, 'gpt-5.6-luna');
  assert.equal(calls.at(-1).engine, 'codex');
  await post(body({ engine: 'gemini', chatModel: 'gemini-chat-model' }));
  assert.equal(calls.at(-1).model, 'gemini-chat-model');
  assert.equal(calls.at(-1).engine, 'gemini');
  const n = calls.length;
  await post(body({ engine: 'claude', chatModel: 'claude-opus-5-5' }));
  for (const c of calls.slice(n)) assert.notEqual(c.model, 'claude-opus-5-5');
});

test('grade-route.mjs: its only console call is the one fixed-field line', () => {
  const src = readFileSync(new URL('../ui/routes/prompt-check/grade-route.mjs', import.meta.url), 'utf8');
  const hits = src.match(/console\.\w+/g) || [];
  assert.equal(hits.length, 1);
  assert.doesNotMatch(src, /err(?:or)?\??\.(?:message|stack)/);
});

function raw(path, headers, payload) {
  return new Promise((res, rej) => {
    const data = JSON.stringify(payload);
    const r = http.request({ host: '127.0.0.1', port, path, method: 'POST',
      headers: { 'content-type': 'application/json', 'content-length': Buffer.byteLength(data), ...headers } }, (resp) => {
      let b = '';
      resp.setEncoding('utf8');
      resp.on('data', (c) => { b += c; });
      resp.on('end', () => res({ status: resp.statusCode, body: b }));
    });
    r.on('error', rej);
    r.end(data);
  });
}

test('a non-local Host or a cross-site Origin is refused exactly like POST /api/ask/threads', async (t) => {
  await promptCheck(true);
  const { calls, run } = counting();
  withRunner(t, run);
  for (const headers of [{ host: 'evil.example.com' }, { host: `127.0.0.1:${port}`, origin: 'https://evil.example.com' }]) {
    const ours = await raw('/api/prompt-check/grade', headers, body());
    const chat = await raw('/api/ask/threads', headers, {});
    assert.ok(ours.status >= 400, JSON.stringify(headers));
    assert.equal(ours.status, chat.status, JSON.stringify(headers));
    assert.equal(ours.body, chat.body, JSON.stringify(headers));
  }
  assert.equal(calls.length, 0);
});
