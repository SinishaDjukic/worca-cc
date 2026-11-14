// test/prompt-check-grader.test.mjs — the browser prompt grader (ui/public/prompt-check/grader.mjs): debounce, abort,
// staleness and the requirement window, with fake timers and a fake fetch.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { createPromptGrader } from '../ui/public/prompt-check/grader.mjs';
import { textHash, PROMPT_CHECK_DEBOUNCE_MS } from '../src/shared/prompt-check/filter.mjs';

const TASK = 'Add a CSV export button to the Insights page so that a team lead can share the weekly cost with finance.';
const OTHER = 'Build a Slack notifier that posts a message when a run fails, with the run title, the step and a link.';
const THIRD = 'Rename the Statistics page to Insights everywhere in the navigation, the page head and the docs links.';
const FOURTH = 'Show the per-project cost split as a stacked bar on the Insights page with a legend under it.';

function fakeTimers() {
  let now = 0;
  let id = 0;
  const jobs = new Map();
  return {
    setTimeout: (fn, ms) => { jobs.set(++id, { at: now + ms, fn }); return id; },
    clearTimeout: (i) => { jobs.delete(i); },
    advance(ms) {
      now += ms;
      for (const [i, j] of [...jobs].sort((a, b) => a[1].at - b[1].at)) {
        if (j.at <= now) { jobs.delete(i); j.fn(); }
      }
    },
  };
}

function fakeFetch() {
  const calls = [];
  const fetchImpl = (url, opts) => new Promise((resolve, reject) => {
    const call = { url, opts, body: JSON.parse(opts.body), aborted: false };
    opts.signal?.addEventListener('abort', () => { call.aborted = true; reject(Object.assign(new Error('aborted'), { name: 'AbortError' })); });
    call.reply = (o) => resolve({ ok: true, status: 200, json: async () => o });
    calls.push(call);
  });
  return { calls, fetchImpl };
}

const flush = () => new Promise((r) => setTimeout(r, 0));
const modelReply = (call, assessment = {}) => ({
  requestId: call.body.requestId, textHash: textHash(call.body.text), source: 'model',
  assessment: { isTask: true, kind: 'implementation', continuesRequirement: true, ...assessment },
});

function make({ enabled = () => true, forceTask = false } = {}) {
  const timers = fakeTimers();
  const { calls, fetchImpl } = fakeFetch();
  const results = [];
  const g = createPromptGrader({ surface: { kind: 'chat', id: 'th_1' }, enabled, fetchImpl, timers, onResult: (r) => results.push(r), forceTask });
  return { g, timers, calls, results };
}

test('nothing is scheduled or fetched while enabled() is false', () => {
  let on = false;
  const { g, timers, calls } = make({ enabled: () => on });
  g.input(TASK);
  timers.advance(10_000);
  assert.equal(calls.length, 0);
  on = true;
  g.input(TASK);
  timers.advance(PROMPT_CHECK_DEBOUNCE_MS);
  assert.equal(calls.length, 1);
});

test('debounce: 0 fetches at 1 499 ms, exactly 1 at 1 500 ms; typing at 1 400 ms restarts the wait', () => {
  const { g, timers, calls } = make();
  g.input(TASK);
  timers.advance(1499);
  assert.equal(calls.length, 0);
  timers.advance(1);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, '/api/prompt-check/grade');
  assert.deepEqual(calls[0].body.surface, { kind: 'chat', id: 'th_1' });
  assert.equal(calls[0].body.text, TASK);
  assert.deepEqual(calls[0].body.window, []);

  const b = make();
  b.g.input(TASK);
  b.timers.advance(1400);
  b.g.input(OTHER);
  b.timers.advance(1499);
  assert.equal(b.calls.length, 0);
  b.timers.advance(1);
  assert.equal(b.calls.length, 1);
  assert.equal(b.calls[0].body.text, OTHER);
});

test('typing during a fetch aborts it', () => {
  const { g, timers, calls } = make();
  g.input(TASK);
  timers.advance(1500);
  assert.equal(calls[0].aborted, false);
  g.input(OTHER);
  assert.equal(calls[0].aborted, true);
});

test('a reply after sent() and a reply whose hash no longer matches reach onResult 0 times', async () => {
  const a = make();
  a.g.input(TASK);
  a.timers.advance(1500);
  a.g.sent(TASK);
  a.calls[0].reply(modelReply(a.calls[0]));
  await flush();
  assert.equal(a.results.length, 0);

  const b = make();
  b.g.input(TASK);
  b.timers.advance(1500);
  b.calls[0].reply({ ...modelReply(b.calls[0]), textHash: textHash(OTHER) });
  await flush();
  assert.equal(b.results.length, 0);

  const c = make();
  c.g.input(TASK);
  c.timers.advance(1500);
  c.calls[0].reply({ ...modelReply(c.calls[0]), requestId: 'old' });
  await flush();
  assert.equal(c.results.length, 0);

  for (const source of ['superseded', 'off']) {
    const d = make();
    d.g.input(TASK);
    d.timers.advance(1500);
    d.calls[0].reply({ requestId: d.calls[0].body.requestId, textHash: textHash(TASK), source });
    await flush();
    assert.equal(d.results.length, 0, source);
  }

  const ok = make();
  ok.g.input(TASK);
  ok.timers.advance(1500);
  ok.calls[0].reply(modelReply(ok.calls[0]));
  await flush();
  assert.equal(ok.results.length, 1);
  assert.equal(ok.results[0].assessment.kind, 'implementation');
});

test('a skip calls onResult({skip}) with 0 fetches', () => {
  const { g, timers, calls, results } = make();
  g.input('Thanks!');
  timers.advance(5000);
  assert.deepEqual(results, [{ skip: 'small-talk' }]);
  g.input(TASK, { answering: true });
  timers.advance(5000);
  assert.deepEqual(results.at(-1), { skip: 'answer' });
  assert.equal(calls.length, 0);
});

test('the same text is not checked twice on a surface', async () => {
  const { g, timers, calls, results } = make();
  g.input(TASK);
  timers.advance(1500);
  calls[0].reply(modelReply(calls[0]));
  await flush();
  g.input(TASK);
  timers.advance(1500);
  assert.equal(calls.length, 1);
  assert.deepEqual(results.at(-1), { skip: 'same-text' });
});

async function checkAndSend(h, text, assessment = {}) {
  h.g.input(text);
  h.timers.advance(1500);
  const call = h.calls.at(-1);
  call.reply(modelReply(call, assessment));
  await flush();
  h.g.sent(text);
  return call;
}

test('the window holds at most 2 earlier task messages, oldest dropped', async () => {
  const h = make();
  await checkAndSend(h, TASK);
  await checkAndSend(h, OTHER);
  await checkAndSend(h, THIRD);
  h.g.input(FOURTH);
  h.timers.advance(1500);
  assert.deepEqual(h.calls.at(-1).body.window, [OTHER, THIRD]);
  assert.deepEqual(h.g.state().window, [OTHER, THIRD]);
});

test('a non-task message is not pushed into the window', async () => {
  const h = make();
  await checkAndSend(h, TASK, { isTask: false, kind: 'conversation' });
  assert.deepEqual(h.g.state().window, []);
});

test('resetWindow(base) makes the next request\'s window [base]; resetWindow() empties it', async () => {
  const h = make();
  await checkAndSend(h, TASK);
  h.g.resetWindow('The run card brief');
  h.g.input(OTHER);
  h.timers.advance(1500);
  assert.deepEqual(h.calls.at(-1).body.window, ['The run card brief']);
  h.g.resetWindow();
  assert.deepEqual(h.g.state().window, []);
});

test('continuesRequirement:false empties the window before the next check', async () => {
  const h = make();
  await checkAndSend(h, TASK);
  h.g.input(OTHER);
  h.timers.advance(1500);
  assert.deepEqual(h.calls.at(-1).body.window, [TASK]);
  h.calls.at(-1).reply(modelReply(h.calls.at(-1), { continuesRequirement: false }));
  await flush();
  h.g.input(THIRD);
  h.timers.advance(1500);
  assert.deepEqual(h.calls.at(-1).body.window, []);
});

test('forceTask rides the request; cancel() and dispose() stop pending work', () => {
  const h = make({ forceTask: true });
  h.g.input('What does the review step do?');
  h.timers.advance(1500);
  assert.equal(h.calls.length, 1);
  assert.equal(h.calls[0].body.forceTask, true);
  h.g.input(TASK);
  h.g.cancel();
  h.timers.advance(5000);
  assert.equal(h.calls.length, 1);
  h.g.dispose();
  h.g.input(OTHER);
  h.timers.advance(5000);
  assert.equal(h.calls.length, 1);
});

test('an edit typed during a fetch is checked again 1.5 s later; so is a small edit after a dropped reply', async () => {
  const a = make();
  a.g.input(TASK);
  a.timers.advance(1500);
  a.g.input(`${TASK} Now.`);
  assert.equal(a.calls[0].aborted, true);
  a.timers.advance(1500);
  assert.equal(a.calls.length, 2);
  assert.equal(a.calls[1].body.text, `${TASK} Now.`);

  const b = make();
  b.g.input(TASK);
  b.timers.advance(1500);
  b.calls[0].reply({ requestId: b.calls[0].body.requestId, textHash: textHash(TASK), source: 'superseded' });
  await flush();
  assert.equal(b.g.state().last, null);
  b.g.input(`${TASK} Now.`);
  b.timers.advance(1500);
  assert.equal(b.calls.length, 2);
});

test('a server skipped reply clears the earlier assessment', async () => {
  const h = make();
  h.g.input(TASK);
  h.timers.advance(1500);
  h.calls[0].reply(modelReply(h.calls[0]));
  await flush();
  h.g.input(OTHER);
  h.timers.advance(1500);
  h.calls[1].reply({ requestId: h.calls[1].body.requestId, textHash: textHash(OTHER), source: 'skipped', skip: 'small-talk' });
  await flush();
  assert.equal(h.g.state().lastAssessment, null);
  assert.deepEqual(h.results.at(-1), { skip: 'small-talk' });
});

test('a task sent before its grade arrives still joins the window (before the debounce and while in flight)', () => {
  const a = make();
  a.g.input(TASK);
  a.g.sent(TASK);
  assert.deepEqual(a.g.state().window, [TASK]);

  const b = make();
  b.g.input(OTHER);
  b.timers.advance(1500);
  b.g.sent(OTHER);
  assert.deepEqual(b.g.state().window, [OTHER]);

  const c = make();
  c.g.input('Thanks!');
  c.g.sent('Thanks!');
  assert.deepEqual(c.g.state().window, []);
});
