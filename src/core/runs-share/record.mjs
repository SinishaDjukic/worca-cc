// src/core/runs-share/record.mjs — the shared run record v1 (run sharing s1, §2a). Pure: no I/O.
// One record per run on the `worca-runs` branch, built from an allow-list of 14 typed keys. No prompt, title, branch
// name, file path, node label or log ever enters it (D4, D17); every string is pattern-checked or an enum.
import { runProgress } from '../../shared/run-progress.mjs';
import { PERSON_KEY_RE, isMockRun } from '../metrics/record.mjs';

export const RECORD_VERSION = 1;
export const RECORD_KEYS = Object.freeze([
  'costUsd', 'finishedAt', 'personKey', 'phase', 'progress', 'prUrl', 'runId', 'stage', 'startedAt', 'startedBy',
  'status', 'updatedAt', 'v', 'workflowId',
].sort());
export const RECORD_MAX_BYTES = 2048;
/** The only path a record may sit at: `runs/<personKey>/<runId>.json` (moved from read.mjs, D8). */
export const RECORD_PATH_RE = /^runs\/([0-9a-f]{16})\/([0-9a-f]{8})\.json$/;
export const TERMINAL_STATUSES = Object.freeze(['done', 'error', 'stopped', 'interrupted']);
/** A run in one of these is flushed at once on its `done` event (D8). */
export const END_STATUSES = Object.freeze([...TERMINAL_STATUSES, 'paused']);

const PIPELINE_ID_RE = /^[0-9a-f]{8}$/;   // the store's run id (src/core/store.mjs)
const WORKFLOW_RE = /^[A-Za-z0-9_.-]{1,64}$/;
const PHASE_RE = /^[a-z0-9_-]{1,40}$/;
const STATUSES = Object.freeze(['running', 'pausing', 'paused', ...TERMINAL_STATUSES]);
const UNPUBLISHED = new Set(['idle', 'created', 'starting']);
const STAGES = new Set(['plan', 'build', 'review', 'ready']);
const STARTED_BY_MAX = 80;
const PR_URL_MAX = 300;
const ISO_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/;
// eslint-disable-next-line no-control-regex
const CONTROL_RE = /[\u0000-\u001f\u007f-\u009f]/g;

/** A PR link a teammate may open: https only, no login, no query or fragment, at most 300 chars; else null. */
export function cleanPrUrl(s) {
  if (typeof s !== 'string' || !s) return null;
  let u;
  try { u = new URL(s); } catch { return null; }
  if (u.protocol !== 'https:' || u.username || u.password) return null;
  const out = u.origin + u.pathname;
  return out.length <= PR_URL_MAX ? out : null;
}

const mapStatus = (s) => {
  const v = String(s ?? '');
  if (UNPUBLISHED.has(v)) return null;
  return STATUSES.includes(v) ? v : 'running';
};
const pick = (v, re) => (typeof v === 'string' && re.test(v) ? v : null);
const money = (n) => { const v = Number(n); return Number.isFinite(v) && v > 0 ? Math.round(v * 100) / 100 : 0; };
const isoOrNull = (v) => (typeof v === 'string' && ISO_RE.test(v) ? v : null);
const cleanStartedBy = (v) => {
  if (typeof v !== 'string') return null;
  const s = v.replace(CONTROL_RE, '').trim().slice(0, STARTED_BY_MAX);
  return s || null;
};
const nowIso = (now) => (now instanceof Date ? now : new Date(now ?? Date.now())).toISOString();

function assemble({ runId, personKey, workflowId, status, phase, stage, progress, costUsd, startedBy, startedAt, updatedAt, finishedAt, prUrl }) {
  if (!PIPELINE_ID_RE.test(String(runId ?? '')) || !PERSON_KEY_RE.test(String(personKey ?? ''))) return null;
  const st = mapStatus(status);
  if (!st) return null;
  return {
    v: RECORD_VERSION,
    runId,
    personKey,
    workflowId: pick(workflowId, WORKFLOW_RE),
    status: st,
    phase: pick(phase, PHASE_RE),
    stage: STAGES.has(stage) ? stage : null,
    progress: typeof progress === 'number' && Number.isFinite(progress) ? Math.round(Math.min(1, Math.max(0, progress)) * 100) / 100 : null,
    costUsd: money(costUsd),
    startedBy: cleanStartedBy(startedBy),
    startedAt: isoOrNull(startedAt),
    updatedAt,
    finishedAt: TERMINAL_STATUSES.includes(st) ? (isoOrNull(finishedAt) ?? updatedAt) : null,
    prUrl: cleanPrUrl(prUrl),
  };
}

/** The project key a harness would publish under, or null for a run this slice skips (D18). */
export function shareProjectOf(harness) {
  if (!harness || harness.isWorkspace || harness._noProject || isMockRun(harness)) return null;
  const m = Array.isArray(harness.members) ? harness.members[0] : null;
  return m && typeof m.projectKey === 'string' && m.projectKey && m.projectDir ? { projectKey: m.projectKey, projectDir: m.projectDir } : null;
}

/** The record of a live harness; null for a skipped run (D18), an unpublished status or a bad id. */
export function recordFromHarness(harness, { personKey, startedBy = null, prUrl = null, now } = {}) {
  if (!shareProjectOf(harness)) return null;
  const st = harness.state || {};
  let prog = null;
  try { prog = runProgress(st); } catch { prog = null; }
  return assemble({
    runId: harness.pipeline?.id,
    personKey,
    workflowId: harness.resolved?.template?.id || st.stepper?.template?.id || harness.workflowId || null,
    status: st.status,
    phase: st.phase,
    stage: prog?.stage ?? null,
    progress: prog?.fraction ?? null,
    costUsd: st.totalCostUsd,
    startedBy,
    startedAt: st.startedAt,
    updatedAt: nowIso(now),
    finishedAt: st.updatedAt,
    prUrl,
  });
}

/**
 * The same shape from a pipelines row (a PR stored after the run ended, D12): stage and progress are null. Null for a
 * workspace run's row or under mock mode (D18), so the flush path skips them whatever marked them.
 */
export function recordFromRow(row, { personKey, startedBy = null, prUrl = null, now } = {}) {
  if (!row || row.workspace_key || isMockRun(null)) return null;
  let stepper = null;
  try { stepper = typeof row.stepper === 'string' ? JSON.parse(row.stepper) : row.stepper; } catch { stepper = null; }
  return assemble({
    runId: row.id,
    personKey,
    workflowId: stepper?.template?.id || null,
    status: row.status,
    phase: row.phase,
    stage: null,
    progress: null,
    costUsd: row.total_cost_usd,
    startedBy,
    startedAt: row.started_at,
    updatedAt: nowIso(now),
    finishedAt: row.updated_at,
    prUrl,
  });
}

/** Sorted keys, `\n`-terminated. @throws {Error} code RECORD_TOO_LARGE over `maxBytes` */
export function serializeRecord(rec, maxBytes = RECORD_MAX_BYTES) {
  const sorted = {};
  for (const k of RECORD_KEYS) sorted[k] = rec[k];
  const text = `${JSON.stringify(sorted)}\n`;
  if (Buffer.byteLength(text, 'utf8') > maxBytes) {
    throw Object.assign(new Error(`run record is over ${maxBytes} bytes`), { code: 'RECORD_TOO_LARGE' });
  }
  return text;
}

/** Equal ignoring `updatedAt` (D9). */
export function sameRecord(a, b) {
  if (!a || !b) return false;
  return RECORD_KEYS.every((k) => k === 'updatedAt' || a[k] === b[k]);
}

const isNum01 = (v) => v === null || (typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 1);
const isIsoOrNull = (v) => v === null || (typeof v === 'string' && ISO_RE.test(v));

/** The reader's check (s2 reuses it): the exact key set and §2a types, else null. */
export function sanitizeRecord(obj) {
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return null;
  const keys = Object.keys(obj).sort();
  if (keys.length !== RECORD_KEYS.length || keys.some((k, i) => k !== RECORD_KEYS[i])) return null;
  const r = obj;
  const ok = r.v === RECORD_VERSION
    && typeof r.runId === 'string' && PIPELINE_ID_RE.test(r.runId)
    && typeof r.personKey === 'string' && PERSON_KEY_RE.test(r.personKey)
    && (r.workflowId === null || (typeof r.workflowId === 'string' && WORKFLOW_RE.test(r.workflowId)))
    && STATUSES.includes(r.status)
    && (r.phase === null || (typeof r.phase === 'string' && PHASE_RE.test(r.phase)))
    && (r.stage === null || STAGES.has(r.stage))
    && isNum01(r.progress)
    && typeof r.costUsd === 'number' && Number.isFinite(r.costUsd) && r.costUsd >= 0
    && (r.startedBy === null || (typeof r.startedBy === 'string' && r.startedBy.length <= STARTED_BY_MAX && !new RegExp(CONTROL_RE.source).test(r.startedBy)))
    && isIsoOrNull(r.startedAt)
    && typeof r.updatedAt === 'string' && ISO_RE.test(r.updatedAt)
    && isIsoOrNull(r.finishedAt)
    && (r.prUrl === null || (typeof r.prUrl === 'string' && cleanPrUrl(r.prUrl) === r.prUrl));
  return ok ? { ...r } : null;
}

/** `ls-tree -r -z -l` output → entries; a size of `-` (not a blob) is NaN. */
export function parseTreeListing(stdout) {
  const out = [];
  for (const item of String(stdout || '').split('\0')) {
    if (!item) continue;
    const tab = item.indexOf('\t');
    if (tab < 0) continue;
    const [mode, type, sha, size] = item.slice(0, tab).trim().split(/\s+/);
    out.push({ mode, type, sha, size: size === '-' ? NaN : Number(size), path: item.slice(tab + 1) });
  }
  return out;
}
