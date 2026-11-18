// test/design-store-builds.test.mjs — the Design store: builds and agents (plan Task 8).
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { useTempHome } from './helpers/temp-home.mjs';
import { prepare } from '../src/core/db.mjs';
import { DesignError, BUILD_ID_RE, AGENT_ID_RE } from '../src/core/design/ids.mjs';
import { designDir } from '../src/core/design/paths.mjs';
import {
  OPEN_BUILD_STATUSES, createDesign, getDesign, updateDesign, deleteDesign,
  createBuild, getBuild, latestBuild, listBuilds, listOpenBuilds, updateBuild,
  createAgent, getAgent, listAgents, updateAgent,
} from '../src/core/design/store.mjs';

useTempHome(after);
const code = (c) => (e) => e instanceof DesignError && e.code === c;
const start = (d, kind = 'first') => createBuild({ designId: d.id, kind, brief: 'a landing page', fast: true }, { by: 'alice' });

test('createBuild: counts rounds per design, sets the current build and status; one open build per design', () => {
  const d = createDesign({ kind: 'web' });
  const b1 = start(d);
  assert.match(b1.id, BUILD_ID_RE);
  assert.deepEqual([b1.round, b1.kind, b1.status, b1.fast, b1.createdBy, b1.agentsTotal, b1.layers, b1.costUsd, b1.endedAt],
    [1, 'first', 'planning', true, 'alice', 0, 0, 0, null]);
  assert.deepEqual(b1.sections, []);
  assert.deepEqual([getDesign(d.id).currentBuild, getDesign(d.id).status], [b1.id, 'planning']);
  assert.throws(() => start(d), code('CONFLICT'));
  updateBuild(b1.id, { status: 'paused', reason: 'total-limit' });
  assert.throws(() => start(d), code('CONFLICT'), 'paused still counts');
  const done = updateBuild(b1.id, { status: 'done', costUsd: 4.2, layers: 126, sections: [{ id: 'hero', status: 'done', agentId: 'a_1f2e3d4c', summary: 's' }] });
  assert.ok(done.endedAt);
  assert.deepEqual([done.costUsd, done.layers, done.sections[0].agentId, getDesign(d.id).status], [4.2, 126, 'a_1f2e3d4c', 'done']);
  const b2 = start(d, 'change');
  assert.deepEqual([b2.round, b2.kind], [2, 'change']);
  updateBuild(b1.id, { status: 'stopped' });
  assert.equal(getDesign(d.id).status, 'planning', 'only the current build moves the design (L1.20)');
  assert.equal(latestBuild(d.id).id, b2.id);
  assert.deepEqual(listBuilds(d.id).map((b) => b.round), [1, 2]);
  updateBuild(b2.id, { status: 'interrupted' });
  assert.equal(start(d).round, 3, 'interrupted does not block a new round');
});

test('bad input', () => {
  const d = createDesign({ kind: 'web' });
  assert.throws(() => createBuild({ designId: 'd_000000000000', kind: 'first', brief: 'x' }), code('NOT_FOUND'));
  assert.throws(() => createBuild({ designId: d.id, kind: 'replay', brief: 'x' }), code('BAD_REQUEST'));
  assert.throws(() => createBuild({ designId: d.id, kind: 'first', brief: '' }), code('BAD_REQUEST'));
  const b = start(d);
  assert.throws(() => updateBuild(b.id, { status: 'nonsense' }), code('BAD_REQUEST'));
});

test('listOpenBuilds finds the open ones across designs, for boot recovery', () => {
  prepare('DELETE FROM design_builds').run();
  const a = start(createDesign({ kind: 'web' }));
  const b = start(createDesign({ kind: 'web' }));
  const c = start(createDesign({ kind: 'web' }));
  updateBuild(b.id, { status: 'paused' });
  updateBuild(c.id, { status: 'done' });
  assert.deepEqual(listOpenBuilds().map((x) => x.id).sort(), [a.id, b.id].sort());
});

test('agents: an id, the build counts them, a terminal status sets endedAt, tokens round-trip', () => {
  const b = start(createDesign({ kind: 'web' }));
  const a = createAgent({ buildId: b.id, role: 'builder', sectionId: 'hero', job: 'Hero', engine: 'claude', model: 'claude-sonnet-5-5', effort: 'medium' });
  assert.match(a.id, AGENT_ID_RE);
  assert.deepEqual([a.status, a.costKnown, a.tokens, a.asks, a.costUsd, a.endedAt], ['starting', true, null, 0, null, null]);
  assert.equal(getBuild(b.id).agentsTotal, 1);
  const u = updateAgent(a.id, { status: 'done', costUsd: 0.31, tokens: { in: 1200, out: 840, cr: 9000, cw: 0 }, sessionId: 's1', costKnown: false, asks: 1 });
  assert.ok(u.endedAt);
  assert.deepEqual([u.costUsd, u.tokens.out, u.sessionId, u.costKnown, u.asks], [0.31, 840, 's1', false, 1]);
  const r = updateAgent(a.id, { job: 'Integrate', status: 'starting', endedAt: null, error: null, bogus: 1 });
  assert.deepEqual([r.job, r.status, r.endedAt, 'bogus' in r], ['Integrate', 'starting', null, false], 'P2 reuses the lead row: job patches, endedAt null reopens, unknown keys are ignored');
  assert.deepEqual(listAgents(b.id).map((x) => x.id), [a.id]);
  assert.throws(() => createAgent({ buildId: b.id, role: 'crew', job: 'x', engine: 'claude' }), code('BAD_REQUEST'));
  assert.throws(() => createAgent({ buildId: b.id, role: 'lead', job: 'x'.repeat(25), engine: 'claude' }), code('BAD_REQUEST'));
  assert.throws(() => createAgent({ buildId: 'b_000000000000', role: 'lead', job: 'Lead', engine: 'claude' }), code('NOT_FOUND'));
  assert.throws(() => updateAgent(a.id, { status: 'nonsense' }), code('BAD_REQUEST'));
});

test('deleteDesign refuses an open build; once closed it removes builds and agents', () => {
  const d = createDesign({ kind: 'web' });
  const b = start(d);
  const a = createAgent({ buildId: b.id, role: 'lead', job: 'Lead', engine: 'claude' });
  assert.throws(() => deleteDesign(d.id), code('CONFLICT'));
  assert.ok(existsSync(designDir(d.id)), 'the folder stays');
  updateBuild(b.id, { status: 'stopped' });
  assert.equal(deleteDesign(d.id), true);
  assert.equal(getBuild(b.id), null);
  assert.equal(getAgent(a.id), null);
});

test('every open status blocks a new round and the delete; an open build that is not the current one still blocks the delete', () => {
  const OPEN = ['planning', 'building', 'integrating', 'paused'];
  assert.deepEqual([...OPEN_BUILD_STATUSES], OPEN);
  for (const status of OPEN) {
    const d = createDesign({ kind: 'web' });
    const b = start(d);
    updateBuild(b.id, { status });
    assert.throws(() => start(d), code('CONFLICT'), `createBuild: ${status}`);
    assert.throws(() => deleteDesign(d.id), code('CONFLICT'), `deleteDesign: ${status}`);
    assert.ok(existsSync(designDir(d.id)), status);
    updateBuild(b.id, { status: 'stopped' });
  }
  const d = createDesign({ kind: 'web' });
  const b = start(d);
  updateDesign(d.id, { currentBuild: null });
  assert.throws(() => deleteDesign(d.id), code('CONFLICT'), 'the delete reads every build of the design, not the current_build pointer');
  assert.ok(existsSync(designDir(d.id)));
  updateBuild(b.id, { status: 'stopped' });
  assert.equal(deleteDesign(d.id), true);
});

test('fast defaults to the design\'s, the brief limit, a given endedAt wins, a malformed sections_json reads as []', () => {
  const d = createDesign({ kind: 'web', fast: true });
  assert.throws(() => createBuild({ designId: d.id, kind: 'first', brief: 'x'.repeat(4001) }), code('BAD_REQUEST'));
  assert.throws(() => createBuild({ designId: d.id, kind: 'first', brief: ' \n ' }), code('BAD_REQUEST'));
  const b = createBuild({ designId: d.id, kind: 'first', brief: 'x'.repeat(4000) });
  assert.deepEqual([b.fast, b.createdBy, b.reason], [true, null, null], 'M7: the round starts with the design\'s choice');
  const fixed = '2026-11-06T00:00:00.000Z';
  assert.equal(updateBuild(b.id, { status: 'error', endedAt: fixed }).endedAt, fixed);
  assert.equal(updateBuild(b.id, { status: 'stopped' }).endedAt, fixed, 'the auto-set only fills an unset endedAt');
  const reopened = updateBuild(b.id, { status: 'building', endedAt: null });
  assert.deepEqual([reopened.status, reopened.endedAt, getDesign(d.id).status], ['building', null, 'building']);
  prepare('UPDATE design_builds SET sections_json = ? WHERE id = ?').run('{nope', b.id);
  assert.deepEqual(getBuild(b.id).sections, []);
  const a = createAgent({ buildId: b.id, role: 'lead', job: 'Lead', engine: 'claude' });
  assert.equal(updateAgent(a.id, { status: 'error', endedAt: fixed, error: 'boom' }).endedAt, fixed);
  assert.equal(updateAgent(a.id, { status: 'done' }).endedAt, fixed, 'the auto-set only fills an unset endedAt');
  assert.equal(updateAgent(a.id, { status: 'stopped', endedAt: null }).endedAt, null, 'a given null wins over a terminal status');
  assert.throws(() => createAgent({ buildId: b.id, role: 'lead', job: 'Two\nlines', engine: 'claude' }), code('BAD_REQUEST'));
  assert.throws(() => updateAgent(a.id, { job: '' }), code('BAD_REQUEST'));
  assert.throws(() => updateBuild('b_000000000000', { status: 'done' }), code('NOT_FOUND'));
  assert.throws(() => updateAgent('a_00000000', { status: 'done' }), code('NOT_FOUND'));
});
