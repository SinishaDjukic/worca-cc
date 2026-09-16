// test/metrics-auto-home.test.mjs
// autoMetricsHome: the create wizard no longer asks for a metrics home; POST /api/workspaces
// adopts the ONE member that already records, and leaves it unset in every other case.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { autoMetricsHome } from '../src/core/metrics/sync.mjs';

const m = (path, o = {}) => ({ path, hasOrigin: true, recordsLocally: true, error: null, ...o });
const scanOf = (members) => async () => ({ members });

test('exactly one recording member → that member', async () => {
  assert.equal(await autoMetricsHome(['/a', '/b'], { scan: scanOf([m('/a'), m('/b', { recordsLocally: false })]) }), '/a');
});

test('none or several recording members → null (the card\'s Choose… decides)', async () => {
  assert.equal(await autoMetricsHome(['/a', '/b'], { scan: scanOf([m('/a', { recordsLocally: false }), m('/b', { recordsLocally: false })]) }), null);
  assert.equal(await autoMetricsHome(['/a', '/b'], { scan: scanOf([m('/a'), m('/b')]) }), null);
});

test('a member without origin, with a discovery error, or a scan that throws never yields a home', async () => {
  assert.equal(await autoMetricsHome(['/a'], { scan: scanOf([m('/a', { hasOrigin: false })]) }), null);
  assert.equal(await autoMetricsHome(['/a'], { scan: scanOf([m('/a', { error: 'could not read this repository' })]) }), null);
  assert.equal(await autoMetricsHome(['/a', '/nogit'], { scan: async () => { throw Object.assign(new Error('member is not a git repository'), { code: 'BAD_REQUEST' }); } }), null);
});
