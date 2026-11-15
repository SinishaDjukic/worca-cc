// test/perspective-choices.test.mjs — the proposed-perspective choice store (src/core/prompt-check/perspective-choices.mjs):
// one row per started run with a proposal, ids only, never prompt text.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { useTempHome } from './helpers/temp-home.mjs';
import { getDb } from '../src/core/db.mjs';
import { recordPerspectiveChoice, listPerspectiveChoices, CHOICE_SURFACES } from '../src/core/prompt-check/perspective-choices.mjs';

useTempHome(after, 'worca-persp-choices-');

const AT = new Date('2026-11-14T10:00:00Z');
const count = () => getDb().prepare('SELECT COUNT(*) AS n FROM perspective_choices').get().n;

test('dropped and added are stored in perspective order', () => {
  assert.deepEqual(CHOICE_SURFACES, ['run-card']);
  const r = recordPerspectiveChoice({ runId: 'run_a', surface: 'run-card', kind: 'bug',
    proposed: ['security', 'product', 'qa', 'architect'], chosen: ['compliance', 'qa', 'ux', 'product'] }, { now: AT });
  assert.deepEqual(r.proposed, ['product', 'architect', 'qa', 'security']);
  assert.deepEqual(r.chosen, ['product', 'qa', 'ux', 'compliance']);
  assert.deepEqual(r.dropped, ['architect', 'security']);
  assert.deepEqual(r.added, ['ux', 'compliance']);
});

test('an injected now gives `at` as its ISO string, and run_id is the given run id', () => {
  const r = recordPerspectiveChoice({ runId: 'run_b', surface: 'run-card', kind: null, proposed: ['product', 'qa'], chosen: ['product', 'qa'] }, { now: AT });
  assert.equal(r.at, '2026-11-14T10:00:00.000Z');
  assert.equal(r.runId, 'run_b');
  assert.equal(getDb().prepare('SELECT run_id FROM perspective_choices WHERE id = ?').get(r.id).run_id, 'run_b');
  assert.deepEqual([r.dropped, r.added, r.kind], [[], [], null]);
});

test('an unknown key, kind, surface or run id throws TypeError and writes nothing', () => {
  const before = count();
  const ok = { runId: 'run_c', surface: 'run-card', kind: 'bug', proposed: ['product'], chosen: ['product'] };
  for (const bad of [{ proposed: ['nope'] }, { chosen: ['x'] }, { proposed: 'qa' }, { kind: 'weird' }, { surface: 'chat' },
    { runId: 'bad id!' }, { runId: undefined }, { runId: 'x'.repeat(200) }]) {
    assert.throws(() => recordPerspectiveChoice({ ...ok, ...bad }), TypeError, JSON.stringify(bad));
  }
  assert.throws(() => recordPerspectiveChoice(null), TypeError);
  assert.equal(count(), before);
});

test('the row has exactly its 9 columns', () => {
  const r = recordPerspectiveChoice({ runId: 'run_d', surface: 'run-card', kind: 'idea', proposed: ['product', 'ux'], chosen: ['product'] }, { now: AT });
  const row = getDb().prepare('SELECT * FROM perspective_choices WHERE id = ?').get(r.id);
  assert.deepEqual(Object.keys(row), ['id', 'run_id', 'surface', 'kind', 'proposed', 'chosen', 'dropped', 'added', 'at']);
});

test('a text field on the input never reaches the row', () => {
  const r = recordPerspectiveChoice({ runId: 'run_e', surface: 'run-card', kind: 'bug', proposed: ['product'], chosen: ['product'],
    text: 'zebra-secret-brief', prompt: 'zebra-prompt', reason: 'zebra-reason' }, { now: AT });
  const row = getDb().prepare('SELECT * FROM perspective_choices WHERE id = ?').get(r.id);
  assert.doesNotMatch(JSON.stringify(row), /zebra/);
  assert.doesNotMatch(JSON.stringify(r), /zebra/);
});

test('listPerspectiveChoices({ runId }) returns that run\'s rows, newest first', () => {
  const a = recordPerspectiveChoice({ runId: 'run_f', surface: 'run-card', kind: 'bug', proposed: ['product'], chosen: ['product'] }, { now: new Date('2026-11-14T08:00:00Z') });
  const b = recordPerspectiveChoice({ runId: 'run_f', surface: 'run-card', kind: 'plan', proposed: ['product', 'qa'], chosen: ['product'] }, { now: new Date('2026-11-14T09:00:00Z') });
  recordPerspectiveChoice({ runId: 'run_g', surface: 'run-card', kind: 'plan', proposed: ['product'], chosen: ['product'] }, { now: AT });
  assert.deepEqual(listPerspectiveChoices({ runId: 'run_f' }), [b, a]);
  assert.ok(listPerspectiveChoices().length >= 3);
  assert.deepEqual(listPerspectiveChoices({ runId: 'nope' }), []);
});
