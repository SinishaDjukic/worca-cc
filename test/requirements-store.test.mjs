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
  getBrief, usableBrief, listBriefs, listMakingBriefs, beginBrief, saveBriefResult, failBrief, setBriefSections,
  addBriefCost, deleteBrief, briefUsers, recentBriefCosts,
} from '../src/core/requirements/store.mjs';

import { recordRequirementsCostDelta } from '../src/core/cost-budget.mjs';

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
  assert.throws(() => setContext('project', 'ctx-1', { body: 'x'.repeat(LIMITS.context + 1) }), (e) => e.code === 'BAD_REQUEST' && e.message === `Your notes are longer than ${LIMITS.context} characters.`);
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
    reason: null, workflowId: null, sourceBranch: null, startedBy: 'po', startedAt: '', files: [],
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

// ---- product briefs (A7) ----

test('briefs: one row per scope; beginBrief twice is BUSY; JSON round trips; usableBrief is null until saved', () => {
  assert.equal(getBrief('project', 'bp1'), null);
  const b = beginBrief('project', 'bp1', { by: 'ann' });
  assert.equal(b.status, 'making');
  assert.deepEqual(b.sections, { product: '', users: [], terms: [], areas: [] });
  assert.equal(usableBrief('project', 'bp1'), null);
  assert.throws(() => beginBrief('project', 'bp1'), (e) => e instanceof RequirementsError && e.code === 'BUSY');
  assert.deepEqual(listMakingBriefs().map((x) => x.scopeKey), ['bp1']);
  const sections = { product: 'A shop', users: [{ name: 'Shopper', can: 'buys' }], terms: [], areas: [{ name: 'Orders', files: ['a.mjs'] }] };
  const saved = saveBriefResult(b.id, { sections, edited: { users: true }, sources: [{ project: 'bp1', branch: 'main', ref: 'refs/heads/main', sha: 'abc' }],
    files: ['a.mjs'], seed: { kind: 'workspace-description' }, model: 'm' }, { by: 'bob' });
  assert.equal(saved.status, 'ready');
  assert.equal(saved.madeBy, 'bob');
  assert.ok(saved.madeAt);
  assert.deepEqual(saved.sections, sections);
  assert.deepEqual(saved.edited, { users: true });
  assert.deepEqual(saved.seed, { kind: 'workspace-description' });
  assert.deepEqual(saved.files, ['a.mjs']);
  assert.equal(usableBrief('project', 'bp1').id, b.id);
  assert.deepEqual(listBriefs().find((x) => x.scopeKey === 'bp1'), { scopeType: 'project', scopeKey: 'bp1', status: 'ready', madeAt: saved.madeAt });
  assert.equal(listMakingBriefs().length, 0);
  // refresh keeps the row, stays usable while making, clears the error
  const again = beginBrief('project', 'bp1');
  assert.equal(again.id, b.id);
  assert.equal(again.status, 'making');
  assert.ok(usableBrief('project', 'bp1'));
});

test('briefs: failBrief returns to ready when it was made, else empty; setBriefSections leaves status alone', () => {
  const a = beginBrief('workspace', 'bw1');
  const f1 = failBrief(a.id, { code: 'TIMEOUT', message: 'slow' });
  assert.equal(f1.status, 'empty');
  assert.equal(f1.error.code, 'TIMEOUT');
  assert.ok(f1.error.at);
  beginBrief('workspace', 'bw1');
  saveBriefResult(a.id, { sections: { product: 'x', users: [], terms: [], areas: [] } });
  beginBrief('workspace', 'bw1');
  const f2 = failBrief(a.id, { code: 'X', message: 'y' });
  assert.equal(f2.status, 'ready');
  const edited = setBriefSections(a.id, { sections: { product: 'mine', users: [], terms: [], areas: [] }, edited: { product: true } }, { by: 'cy' });
  assert.equal(edited.status, 'ready');
  assert.equal(edited.sections.product, 'mine');
  assert.deepEqual(edited.edited, { product: true });
  assert.equal(edited.error.code, 'X');
  addBriefCost(a.id, 0.25);
  addBriefCost(a.id, 0);
  assert.equal(getBrief('workspace', 'bw1').costUsd, 0.25);
  assert.equal(deleteBrief('workspace', 'bw1'), true);
  assert.equal(getBrief('workspace', 'bw1'), null);
  assert.equal(deleteBrief('workspace', 'bw1'), false);
});

test('briefs: getBrief, usableBrief and deleteBrief trim the scope key as beginBrief does', () => {
  const b = beginBrief('project', '  trim-1  ');
  assert.equal(b.scopeKey, 'trim-1');
  assert.equal(getBrief('project', ' trim-1 ').id, b.id);
  saveBriefResult(b.id, { sections: { product: 'p', users: [], terms: [], areas: [] } });
  assert.equal(usableBrief('project', 'trim-1 ').id, b.id);
  assert.equal(deleteBrief('project', ' trim-1'), true);
  assert.equal(getBrief('project', 'trim-1'), null);
});

test('briefUsers counts only rounds naming the current brief id; archived features are left out', () => {
  const b = beginBrief('project', 'bu1');
  saveBriefResult(b.id, { sections: { product: 'x', users: [], terms: [], areas: [] } });
  const f1 = createFeature({ scopeType: 'project', scopeKey: 'bu1', title: 'one', description: 'd' });
  const f2 = createFeature({ scopeType: 'project', scopeKey: 'bu1', title: 'two', description: 'd' });
  const f3 = createFeature({ scopeType: 'project', scopeKey: 'bu1', title: 'three', description: 'd' });
  const f4 = createFeature({ scopeType: 'project', scopeKey: 'bu1', title: 'four', description: 'd' });
  appendTurn(f1.seq, { kind: 'round', payload: { brief: { id: b.id, madeAt: 'x' } } });
  appendTurn(f1.seq, { kind: 'round', payload: { brief: { id: b.id } } });        // counted once
  appendTurn(f2.seq, { kind: 'round', payload: { brief: { id: b.id + 100 } } });   // another (deleted) brief
  appendTurn(f3.seq, { kind: 'round', payload: {} });                              // no brief
  appendTurn(f4.seq, { kind: 'round', payload: { brief: { id: b.id } } });
  updateFeature(f4.seq, { status: 'archived' });
  assert.deepEqual(briefUsers('project', 'bu1'), [{ seq: f1.seq, id: `FEAT-${f1.seq}` }]);
  assert.deepEqual(briefUsers('project', 'no-brief'), []);
});

test('recentBriefCosts: the newest ledger rows with a brief id', () => {
  recordRequirementsCostDelta({ featureSeq: 1, amountUsd: 9 });                 // a feature row is not a brief look
  recordRequirementsCostDelta({ briefId: 1, amountUsd: 0.1 });
  recordRequirementsCostDelta({ briefId: 2, amountUsd: 0.3 });
  assert.deepEqual(recentBriefCosts(2), [0.3, 0.1]);
  assert.deepEqual(recentBriefCosts(), [0.3, 0.1]);
});

test('recentLookCosts: with a model, only the looks made on that model', () => {
  const f = createFeature({ scopeType: 'project', scopeKey: 'st5', title: 'A', description: 'd' });
  appendTurn(f.seq, { kind: 'orientation', model: 'rl-model-x', costUsd: 0.5 });
  appendTurn(f.seq, { kind: 'orientation', model: 'rl-model-y', costUsd: 0.7 });
  appendTurn(f.seq, { kind: 'orientation', model: 'rl-model-x', costUsd: 0.25 });
  appendTurn(f.seq, { kind: 'orientation', model: 'rl-model-x', costUsd: 0 });
  appendTurn(f.seq, { kind: 'round', model: 'rl-model-x', costUsd: 9 });
  assert.deepEqual(recentLookCosts(10, { model: 'rl-model-x' }), [0.25, 0.5]);
  assert.deepEqual(recentLookCosts(1, { model: 'rl-model-x' }), [0.25]);
  assert.deepEqual(recentLookCosts(10, { model: 'rl-model-none' }), []);
  assert.ok(recentLookCosts(10).includes(0.7), 'without a model, every model counts');
});
