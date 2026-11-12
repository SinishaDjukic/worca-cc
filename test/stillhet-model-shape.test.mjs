// test/stillhet-model-shape.test.mjs — the shape contract (ui/public/stillhet/live/model-shape.mjs): every demo seed meets it,
// so the live adapter that meets it too fills the same pages.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { SHAPES, shapeErrors } from '../ui/public/stillhet/live/model-shape.mjs';
import { stillhetHost } from './helpers/stillhet-host.mjs';

test('every demo seed of the 7 kinds meets its shape', () => {
  const w = stillhetHost({ after });
  const W = w.RailWorld, seen = Object.fromEntries(Object.keys(SHAPES).map((k) => [k, 0]));
  const check = (kind, list) => { for (const x of list) { assert.deepEqual(shapeErrors(kind, x), [], `${kind} ${x.id || ''}`); seen[kind]++; } };
  check('task', W.data().runs);
  check('group', W.data().groups);
  check('chat', w.ChatsListModel.seed().chats);
  check('schedule', w.SchedulesModel.seed().schedules);
  check('project', w.RailProjects.all());
  for (const c of w.PulseModel.CASES) { check('update', c.updates); check('costs', [{ budget: c.budget, usage: c.usage }]); }
  for (const [k, n] of Object.entries(seen)) assert.ok(n > 0, `${k}: seeds checked`);
});

test('a seeded wrong type is named once', () => {
  assert.deepEqual(shapeErrors('task', { id: 'r1', case: 'working', title: 't', project: '', detail: '', time: '', day: 'today', labels: [], cost: '3', archived: false, unread: false, pr: '', group: '', kind: 'Git', by: '', workflow: '' }), ['task.cost: expected number|null']);
  assert.deepEqual(shapeErrors('schedule', { id: 's', title: '', project: '', chat: '', every: '', at: '', next: '', state: '', time: '', section: '', labels: [], what: '', cost: null, started: '', runs: [] }), [], 'day may be absent');
});
