// test/ui-prompt-check-run-card.test.mjs — the prompt check chip in a proposed run card's brief foot
// (ui/public/ask-panel.mjs buildCardForm through ui/public/prompt-check/chip-host.mjs). The card is served in the
// thread snapshot; fake timers ride the panel's promptCheckTimers dep; the grade fetch is held per call. Each window
// is closed when its test ends.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { makePanel } from './helpers/ask-panel-harness.mjs';
import { setPromptCheckPref } from '../ui/public/prompt-check/chip-host.mjs';
import { textHash, PROMPT_CHECK_DEBOUNCE_MS } from '../src/shared/prompt-check/filter.mjs';

const TID = 'ask_00000001';
const MID = 'askm_00000001';
const CARD_ID = 'card_00000001';
const REWRITE = 'Change: Add the export.\nWhere: [Architect · decide: which files or modules?]';
const CARD = {
  target: 'project', projectKey: 'proj-00000001', projectName: 'proj', projectDir: '/repos/proj',
  workspaceId: null, workspaceName: null, members: null,
  workflowId: 'wf_default', workflowName: 'Default', guardrailsId: 'normal',
  brief: 'Fix the login bug', title: 'Fix login', sourceBranch: '', featureBranch: 'worca/fix-login', sourceBranchByKey: null,
  note: 'UI-only change on one module.', attachments: [],
};
const SHAPED = { ...CARD, workflowId: 'wf_shape', workflowName: 'Shaper', shape: { perspectives: ['architect'] } };
const SOURCED = { ...CARD, brief: '', source: { type: 'plugin', plugin: 'github', displayName: 'GitHub', taskId: '#12', title: 'Login bug' } };

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

async function open(t, { card = CARD, state = 'proposed', on = true, extra = {} } = {}) {
  const timers = fakeTimers();
  const rec = { grades: [], corrections: [], calls: [] };
  const block = { kind: 'card', id: CARD_ID, state, card, ...extra };
  const snap = { thread: { id: TID, title: 'T', createdAt: 't', updatedAt: 't', model: null, effort: null, sessionId: null, context: null, totals: {} },
    messages: [{ id: 'askm_u0000001', threadId: TID, seq: 1, role: 'user', text: 'hi', blocks: [], status: null, createdAt: 't' },
      { id: MID, threadId: TID, seq: 2, role: 'assistant', text: 'ok', blocks: [block], status: 'done', createdAt: 't' }],
    attachments: [], runLinks: [], inFlight: null };
  setPromptCheckPref(on);
  const ctx = makePanel({
    deps: { promptCheckTimers: timers },
    fetchHandler: (url, opts = {}) => {
      const method = (opts.method || 'GET').toUpperCase();
      rec.calls.push(`${method} ${url}`);
      if (url === '/api/prompt-check/grade') {
        return new Promise((resolve, reject) => {
          const call = { body: JSON.parse(opts.body), aborted: false };
          opts.signal?.addEventListener('abort', () => { call.aborted = true; reject(Object.assign(new Error('aborted'), { name: 'AbortError' })); });
          call.reply = (assessment = {}) => resolve({ ok: true, status: 200, json: async () => ({
            requestId: call.body.requestId, textHash: textHash(call.body.text), source: 'model',
            assessment: { isTask: true, kind: 'bug', grade: 'needs-detail', continuesRequirement: true, ...assessment },
          }) });
          rec.grades.push(call);
        });
      }
      if (url === '/api/prompt-check/improve') {
        const b = JSON.parse(opts.body);
        (rec.improves ||= []).push(b);
        return Promise.resolve({ ok: true, status: 200, json: async () => ({ requestId: b.requestId, source: 'model', kind: b.kind, model: 'Sonnet 5.5',
          rewrite: { kind: b.kind, sections: [{ id: 'change', label: 'Change', text: 'Add the export.', gaps: [] }] }, text: REWRITE, paths: [] }) });
      }
      if (url === '/api/prompt-check/kind-correction') { rec.corrections.push(JSON.parse(opts.body)); return { ok: true, status: 201, json: async () => ({ ok: true }) }; }
      if (url === `/api/ask/threads/${TID}` && method === 'GET') return { ok: true, status: 200, json: async () => snap };
      if (url === '/api/workflows') return { ok: true, status: 200, json: async () => ({ workflows: [{ id: 'wf_default', name: 'Default' }, { id: 'wf_shape', name: 'Shaper' }] }) };
      return { ok: true, status: 200, json: async () => ({}) };
    },
  });
  t.after(() => { ctx.panel.destroy(); setPromptCheckPref(false); ctx.window.close(); });
  ctx.storage.setItem('worca-cc.ask.thread', TID);
  ctx.panel.open();
  const settle = async () => { for (let i = 0; i < 5; i++) await ctx.tick(); ctx.flush(); };
  await settle();
  const graded = async (assessment = {}) => {
    timers.advance(PROMPT_CHECK_DEBOUNCE_MS);
    rec.grades.at(-1).reply(assessment);
    await settle();
  };
  const brief = () => ctx.doc.querySelector('textarea.ask-rp-brief');
  const type = (text) => { brief().value = text; brief().dispatchEvent(new ctx.window.Event('input', { bubbles: true })); };
  return { ctx, rec, timers, settle, graded, brief, type, doc: ctx.doc };
}
const chips = (s) => s.doc.querySelectorAll('[data-prompt-check]');
const prCalls = (s) => s.rec.calls.filter((c) => c.includes('/api/prompt-check/'));

test('on: one chip in the brief foot, before the character count, graded on mount as a run-card task', async (t) => {
  const s = await open(t);
  await s.graded();
  assert.equal(chips(s).length, 1);
  const foot = s.doc.querySelector('.ask-rp-brief-foot');
  assert.equal(chips(s)[0].parentNode, foot);
  assert.equal(chips(s)[0].nextElementSibling, foot.querySelector('.ask-rp-count'));
  assert.deepEqual(s.rec.grades[0].body.surface, { kind: 'run-card', id: CARD_ID });
  assert.equal(s.rec.grades[0].body.text, 'Fix the login bug');
});

test('off: 0 chips and 0 calls to either prompt-check route', async (t) => {
  const s = await open(t, { on: false });
  s.timers.advance(10_000);
  s.type('Fix the login bug on Safari when the cookie banner is open');
  s.timers.advance(10_000);
  await s.settle();
  assert.equal(chips(s).length, 0);
  assert.deepEqual(prCalls(s), []);
});

test('a short brief still grades (a brief is always a task)', async (t) => {
  const s = await open(t, { card: { ...CARD, brief: 'Fix it?' } });
  assert.equal(s.rec.grades.length, 0);
  s.timers.advance(PROMPT_CHECK_DEBOUNCE_MS);
  assert.equal(s.rec.grades.length, 1);
  assert.equal(s.rec.grades[0].body.forceTask, true);
});

test('in flight (the grade held): the chip is the same node and Start stays enabled', async (t) => {
  const s = await open(t);
  await s.graded();
  const before = chips(s)[0];
  s.type('Fix the login bug on Safari when the cookie banner is open and the user has two tabs');
  s.timers.advance(PROMPT_CHECK_DEBOUNCE_MS);
  await s.settle();
  assert.equal(s.rec.grades.length, 2);
  assert.equal(chips(s)[0], before);
  assert.equal(s.doc.querySelector('[data-ask-card-start]').disabled, false);
});

test('the same node after a snapshot reload (onHello)', async (t) => {
  const s = await open(t);
  await s.graded();
  const before = chips(s)[0];
  s.ctx.panel.onHello([]);
  await s.settle();
  assert.equal(chips(s)[0], before);
  assert.equal(chips(s).length, 1);
});

test('a correction POSTs {surface: run-card, threadId, cardId} with no text', async (t) => {
  const s = await open(t);
  await s.graded();
  chips(s)[0].querySelector('button').click();
  [...s.doc.querySelectorAll('[role="menuitemradio"]')].find((i) => i.textContent === 'Implementation task').click();
  await s.settle();
  assert.equal(s.rec.grades.at(-1).body.kind, 'implementation');
  assert.deepEqual(s.rec.corrections, [{ surface: 'run-card', threadId: TID, cardId: CARD_ID, proposedKind: 'bug', chosenKind: 'implementation' }]);
});

test('a started (progress) card has no chip and sends nothing', async (t) => {
  const s = await open(t, { state: 'started', extra: { runId: 'run-uuid-1' } });
  s.timers.advance(10_000);
  await s.settle();
  assert.equal(chips(s).length, 0);
  assert.deepEqual(prCalls(s), []);
});

test('a tracker-sourced card has no chip and sends nothing', async (t) => {
  const s = await open(t, { card: SOURCED });
  s.timers.advance(10_000);
  await s.settle();
  assert.equal(chips(s).length, 0);
  assert.deepEqual(prCalls(s), []);
});

test('a shaped card: the chip sits in the hidden brief and shows with it on Show brief', async (t) => {
  const s = await open(t, { card: SHAPED });
  await s.graded();
  const host = s.doc.querySelector('.ask-rp-brief-host');
  assert.equal(host.hidden, true);
  assert.ok(host.contains(chips(s)[0]));
  s.doc.querySelector('[data-ask-card-brief-more]').click();
  assert.equal(host.hidden, false);
  assert.equal(chips(s).length, 1);
});

test('the kind label is not repeated in the facts line or anywhere else on the card', async (t) => {
  const s = await open(t);
  await s.graded();
  const card = s.doc.querySelector('.ask-card');
  const outside = [...card.querySelectorAll('*')].filter((n) => !n.closest('[data-prompt-check]')
    && [...n.childNodes].some((c) => c.nodeType === 3 && c.textContent.includes('Bug report')));
  assert.deepEqual(outside, []);
});

test('keyboard: the picker is named Prompt kind, the menu opens and picks by keys, focus returns to the picker', async (t) => {
  const s = await open(t);
  await s.graded();
  const pick = chips(s)[0].querySelector('button');
  assert.equal(pick.getAttribute('aria-label'), 'Prompt kind: Bug report');
  pick.focus();
  pick.click();
  const menu = s.doc.querySelector('[role="menu"][aria-label="Prompt kind"]');
  menu.dispatchEvent(new s.ctx.window.KeyboardEvent('keydown', { key: 'End', bubbles: true }));
  assert.equal(s.doc.activeElement.textContent, 'Deck, doc or video');
  s.doc.activeElement.click();
  await s.settle();
  assert.equal(s.doc.activeElement, pick);
  assert.equal(pick.textContent, 'Deck, doc or video');
});

test('the card removed disposes its chip and aborts the in-flight check', async (t) => {
  const s = await open(t);
  s.timers.advance(PROMPT_CHECK_DEBOUNCE_MS);
  const live = s.rec.grades.at(-1);
  s.ctx.panel.destroy();                              // the card's cache entry is pruned: its dispose runs
  assert.equal(live.aborted, true);
  assert.equal(chips(s).length, 0);
});

test('Improve: Use this writes into the brief through its input path (count, re-check) with Undo shown; Undo restores it', async (t) => {
  const s = await open(t);
  await s.graded();
  s.doc.querySelector('[data-prompt-improve-open]').click();
  await s.settle();
  assert.equal(s.rec.improves.length, 1);
  assert.equal(s.rec.improves[0].text, 'Fix the login bug');
  s.doc.querySelector('[data-improve-act="use"]').click();
  await s.settle();
  assert.equal(s.brief().value, REWRITE);
  assert.equal(s.doc.querySelector('.ask-rp-count').textContent, `${REWRITE.length} chars`);
  assert.equal(s.doc.activeElement, s.brief());
  await s.graded();
  assert.equal(s.rec.grades.at(-1).body.text, REWRITE, 'the rewrite is re-checked');
  assert.ok(s.doc.querySelector('[data-improve-act="undo"]'), 'Undo still shown');
  s.doc.querySelector('[data-improve-act="undo"]').click();
  await s.settle();
  assert.equal(s.brief().value, 'Fix the login bug');
});
