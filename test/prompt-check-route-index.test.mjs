// test/prompt-check-route-index.test.mjs — the prompt-check route is registered once, in segment 0 (ui/routes/index.mjs).
// ui/server.mjs is imported first: it is the entry of the server ↔ routes import cycle, as in production.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { useTempHome } from './helpers/temp-home.mjs';

useTempHome(after);
process.env.WORCA_MOCK = '1';
after(() => { delete process.env.WORCA_MOCK; });
await import('../ui/server.mjs');
const { ROUTE_SEGMENTS } = await import('../ui/routes/index.mjs');
const gradeRoute = await import('../ui/routes/prompt-check/grade-route.mjs');

test('ROUTE_SEGMENTS[0] lists the grade-route module exactly once; segments 1–4 list it 0 times', () => {
  assert.equal(ROUTE_SEGMENTS.length, 5);
  assert.equal(ROUTE_SEGMENTS[0].filter((m) => m === gradeRoute).length, 1);
  for (let i = 1; i < ROUTE_SEGMENTS.length; i++) assert.equal(ROUTE_SEGMENTS[i].filter((m) => m === gradeRoute).length, 0, `segment ${i}`);
});
