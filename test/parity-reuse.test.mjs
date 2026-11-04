// test/parity-reuse.test.mjs — the #919 crawl reuse rule: valid while dev is unchanged and the served output is byte-identical.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { servedFingerprint, reuseVerdict, reuseReport } from '../tools/parity/reuse.mjs';

const tree = (css, html) => { const d = mkdtempSync(join(tmpdir(), 'reuse-')); mkdirSync(join(d, 'ui/public'), { recursive: true });
  writeFileSync(join(d, 'ui/public/style.css'), css); writeFileSync(join(d, 'ui/public/index.html'), html); return d; };
const list = (routes) => () => routes;

test('servedFingerprint hashes the served CSS, index.html and the route table of an unsplit tree', async () => {
  const a = await servedFingerprint(tree('a{}', '<p>'), { list: list([['GET', '/api/x']]) });
  const b = await servedFingerprint(tree('a{}', '<p>'), { list: list([['GET', '/api/x']]) });
  assert.deepEqual(a, b); assert.equal(a.routeCount, 1);
  assert.notEqual((await servedFingerprint(tree('a{}', '<p>'), { list: list([['GET', '/api/y'], ['GET', '/api/x']]) })).routes, a.routes);
  assert.notEqual((await servedFingerprint(tree('b{}', '<p>'), { list: list([['GET', '/api/x']]) })).css, a.css);
});

test('reuseVerdict: valid only with the same dev SHA and identical fingerprints on both sides', () => {
  const fp = { css: 'c', html: 'h', routes: 'r' };
  assert.deepEqual(reuseVerdict({ dev: 'd1', a: fp, b: fp }, { dev: 'd1', a: fp, b: fp }), { valid: true, reasons: [] });
  assert.match(reuseVerdict({ dev: 'd1', a: fp, b: fp }, { dev: 'd2', a: fp, b: fp }).reasons[0], /dev moved/);
  assert.match(reuseVerdict({ dev: 'd1', a: fp, b: fp }, { dev: 'd1', a: fp, b: { ...fp, html: 'x' } }).reasons.join(), /b: html differs/);
  assert.match(reuseVerdict({ a: fp, b: fp }, { dev: 'd1', a: fp, b: fp }).reasons[0], /none recorded/, 'an old report without dev never reuses');
});

test('reuseReport: every tree must share one fingerprint and the dev SHA must match the earlier run', async () => {
  const t = tree('a{}', '<p>');
  const ok = await reuseReport({ earlierDev: 'd1', dev: 'd1', trees: [['t1-split', t], ['renamed-split', t]], list: list([]) });
  assert.equal(ok.valid, true);
  const moved = await reuseReport({ earlierDev: 'd1', dev: 'd2', trees: [['a', t]], list: list([]) });
  assert.equal(moved.valid, false);
  const other = await reuseReport({ earlierDev: 'd1', dev: 'd1', trees: [['a', t], ['b', tree('b{}', '<p>')]], list: list([]) });
  assert.match(other.reasons.join(), /css differs/);
});
