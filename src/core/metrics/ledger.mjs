// src/core/metrics/ledger.mjs
// Per-run team-metrics status for the History header (§4.11): pending | recorded | skipped.
import { readFileSync, writeFileSync, renameSync, mkdirSync, readdirSync, statSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { worcaHome } from '../projects.mjs';

const RUN_ID_RE = /^[A-Za-z0-9._-]{1,64}$/;

export function ledgerFile(runId) {
  if (!RUN_ID_RE.test(String(runId))) throw new RangeError(`bad run id: ${runId}`);
  return join(worcaHome(), 'metrics', 'ledger', `${runId}.json`);
}

export function writeRunLedger(runId, entry) {
  const file = ledgerFile(runId);
  mkdirSync(join(file, '..'), { recursive: true });
  const tmp = `${file}.${randomBytes(4).toString('hex')}.tmp`;
  writeFileSync(tmp, JSON.stringify({ ...entry, at: new Date().toISOString() }) + '\n', 'utf8');
  renameSync(tmp, file);
}

/** @returns {{state:'recorded'|'pending'|'skipped'|'not-enabled', slug?:string, reason?:string, detail?:string}} */
export function readRunLedger(runId) {
  try {
    const v = JSON.parse(readFileSync(ledgerFile(runId), 'utf8'));
    if (v && ['recorded', 'pending', 'skipped'].includes(v.state)) return v;
  } catch { /* absent or unreadable */ }
  return { state: 'not-enabled' };
}

export const LEDGER_RETENTION_MS = 180 * 24 * 60 * 60_000;

/** One file per run, forever, is a leak (§4.11 only needs the History header). Drop old entries. */
export function sweepRunLedger({ now = Date.now(), maxAgeMs = LEDGER_RETENTION_MS } = {}) {
  const dir = join(worcaHome(), 'metrics', 'ledger');
  let names;
  try { names = readdirSync(dir); } catch { return 0; }
  let dropped = 0;
  for (const name of names) {
    if (!name.endsWith('.json')) continue;
    try {
      if (now - statSync(join(dir, name)).mtimeMs > maxAgeMs) { rmSync(join(dir, name), { force: true }); dropped += 1; }
    } catch { /* raced with another sweep */ }
  }
  return dropped;
}
