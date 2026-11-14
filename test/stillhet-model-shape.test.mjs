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
  for (const [k, n] of Object.entries(seen)) assert.ok(n > 0, `${k}: seeds checked`);
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
