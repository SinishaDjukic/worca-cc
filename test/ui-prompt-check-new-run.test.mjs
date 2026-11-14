// test/ui-prompt-check-new-run.test.mjs — the prompt check chip under the New run prompt (ui/public/app.js through
// ui/public/prompt-check/chip-host.mjs), booted with the real app.js. The debounce runs on fake timers handed in through
// window.__worcaTestHooks.promptCheckTimers; the grade fetch is held per call. bootApp releases each window after its test.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bootApp } from './helpers/run-page-boot.mjs';
import { textHash, PROMPT_CHECK_DEBOUNCE_MS } from '../src/shared/prompt-check/filter.mjs';

const TASK = 'Add a CSV export button to the Insights page so that a team lead can share the weekly cost with finance.';
const REWRITE = 'Change: Add the export.\nWhere: [Architect · decide: which files or modules?]';
const OTHER = 'Build a Slack notifier that posts a message when a run fails, with the run title, the step and a link.';
const PROJECTS = [{ name: 'web', path: '/a/web', exists: true, key: 'web-00000001' }];
const ok = (body, status = 200) => Promise.resolve({ ok: status < 400, status, json: async () => body, text: async () => JSON.stringify(body) });

function fakeTimers() {
  let now = 0;
  let id = 0;
  const jobs = new Map();
  return {
    setTimeout: (fn, ms) => { jobs.set(++id, { at: now + ms, fn }); return id; },
    clearTimeout: (i) => { jobs.delete(i); },
    advance(ms) {
      now += ms;
      for (const [i, j] of [...jobs].sort((a, b) => a[1].at - b[1].at)) if (j.at <= now) { jobs.delete(i); j.fn(); }
    },
  };
}

async function boot({ on = true, runResponse = null } = {}) {
  const timers = fakeTimers();
  const rec = { grades: [], corrections: [], runs: 0, on };
  const ctx = await bootApp({
    hooks: { promptCheckTimers: timers },
    local: { 'worca-cc.runTarget': 'project', 'worca-cc.lastProject': 'web' },
    fetchHandler: (u, opts) => {
      const method = (opts.method || 'GET').toUpperCase();
      if (u === '/api/prompt-check/grade') {
        return new Promise((resolve, reject) => {
          const call = { body: JSON.parse(opts.body), aborted: false };
          opts.signal?.addEventListener('abort', () => { call.aborted = true; reject(Object.assign(new Error('aborted'), { name: 'AbortError' })); });
          call.reply = (assessment = {}) => resolve({ ok: true, status: 200, json: async () => ({
            requestId: call.body.requestId, textHash: textHash(call.body.text), source: 'model',
            assessment: { isTask: true, kind: 'implementation', grade: 'needs-detail', continuesRequirement: true, ...assessment },
          }) });
          rec.grades.push(call);
        });
      }
      if (u === '/api/prompt-check/improve') {
        const b = JSON.parse(opts.body);
        (rec.improves ||= []).push(b);
        return Promise.resolve({ ok: true, status: 200, json: async () => ({ requestId: b.requestId, source: 'model', kind: b.kind, model: 'Sonnet 5.5',
          rewrite: { kind: b.kind, sections: [{ id: 'change', label: 'Change', text: 'Add the export.', gaps: [] }] }, text: REWRITE, paths: [] }) });
      }
      if (u === '/api/prompt-check/kind-correction') { rec.corrections.push(JSON.parse(opts.body)); return ok({ ok: true, at: 't' }, 201); }
      if (u.includes('/api/settings') && method === 'GET') return ok({ chat: { promptCheck: rec.on }, app: {}, theme: {} });
      if (u.includes('/api/run-defaults')) return ok({ engine: { value: 'claude', source: 'default' }, steps: { claude: {}, codex: {} }, projectKey: 'web-00000001', tags: [] });
      if (u.includes('/api/tags')) return ok({ keys: [], values: {} });
      if (u.includes('/api/projects')) return ok({ projects: PROJECTS });
      if (u.includes('/api/workspaces')) return ok({ workspaces: [] });
      if (u.includes('/api/branches')) return ok({ branches: ['dev'], current: 'dev' });
      if (u.endsWith('/api/run') && method === 'POST') {
        rec.runs += 1;
        if (runResponse) return Promise.resolve(runResponse(rec.runs)).then(({ status, body }) => ok(body, status));
        return ok({ runId: `run-${rec.runs}` });
      }
      return null;
    },
  });
  ctx.wsBox.ws.dispatch('open', {});
  await ctx.settle(8);
  ctx.go('new');
  await ctx.settle(4);
  const doc = ctx.window.document;
  const prompt = doc.getElementById('prompt');
  const type = (text) => { prompt.value = text; prompt.dispatchEvent(new ctx.window.Event('input', { bubbles: true })); };
  const graded = async (text = TASK, assessment = {}) => {
    type(text);
    timers.advance(PROMPT_CHECK_DEBOUNCE_MS);
    rec.grades.at(-1).reply(assessment);
    await ctx.settle(4);
  };
  const start = async () => {
    const n = rec.runs;
    doc.getElementById('run-form').dispatchEvent(new ctx.window.Event('submit', { bubbles: true, cancelable: true }));
    for (let i = 0; i < 40 && rec.runs === n; i++) await ctx.settle(1);
    await ctx.settle(8);
  };
  return { ctx, rec, timers, doc, prompt, type, graded, start };
}
const chips = (s) => s.doc.querySelectorAll('[data-prompt-check]');
const prCalls = (s) => s.ctx.calls.filter((c) => c.url.includes('/api/prompt-check/'));
const pickKind = async (s, label) => {
  chips(s)[0].querySelector('button').click();
  [...s.doc.querySelectorAll('[role="menuitemradio"]')].find((i) => i.textContent === label).click();
  await s.ctx.settle(3);
};

test('on: one chip directly under #prompt after the debounce, on the new-run surface', async () => {
  const s = await boot();
  await s.graded();
  assert.equal(chips(s).length, 1);
  const pane = s.doc.getElementById('prompt-pane');
  assert.equal(chips(s)[0].parentNode, pane);
  assert.equal(pane.lastElementChild, chips(s)[0], 'right under the field');
  assert.ok(s.prompt.compareDocumentPosition(chips(s)[0]) & s.ctx.window.Node.DOCUMENT_POSITION_FOLLOWING);
  assert.deepEqual(s.rec.grades[0].body.surface, { kind: 'new-run', id: 'form' });
  assert.equal(chips(s)[0].querySelector('button').textContent, 'Implementation task');
});

test('off: 0 chips and 0 calls to either prompt-check route', async () => {
  const s = await boot({ on: false });
  s.type(TASK);
  s.timers.advance(10_000);
  await s.ctx.settle(4);
  assert.equal(chips(s).length, 0);
  assert.deepEqual(prCalls(s), []);
});

test('setTask (Reuse last task) grades without an input event, and clearTask hides the chip', async () => {
  const s = await boot();
  await s.graded();
  await s.start();
  assert.equal(chips(s).length, 0, 'the started task is cleared, so is its chip');
  s.doc.querySelector('#reuse-task button, [data-reuse-task], #reuseTaskBtn')?.click();
  const n = s.rec.grades.length;
  s.timers.advance(PROMPT_CHECK_DEBOUNCE_MS);
  assert.equal(s.prompt.value, TASK, 'Reuse put the task back');
  assert.equal(s.rec.grades.length, n + 1, 'a programmatic setTask is graded');
});

test('in flight (the grade held): the chip is the same node and Start stays enabled', async () => {
  const s = await boot();
  await s.graded();
  const before = chips(s)[0];
  s.type(OTHER);
  s.timers.advance(PROMPT_CHECK_DEBOUNCE_MS);
  await s.ctx.settle(2);
  assert.equal(s.rec.grades.length, 2);
  assert.equal(chips(s)[0], before);
  assert.equal(s.doc.getElementById('start-btn').disabled, false);
});

test('a correction is held until Start, then posted once with the run id', async () => {
  const s = await boot();
  await s.graded();
  await pickKind(s, 'Bug report');
  assert.equal(s.rec.grades.at(-1).body.kind, 'bug');
  assert.deepEqual(s.rec.corrections, []);
  await s.start();
  assert.deepEqual(s.rec.corrections, [{ surface: 'new-run', runId: 'run-1', proposedKind: 'implementation', chosenKind: 'bug' }]);
  await s.graded(OTHER);
  await s.start();
  assert.equal(s.rec.corrections.length, 1, 'no correction, no POST');
});

test('a failed start posts no correction; the held one is posted after the retry succeeds', async () => {
  const s = await boot({ runResponse: (n) => (n === 1 ? { status: 500, body: { error: 'boom' } } : { status: 200, body: { runId: 'run-ok' } }) });
  await s.graded();
  await pickKind(s, 'Plan');
  await s.start();
  assert.equal(s.rec.runs, 1);
  assert.deepEqual(s.rec.corrections, []);
  await s.start();
  assert.deepEqual(s.rec.corrections, [{ surface: 'new-run', runId: 'run-ok', proposedKind: 'implementation', chosenKind: 'plan' }]);
});

test('a pick made while /api/run is out stays with the draft in the field: the start records only the one held at submit', async () => {
  let answer = null;
  const s = await boot({ runResponse: (n) => (n === 1 ? new Promise((r) => { answer = r; }) : { status: 200, body: { runId: 'run-2' } }) });
  await s.graded();
  await pickKind(s, 'Plan');
  await s.start();
  assert.equal(s.rec.runs, 1, 'the start is out');
  await s.graded(OTHER);
  await pickKind(s, 'Idea');
  answer({ status: 200, body: { runId: 'run-1' } });
  await s.ctx.settle(8);
  assert.deepEqual(s.rec.corrections, [{ surface: 'new-run', runId: 'run-1', proposedKind: 'implementation', chosenKind: 'plan' }]);
  assert.equal(s.prompt.value, OTHER, 'the later draft stays in the field');
  await s.start();
  assert.deepEqual(s.rec.corrections.slice(1), [{ surface: 'new-run', runId: 'run-2', proposedKind: 'implementation', chosenKind: 'idea' }]);
});

test('turning the setting off (a settings-changed reload) hides the chip', async () => {
  const s = await boot();
  await s.graded();
  assert.equal(chips(s).length, 1);
  s.rec.on = false;
  s.ctx.go('settings');
  await s.ctx.settle(4);
  s.ctx.dispatch({ type: 'settings-changed' });
  await s.ctx.settle(8);
  s.ctx.go('new');
  await s.ctx.settle(4);
  assert.equal(chips(s).length, 0);
});

test('a short question in New run shows nothing (no forceTask on new-run)', async () => {
  const s = await boot();
  s.type('What does the review step do?');
  s.timers.advance(PROMPT_CHECK_DEBOUNCE_MS);
  await s.ctx.settle(3);
  assert.equal(chips(s).length, 0);
  assert.deepEqual(prCalls(s), []);
});

test('emptying the prompt hides the chip', async () => {
  const s = await boot();
  await s.graded();
  s.type('');
  assert.equal(chips(s).length, 0);
});

test('a grade change is announced politely and focus stays on #prompt', async () => {
  const s = await boot();
  s.prompt.focus();
  await s.graded();
  const said = [...s.doc.querySelectorAll('.toasts-sr')].map((n) => n.textContent);
  assert.deepEqual(said, ['Prompt check: Implementation task, needs detail']);
  assert.equal(s.doc.activeElement, s.prompt);
});

test('keyboard: Enter opens the kind menu, ArrowDown and Enter pick, focus returns to the picker', async () => {
  const s = await boot();
  await s.graded();
  const pick = chips(s)[0].querySelector('button');
  assert.equal(pick.getAttribute('aria-label'), 'Prompt kind: Implementation task');
  pick.focus();
  pick.click();
  const menu = s.doc.querySelector('[role="menu"][aria-label="Prompt kind"]');
  menu.dispatchEvent(new s.ctx.window.KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
  menu.dispatchEvent(new s.ctx.window.KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
  s.doc.activeElement.click();
  await s.ctx.settle(2);
  assert.equal(s.doc.activeElement, pick);
  assert.equal(pick.textContent, 'Bug report');
});

test('the kind label appears only inside the chip (no other kind text in the New run form)', async () => {
  const s = await boot();
  await s.graded();
  const form = s.doc.getElementById('run-form');
  const outside = [...form.querySelectorAll('*')].filter((n) => !n.closest('[data-prompt-check]')
    && [...n.childNodes].some((c) => c.nodeType === 3 && c.textContent.includes('Implementation task')));
  assert.deepEqual(outside, []);
});

test('Improve: Use this writes into #prompt through its input path (re-check) with Undo shown; Undo restores it', async () => {
  const s = await boot();
  await s.graded();
  s.doc.querySelector('[data-prompt-improve-open]').click();
  await s.ctx.settle(4);
  assert.equal(s.rec.improves.length, 1);
  assert.equal(s.rec.improves[0].projectDir, '/a/web');
  s.doc.querySelector('[data-improve-act="use"]').click();
  await s.ctx.settle(4);
  assert.equal(s.prompt.value, REWRITE);
  s.timers.advance(PROMPT_CHECK_DEBOUNCE_MS);
  assert.equal(s.rec.grades.at(-1).body.text, REWRITE, 'the rewrite is re-checked');
  s.rec.grades.at(-1).reply();
  await s.ctx.settle(4);
  assert.ok(s.doc.querySelector('[data-improve-act="undo"]'), 'Undo still shown');
  s.doc.querySelector('[data-improve-act="undo"]').click();
  await s.ctx.settle(4);
  assert.equal(s.prompt.value, TASK);
});
