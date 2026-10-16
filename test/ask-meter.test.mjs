// test/ask-meter.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as M from '../ui/public/ask-meter.mjs';
import * as P from '../ui/public/ask-panel.mjs';

test('ask-panel re-exports the very same meter functions (one implementation)', () => {
  for (const k of ['fmtTokens', 'fmtWindow', 'ctxTrigger', 'ctxLevel', 'ctxPercent', 'fmtCtx', 'ctxTitle', 'fmtShare', 'ctxBreakdown', 'fmtUsd',
    'CTX_COMPACT_BUFFER', 'CTX_WARN', 'CTX_HIGH', 'CTX_COST_HINT']) assert.equal(P[k], M[k], k);
});

test('meter figures', () => {
  assert.equal(M.fmtWindow(1_000_000), '1M');
  assert.equal(M.ctxTrigger(1_000_000), 967_000);
  assert.equal(M.ctxPercent(120_400, 1_000_000), 12);
  assert.equal(M.fmtCtx(120_400, 1_000_000), '120.4k / 1M ctx');
  assert.equal(M.ctxLevel(900_000, 1_000_000), 'high');
  assert.equal(M.fmtUsd(0), '$0.00');
  assert.equal(M.kTok(950), '950');
});
