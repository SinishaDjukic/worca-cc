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

test('ROUTE_SEGMENTS[0] lists the correction-route module once, after the grade route; segments 1–4 list it 0 times', async () => {
  const corr = await import('../ui/routes/prompt-check/correction-route.mjs');
  assert.equal(ROUTE_SEGMENTS[0].filter((m) => m === corr).length, 1);
  assert.ok(ROUTE_SEGMENTS[0].indexOf(corr) > ROUTE_SEGMENTS[0].indexOf(gradeRoute));
  for (let i = 1; i < ROUTE_SEGMENTS.length; i++) assert.equal(ROUTE_SEGMENTS[i].filter((m) => m === corr).length, 0, `segment ${i}`);
});

test('ROUTE_SEGMENTS[0] lists the improve-route module once, after the correction route; segments 1–4 list it 0 times', async () => {
  const corr = await import('../ui/routes/prompt-check/correction-route.mjs');
  const imp = await import('../ui/routes/prompt-check/improve-route.mjs');
  assert.equal(ROUTE_SEGMENTS[0].filter((m) => m === imp).length, 1);
  assert.ok(ROUTE_SEGMENTS[0].indexOf(imp) > ROUTE_SEGMENTS[0].indexOf(corr));
  for (let i = 1; i < ROUTE_SEGMENTS.length; i++) assert.equal(ROUTE_SEGMENTS[i].filter((m) => m === imp).length, 0, `segment ${i}`);
});
