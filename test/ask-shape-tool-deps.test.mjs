// test/ask-shape-tool-deps.test.mjs — the child's Shaper bundle (D4, D5): the gate, a followed thread, the rule over the DB.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { useTempHome } from './helpers/temp-home.mjs';
import { seedPipelineRow } from './helpers/db-seed.mjs';
import { createThread, linkRun } from '../src/core/ask/store.mjs';
import { persistPrState } from '../src/core/artifacts.mjs';
import { defaultShapeToolDeps } from '../src/core/ask/shape-tool-deps.mjs';

useTempHome(after);
const withFlags = (v, fn) => { const prev = process.env.WORCA_FLAGS; process.env.WORCA_FLAGS = v;
  try { return fn(); } finally { if (prev === undefined) delete process.env.WORCA_FLAGS; else process.env.WORCA_FLAGS = prev; } };

test('gate off, or no thread: no bundle (the tools are never listed)', () => {
  const t = createThread();
  withFlags('-shapeFirst', () => assert.deepEqual(defaultShapeToolDeps({ threadId: t.id }), {}));
  withFlags('shapeFirst', () => assert.deepEqual(defaultShapeToolDeps({ threadId: null }), {}));
});

test('a thread with a finished run: follows; propose_changes fits, route_message and a foreign run do not', () => withFlags('shapeFirst', () => {
  const id = 'asd00001';
  seedPipelineRow({ id, projectKey: 'k-asd', status: 'done', title: 'Add a chart', branch: { source: 'dev', feature: 'feat/x' } });
  persistPrState(id, { url: 'https://github.com/o/r/pull/41', number: 41, state: 'OPEN' });
  const bare = createThread();
  assert.equal(defaultShapeToolDeps({ threadId: bare.id }).shapeTools.follows(), false, 'no run link');
  const t = createThread();
  linkRun(t.id, { runId: `run-${id}`, pipelineId: id, cardId: 'card_asd00001' });
  const st = defaultShapeToolDeps({ threadId: t.id }).shapeTools;
  assert.equal(st.follows(), true);
  assert.deepEqual(st.check('changes', { pipelineId: id, request: 'make it blue' }), { ok: true });
  assert.match(st.check('route', { featureId: 'f1', text: 'x', guess: 'add', reason: 'r' }).error, /follows a feature/);
  assert.equal(st.check('changes', { pipelineId: 'beef0001', request: 'x' }).error, 'this chat does not follow run beef0001');
}));
