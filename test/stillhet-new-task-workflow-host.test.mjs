// test/stillhet-new-task-workflow-host.test.mjs — gate.real-data F-cov23-03 (docs/rail/forms.md form.run-options): New task's
// Workflow picker offers Auto as classic's New run does (app.js AUTO_WORKFLOW: a client-side constant /api/workflows never
// lists); a project whose activeWorkflowId is wf_auto preselects it and Start posts workflowId wf_auto with classic's
// humanInLoop. Live app host (jsdom), the real shell, a stubbed fetch.
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { liveHost, go, settle, closeHosts, posts, LISTS } from './helpers/stillhet-chat-live-host.mjs';

afterEach(closeHosts);
const CONFIG = '/api/config?projectDir=%2Fsrc%2Fweb';
async function open({ reads = {}, write = () => [200, { runId: 'r-new' }] } = {}) {
  const h = await liveHost({ lists: LISTS, write, read: (u) => reads[u] || null });
  await go(h.w, '#runs', 120);
  h.w.RailCenters.maker('tasks').newPick('form'); await settle(80);
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
