// test/requirements-store.test.mjs — FEAT ids, the thread, contexts, section normalizing (design §3, D3, D10).
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { useTempHome } from './helpers/temp-home.mjs';
import {
  emptySpec, featureId, parseFeatureSeq, normalizeSection, RequirementsError, LIMITS,
} from '../src/core/requirements/spec.mjs';
import {
  createFeature, getFeature, requireFeature, listFeatures, updateFeature, addFeatureCost,
  appendTurn, listTurns, getContext, setContext,
  createStart, listStarts, latestStart, startByRunId, linkPipeline, recentLookCosts,
} from '../src/core/requirements/store.mjs';

useTempHome(after);

test('ids: FEAT-<seq> both ways; junk is null', () => {
  assert.equal(featureId(7), 'FEAT-7');
  assert.equal(parseFeatureSeq('FEAT-7'), 7);
  assert.equal(parseFeatureSeq('7'), 7);
  for (const bad of ['', 'FEAT-', 'FEAT-0', '-1', 'abc', null, '1e3']) assert.equal(parseFeatureSeq(bad), null, String(bad));
});

test('normalizeSection: goal and lists, trimmed, deduplicated, capped', () => {
  assert.deepEqual(normalizeSection('goal', { text: '  Cancel ', measure: ' fewer calls ' }), { text: 'Cancel', measure: 'fewer calls' });
  assert.deepEqual(normalizeSection('goal', 'Just text'), { text: 'Just text', measure: '' });
  assert.deepEqual(normalizeSection('actors', ' Customer \n\nSupport agent\ncustomer'), ['Customer', 'Support agent']);
  assert.deepEqual(normalizeSection('flow', ['a', '', 7, 'b']), ['a', '7', 'b']);
  assert.equal(normalizeSection('rules', Array.from({ length: 50 }, (_, i) => `r${i}`)).length, LIMITS.items);
  assert.equal(normalizeSection('rules', ['x'.repeat(900)])[0].length, LIMITS.item);
  assert.throws(() => normalizeSection('nope', []), (e) => e instanceof RequirementsError && e.code === 'BAD_REQUEST');
});

test('create, read, list, update; validation errors are BAD_REQUEST', () => {
  const a = createFeature({ scopeType: 'project', scopeKey: 'shop-1234abcd', title: ' Cancel order ', description: 'Before it ships' }, { by: 'po' });
  assert.equal(a.id, `FEAT-${a.seq}`);
  assert.equal(a.title, 'Cancel order');
  assert.equal(a.status, 'looking');
  assert.deepEqual(a.spec, emptySpec());
  assert.equal(a.createdBy, 'po');
  const b = createFeature({ scopeType: 'workspace', scopeKey: 'wks-x-1234abcd', title: 'B', description: 'd' });
  assert.deepEqual(listFeatures().map((f) => f.seq), [b.seq, a.seq], 'newest first');
  assert.deepEqual(listFeatures({ scopeType: 'project' }).map((f) => f.seq), [a.seq]);
  updateFeature(b.seq, { status: 'archived' });
  assert.deepEqual(listFeatures().map((f) => f.seq), [a.seq], 'archived hidden by default');
  assert.equal(listFeatures({ archived: true }).length, 2);
  const u = updateFeature(a.seq, { spec: { ...emptySpec(), actors: ['Customer'] }, rounds: 2 }, { by: 'po2' });
  assert.deepEqual(u.spec.actors, ['Customer']);
  assert.equal(u.rounds, 2);
  assert.equal(u.updatedBy, 'po2');
  addFeatureCost(a.seq, 0.4); addFeatureCost(a.seq, 0.1);
  assert.equal(getFeature(a.seq).costUsd, 0.5);
  assert.equal(getFeature(999999), null);
  assert.throws(() => requireFeature(999999), (e) => e.code === 'NOT_FOUND');
  for (const bad of [{ scopeType: 'team', scopeKey: 'k', title: 't', description: 'd' },
    { scopeType: 'project', scopeKey: '', title: 't', description: 'd' },
    { scopeType: 'project', scopeKey: 'k', title: ' ', description: 'd' },
    { scopeType: 'project', scopeKey: 'k', title: 'x'.repeat(201), description: 'd' }]) {
    assert.throws(() => createFeature(bad), (e) => e.code === 'BAD_REQUEST', JSON.stringify(bad).slice(0, 60));
  }
  assert.throws(() => updateFeature(a.seq, { status: 'weird' }));
});

test('turns are append-only and ordered', () => {
  const f = createFeature({ scopeType: 'project', scopeKey: 'k', title: 't', description: 'd' });
  const t1 = appendTurn(f.seq, { kind: 'round', payload: { questions: [] }, model: 'm', costUsd: 0.2 }, { by: 'w' });
  const t2 = appendTurn(f.seq, { kind: 'answers', payload: { roundTurnId: t1, answers: [] } });
  assert.ok(t2 > t1);
  const turns = listTurns(f.seq);
  assert.deepEqual(turns.map((t) => t.kind), ['round', 'answers']);
  assert.deepEqual([turns[0].model, turns[0].costUsd, turns[0].by], ['m', 0.2, 'w']);
  assert.throws(() => appendTurn(f.seq, { kind: 'chat', payload: {} }));
});

test('contexts: defaults, upsert, partial update', () => {
  assert.deepEqual(
    (({ body, lookAtCode }) => ({ body, lookAtCode }))(getContext('project', 'ctx-1')),
    { body: '', lookAtCode: true });
  setContext('project', 'ctx-1', { body: 'Actors: buyer' }, { by: 'po' });
  setContext('project', 'ctx-1', { lookAtCode: false });
  const c = getContext('project', 'ctx-1');
  assert.deepEqual([c.body, c.lookAtCode], ['Actors: buyer', false]);
  assert.throws(() => setContext('project', 'ctx-1', { body: 'x'.repeat(LIMITS.context + 1) }), (e) => e.code === 'BAD_REQUEST');
});

test('a title is one line: inner whitespace and newlines collapse to single spaces', () => {
  const f = createFeature({ scopeType: 'project', scopeKey: 'k', title: '  Cancel\n  an\r\norder\tnow ', description: 'Line one\nLine two' });
  assert.equal(f.title, 'Cancel an order now');
  assert.equal(f.description, 'Line one\nLine two', 'the description keeps its lines');
});

test('starts: versions per feature, newest first, run id lookup, shape', () => {
  const a = createFeature({ scopeType: 'project', scopeKey: 'st', title: 'A', description: 'd' });
  const b = createFeature({ scopeType: 'project', scopeKey: 'st', title: 'B', description: 'd' });
  assert.equal(latestStart(a.seq), null);
  assert.deepEqual(listStarts(a.seq), []);
  const spec = { ...emptySpec(), goal: { text: 'g', measure: '' } };
  const s1 = createStart({ featureSeq: a.seq, version: 1, runId: 'run-a1', spec, title: 'A', ready: true }, { by: 'po' });
  assert.deepEqual({ ...s1, id: 0, startedAt: '' }, {
    id: 0, featureSeq: a.seq, version: 1, runId: 'run-a1', pipelineId: null, spec, title: 'A', ready: true, failing: [],
    reason: null, workflowId: null, sourceBranch: null, startedBy: 'po', startedAt: '',
  });
  assert.ok(s1.startedAt);
  const s2 = createStart({ featureSeq: a.seq, version: 2, runId: 'run-a2', spec, title: 'A', ready: false,
    failing: ['criteria'], reason: 'urgent', workflowId: 'wf', sourceBranch: 'main' });
  createStart({ featureSeq: b.seq, version: 1, runId: 'run-b1', spec, title: 'B', ready: true });
  assert.deepEqual(listStarts(a.seq).map((x) => x.version), [2, 1]);
  assert.equal(latestStart(a.seq).runId, 'run-a2');
  assert.equal(s2.ready, false);
  assert.deepEqual(s2.failing, ['criteria']);
  assert.equal(startByRunId('run-a1').version, 1);
  assert.equal(startByRunId('nope'), null);
});

test('starts: (feature, version) and run id are unique', () => {
  const f = createFeature({ scopeType: 'project', scopeKey: 'st2', title: 'A', description: 'd' });
  const base = { featureSeq: f.seq, spec: emptySpec(), title: 'A', ready: true };
  createStart({ ...base, version: 1, runId: 'u-1' });
  assert.throws(() => createStart({ ...base, version: 1, runId: 'u-2' }));
  assert.throws(() => createStart({ ...base, version: 2, runId: 'u-1' }));
});

test('linkPipeline fills a NULL pipeline id once', () => {
  const f = createFeature({ scopeType: 'project', scopeKey: 'st3', title: 'A', description: 'd' });
  createStart({ featureSeq: f.seq, version: 1, runId: 'l-1', spec: emptySpec(), title: 'A', ready: true });
  assert.equal(linkPipeline('l-1', 'abcd1234'), true);
  assert.equal(linkPipeline('l-1', 'ffff0000'), false);
  assert.equal(startByRunId('l-1').pipelineId, 'abcd1234');
  assert.equal(linkPipeline('unknown', 'x'), false);
});

test('recentLookCosts: orientation turns with a positive cost, newest first, limited', () => {
  const f = createFeature({ scopeType: 'project', scopeKey: 'st4', title: 'A', description: 'd' });
  const before = recentLookCosts(1000).length;
  appendTurn(f.seq, { kind: 'orientation', costUsd: 0.5 });
  appendTurn(f.seq, { kind: 'orientation', costUsd: 0 });
  appendTurn(f.seq, { kind: 'round', costUsd: 9 });
  appendTurn(f.seq, { kind: 'orientation', costUsd: 0.25 });
  const all = recentLookCosts(1000);
  assert.equal(all.length, before + 2);
  assert.deepEqual(all.slice(0, 2), [0.25, 0.5]);
  assert.deepEqual(recentLookCosts(1), [0.25]);
});
