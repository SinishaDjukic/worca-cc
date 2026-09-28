// test/ask-sources.test.mjs
// Plugin task sources in Ask Worca (docs/scheduled-runs.md "Ask Worca", source-spec.mjs): the
// propose_run `source` is validated against what is installed (inputs, profiles, bindings), the
// parent looks the task up once, and list_task_sources / find_tasks / get_task read through the
// plugin shim with the same two ops the New pipeline pane may drive.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { validateRunSource, checkTask, runSourceOf, shapeTask, shapeSources } from '../src/core/ask/source-spec.mjs';
import { createProposalValidator } from '../src/core/ask/proposal.mjs';
import { createAskTools } from '../src/core/ask/tools.mjs';
import { shapeSources as realShapeSources, shapeTask as realShapeTask } from '../src/core/ask/source-spec.mjs';

const JIRA = {
  type: 'plugin', plugin: 'jira-source', sourceId: 'jira', displayName: 'Jira',
  inputs: [
    { key: 'writeBack', type: 'select', label: 'Write result back', default: 'yes', options: ['yes', 'no'] },
    { key: 'task', type: 'task-browser', label: 'Issue' },
  ],
  multiProfile: true, profiles: ['acme', 'globex'],
};
const GH = { type: 'plugin', plugin: 'github-source', sourceId: 'github', displayName: 'GitHub Issues',
  inputs: [{ key: 'repo', type: 'remote-select', label: 'Repository' }, { key: 'task', type: 'task-browser', label: 'Issue' }], multiProfile: false, profiles: [] };
const SOURCES = [{ type: 'prompt', displayName: 'Prompt' }, JIRA, GH];
const PROJECT = { target: 'project', projectKey: 'shop-00000001', workspaceId: null, members: null };
const bound = (map) => (ref) => (map[ref.scopeKey] ? { profile: map[ref.scopeKey], via: 'binding' } : { profile: null, via: 'none', candidates: ref.available });
const v = (raw, o = {}) => validateRunSource(raw, { target: PROJECT, listTaskSources: () => SOURCES, resolveProfile: bound({ 'shop-00000001': 'acme' }), ...o });

test('source: the reference, the project\'s bound profile, declared inputs with their defaults — never the task browser', () => {
  const r = v({ plugin: 'jira-source', sourceId: 'jira', taskId: 'PROJ-123' });
  assert.deepEqual(r, { ok: true, source: { type: 'plugin', plugin: 'jira-source', sourceId: 'jira', taskId: 'PROJ-123', displayName: 'Jira', profile: 'acme', profileVia: 'binding', inputs: { writeBack: 'yes' } } });
  assert.equal(v({ plugin: 'jira-source', sourceId: 'jira', taskId: 'PROJ-1', profile: 'globex', inputs: { writeBack: 'no' } }).source.profile, 'globex');
  assert.deepEqual(runSourceOf(r.source), { type: 'plugin', plugin: 'jira-source', sourceId: 'jira', taskId: 'PROJ-123', profile: 'acme', inputs: { writeBack: 'yes' } }, 'what POST /api/run gets');
  assert.deepEqual(v(undefined), { ok: true, source: null });
  const gh = v({ plugin: 'github-source', sourceId: 'github', taskId: 'acme/shop#12', inputs: { repo: 'acme/shop' } });
  assert.deepEqual(gh.source.inputs, { repo: 'acme/shop' });
  assert.equal('profile' in gh.source, false, 'a single-profile source carries none');
});

test('source: unknown sources, stray inputs, bad options, profiles the scope has not chosen — each refused with the way forward', () => {
  const err = (raw, o) => v(raw, o).errors.join(' | ');
  assert.match(err({ plugin: 'linear', sourceId: 'x', taskId: '1' }), /no task source linear\/x is installed and enabled \(installed: jira-source\/jira, github-source\/github\)/);
  assert.match(err({ plugin: 'linear', sourceId: 'x', taskId: '1' }, { listTaskSources: () => [] }), /none is installed/);
  assert.match(err({ plugin: 'jira-source', sourceId: 'jira' }), /source\.taskId is required/);
  assert.match(err({ plugin: 'jira-source', sourceId: 'jira', taskId: 'P-1', inputs: { task: 'P-1', color: 'x' } }), /source\.inputs\.task is not an input of Jira .*source\.inputs\.color/);
  assert.match(err({ plugin: 'jira-source', sourceId: 'jira', taskId: 'P-1', inputs: { writeBack: 'maybe' } }), /writeBack must be one of yes \| no/);
  assert.match(err({ plugin: 'jira-source', sourceId: 'jira', taskId: 'P-1', profile: 'initech' }), /Jira has no profile "initech" \(profiles: acme, globex\)/);
  assert.match(err({ plugin: 'jira-source', sourceId: 'jira', taskId: 'P-1' }, { resolveProfile: bound({}) }), /several profiles and this project is not bound to one — ask the user which: acme, globex/);
  assert.match(err({ plugin: 'jira-source', sourceId: 'jira', taskId: 'P-1' }, { listTaskSources: () => [{ ...JIRA, profiles: [] }], resolveProfile: bound({}) }), /no profile yet/);
  assert.match(err({ plugin: 'github-source', sourceId: 'github', taskId: 'a/b#1', profile: 'acme' }), /does not use profiles/);
  // A workspace resolves through its members' bindings.
  let seen = null;
  validateRunSource({ plugin: 'jira-source', sourceId: 'jira', taskId: 'P-1' }, {
    target: { target: 'workspace', workspaceId: 'wks-team-00000001', members: [{ projectKey: 'a-00000001' }, { projectKey: 'b-00000002' }] },
    listTaskSources: () => SOURCES, resolveProfile: (ref) => { seen = ref; return { profile: 'acme', via: 'members' }; },
  });
  assert.deepEqual(seen.memberKeys, ['a-00000001', 'b-00000002']);
  assert.equal(seen.scopeType, 'workspace');
});

test('checkTask: found → title and an http(s) link; missing refuses; a transient failure keeps the card with a warning; auth refuses', async () => {
  const src = { plugin: 'jira-source', sourceId: 'jira', taskId: 'PROJ-123', displayName: 'Jira', profile: 'acme' };
  let asked = null;
  const ok = await checkTask(src, async (ref) => { asked = ref; return { id: 'PROJ-123', title: 'Login loops', url: 'https://acme.atlassian.net/browse/PROJ-123' }; });
  assert.deepEqual(asked, { plugin: 'jira-source', sourceId: 'jira', taskId: 'PROJ-123', profile: 'acme' });
  assert.deepEqual(ok, { ok: true, task: { title: 'Login loops', url: 'https://acme.atlassian.net/browse/PROJ-123' } });
  assert.equal((await checkTask(src, async () => ({ title: 'x', url: 'javascript:alert(1)' }))).task.url, null, 'only a web link reaches the card');
  assert.match((await checkTask(src, async () => null)).error, /Jira has no task "PROJ-123" — find_tasks/);
  const transient = await checkTask(src, async () => { throw Object.assign(new Error('socket hang up'), { kind: 'network' }); });
  assert.equal(transient.ok, true);
  assert.match(transient.warning, /could not reach Jira just now \(network\); the run fetches the task when it starts/);
  assert.match((await checkTask(src, async () => { throw Object.assign(new Error('401 bad token'), { kind: 'auth' }); })).error, /^Jira: 401 bad token$/);
  assert.deepEqual(await checkTask(src, null), { ok: true, task: null }, 'the child does not look up');
});

test('shapeTask / shapeSources: redacted, clipped, the task browser hidden', () => {
  const t = shapeTask({ id: 'P-1', title: 'T', url: 'https://x', state: 'open', labels: ['a', { name: 'b' }], body: 'secret ghp_abc'.padEnd(30_000, '.'), meta: { k: 'v' } },
    { redact: (s) => s.replace(/ghp_\w+/g, '[REDACTED]'), withBody: true });
  assert.equal(t.title, 'T');
  assert.deepEqual(t.labels, ['a', 'b']);
  assert.match(t.body, /^secret \[REDACTED\]/);
  assert.equal(t.truncated, true);
  assert.deepEqual(t.meta, { k: 'v' });
  assert.equal('body' in shapeTask({ id: 'x', title: 'y' }), false, 'rows carry no body');
  const s = shapeSources(SOURCES);
  assert.equal(s.length, 2, 'built-ins are not task sources');
  assert.deepEqual(s[0].inputs.map((i) => i.key), ['writeBack']);
  assert.deepEqual(s[0].profiles, ['acme', 'globex']);
});

test('propose_run with a source: no brief, the task\'s title, the card carries the reference; a brief as well is refused; Auto only on projects', async () => {
  const validate = createProposalValidator({
    listProjects: async () => [{ key: 'shop-00000001', name: 'shop', path: '/x/shop' }],
    readWorkspace: async () => ({ id: 'wks-team-00000001', name: 'Team', projectPaths: ['/x/a'], projectKeys: ['a-00000001'] }),
    isGitRepo: () => true,
    assertRunnableWorkflow: async (id) => ({ id, name: id === 'wf_auto' ? 'Auto' : 'Default' }),
    readGuardrailSet: async () => ({ id: 'normal' }),
    pathExists: () => true,
    listTaskSources: () => SOURCES,
    resolveProfile: bound({ 'shop-00000001': 'acme' }),
  }).validateProposal;
  const lookupTask = async () => ({ title: 'Login loops after SSO', url: 'https://acme.atlassian.net/browse/PROJ-123' });
  const r = await validate({ projectKey: 'shop-00000001', workflowId: 'wf_auto', source: { plugin: 'jira-source', sourceId: 'jira', taskId: 'PROJ-123' }, when: '+1h' }, { lookupTask, timeZone: 'UTC' });
  assert.equal(r.ok, true, JSON.stringify(r.errors));
  assert.equal(r.card.brief, '');
  assert.equal(r.card.title, 'Login loops after SSO');
  assert.equal(r.card.workflowId, 'wf_auto');
  assert.equal(r.card.source.url, 'https://acme.atlassian.net/browse/PROJ-123');
  assert.equal(r.card.schedule.kind, 'once', 'a tracker task can be scheduled too');
  const both = await validate({ projectKey: 'shop-00000001', brief: 'fix it', source: { plugin: 'jira-source', sourceId: 'jira', taskId: 'PROJ-123' } }, { lookupTask });
  assert.match(both.errors.join(), /give brief OR source, not both/);
  const missing = await validate({ projectKey: 'shop-00000001', source: { plugin: 'jira-source', sourceId: 'jira', taskId: 'NOPE-1' } }, { lookupTask: async () => null });
  assert.match(missing.errors.join(), /Jira has no task "NOPE-1"/);
  const ws = await validate({ workspaceId: 'wks-team-00000001', workflowId: 'wf_auto', brief: 'x' });
  assert.match(ws.errors.join(), /Auto workflow is not available for workspace targets yet/);
  const plain = await validate({ projectKey: 'shop-00000001', brief: 'x' });
  assert.equal('source' in plain.card, false, 'a plain card keeps its key set');
});

test('tools: list_task_sources resolves bindings; find_tasks / get_task call the two read ops with the right profile, redact, and explain failures', async () => {
  const calls = [];
  const deps = {
    limits: { listRunsMaxLimit: 100 }, redact: (s) => String(s).replace(/tok_\w+/g, '[REDACTED]'),
    pinnedScope: () => ({ projectKey: 'shop-00000001' }),
    taskSourceShapes: { shapeSources: realShapeSources, shapeTask: realShapeTask },
    sources: {
      list: () => [JIRA, GH],
      resolve: async ({ projectKey }) => (projectKey === 'shop-00000001' ? { profile: 'acme', via: 'binding' } : { profile: null, via: 'none', candidates: ['acme', 'globex'] }),
      call: async (ref) => {
        calls.push(ref);
        if (ref.sourceId === 'github') throw Object.assign(new Error('rate limited tok_123'), { kind: 'rate-limit' });
        if (ref.op === 'listTasks') return { tasks: [{ id: 'PROJ-123', title: 'Login loops', url: 'https://j/PROJ-123', state: 'To Do' }], cursor: 'n' };
        return ref.args.id === 'PROJ-123' ? { id: 'PROJ-123', title: 'Login loops', body: 'steps tok_abc', meta: { priority: 'High' } } : null;
      },
    },
  };
  const tools = createAskTools(deps);
  const list = await tools.call('list_task_sources', {});
  assert.deepEqual(list.scope, { projectKey: 'shop-00000001' }, 'the pinned scope by default');
  assert.equal(list.sources.find((s) => s.plugin === 'jira-source').boundProfile, 'acme');
  const found = await tools.call('find_tasks', { plugin: 'jira-source', sourceId: 'jira', search: 'PROJ-123' });
  assert.deepEqual(calls.at(-1), { plugin: 'jira-source', sourceId: 'jira', profile: 'acme', op: 'listTasks', args: { search: 'PROJ-123' } });
  assert.equal(found.tasks[0].id, 'PROJ-123');
  assert.equal(found.more, true);
  const got = await tools.call('get_task', { plugin: 'jira-source', sourceId: 'jira', id: 'PROJ-123' });
  assert.equal(got.task.body, 'steps [REDACTED]');
  assert.deepEqual(got.task.meta, { priority: 'High' });
  await assert.rejects(() => tools.call('get_task', { plugin: 'jira-source', sourceId: 'jira', id: 'X-9' }), /has no task "X-9"/);
  await assert.rejects(() => tools.call('find_tasks', { plugin: 'jira-source', sourceId: 'jira', projectKey: 'api-00000002' }), /several profiles and none is bound here — ask the user which: acme, globex/);
  await assert.rejects(() => tools.call('find_tasks', { plugin: 'github-source', sourceId: 'github', search: 'x' }), /github-source\/github \(rate-limit\): rate limited \[REDACTED\]/);
  await assert.rejects(() => tools.call('get_task', { plugin: 'nope', sourceId: 'x', id: '1' }), /no task source nope\/x is installed/);
  await assert.rejects(() => tools.call('find_tasks', { plugin: 'github-source', sourceId: 'github', profile: 'acme' }), /does not use profiles/);
  const bare = createAskTools({ limits: {}, redact: (s) => s });
  await assert.rejects(() => bare.call('list_task_sources', {}), /task sources are unavailable/);
});
