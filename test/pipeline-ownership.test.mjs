// test/pipeline-ownership.test.mjs
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { useTempHome } from './helpers/temp-home.mjs';
import { seedPipelineRow } from './helpers/db-seed.mjs';
import { claimPipelineOwnership, touchHeartbeat, clearPipelineOwnership } from '../src/core/artifacts.mjs';
import { getDb } from '../src/core/db.mjs';

useTempHome(after);
const row = (id) => getDb().prepare('SELECT owner_pid, owner_host, heartbeat_at FROM pipelines WHERE id = ?').get(id);

test('claim stamps pid/host/heartbeat on a running row', () => {
  seedPipelineRow({ id: 'own00001', status: 'running' });
  claimPipelineOwnership('own00001', { pid: 4242, host: 'h1', now: Date.parse('2026-06-09T00:00:00Z') });
  const r = row('own00001');
  assert.equal(r.owner_pid, 4242);
  assert.equal(r.owner_host, 'h1');
  assert.equal(r.heartbeat_at, '2026-06-09T00:00:00.000Z');
});

test('claim is a no-op on a terminal row (status guard)', () => {
  seedPipelineRow({ id: 'own00002', status: 'done' });
  claimPipelineOwnership('own00002', { pid: 1 });
  assert.equal(row('own00002').owner_pid, null);
});

test('touchHeartbeat advances only heartbeat_at and only while running/pausing', () => {
  seedPipelineRow({ id: 'own00003', status: 'running' });
  claimPipelineOwnership('own00003', { pid: 7, host: 'h1', now: 1000 });
  assert.equal(touchHeartbeat('own00003', { now: Date.parse('2026-06-09T00:05:00Z') }), 1);
  const r = row('own00003');
  assert.equal(r.owner_pid, 7);                                 // untouched
  assert.equal(r.heartbeat_at, '2026-06-09T00:05:00.000Z');    // advanced
  seedPipelineRow({ id: 'own00004', status: 'done' });
  assert.equal(touchHeartbeat('own00004'), 0);                  // guarded
});

test('clear NULLs all three columns', () => {
  seedPipelineRow({ id: 'own00005', status: 'running' });
  claimPipelineOwnership('own00005', { pid: 9, host: 'h1' });
  clearPipelineOwnership('own00005');
  const r = row('own00005');
  assert.equal(r.owner_pid, null);
  assert.equal(r.owner_host, null);
  assert.equal(r.heartbeat_at, null);
});
