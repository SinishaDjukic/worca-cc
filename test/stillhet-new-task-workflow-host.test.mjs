// test/stillhet-new-task-workflow-host.test.mjs — gate.real-data F-cov23-03 (docs/stillhet/forms.md form.run-options): New task's
// Workflow picker offers Auto as classic's New run does (app.js AUTO_WORKFLOW: a client-side constant /api/workflows never
// lists); a project whose activeWorkflowId is wf_auto preselects it and Start posts workflowId wf_auto with classic's
// humanInLoop. Live app host (jsdom), the real shell, a stubbed fetch.
import { test, afterEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { liveHost, go, settle, closeHosts, posts, LISTS } from './helpers/stillhet-chat-live-host.mjs';
import { demoTaskHost } from './helpers/stillhet-host.mjs';

afterEach(closeHosts);
const CONFIG = '/api/config?projectDir=%2Fsrc%2Fweb';
async function open({ reads = {}, write = () => [200, { runId: 'r-new' }] } = {}) {
  const h = await liveHost({ lists: LISTS, write, read: (u) => reads[u] || null });
  await go(h.w, '#runs', 200);
  h.w.StillhetCenters.newTask(); await settle(80);
  return h;
}
const q = (d, sel) => d.querySelector(`#center-dlg ${sel}`);
const shown = (d, id) => q(d, `[data-menu="f-${id}"]`).textContent.trim();
const items = async (d, id) => { q(d, `[data-menu="f-${id}"]`).click(); await settle(10); const got = [...d.querySelectorAll(`#center-dlg [data-menu-pick^="f-${id}|"]`)].map((x) => x.textContent.trim()); q(d, `[data-menu="f-${id}"]`).click(); await settle(10); return got; };
const pick = async (d, id, v) => { q(d, `[data-menu="f-${id}"]`).click(); await settle(10); q(d, `[data-menu-pick="f-${id}|${v}"]`).click(); await settle(40); };
const type = (w, d, sel, v) => { const t = q(d, sel); t.value = v; t.dispatchEvent(new w.Event('input', { bubbles: true })); };
const start = async (d) => { q(d, '[data-dialog="yes"]').click(); await settle(80); };
const runs = (calls) => posts(calls).filter(([, u]) => u === '/api/run').map(([, , b]) => b);

test('F-cov23-03: Auto leads the Workflow menu, as classic lists it', async () => {
  const { d } = await open();
  assert.equal((await items(d, 'workflow'))[0], 'Auto');
});

test('F-cov23-03: a project whose activeWorkflowId is wf_auto preselects Auto; Start posts wf_auto and the project\'s humanInLoop', async () => {
  const { w, d, calls } = await open({ reads: { [CONFIG]: [200, { config: { activeWorkflowId: 'wf_auto' } }] } });
  assert.equal(shown(d, 'workflow'), 'Auto');
  type(w, d, '#cc-text', 'Add a pager'); await start(d);
  const [b] = runs(calls);
  assert.equal(b.workflowId, 'wf_auto');
  assert.equal(b.humanInLoop, true, 'classic sends Auto\'s switch: on unless the project turned it off');
});

test('F-cov23-03: picking Auto saves it as the project\'s workflow; a project with humanInLoop off sends false', async () => {
  const { w, d, calls } = await open({ reads: { [CONFIG]: [200, { config: { activeWorkflowId: 'wf_lean', humanInLoop: false } }] } });
  assert.equal(shown(d, 'workflow'), 'Lean');
  await pick(d, 'workflow', 'Auto');
  assert.deepEqual(posts(calls).filter(([, u]) => u === '/api/config').at(-1), ['PATCH', '/api/config', { projectDir: '/src/web', activeWorkflowId: 'wf_auto' }]);
  type(w, d, '#cc-text', 'Add a pager'); await start(d);
  const [b] = runs(calls);
  assert.equal(b.workflowId, 'wf_auto'); assert.equal(b.humanInLoop, false);
});

test('F-cov23-03: any other workflow sends no humanInLoop (the body stays as before)', async () => {
  const { w, d, calls } = await open({ reads: { [CONFIG]: [200, { config: { activeWorkflowId: 'wf_lean' } }] } });
  type(w, d, '#cc-text', 'Add a pager'); await start(d);
  const [b] = runs(calls);
  assert.equal(b.workflowId, 'wf_lean'); assert.equal(b.humanInLoop, undefined);
});

// ---- COV-2: the engine check, the source, Workflow, Reset and Save as default, drawn in the demo kind ----
const demo = async () => { const w = demoTaskHost({ after }); await settle(60); w.StillhetCenters.newTask(); await settle(60); return { w, d: w.document }; };

test('COV-2 Engine check (demo): Copilot\'s Agent item is aria-disabled with title Copilot: off while the credential broker is on, and a click on it leaves the Agent picker\'s text reading Claude', async () => {
  const { d } = await demo();
  q(d, '[data-menu="f-agent"]').click(); await settle(10);
  const item = q(d, '[data-menu-pick="f-agent|Copilot"]');
  assert.equal(item.getAttribute('aria-disabled'), 'true');
  assert.equal(item.getAttribute('title'), 'Copilot: off while the credential broker is on');
  item.click(); await settle(20);
  assert.equal(shown(d, 'agent'), 'Claude');
});

test('COV-2 Engine check (demo): a preset pinning Copilot leaves Agent on Claude and says Copilot is off: starts on Claude', async () => {
  const { d } = await demo();
  await pick(d, 'preset', 'p:rp_copilot');
  assert.equal(shown(d, 'preset'), 'Copilot review');
  assert.equal(shown(d, 'agent'), 'Claude');
  assert.match((q(d, '[data-menu="f-agent"]').closest('.fld-pair') || q(d, '[data-menu="f-agent"]').closest('.fld')).textContent, /Copilot is off: starts on Claude/, 'said under the Engine field');
});

test('COV-2 Origin · latest / Workflow / Reset / Save as default (demo): the source picker lists the latest version from origin and my local copy; Workflow lists Auto; Reset and Save as default each repaint with their said word', async () => {
  const { w, d } = await demo();
  q(d, '[data-c-more]').click(); await settle(20);   // Start from and Cost tags are More options' fields
  assert.deepEqual(await items(d, 'source'), ['The latest version from origin', 'My local copy']);
  assert.equal((await items(d, 'workflow'))[0], 'Auto');
  await pick(d, 'workflow', 'Quick Fix');
  q(d, '[data-c-flowreset]').click(); await settle(20);
  assert.equal(q(d, '[data-c-flowreset]').textContent, 'Reset');
  type(w, d, '#cc-tags', 'docs');
  q(d, '[data-c-tagsave]').click(); await settle(20);
  assert.equal(q(d, '[data-c-tagsave]').textContent, 'Saved');
});
