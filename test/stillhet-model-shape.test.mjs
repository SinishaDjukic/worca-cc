// test/stillhet-model-shape.test.mjs — the shape contract (ui/public/stillhet/live/model-shape.mjs): every demo seed meets it,
// so the live adapter that meets it too fills the same pages.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { SHAPES, shapeErrors } from '../ui/public/stillhet/live/model-shape.mjs';
import { stillhetHost } from './helpers/stillhet-host.mjs';

test('every demo seed of the 8 kinds meets its shape', () => {
  const w = stillhetHost({ after });
  const W = w.RailWorld, seen = Object.fromEntries(Object.keys(SHAPES).map((k) => [k, 0]));
  const check = (kind, list) => { for (const x of list) { assert.deepEqual(shapeErrors(kind, x), [], `${kind} ${x.id || ''}`); seen[kind]++; } };
  check('task', W.data().runs);
  check('group', W.data().groups);
  check('chat', w.ChatsListModel.seed().chats);
  check('schedule', w.SchedulesModel.seed().schedules);
  check('project', w.RailProjects.all());
  check('space', w.RailSpaces.list());   // the live adapter's spacesOf draws the same shape (D10)
  for (const c of w.PulseModel.CASES) { check('update', c.updates); check('costs', [{ budget: c.budget, usage: c.usage }]); }
  const wf = w.RailPlaces.workflows.records();   // Workflows (slice 7): the place's own demo lists
  check('workflow', wf.workflow); check('agent', wf.agent); check('script', wf.script);
  const mk = w.RailPlaces.marketplace.records();   // Marketplace (slice 8): the place's own demo lists
  check('plugin', mk.plugins); check('market', mk.markets);
  for (const [k, n] of Object.entries(seen)) if (k !== 'insight') assert.ok(n > 0, `${k}: seeds checked`);   // insight: live sources only (below)
});

test('the live Insights sources (insights-map.mjs statsSource and teamSource) meet SHAPES.insight (slice 10)', async () => {
  const { statsSource, teamSource, shapingSource, untaggedSource } = await import('../ui/public/stillhet/live/insights-map.mjs');
  const { statsAnswer, RECORDS } = await import('./helpers/stillhet-insights-host.mjs');
  for (const page of ['spend', 'ends', 'fails', 'shipped', 'throughput']) {
    assert.deepEqual(shapeErrors('insight', statsSource(statsAnswer(1), { page })), [], page);
    assert.deepEqual(shapeErrors('insight', statsSource(statsAnswer(1), { page, filter: ['person:Maya'], by: 'project', thenBy: 'client' })), [], `${page} filtered`);
  }
  assert.deepEqual(shapeErrors('insight', shapingSource(statsAnswer(1))), []);
  const team = teamSource(RECORDS, { when: 'this month', now: Date.UTC(2026, 10, 14, 12), page: 'team' });
  assert.deepEqual(shapeErrors('insight', team), []);
  assert.deepEqual(shapeErrors('insight', untaggedSource(team.facts, 'client', team)), []);
  assert.deepEqual(shapeErrors('insight', { ...team, rows: [] }), ['insight.rows: expected object']);
});

test('the live Workflows records (workflow-map.mjs) meet the same shapes (slice 7)', async () => {
  const { workflowOf, agentOf, scriptOf } = await import('../ui/public/stillhet/live/workflow-map.mjs');
  const { SEED_TEMPLATES } = await import('../src/core/graph/seed-templates.mjs');
  const { loadAgentRegistry } = await import('../src/core/agent-registry.mjs');
  const agents = loadAgentRegistry(undefined, { userAgentsDir: null, includePlugins: false });
  for (const t of SEED_TEMPLATES) assert.deepEqual(shapeErrors('workflow', workflowOf(t, { agentsByKey: agents })), [], t.id);
  assert.deepEqual(shapeErrors('workflow', workflowOf({ ...SEED_TEMPLATES[0], origin: 'plugin:x' }, { agentsByKey: agents, usage: { wf_full: { tasks: 1, merged: null, running: 1, nodes: {} } } })), []);
  for (const a of Object.values(agents)) assert.deepEqual(shapeErrors('agent', agentOf(a)), [], a.key);
  assert.deepEqual(shapeErrors('script', scriptOf({ key: 'k', runtime: 'python', caseCount: 0 })), []);
});

test('the live Marketplace records (market-map.mjs) meet the same shapes (slice 8)', async () => {
  const { marketOf, pluginsOf } = await import('../ui/public/stillhet/live/market-map.mjs');
  const sha = 'c'.repeat(40), inv = { agents: [], scripts: [], taskSources: [{ id: 'jira', displayName: 'Jira', secrets: ['token'] }], chatChannels: [], models: [], modelSecrets: [], mcpServers: [{ name: 'a' }, { name: 'b' }], skills: [], workflows: [] };
  const m = { id: 'm', url: 'https://github.com/a/b', name: 'M', ref: 'dev', builtin: true, lastSync: { sha, at: '2026-11-14T00:00:00Z' }, plugins: [{ name: 'p', subdir: 'plugins/p', description: 'd', version: '0.1.0', inventory: inv }, { name: 'q', version: null, inventory: {} }] };
  const rows = [{ name: 'p', version: '0.1.0', pinnedSha: sha, repo: m.url, subdir: 'plugins/p', marketplace: 'm', setup: { ok: false }, latest: { version: '0.2.0' }, contributions: {} }, { name: 'linked', version: 'abc1234', repo: '/tmp/x', linked: true, marketplace: null, contributions: { skills: 1 } }];
  assert.deepEqual(shapeErrors('market', marketOf(m)), []);
  for (const p of pluginsOf([m], rows, {})) assert.deepEqual(shapeErrors('plugin', p), [], p.id);
});

test('a seeded wrong type is named once', () => {
  assert.deepEqual(shapeErrors('task', { id: 'r1', case: 'working', title: 't', project: '', detail: '', time: '', day: 'today', labels: [], cost: '3', archived: false, unread: false, pr: '', group: '', kind: 'Git', by: '', workflow: '' }), ['task.cost: expected number|null']);
  assert.deepEqual(shapeErrors('schedule', { id: 's', title: '', project: '', chat: '', every: '', at: '', next: '', state: '', time: '', section: '', labels: [], what: '', cost: null, started: '', runs: [] }), [], 'day may be absent');
  assert.deepEqual(['skip', 'overlap', 'fails', 'ifMissed', 'tz', 'pauseWhy', 'preset', 'after', 'ended'].filter((k) => !(k in SHAPES.schedule)), [], 'the D10 fields');
});

test('every demo turn of every demo chat meets TURN_SHAPES (D18)', async () => {
  const { turnErrors } = await import('../ui/public/stillhet/live/model-shape.mjs');
  const w = stillhetHost({ after });
  const chats = w.ChatsListModel.seed().chats;
  let n = 0;
  for (const c of chats) for (const x of w.ChatsListModel.thread(c)) { assert.deepEqual(turnErrors(x), [], `${c.id} ${x.t} ${x.id || ''}`); n++; }
  assert.ok(n > 50, `${n} demo turns checked`);
  assert.deepEqual(turnErrors({ t: 'question', id: 'q', text: 'Q', options: 'a' }), ['turn.question.options: expected array']);
  assert.deepEqual(turnErrors({ t: 'nope' }), ['turn.t: unknown kind "nope"']);
});

test('panel.turn-time: a turn\'s `at` is a number (ms) when present', async () => {
  const { turnErrors } = await import('../ui/public/stillhet/live/model-shape.mjs');
  assert.deepEqual(turnErrors({ t: 'you', id: 'a', text: 'b', at: 'x' }), ['turn.you.at: expected number']);
  assert.deepEqual(turnErrors({ t: 'you', id: 'a', text: 'b', at: 1 }), []);
  assert.deepEqual(turnErrors({ t: 'words', html: 'h', at: 'x', key: 2 }), ['turn.words.at: expected number', 'turn.words.key: expected string']);
});
