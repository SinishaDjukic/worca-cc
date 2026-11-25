// src/core/shape/measure.mjs — Shaper small runs A4 (flag shaperSmallRuns): a finished feature's figures, recorded on this
// machine in shape_feature_figures (one row per feature) and read back per Care position. Every read here is a local DB
// or file read: nothing is sent anywhere, and Statistics and the team metrics record never read the table.
import { getDb } from '../db.mjs';
import { featureView, featureOfPipeline } from './features.mjs';
import { roundOrigin } from './rounds.mjs';
import { stepHistory } from './estimate.mjs';
import { buildShapeStats, shapeRecordFrom } from './stats.mjs';
import { CARE_POSITIONS } from '../../shared/shape/feature-record.mjs';
import { SEVERITIES, hasBlocking, normalizeSeverity } from '../../shared/graph/verdict.mjs';
import { readPipelineExtras, readPipelineStateById } from '../artifacts.mjs';
import { featurePrSetting, readRunPrAuto } from '../pr-auto.mjs';
import { getTicket } from '../scheduler.mjs';
import { shaperSmallRunsOn } from './small-runs.mjs';

export const MEASURE_MIN_FEATURES = 3;
export const NOT_ENOUGH_HISTORY = 'not enough history yet';

const APPENDED = new Set(['extra', 'follow-up']);
const roundTo = (d) => (n) => { const f = 10 ** d; return Math.round((Number(n) || 0) * f) / f; };
const usd4 = roundTo(4);
const usd2 = roundTo(2);
const count1 = roundTo(1);
const rate3 = roundTo(3);
const iso = (ms) => new Date(ms).toISOString();
/** A stored ISO time as ms, or null (missing or unparseable). */
const ms = (v) => { const t = typeof v === 'string' ? Date.parse(v) : NaN; return Number.isNaN(t) ? null : t; };
const earliest = (...xs) => { const ok = xs.filter((x) => x != null); return ok.length ? Math.min(...ok) : null; };
const openedAt = (outcome) => (outcome && outcome.status === 'opened' ? ms(outcome.at) : null);
const safe = (fn, fallback) => { try { return fn(); } catch { return fallback; } };

/** Every slice done (featureView's status) and every round of every slice done; with a Verifier check (C5, D10), the
 *  latest one clean or accepted. Pure. */
export function featureFinished(view) {
  if (view?.status !== 'done' || !(view.total > 0)) return false;
  if (view.verify && view.verify.state !== 'clean' && view.verify.state !== 'accepted') return false;
  return (view.slices || []).every((s) => (s.rounds || []).every((r) => r.status === 'done'));
}

/** The run ids of a feature: each slice's run and each of its rounds, de-duplicated. */
const runsOf = (view) => [...new Set(view.slices.flatMap((s) => [s.pipelineId, ...(s.rounds || []).map((r) => r.pipelineId)]).filter(Boolean))];

/** Per run: its shape stats (fix rounds, cost split) and its impl reviews. A run that cannot be read counts 0. */
function runFigures(pid) {
  const state = safe(() => readPipelineStateById(pid), null);
  const stats = state ? buildShapeStats(shapeRecordFrom(state.shapeStats), state.steps) : null;
  const impl = safe(() => readPipelineExtras(pid).reviews, []).filter((v) => v.kind === 'impl').sort((a, b) => a.cycle - b.cycle);
  return { reviewCycles: stats?.reviewCycles || 0, shaping: stats?.cost.shaping || 0, building: stats?.cost.building || 0, impl };
}

/** Change and fix runs added after the feature's PRs were created (D10, D11). */
function changesAfterShip(featureId, view) {
  const f = earliest(
    ms(getDb().prepare('SELECT shipped_at FROM shape_features WHERE id = ?').get(String(featureId))?.shipped_at),
    openedAt(safe(() => featurePrSetting(featureId), null)?.outcome),
  );
  const own = new Map(view.slices.map((s) => [s.index, s.pipelineId ? openedAt(safe(() => readRunPrAuto(s.pipelineId), null)?.outcome) : null]));
  const anyPr = earliest(f, ...own.values());
  const roundIds = view.slices.flatMap((s) => (s.rounds || []).map((r) => r.pipelineId)).filter(Boolean);
  const started = new Map(roundIds.length
    ? getDb().prepare(`SELECT id, started_at FROM pipelines WHERE id IN (${roundIds.map(() => '?').join(', ')})`).all(...roundIds)
      .map((r) => [r.id, ms(r.started_at)])
    : []);
  let n = 0;
  for (const s of view.slices) {
    const sliceAt = earliest(own.get(s.index), f);
    for (const r of s.rounds || []) {
      const added = started.get(r.pipelineId) ?? null;
      if (sliceAt != null && added != null && added > sliceAt) n += 1;
    }
    if (APPENDED.has(s.kind) && s.ticketId) {
      const added = ms(safe(() => getTicket(s.ticketId), null)?.createdAt);
      if (anyPr != null && added != null && added > anyPr) n += 1;
    }
  }
  return n;
}

/** C5 (D10): the feature's Verifier runs, which add to its cost and never to its runs. */
function verifierRunsOf(featureId) {
  const o = parse(getDb().prepare('SELECT outline FROM shape_features WHERE id = ?').get(String(featureId))?.outline || 'null');
  const checks = o && o.verify && Array.isArray(o.verify.checks) ? o.verify.checks : [];
  return checks.map((c) => c.pipelineId || (c.ticketId ? safe(() => getTicket(c.ticketId), null)?.pipelineId : null)).filter(Boolean);
}

function computeFigures(featureId, view) {
  const runIds = runsOf(view);
  const pids = [...new Set([...runIds, ...verifierRunsOf(featureId)])];
  const costPerStep = {};
  for (const [agent, h] of stepHistory({ pipelineIds: pids })) costPerStep[agent] = usd4(h.cost.reduce((a, b) => a + b, 0));
  const reviewFindings = { ...Object.fromEntries(SEVERITIES.map((k) => [k, 0])), total: 0 };
  let shaping = 0; let building = 0; let fixRounds = 0; let reviewed = 0; let passes = 0;
  for (const pid of pids) {
    const r = runFigures(pid);
    shaping += r.shaping; building += r.building;
    fixRounds += Math.max(0, r.reviewCycles - 1);
    for (const v of r.impl) for (const i of v.issues) { reviewFindings[normalizeSeverity(i?.severity)] += 1; reviewFindings.total += 1; }
    if (r.reviewCycles >= 1) {
      reviewed += 1;
      // A missing verdict is a clean pass.
      if (!r.impl.length || !hasBlocking(r.impl[0])) passes += 1;
    }
  }
  const items = view.ship?.acceptance?.items || [];
  const position = view.care?.position;
  return {
    // Care is the feature's position at record time; without one it is the A2 default, Balanced (careOfRow).
    care: CARE_POSITIONS.includes(position) ? position : 'balanced', runs: runIds.length,
    costPerStep, cost: { shaping: usd4(shaping), building: usd4(building), total: usd4(shaping + building) },
    // Feature D1 (D11): a marked feature's count is its Ship ledger's (owned holds plus confirmed marks).
    requirementsMet: view.ship?.smallRuns ? { ...view.ship.smallRuns.met } : { met: items.filter((i) => i.pass && !i.state).length, total: items.length },
    gapsAtEnd: view.verify ? view.verify.gapsFound : 0,
    reviewFindings,
    firstPassRate: reviewed ? rate3(passes / reviewed) : null,
    fixRounds,
    changesAfterShip: changesAfterShip(featureId, view),
  };
}

/** Record a finished feature's figures (an upsert, recomputed in full). Refusals write nothing and leave a row alone.
 *  @returns {{recorded: true, figures: object} | {recorded: false, reason: 'flag-off'|'no-feature'|'not-finished'}} */
export function recordFeatureFigures(featureId, { now = Date.now(), deps = {} } = {}) {
  if (!shaperSmallRunsOn(deps)) return { recorded: false, reason: 'flag-off' };
  const view = featureView(featureId);
  if (!view) return { recorded: false, reason: 'no-feature' };
  if (!featureFinished(view)) return { recorded: false, reason: 'not-finished' };
  const figures = computeFigures(view.id, view);
  const at = iso(now);
  getDb().prepare(`INSERT INTO shape_feature_figures (feature_id, care, figures, recorded_at, updated_at) VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(feature_id) DO UPDATE SET care = excluded.care, figures = excluded.figures, updated_at = excluded.updated_at`)
    .run(view.id, figures.care, JSON.stringify(figures), at, at);
  return { recorded: true, figures };
}

/** After a run settles: re-record the feature it (or the run its round belongs to) is part of. */
export function recordFiguresAfterRun(pipelineId, opts) {
  if (!shaperSmallRunsOn(opts?.deps)) return { recorded: false, reason: 'flag-off' };
  const featureId = featureOfPipeline(roundOrigin(pipelineId))?.featureId;
  if (!featureId) return { recorded: false, reason: 'no-feature' };
  return recordFeatureFigures(featureId, opts);
}

/** afterRunSettled's hook: a run that settled `done` re-records its feature's figures. Never the outcome: never throws. */
export function recordSettledFigures(state) {
  if (!(state?.id && state.status === 'done')) return;
  try { recordFiguresAfterRun(state.id); } catch (err) { console.error(`[worca-ui] feature figures failed: ${err?.message || err}`); }
}

const parse = (t) => { try { return JSON.parse(t); } catch { return null; } };

/** A feature's recorded figures, or null (features.mjs owns the one-row read). Readable with the flag off. */
export { featureFigures } from './features.mjs';

const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + (Number(b) || 0), 0) / xs.length : 0);

/** The per-position summary of recorded figures: means per feature (D13). Pure. */
export function summarizeFigures(list) {
  const fs = Array.isArray(list) ? list.filter(Boolean) : [];
  const agents = [...new Set(fs.flatMap((f) => Object.keys(f.costPerStep || {})))];
  const costPerStep = Object.fromEntries(agents.map((a) => [a, usd2(mean(fs.filter((f) => f.costPerStep && a in f.costPerStep).map((f) => f.costPerStep[a])))]));
  const met = fs.reduce((n, f) => n + (Number(f.requirementsMet?.met) || 0), 0);
  const total = fs.reduce((n, f) => n + (Number(f.requirementsMet?.total) || 0), 0);
  const rates = fs.map((f) => f.firstPassRate).filter((r) => typeof r === 'number');
  return {
    costPerStep,
    costPerFeature: usd2(mean(fs.map((f) => f.cost?.total))),
    requirementsMet: { met: count1(fs.length ? met / fs.length : 0), total: count1(fs.length ? total / fs.length : 0), rate: total ? rate3(met / total) : null },
    gapsAtEnd: count1(mean(fs.map((f) => f.gapsAtEnd))),
    reviewFindings: Object.fromEntries([...SEVERITIES, 'total'].map((k) => [k, count1(mean(fs.map((f) => f.reviewFindings?.[k])))])),
    firstPassRate: rates.length ? rate3(mean(rates)) : null,
    fixRounds: count1(mean(fs.map((f) => f.fixRounds))),
    changesAfterShip: count1(mean(fs.map((f) => f.changesAfterShip))),
  };
}

/** The figures per Care position; a position with fewer than `minFeatures` recorded features says so instead. Positions
 *  never mix: each reads only its own rows. `projectDir` (B2) keeps only that project's features. Readable with the flag off. */
export function figuresByCare({ minFeatures = MEASURE_MIN_FEATURES, projectDir = null } = {}) {
  const q = projectDir
    ? getDb().prepare(`SELECT g.care, g.figures FROM shape_feature_figures g JOIN shape_features f ON f.id = g.feature_id
      WHERE g.care = ? AND f.project_dir = ?`)
    : getDb().prepare('SELECT care, figures FROM shape_feature_figures WHERE care = ?');
  return Object.fromEntries(CARE_POSITIONS.map((care) => {
    const list = (projectDir ? q.all(care, String(projectDir)) : q.all(care)).map((r) => parse(r.figures)).filter(Boolean);
    const n = list.length;
    return [care, n < minFeatures ? { care, features: n, enough: false, note: NOT_ENOUGH_HISTORY }
      : { care, features: n, enough: true, figures: summarizeFigures(list) }];
  }));
}
