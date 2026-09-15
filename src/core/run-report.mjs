// src/core/run-report.mjs
// Builds the "report this run" payload: a METADATA-ONLY description of one finished
// pipeline, safe to paste into a public GitHub issue.
//
// Surface-agnostic ON PURPOSE. It takes a run id + options and returns an object;
// it knows nothing about express or the DOM. Today the only caller is
// POST /api/pipelines/:id/report; a follow-up run adds a second caller from the Ask
// chat (which reaches a pipeline id through findRunLinksByPipeline, ask/store.mjs:438).
// One builder, two callers — keep it that way.
//
// ── The redaction contract ───────────────────────────────────────────────────
// DEFAULT = metadata only. Three classes can be opted back in (paths / prompt /
// names, see src/shared/report-reasons.mjs). The unified diff and the run's log
// lines are NOT opt-in-able: there is no code path here that reads either one.
//
// Fields are ADDED for an opt-in, never nulled — so `'prompt' in payload.run` is a
// true test of whether the prompt is present.
//
// Three specific leaks this module exists to prevent:
//   1. A review issue's `location` IS a file path -> counts by default, issue
//      titles/locations only behind `paths`.
//   2. manifest.mjs:133 stores `config: {...node.config}` — the AUTHORED config,
//      verbatim and complete, unknown keys included. The node shape here is a
//      WHITELIST so a future manifest key cannot leak by default.
//   3. outcome.tokens[*].path and branch.worktreeDir are absolute filesystem paths
//      (verified in live data). Neither is ever read.
//   4. workflow.template.name/.id are PROMPT-DERIVED on an Auto run — the classifier
//      writes the name from the task text and the id is a slug of it — so the
//      template's identity rides `names`. See templateShape below.
//
// NOT used: readRunContextBundle (results.mjs:179). Its line 183 is
// `diffPatch: await read(DIFF_PATCH_FILE)` — it eagerly loads the diff, which is
// exactly what must never enter this payload.

import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import {
  findPipelineRowById, readPipelineStateById, readPipelineExtras,
  listSubAgents, runDirForRow, totalsFor,
} from './artifacts.mjs';
import { RESULTS_FILE, OVERVIEW_FILE } from './results.mjs';
import { SEVERITIES, normalizeSeverity } from '../shared/graph/verdict.mjs';
import { budgetStatus, readCostCapOverride } from './cost-budget.mjs';
import { readGuardrailSet, isBuiltinGuardrailSetId } from './guardrail-store.mjs';
import { GRAPH_DEFAULT_WORKFLOW, AUTO_WORKFLOW_ID, AUTO_WORKFLOW_NAME }
  from './graph/builtin-workflows.mjs';
import { SEED_TEMPLATES } from './graph/seed-templates.mjs';
import { describePauseReason } from './failure-policy.mjs';
import { REPORT_REASON_IDS, reasonById, normalizeInclude } from '../shared/report-reasons.mjs';

const require = createRequire(import.meta.url);
const PKG = require('../../package.json');

export const REPORT_SCHEMA_VERSION = 1;
export const WORCA_VERSION = PKG.version || '';
/** package.json bugs.url — the single source for every issue link in the app. */
export const BUGS_URL = (PKG.bugs && PKG.bugs.url) || '';

export const EXPECTATION_MAX = 2000;

/** Pipeline statuses that mean the run is over. 'paused' is parked, not terminal. */
const TERMINAL_STATUSES = new Set(['done', 'error', 'stopped', 'interrupted']);

// The ONLY stepper node fields that ever ship. A whitelist, not a blacklist: when
// buildGraphManifest grows a key, this fails closed instead of leaking it.
const NODE_STRINGS = ['model', 'effort', 'subagentModel'];
const NODE_BOOLS = ['fanOut', 'askQuestions', 'awaitAll'];

// Every workflow id worca itself ships: wf_default, wf_auto and the seven V17 seed
// recipes, mapped to the name worca ships it under. FIXED vocabulary, zero user text —
// so those ids and names ship by default. Every other id is `wf_<slug of a name>`
// (workflows.mjs:303, auto/proposal.mjs:127), which is why the identity of anything
// else waits for `names`. Read from the constants, not copied, so a new shipped recipe
// classifies itself.
//
// The NAME must come from here too, never from the manifest. writeGraphWorkflow
// reserves only wf_default and wf_auto (workflows.mjs:295-345) — the seven seed ids are
// ordinary rows whose upsert does `ON CONFLICT(id) DO UPDATE SET name = excluded.name`,
// so an ordinary composer Save over `wf_full` keeps the stock id and replaces its name
// with user text. Keying off the id is what keeps the builtin arm free of user text.
const STOCK_WORKFLOW_NAMES = new Map([
  [GRAPH_DEFAULT_WORKFLOW.id, GRAPH_DEFAULT_WORKFLOW.name],
  [AUTO_WORKFLOW_ID, AUTO_WORKFLOW_NAME],
  ...SEED_TEMPLATES.map((t) => [t.id, t.name]),
]);

// ── small pure helpers (exported for direct unit tests) ───────────────────────

/** Tally review issues by severity. Unknown severities fold to 'minor', never drop. */
export function countIssues(reviews) {
  const counts = {};
  for (const s of SEVERITIES) counts[s] = 0;
  for (const review of reviews || []) {
    for (const issue of review.issues || []) counts[normalizeSeverity(issue.severity)] += 1;
  }
  return counts;
}

/**
 * max(step.cycle) per node id. On v2 rows pipeline_steps.cycle holds the execution
 * ORDINAL (orchestrator.mjs:1107), so this reads as "how many times this node ran" —
 * which is the signal a cost/quality report wants (D22).
 */
export function cyclesByNode(steps) {
  const out = {};
  for (const step of steps || []) {
    const nodeId = step.nodeId;
    if (!nodeId) continue;
    const cycle = Number(step.cycle);
    if (!Number.isFinite(cycle)) continue;
    if (!(nodeId in out) || cycle > out[nodeId]) out[nodeId] = cycle;
  }
  return out;
}

function pickNode(node, cyclesUsed, kind = node.kind) {
  const out = { id: node.id, kind: kind || 'agent' };
  if (node.key) out.key = node.key;
  if (node.label) out.label = node.label;
  // Falsy-guarded on purpose: subagentModel '' means "inherit", not a value.
  for (const f of NODE_STRINGS) if (node[f]) out[f] = node[f];
  for (const f of NODE_BOOLS) if (typeof node[f] === 'boolean') out[f] = node[f];
  if (Number.isInteger(node.arity)) out.arity = node.arity;
  const used = cyclesUsed[node.id];
  if (Number.isFinite(used)) out.cyclesUsed = used;
  return out;
}

function pickWire(wire) {
  const out = {
    id: wire.id,
    from: { node: wire.from?.node ?? null, port: wire.from?.port ?? null },
    to: { node: wire.to?.node ?? null, port: wire.to?.port ?? null },
    loop: !!wire.loop,
  };
  if (out.loop && Number.isFinite(Number(wire.maxCycles))) out.maxCycles = Number(wire.maxCycles);
  return out;
}

/**
 * The template block: a default-safe CLASS, with the identity behind `names`.
 *
 * D2 ships node keys and labels verbatim as workflow design, but it does NOT cover
 * this field. On an Auto run the classifier WRITES the template name from the task
 * text (auto/classify.mjs:156 -> orchestrator.mjs:361) and the id is a slug of that
 * same name (auto/proposal.mjs:127), so both are a paraphrase of the prompt — the
 * one class that must never ship unasked. Only a STOCK id is fixed vocabulary; a
 * user-saved `wf_<slug of the name the user typed>` waits for `names`, exactly as
 * guardrailFacts withholds `gr_<slug>` (D14).
 *
 * On the builtin arm the name is looked up by id in STOCK_WORKFLOW_NAMES rather than
 * read off the manifest, because `template.name` is a copy of the workflow ROW's name
 * and a seed row is renameable — see the map's comment. The id classifies; the
 * constants name.
 *
 * `auto.via === 'created'` overrides the id test: mintAutoWorkflowId avoids the two
 * reserved ids but not a seed id, and on a fresh home no seed row exists at all
 * (db.mjs:1311 seeds pre-existing DBs only), so a minted id CAN slug onto a stock
 * one. What the run did is authoritative over what the string looks like.
 */
function templateShape(template, auto, include) {
  if (!template) return null;
  const id = template.id || '';
  const name = template.name || '';
  const builtin = STOCK_WORKFLOW_NAMES.has(id) && auto?.via !== 'created';
  const out = { builtin, id: builtin ? id : null };
  if (builtin) out.name = STOCK_WORKFLOW_NAMES.get(id) ?? '';
  else if (include.names) { out.id = id; out.name = name; }
  return out;
}

/**
 * The workflow shape, whitelisted. Handles BOTH manifest generations: v2 carries
 * `graph.nodes`/`graph.wires`; the legacy v1 (73 of 146 persisted steppers) carries
 * only `{version, steps, feedbacks}`. The v2 guard mirrors
 * ui/public/graph/run-decor.mjs:58.
 */
export function workflowShape(stepper, cyclesUsed = {}, include = {}) {
  if (!stepper || typeof stepper !== 'object') return null;
  const isV2 = stepper.version === 2 && stepper.graph && Array.isArray(stepper.graph.nodes);
  const hasV1 = Array.isArray(stepper.steps) && stepper.steps.length > 0;
  if (!isV2 && !hasV1) return null;

  const nodes = isV2
    ? stepper.graph.nodes.map((n) => pickNode(n, cyclesUsed))
    : stepper.steps.flatMap((step) => (step.nodes || []).map(
        (n) => pickNode(n, cyclesUsed, step.kind === 'agent' || n.key ? 'agent' : step.kind)));

  const wires = isV2
    ? (stepper.graph.wires || []).map(pickWire)
    : (stepper.feedbacks || []).map((fb) => pickWire({
        id: fb.id, from: { node: fb.from, port: null }, to: { node: fb.to, port: null },
        loop: true, maxCycles: fb.maxCycles,
      }));

  return {
    manifestVersion: Number(stepper.version) || 1,
    template: isV2 ? templateShape(stepper.template, stepper.auto, include) : null,
    auto: stepper.auto
      ? { status: stepper.auto.status || '', via: stepper.auto.via || '',
          rounds: stepper.auto.rounds ?? null, humanInLoop: !!stepper.auto.humanInLoop }
      : null,
    nodes,
    wires,
  };
}

/** maxCycles of the loop wire landing on a node, or null. */
function maxCyclesFor(workflow, nodeId) {
  for (const wire of workflow?.wires || []) {
    if (wire.loop && wire.to.node === nodeId && Number.isFinite(wire.maxCycles)) return wire.maxCycles;
  }
  return null;
}

// ── fact extractors ───────────────────────────────────────────────────────────

function stepFacts(steps) {
  // No `key`: on v2 rows it is the executionId, which can embed a decomposed task
  // id. nodeId + cycle identifies a step just as well and carries nothing free-text.
  // stepRowToStep OMITS nodeId/agentKey/kind/endedAt when the column is NULL
  // (artifacts.mjs:1730-1747), hence `?? null` on every one.
  //
  // `agentKey ?? phase` is deliberate: agent_key is the strict field but is a later
  // column, so older v2 rows carry the key only in `phase`. Caveat for a reader — on a
  // FLOW node (and/or/combine) `agentKey` is null and `phase` holds the node KIND
  // (orchestrator.mjs:1109), so this field can read 'and'. Not a leak (both are
  // workflow vocabulary, D2), just not always an agent name.
  return (steps || []).map((s) => ({
    nodeId: s.nodeId ?? null,
    agentKey: s.agentKey ?? s.phase ?? null,
    kind: s.kind ?? null,
    cycle: Number.isFinite(Number(s.cycle)) ? Number(s.cycle) : null,
    status: s.status ?? null,
    costUsd: Number(s.costUsd) || 0,
    activeMs: Number(s.activeMs) || 0,
    startedAt: s.startedAt ?? null,
    endedAt: s.endedAt ?? null,
  }));
}

function subAgentFacts(rows) {
  // Dropped (D13): `label` (free text, e.g. "investigate auth"), `skills` (user and
  // plugin skill names), `id` (a tool_use id), `stepKey` (an executionId),
  // `uiPhase` (redundant with nodeId).
  return (rows || []).map((s) => ({
    nodeId: s.nodeId ?? null,
    cycle: Number.isFinite(Number(s.cycle)) ? Number(s.cycle) : null,
    status: s.status ?? null,
    subagentType: s.subagentType ?? null,
    runModel: s.runModel ?? null,
    tokens: s.tokens ?? null,
    costUsd: s.costUsd ?? null,
    durationMs: s.durationMs ?? null,
    graphifyCount: s.graphifyCount ?? null,
  }));
}

function reviewFacts(reviews) {
  const counts = countIssues(reviews);
  return {
    reviewCount: (reviews || []).length,
    blockingIssues: counts.critical + counts.major,
    issueCounts: counts,
    byReview: (reviews || []).map((r) => ({
      kind: r.kind ?? null, cycle: r.cycle ?? null, counts: countIssues([r]),
    })),
  };
}

const SUMMARY_KEYS = ['filesNew', 'filesChanged', 'filesDeleted',
                      'linesAdded', 'linesRemoved', 'blockingIssues', 'nitpicks'];

function fileFacts(results) {
  const summary = results && typeof results.summary === 'object' ? results.summary : null;
  if (!summary) return null;
  const out = {};
  for (const k of SUMMARY_KEYS) {
    const n = Number(summary[k]);
    if (Number.isFinite(n)) out[k] = n;
  }
  // A WORKSPACE run's results.json is { summary, perProject } (run-harness.mjs:2810)
  // and perProject is keyed BY PROJECT KEY. Ship the COUNT, never the keys (D9).
  if (results.perProject && typeof results.perProject === 'object') {
    out.projectCount = Object.keys(results.perProject).length;
  }
  return out;
}

function pickFile(f) {
  return { path: f.path ?? null, status: f.status ?? null,
           added: Number(f.added) || 0, removed: Number(f.removed) || 0 };
}

function toolFacts(tools) {
  if (!tools || typeof tools !== 'object') return null;
  // `instruction` is ~700 chars of fixed English boilerplate — dropped (D12).
  return {
    tool: tools.tool ?? null,
    kind: tools.kind ?? null,
    graphify: !!tools.graphify,
    codeReviewGraph: !!tools.codeReviewGraph,
  };
}

/**
 * Guardrails as counts, not contents: protectedPaths are user globs and
 * envAllowlist are env var names. A custom set's id is gr_<slug-of-user-name>,
 * so it ships only behind the `names` opt-in (D14). readGuardrailSet is async and
 * never throws for a bad id — it returns null (guardrail-store.mjs:66).
 */
async function guardrailFacts(guardrailsId, include) {
  if (!guardrailsId) return { legacy: true, id: null, builtin: null, origin: null };
  const builtin = isBuiltinGuardrailSetId(guardrailsId);
  const set = await readGuardrailSet(guardrailsId);
  const s = set && set.settings ? set.settings : null;
  // origin is 'builtin' | 'plugin:<name>' | null (guardrail-store.mjs:61) — reduce
  // it to a class so a plugin's name never rides along.
  const origin = set
    ? (set.origin === 'builtin' ? 'builtin'
       : String(set.origin || '').startsWith('plugin:') ? 'plugin' : 'user')
    : null;
  const facts = {
    legacy: false,
    id: builtin ? guardrailsId : null,
    builtin,
    origin,
    envScrub: s ? !!s.envScrub : null,
    honorProjectSettings: s ? !!s.honorProjectSettings : null,
    denyCount: s ? (s.deny || []).length : null,
    protectedPathCount: s ? (s.protectedPaths || []).length : null,
    envAllowlistCount: s ? (s.envAllowlist || []).length : null,
  };
  if (include.names && !builtin) {
    facts.id = guardrailsId;
    facts.name = set ? (set.name ?? null) : null;
  }
  return facts;
}

// ── evidence blocks ───────────────────────────────────────────────────────────

function costEvidence({ row, steps, subAgents, workflow }) {
  const budget = budgetStatus();
  const totals = subAgents.reduce((acc, s) => ({
    count: acc.count + 1,
    tokens: acc.tokens + (Number(s.tokens) || 0),
    costUsd: Math.round((acc.costUsd + (Number(s.costUsd) || 0)) * 1e4) / 1e4,
  }), { count: 0, tokens: 0, costUsd: 0 });

  return {
    topSteps: [...steps].sort((a, b) => b.costUsd - a.costUsd).slice(0, 5),
    subAgentTotals: totals,
    perNode: (workflow?.nodes || []).filter((n) => n.kind === 'agent').map((n) => ({
      key: n.key ?? null, model: n.model ?? null, effort: n.effort ?? null,
      subagentModel: n.subagentModel ?? null, fanOut: n.fanOut ?? null,
      cyclesUsed: n.cyclesUsed ?? null, maxCycles: maxCyclesFor(workflow, n.id),
    })),
    budget: {
      pipelineLimitUsd: budget.pipelineLimitUsd,
      totalLimitUsd: budget.totalLimitUsd,
      resetPeriod: budget.resetPeriod,
      windowSpendUsd: budget.windowSpendUsd,
      remainingUsd: budget.remainingUsd,
      blocked: budget.blocked,
    },
    costCapOverride: readCostCapOverride(row.id),
  };
}

function speedEvidence({ steps, workflow, tools, wallClockMs, activeMs }) {
  const byActive = [...steps].sort((a, b) => b.activeMs - a.activeMs);
  const top = byActive[0] || null;
  const share = (ms) => (wallClockMs ? Math.round((ms / wallClockMs) * 1000) / 1000 : null);
  // `activeMs` is the SUM of per-step active time; `wallClockMs` is elapsed time. With
  // fan-out — a first-class feature, and fanOutNodes sits in this very block — the sum
  // EXCEEDS the elapsed time, so the gap is not occupancy and `Math.max(0, …)` would
  // publish a 60s run as "0s waiting" with an activeShare above 1. Detect it and refuse
  // to assert: a null reads as "not measured", a clamped 0 reads as a finding.
  // The exact figure is the union of the step startedAt→endedAt intervals, which the
  // payload already carries per step for anyone who wants to compute it.
  const overSubscribed = wallClockMs != null && activeMs != null && activeMs > wallClockMs;
  return {
    wallClockMs,
    activeMs,
    overSubscribed,
    // The GAP is the finding: time the run was waiting rather than working.
    waitingMs: (!overSubscribed && wallClockMs != null && activeMs != null)
      ? Math.max(0, wallClockMs - activeMs) : null,
    activeShare: (!overSubscribed && activeMs != null) ? share(activeMs) : null,
    dominatingStep: top
      ? { nodeId: top.nodeId, agentKey: top.agentKey, cycle: top.cycle,
          activeMs: top.activeMs, share: share(top.activeMs) }
      : null,
    slowestSteps: byActive.slice(0, 5),
    fanOutNodes: (workflow?.nodes || []).filter((n) => n.fanOut).map((n) => n.key || n.id),
    tools,
  };
}

function failureEvidence({ row, state, steps }) {
  const status = row.status || '';
  const failed = steps.filter((s) => s.status === 'error' || s.status === 'stopped');
  const last = steps.length ? steps[steps.length - 1] : null;
  const pauseReason = state && state.pauseReason ? state.pauseReason : null;
  return {
    status,
    terminal: TERMINAL_STATUSES.has(status),
    interrupted: status === 'interrupted',
    // rowToState sets endReached/warnings ONLY inside the outcome branch
    // (artifacts.mjs:1798-1801), so probe with `in`, not for truthiness.
    endReached: state && 'endReached' in state ? !!state.endReached : null,
    warningCount: Array.isArray(state?.warnings) ? state.warnings.length : null,
    failedSteps: failed.map((s) => ({ nodeId: s.nodeId, agentKey: s.agentKey,
                                      cycle: s.cycle, status: s.status })),
    lastStepStatus: last ? last.status : null,
    // pauseDetail is a clipped RAW ERROR MESSAGE (errorDetail, run-harness.mjs:514)
    // and routinely embeds absolute paths — only the code and its fixed label ever
    // ship (D10).
    //
    // `done` (run-harness.mjs:1133) and `stopped` (:1166) NULL out resume_point, so
    // pauseReason is null there and failedSteps + status carry the signal. The `error`
    // branch does NOT clear it (its own comment at :1196 says so), so a failed run —
    // exactly the run this evidence block exists for — often DOES carry a reason code.
    pauseReason,
    // describePauseReason returns null ONLY for null/'' (a manual pause). An UNKNOWN
    // code falls through to the usage-limit row (failure-policy.mjs:187) and returns
    // 'session/usage limit reached', NOT null — its own JSDoc at :198 is wrong about
    // this. Never write `describePauseReason(x) ?? fallback`: an unrecognised legacy
    // code would be silently mislabelled as a usage limit rather than falling back.
    pauseReasonLabel: pauseReason ? describePauseReason(pauseReason) : null,
  };
}

// ── disk ──────────────────────────────────────────────────────────────────────

async function readRunArtifacts(row) {
  let dir;
  try { dir = await runDirForRow(row); } catch { return { results: null, overview: null }; }
  const readJson = async (name) => {
    try { return JSON.parse(await readFile(join(dir, name), 'utf8')); } catch { return null; }
  };
  // results.json and overview.json ONLY. The diff patch is never opened.
  return { results: await readJson(RESULTS_FILE), overview: await readJson(OVERVIEW_FILE) };
}

// ── the builder ───────────────────────────────────────────────────────────────

function normalizeReason(raw) {
  const id = typeof raw === 'string' ? raw.trim() : '';
  return REPORT_REASON_IDS.includes(id) ? id : 'something-else';
}

function parseJson(value) {
  if (value == null) return null;
  if (typeof value === 'object') return value;
  try { return JSON.parse(value); } catch { return null; }
}

/**
 * Build the report payload for one run.
 *
 * @param {string} pipelineId   short 8-hex id, or the `<date>-<slug>-<8hex>` dir name
 * @param {object} [opts]
 * @param {string} [opts.reason]        one of REPORT_REASON_IDS (unknown -> 'something-else')
 * @param {string} [opts.expectation]   the reporter's free text, clamped to EXPECTATION_MAX
 * @param {object} [opts.include]       { paths?, prompt?, names? } — all default false
 * @param {Date}   [opts.now]           injectable clock, for deterministic tests
 * @returns {Promise<object|null>} the payload, or null when the id is unknown
 */
export async function buildRunReport(pipelineId, opts = {}) {
  // findPipelineRowById is SYNC and returns the RAW snake_case row (artifacts.mjs:1882).
  const row = findPipelineRowById(pipelineId);
  if (!row) return null;

  const reason = normalizeReason(opts.reason);
  const include = normalizeInclude(opts.include);
  const expectation = typeof opts.expectation === 'string' && opts.expectation.trim()
    ? opts.expectation.trim().slice(0, EXPECTATION_MAX)
    : null;

  // All four of these are synchronous; only runDirForRow (inside readRunArtifacts)
  // is async. See the reader table in the plan's §2.2.
  const state = readPipelineStateById(row.id);
  const steps = stepFacts(state && state.steps);
  const subAgents = subAgentFacts(listSubAgents(row.id));
  const extras = readPipelineExtras(row.id);
  // totalsFor returns {cost, active} with each field independently number|null —
  // the function itself never returns null, so this destructure is safe.
  const totals = totalsFor(row);
  const { results, overview } = await readRunArtifacts(row);

  const startedMs = Date.parse(row.started_at || row.updated_at || '') || null;
  const endedMs = Date.parse(row.updated_at || row.started_at || '') || null;
  const wallClockMs = (startedMs && endedMs) ? Math.max(0, endedMs - startedMs) : null;

  const workflow = workflowShape(parseJson(row.stepper), cyclesByNode(steps), include);
  const tools = toolFacts(parseJson(row.tools));
  const review = reviewFacts(extras.reviews);
  const files = fileFacts(results);

  const payload = {
    schemaVersion: REPORT_SCHEMA_VERSION,
    generatedAt: (opts.now instanceof Date ? opts.now : new Date()).toISOString(),
    reason,
    expectation,
    included: include,
    app: {
      worca: WORCA_VERSION,
      node: process.version,
      platform: process.platform,
      arch: process.arch,
    },
    run: {
      id: row.id,
      target: row.target || 'project',
      status: row.status || '',
      phase: row.phase || '',
      cycle: Number(row.cycle) || 0,
      sourceType: row.source_type || 'prompt',
      engine: state && state.engine === 2 ? 2 : 1,
      startedAt: row.started_at || null,
      updatedAt: row.updated_at || null,
      wallClockMs,
      activeMs: totals.active,
      costUsd: totals.cost,
      costCapOverride: !!row.cost_cap_override,
    },
    workflow,
    tools,
    steps,
    subAgents,
    review,
    files,
    evidence: null,
  };

  switch (reason) {
    case 'too-expensive':
      payload.evidence = costEvidence({ row, steps, subAgents, workflow });
      break;
    case 'too-slow':
      payload.evidence = speedEvidence({ steps, workflow, tools, wallClockMs, activeMs: totals.active });
      break;
    case 'poor-quality':
      // `files` is COPIED, not aliased: the `paths` opt-in below mutates
      // payload.files, and the evidence block must stay counts-only (§4.1).
      payload.evidence = { ...review, cyclesUsed: cyclesByNode(steps), files: files ? { ...files } : null };
      break;
    case 'wrong-or-unsafe':
      payload.evidence = { guardrails: await guardrailFacts(row.guardrails_id, include), tools };
      break;
    case 'failed-or-stuck':
      payload.evidence = failureEvidence({ row, state, steps });
      break;
    default:
      payload.evidence = null; // 'something-else' leans on the always-on set
  }

  // ── opt-ins: ADD fields, never null them ────────────────────────────────────
  if (include.paths) {
    payload.review.issues = (extras.reviews || []).flatMap((r) => (r.issues || []).map((i) => ({
      severity: normalizeSeverity(i.severity),
      title: i.title ?? '',
      location: i.location ?? '',   // a file path — this is why it is gated
      kind: r.kind ?? null,
      cycle: r.cycle ?? null,
    })));
    if (payload.files && results) {
      if (Array.isArray(results.newFiles)) payload.files.newFiles = results.newFiles.map(pickFile);
      if (Array.isArray(results.changedFiles)) payload.files.changedFiles = results.changedFiles.map(pickFile);
    }
    // The cached narrative rides `paths` because overview-agent generates it FROM
    // the diff and routinely names files and identifiers (D7). Never generated here
    // — a miss is simply absent, and costs nothing.
    if (overview && typeof overview.narrative === 'string' && overview.narrative.trim()) {
      payload.narrative = overview.narrative.trim();
    }
  }

  if (include.prompt && row.prompt) payload.run.prompt = row.prompt;

  if (include.names) {
    if (row.title) payload.run.title = row.title;
    if (row.project_key) payload.run.projectKey = row.project_key;
    const branch = parseJson(row.branch);
    if (branch) {
      // worktreeDir is an absolute path — NEVER, under any opt-in.
      payload.run.branch = { source: branch.source ?? null, feature: branch.feature ?? null };
    }
    const meta = parseJson(row.workspace_meta);
    if (row.target === 'workspace' && meta) {
      payload.run.workspace = {
        name: meta.workspaceName ?? null,
        projectKeys: Array.isArray(meta.projectKeys) ? meta.projectKeys : [],
      };
    }
  }

  return payload;
}

export { reasonById };

// ── the GitHub issue body + URL ───────────────────────────────────────────────
// Worca makes NO network call and needs no token: it hands the browser a prefilled
// issues/new URL and the user presses the button.
//
// THE CAP. A prefilled `body=` is truncated by browser and server URL limits at
// roughly 8 KB. So the body is a SHORT narrative plus a compact metrics table, and
// the FULL JSON goes on the clipboard with the body ASKING for the paste. Over the
// cap we trim by binary-searching the longest fitting prefix (exact and O(log n); a
// fixed-step shrink loop is O(n) on a long body and can overshoot).

export const ISSUE_URL_MAX = 8000;

const TRUNCATION_NOTICE =
  '\n\n_This prefilled report was truncated to fit a URL. Press **Copy JSON** in Worca and paste the full report here._';

// An UNPAIRED surrogate: a high one not followed by a low, or a low one not preceded
// by a high. Matching the whole [\uD800-\uDFFF] range instead would replace BOTH halves
// of every VALID pair as well, so one split emoji at the truncation index would turn
// every other emoji in the body into a pair of replacement characters — and would make
// enc()'s length non-monotonic in the slice index, costing the binary search its
// exactness. Only the genuinely broken code unit is replaced.
const LONE_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g;

/**
 * encodeURIComponent that CANNOT throw. The truncator slices `body` at an arbitrary
 * index, which can cut a surrogate pair in half, and encodeURIComponent raises
 * `URIError: URI malformed` on a lone surrogate — one emoji in the reporter's free
 * text (or in a `paths`-opted narrative) would otherwise 500 the route. Both the
 * length probe and the final encode go through here, so the two always agree.
 */
function enc(text) {
  const s = String(text);
  try {
    return encodeURIComponent(s);
  } catch {
    return encodeURIComponent(s.replace(LONE_SURROGATE, '�'));
  }
}

function fmtUsd(n) { return n == null ? '—' : `$${Number(n).toFixed(4)}`; }

function fmtMs(n) {
  if (n == null) return '—';
  const secs = Math.round(Number(n) / 1000);
  if (secs < 60) return `${secs}s`;
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m ${secs % 60}s`;
  return `${Math.floor(mins / 60)}h ${mins % 60}m`;
}

function metricRows(p) {
  const rows = [
    ['worca', p.app.worca],
    ['node', p.app.node],
    ['platform', `${p.app.platform}/${p.app.arch}`],
    ['status', `${p.run.status} (phase ${p.run.phase}, cycle ${p.run.cycle})`],
    ['cost', fmtUsd(p.run.costUsd)],
    ['active time', fmtMs(p.run.activeMs)],
    ['wall clock', fmtMs(p.run.wallClockMs)],
    ['steps / sub-agents', `${p.steps.length} / ${p.subAgents.length}`],
  ];
  if (p.workflow) {
    // `name` is present only for a stock template or under `names` (templateShape),
    // and a v1 manifest has no template block at all — both read as 'custom' here.
    const tpl = p.workflow.template;
    rows.push(['workflow', `${(tpl && tpl.name) || 'custom'} ` +
      `(manifest v${p.workflow.manifestVersion}, ${p.workflow.nodes.length} nodes)`]);
  }
  if (p.review) {
    rows.push(['review issues',
      SEVERITIES.map((s) => `${p.review.issueCounts[s]} ${s}`).join(', ')]);
  }
  if (p.files) {
    const touched = (p.files.filesNew ?? 0) + (p.files.filesChanged ?? 0);
    rows.push(['files', `+${p.files.linesAdded ?? 0} / −${p.files.linesRemoved ?? 0} across ${touched} files`]);
  }
  const ev = p.evidence || {};
  if (p.reason === 'too-slow' && ev.waitingMs != null) {
    rows.push(['waiting vs working', `${fmtMs(ev.waitingMs)} waiting / ${fmtMs(ev.activeMs)} working`]);
  }
  if (p.reason === 'too-expensive' && ev.budget) {
    rows.push(['per-run cost cap',
      ev.budget.pipelineLimitUsd == null ? 'none set' : fmtUsd(ev.budget.pipelineLimitUsd)]);
  }
  if (p.reason === 'failed-or-stuck' && Array.isArray(ev.failedSteps)) {
    rows.push(['failed steps', String(ev.failedSteps.length)]);
  }
  if (p.reason === 'wrong-or-unsafe' && ev.guardrails) {
    rows.push(['guardrails', ev.guardrails.legacy ? 'not recorded (legacy run)'
      : ev.guardrails.builtin ? ev.guardrails.id : 'a custom set']);
  }
  return rows;
}

/** A title with no user text in it — the title rides the URL and must stay short. */
export function issueTitle(payload) {
  const reason = reasonById(payload.reason);
  return `Run report: ${reason ? reason.label.toLowerCase() : payload.reason} (worca ${payload.app.worca})`;
}

/**
 * The prefilled issue body: a short narrative + a compact metrics table.
 *
 * The closing paragraph ASKS for the paste (D23). v1 asserted the JSON was already
 * on the clipboard, which was a lie for anyone who clicked the issue link without
 * pressing Copy JSON first; the modal now copies on that click, and this wording
 * still reads correctly when the copy was blocked.
 */
export function renderIssueBody(payload) {
  const reason = reasonById(payload.reason);
  const lines = [
    `**What went wrong:** ${reason ? reason.label : payload.reason}`,
    '',
    `Reported from Worca ${payload.app.worca} about run \`${payload.run.id}\`.`,
  ];
  if (payload.expectation) {
    lines.push('', '**What I expected:**', '', payload.expectation);
  }
  lines.push('', '| Metric | Value |', '| --- | --- |');
  for (const [key, value] of metricRows(payload)) lines.push(`| ${key} | ${value} |`);
  if (payload.narrative) {
    lines.push('', '**What this run did** (from its cached overview):', '', payload.narrative);
  }
  lines.push(
    '',
    '---',
    '',
    `**Paste the full JSON report below** (schema v${payload.schemaVersion}) — Worca put it on ` +
    'your clipboard when you opened this link. If the paste comes up empty, press ' +
    '**Copy JSON** in the Worca report dialog and try again.',
    '',
    '<!-- paste the copied JSON here -->',
  );
  return lines.join('\n');
}

/**
 * The prefilled issues/new URL, capped.
 *
 * @returns {{url:string, title:string, body:string, truncated:boolean, length:number}}
 */
export function buildIssueUrl(payload, { bugsUrl = BUGS_URL, maxLength = ISSUE_URL_MAX } = {}) {
  const root = String(bugsUrl || '').replace(/\/+$/, '');
  const title = issueTitle(payload);
  const full = renderIssueBody(payload);
  // No bugs.url anywhere => no link. A relative "/new?…" would navigate the SPA.
  if (!root) return { url: '', title, body: full, truncated: false, length: 0 };

  const base = `${root}/new`;
  const head = `${base}?labels=${enc(payload.reason)}&title=${enc(title)}&body=`;
  const fit = (text) => head.length + enc(text).length;

  if (fit(full) <= maxLength) {
    return { url: head + enc(full), title, body: full, truncated: false, length: fit(full) };
  }
  // Even the notice alone will not fit: drop the body parameter rather than overflow.
  // Then keep degrading — title, then the query, then the URL itself — because the cap
  // is unconditional. Dropping only `body=` still overflowed every maxLength below the
  // ~131-char labels+title head; no production caller gets there (ISSUE_URL_MAX is
  // 8000 and both labels and title are bounded), but the contract is what is tested.
  if (fit(TRUNCATION_NOTICE) > maxLength) {
    const shed = (url) => ({ url, title, body: '', truncated: true, length: url.length });
    const withTitle = `${base}?labels=${enc(payload.reason)}&title=${enc(title)}`;
    if (withTitle.length <= maxLength) return shed(withTitle);
    const withLabel = `${base}?labels=${enc(payload.reason)}`;
    if (withLabel.length <= maxLength) return shed(withLabel);
    // A bare base is still a usable "open a new issue" link; below that, nothing is.
    return shed(base.length <= maxLength ? base : '');
  }
  // Longest prefix of `full` whose encoded length + the notice still fits.
  // `fit` is monotonic non-decreasing in `mid` (a split pair costs 9 encoded chars as
  // one U+FFFD, a whole pair 12, neither one 0 — and enc() only rewrites the UNPAIRED
  // unit), so this is a plain "last true" binary search. Note the safety property that
  // holds even if that monotonicity were ever lost: `lo` is only ever assigned a `mid`
  // whose `fit` was TESTED to fit, so the returned body always satisfies the cap.
  let lo = 0;
  let hi = full.length;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (fit(full.slice(0, mid) + TRUNCATION_NOTICE) <= maxLength) lo = mid; else hi = mid - 1;
  }
  const body = full.slice(0, lo) + TRUNCATION_NOTICE;
  return { url: head + enc(body), title, body, truncated: true, length: fit(body) };
}

/** Stable, path-safe filename for the Download JSON button. Shared with the UI. */
export function reportFilename(payload) {
  const id = String(payload?.run?.id || 'run').replace(/[^a-zA-Z0-9._-]/g, '-');
  const reason = String(payload?.reason || 'report').replace(/[^a-zA-Z0-9._-]/g, '-');
  return `worca-run-report-${id}-${reason}.json`;
}
