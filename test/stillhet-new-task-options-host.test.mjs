// test/stillhet-new-task-options-host.test.mjs — COV-2 (docs/rail/forms.md form.run-options): New task's saved run defaults,
// a workflow's defaults and the team policy notes, on dev's routes and in classic's words. The engine and sync refusals:
// stillhet-new-task-refusals-host.test.mjs.
// Live app host (jsdom), the real shell, a stubbed fetch.
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { liveHost, go, settle, closeHosts, posts, LISTS } from './helpers/stillhet-chat-live-host.mjs';

afterEach(closeHosts);
const DEFAULTS = '/api/run-defaults?projectDir=%2Fsrc%2Fweb', CONFIG = '/api/config?projectDir=%2Fsrc%2Fweb', POLICY = '/api/policy/notes?scope=project%3Aweb-1';
const FLOWS = { ...LISTS, '/api/workflows': { workflows: [{ id: 'wf_shape', name: 'Shaper' }, { id: 'wf_lean', name: 'Lean', nodes: [{ id: 'plan', kind: 'agent' }, { id: 'build', kind: 'agent' }] }] } };
async function open({ reads = {}, write = () => [200, { runId: 'r-new' }], hold, lists = FLOWS } = {}) {
  const h = await liveHost({ lists, write, hold, read: (u) => reads[u] || null });
  await go(h.w, '#runs', 120);
  h.w.RailCenters.maker('tasks').newPick('form'); await settle(80);
  return h;
}
const q = (d, sel) => d.querySelector(`#center-dlg ${sel}`);
const shown = (d, id) => q(d, `[data-menu="f-${id}"]`).textContent.trim();
const pick = async (d, id, v) => { q(d, `[data-menu="f-${id}"]`).click(); await settle(10); q(d, `[data-menu-pick="f-${id}|${v}"]`).click(); await settle(40); };
const type = (w, d, sel, v) => { const t = q(d, sel); t.value = v; t.dispatchEvent(new w.Event('input', { bubbles: true })); };
const start = async (d) => { q(d, '[data-dialog="yes"]').click(); await settle(80); };
const runs = (calls) => posts(calls).filter(([, u]) => u === '/api/run').map(([, , b]) => b);
const note = (d) => q(d, '.choice-note');
const more = async (d) => { q(d, '[data-c-more]').click(); await settle(20); };

test('COV-2 defaults: engine and tags fill an untouched form, and Start sends them', async () => {
  const { w, d, calls } = await open({ reads: { [DEFAULTS]: [200, { engine: { value: 'codex', source: 'project' }, tags: ['client', 'web'], projectKey: 'web-1' }] } });
  assert.equal(shown(d, 'agent'), 'OpenAI Codex');
  await more(d);
  assert.equal(q(d, '#cc-tags').value, 'client, web');
  type(w, d, '#cc-text', 'Add a pager'); await start(d);
  const [b] = runs(calls);
  assert.equal(b.engine, 'codex'); assert.deepEqual(b.tags, ['client', 'web']);
});

test('COV-2 defaults: a read landing after a pick changes nothing the person touched', async () => {
  let release; const held = new Promise((r) => { release = r; });
  const { w, d } = await open({ reads: { [DEFAULTS]: [200, { engine: { value: 'codex' }, tags: ['client'], projectKey: 'web-1' }] }, hold: (u) => (u === DEFAULTS ? held : null) });
  await pick(d, 'agent', 'Claude Code');
  await more(d); type(w, d, '#cc-tags', 'mine');
  release(); await settle(60);
  assert.equal(shown(d, 'agent'), 'Claude Code', 'the touched Agent stays');
  assert.equal(q(d, '#cc-tags').value, 'mine', 'typed tags stay');
});

test('COV-2 defaults: Save as default sends the tags and reads Saved; a refusal names dev\'s reason and saves nothing', async () => {
  let answer = [200, { tags: ['client'] }];
  const { w, d, calls } = await open({ reads: { [DEFAULTS]: [200, { engine: { value: 'claude' }, tags: [], projectKey: 'web-1' }] }, write: (u) => (u.endsWith('/tags/defaults') ? answer : [200, {}]) });
  await more(d); type(w, d, '#cc-tags', 'client');
  q(d, '[data-c-tagsave]').click(); await settle(40);
  assert.deepEqual(posts(calls).at(-1), ['PUT', '/api/projects/web-1/tags/defaults', { tags: ['client'] }]);
  assert.equal(q(d, '[data-c-tagsave]').textContent, 'Saved');
  answer = [400, {}];
  q(d, '[data-c-tagsave]').click(); await settle(40);
  assert.equal(q(d, '[data-c-tagsave]').textContent, 'Save as default', 'F-cov23-06: the label stays the action');
  assert.equal(q(d, '#cc-tags-note[role="alert"]').textContent, 'Could not save (HTTP 400)', 'F-cov23-06: the refusal is the Cost tags field\'s error line');
  assert.equal(q(d, '#cc-tags').value, 'client', 'the form is as it was');
});

test('COV-2 workflow: the project\'s activeWorkflowId is preselected; a pick sends PATCH /api/config', async () => {
  const { d, calls } = await open({ reads: { [CONFIG]: [200, { config: { activeWorkflowId: 'wf_lean' } }] } });
  assert.equal(shown(d, 'workflow'), 'Lean');
  await pick(d, 'workflow', 'Shaper');
  assert.deepEqual(posts(calls).filter(([, u]) => u === '/api/config'), [['PATCH', '/api/config', { projectDir: '/src/web', activeWorkflowId: 'wf_shape' }]]);
});

test('COV-2 workflow: Save as the workflow\'s defaults sends the PATCH, then the DELETE; a refusal names its step', async () => {
  let refuse = false;
  const reads = { [CONFIG]: [200, { config: {} }], '/api/agents': [200, { agents: [] }], '/api/workflows/wf_lean': [200, { nodes: [{ id: 'plan', kind: 'agent', config: { subagentModel: 'haiku' } }, { id: 'build', kind: 'agent' }] }] };
  const { d, calls } = await open({ reads, write: (u, b, m) => (refuse && m === 'PATCH' ? [400, { error: 'workflow not found' }] : [200, {}]) });
  await pick(d, 'workflow', 'Lean'); await more(d);
  assert.equal(q(d, '[data-c-flowsave]'), null, 'no model picked: nothing to save');
  await pick(d, 'agents', 'Opus 5.5 for every step');
  q(d, '[data-c-flowsave]').click(); await settle(40);
  const sent = posts(calls).filter(([, u]) => /workflows\/wf_lean|config\/workflow/.test(u));
  assert.deepEqual(sent, [['PATCH', '/api/workflows/wf_lean/defaults', { defaults: { plan: { model: 'opus', fanOut: false, subagentModel: 'haiku' }, build: { model: 'opus', fanOut: false } } }], ['DELETE', '/api/config/workflow?projectDir=%2Fsrc%2Fweb&workflowId=wf_lean', undefined]]);
  assert.equal(q(d, '[data-c-flowsave]').textContent, 'Saved');
  refuse = true; await settle(2100);
  q(d, '[data-c-flowsave]').click(); await settle(40);
  assert.equal(q(d, '[data-c-flowsave]').textContent, 'Save as the workflow\'s defaults', 'COV-2 m-flowerr: the label stays the action');
  assert.equal(q(d, '#cc-text-note[role="alert"]').textContent, 'Could not save the workflow\'s defaults: workflow not found', 'the refusal is the form\'s error line');
  q(d, '[data-c-flowreset]').click(); await settle(40);
  assert.deepEqual(posts(calls).at(-1), ['DELETE', '/api/config/workflow?projectDir=%2Fsrc%2Fweb&workflowId=wf_lean', undefined]);
});

test('COV-2 workflow: a pick under an applied preset is not saved as the project\'s workflow', async () => {
  const { d, calls } = await open({ reads: { '/api/presets': [200, { presets: [{ id: 'rp_1', name: 'Bug fix', scope: { kind: 'global', ref: null }, setup: { workflowId: 'wf_lean' } }] }] } });
  await pick(d, 'preset', 'p:rp_1');
  assert.equal(shown(d, 'workflow'), 'Lean');
  await pick(d, 'workflow', 'Shaper');
  assert.ok(!posts(calls).some(([, u]) => u === '/api/config'), JSON.stringify(posts(calls)));
});

test('COV-2 policy: the team policy notes line in classic\'s words, amber when a note warns', async () => {
  const { d, calls } = await open({ reads: { [DEFAULTS]: [200, { engine: { value: 'claude' }, tags: [], projectKey: 'web-1' }], [POLICY]: [200, { policy: { home: 'acme/policy', caps: { pipeline: { kind: 'hard', value: 20 } } }, notes: [{ code: 'g', level: 'warn', text: 'Guardrails Normal rank below the team minimum (Strict).' }] }] } });
  assert.ok(calls.some((c) => c.url === POLICY), JSON.stringify(calls.map((c) => c.url).filter((u) => u.includes('policy'))));
  const n = note(d);
  assert.match(n.className, /is-amber/);
  assert.match(n.textContent, /team policy · acme\/policy · 1 note · nothing here blocks the task/);
  assert.match(n.textContent, /Guardrails Normal rank below the team minimum \(Strict\)\./);
  assert.match(n.textContent, /pipeline cap \$20 \(hard\)/);
});

test('COV-2 policy: the old project\'s policy answer landing after a pick of No project paints nothing', async () => {
  let release; const held = new Promise((r) => { release = r; });
  const { d } = await open({ reads: { [DEFAULTS]: [200, { engine: { value: 'claude' }, tags: [], projectKey: 'web-1' }], [POLICY]: [200, { policy: { home: 'acme/policy', caps: {} }, notes: [{ level: 'warn', text: 'Required plugin jira is not installed.' }] }] }, hold: (u) => (u === POLICY ? held : null) });
  await pick(d, 'project', 'No project');
  release(); await settle(60);
  assert.equal(note(d), null);
});

test('COV-2 policy: policy:null draws nothing, and the start body is today\'s', async () => {
  const { w, d, calls } = await open({ reads: { [DEFAULTS]: [200, { engine: { value: 'claude' }, tags: [], projectKey: 'web-1' }], [POLICY]: [200, { scope: {}, policy: null, notes: [] }] } });
  assert.equal(note(d), null);
  type(w, d, '#cc-text', 'Add a pager'); await start(d);
  assert.deepEqual(runs(calls)[0], { projectDir: '/src/web', prompt: 'Add a pager' }, 'a Claude default is not sent as a pick');
});

test('COV-2 one start at a time: a second press while the first is out sends nothing', async () => {
  let release; const held = new Promise((r) => { release = r; });
  const { w, d, calls } = await open({ write: async (u) => { if (u === '/api/run') { await held; return [200, { runId: 'r-new' }]; } return [200, {}]; } });
  type(w, d, '#cc-text', 'Add a pager');
  q(d, '[data-dialog="yes"]').click(); await settle(20);
  q(d, '[data-dialog="yes"]')?.click(); await settle(20);
  release(); await settle(60);
  assert.equal(runs(calls).length, 1);
});
