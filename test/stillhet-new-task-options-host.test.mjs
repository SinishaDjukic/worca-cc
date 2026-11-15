// test/stillhet-new-task-options-host.test.mjs — COV-2 (docs/rail/forms.md form.run-options): New task's saved run defaults,
// a workflow's defaults, the engine and sync refusals and the team policy notes, on dev's routes and in classic's words.
// Live app host (jsdom), the real shell, a stubbed fetch.
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { liveHost, go, settle, closeHosts, posts, LISTS } from './helpers/stillhet-chat-live-host.mjs';

afterEach(closeHosts);
const DEFAULTS = '/api/run-defaults?projectDir=%2Fsrc%2Fweb', CONFIG = '/api/config?projectDir=%2Fsrc%2Fweb', POLICY = '/api/policy/notes?scope=project%3Aweb-1';
const FLOWS = { ...LISTS, '/api/workflows': { workflows: [{ id: 'wf_shape', name: 'Shaper' }, { id: 'wf_lean', name: 'Lean', nodes: [{ id: 'plan', kind: 'agent' }, { id: 'build', kind: 'agent' }] }] } };
const DIVERGED = { error: 'main has diverged from origin/main (2 ahead, 3 behind)', code: 'sync-diverged', kind: 'diverged', options: ['origin', 'cancel'], members: [{ projectKey: 'web-1', projectName: 'web', base: 'main', remote: 'origin', ahead: 2, behind: 3 }] };
const ENGINE = { error: 'OpenAI Codex cannot enforce the guardrails Strict', code: 'engine-refused', overridable: true };
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
  assert.equal(q(d, '[data-c-tagsave]').textContent, 'Could not save (HTTP 400)');
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
  const { d, calls } = await open({ write: (u, b, m) => (refuse && m === 'PATCH' ? [400, { error: 'workflow not found' }] : [200, {}]) });
  await pick(d, 'workflow', 'Lean'); await more(d);
  assert.equal(q(d, '[data-c-flowsave]'), null, 'no model picked: nothing to save');
  await pick(d, 'agents', 'Opus 5.5 for every step');
  q(d, '[data-c-flowsave]').click(); await settle(40);
  const sent = posts(calls).filter(([, u]) => /workflows\/wf_lean|config\/workflow/.test(u));
  assert.deepEqual(sent, [['PATCH', '/api/workflows/wf_lean/defaults', { defaults: { plan: { model: 'opus' }, build: { model: 'opus' } } }], ['DELETE', '/api/config/workflow?projectDir=%2Fsrc%2Fweb&workflowId=wf_lean', undefined]]);
  assert.equal(q(d, '[data-c-flowsave]').textContent, 'Saved');
  refuse = true; await settle(2100);
  q(d, '[data-c-flowsave]').click(); await settle(40);
  assert.equal(q(d, '[data-c-flowsave]').textContent, 'Could not save the workflow\'s defaults: workflow not found');
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

test('COV-2 engine: the refusal shows its note and Allow unguarded; ticked, the next Start sends allowUnguardedEngine', async () => {
  let n = 0;
  const { w, d, calls } = await open({ write: (u) => (u === '/api/run' ? (++n === 1 ? [409, ENGINE] : [200, { runId: 'r-new' }]) : [200, {}]) });
  await pick(d, 'agent', 'OpenAI Codex');
  type(w, d, '#cc-text', 'Add a pager'); await start(d);
  assert.match(note(d).textContent, /OpenAI Codex cannot enforce the guardrails Strict/);
  assert.match(note(d).textContent, /Tick Allow unguarded to run anyway, or pick Claude\./);
  const box = q(d, 'input[data-c-allow]');
  assert.match(box.closest('label').textContent, /Allow unguarded: run without the rules this engine cannot enforce/);
  assert.equal(q(d, '[id$="-note"]'), null, 'the refusal is only in the note');
  box.click(); await settle(20);
  await start(d);
  const [a, b] = runs(calls);
  assert.equal(a.allowUnguardedEngine, undefined);
  assert.deepEqual(b, { ...a, allowUnguardedEngine: true });
});

test('COV-2 engine: a changed Agent clears the note and the consent', async () => {
  const { w, d, calls } = await open({ write: (u) => (u === '/api/run' ? [409, ENGINE] : [200, {}]) });
  await pick(d, 'agent', 'OpenAI Codex');
  type(w, d, '#cc-text', 'Add a pager'); await start(d);
  q(d, 'input[data-c-allow]').click(); await settle(20);
  await pick(d, 'agent', 'Gemini CLI');
  assert.equal(note(d), null);
  await start(d);
  assert.equal(runs(calls).at(-1).allowUnguardedEngine, undefined, 'the consent was for the engine refused');
});

test('COV-2 sync: a diverged base shows classic\'s words; Start from origin/main resends the same body plus syncPolicy', async () => {
  let n = 0;
  const { w, d, calls } = await open({ write: (u) => (u === '/api/run' ? (++n === 1 ? [409, DIVERGED] : [200, { runId: 'r-new' }]) : [200, {}]) });
  type(w, d, '#cc-text', 'Add a pager'); await start(d);
  assert.match(note(d).textContent, /main has diverged from origin\/main/);
  assert.match(note(d).textContent, /\(2 ahead, 3 behind\)/);
  const ways = [...note(d).querySelectorAll('button')].map((b) => b.textContent);
  assert.deepEqual(ways, ['Cancel', 'Start from origin/main']);
  q(d, '[data-c-sync="origin"]').click(); await settle(80);
  const [a, b] = runs(calls);
  assert.deepEqual(b, { ...a, syncPolicy: 'origin' });
  assert.equal(d.querySelector('#center-dlg .dlg'), null, 'started: the form closed');
});

test('COV-2 sync: an edit after the refusal goes with the resend, never the text from before it', async () => {
  let n = 0;
  const { w, d, calls } = await open({ write: (u) => (u === '/api/run' ? (++n === 1 ? [409, DIVERGED] : [200, { runId: 'r-new' }]) : [200, {}]) });
  type(w, d, '#cc-text', 'Add a pager'); await start(d);
  type(w, d, '#cc-text', 'Add a pager and a footer');
  q(d, '[data-c-sync="origin"]').click(); await settle(80);
  const [a, b] = runs(calls);
  assert.deepEqual(b, { ...a, prompt: 'Add a pager and a footer', syncPolicy: 'origin' });
});

test('COV-2 sync: a failed fetch offers Start anyway with last-fetch; a forbidden one offers Cancel only', async () => {
  const fetchFailed = { error: 'Could not reach origin (network)', code: 'sync-fetch-failed', kind: 'fetch-failed', fetchKind: 'network', options: ['last-fetch', 'cancel'], members: [{ base: 'main', remote: 'origin', fetchKind: 'network' }] };
  let n = 0;
  const { w, d, calls } = await open({ write: (u) => (u === '/api/run' ? (++n === 1 ? [409, fetchFailed] : n === 2 ? [200, { runId: 'r-new' }] : [409, { ...DIVERGED, options: ['cancel'], forbidden: true }]) : [200, {}]) });
  type(w, d, '#cc-text', 'Add a pager'); await start(d);
  assert.match(note(d).textContent, /Could not reach origin/);
  assert.match(note(d).textContent, /origin could not be reached\. Worca will start from the last fetch instead\./);
  q(d, '[data-c-sync="last-fetch"]').click(); await settle(80);
  assert.equal(runs(calls)[1].syncPolicy, 'last-fetch');
  w.RailCenters.maker('tasks').newPick('form'); await settle(80);
  type(w, d, '#cc-text', 'Again'); await start(d);
  assert.match(note(d).textContent, /This project's sync setting does not allow starting from the remote\./);
  assert.deepEqual([...note(d).querySelectorAll('button')].map((b) => b.textContent), ['Cancel']);
});

test('COV-2 sync: Cancel clears the note, says Start cancelled and starts nothing', async () => {
  const { w, d, calls } = await open({ write: (u) => (u === '/api/run' ? [409, DIVERGED] : [200, {}]) });
  type(w, d, '#cc-text', 'Add a pager'); await start(d);
  q(d, '[data-c-sync="cancel"]').click(); await settle(30);
  assert.equal(note(d), null);
  assert.match([...d.querySelectorAll('body > .rc-toast')].map((e) => e.textContent).join(' '), /Start cancelled/);
  assert.equal(runs(calls).length, 1);
  assert.equal(q(d, '#cc-text').value, 'Add a pager', 'what was typed stays');
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
