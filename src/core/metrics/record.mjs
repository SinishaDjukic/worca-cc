// Team metrics RunRecord v1 (team-metrics-design.md §4.4). The builder is PURE over a
// normalized snapshot; snapshotFromHarness() gathers that snapshot from a finished
// harness, and recordRunMetrics() is the fail-soft terminal hook (§4.5).
import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { roundUsd } from '../cost-budget.mjs';
import { prepare } from '../db.mjs';
import { readPrState } from '../artifacts.mjs';
import { RESULTS_FILE } from '../results.mjs';
import { UI_PHASE } from '../../shared/graph/manifest.mjs';
import {
  projectSlug, gitUserName, resolveProjectSink, resolveWorkspaceSink, writeOutbox, scheduleFlush as realScheduleFlush,
} from './sync.mjs';
import { writeRunLedger } from './ledger.mjs';
import { readPolicyState } from '../policy/state.mjs';

export const RECORD_VERSION = 1;
export const TEXT_MAX = 200;
export const WORCA_VERSION = createRequire(import.meta.url)('../../../package.json').version;

/** Serialised key order of a v1 record — diffs stay readable (§4.4). */
export const RECORD_FIELDS = Object.freeze([
  'v', 'id', 'worca', 'recordedAt',
  'startedAt', 'endedAt', 'wallMs', 'activeMs', 'pausedMs',
  'result', 'failure',
  'workflow', 'target', 'title', 'source',
  'cost', 'agents', 'steps', 'cycles', 'interventions',
  'pr', 'git', 'actor',
  // `policy` (team-policy design §10) is an OPTIONAL trailing key: present only on runs that
  // saw a policy, so policy-less records keep exactly this key list. Readers ignore it.
]);

const RESULT_OF = Object.freeze({ done: 'done', error: 'failed', stopped: 'stopped' });
const BUDGET_RE = /budget|cost cap|cost limit/i;
// Absolute POSIX/Windows/home paths, but never URLs (the lookbehind skips "https://host/…").
// §4.12 promises a record carries no local paths, and harness error texts routinely do:
// run-harness.mjs:~1333 `worktree missing: ${wt} — cannot resume`, git stderr, ENOENT texts
// (verified in a real resume-error run). cleanText alone only strips control characters.
const ABS_PATH_RE = /(?<![\w:/\\.~-])(?:[A-Za-z]:[\\/]|~?[\\/])[^\s'"`<>|\\/]+(?:[\\/][^\s'"`<>|]*)?/g;
/** Replace absolute paths with `<path>` (decision 34). Applied to failure.message. */
export const redactPaths = (v) => (v == null ? v : String(v).replace(ABS_PATH_RE, '<path>'));
// C0, DEL, C1, and the two JS line separators — one record is always one line (§4.12).
const CONTROL_RE = /[\u0000-\u001F\u007F-\u009F\u2028\u2029]+/g;

/** Strip control chars/newlines, collapse spaces, truncate to `max` code points. */
export function cleanText(value, max = TEXT_MAX) {
  if (value == null) return null;
  const flat = String(value).replace(CONTROL_RE, ' ').replace(/ {2,}/g, ' ').trim();
  const chars = Array.from(flat);
  return chars.length > max ? chars.slice(0, max).join('') : flat;
}

function isoSec(v) {
  const ms = v instanceof Date ? v.getTime() : Date.parse(v);
  return Number.isFinite(ms) ? new Date(ms).toISOString().replace(/\.\d{3}Z$/, 'Z') : null;
}

const num = (v) => (Number.isFinite(v) ? v : null);
const unique = (arr) => [...new Set(arr.filter((x) => typeof x === 'string' && x))];

// failure-policy REASON codes of a cost-cap pause (src/core/failure-policy.mjs).
const BUDGET_PAUSE = new Set(['cost_pipeline', 'cost_total', 'cost_pipeline_policy', 'cost_total_policy']);

/**
 * failure (§4.4). Cost caps and setup failures PAUSE the run, so the last pause reason is
 * part of the evidence. `commit` is never emitted in v1: commitFailed is only known after
 * teardown, which runs after the hook (plan §1).
 */
function buildFailure(snap, result, agentSteps) {
  const pauseBudget = BUDGET_PAUSE.has(snap.lastPause?.reason);
  if (result === 'stopped') {
    return pauseBudget ? { kind: 'budget', message: cleanText(redactPaths(snap.lastPause.detail || snap.lastPause.reason)) } : null;
  }
  if (result !== 'failed') return null;
  const raw = snap.error == null ? '' : String(snap.error);
  // Budget first: the Auto classifier's cost sits on the preflight row, so a cap can trip before any agent step.
  const kind = pauseBudget || BUDGET_RE.test(raw) ? 'budget'
    : agentSteps.length === 0 ? 'preflight' : 'error';
  return { kind, message: cleanText(redactPaths(raw || snap.lastPause?.detail || '')) };
}

function buildTarget(t) {
  if (t?.kind === 'workspace') {
    return {
      kind: 'workspace',
      workspace: cleanText(t.workspace),
      // Stable identity for the reader (workspace-match.mjs); the name above stays for display.
      workspaceId: typeof t.workspaceId === 'string' && t.workspaceId ? t.workspaceId : null,
      projects: unique(t.projects || []),
      touched: unique(t.touched || []),
      // Files changed per touched member (additive; older records lack it → the reader shows
      // "–" rather than attributing the run's total to every project it touched).
      touchedFiles: touchedFilesOf(t.touchedFiles),
    };
  }
  return { kind: 'project', project: t?.project ?? null };
}

function touchedFilesOf(m) {
  if (!m || typeof m !== 'object' || Array.isArray(m)) return {};
  const out = {};
  for (const [slug, n] of Object.entries(m)) if (typeof slug === 'string' && slug && Number.isInteger(n) && n >= 0) out[slug] = n;
  return out;
}

function buildSource(src) {
  if (!src || !src.type) return null;
  return {
    type: cleanText(src.type, 80),
    ref: cleanText(src.ref),
    url: cleanText(src.url, 2000),
    title: cleanText(src.title),
  };
}

/** money-saved design §7: hours from the run, byPhase from the agent steps (UI phase, like cost.byPhase). */
function buildHuman(agentSteps, humanHours) {
  const hours = Number.isFinite(humanHours) ? Math.round(humanHours * 100) / 100 : 0;
  if (hours <= 0) return null;
  const byPhase = {};
  for (const s of agentSteps) {
    const h = Number(s?.humanHours);
    if (!s?.phase || !Number.isFinite(h) || h <= 0) continue;
    byPhase[s.phase] = Math.round(((byPhase[s.phase] || 0) + h) * 100) / 100;
  }
  return { hours, byPhase };
}

function buildCost(steps, totalCostUsd) {
  const byPhase = {};
  let sum = 0;
  for (const s of steps) {
    const c = Number(s?.costUsd) || 0;
    sum += c;
    if (s?.phase && c) byPhase[s.phase] = (byPhase[s.phase] || 0) + c;
  }
  for (const k of Object.keys(byPhase)) byPhase[k] = roundUsd(byPhase[k]);
  return { usd: roundUsd(Math.max(Number(totalCostUsd) || 0, sum)), byPhase };
}

function maxCyclePerPhase(agentSteps) {
  const out = {};
  for (const s of agentSteps) {
    if (!s.phase || !Number.isInteger(s.cycle)) continue;
    out[s.phase] = Math.max(out[s.phase] ?? 0, s.cycle);
  }
  return out;
}

const strList = (arr) => unique(Array.isArray(arr) ? arr.filter((x) => typeof x === 'string').map((x) => cleanText(x, 120)) : []);

/**
 * `policy` (team-policy design §10): the home the run's policy came from and what the developer
 * did about it. Absent (null) when the run saw no policy. `reason` is free text visible to the
 * team, so it follows the branch's attribution choice: dropped under `attribution: none`.
 */
function buildPolicy(p, attribution) {
  if (!p || typeof p !== 'object' || !p.home) return null;
  return {
    home: cleanText(p.home, 120),
    sha: typeof p.sha === 'string' && /^[0-9a-f]{7,40}$/i.test(p.sha) ? p.sha.slice(0, 7).toLowerCase() : null,
    overrides: strList(p.overrides),
    exceeded: strList(p.exceeded),
    deviations: strList(p.deviations),
    unattended: p.unattended === true,
    reason: attribution === 'none' ? null : cleanText(redactPaths(p.reason)),
  };
}

/**
 * Build a v1 RunRecord from a normalized snapshot (see snapshotFromHarness).
 * @param {object} snap
 * @param {{attribution?:'git-user'|'none', now?:Date}} [opts]
 */
export function buildRunRecord(snap, { attribution = 'git-user', now = new Date() } = {}) {
  const result = RESULT_OF[snap?.status];
  if (!result) throw new RangeError(`not a terminal run status: ${snap?.status}`);
  const steps = Array.isArray(snap.steps) ? snap.steps : [];
  const agentSteps = steps.filter((s) => s && s.agentKey);
  const startMs = Date.parse(snap.startedAt);
  const endMs = Date.parse(snap.endedAt);
  const recordedAt = isoSec(now);
  const iv = snap.interventions || {};
  const keys = unique(snap.agentKeys?.length ? [...snap.agentKeys] : agentSteps.map((s) => s.agentKey));
  // Full model ids from result frames only. subAgents[].runModel holds aliases ('haiku',
  // run-harness.mjs:~3397) and resume() does not restore state.subAgents, so mixing it in would
  // give an inconsistent, resume-dependent model mix.
  const models = unique(agentSteps.map((s) => s.modelUsed)).sort();
  const g = snap.git || {};
  return {
    v: RECORD_VERSION,
    id: String(snap.runId),
    worca: snap.worcaVersion ?? WORCA_VERSION,
    recordedAt,
    startedAt: isoSec(snap.startedAt) ?? recordedAt,
    endedAt: isoSec(snap.endedAt) ?? recordedAt,
    wallMs: Number.isFinite(startMs) && Number.isFinite(endMs) ? Math.max(0, endMs - startMs) : null,
    activeMs: num(snap.totalActiveMs),
    // Parked (paused, or dead between a crash and its resume): leaves the autonomy denominator.
    // Additive under v1; a record without it parks nothing.
    pausedMs: num(snap.pausedMs) ?? 0,
    result,
    failure: buildFailure(snap, result, agentSteps),
    workflow: snap.workflow
      ? {
        id: snap.workflow.id ?? null,
        name: cleanText(snap.workflow.name),
        version: Number.isInteger(snap.workflow.version) ? snap.workflow.version : null,
        rev: /^[0-9a-f]{8}$/.test(String(snap.workflow.rev || '')) ? snap.workflow.rev : null, // additive (§4.4 versioning)
      }
      : null,
    target: buildTarget(snap.target),
    title: cleanText(snap.title),
    source: buildSource(snap.source),
    cost: buildCost(steps, snap.totalCostUsd),
    agents: { count: keys.length, keys, models },
    steps: agentSteps.length,
    cycles: maxCyclePerPhase(agentSteps),
    interventions: { questions: iv.questions | 0, pauses: iv.pauses | 0, resumes: iv.resumes | 0 },
    pr: snap.pr && (snap.pr.url || snap.pr.number != null)
      ? { number: Number.isInteger(snap.pr.number) ? snap.pr.number : null, url: cleanText(snap.pr.url, 2000), base: snap.prBase ?? null }
      : null,
    git: {
      branch: cleanText(g.branch),
      head: g.head ?? null,
      base: cleanText(g.base),
      filesChanged: num(g.filesChanged),
      insertions: num(g.insertions),
      deletions: num(g.deletions),
    },
    actor: attribution === 'none' ? null : cleanText(snap.actor),
    // Present ONLY on runs that saw a policy: records of policy-less runs stay byte-identical to v1.
    ...((p) => (p ? { policy: p } : {}))(buildPolicy(snap.policy, attribution)),
    ...((h) => (h ? { human: h } : {}))(buildHuman(agentSteps, snap.humanHours)),
  };
}

const TERMINAL = new Set(['done', 'error', 'stopped']);
const MOCK_ENV_RE = /^(1|true|yes|on)$/i;

export function isMockRun(harness) {
  return !!harness?.claude?.mock || MOCK_ENV_RE.test(String(process.env.WORCA_MOCK ?? process.env.ORCH_MOCK ?? ''));
}

function log(harness, level, text) {
  try { harness?._log?.('metrics', level, text); } catch { /* logging must never throw */ }
}

async function readResults(pipelineDir) {
  if (!pipelineDir) return null;
  try { return JSON.parse(await readFile(join(pipelineDir, RESULTS_FILE), 'utf8')); } catch { return null; }
}

// results.mjs: summary.filesChanged already includes deletions (filesDeleted counts the same rows).
const changedFiles = (s) => (s ? (s.filesNew | 0) + (s.filesChanged | 0) : 0);

/** Graph engine: step.phase is the agent key (orchestrator.mjs "legacy column"). Map to the UI phase. */
function withUiPhases(steps, graph) {
  const uiPhaseOf = new Map((graph?.nodes || []).map((n) => [n.id, n.uiPhase]));
  return steps.map((s) => (s && s.agentKey
    ? { ...s, phase: uiPhaseOf.get(s.nodeId) || UI_PHASE[s.agentKey] || s.phase || s.agentKey }
    : s));
}

/** Structural revision of the workflow graph: layout, labels and per-run overlays excluded (decision 5). */
function graphRev(graph) {
  if (!graph || typeof graph !== 'object') return null;
  try {
    const shape = {
      nodes: (Array.isArray(graph.nodes) ? graph.nodes : []).map((n) => ({ id: n?.id ?? null, kind: n?.kind ?? null, key: n?.key ?? null, config: n?.config ?? null })),
      wires: (Array.isArray(graph.wires) ? graph.wires : []).map((w) => ({ id: w?.id ?? null, from: w?.from ?? null, to: w?.to ?? null, maxCycles: w?.maxCycles ?? null })),
    };
    return createHash('sha1').update(JSON.stringify(shape)).digest('hex').slice(0, 8);
  } catch { return null; }
}

/** Branch commit stamped by _commitWork, if any. At hook time it normally is not yet (decision 3). */
const shortCommit = (c) => (typeof c === 'string' && /^[0-9a-f]{7,40}$/i.test(c) ? c.slice(0, 8).toLowerCase() : null);

/** state.title may still be the provisional first prompt line; give the LLM title a short grace. */
async function settledTitle(harness) {
  const st = harness.state || {};
  if (st.titleProvisional !== false && harness._titlePromise && typeof harness._titlePromise.then === 'function') {
    await Promise.race([harness._titlePromise.catch(() => {}), new Promise((r) => setTimeout(r, 5_000).unref?.())]);
  }
  return st.title;
}

function readSource(runId) {
  let row;
  try { row = prepare('SELECT source_type, source_ref FROM pipelines WHERE id = ?').get(runId); } catch { return null; }
  if (!row || !row.source_type || !row.source_ref) return null;
  let meta;
  try { meta = JSON.parse(row.source_ref); } catch { return null; }
  if (!meta || (meta.taskId == null && !meta.url)) return null;
  return { type: meta.sourceId || row.source_type, ref: meta.taskId != null ? String(meta.taskId) : null, url: meta.url ?? null, title: meta.title ?? null };
}

/** Normalize a finished harness into the buildRunRecord() snapshot. Best-effort per field. */
export async function snapshotFromHarness(harness, { status, error = null } = {}) {
  const st = harness.state || {};
  const runId = harness.pipeline?.id || st.id;
  const members = Array.isArray(harness.members) && harness.members.length
    ? harness.members
    : [{ projectKey: null, projectDir: harness.projectDir }];
  const slugOf = new Map();
  for (const m of members) slugOf.set(m.projectKey ?? m.projectDir, (await projectSlug(m.projectDir)).slug);
  const results = await readResults(harness.pipeline?.dir);
  const summary = results?.summary || null;
  const branch = st.branch || null; // mirrors the primary member in workspace runs (plan §1)
  const iv = harness._metricsIv || {};
  const tpl = harness.resolved?.template || null;
  const stepperTpl = st.stepper?.template || null;
  const target = harness.isWorkspace
    ? {
      kind: 'workspace',
      workspace: harness.workspace?.name ?? st.workspaceName ?? null,
      workspaceId: harness.workspace?.id ?? st.workspaceId ?? null,
      projects: [...slugOf.values()].sort(),
      touched: Object.entries(results?.perProject || {})
        .filter(([, r]) => changedFiles(r?.summary) > 0)
        .map(([key]) => slugOf.get(key)).filter(Boolean).sort(),
      // The same per-member summaries, as counts: what "Files changed" per project is made of.
      touchedFiles: Object.fromEntries(Object.entries(results?.perProject || {})
        .filter(([key, r]) => slugOf.has(key) && changedFiles(r?.summary) > 0)
        .map(([key, r]) => [slugOf.get(key), changedFiles(r.summary)])),
    }
    : { kind: 'project', project: slugOf.values().next().value };
  return {
    status,
    error: error == null ? null : String(error?.message || error),
    runId,
    startedAt: st.startedAt,
    endedAt: st.updatedAt,
    totalActiveMs: st.totalActiveMs,
    totalCostUsd: st.totalCostUsd,
    humanHours: st.humanHours,
    steps: withUiPhases(st.steps || [], st.stepper?.graph),
    subAgents: st.subAgents || [],
    workflow: {
      // `||`, NOT `??`: buildGraphManifest stores `template: { id: tpl?.id ?? '', name: tpl?.name ?? '' }`
      // (shared/graph/manifest.mjs:~195) and manifestTemplate repeats the `?? ''`. An EMPTY STRING is
      // not nullish, so with `??` a run that died while the stepper still held the Auto bootstrap
      // manifest recorded `{id:'', name:''}` and never fell through to harness.workflowId. The
      // orchestrator guards the same value the same way (orchestrator.mjs:~418, `… .name || name`).
      id: tpl?.id || stepperTpl?.id || harness.workflowId || null,
      name: tpl?.name || stepperTpl?.name || null,
      version: tpl?.version ?? null,
      rev: graphRev(st.stepper?.graph),
    },
    agentKeys: harness.resolved?.agentKeys ? Array.from(harness.resolved.agentKeys) : null,
    target,
    title: await settledTitle(harness),
    source: readSource(runId),
    pr: (() => { try { return readPrState(runId); } catch { return null; } })(),
    prBase: branch?.source ?? null,
    git: {
      branch: branch?.feature ?? null,
      head: shortCommit(branch?.commit), // pre-teardown: normally null (never the pre-run checkpoint HEAD)
      base: branch?.source ?? null,
      filesChanged: summary ? changedFiles(summary) : null,
      insertions: summary ? summary.linesAdded ?? null : null,
      deletions: summary ? summary.linesRemoved ?? null : null,
    },
    interventions: { questions: iv.questions | 0, pauses: iv.pauses | 0, resumes: iv.resumes | 0 },
    pausedMs: Number.isFinite(iv.pausedMs) ? iv.pausedMs : 0,
    // _completePaused stamps iv. A stop/error that lands while a forced pause is still unwinding
    // never reaches it (pause → stop before the unwind finishes → site B), so fall back to this
    // instance's live reason; resume() clears both at rehydration (decision 2).
    lastPause: iv.lastPauseReason
      ? { reason: iv.lastPauseReason, detail: iv.lastPauseDetail ?? null }
      : harness.pauseReason ? { reason: harness.pauseReason, detail: harness.pauseDetail ?? null } : null,
    // The person who started the run (identity.mjs) when one is known; else, as before, the
    // checkout's git user (a local install, the CLI). attribution:'none' still drops both.
    actor: actorForRecord(harness.state && harness.state.startedBy) ?? await gitUserName(harness.projectDir),
    // The run's policy state (pipelines.policy_state) as the gates and the resume flow left it;
    // `unattended` is the harness's own auto flag, which the record needs even when nothing else
    // was written (a --yes run that stayed under every cap still carries no state row).
    policy: (() => { const p = readPolicyState(runId); return p.home ? { ...p, unattended: p.unattended === true || !!harness.auto } : null; })(),
  };
}

/** A recorded person (not 'local', not empty) for the metrics actor, or null to fall back. */
export function actorForRecord(startedBy) {
  return typeof startedBy === 'string' && startedBy.trim() && startedBy !== 'local' ? startedBy.trim() : null;
}

let _recorder = null;
let scheduleFlush = realScheduleFlush;

/**
 * Terminal hook (§4.5). Resolve the sink → build the record → write the outbox (durability
 * point) → schedule a flush. Never throws; returns {recorded, reason?, slug?, file?}.
 */
export async function recordRunMetrics(harness, opts = {}) {
  try {
    if (_recorder) return await _recorder(harness, opts);
    return await recordImpl(harness, opts);
  } catch (err) {
    log(harness, 'warn', `team metrics: ${err?.message || err}`);
    return { recorded: false, reason: 'error', error: String(err?.message || err) };
  }
}

async function recordImpl(harness, { status, error = null, now = new Date() }) {
  if (!TERMINAL.has(status)) return { recorded: false, reason: 'non-terminal' };
  if (!harness?.pipeline?.id) return { recorded: false, reason: 'no-pipeline' }; // preflight-only: nothing started
  if (isMockRun(harness)) return { recorded: false, reason: 'mock' };
  const runId = harness.pipeline.id;
  // Decision 25: cached discovery only (one bounded discovery if there is no cache at all) —
  // the terminal `done` event must never wait on ls-remote/fetch.
  const sink = harness.isWorkspace
    ? await resolveWorkspaceSink(harness.workspace?.id, { discover: 'if-missing' })
    : await resolveProjectSink(harness.projectDir, { discover: 'if-missing' });
  if (!sink.ok) {
    if (sink.reason === 'delegate-invalid' || sink.reason === 'home-stale' || sink.code === 'CONFIG_UNKNOWN') {
      log(harness, 'warn', `team metrics: not recorded — ${sink.detail}`);
      // The header prints the reason; 'not-enabled' would read "(not enabled)" for a branch that
      // simply could not be fetched yet.
      const reason = sink.code === 'CONFIG_UNKNOWN' ? 'config-unknown' : sink.reason;
      writeRunLedger(runId, { state: 'skipped', reason, detail: sink.detail });
    }
    return { recorded: false, reason: sink.reason };
  }
  if (!sink.record) {
    writeRunLedger(runId, { state: 'skipped', slug: sink.slug, reason: 'opted-out' });
    return { recorded: false, reason: 'opted-out' };
  }
  const snap = await snapshotFromHarness(harness, { status, error });
  const record = buildRunRecord(snap, { attribution: sink.attribution, now });
  const file = await writeOutbox(sink.slug, record);
  writeRunLedger(runId, { state: 'pending', slug: sink.slug, file });
  scheduleFlush(sink.slug);
  log(harness, 'info', `team metrics: recorded to ${sink.slug} (${file}); push scheduled`);
  return { recorded: true, slug: sink.slug, file };
}

export const _testing = {
  setRecorder(fn) { _recorder = fn; },
  setScheduleFlush(fn) { scheduleFlush = fn; },
  reset() { _recorder = null; scheduleFlush = realScheduleFlush; },
};
