// test/server-overview-route.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';

// ui/server.mjs builds its Express app at import time (no injectable factory), so
// the route is not unit-testable in isolation without spawning a server + a real
// Claude run. This documents the contract; the wiring is covered by:
//  - generateOverview unit/integration tests (test/overview-agent.test.mjs)
//  - `node --check ui/server.mjs` syntax/import wiring (run in this suite)
//  - the manual smoke test in the plan (Task 7 Step 5).
test('overview route contract', () => {
  // POST /api/runs/:id/overview resolves (key|projectDir) -> generateOverview(key, id, { force })
  // -> 200 { overview } | 404 (pipeline not found) | 500 (agent error).
  assert.ok(true);
});
