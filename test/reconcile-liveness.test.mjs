// test/reconcile-liveness.test.mjs
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { useTempHome } from './helpers/temp-home.mjs';
import { seedPipelineRow } from './helpers/db-seed.mjs';
import { reconcileStaleRunning, isDeadOwner, INTERRUPTED_STATUS } from '../src/core/artifacts.mjs';
import { getDb } from '../src/core/db.mjs';

useTempHome(after);
const NOW = Date.parse('2026-06-09T12:00:00.000Z');
const iso = (ms) => new Date(ms).toISOString();
const FRESH = iso(NOW - 10 * 1000);            // 10s ago
const HB_STALE = iso(NOW - 5 * 60 * 1000);     // 5m ago (> 90s heartbeat window)
const statusOf = (id) => getDb().prepare('SELECT status FROM pipelines WHERE id = ?').get(id)?.status;
const HOST = 'thisbox';
// Stubbed pidAlive: pid 9999 is always dead; any other pid is "alive" (could be reused).
const pidAlive = (pid) => pid !== 9999;

test('dead pid on THIS host is reaped immediately even with a fresh row (Arm 1)', () => {
  seedPipelineRow({ id: 'live0001', status: 'running', startedAt: FRESH, updatedAt: FRESH,
    ownerPid: 9999, ownerHost: HOST, heartbeatAt: FRESH });
  const r = reconcileStaleRunning({ host: HOST, now: NOW, pidAlive });
  assert.ok(r.ids.includes('live0001'));
  assert.equal(statusOf('live0001'), INTERRUPTED_STATUS);
});

test('live pid on THIS host with a fresh heartbeat is kept (Arm 1 miss + Arm 2 miss)', () => {
  seedPipelineRow({ id: 'live0002', status: 'running', startedAt: FRESH, updatedAt: FRESH,
    ownerPid: 12345, ownerHost: HOST, heartbeatAt: FRESH });
  const r = reconcileStaleRunning({ host: HOST, now: NOW, pidAlive });
  assert.ok(!r.ids.includes('live0002'));
  assert.equal(statusOf('live0002'), 'running');
});

test('live pid on THIS host with STALE heartbeat is reaped (Arm 2 — PID reuse scenario)', () => {
  seedPipelineRow({ id: 'live0007', status: 'running', startedAt: FRESH, updatedAt: FRESH,
    ownerPid: 12345, ownerHost: HOST, heartbeatAt: HB_STALE });
  const r = reconcileStaleRunning({ host: HOST, now: NOW, pidAlive });
  assert.ok(r.ids.includes('live0007'), 'stale heartbeat reaps even with live pid (PID reuse)');
  assert.equal(statusOf('live0007'), INTERRUPTED_STATUS);
});

test('fresh heartbeat on ANOTHER host is kept (never PID-probed, Arm 2 miss)', () => {
  seedPipelineRow({ id: 'live0003', status: 'running', startedAt: FRESH, updatedAt: FRESH,
    ownerPid: 9999, ownerHost: 'otherbox', heartbeatAt: FRESH });
  assert.ok(!reconcileStaleRunning({ host: HOST, now: NOW, pidAlive }).ids.includes('live0003'));
});

test('stale heartbeat on ANOTHER host is reaped (Arm 2)', () => {
  seedPipelineRow({ id: 'live0004', status: 'running', startedAt: FRESH, updatedAt: FRESH,
    ownerPid: 12345, ownerHost: 'otherbox', heartbeatAt: HB_STALE });
  assert.ok(reconcileStaleRunning({ host: HOST, now: NOW, pidAlive }).ids.includes('live0004'));
});

test('reaped row has its owner columns NULLed', () => {
  seedPipelineRow({ id: 'live0005', status: 'running', startedAt: FRESH, updatedAt: FRESH,
    ownerPid: 9999, ownerHost: HOST, heartbeatAt: HB_STALE });
  reconcileStaleRunning({ host: HOST, now: NOW, pidAlive });
  const r = getDb().prepare('SELECT owner_pid, owner_host, heartbeat_at FROM pipelines WHERE id = ?').get('live0005');
  assert.equal(r.owner_pid, null);
  assert.equal(r.owner_host, null);
  assert.equal(r.heartbeat_at, null);
});

test('legacy ownerless old row still swept by the 30-min time arm (Arm 3)', () => {
  seedPipelineRow({ id: 'live0006', status: 'running',
    startedAt: iso(NOW - 60 * 60 * 1000), updatedAt: iso(NOW - 60 * 60 * 1000) });
  assert.ok(reconcileStaleRunning({ host: HOST, now: NOW, pidAlive }).ids.includes('live0006'));
});

// Direct unit tests for isDeadOwner arms (no DB needed)
const BASE = { owner_pid: null, owner_host: null, heartbeat_at: null, updated_at: null, started_at: null };
const ctx = { host: HOST, now: NOW, staleMs: 30 * 60 * 1000, hbStaleMs: 90 * 1000, pidAlive };

test('isDeadOwner: Arm 1 triggers on dead same-host pid', () => {
  assert.equal(isDeadOwner({ ...BASE, owner_pid: 9999, owner_host: HOST, heartbeat_at: FRESH }, ctx), true);
});
test('isDeadOwner: Arm 2 triggers on stale heartbeat (any host)', () => {
  assert.equal(isDeadOwner({ ...BASE, owner_pid: 12345, owner_host: HOST, heartbeat_at: HB_STALE }, ctx), true);
  assert.equal(isDeadOwner({ ...BASE, owner_pid: 1, owner_host: 'other', heartbeat_at: HB_STALE }, ctx), true);
});
test('isDeadOwner: Arm 3 triggers on old ownerless row', () => {
  assert.equal(isDeadOwner({ ...BASE, updated_at: iso(NOW - 2 * 60 * 60 * 1000) }, ctx), true);
});
test('isDeadOwner: NULL-timestamp ownerless row never reaped', () => {
  assert.equal(isDeadOwner(BASE, ctx), false);
});
