// test/ui-run-card-perspectives.test.mjs — the Chat run card's proposed perspectives (flag proposedPerspectives,
// docs/prompt-check.md "Perspectives"): chips on every eligible card, a proposal from the prompt check's grade that never
// overrides the person's pick, and the Start body. Flag off: today's card and body. Context setup as in
// test/ui-prompt-check-run-card.test.mjs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makePanel } from './helpers/ask-panel-harness.mjs';
import { setPromptCheckPref, mountPromptCheckChip } from '../ui/public/prompt-check/chip-host.mjs';
import { applyFlags } from '../ui/public/flags.mjs';
import { textHash, PROMPT_CHECK_DEBOUNCE_MS } from '../src/shared/prompt-check/filter.mjs';
import { SIGNALS } from '../src/shared/prompt-check/perspectives.mjs';
import { DEFAULT_PERSPECTIVES } from '../src/shared/shape/perspectives.mjs';

const TID = 'ask_00000001'; const MID = 'askm_00000001'; const CARD_ID = 'card_00000001';
const CARD = { target: 'project', projectKey: 'proj-00000001', projectName: 'proj', projectDir: '/repos/proj', workspaceId: null, workspaceName: null, members: null,
  workflowId: 'wf_default', workflowName: 'Default', guardrailsId: 'normal',
  brief: 'Fix the login bug: the password reset fails', title: 'Fix login', sourceBranch: '', featureBranch: 'worca/fix-login', sourceBranchByKey: null,
  note: 'UI-only change on one module.', attachments: [] };
const SHAPED = { ...CARD, workflowId: 'wf_shape', workflowName: 'Shaper', shape: { perspectives: ['architect'] } };
const est = (planningUsd, buildUsd, minutes) => ({ costUsd: planningUsd + buildUsd, planningUsd, buildUsd, minutes, samples: 4 });
const REQ = { ...CARD, nudge: { reason: 'decisions', size: 'large', openDecisions: ['A'], perspectives: ['architect', 'qa'],
  estimates: { asIs: est(0.5, 1, 12), shaped: est(1.25, 1, 9) }, asIsAuto: false } };
const SEC = SIGNALS.find((s) => s.key === 'security').reason;

function fakeTimers() {
  let now = 0; let id = 0; const jobs = new Map();
  return {
    setTimeout: (fn, ms) => { jobs.set(++id, { at: now + ms, fn }); return id; },
    clearTimeout: (i) => { jobs.delete(i); },
    advance(ms) { now += ms; for (const [i, j] of [...jobs].sort((a, b) => a[1].at - b[1].at)) if (j.at <= now) { jobs.delete(i); j.fn(); } },
  };
}

/** The grade route's stub: each call waits for reply(assessment) or fail(). */
function gradeRoute(rec) {
  return (url, opts = {}) => new Promise((resolve, reject) => {
    const call = { body: JSON.parse(opts.body) };
    opts.signal?.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })));
    call.reply = (assessment = {}) => resolve({ ok: true, status: 200, json: async () => ({
      requestId: call.body.requestId, textHash: textHash(call.body.text), source: 'model',
      assessment: { isTask: true, kind: 'bug', grade: 'needs-detail', continuesRequirement: true, ...assessment },
    }) });
    call.fail = () => resolve({ ok: false, status: 500, json: async () => ({ error: 'boom' }) });
    rec.grades.push(call);
  });
}

async function open(t, { card = CARD, flag = true, setting = true } = {}) {
  const timers = fakeTimers();
  const rec = { grades: [], runs: [] };
  const block = { kind: 'card', id: CARD_ID, state: 'proposed', card };
  const snap = { thread: { id: TID, title: 'T', createdAt: 't', updatedAt: 't', model: null, effort: null, sessionId: null, context: null, totals: {} },
    messages: [{ id: 'askm_u0000001', threadId: TID, seq: 1, role: 'user', text: 'hi', blocks: [], status: null, createdAt: 't' },
      { id: MID, threadId: TID, seq: 2, role: 'assistant', text: 'ok', blocks: [block], status: 'done', createdAt: 't' }],
    attachments: [], runLinks: [], inFlight: null };
  setPromptCheckPref(setting);
  const grade = gradeRoute(rec);
  const ctx = makePanel({
    deps: { promptCheckTimers: timers },
    fetchHandler: (url, opts = {}) => {
      const method = (opts.method || 'GET').toUpperCase();
      if (url === '/api/prompt-check/grade') return grade(url, opts);
      if (url === '/api/run' && method === 'POST') { rec.runs.push(JSON.parse(opts.body)); return { ok: true, status: 200, json: async () => ({ runId: 'r1' }) }; }
      if (url === '/api/answerer') return { ok: true, status: 200, json: async () => ({ lead: 'architect' }) };
      if (url === `/api/ask/threads/${TID}` && method === 'GET') return { ok: true, status: 200, json: async () => snap };
      if (url === '/api/workflows') return { ok: true, status: 200, json: async () => ({ workflows: [{ id: 'wf_default', name: 'Default' }, { id: 'wf_shape', name: 'Shaper' }] }) };
      return { ok: true, status: 200, json: async () => ({}) };
    },
  });
  t.after(() => { ctx.panel.destroy(); setPromptCheckPref(false); ctx.window.close(); });
  if (flag) applyFlags({ proposedPerspectives: true }, ctx.doc);
  ctx.storage.setItem('worca-cc.ask.thread', TID);
  ctx.panel.open();
  const settle = async () => { for (let i = 0; i < 6; i++) await ctx.tick(); ctx.flush(); };
  await settle();
  const graded = async (assessment = {}) => { timers.advance(PROMPT_CHECK_DEBOUNCE_MS); rec.grades.at(-1).reply(assessment); await settle(); };
  const group = () => ctx.doc.querySelector('.ask-rp .shape-chips, .shape-chips');
  const chip = (k) => ctx.doc.querySelector(`.shape-chip[data-perspective="${k}"]`);
  const on = () => [...ctx.doc.querySelectorAll('.shape-chip.on')].map((b) => b.dataset.perspective);
  const start = async () => { ctx.doc.querySelector('[data-ask-card-start]').click(); await settle(); await settle(); return rec.runs.at(-1); };
  const brief = () => ctx.doc.querySelector('textarea.ask-rp-brief');
  const type = (text) => { brief().value = text; brief().dispatchEvent(new ctx.window.Event('input', { bubbles: true })); };
  return { ctx, rec, timers, settle, graded, group, chip, on, start, type, doc: ctx.doc };
}
const PERSP_KEYS = ['perspectives', 'perspectiveProposal'];

test('flag off, setting on: a plain card shows no chip group, and Start sends no perspective field', async (t) => {
  const s = await open(t, { flag: false });
  await s.graded();
  assert.equal(s.group(), null);
  const body = await s.start();
  assert.ok(body, 'Start posted');
  for (const k of [...PERSP_KEYS, 'shape']) assert.equal(k in body, false, k);
  assert.equal(body.workflowId, 'wf_default');
});

test('flag off, shaped card: today\'s chips and body, no proposal', async (t) => {
  const s = await open(t, { card: SHAPED, flag: false });
  await s.graded();
  assert.deepEqual(s.on(), ['product', 'architect']);
  assert.equal(s.chip('compliance'), null);
  assert.equal(s.doc.querySelectorAll('.shape-chip[aria-description]').length, 0);
  const body = await s.start();
  assert.deepEqual([body.workflowId, body.shape], ['wf_shape', { perspectives: ['product', 'architect'] }]);
  for (const k of PERSP_KEYS) assert.equal(k in body, false, k);
});

test('flag on, setting on: a graded bug brief with "password" turns on product, qa, architect and security', async (t) => {
  const s = await open(t);
  assert.deepEqual(s.on(), DEFAULT_PERSPECTIVES, 'waiting: today\'s preselection');
  await s.graded({ kind: 'bug' });
  assert.deepEqual(s.on(), ['product', 'architect', 'qa', 'security']);
  assert.equal(s.chip('security').title, SEC);
  assert.equal(s.chip('security').getAttribute('aria-description'), SEC);
});

test('onAssessment fires once per accepted grade, and never for a stale response', async (t) => {
  const s = await open(t, { flag: false });
  const { doc } = s;
  const host = doc.createElement('div');
  doc.body.appendChild(host);
  const timers = fakeTimers();
  const rec = { grades: [] };
  const seen = [];
  const chip = mountPromptCheckChip({ doc, host, surface: { kind: 'run-card', id: 'c2' }, forceTask: true, fetchImpl: gradeRoute(rec), timers,
    onAssessment: (a) => seen.push(a.kind) });
  t.after(() => chip.dispose());
  chip.input('Fix the password reset');
  timers.advance(PROMPT_CHECK_DEBOUNCE_MS);
  rec.grades[0].reply({ kind: 'bug' });
  await s.settle();
  assert.deepEqual(seen, ['bug']);
  chip.input('Add a CSV export');
  timers.advance(PROMPT_CHECK_DEBOUNCE_MS);
  const held = rec.grades.at(-1);
  chip.input('Add a CSV export and a PDF export');
  timers.advance(PROMPT_CHECK_DEBOUNCE_MS);
  held.reply({ kind: 'implementation' });
  await s.settle();
  assert.deepEqual(seen, ['bug'], 'the held, older request is stale');
  rec.grades.at(-1).reply({ kind: 'implementation' });
  await s.settle();
  assert.deepEqual(seen, ['bug', 'implementation']);
});

test('a failed grade leaves the default chips, no error in the chip group, and Start enabled', async (t) => {
  const s = await open(t);
  s.timers.advance(PROMPT_CHECK_DEBOUNCE_MS);
  s.rec.grades.at(-1).fail();
  await s.settle();
  assert.deepEqual(s.on(), DEFAULT_PERSPECTIVES);
  assert.equal(s.group().querySelectorAll(':not(.shape-chip):not(.shape-chip-more)').length, 0);
  assert.equal(s.doc.querySelector('[data-ask-card-start]').disabled, false);
});

test('a toggle then a re-grade leaves value() unchanged, updates the reasons, and keeps the same chip group node', async (t) => {
  const s = await open(t);
  const el = s.group();
  s.chip('qa').click();
  const kept = s.on();
  s.type('Rewrite the login: the password reset fails');
  await s.graded({ kind: 'bug' });
  assert.deepEqual(s.on(), kept);
  assert.equal(s.group(), el);
  s.group().querySelector('.shape-chip-more').click();
  assert.equal(s.chip('security').title, SEC);
  const body = await s.start();
  assert.deepEqual(body.perspectives, ['product', 'architect']);
});

test('Start on a plain card POSTs perspectives and perspectiveProposal { proposed, kind }, never the Shaper, no text', async (t) => {
  const s = await open(t);
  await s.graded({ kind: 'bug' });
  const body = await s.start();
  assert.deepEqual(body.perspectives, ['product', 'architect', 'qa', 'security']);
  assert.deepEqual(body.perspectiveProposal, { proposed: ['product', 'qa', 'architect', 'security'], kind: 'bug' });
  assert.equal(body.workflowId, 'wf_default');
  assert.equal('shape' in body, false);
  assert.doesNotMatch(JSON.stringify(body.perspectiveProposal), /password|reason/);
});

test('flag on, setting off: default chips, Compliance pickable, no grade call, perspectives without a proposal', async (t) => {
  const s = await open(t, { setting: false });
  await s.settle();
  assert.equal(s.rec.grades.length, 0);
  assert.deepEqual(s.on(), DEFAULT_PERSPECTIVES);
  s.group().querySelector('.shape-chip-more').click();
  s.chip('compliance').click();
  const body = await s.start();
  assert.deepEqual(body.perspectives, [...DEFAULT_PERSPECTIVES, 'compliance']);
  assert.equal('perspectiveProposal' in body, false);
  assert.equal(s.rec.grades.length, 0);
});

test('a requirements-eligible card shows the lead sentence, with no chips and no proposal', async (t) => {
  const s = await open(t, { card: REQ });
  await s.graded({ kind: 'bug' });
  assert.ok(s.doc.querySelector('.shape-lead-line'));
  assert.equal(s.group(), null);
  const body = await s.start();
  for (const k of PERSP_KEYS) assert.equal(k in body, false, k);
});

test('a shaped card with Compliance picked POSTs shape.perspectives ending in compliance, plus perspectiveProposal', async (t) => {
  const s = await open(t, { card: SHAPED });
  await s.graded({ kind: 'bug' });
  s.group().querySelector('.shape-chip-more').click();
  s.chip('compliance').click();
  const body = await s.start();
  assert.equal(body.workflowId, 'wf_shape');
  assert.equal(body.shape.perspectives.at(-1), 'compliance');
  assert.deepEqual(body.perspectiveProposal, { proposed: ['product', 'qa', 'architect', 'security'], kind: 'bug' });
  assert.equal('perspectives' in body, false);
});

test('keyboard: focus into the group, "+ N more", then Space on Compliance; aria-pressed turns true and focus stays', async (t) => {
  const s = await open(t, { setting: false });
  const more = s.group().querySelector('.shape-chip-more');
  more.focus();
  assert.equal(s.doc.activeElement, more);
  more.click();   // Enter on a button
  const c = s.chip('compliance');
  c.focus();
  c.click();      // Space on a button
  assert.equal(s.chip('compliance').getAttribute('aria-pressed'), 'true');
  assert.equal(s.doc.activeElement, s.chip('compliance'));
});

test('a disposed chip calls onAssessment 0 times for a late grade', async (t) => {
  const s = await open(t, { flag: false });
  const { doc } = s;
  const host = doc.createElement('div');
  doc.body.appendChild(host);
  const timers = fakeTimers();
  const rec = { grades: [] };
  let n = 0;
  const chip = mountPromptCheckChip({ doc, host, surface: { kind: 'run-card', id: 'c3' }, forceTask: true, fetchImpl: gradeRoute(rec), timers,
    onAssessment: () => { n += 1; } });
  chip.input('Fix the password reset');
  timers.advance(PROMPT_CHECK_DEBOUNCE_MS);
  const late = rec.grades.at(-1);
  chip.dispose();
  late.reply({ kind: 'bug' });
  await s.settle();
  assert.equal(n, 0);
});
