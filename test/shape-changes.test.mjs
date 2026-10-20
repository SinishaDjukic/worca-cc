// test/shape-changes.test.mjs
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { changesCard, applyChanges, routeCard, applyRoute, shapeToolFit, shapeThreadFacts, threadWork } from '../src/core/shape/changes.mjs';
import { checkRows } from './helpers/rows.mjs';
import { useTempHome } from './helpers/temp-home.mjs';

useTempHome(after);   // shapeToolFit resolves a route_message featureId through currentFeatureId (a re-planned feature's successor)

const RUN = { pipelineId: 'aaaa0002', title: 'Add a chart', projectDir: '/p', finished: true,
  branch: { source: 'dev', feature: 'worca/charts-2' }, pr: { number: 41, url: 'https://x/pull/41', state: 'OPEN' }, rounds: 1 };

test('the round card carries the same branch and the same PR; Start starts the round with the marker', async () => {
  const card = changesCard({ text: 'make it blue', facts: { run: RUN, feature: null } });
  assert.equal(card.type, 'changes');
  assert.equal(card.landing.kind, 'round');
  assert.equal(card.run.sourceBranch, 'worca/charts-2');
  assert.equal(card.run.sameAsSource, true);
  assert.equal(card.landing.target.pr.number, 41);
  const started = [];
  const r = await applyChanges(card, { startRun: async (body, extra) => { started.push({ body, extra }); return { status: 202, body: { runId: 'run-9' } }; } });
  assert.deepEqual(r, { ok: true, result: { runId: 'run-9', round: 2, pr: 41 } });
  assert.equal(started[0].body.sourceBranch, 'worca/charts-2');
  assert.equal(started[0].body.syncBeforeStart, false);
  assert.equal('shape' in started[0].body, false);
  assert.deepEqual(started[0].extra, { _roundOf: { pipelineId: 'aaaa0002', round: 2, request: 'make it blue' } });
});

test('the round number is read at Start: a fix round that ran since the card was posted moves it on', async () => {
  const card = changesCard({ text: 'make it blue', facts: { run: RUN, feature: null } });
  const started = [];
  const r = await applyChanges(card, { nextRound: (o) => (o === 'aaaa0002' ? 3 : 0),
    startRun: async (body, extra) => { started.push(extra); return { status: 202, body: { runId: 'run-9' } }; } });
  assert.equal(r.result.round, 3);
  assert.equal(started[0]._roundOf.round, 3);
});

test('D19: the round and Own run now carry the origin\'s tags; no tags → no tags field', async () => {
  const card = changesCard({ text: 'x', facts: { run: { ...RUN, tags: ['client:acme'] }, feature: null } });
  assert.deepEqual(card.run.tags, ['client:acme']);
  assert.equal('tags' in changesCard({ text: 'x', facts: { run: RUN, feature: null } }).run, false);
  const bodies = [];
  const rc = routeCard({ text: 'hotfix: login', feature: { id: 'f1', title: 'Charts', base: 'dev', projectDir: '/p', tags: ['client:acme'], slices: [{ index: 1, state: 'planned' }] }, guess: { choice: 'own', reason: 'a fix' } });
  await applyRoute(rc, { verb: 'own' }, { startRun: async (b) => { bodies.push(b); return { status: 200, body: { runId: 'r' } }; } });
  assert.deepEqual(bodies[0].tags, ['client:acme']);
});

test('a refused start keeps the card proposed: the error comes back', async () => {
  const card = changesCard({ text: 'x', facts: { run: RUN, feature: null } });
  const r = await applyChanges(card, { startRun: async () => ({ status: 409, body: { error: 'branch in use' } }) });
  assert.deepEqual(r, { ok: false, status: 409, error: 'branch in use' });
});

test('next-plan Start stores a plan note on the run; follow-up Start appends a run from dev', async () => {
  const notes = []; const appended = [];
  const deps = { addNote: (id, n) => { notes.push([id, n]); return { runIndex: 3 }; },
    appendRun: (id, o) => { appended.push([id, o]); return { index: 3, ticketId: 't3' }; }, tick: () => {} };
  const np = changesCard({ text: 'smaller legend', facts: { feature: { id: 'f1', title: 'Charts', base: 'dev', shipPr: null,
    slices: [{ index: 1, state: 'done' }, { index: 2, state: 'running' }, { index: 3, state: 'planned' }] } } });
  assert.equal('run' in np, false, 'next-plan sends no run body');
  assert.deepEqual(await applyChanges(np, deps), { ok: true, result: { note: 'plan', index: 3 } });
  assert.deepEqual(notes[0], ['f1', { kind: 'plan', text: 'smaller legend' }]);
  const merged = { state: 'MERGED', url: 'u', number: 9 };
  const fu = changesCard({ text: 'blue bars', facts: { feature: { id: 'f1', title: 'Charts', base: 'dev', shipPr: merged,
    slices: [{ index: 1, state: 'done' }, { index: 2, state: 'done', pr: merged }] } } });
  assert.deepEqual(await applyChanges(fu, deps), { ok: true, result: { index: 3, ticketId: 't3' } });
  assert.equal(appended[0][1].kind, 'follow-up');
});

test('route: add/next → plan note; add/extra → appended run; own → a run from dev with its own PR; save → idea note', async () => {
  const calls = [];
  const deps = { addNote: (id, n) => { calls.push(['note', n.kind]); return { runIndex: 3 }; },
    appendRun: (id, o) => { calls.push(['append', o.kind]); return { index: 4, ticketId: 't4' }; },
    startRun: async (body, extra) => { calls.push(['start', body.sourceBranch, body.sameAsSource ?? null, Object.keys(extra).length]); return { status: 202, body: { runId: 'run-7' } }; },
    tick: () => {} };
  const feature = { id: 'f1', title: 'Charts', base: 'dev', projectDir: '/p', slices: [{ index: 1, state: 'done' }, { index: 2, state: 'planned' }] };
  const card = routeCard({ text: 'smaller legend', feature, guess: { choice: 'add', reason: 'x' } });
  assert.equal(card.type, 'route');
  for (const v of [{ verb: 'add', where: 'next' }, { verb: 'add', where: 'extra' }, { verb: 'own' }, { verb: 'save' }]) await applyRoute(card, v, deps);
  assert.deepEqual(calls, [['note', 'plan'], ['append', 'extra'], ['start', 'dev', null, 0], ['note', 'idea']]);
});

test('next plan applied after the next run started: 409, never "Run null"', async () => {
  const deps = { addNote: () => ({ id: null, runIndex: null }) };   // addFeatureNote: no run left to plan, nothing stored
  const feature = { id: 'f1', title: 'Charts', base: 'dev', projectDir: '/p', slices: [{ index: 1, state: 'done' }, { index: 2, state: 'planned' }] };
  const stale = routeCard({ text: 'smaller legend', feature, guess: { choice: 'add', reason: 'x' } });
  assert.equal(stale.hasNext, true);
  assert.deepEqual(await applyRoute(stale, { verb: 'add', where: 'next' }, deps),
    { ok: false, status: 409, error: 'no run is left to plan: add it as an extra run' });
  const np = changesCard({ text: 'smaller legend', facts: { feature: { ...feature, shipPr: null, slices: [{ index: 1, state: 'running' }, { index: 2, state: 'planned' }] } } });
  assert.equal(np.landing.kind, 'next-plan');
  assert.deepEqual(await applyChanges(np, deps), { ok: false, status: 409, error: 'no run is left to plan: add it as an extra run' });
});

const FEATURE = (status, states) => ({ id: 'f1', title: 'Charts', status, slices: states.map((state, i) => ({ index: i + 1, state, title: `Part ${i + 1}` })) });
const featWork = (status, states, open = null) => {
  const feature = FEATURE(status, states);
  return { feature, run: null, open, facts: { run: null, feature: { id: 'f1', title: 'Charts', status, base: 'dev', projectDir: '/p', tags: [], shipPr: null,
    slices: feature.slices.map((s) => ({ ...s, branch: { source: 'dev', feature: `feat/${s.index}` }, pr: null, rounds: 1 })) } } };
};
const runWork = (over = {}) => ({ feature: null, run: { ...RUN, ...over }, open: null, facts: { feature: null, run: { ...RUN, ...over } } });
const ROUTE_IN = { featureId: 'f1', text: 'also export a PNG', guess: 'add', reason: 'run 2 still to plan' };

test('tools: a finished plain run takes propose_changes (the same round card /reply posted); route_message is refused', () => {
  const r = shapeToolFit('changes', { pipelineId: 'aaaa0002', request: 'make it blue' }, runWork());
  assert.equal(r.ok, true);
  assert.deepEqual(r.card, changesCard({ text: 'make it blue', facts: { run: RUN, feature: null } }));
  assert.equal(r.card.landing.title, 'Changes to Add a chart · same branch, same PR');
  assert.match(shapeToolFit('route', ROUTE_IN, runWork()).error, /follows a feature/);
  assert.equal(shapeToolFit('changes', { pipelineId: 'aaaa0002', request: 'x' }, runWork({ finished: false })).error, 'the run is still going');
});

test('tools: an active feature with runs to go takes route_message with the model\'s guess; propose_changes is refused', () => {
  const w = featWork('active', ['done', 'planned']);
  const r = shapeToolFit('route', ROUTE_IN, w);
  assert.equal(r.ok, true);
  assert.deepEqual(r.card.guess, { choice: 'add', where: 'next', reason: 'run 2 still to plan' });
  assert.equal(r.card.primary, 'Add to Charts');
  assert.equal(r.card.base, 'dev');
  assert.equal(shapeToolFit('changes', { pipelineId: 'p1', request: 'x' }, w).error, 'Charts still has runs to go: use route_message');
  assert.deepEqual(shapeToolFit('route', { ...ROUTE_IN, guess: 'own', reason: 'a fix\nthat cannot wait' }, w).card.guess,
    { choice: 'own', where: null, reason: 'a fix that cannot wait' });
});

test('tools: a done feature takes propose_changes (round before Ship); route_message is refused', () => {
  const w = featWork('done', ['done', 'done']);
  const r = shapeToolFit('changes', { pipelineId: 'p2', request: 'smaller legend' }, w);
  assert.equal(r.ok, true);
  assert.equal(r.card.landing.kind, 'round');
  assert.match(r.card.landing.title, /before Ship/);
  assert.equal(shapeToolFit('route', ROUTE_IN, w).error, 'Charts has no runs to go: use propose_changes');
});

test('tools: an open Plan/Split step takes neither tool (it is answered on its step card)', () => {
  const w = featWork('active', ['running', 'planned'], { index: 1, kind: 'plan' });
  for (const [kind, input] of [['route', ROUTE_IN], ['changes', { pipelineId: 'p1', request: 'shorter' }]]) {
    const r = shapeToolFit(kind, input, w);
    assert.equal(r.ok, false, kind);
    assert.match(r.error, /Run 1 is waiting at its Plan step/);
  }
  assert.match(shapeToolFit('route', ROUTE_IN, featWork('active', ['running', 'planned'], { index: 1, kind: 'outline' })).error, /Split step/);
});

test('tools: ids, the guess and the text are checked', async () => {
  const w = featWork('active', ['done', 'planned']);
  await checkRows([
    { name: 'another feature', run: () => assert.equal(shapeToolFit('route', { ...ROUTE_IN, featureId: 'f9' }, w).error, 'this chat follows feature f1') },
    { name: 'guess outside the choices', run: () => assert.equal(shapeToolFit('route', { ...ROUTE_IN, guess: 'ship' }, w).error, 'guess must be add, own or save') },
    { name: 'no reason', run: () => assert.equal(shapeToolFit('route', { ...ROUTE_IN, reason: '  ' }, w).error, 'reason is required') },
    { name: 'no text', run: () => assert.equal(shapeToolFit('changes', { pipelineId: 'p', request: '' }, runWork()).error, 'request is required') },
    { name: 'too long', run: () => assert.match(shapeToolFit('changes', { pipelineId: 'p', request: 'x'.repeat(4001) }, runWork()).error, /at most 4000/) },
    { name: 'follows nothing', run: () => assert.equal(shapeToolFit('changes', { pipelineId: 'p', request: 'x' }, null).error, 'this chat follows no run or feature') },
  ]);
});

test('context facts: a feature names each run, the next one and the open step; a plain run its status, PR and rounds', () => {
  const f = shapeThreadFacts(featWork('active', ['done', 'running', 'planned'], { index: 2, kind: 'plan' }));
  assert.deepEqual(f.feature.runs.map((r) => [r.index, r.state]), [[1, 'done'], [2, 'running'], [3, 'planned']]);
  assert.equal(f.feature.next, 3);
  assert.deepEqual(f.feature.open, { index: 2, step: 'Plan' });
  const r = shapeThreadFacts(runWork({ status: 'done' }));
  assert.deepEqual(r.run, { id: 'aaaa0002', title: 'Add a chart', status: 'done', finished: true, pr: { number: 41, state: 'open' }, rounds: 1 });
  assert.equal(shapeThreadFacts(null), null);
});

test('s2: a round and Own run now carry the origin\'s tags and labels; none → no fields', async () => {
  const card = changesCard({ text: 'x', facts: { run: { ...RUN, tags: ['client:acme'], labels: ['hotfix'] }, feature: null } });
  assert.deepEqual([card.run.tags, card.run.labels], [['client:acme'], ['hotfix']]);
  const bare = changesCard({ text: 'x', facts: { run: { ...RUN }, feature: null } });
  assert.equal(Object.hasOwn(bare.run, 'labels'), false);
  const route = routeCard({ text: 'own it', feature: { id: 'f1', title: 'F', projectDir: '/p', tags: ['client:acme'], labels: ['hotfix'], slices: [] },
    guess: { choice: 'own' } });
  let sent = null;
  await applyRoute(route, { verb: 'own' }, { startRun: async (b) => { sent = b; return { status: 200, body: { runId: 'r1' } }; } });
  assert.deepEqual([sent.tags, sent.labels], [['client:acme'], ['hotfix']]);
});

test('s2: threadWork hands readRunLabels to its fact deps, so a route or tool card sees the run\'s labels', () => {
  const deps = { findPipelineRowById: (id) => ({ id, target: 'project', status: 'done', title: 't', project_key: 'nope', branch: null }),
    readPrState: () => null, readRunTags: () => ['client:acme'], readRunLabels: () => ['hotfix'] };
  const work = threadWork([{ pipelineId: 'tw000001' }], deps);
  assert.deepEqual([work.run.tags, work.run.labels], [['client:acme'], ['hotfix']]);
});
