// test/ui-chat-run-controls.test.mjs — worca Chat P3 inside the real app shell: the run snapshot the chat card reads
// (askRunStore), the run controls app.js hands the card (window.__np.chatRunControls), and the registered card going
// live from WS frames. Boots app.js through test/helpers/run-page-boot.mjs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bootApp, helloRun } from './helpers/run-page-boot.mjs';
import { checkRows } from './helpers/rows.mjs';
import { chatCardBuilder, composerAddons } from '../ui/public/chat/extensions.mjs';

const RUN_ID = 'run-chat-1';
const PID = 'abcd1234';
const agent = (id, key, color, over = {}) => ({ id, kind: 'agent', key, x: 0, y: 0, label: key[0].toUpperCase() + key.slice(1), color,
  ports: { inputs: [{ id: 'task', type: 'md', loop: false }], outputs: [{ id: 'out', type: 'md', when: 'always' }], await: true }, ...over });
const MANIFEST = { version: 2, template: { id: 'wf_review', name: 'Review only' }, graph: {
  nodes: [agent('n_plan', 'planner', 'violet', { model: 'claude-opus-5-5' }), agent('n_rev', 'reviewer', 'peach'),
    { id: 'n_end', kind: 'end', key: null, x: 0, y: 0, label: 'End', color: '', ports: { inputs: [{ id: 'result', type: 'any' }], outputs: [], await: false } }],
  wires: [{ id: 'w1', from: { node: 'n_plan', port: 'out' }, to: { node: 'n_rev', port: 'task' }, loop: false },
    { id: 'w2', from: { node: 'n_rev', port: 'out' }, to: { node: 'n_end', port: 'result' }, loop: false }] } };
const STATE = (over = {}) => ({ type: 'state', runId: RUN_ID, id: PID, title: 'Fix login', status: 'running', startedAt: '2026-10-11T10:00:00.000Z', stepper: MANIFEST,
  steps: [{ key: 'x:n_plan:2', executionId: 'x:n_plan:2', nodeId: 'n_plan', ordinal: 2, cycle: 2, status: 'running', activeMs: 3000, runningSince: null, costUsd: 0.2, startedAt: '2026-10-11T10:00:01.000Z' }],
  active: [{ nodeId: 'n_plan', executionId: 'x:n_plan:2' }], totalCostUsd: 0.2, subAgents: [], ...over });

test('askRunStore snapshots carry the chat card fields: agent model + cycle, branch, auto, and empty result facts while live', async () => {
  const ctx = await bootApp();
  helloRun(ctx, { runId: RUN_ID, pipelineId: PID, title: 'Fix login' });
  ctx.dispatch(STATE());
  await ctx.settle();
  const snap = ctx.window.__np.askRunStore.byPipeline(PID);
  assert.equal(snap.active.length, 1);
  assert.equal(snap.active[0].nodeId, 'n_plan');
  assert.equal(snap.active[0].model, 'claude-opus-5-5');
  assert.ok(['claude-opus-5-5', 'Opus 5.5'].includes(snap.active[0].modelLabel), 'the catalog label, else the raw id');
  assert.equal(snap.active[0].cycle, 2);
  assert.deepEqual([snap.branch, snap.auto, snap.results, snap.artifacts, snap.moreArtifacts, snap.pr], ['', null, null, null, false, null]);
});

test('askRunStore snapshots carry the branch and the Auto state from frames', async () => {
  const ctx = await bootApp();
  helloRun(ctx, { runId: RUN_ID, pipelineId: PID, title: 'Fix login' });
  ctx.dispatch(STATE({ branch: { feature: 'worca/fix-login', source: 'main' }, stepper: { ...MANIFEST, auto: { status: 'decided', via: 'created' } } }));
  await ctx.settle();
  const snap = ctx.window.__np.askRunStore.byPipeline(PID);
  assert.equal(snap.branch, 'worca/fix-login');
  assert.deepEqual(snap.auto, { status: 'decided', via: 'created' });
});

const resumed = (runId) => (url) => (url === '/api/resume' ? Promise.resolve({ ok: true, status: 200, json: async () => ({ runId }) }) : null);
const button = (ctx) => { const b = ctx.window.document.createElement('button'); ctx.window.document.body.appendChild(b); return b; };

test('chat run controls: pause, resume (never leaving the page) and stop go through the run page\'s own flows', async () => {
  await checkRows([
    { name: 'pause → POST /api/pause {runId}; null on success', run: async () => {
      const ctx = await bootApp();
      helloRun(ctx, { runId: RUN_ID, pipelineId: PID });
      await ctx.settle();
      assert.equal(await ctx.window.__np.chatRunControls.pause({ runId: RUN_ID, pipelineId: PID }, null), null);
      assert.deepEqual(JSON.parse(ctx.calls.find((c) => c.url === '/api/pause').opts.body), { runId: RUN_ID });
    } },
    { name: 'resume of a paused run this tab holds: POST /api/resume, the hash stays put, the store follows the new lineage', run: async () => {
      const ctx = await bootApp({ fetchHandler: resumed('run-new') });
      helloRun(ctx, { runId: RUN_ID, pipelineId: PID, status: 'paused' });
      await ctx.settle();
      const before = ctx.window.location.hash;
      await ctx.window.__np.chatRunControls.resume({ runId: RUN_ID, pipelineId: PID }, button(ctx));
      await ctx.settle();
      assert.equal(JSON.parse(ctx.calls.find((c) => c.url === '/api/resume').opts.body).pipelineId, PID);
      assert.equal(ctx.window.location.hash, before, 'no hop to #running/<new>');
      assert.equal(ctx.window.__np.askRunStore.byPipeline(PID).runId, 'run-new');
    } },
    { name: 'resume of a paused run this tab has no model for (a REST card): the saved-run flow, again without a hop', run: async () => {
      const ctx = await bootApp({ fetchHandler: resumed('run-new-2') });
      await ctx.settle();
      const before = ctx.window.location.hash;
      await ctx.window.__np.chatRunControls.resume({ pipelineId: 'beef0001', title: 'Old run', projectDir: '/tmp/p', status: 'paused' }, button(ctx));
      await ctx.settle();
      assert.equal(JSON.parse(ctx.calls.find((c) => c.url === '/api/resume').opts.body).pipelineId, 'beef0001');
      assert.equal(ctx.window.location.hash, before);
      assert.equal(ctx.window.__np.askRunStore.get('run-new-2').pipelineId, 'beef0001');
    } },
    { name: 'stop opens #stop-modal for the run; an interrupted run is never stoppable', run: async () => {
      const ctx = await bootApp();
      helloRun(ctx, { runId: RUN_ID, pipelineId: PID, title: 'Fix login' });
      await ctx.settle();
      const modal = ctx.window.document.getElementById('stop-modal');
      ctx.window.__np.chatRunControls.stop({ runId: RUN_ID, pipelineId: PID });
      assert.equal(modal.classList.contains('hidden'), false);
      assert.equal(modal.querySelector('.stop-ident-title').textContent, 'Fix login');
      modal.querySelector('.stop-cancel').click();
      assert.equal(modal.classList.contains('hidden'), true);
      const ctx2 = await bootApp();
      helloRun(ctx2, { runId: 'run-int', pipelineId: 'cafe0001', status: 'interrupted' });
      await ctx2.settle();
      ctx2.window.__np.chatRunControls.stop({ runId: 'run-int', pipelineId: 'cafe0001', status: 'interrupted' });
      assert.equal(ctx2.window.document.getElementById('stop-modal').classList.contains('hidden'), true);
    } },
  ]);
});

// A form ask (test/ui-ask-form-panel.test.mjs's): the renderer that marks 422 errors in place.
const ASK = { type: 'question', runId: RUN_ID, id: 'questions-x:n_plan:2-r1', askId: 'questions-x_n_plan_2-r1', kind: 'form', agent: 'planner', nodeId: 'n_plan', surface: 'any',
  form: 'review-mockups', version: 1, title: 'Review mockups', data: { summary: 'Two directions.' },
  layout: [{ widget: 'markdown', bind: 'data.summary' }, { widget: 'select', field: 'verdict', label: 'Verdict' },
    { widget: 'textarea', field: 'notes', label: 'What should change?', when: { verdict: 'changes' } }],
  answerSchema: { type: 'object', required: ['verdict'], properties: { verdict: { type: 'string', enum: ['approve', 'changes'] }, notes: { type: 'string', maxLength: 4000 } } },
  files: [] };

test('chat question parity: the card host renders the run page body, a 422 marks it in place, a 200 busies it, the resolution clears it, an unrelated frame never rebuilds it', async () => {
  let n = 0;
  const ctx = await bootApp({ fetchHandler: (url) => (url === '/api/answer' ? Promise.resolve((n += 1) === 1
    ? { ok: false, status: 422, json: async () => ({ error: 'invalid answer', errors: [{ path: 'notes', code: 'maxLength', message: 'At most 4000 characters.' }] }) }
    : { ok: true, status: 200, json: async () => ({ ok: true }) }) : null) });
  helloRun(ctx, { runId: RUN_ID, pipelineId: PID, title: 'Fix login' });
  ctx.dispatch(STATE());
  ctx.dispatch(ASK);
  await ctx.settle();
  const doc = ctx.window.document;
  const host = doc.createElement('div');
  host.innerHTML = '<div class="qpanel hidden"></div>';
  doc.body.appendChild(host);
  const controls = ctx.window.__np.chatRunControls;
  const ref = { runId: RUN_ID, pipelineId: PID };
  const q = controls.paintQuestion(ref, host);
  const panel = host.querySelector('.qpanel');
  await checkRows([
    { name: 'the form mounts with the run page heading', run: async () => {
      assert.deepEqual(q, { id: ASK.id, kind: 'form', heading: 'Review mockups', step: 'Planner', stepCard: false });
      assert.ok(panel.querySelector('.af-form'));
      assert.equal(panel.classList.contains('hidden'), false);
    } },
    { name: 'an unrelated frame and a repaint keep the picked choice (no rebuild)', run: async () => {
      panel.querySelectorAll('.af-choice')[1].dispatchEvent(new ctx.window.Event('click', { bubbles: true }));   // "changes": reveals notes
      ctx.dispatch({ type: 'log', runId: 'another-run', source: 'x', level: 'info', text: 'noise', ts: Date.now() });
      await ctx.settle();
      controls.paintQuestion(ref, host);
      assert.equal(panel.querySelectorAll('.af-choice')[1].getAttribute('aria-pressed'), 'true');
    } },
    { name: 'a 422 marks the field in the card panel and un-busies it; a 200 busies it', run: async () => {
      assert.equal(await controls.answer(ref, 'wrong-id', { values: {} }), false, 'a stale question id posts nothing');
      assert.equal(n, 0);
      assert.equal(await controls.answer(ref, ASK.id, { values: { verdict: 'changes', notes: 'x' } }), false);
      const slot = [...panel.querySelectorAll('.af-err')].find((s) => !s.hidden);
      assert.equal(slot.textContent, 'At most 4000 characters.');
      assert.equal(panel.querySelector('.btn-primary').disabled, false);
      assert.equal(await controls.answer(ref, ASK.id, { values: { verdict: 'approve' } }), true);
      assert.equal(panel.querySelector('.btn-primary').disabled, true, 'busy until the run resumes');
    } },
    { name: 'question-resolved clears the card panel; the next paint returns null', run: async () => {
      ctx.dispatch({ type: 'question-resolved', runId: RUN_ID, id: ASK.id });
      await ctx.settle();
      assert.equal(panel.classList.contains('hidden'), true);
      assert.equal(panel.children.length, 0);
      assert.equal(controls.paintQuestion(ref, host), null);
    } },
  ]);
});

test('chat question parity across a resume: the same question re-asked by the new lineage re-registers the card panel under the new runId', async () => {
  const ctx = await bootApp({ fetchHandler: (url) => (url === '/api/answer' ? Promise.resolve({ ok: false, status: 422,
    json: async () => ({ error: 'invalid answer', errors: [{ path: 'verdict', code: 'required', message: 'Pick one.' }] }) }) : null) });
  helloRun(ctx, { runId: RUN_ID, pipelineId: PID, title: 'Fix login' });
  ctx.dispatch(STATE());
  ctx.dispatch(ASK);
  await ctx.settle();
  const doc = ctx.window.document;
  const host = doc.createElement('div');
  host.innerHTML = '<div class="qpanel hidden"></div>';
  doc.body.appendChild(host);
  const controls = ctx.window.__np.chatRunControls;
  const ref = { pipelineId: PID };
  controls.paintQuestion(ref, host);
  const panel = host.querySelector('.qpanel');
  assert.equal(panel.dataset.qrun, RUN_ID);
  // A new lineage of the same pipeline (a resume elsewhere) asks the same question; the old one sent no frame.
  ctx.dispatch({ type: 'run-created', runId: 'run-chat-2', title: 'Fix login', projectDir: '/tmp/p', kind: 'run', status: 'starting', startedAt: '2026-10-11T10:05:00.000Z' });
  ctx.dispatch(STATE({ runId: 'run-chat-2' }));
  ctx.dispatch({ ...ASK, runId: 'run-chat-2' });
  await ctx.settle();
  assert.equal(ctx.window.__np.askRunStore.byPipeline(PID).runId, 'run-chat-2');
  controls.paintQuestion(ref, host);
  assert.equal(panel.dataset.qrun, 'run-chat-2', 'rebuilt for the new lineage although the question key is the same');
  assert.equal(await controls.answer(ref, ASK.id, { values: {} }), false);
  assert.ok([...panel.querySelectorAll('.af-err')].some((s) => !s.hidden), 'the new lineage\'s 422 marks reach the card panel');
});

test('the registered progress card goes live from frames, shows the run page question, posts through postAnswer, and the receipt follows the resolution', async () => {
  const ctx = await bootApp();
  helloRun(ctx, { runId: RUN_ID, pipelineId: PID, title: 'Fix login' });
  ctx.dispatch(STATE());
  await ctx.settle();
  const build = chatCardBuilder('progress');
  assert.equal(typeof build, 'function', 'app.js registered the chat run card');
  const doc = ctx.window.document;
  const opened = [];
  const built = build({ kind: 'card', id: 'card_00000001', state: 'tracked', card: { type: 'progress', pipelineId: PID, runId: RUN_ID, projectKey: 'proj-00000001', title: 'Fix login', label: 'proj' } },
    { doc, win: ctx.window, fetch: (...a) => ctx.window.fetch(...a), openRunPanel: (...a) => opened.push(a), openArtifact: () => {}, announce: () => {} });
  doc.body.appendChild(built.el);
  const el = built.el;
  assert.ok(el.classList.contains('chat-rc'));
  assert.equal(el.querySelector('.chat-rc-status').dataset.state, 'working');
  assert.ok(el.querySelector('.chat-rc-well .gv-stage'), 'the Workflows graph is mounted');
  assert.equal(el.querySelector('.chat-rc-agent-cycle').textContent, 'cycle 2');
  assert.equal(el.querySelector('.chat-rc-pause').disabled, false);
  ctx.dispatch({ type: 'question', runId: RUN_ID, id: 'q-1', kind: 'questions', agent: 'planner', nodeId: 'n_plan',
    questions: [{ id: 'q1', question: 'Which database?', options: ['Postgres', 'SQLite', ''] }] });
  await ctx.settle();
  const q = el.querySelector('.chat-rc-q');
  assert.equal(q.hidden, false);
  assert.equal(q.querySelector('.chat-rc-q-head').textContent, 'A question from Planner');
  assert.equal(el.querySelector('.chat-rc-agent.is-waiting .chat-rc-agent-name').textContent, 'Planner');
  q.querySelector('.qopt').click();
  q.querySelector('.btn-primary').click();
  await ctx.settle();
  const post = ctx.calls.find((c) => c.url === '/api/answer');
  assert.ok(post, 'POST /api/answer');
  const body = JSON.parse(post.opts.body);
  assert.equal(body.id, 'q-1');
  assert.deepEqual(body.payload.answers.map((a) => a.choice), ['Postgres']);
  ctx.dispatch({ type: 'question-resolved', runId: RUN_ID, id: 'q-1' });
  await ctx.settle();
  assert.equal(el.querySelector('.chat-rc-receipt summary').textContent, '1 answer sent · Planner');
  el.querySelector('a.ask-rc-open').click();
  assert.equal(opened.at(-1)[0].pipelineId, PID);
  built.dispose();
});

test('chat run controls: a resume of a pipeline this tab already runs posts nothing; pause/stop for runs this tab holds no model of; stop of a held paused run reaches the card', async () => {
  await checkRows([
    { name: 'resume while the pipeline is already live here: no POST', run: async () => {
      const ctx = await bootApp({ fetchHandler: resumed('run-x') });
      helloRun(ctx, { runId: RUN_ID, pipelineId: PID, title: 'Fix login' });
      ctx.dispatch(STATE());
      await ctx.settle();
      await ctx.window.__np.chatRunControls.resume({ pipelineId: PID, status: 'paused', title: 'Fix login' }, button(ctx));
      await ctx.settle();
      assert.equal(ctx.calls.filter((c) => c.url === '/api/resume').length, 0);
    } },
    { name: 'pause of a run this tab holds no model for says why', run: async () => {
      const ctx = await bootApp();
      await ctx.settle();
      assert.equal(await ctx.window.__np.chatRunControls.pause({ pipelineId: 'beef0002', runId: 'nope' }, null), 'This run is not running here');
    } },
    { name: 'stop of a paused run this tab has no model for (a REST card) opens #stop-modal by pipeline id', run: async () => {
      const ctx = await bootApp();
      await ctx.settle();
      const modal = ctx.window.document.getElementById('stop-modal');
      ctx.window.__np.chatRunControls.stop({ pipelineId: 'beef0001', title: 'Old run', branch: 'worca/old', status: 'paused' }, () => {});
      assert.equal(modal.classList.contains('hidden'), false);
      assert.equal(modal.querySelector('.stop-ident-title').textContent, 'Old run');
      assert.equal(modal.dataset.pipelineId, 'beef0001');
    } },
    { name: 'stop of a paused run this tab holds: stopRun finishes it locally (no frame), and the caller\'s onStopped runs (the card itself: the registered-card test below)', run: async () => {
      const ctx = await bootApp({ fetchHandler: (url) => (url === '/api/stop' ? Promise.resolve({ ok: true, status: 200, json: async () => ({ ok: true }) }) : null) });
      helloRun(ctx, { runId: 'run-p', pipelineId: 'beef0003', title: 'Paused run', status: 'paused' });
      await ctx.settle();
      let heard = 0;
      ctx.window.__np.chatRunControls.stop({ runId: 'run-p', pipelineId: 'beef0003', status: 'paused' }, () => { heard += 1; });
      const modal = ctx.window.document.getElementById('stop-modal');
      assert.equal(modal.classList.contains('hidden'), false);
      modal.querySelector('.stop-confirm').click();
      await ctx.settle();
      assert.equal(heard, 1);
    } },
  ]);
});

test('chat question parity: a card panel mounted while an answer is in flight is busy at once', async () => {
  const waits = [];
  const ctx = await bootApp({ fetchHandler: (url) => (url === '/api/answer' ? new Promise((r) => waits.push(r)) : null) });
  helloRun(ctx, { runId: RUN_ID, pipelineId: PID, title: 'Fix login' });
  ctx.dispatch(STATE());
  ctx.dispatch(ASK);
  await ctx.settle();
  const doc = ctx.window.document;
  const mkHost = () => { const h = doc.createElement('div'); h.innerHTML = '<div class="qpanel hidden"></div>'; doc.body.appendChild(h); return h; };
  const controls = ctx.window.__np.chatRunControls;
  controls.paintQuestion({ pipelineId: PID }, mkHost());
  const pending = controls.answer({ pipelineId: PID }, ASK.id, { values: { verdict: 'approve' } });
  const late = mkHost();
  controls.paintQuestion({ pipelineId: PID }, late);
  assert.equal(late.querySelector('.btn-primary').disabled, true);
  for (const r of waits) r({ ok: true, status: 200, json: async () => ({ ok: true }) });
  await pending;
});

test('the registered card answers a recovery question with the recovery step card\'s own buttons, and names the decision (R11, shaper-cards D4/D5)', async () => {
  const ctx = await bootApp({ fetchHandler: (url) => (url === '/api/answer' ? Promise.resolve({ ok: true, status: 200, json: async () => ({ ok: true }) }) : null) });
  helloRun(ctx, { runId: RUN_ID, pipelineId: PID, title: 'Fix login' });
  ctx.dispatch(STATE());
  await ctx.settle();
  const doc = ctx.window.document;
  const built = chatCardBuilder('progress')({ kind: 'card', id: 'card_00000002', state: 'tracked', card: { type: 'progress', pipelineId: PID, runId: RUN_ID, projectKey: 'proj-00000001', title: 'Fix login' } },
    { doc, win: ctx.window, fetch: (...a) => ctx.window.fetch(...a), openRunPanel: () => {}, openArtifact: () => {}, announce: () => {} });
  doc.body.appendChild(built.el);
  ctx.dispatch({ type: 'question', runId: RUN_ID, id: 'rec-1', kind: 'recovery', nodeId: 'n_plan', recovery: { cls: 'rate_limit', message: '429', options: [{ id: 'retry' }, { id: 'pause' }] } });
  await ctx.settle();
  built.el.querySelector('.chat-rc-q .recovery-retry').click();
  await ctx.settle();
  assert.deepEqual(JSON.parse(ctx.calls.find((c) => c.url === '/api/answer').opts.body).payload, { decision: 'retry' });
  ctx.dispatch({ type: 'question-resolved', runId: RUN_ID, id: 'rec-1' });
  await ctx.settle();
  assert.equal(ctx.calls.filter((c) => c.url === '/api/answer').length, 1, 'posted once: the card\'s delegate does not double-post');
  assert.equal(built.el.querySelector('.chat-rc-receipt summary').textContent, 'Retried');
  built.dispose();
});

test('the registered card follows a resume at once (no frame reaches it) and a stop from another surface reaches it; a resume without a button still runs', async () => {
  const cardCtx = (ctx) => ({ doc: ctx.window.document, win: ctx.window, fetch: (...a) => ctx.window.fetch(...a), openRunPanel: () => {}, openArtifact: () => {}, announce: () => {} });
  const block = (id, pid, runId) => ({ kind: 'card', id, state: 'tracked', card: { type: 'progress', pipelineId: pid, runId, projectKey: 'proj-00000001', title: 'Fix login' } });
  await checkRows([
    { name: 'resume from the card: the card paints the new lineage before any frame', run: async () => {
      const ctx = await bootApp({ fetchHandler: resumed('run-new') });
      helloRun(ctx, { runId: RUN_ID, pipelineId: PID, title: 'Fix login', status: 'paused' });
      await ctx.settle();
      const built = chatCardBuilder('progress')(block('card_00000003', PID, RUN_ID), cardCtx(ctx));
      ctx.window.document.body.appendChild(built.el);
      assert.equal(built.el.querySelector('.chat-rc-pause').textContent, 'Resume');
      built.el.querySelector('.chat-rc-pause').click();
      await ctx.settle();
      assert.equal(built.el.dataset.runStatus, 'starting', 'the new lineage');
      assert.equal(built.el.querySelector('.chat-rc-pause').dataset.action, 'pause');
      built.dispose();
    } },
    { name: 'resume from a REST card (a run this tab has no model of): the card paints the new lineage before any frame', run: async () => {
      const ctx = await bootApp({ fetchHandler: (url) => (url === '/api/resume' ? Promise.resolve({ ok: true, status: 200, json: async () => ({ runId: 'run-new-5' }) })
        : url === '/api/ask/runs/beef0005' ? Promise.resolve({ ok: true, status: 200, json: async () => ({ state: { id: 'beef0005', title: 'Old run', projectDir: '/tmp/p', status: 'paused' }, live: null, extras: null }) }) : null) });
      await ctx.settle();
      const built = chatCardBuilder('progress')(block('card_00000005', 'beef0005', null), cardCtx(ctx));
      ctx.window.document.body.appendChild(built.el);
      await ctx.settle();
      assert.equal(built.el.querySelector('.chat-rc-pause').textContent, 'Resume', 'painted from REST');
      built.el.querySelector('.chat-rc-pause').click();
      await ctx.settle();
      assert.equal(ctx.window.__np.askRunStore.get('run-new-5').pipelineId, 'beef0005');
      assert.equal(built.el.dataset.runStatus, 'starting', 'the new lineage');
      built.dispose();
    } },
    { name: 'a stop of a held paused run from another surface (the run panel) reaches the card', run: async () => {
      const ctx = await bootApp({ fetchHandler: (url) => (url === '/api/stop' ? Promise.resolve({ ok: true, status: 200, json: async () => ({ ok: true }) }) : null) });
      helloRun(ctx, { runId: 'run-p', pipelineId: 'beef0003', title: 'Paused run', status: 'paused' });
      await ctx.settle();
      const built = chatCardBuilder('progress')(block('card_00000004', 'beef0003', 'run-p'), cardCtx(ctx));
      ctx.window.document.body.appendChild(built.el);
      ctx.window.__np.chatRunControls.stop({ runId: 'run-p', pipelineId: 'beef0003', status: 'paused' }, () => {});
      ctx.window.document.getElementById('stop-modal').querySelector('.stop-confirm').click();
      await ctx.settle();
      assert.equal(built.el.dataset.runStatus, 'stopped');
      built.dispose();
    } },
    { name: 'resume of a REST card without a button: the saved-run flow gets a stand-in button', run: async () => {
      const ctx = await bootApp({ fetchHandler: resumed('run-new-3') });
      await ctx.settle();
      await ctx.window.__np.chatRunControls.resume({ pipelineId: 'beef0004', title: 'Old run', projectDir: '/tmp/p', status: 'paused' }, null);
      await ctx.settle();
      const post = ctx.calls.find((c) => c.url === '/api/resume');
      assert.ok(post, 'POST /api/resume');
      assert.equal(JSON.parse(post.opts.body).pipelineId, 'beef0004');
    } },
  ]);
});

// INDEX R8 / lead call 6: P2's notices and Ask's prompt send a resume that needs the user (its own cost limit) to the
// card's Resume. The card has no cost banner, so its Resume asks the banner's "Continue without cap?" and resends.
const costCapped = () => {
  let n = 0;
  return (url) => (url === '/api/resume' ? Promise.resolve((n += 1) === 1
    ? { ok: false, status: 403, json: async () => ({ error: 'pipeline cost limit reached', needsOverride: true, budget: {} }) }
    : { ok: true, status: 200, json: async () => ({ runId: 'run-new' }) }) : null);
};
const confirmShown = async (doc) => {
  for (let i = 0; i < 50 && doc.getElementById('confirm-modal').classList.contains('hidden'); i++) await new Promise((r) => setTimeout(r, 20));
  return !doc.getElementById('confirm-modal').classList.contains('hidden');
};
for (const [name, seed, ref] of [
  ['a held paused run', (ctx) => helloRun(ctx, { runId: 'r-cap', pipelineId: 'cafe0002', status: 'paused', pauseReason: 'cost_pipeline' }), { runId: 'r-cap', pipelineId: 'cafe0002' }],
  ['a saved paused run (REST card)', () => {}, { pipelineId: 'cafe0003', title: 'Old', projectDir: '/tmp/p', status: 'paused' }],
]) {
  test(`chat run controls: Resume past the run's own cost limit asks "Continue without cap?" and resends with the override — ${name}`, async () => {
    const ctx = await bootApp({ fetchHandler: costCapped() });
    seed(ctx);
    await ctx.settle();
    const doc = ctx.window.document;
    const before = ctx.window.location.hash;
    const pending = ctx.window.__np.chatRunControls.resume(ref, button(ctx));
    assert.equal(await confirmShown(doc), true, 'the cost banner\'s question');
    assert.equal(doc.getElementById('confirm-title').textContent, 'Continue without cap?');
    assert.equal(doc.activeElement, doc.getElementById('confirm-cancel'), 'the card\'s Resume never named the cap: a second Enter or Space must not confirm it');
    doc.getElementById('confirm-ok').click();
    await pending;
    await ctx.settle();
    const bodies = ctx.calls.filter((c) => c.url === '/api/resume').map((c) => JSON.parse(c.opts.body));
    assert.deepEqual(bodies.map((b) => b.ignoreCostCap), [undefined, true]);
    assert.equal(ctx.window.location.hash, before, 'still no hop to #running/<new>');
    assert.equal(doc.getElementById('toasts').textContent.includes('Could not resume'), false, 'no failure toast');
  });
}

for (const [name, seed, ref] of [
  ['a held paused run', (ctx) => helloRun(ctx, { runId: 'r-cap', pipelineId: 'cafe0002', status: 'paused', pauseReason: 'cost_pipeline' }), { runId: 'r-cap', pipelineId: 'cafe0002' }],
  ['a saved paused run (REST card)', () => {}, { pipelineId: 'cafe0003', title: 'Old', projectDir: '/tmp/p', status: 'paused' }],
]) {
  test(`chat run controls: Cancel on "Continue without cap?" resumes nothing, shows no failure toast and gives the focus back to Resume — ${name}`, async () => {
    const ctx = await bootApp({ fetchHandler: costCapped() });
    seed(ctx);
    await ctx.settle();
    const doc = ctx.window.document;
    const btn = button(ctx);
    const pending = ctx.window.__np.chatRunControls.resume(ref, btn);
    assert.equal(await confirmShown(doc), true);
    doc.getElementById('confirm-cancel').click();
    await pending;
    await ctx.settle();
    assert.equal(ctx.calls.filter((c) => c.url === '/api/resume').length, 1, 'one refused POST, no second one');
    assert.equal(doc.getElementById('toasts').textContent.includes('Could not resume'), false);
    assert.equal(doc.activeElement, btn, 'Cancel: the focus goes back to the Resume the user pressed');
    assert.equal(btn.disabled, false);
    if (ref.runId) assert.equal(ctx.window.__np.askRunStore.byPipeline('cafe0002').status, 'paused', 'still the paused run');
  });
}

test('the run page\'s own Resume is unchanged: no costConfirm, so a run past its cost limit gets the flow\'s toast and the cost banner keeps the override', async () => {
  const ctx = await bootApp({ fetchHandler: costCapped() });
  helloRun(ctx, { runId: 'r-cap', pipelineId: 'cafe0002', status: 'paused', pauseReason: 'cost_pipeline' });
  await ctx.settle();
  const doc = ctx.window.document;
  const pending = ctx.window.__np.resumeRunFromCard('r-cap', button(ctx));
  assert.equal(await confirmShown(doc), false, 'the run page asks nothing here (its cost banner holds "Continue without cap")');
  await pending;
  await ctx.settle();
  assert.equal(ctx.calls.filter((c) => c.url === '/api/resume').length, 1);
  assert.equal(doc.getElementById('toasts').textContent.includes('Could not resume'), true);
});

// The saved run's own Resume (History, no costConfirm) on the same 403: its cost banner holds the override, so the
// flow asks nothing and shows its toast — the resumePipeline guard's twin of the run page's test above.
test('the saved run\'s own Resume is unchanged too: no costConfirm, so a 403 needsOverride gets the flow\'s toast, not "Continue without cap?"', async () => {
  const capped = costCapped();
  const ctx = await bootApp({ fetchHandler: (url) => {
    if (url.endsWith('/api/history/k1/h1')) return Promise.resolve({ ok: true, status: 200, json: async () => ({ state: { id: 'h1', phase: 'implement', status: 'paused', totalCostUsd: 5.2, steps: [] } }) });
    if (url.endsWith('/api/history')) return Promise.resolve({ ok: true, status: 200, json: async () => ({ pipelines: [
      { id: 'h1', projectKey: 'k1', title: 'Pipe cap', status: 'paused', pauseReason: 'cost_pipeline', startedAt: '2026-01-01T00:00:00Z' }], live: [], ghAvailable: false }) });
    return capped(url);
  } });
  await ctx.settle();
  ctx.go('history/k1/h1');
  await ctx.settle(6);
  const doc = ctx.window.document;
  const resume = doc.querySelector('#hist-detail .hd-resume');
  assert.equal(resume.disabled, false);
  resume.click();
  assert.equal(await confirmShown(doc), false, 'History asks nothing here (its cost banner holds "Continue without cap")');
  await ctx.settle();
  assert.equal(ctx.calls.filter((c) => c.url === '/api/resume').length, 1, 'one refused POST, no resend');
  assert.equal(doc.getElementById('toasts').textContent.includes('Could not resume'), true);
  assert.equal(resume.title, 'Could not resume: pipeline cost limit reached');
});

test('resume from a REST card seeds the new run\'s log from the run\'s own History route — a workspace run\'s from the workspace route', async () => {
  await checkRows([
    { name: 'a workspace run', ref: { pipelineId: 'beef0007', workspaceId: 'wks-0000abcd', title: 'WS run', projectDir: '/tmp/api', status: 'paused' },
      log: '/api/workspaces/wks-0000abcd/runs/beef0007/log' },
    { name: 'a project run', ref: { pipelineId: 'beef0008', projectKey: 'proj-00000001', title: 'Old run', projectDir: '/tmp/p', status: 'paused' },
      log: '/api/history/proj-00000001/beef0008/log' },
  ].map(({ name, ref, log }) => ({ name, run: async () => {
    const ctx = await bootApp({ fetchHandler: resumed('run-new-8') });
    await ctx.settle();
    await ctx.window.__np.chatRunControls.resume(ref, button(ctx));
    await ctx.settle();
    assert.equal(JSON.parse(ctx.calls.find((c) => c.url === '/api/resume').opts.body).pipelineId, ref.pipelineId);
    assert.ok(ctx.calls.some((c) => c.url === log), `log seed from ${log}: ${ctx.calls.map((c) => c.url).filter((u) => u.endsWith('/log')).join(', ')}`);
  } })));
});

test('two cards for one run in one chat (a started proposal and a track_run card): an answer from one busies both, each receipt says what it saw, and disposing one keeps the other\'s panel', async () => {
  const waits = [];
  const ctx = await bootApp({ fetchHandler: (url, opts) => {
    if (url !== '/api/answer') return null;
    if (JSON.parse(opts.body).id === ASK.id) return Promise.resolve({ ok: false, status: 422, json: async () => ({ error: 'invalid answer', errors: [{ path: 'verdict', code: 'required', message: 'Pick one.' }] }) });
    return new Promise((r) => waits.push(r));
  } });
  helloRun(ctx, { runId: RUN_ID, pipelineId: PID, title: 'Fix login' });
  ctx.dispatch(STATE());
  await ctx.settle();
  const doc = ctx.window.document;
  const cardCtx = { doc, win: ctx.window, fetch: (...a) => ctx.window.fetch(...a), openRunPanel: () => {}, openArtifact: () => {}, announce: () => {} };
  const build = chatCardBuilder('progress');
  const A = build({ kind: 'card', id: 'card_0000000a', state: 'started', runId: RUN_ID, card: { target: 'project', projectKey: 'proj-00000001', projectName: 'proj', title: 'Fix login', brief: 'Fix the login bug' } }, cardCtx);
  const B = build({ kind: 'card', id: 'card_0000000b', state: 'tracked', card: { type: 'progress', pipelineId: PID, runId: RUN_ID, title: 'Fix login', label: 'proj' } }, cardCtx);
  doc.body.append(A.el, B.el);
  ctx.dispatch({ type: 'question', runId: RUN_ID, id: 'q-1', kind: 'questions', agent: 'planner', nodeId: 'n_plan',
    questions: [{ id: 'q1', question: 'Which database?', options: ['Postgres', 'SQLite', ''] }] });
  await ctx.settle();
  const qa = A.el.querySelector('.chat-rc-q');
  const qb = B.el.querySelector('.chat-rc-q');
  assert.ok(qa.querySelector('.qopt') && qb.querySelector('.qopt'), 'both cards show the question');
  qa.querySelector('.qopt').click();
  qa.querySelector('.btn-primary').click();
  await ctx.settle();
  assert.equal(ctx.calls.filter((c) => c.url === '/api/answer').length, 1);
  assert.equal(qb.querySelector('.btn-primary').disabled, true, 'the other card\'s panel is busy too');
  ctx.dispatch({ type: 'question-resolved', runId: RUN_ID, id: 'q-1' });   // before the 200, as answerRun broadcasts it
  for (const r of waits) r({ ok: true, status: 200, json: async () => ({ ok: true }) });
  await ctx.settle(6);
  assert.equal(A.el.querySelector('.chat-rc-receipt summary').textContent, '1 answer sent · Planner');
  assert.equal(B.el.querySelector('.chat-rc-receipt summary').textContent, 'Answered · Planner');
  // The next question mounts in both; one card goes away; the other's panel still gets the run page's 422 marks.
  ctx.dispatch(ASK);
  await ctx.settle();
  assert.ok(qa.querySelector('.af-form') && qb.querySelector('.af-form'));
  B.dispose();
  qa.querySelectorAll('.af-choice')[0].dispatchEvent(new ctx.window.Event('click', { bubbles: true }));
  qa.querySelector('.btn-primary').click();
  await ctx.settle(6);
  assert.equal([...qa.querySelectorAll('.af-err')].find((s) => !s.hidden).textContent, 'Pick one.', 'disposing B released only B\'s panel');
  A.dispose();
});

test('a finished run card painted before the first History load offers Create pull request once that load names a PR host', async () => {
  let release;
  const gate = new Promise((r) => { release = r; });
  const ctx = await bootApp({ fetchHandler: (url) => {
    if (url === '/api/history') return gate.then(() => ({ ok: true, status: 200, json: async () => ({ pipelines: [], live: [], ghAvailable: true }) }));
    if (url === '/api/ask/runs/beef00aa') return Promise.resolve({ ok: true, status: 200, json: async () => ({ state: { id: 'beef00aa', title: 'Done run', projectDir: '/tmp/p', projectKey: 'proj-00000001', status: 'done' }, live: null,
      extras: { results: { filesChanged: 1, additions: 2, deletions: 0, checks: 0, topFiles: [] }, artifacts: [], moreArtifacts: false, pr: null } }) });
    return null;
  } });
  ctx.wsBox.ws.dispatch('open', {});
  ctx.dispatch({ type: 'hello', runs: [] });   // the first connect loads History in the background (cold cache here)
  await ctx.settle();
  const doc = ctx.window.document;
  const built = chatCardBuilder('progress')({ kind: 'card', id: 'card_000000aa', state: 'tracked', card: { type: 'progress', pipelineId: 'beef00aa', runId: 'beef00aa', projectKey: 'proj-00000001', title: 'Done run' } },
    { doc, win: ctx.window, fetch: (...a) => ctx.window.fetch(...a), openRunPanel: () => {}, openArtifact: () => {}, announce: () => {} });
  doc.body.appendChild(built.el);
  await ctx.settle(6);
  assert.equal(built.el.querySelector('.chat-rc-res-title').textContent, 'Clean: no blocking issues flagged');
  assert.equal(built.el.querySelector('.chat-rc-create-pr'), null, 'no PR host known yet');
  release();
  await ctx.settle(10);
  assert.ok(built.el.querySelector('.chat-rc-create-pr'), 'the History load named a PR host: no frame needed');
  built.dispose();
});

test('a card for a run another process drives (REST only, no live model here) shows no dead Stop; once hello brings the run, Stop opens #stop-modal', async () => {
  const ctx = await bootApp({ fetchHandler: (url) => (url === `/api/ask/runs/${PID}`
    ? Promise.resolve({ ok: true, status: 200, json: async () => ({ state: { id: PID, title: 'Fix login', projectDir: '/tmp/p', projectKey: 'proj-00000001', status: 'running', stepper: MANIFEST, steps: [], active: [] }, live: null, extras: null }) })
    : null) });
  ctx.wsBox.ws.dispatch('open', {});
  ctx.dispatch({ type: 'hello', runs: [] });   // this server runs nothing: a CLI run, or another worca's
  await ctx.settle();
  const doc = ctx.window.document;
  const built = chatCardBuilder('progress')({ kind: 'card', id: 'card_000000c1', state: 'tracked', card: { type: 'progress', pipelineId: PID, runId: PID, projectKey: 'proj-00000001', title: 'Fix login' } },
    { doc, win: ctx.window, fetch: (...a) => ctx.window.fetch(...a), openRunPanel: () => {}, openArtifact: () => {}, announce: () => {} });
  doc.body.appendChild(built.el);
  await ctx.settle(6);
  const el = built.el;
  const modal = doc.getElementById('stop-modal');
  const stop = el.querySelector('.chat-rc-stop');
  assert.equal(el.dataset.runStatus, 'running');
  assert.equal(el.querySelector('.chat-rc-foot').hidden, false, 'Pause still says why it cannot');
  // Never a button that does nothing: a press on it would open no modal and post nothing.
  assert.equal(stop.disabled, true, 'no Stop this server cannot honour');
  assert.equal(stop.title, 'Open the run to stop it');
  helloRun(ctx, { runId: RUN_ID, pipelineId: PID, title: 'Fix login' });
  ctx.dispatch(STATE());
  await ctx.settle();
  assert.equal(el.querySelector('.chat-rc-status').dataset.state, 'working', 'the card went live');
  assert.equal(stop.hidden, false);
  assert.equal(stop.disabled, false, 'this tab holds the run now: Stop is back');
  stop.click();
  assert.equal(modal.classList.contains('hidden'), false, 'Stop opens the run page\'s warning');
  assert.equal(modal.dataset.runId, RUN_ID);
  modal.querySelector('.stop-cancel').click();
  built.dispose();
});

test('app.js registers the "→ run" composer add-on', async () => {
  await bootApp();
  assert.ok(composerAddons().some((a) => a.id === 'direction'));
});

test('a Chat card built before the run groups load becomes a group card once they do, and its Stop stops the group (never "Stop this pipeline?")', async () => {
  const P = ['aaaa0001', 'aaaa0002', 'aaaa0003', 'aaaa0004'];
  const st = ['done', 'running', 'running', 'stopped'];
  const member = (i) => ({ position: i + 1, title: `Run ${i + 1}`, pipelineId: P[i], ticketId: null, status: st[i], pr: null, ticket: null, adhoc: true, after: null });
  const GROUPS = { groups: [{ id: 'g_my', kind: 'user', title: 'My group', projectKey: null, planning: null, members: P.map((_, i) => member(i)), cost: { usd: 0, byPipeline: {} } }] };
  const json = (b) => Promise.resolve(new Response(JSON.stringify(b), { status: 200, headers: { 'content-type': 'application/json' } }));
  let release = null;
  const gated = new Promise((r) => { release = r; });
  const hist = P.map((id, i) => ({ id, projectKey: 'acme', title: `Run ${i + 1}`, status: st[i], mtime: Date.now() }));
  const fetchHandler = (url) => (url.startsWith('/api/ask/runs/')
    ? json({ state: { id: P[3], title: 'Run 4', status: 'stopped', stepper: null, steps: [], active: [] }, extras: null })
    : url.startsWith('/api/run-groups') ? gated.then(() => json(GROUPS))
      : url.startsWith('/api/history') ? json({ pipelines: hist }) : null);
  const ctx = await bootApp({ fetchHandler });
  ctx.wsBox.ws.dispatch('open', {});
  ctx.dispatch({ type: 'hello', runs: [1, 2].map((i) => ({ runId: `run-${i + 1}`, pipelineId: P[i], title: `Run ${i + 1}`, projectDir: '/tmp/p',
    status: 'running', kind: 'run', startedAt: '2026-01-01T00:00:00Z' })) });
  for (const i of [1, 2]) ctx.dispatch(STATE({ runId: `run-${i + 1}`, id: P[i], title: `Run ${i + 1}` }));
  await ctx.settle(8);
  ctx.go('chat');
  await ctx.settle(8);
  const doc = ctx.window.document;
  const built = chatCardBuilder('progress')({ kind: 'card', id: 'card_stopped', state: 'tracked',
    card: { type: 'progress', pipelineId: P[3], runId: P[3], projectKey: 'acme', title: 'Run 4' } },
  { doc, win: ctx.window, fetch: (...a) => ctx.window.fetch(...a), openRunPanel: () => {}, openArtifact: () => {}, announce: () => {} });
  doc.body.appendChild(built.el);
  await ctx.settle(8);
  assert.equal(built.el.querySelector('.kind-chip').hidden, true, 'no groups yet');
  release();
  await ctx.settle(8);
  assert.equal(built.el.querySelector('.kind-chip').textContent, 'Group · 4 runs', 'the groups load repaints the card, with no run frame');
  assert.equal(built.el.querySelector('.kind-chip').hidden, false);
  // A stale paint hands act() no row: Stop still acts on the run's group.
  ctx.window.__np.chatRunControls.act({ pipelineId: P[1] }, 'stop', null, null);
  await ctx.settle(4);
  assert.match(doc.getElementById('confirm-title').textContent, /Stop 2 runs\?/);
  doc.getElementById('confirm-cancel').click();
  await ctx.settle(4);
  built.el.querySelector('.chat-rc-actions > [data-model-action="stop"]:not([hidden])').click();
  await ctx.settle(4);
  assert.ok(doc.getElementById('stop-modal').classList.contains('hidden'), 'never the single run\'s Stop');
  assert.match(doc.getElementById('confirm-modal').textContent, /Stop 2 runs\?/);
  built.dispose();
});
