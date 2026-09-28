// test/metrics-ledger.test.mjs — per-run team-metrics status ledger (plan §5.3).
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync, mkdirSync, utimesSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { useTempHome } from './helpers/temp-home.mjs';
import { worcaHome } from '../src/core/projects.mjs';
import {
  ledgerFile, writeRunLedger, readRunLedger, sweepRunLedger, LEDGER_RETENTION_MS,
} from '../src/core/metrics/ledger.mjs';

useTempHome(after);

test('ledgerFile resolves under worcaHome()/metrics/ledger/', () => {
  const file = ledgerFile('run-123');
  assert.equal(file, join(worcaHome(), 'metrics', 'ledger', 'run-123.json'));
});

test('ledgerFile throws RangeError for a runId failing the id pattern', () => {
  assert.throws(() => ledgerFile('../escape'), RangeError);
  assert.throws(() => ledgerFile(''), RangeError);
  assert.throws(() => ledgerFile('a'.repeat(65)), RangeError);
});

test('writeRunLedger then readRunLedger round-trips the entry and stamps at', () => {
  writeRunLedger('run-abc', { state: 'recorded', slug: 'team/2026-01' });
  const entry = readRunLedger('run-abc');
  assert.equal(entry.state, 'recorded');
  assert.equal(entry.slug, 'team/2026-01');
  assert.equal(typeof entry.at, 'string');
  assert.ok(!Number.isNaN(Date.parse(entry.at)));
});

test('readRunLedger on an unknown id returns not-enabled', () => {
  assert.deepEqual(readRunLedger('never-written'), { state: 'not-enabled' });
});

test('readRunLedger on a corrupt/unparseable file returns not-enabled rather than throwing', () => {
  const file = ledgerFile('corrupt-run');
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, 'not json{{{', 'utf8');
  assert.deepEqual(readRunLedger('corrupt-run'), { state: 'not-enabled' });
});

test('LEDGER_RETENTION_MS is 180 days', () => {
  assert.equal(LEDGER_RETENTION_MS, 180 * 24 * 60 * 60_000);
});

test('sweepRunLedger drops entries older than the cutoff and returns the count dropped', () => {
  writeRunLedger('run-old', { state: 'skipped', reason: 'stale' });
  writeRunLedger('run-fresh', { state: 'pending' });
  const now = Date.now();
  const old = now - LEDGER_RETENTION_MS - 1000;
  utimesSync(ledgerFile('run-old'), old / 1000, old / 1000);

  const dropped = sweepRunLedger({ now });
  assert.equal(dropped, 1);
  assert.deepEqual(readRunLedger('run-old'), { state: 'not-enabled' });
  assert.equal(readRunLedger('run-fresh').state, 'pending');
});
