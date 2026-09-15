// test/ui-question-workflow.test.mjs — the `workflow` question arm (spec §7.4/§5.4): Auto's proposal
// rendered inside the run card's and the detail's question panel, with the tunables table and the
// Accept / Revise / Cancel payloads. Boot preamble copied from test/ui-question.test.mjs:19-82
// (house convention: duplicated per suite) and wrapped with an /api/answer recorder.
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { JSDOM } from 'jsdom';
import { confirmDialog, cancelDialog, dialogText } from './helpers/confirm-modal.mjs';
import { proposalFor, WEB_TASK } from './helpers/auto-proposal-fixture.mjs';
import { FLOW_PAD_Y } from '../src/shared/graph/flow-layout.mjs';

const htmlPath = fileURLToPath(new URL('../ui/public/index.html', import.meta.url));
const appPath = fileURLToPath(new URL('../ui/public/app.js', import.meta.url));

const wins = [];
afterEach(() => { for (const w of wins.splice(0)) w.close(); });

async function bootBase({ fetchHandler } = {}) {
  const dom = new JSDOM(readFileSync(htmlPath, 'utf8'), { url: 'http://localhost:4317/' });
  const { window } = dom;
  wins.push(window);

  const wsBox = { ws: null };
  window.WebSocket = class {
    constructor() { this.readyState = 1; this._listeners = {}; wsBox.ws = this; }
    send() {}
    close() {}
    addEventListener(type, fn) { (this._listeners[type] ||= []).push(fn); }
    dispatch(type, evt) { (this._listeners[type] || []).forEach((fn) => fn(evt)); }
  };

  const calls = [];
  window.fetch = (url, opts) => {
    calls.push({ url: String(url), opts: opts || {} });
    if (fetchHandler) { const r = fetchHandler(String(url), opts || {}); if (r) return r; }
    return Promise.resolve({ ok: true, status: 200, json: async () => ({ projects: [], config: { steps: {}, customModels: [] }, models: [], efforts: [] }) });
  };

  for (const k of ['window', 'document', 'location', 'localStorage', 'WebSocket', 'fetch', 'navigator']) {
    try { Object.defineProperty(globalThis, k, { value: window[k], configurable: true, writable: true }); } catch { /* read-only */ }
  }
  globalThis.window = window;
  globalThis.document = window.document;

  await import(pathToFileURL(appPath).href + `?b=${Date.now()}_${Math.random()}`);
  await new Promise((r) => setTimeout(r, 0));

  const dispatch = (msg) => wsBox.ws.dispatch('message', { data: JSON.stringify(msg) });
  const showRunning = () => { window.location.hash = 'running'; window.dispatchEvent(new window.Event('hashchange')); };
  return { window, dispatch, showRunning, calls, wsBox };
}

async function boot({ answerOk = true } = {}) {
  const answers = [];
  const ctx = await bootBase({
    fetchHandler: (url, opts) => {
      if (url.endsWith('/api/answer') && (opts.method || 'GET') === 'POST') {
        answers.push(JSON.parse(opts.body));
        if (!answerOk) return Promise.resolve({ ok: false, status: 503, json: async () => ({ error: 'the run went away' }) });
        return Promise.resolve({ ok: true, status: 200, json: async () => ({ ok: true }) });
      }
      return null;                                   // falsy => bootBase's default 200 for the boot fetches
    },
  });
  return { ...ctx, answers };
}

const RUN_ID = 'run-aaa';
const settle = async (window, n = 3) => { for (let i = 0; i < n; i += 1) await new Promise((r) => setTimeout(r, 0)); };

function helloRunning(ctx, extra = {}) {
  ctx.wsBox.ws.dispatch('open', {});
  ctx.dispatch({ type: 'hello', runs: [{ runId: RUN_ID, title: 'Demo run', projectDir: '/tmp/p', status: 'running', startedAt: '2026-01-01T00:00:00Z', ...extra }] });
}
const cardOf = (ctx) => ctx.window.document.querySelector(`.run-card[data-run-id="${RUN_ID}"]`);

const DECIDING = { version: 2, template: { id: 'wf_auto', name: 'Auto' }, auto: { status: 'deciding', humanInLoop: true }, graph: { nodes: [], wires: [] }, bookends: { preflight: true, done: true }, steps: [{ kind: 'preflight', nodes: [{ id: 'preflight', label: 'Preflight', sub: 'checks' }] }, { kind: 'done', nodes: [{ id: 'done', label: 'Done', sub: 'complete' }] }], feedbacks: [] };

const ask = (ctx, p = proposalFor()) => { ctx.dispatch({ type: 'question', runId: RUN_ID, id: `auto-${p.round}`, kind: 'workflow', workflow: p }); return p; };
const panelOf = (ctx) => cardOf(ctx).querySelector('.qpanel');

test('the workflow question renders head, the shared body, the graph at chat scale (4 per row in a 702 host) and the table', async () => {
  const ctx = await boot(); helloRunning(ctx, { stepper: DECIDING }); ctx.showRunning();
  const p = ask(ctx);
  const panel = panelOf(ctx);
  assert.ok(panel.classList.contains('qpanel-workflow')); assert.equal(panel.classList.contains('hidden'), false);
  assert.equal(panel.querySelector('.qpanel-head b').textContent, 'Auto proposes a workflow · round 1');
  assert.equal(panel.querySelector('.qcount').textContent, 'workflow');
  assert.equal(panel.querySelectorAll('.qblock').length, 0, 'not the clarify body');
  const stage = panel.querySelector('.ask-wfcard-graph .gv-stage.gv-flow');
  assert.ok(stage); assert.equal(stage.style.getPropertyValue('--gv-scale'), '0.65');
  const cards = [...panel.querySelectorAll('.ask-wfcard-graph .node')];
  assert.equal(cards.length, p.manifest.graph.nodes.length);
  const ys = cards.map((c) => /,\s*([-\d.]+)px\)/.exec(c.style.transform)[1]);
  assert.equal(ys.filter((y) => y === String(FLOW_PAD_Y)).length, 4, 'four cards on the first row (702px default width)');
  assert.equal(panel.querySelectorAll('.qtune tbody tr').length, p.order.length);
  const first = panel.querySelector('.qtune tbody tr');
  assert.equal(first.dataset.nodeId, p.order[0]);
  assert.equal(first.querySelector('select[aria-label^="Model"]').value, 'claude-sonnet-5');
  assert.deepEqual([...panel.querySelectorAll('.qpanel-foot button')].map((b) => b.textContent.trim()), ['Cancel run', 'Revise', 'Send', 'Accept & run']);
  assert.equal(panel.querySelector('.wf-send').hidden, true);
  assert.match(panel.querySelector('.ask-wfcard-meta').textContent, /^classifier ≈ \$0\.02 · /);
  const table = panel.querySelector('.qtune'); const meta = panel.querySelector('.ask-wfcard-meta');
  assert.ok(table.compareDocumentPosition(meta) & ctx.window.Node.DOCUMENT_POSITION_FOLLOWING, 'the table sits above the meta line');
  // jsdom has no ResizeObserver and clientWidth is 0, so drive the relayout the observer would.
  panel.__wf.handle.relayout(310);
  assert.equal(panel.__wf.handle.graph.flowLayout().perRow, 1, 'one card per row in a 310px host');
  assert.ok([...panel.querySelectorAll('.ask-wfcard-graph .node')].every((c) => /^translate\(20px, /.test(c.style.transform)), 'every card at the left pad');
  assert.equal(panel.querySelector('.ask-wfcard-graph').style.height, `${panel.__wf.handle.graph.flowLayout().height}px`, 'the host grew with the rows');
});

test('Accept posts the §5.4 payload with only the changed tunables and the edited name', async () => {
  const ctx = await boot(); helloRunning(ctx, { stepper: DECIDING }); ctx.showRunning();
  const p = ask(ctx); const panel = panelOf(ctx);
  const row = panel.querySelector(`.qtune tr[data-node-id="${p.order[1]}"]`);
  // the model `change` re-fills the effort select from the fixture's MODELS (opus: medium/high/max)
  // BEFORE `.value = 'max'` — jsdom silently drops a value the select does not offer
  const model = row.querySelector('select[aria-label^="Model"]'); model.value = 'claude-opus-5'; model.dispatchEvent(new ctx.window.Event('change'));
  const effort = row.querySelector('select[aria-label^="Effort"]');
  assert.equal(effort.value, 'high', 'the mockup rule: the planner had no effort, so the new model\'s SECOND effort is picked');
  assert.deepEqual([...effort.options].map((o) => o.value), ['medium', 'high', 'max'], 'only the model\'s own efforts — no choosable "default" (the sanitiser would drop it)');
  effort.value = 'max'; effort.dispatchEvent(new ctx.window.Event('change'));
  assert.deepEqual([...panel.querySelectorAll(`.ask-wfcard-graph [data-node-id="${p.order[1]}"] .nband .bchip`)].map((c) => c.textContent).slice(0, 2), ['Opus 5', 'max'], 'the band mirrors the table');
  panel.querySelector('.ask-wfcard-edit').click();
  const field = panel.querySelector('.ask-wfcard-field'); field.value = 'Theme switch'; field.dispatchEvent(new ctx.window.KeyboardEvent('keydown', { key: 'Enter' }));
  panel.querySelector('.wf-accept').click(); await settle(ctx.window);
  assert.deepEqual(ctx.answers.at(-1), { runId: RUN_ID, id: 'auto-1', payload: { decision: 'accept', name: 'Theme switch', nodes: { [p.order[1]]: { model: 'claude-opus-5', effort: 'max' } } } });
  assert.equal(panel.querySelector('.wf-accept').disabled, true, 'busy while the answer is in flight');
  assert.equal(panel.querySelector('select').disabled, true, 'selects are disabled too (A25)');
});

test('B1: a model change posts its effort even when that effort equals the base\'s (the resolver would otherwise drop it)', async () => {
  const ctx = await boot(); helloRunning(ctx, { stepper: DECIDING }); ctx.showRunning();
  const p = ask(ctx); const panel = panelOf(ctx);
  // the fixture's FIRST node (clarify) carries model claude-sonnet-5 + effort medium; opus offers medium too, so
  // the "keep the current effort" rule leaves effort at the BASE value — and the old diff dropped it.
  const row = panel.querySelector(`.qtune tr[data-node-id="${p.order[0]}"]`);
  assert.deepEqual([p.nodes[p.order[0]].model, p.nodes[p.order[0]].effort], ['claude-sonnet-5', 'medium'], 'fixture precondition');
  const model = row.querySelector('select[aria-label^="Model"]'); model.value = 'claude-opus-5'; model.dispatchEvent(new ctx.window.Event('change'));
  assert.equal(row.querySelector('select[aria-label^="Effort"]').value, 'medium', 'effort kept');
  panel.querySelector('.wf-accept').click(); await settle(ctx.window);
  assert.deepEqual(ctx.answers.at(-1).payload.nodes, { [p.order[0]]: { model: 'claude-opus-5', effort: 'medium' } }, 'model AND effort travel together');
});

test('Revise reveals the box, refuses empty text, posts the text; the next round shows the note', async () => {
  const ctx = await boot(); helloRunning(ctx, { stepper: DECIDING }); ctx.showRunning();
  ask(ctx); const panel = panelOf(ctx);
  panel.querySelector('.wf-revise').click();
  const ta = panel.querySelector('.qfree-area'); assert.equal(ta.hidden, false); assert.equal(panel.querySelector('.wf-send').hidden, false);
  panel.querySelector('.wf-send').click(); await settle(ctx.window);
  assert.equal(ctx.answers.length, 0, 'empty text never posts'); assert.ok(ta.classList.contains('qfree-err'));
  ta.value = 'drop the manual web check'; ta.dispatchEvent(new ctx.window.Event('input')); panel.querySelector('.wf-send').click(); await settle(ctx.window);
  assert.deepEqual(ctx.answers.at(-1).payload, { decision: 'revise', text: 'drop the manual web check' });
  ctx.dispatch({ type: 'question-resolved', runId: RUN_ID, id: 'auto-1' });
  ask(ctx, proposalFor(WEB_TASK, { round: 2 }));
  const p2 = panelOf(ctx);
  assert.equal(p2.querySelector('.qpanel-head b').textContent, 'Auto proposes a workflow · round 2');
  assert.match(p2.querySelector('.qnote').textContent, /Round 1 revised: “drop the manual web check”/);
  assert.equal(p2.querySelector('.wf-accept').disabled, false, 'a new round re-arms the panel');
});

// The echo is a claim about what the SERVER was told (A23). A transport/HTTP failure
// re-enables the panel and logs — it must not leave the next round quoting text the
// classifier never saw.
test('a revise that fails to POST leaves the panel usable and records no echo', async () => {
  const ctx = await boot({ answerOk: false }); helloRunning(ctx, { stepper: DECIDING }); ctx.showRunning();
  ask(ctx); const panel = panelOf(ctx);
  panel.querySelector('.wf-revise').click();
  const ta = panel.querySelector('.qfree-area');
  ta.value = 'never arrives'; ta.dispatchEvent(new ctx.window.Event('input'));
  panel.querySelector('.wf-send').click(); await settle(ctx.window);
  assert.deepEqual(ctx.answers.at(-1).payload, { decision: 'revise', text: 'never arrives' }, 'it was attempted');
  assert.equal(panel.querySelector('.wf-accept').disabled, false, 'the panel is handed back on a non-200');
  assert.equal(panel.querySelector('select').disabled, false, 'the tunables are usable again');
  ctx.dispatch({ type: 'question-resolved', runId: RUN_ID, id: 'auto-1' });
  ask(ctx, proposalFor(WEB_TASK, { round: 2 }));
  assert.equal(panelOf(ctx).querySelector('.qnote'), null, 'no round-1 echo for text the server never received');
});

test('Cancel run asks first, then posts cancel; a kept run posts nothing; resolving the question disposes the graph', async () => {
  const ctx = await boot(); helloRunning(ctx, { stepper: DECIDING }); ctx.showRunning();
  ask(ctx); const panel = panelOf(ctx);
  panel.querySelector('.wf-cancel').click(); await settle(ctx.window);
  assert.equal(ctx.window.document.getElementById('confirm-modal').classList.contains('hidden'), false, 'the confirm opened (cancelDialog asserts nothing itself)');
  assert.equal(dialogText(ctx.window).title, 'Cancel this run?'); assert.equal(dialogText(ctx.window).confirmLabel, 'Cancel run');
  await cancelDialog(ctx.window);
  assert.equal(ctx.answers.length, 0);
  panel.querySelector('.wf-cancel').click(); const msg = await confirmDialog(ctx.window);
  assert.match(msg, /Nothing is saved/); await settle(ctx.window);
  assert.deepEqual(ctx.answers.at(-1).payload, { decision: 'cancel' });
  ctx.dispatch({ type: 'question-resolved', runId: RUN_ID, id: 'auto-1' });
  assert.equal(panel.querySelector('.gv-stage'), null, 'the mount is gone with the panel');
  assert.ok(panel.classList.contains('hidden'));
  assert.equal(panel.classList.contains('qpanel-workflow'), false, 'clearQpanel drops the arm class — else the delegates would swallow a later clarify Submit in this card (A34)');
  assert.equal(panel.__wf, null);
});

test('the Running detail paints its own panel for the same question (two mounts, two states)', async () => {
  const ctx = await boot(); helloRunning(ctx, { stepper: DECIDING }); ctx.showRunning();
  ask(ctx);
  ctx.window.location.hash = `running/${RUN_ID}`; ctx.window.dispatchEvent(new ctx.window.Event('hashchange')); await settle(ctx.window);
  const detail = ctx.window.document.querySelector('#run-detail .rd-questions .qpanel');
  assert.ok(detail && !detail.classList.contains('hidden'));
  assert.ok(detail.querySelector('.ask-wfcard-graph .gv-stage'));
  assert.notEqual(detail, panelOf(ctx));
});

test('B5: the cost line is max(Σ auto-classify rows, proposal.costUsd) — rows that undercount after a resume never hide the spend', async () => {
  const ctx = await boot(); helloRunning(ctx, { stepper: DECIDING }); ctx.showRunning();
  // resume() rehydrates no sub-agent rows: a resumed run's state carries only the rounds spawned since (here round 2's $0.01),
  // while the proposal's own costUsd (restored from the resume point) is the whole spend ($0.02).
  ctx.dispatch({ type: 'state', runId: RUN_ID, status: 'running', steps: [], stepper: DECIDING, subAgents: [{ id: 'auto-classify-2', label: 'Auto workflow (round 2)', subagentType: 'auto-classify', status: 'finished', nodeId: 'preflight', uiPhase: 'preflight', stepKey: 'x:preflight:1', costUsd: 0.01 }] });
  ask(ctx, proposalFor(WEB_TASK, { round: 2 }));
  assert.match(panelOf(ctx).querySelector('.ask-wfcard-meta').textContent, /^classifier ≈ \$0\.02 · /);
});
