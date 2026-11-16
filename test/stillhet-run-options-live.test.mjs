// test/stillhet-run-options-live.test.mjs — COV-2: run-options-live.mjs reads dev's refusals, words them as classic does,
// and sends each run option on dev's own route and body. In-process: the pure helpers and a stubbed fetch.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as O from '../ui/public/stillhet/live/run-options-live.mjs';

const answer = (status, data) => ({ ok: status < 300, status, json: async () => data });
function stub(reply = () => [200, {}]) {
  const calls = [];
  const fetch = async (url, o = {}) => { const body = o.body ? JSON.parse(o.body) : undefined; calls.push({ method: o.method || 'GET', url, body }); const [s, d] = reply(url, o.method || 'GET', body); return answer(s, d); };
  return { calls, live: O.startRunOptionsLive({ fetch }) };
}
const DIVERGED = { code: 'sync-diverged', kind: 'diverged', options: ['origin', 'cancel'], members: [{ projectKey: 'web-1', projectName: 'web', base: 'main', remote: 'origin', ahead: 2, behind: 3 }], error: 'main has diverged from origin/main (2 ahead, 3 behind)' };

test('COV-2 refusalOf: each 409 code (read off the runner\'s answer), and a refusal with no code', async () => {
  assert.equal(O.refusalOf({ ok: true, data: {} }), null);
  const runner = O.startRunOptionsLive({ fetch: async () => answer(409, { code: 'engine-refused', error: 'Codex cannot enforce strict', overridable: true }) });
  const eng = O.refusalOf(await runner.presets());
  assert.deepEqual(eng, { kind: 'engine', error: 'Codex cannot enforce strict', overridable: true });
  const sync = O.refusalOf({ ok: false, status: 409, error: DIVERGED.error, code: DIVERGED.code, data: DIVERGED });
  assert.equal(sync.kind, 'sync'); assert.equal(sync.sync, 'diverged'); assert.equal(sync.base, 'main'); assert.equal(sync.remote, 'origin'); assert.equal(sync.forbidden, false);
  assert.equal(O.refusalOf({ ok: false, code: 'sync-fetch-failed', data: { code: 'sync-fetch-failed', options: ['last-fetch', 'cancel'], fetchKind: 'auth', members: [] } }).sync, 'fetch-failed');
  assert.deepEqual(O.refusalOf({ ok: false, code: 'preset-broken', data: { code: 'preset-broken', error: 'Preset "Bug fix" cannot start: x', broken: [{ item: 'workflow', ref: 'wf_x', message: 'x', reset: true }] } }).broken.length, 1);
  assert.deepEqual(O.refusalOf({ ok: false, status: 400, error: 'prompt is required' }), { kind: 'other', error: 'prompt is required' });
});

test('COV-2 syncNoteOf: classic\'s words for diverged, forbidden and fetch-failed', () => {
  const d = O.syncNoteOf(O.refusalOf({ ok: false, code: DIVERGED.code, data: DIVERGED }));
  assert.equal(d.title, 'main has diverged from origin/main');
  assert.deepEqual(d.rows, ['main has diverged from origin/main (2 ahead, 3 behind).']);
  assert.deepEqual(d.primary, { label: 'Start from origin/main', policy: 'origin' });
  const f = O.syncNoteOf(O.refusalOf({ ok: false, code: DIVERGED.code, data: { ...DIVERGED, options: ['cancel'], forbidden: true } }));
  assert.equal(f.primary, null);
  assert.equal(f.note, 'This project\'s sync setting does not allow starting from the remote.');
  const x = O.syncNoteOf(O.refusalOf({ ok: false, code: 'sync-fetch-failed', data: { code: 'sync-fetch-failed', options: ['last-fetch', 'cancel'], fetchKind: 'network', members: [{ base: 'main', remote: 'origin', fetchKind: 'network' }] } }));
  assert.equal(x.title, 'Could not reach origin');
  assert.deepEqual(x.rows, ['origin could not be reached. Worca will start from the last fetch instead.']);
  assert.deepEqual(x.primary, { label: 'Start anyway', policy: 'last-fetch' });
});

test('COV-2 presetFormOf and presetModified: the picks it sets, what it carries, and when the form left it', () => {
  const p = { id: 'rp_1', scope: { kind: 'global', ref: null }, setup: { workflowId: 'wf_lean', engine: 'codex', syncBeforeStart: false, pr: { open: 'none' }, tags: ['client'], sameAsSource: true, guardrailsId: 'strict', mock: false, overlay: { nodes: { plan: { model: 'opus' } } }, humanInLoop: true } };
  const f = O.presetFormOf(p);
  assert.equal(f.workflowId, 'wf_lean'); assert.equal(f.engine, 'codex'); assert.equal(f.syncBeforeStart, false); assert.deepEqual(f.pr, { open: 'none' }); assert.deepEqual(f.tags, ['client']); assert.equal(f.sameAsSource, true);
  assert.deepEqual(f.carried, { guardrailsId: 'strict', mock: false, overlay: { nodes: { plan: { model: 'opus' } } }, humanInLoop: true });
  assert.equal(O.presetModified(f, { ...f }), false);
  assert.equal(O.presetModified(f, { ...f, engine: 'claude' }), true);
  assert.equal(O.presetModified(f, { ...f, tags: ['other'] }), true);
  assert.equal(O.presetFits(p, 'web-1'), true);
  assert.equal(O.presetFits({ scope: { kind: 'project', ref: 'api-2' } }, 'web-1'), false);
  assert.equal(O.presetFits({ scope: { kind: 'project', ref: 'web-1' } }, 'web-1'), true);
  assert.equal(O.presetFits({ scope: { kind: 'workspace', ref: 'w' } }, 'web-1'), false);
});

test('COV-2 brokenNoteOf and resetSetup: dev\'s message per item, Reset only where it may, and the dropped pick', () => {
  const n = O.brokenNoteOf([{ item: 'workflow', ref: 'wf_gone', message: 'Workflow wf_gone no longer exists', reset: true }, { item: 'project', ref: 'x', message: 'Project x is no longer registered in worca', reset: false }]);
  assert.equal(n.title, 'This preset needs attention');
  assert.deepEqual(n.rows.map((r) => [r.text, r.reset]), [['Workflow wf_gone no longer exists', true], ['Project x is no longer registered in worca', false]]);
  const s = { workflowId: 'wf_gone', guardrailsId: 'old', engine: 'codex', overlay: { nodes: { a: { model: 'm' } } } };
  assert.deepEqual(O.resetSetup(s, { item: 'workflow' }, { workflowId: 'wf_lean' }), { workflowId: 'wf_lean', guardrailsId: 'old', engine: 'codex' });
  assert.equal(O.resetSetup(s, { item: 'guardrails' }).guardrailsId, undefined);
  assert.equal(O.resetSetup(s, { item: 'engine' }).engine, 'claude');
  assert.deepEqual(O.resetSetup(s, { item: 'model', ref: 'a' }).overlay.nodes, {});
  assert.equal(s.guardrailsId, 'old', 'the setup given is never changed');
});

test('COV-2 policyNoteOf: nothing for no policy; classic\'s head, a row per note, amber when one warns, the caps line', () => {
  assert.equal(O.policyNoteOf({ policy: null, notes: [] }), null);
  const n = O.policyNoteOf({ policy: { home: 'acme/policy', caps: { pipeline: { kind: 'hard', value: 20 }, total: { kind: 'soft', value: 500 }, resetPeriod: 'weekly', pooled: null } }, notes: [{ code: 'g', level: 'warn', text: 'Guardrails Normal rank below the team minimum (Strict).' }] });
  assert.equal(n.tone, 'amber');
  assert.equal(n.head, 'team policy · acme/policy · 1 note · nothing here blocks the run');
  assert.deepEqual(n.rows, [{ text: 'Guardrails Normal rank below the team minimum (Strict).', warn: true }]);
  assert.equal(n.caps, 'pipeline cap $20 (hard) · total $500/week (soft)');
  const g = O.policyNoteOf({ policy: { home: 'acme/policy', caps: {} }, notes: [] });
  assert.equal(g.tone, 'grey'); assert.equal(g.head, 'team policy · acme/policy · nothing to note'); assert.equal(g.caps, '');
});

test('COV-2 sourceBodyOf and gateOf: the run\'s source, and classic\'s three gate texts', () => {
  assert.deepEqual(O.sourceBodyOf({ plugin: 'jira', sourceId: 'issues', taskId: 'J-1', inputs: { project: 'WEB' } }), { type: 'plugin', plugin: 'jira', sourceId: 'issues', taskId: 'J-1', inputs: { project: 'WEB' } });
  assert.equal(O.sourceBodyOf({ plugin: 'jira', sourceId: 'issues', taskId: 'J-1', profile: 'work' }).profile, 'work');
  const src = { plugin: 'jira', sourceId: 'issues', displayName: 'Jira', multiProfile: true, profiles: [{ id: 'work' }, { id: 'home' }] };
  assert.equal(O.gateOf({ profile: 'work', via: 'binding' }, src), null);
  assert.equal(O.gateOf({ profile: null, via: 'none' }, { ...src, multiProfile: false }), null, 'a single-profile source asks nothing');
  assert.deepEqual(O.gateOf({ profile: null, via: 'none' }, src, 'web'), { text: 'Which Jira profile does web pull from? Asked once, then remembered.', profiles: ['work', 'home'], conflict: false });
  assert.equal(O.gateOf({ profile: null, via: 'conflict', candidates: ['work', 'home'] }, src, 'web').text, 'The projects in web disagree about which Jira profile to use (work, home). Pick the one this run should read from.');
  assert.equal(O.gateOf({ profile: null, via: 'none' }, { ...src, profiles: [] }).text, 'Jira has no profiles configured yet.');
});

test('COV-2 defaultsOf: dev\'s engine only when it is a run engine; its tags and project key', () => {
  assert.deepEqual(O.defaultsOf({ engine: { value: 'codex', source: 'project' }, tags: ['client'], projectKey: 'web-1' }), { engine: 'codex', tags: ['client'], projectKey: 'web-1' });
  assert.equal(O.defaultsOf({ engine: { value: 'nope' } }).engine, '');
  assert.deepEqual(O.defaultsOf(null), { engine: '', tags: [], projectKey: '' });
});

test('COV-2 the factory: each read and write on dev\'s method, URL and body', async () => {
  const { calls, live } = stub((u) => (u === '/api/sources/call' ? [200, { ok: true, result: { tasks: [] } }] : [200, {}]));
  await live.defaults('/src/web');
  await live.config('/src/web');
  await live.setActiveWorkflow('/src/web', 'wf_lean');
  await live.resetWorkflow('/src/web', 'wf_lean');
  await live.saveTagDefaults('web-1', ['client']);
  await live.presets();
  await live.checkPreset('rp_1', '/src/web');
  await live.updatePreset('rp_1', { engine: 'codex' }, '/src/web');
  await live.duplicatePreset('rp_1');
  await live.sources();
  await live.binding('/src/web', 'jira', 'issues');
  await live.bind('/src/web', 'jira', 'issues', 'work');
  const got = await live.call('jira', 'issues', 'listTasks', { inputs: {}, search: 'pager' }, 'work');
  await live.policyNotes({ projectKey: 'web-1', guardrailsId: 'strict', models: ['opus'] });
  await live.policyNotes({ projectKey: 'web-1' });
  assert.deepEqual(calls.map((c) => [c.method, c.url, c.body]), [
    ['GET', '/api/run-defaults?projectDir=%2Fsrc%2Fweb', undefined],
    ['GET', '/api/config?projectDir=%2Fsrc%2Fweb', undefined],
    ['PATCH', '/api/config', { projectDir: '/src/web', activeWorkflowId: 'wf_lean' }],
    ['DELETE', '/api/config/workflow?projectDir=%2Fsrc%2Fweb&workflowId=wf_lean', undefined],
    ['PUT', '/api/projects/web-1/tags/defaults', { tags: ['client'] }],
    ['GET', '/api/presets', undefined],
    ['POST', '/api/presets/rp_1/check', { projectDir: '/src/web' }],
    ['PUT', '/api/presets/rp_1', { setup: { engine: 'codex' }, basis: { projectDir: '/src/web' } }],
    ['POST', '/api/presets/rp_1/duplicate', {}],
    ['GET', '/api/sources', undefined],
    ['GET', '/api/source-bindings?projectDir=%2Fsrc%2Fweb&plugin=jira&sourceId=issues', undefined],
    ['PUT', '/api/source-bindings', { projectDir: '/src/web', plugin: 'jira', sourceId: 'issues', profile: 'work' }],
    ['POST', '/api/sources/call', { plugin: 'jira', sourceId: 'issues', op: 'listTasks', args: { inputs: {}, search: 'pager' }, profile: 'work' }],
    ['GET', '/api/policy/notes?scope=project%3Aweb-1&guardrailsId=strict&models=opus', undefined],
    ['GET', '/api/policy/notes?scope=project%3Aweb-1', undefined],
  ]);
  assert.deepEqual(got, { ok: true, data: { tasks: [] } }, 'a call answers its result');
});

test('COV-2 a connector refusal in a 200 is a refusal, with its message', async () => {
  const { live } = stub(() => [200, { ok: false, error: { kind: 'auth', message: 'token expired' } }]);
  assert.deepEqual(await live.call('jira', 'issues', 'listTasks', {}), { ok: false, status: 200, error: 'token expired' });
});

test('F-cov23-02 saveWorkflowDefaults: each agent node\'s full effective block (classic effectiveDefaultsOf), then the DELETE; a refusal names its step', async () => {
  const WF = { id: 'wf_lean', version: 2, nodes: [{ id: 'plan', kind: 'agent', key: 'planner', config: { model: 'opus', effort: 'high', askQuestions: false } }, { id: 'build', kind: 'agent', key: 'builder', config: { model: 'sonnet', effort: 'low', subagentModel: 'haiku' } }, { id: 'gate', kind: 'script' }] };
  const AGENTS = { agents: [{ key: 'planner', asksQuestions: true, questionsDefault: true }, { key: 'builder', fanOut: true, asksQuestions: true, questionsLocked: true }] };
  const CONFIG = { config: { workflows: { wf_lean: { nodes: { build: { fanOut: false } } } } } };
  const reads = { '/api/workflows/wf_lean': WF, '/api/agents': AGENTS, '/api/config?projectDir=%2Fsrc%2Fweb': CONFIG };
  const ok = stub((u, m) => (m === 'GET' ? [reads[u] ? 200 : 404, reads[u] || {}] : [200, {}]));
  assert.equal((await ok.live.saveWorkflowDefaults('wf_lean', 'opus', '/src/web')).ok, true);
  const writes = ok.calls.filter((c) => c.method !== 'GET').map((c) => [c.method, c.url, c.body]);
  assert.deepEqual(writes, [['PATCH', '/api/workflows/wf_lean/defaults', { defaults: {
    plan: { model: 'opus', effort: 'high', fanOut: false, askQuestions: false },   // the same model keeps its effort; the authored askQuestions stays
    build: { model: 'opus', fanOut: false, subagentModel: 'haiku' },               // another model drops the effort; the project's fanOut and the subagent model stay; a locked toggle is never sent
  } }], ['DELETE', '/api/config/workflow?projectDir=%2Fsrc%2Fweb&workflowId=wf_lean', undefined]]);
  const unread = stub((u, m) => (m === 'GET' && u === '/api/agents' ? [500, { error: 'boom' }] : [200, reads[u] || {}]));
  const r0 = await unread.live.saveWorkflowDefaults('wf_lean', 'opus', '/src/web');
  assert.deepEqual([r0.ok, r0.step], [false, 'read the workflow\'s agents']);
  assert.equal(unread.calls.filter((c) => c.method !== 'GET').length, 0, 'nothing is written from a partial read');
  const no = stub((u, m) => (m === 'GET' ? [200, reads[u] || {}] : [400, { error: 'defaults must be an object keyed by node id' }]));
  const r = await no.live.saveWorkflowDefaults('wf_lean', 'opus', '/src/web');
  assert.deepEqual([r.ok, r.error, r.step], [false, 'defaults must be an object keyed by node id', 'save the workflow\'s defaults']);
  assert.equal(no.calls.filter((c) => c.method !== 'GET').length, 1, 'no DELETE after a refused PATCH');
});

test('COV-2 no state before ok: a refused write answers the refusal and the module keeps nothing', async () => {
  const { live } = stub(() => [400, { error: 'tags must be a list of strings' }]);
  const r = await live.saveTagDefaults('web-1', [1]);
  assert.deepEqual([r.ok, r.status, r.error], [false, 400, 'tags must be a list of strings']);
  assert.deepEqual(Object.keys(live).sort(), ['bind', 'binding', 'call', 'checkPreset', 'config', 'defaults', 'duplicatePreset', 'policyNotes', 'presets', 'resetWorkflow', 'saveTagDefaults', 'saveWorkflowDefaults', 'setActiveWorkflow', 'sources', 'updatePreset'], 'methods only: no cache');
});

test('COV-2 presetSetupOf: the body\'s preset keys and the applied preset\'s agent picks (classic presetSetupFromForm)', () => {
  const body = { projectDir: '/src/web', prompt: 'x', workflowId: 'wf_lean', engine: 'codex', sourceBranch: 'dev', tags: ['a'], allowUnguardedEngine: true };
  assert.deepEqual(O.presetSetupOf(body, { scope: { kind: 'project' }, setup: { overlay: { nodes: { p: { model: 'opus' } } }, humanInLoop: true } }), { workflowId: 'wf_lean', engine: 'codex', sourceBranch: 'dev', tags: ['a'], overlay: { nodes: { p: { model: 'opus' } } }, humanInLoop: true });
  assert.equal(O.presetSetupOf(body, { scope: { kind: 'global' }, setup: {} }).sourceBranch, undefined, 'a global preset keeps no branch');
});
