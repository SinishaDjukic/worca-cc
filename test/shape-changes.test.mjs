// test/shape-changes.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { changesCard, applyChanges, routeCard, applyRoute, replyAction } from '../src/core/shape/changes.mjs';

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
  const rc = routeCard({ text: 'hotfix: login', feature: { id: 'f1', title: 'Charts', base: 'dev', projectDir: '/p', tags: ['client:acme'], slices: [{ index: 1, state: 'planned' }] } });
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
  const card = routeCard({ text: 'smaller legend', feature });
  assert.equal(card.type, 'route');
  for (const v of [{ verb: 'add', where: 'next' }, { verb: 'add', where: 'extra' }, { verb: 'own' }, { verb: 'save' }]) await applyRoute(card, v, deps);
  assert.deepEqual(calls, [['note', 'plan'], ['append', 'extra'], ['start', 'dev', null, 0], ['note', 'idea']]);
});

test('next plan applied after the next run started: 409, never "Run null"', async () => {
  const deps = { addNote: () => ({ id: null, runIndex: null }) };   // addFeatureNote: no run left to plan, nothing stored
  const feature = { id: 'f1', title: 'Charts', base: 'dev', projectDir: '/p', slices: [{ index: 1, state: 'done' }, { index: 2, state: 'planned' }] };
  const stale = routeCard({ text: 'smaller legend', feature });
  assert.equal(stale.hasNext, true);
  assert.deepEqual(await applyRoute(stale, { verb: 'add', where: 'next' }, deps),
    { ok: false, status: 409, error: 'no run is left to plan: add it as an extra run' });
  const np = changesCard({ text: 'smaller legend', facts: { feature: { ...feature, shipPr: null, slices: [{ index: 1, state: 'running' }, { index: 2, state: 'planned' }] } } });
  assert.equal(np.landing.kind, 'next-plan');
  assert.deepEqual(await applyChanges(np, deps), { ok: false, status: 409, error: 'no run is left to plan: add it as an extra run' });
});

test('reply: an open revisable plan step is answered (as the person, no source) and no card is made', () => {
  const answered = [];
  const deps = { answer: (runId, id, payload) => answered.push([runId, id, payload]) };
  const open = { runId: 'run-2', pq: { id: 'plan-n_refine-1', kind: 'plan', plan: { revisable: true } } };
  assert.deepEqual(replyAction({ text: 'shorter', open, feature: null, run: null }, deps), { action: 'answered', stepId: 'plan-n_refine-1' });
  assert.deepEqual(answered[0], ['run-2', 'plan-n_refine-1', { decision: 'revise', feedback: 'shorter' }]);
  const split = { runId: 'run-1', pq: { id: 'plan-outline-n_plan-1', kind: 'plan', plan: { port: 'outline', revisable: true } } };
  assert.equal(replyAction({ text: 'fewer runs', open: split, feature: null, run: null }, deps).action, 'answered');
});

test('reply: questions, gates, running plain runs and bare threads go to chat; otherwise route / changes', () => {
  const deps = { answer: () => { throw new Error('must not answer'); } };
  const open = { runId: 'run-2', pq: { id: 'plan-1', kind: 'plan', plan: { revisable: true } } };
  assert.equal(replyAction({ text: 'why so long?', open, feature: null, run: null }, deps).action, 'chat');
  const gate = { runId: 'run-2', pq: { id: 'gate-1', kind: 'gate' } };
  assert.equal(replyAction({ text: 'x', open: gate, feature: null, run: null }, deps).action, 'chat');
  const active = { id: 'f1', title: 'Charts', status: 'active', slices: [{ index: 1, state: 'done' }, { index: 2, state: 'running' }] };
  assert.equal(replyAction({ text: 'an idea', open: null, feature: active, run: null }, deps).action, 'route');
  assert.equal(replyAction({ text: 'what does run 2 do?', open: null, feature: active, run: null }, deps).action, 'chat');
  const done = { ...active, status: 'done', slices: [{ index: 1, state: 'done' }, { index: 2, state: 'done' }] };
  assert.equal(replyAction({ text: 'one more change', open: null, feature: done, run: null }, deps).action, 'changes');
  assert.equal(replyAction({ text: 'make it blue', open: null, feature: null, run: RUN }, deps).action, 'changes');
  assert.equal(replyAction({ text: 'make it blue', open: null, feature: null, run: { ...RUN, finished: false } }, deps).action, 'chat');
  assert.equal(replyAction({ text: 'hi', open: null, feature: null, run: null }, deps).action, 'chat');
});
