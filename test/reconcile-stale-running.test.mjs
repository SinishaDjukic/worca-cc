// test/reconcile-stale-running.test.mjs
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { useTempHome } from './helpers/temp-home.mjs';
import { seedPipelineRow } from './helpers/db-seed.mjs';
import { reconcileStaleRunning, INTERRUPTED_STATUS } from '../src/core/artifacts.mjs';
import { getDb } from '../src/core/db.mjs';

useTempHome(after); // one isolated DB for the whole file; tests use distinct ids

const NOW = Date.parse('2026-06-09T12:00:00.000Z');
const iso = (ms) => new Date(ms).toISOString();
const OLD = iso(NOW - 60 * 60 * 1000);   // 1h ago  -> stale (> 30 min default)
const FRESH = iso(NOW - 10 * 1000);      // 10s ago -> live
const statusOf = (id) => getDb().prepare('SELECT status FROM pipelines WHERE id = ?').get(id)?.status;

test('flips an old running row to interrupted', () => {
  seedPipelineRow({ id: 'aaaa0001', status: 'running', startedAt: OLD, updatedAt: OLD });
  const r = reconcileStaleRunning({ now: NOW });
  assert.ok(r.ids.includes('aaaa0001'));
  assert.equal(statusOf('aaaa0001'), INTERRUPTED_STATUS); // 'interrupted'
});

test('sweeps old created and starting rows too', () => {
  seedPipelineRow({ id: 'aaaa0006', status: 'created',  startedAt: OLD, updatedAt: OLD });
  seedPipelineRow({ id: 'aaaa0007', status: 'starting', startedAt: OLD, updatedAt: OLD });
  const r = reconcileStaleRunning({ now: NOW });
  assert.ok(r.ids.includes('aaaa0006') && r.ids.includes('aaaa0007'));
  assert.equal(statusOf('aaaa0006'), INTERRUPTED_STATUS);
  assert.equal(statusOf('aaaa0007'), INTERRUPTED_STATUS);
});

test('leaves a fresh running row alone', () => {
  seedPipelineRow({ id: 'aaaa0002', status: 'running', startedAt: FRESH, updatedAt: FRESH });
  const r = reconcileStaleRunning({ now: NOW });
  assert.ok(!r.ids.includes('aaaa0002'));
  assert.equal(statusOf('aaaa0002'), 'running');
});

test('never touches a run live in THIS process (liveIds)', () => {
  seedPipelineRow({ id: 'aaaa0003', status: 'running', startedAt: OLD, updatedAt: OLD });
  const r = reconcileStaleRunning({ now: NOW, liveIds: ['aaaa0003'] });
  assert.ok(!r.ids.includes('aaaa0003'));
  assert.equal(statusOf('aaaa0003'), 'running');
});

test('leaves a terminal (done) row untouched', () => {
  seedPipelineRow({ id: 'aaaa0004', status: 'done', startedAt: OLD, updatedAt: OLD });
  const r = reconcileStaleRunning({ now: NOW });
  assert.ok(!r.ids.includes('aaaa0004'));
  assert.equal(statusOf('aaaa0004'), 'done');
});

test('skips a timestamp-less non-terminal row (NULL coalesce is never < cutoff)', () => {
  // started_at omitted -> updated_at defaults to startedAt (null) -> COALESCE is NULL.
  seedPipelineRow({ id: 'aaaa0009', status: 'running' });
  const r = reconcileStaleRunning({ now: NOW });
  assert.ok(!r.ids.includes('aaaa0009'));
  assert.equal(statusOf('aaaa0009'), 'running'); // conservative no-clobber
});

test('is idempotent: a second pass does not re-report an already-interrupted id', () => {
  seedPipelineRow({ id: 'aaaa0005', status: 'running', startedAt: OLD, updatedAt: OLD });
  const first = reconcileStaleRunning({ now: NOW });
  assert.ok(first.ids.includes('aaaa0005'));            // flipped on the first pass
  const second = reconcileStaleRunning({ now: NOW });
  assert.ok(!second.ids.includes('aaaa0005'));          // already terminal -> not re-flipped
  assert.equal(statusOf('aaaa0005'), INTERRUPTED_STATUS);
});

test('sweeps stale pausing to interrupted, but never touches paused', () => {
  seedPipelineRow({ id: 'aaaapaus', status: 'paused', startedAt: OLD, updatedAt: OLD });
  seedPipelineRow({ id: 'aaaapsng', status: 'pausing', startedAt: OLD, updatedAt: OLD });
  const r = reconcileStaleRunning({ now: NOW });
  assert.ok(r.ids.includes('aaaapsng'), 'stale pausing swept to interrupted');
  assert.ok(!r.ids.includes('aaaapaus'), 'paused untouched');
  assert.equal(statusOf('aaaapsng'), INTERRUPTED_STATUS);
  assert.equal(statusOf('aaaapaus'), 'paused');
});

test('return shape is { reconciled, ids } with reconciled === ids.length', () => {
  seedPipelineRow({ id: 'aaaa0008', status: 'running', startedAt: OLD, updatedAt: OLD });
  const r = reconcileStaleRunning({ now: NOW });
  assert.equal(typeof r.reconciled, 'number');
  assert.ok(Array.isArray(r.ids));
  assert.equal(r.reconciled, r.ids.length);
});
