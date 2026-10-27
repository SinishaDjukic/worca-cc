// src/core/workflow-tests/service.mjs
// The Tests pages' read models (plans/workflow-tests-part2-plan.md Task 9): the overview (boards 1, 19), a past run as an
// example (board 3, D29), the plan of a test (board 4), its progress (board 20), the compare (board 5) and one example
// side by side (board 6). Writes go through store.mjs and runner.mjs.
import { readFile } from 'node:fs/promises';
import { join, basename } from 'node:path';
import { getDb, prepare } from '../db.mjs';
import { isSafeWorkflowId } from '../workflows.mjs';
import { isReservedWorkflowId } from '../graph/builtin-workflows.mjs';
import { isVersionableRow, liveVersionNo, latestVersion } from '../workflow-revisions.mjs';
import { loadAgentRegistry } from '../agent-registry.mjs';
import { findPipelineRowById, readStepQuestions, readClarifyRow, runDirForRow } from '../artifacts.mjs';
import { NO_PROJECT_KEY, isNoProjectKey } from '../store.mjs';
import { diffGraphs } from '../../shared/graph/diff-graphs.mjs';
import { basicsList } from '../../shared/workflow-tests/checks.mjs';
import { useLabel, testTitle, latestTitle, compareModel, TRIES_AT_ONCE } from '../../shared/workflow-tests/compare.mjs';
import { loadScriptRegistry } from '../script-registry.mjs';
import * as store from './store.mjs';
import { useGraph, useFingerprint } from './uses.mjs';
import { testTargetOf } from './try-body.mjs';
import { mainResult } from './result.mjs';
import { connectorNotes, userScopeServerNames, seenClaudeAiServers, wouldHaveSent, stepEngines } from './connectors.mjs';

export const NOT_TESTABLE_TEXT = 'This workflow works on a project, and tests work for workflows without a project for now.';
export const NOT_TESTABLE_REASONS = Object.freeze({
  'test-try': 'A test try cannot become an example.',
  'not-finished': 'Wait until the run has finished.',
  'project-run': 'This run worked on a project: tests try workflows without a project for now.',
  'needs-project': NOT_TESTABLE_TEXT,
  'not-versionable': 'Its workflow comes from a plugin or is built in, so it has no tests.',
  'no-workflow': 'Its workflow was deleted.',
});
const PREVIEW_MAX = 4000;
const FIN = new Set(store.FINISHED);
const err = store.testError;
const parse = (t, f) => { try { return JSON.parse(t) ?? f; } catch { return f; } };
const templateIdSql = "json_extract(CASE WHEN json_valid(stepper) THEN stepper END, '$.template.id')";

/** A saved user workflow that can have tests: a format-2 row no plugin owns (D5). */
export function workflowRowOf(workflowId) {
  if (!isSafeWorkflowId(workflowId) || isReservedWorkflowId(workflowId)) throw err(`unknown workflow "${workflowId}"`, 'NOT_FOUND');
  getDb();
  const row = prepare('SELECT id, name, version, graph, origin, archived_at FROM workflows WHERE id = ?').get(workflowId);
  if (!row || row.archived_at) throw err(`unknown workflow "${workflowId}"`, 'NOT_FOUND');
  if (!isVersionableRow(row)) throw err(`"${row.name}" cannot have tests: it comes from a plugin or is not a graph`, 'NOT_VERSIONABLE');
  return { ...row, graph: parse(row.graph, {}) };
}

/** D20: whether Part 2 can test this workflow (try-body.mjs decides). */
export function testTarget(workflowId, { registry = loadAgentRegistry() } = {}) {
  const row = workflowRowOf(workflowId);
  return { row, ...testTargetOf(row.graph, registry) };
}

export function labelCtx(workflowId) {
  const latest = latestVersion(workflowId);
  return { liveVersionNo: liveVersionNo(workflowId), latestVersionNo: latest ? latest.versionNo : null };
}

export function runOf(workflowId, runId) {
  const run = store.readTestRun(runId);
  if (!run || run.workflowId !== workflowId) throw err(`no test ${runId}`, 'NOT_FOUND');
  return run;
}

const avgOf = (sql, ...params) => { const r = prepare(sql).get(...params); return r && Number(r.n) > 0 && r.c !== null ? Number(r.c) : null; };

/** What one try of `use` usually costs: its last real tries, else any use's, else the workflow's own finished runs. null = unknown (C12). */
export function perTryCost(workflowId, use) {
  getDb();
  return avgOf(`SELECT AVG(cost_usd) AS c, COUNT(*) AS n FROM (SELECT cost_usd FROM wf_test_tries WHERE workflow_id = ? AND use_ref = ?
      AND mock = 0 AND status IN ('passed', 'failed') ORDER BY id DESC LIMIT 10)`, workflowId, store.useRef(use))
    ?? avgOf(`SELECT AVG(cost_usd) AS c, COUNT(*) AS n FROM (SELECT cost_usd FROM wf_test_tries WHERE workflow_id = ?
      AND mock = 0 AND status IN ('passed', 'failed') ORDER BY id DESC LIMIT 10)`, workflowId)
    ?? avgOf(`SELECT AVG(total_cost_usd) AS c, COUNT(*) AS n FROM (SELECT total_cost_usd FROM pipelines WHERE is_test IS NULL
      AND status = 'done' AND total_cost_usd > 0 AND ${templateIdSql} = ? ORDER BY started_at DESC LIMIT 20)`, workflowId);
}

/** How long one try usually takes, in ms; null = unknown. */
export function perTryMs(workflowId) {
  getDb();
  return avgOf(`SELECT AVG((julianday(finished_at) - julianday(started_at)) * 86400000) AS c, COUNT(*) AS n FROM (SELECT started_at, finished_at
      FROM wf_test_tries WHERE workflow_id = ? AND mock = 0 AND status IN ('passed', 'failed') AND started_at IS NOT NULL
      AND finished_at IS NOT NULL ORDER BY id DESC LIMIT 10)`, workflowId)
    ?? avgOf(`SELECT AVG((julianday(updated_at) - julianday(started_at)) * 86400000) AS c, COUNT(*) AS n FROM (SELECT started_at, updated_at
      FROM pipelines WHERE is_test IS NULL AND status = 'done' AND started_at IS NOT NULL AND updated_at IS NOT NULL
      AND ${templateIdSql} = ? ORDER BY started_at DESC LIMIT 20)`, workflowId);
}

const normPrompt = (s) => String(s ?? '').normalize('NFKC').toLowerCase().replace(/\s+/g, ' ').trim();
const extrasOf = (pipelineId) => prepare("SELECT rel_path FROM artifacts WHERE pipeline_id = ? AND kind = 'extra' ORDER BY rel_path")
  .all(pipelineId).map((r) => r.rel_path);

/** Board 19 / G4, G7: the workflow's newest finished no-project runs (never a try); an exactly equal request is "the same". */
export function recentRuns(workflowId, { limit = 10 } = {}) {
  getDb();
  const rows = prepare(`SELECT id, title, prompt, status, started_at FROM pipelines WHERE project_key = ? AND is_test IS NULL
      AND archived_at IS NULL AND deleted_at IS NULL AND status IN ('done', 'stopped', 'error') AND ${templateIdSql} = ?
      ORDER BY started_at DESC LIMIT ?`).all(NO_PROJECT_KEY, workflowId, limit);
  const first = new Map();
  return rows.map((r) => {
    const key = normPrompt(r.prompt);
    const sameAs = key && first.has(key) ? first.get(key) : null;
    if (key && !first.has(key)) first.set(key, r.title || r.id);
    return { pipelineId: r.id, title: r.title || r.id, at: r.started_at, status: r.status, files: extrasOf(r.id).length, sameAs };
  });
}

/** The questions a past run asked and the answers it got (Clarify and the agents' own rounds), as canned answers. */
function pastAnswers(pipelineId) {
  const out = [];
  const add = (question, answer) => {
    const q = String(question || '').trim();
    const a = String(answer || '').trim();
    if (out.length >= store.ANSWERS_MAX) return;   // an example keeps at most this many (normaliseExample)
    if (q && a && !out.some((x) => x.question === q)) out.push({ question: q.slice(0, 500), answer: a.slice(0, 2000) });
  };
  const c = readClarifyRow(pipelineId);
  const asked = new Map(((c.questions && c.questions.questions) || []).map((q) => [q.id, q.question]));
  for (const a of (c.answers && c.answers.answers) || []) add(a.question || asked.get(a.id), a.choice);
  for (const r of readStepQuestions(pipelineId)) {
    const qs = new Map(r.questions.map((q) => [q.id, q.question]));
    for (const a of r.answers) add(a.question || qs.get(a.id), a.choice);
  }
  return out;
}

/** Board 3: what "Use this run as a test example" keeps, and whether it can. */
export async function pastRunSummary(pipelineId, { registry = loadAgentRegistry() } = {}) {
  getDb();
  const row = findPipelineRowById(pipelineId);
  if (!row || row.archived_at || row.deleted_at) throw err('no such run', 'NOT_FOUND');
  const stepper = parse(row.stepper, {});
  const tpl = stepper && stepper.template ? stepper.template : {};
  const workflowId = typeof tpl.id === 'string' ? tpl.id : null;
  const use = stepper && stepper.workflowVersion && Number.isInteger(stepper.workflowVersion.no) ? stepper.workflowVersion.no : 'draft';
  let reason = null;
  let target = null;
  if (row.is_test) reason = 'test-try';
  else if (!['done', 'stopped', 'error'].includes(row.status)) reason = 'not-finished';
  else if (!isNoProjectKey(row.project_key)) reason = 'project-run';
  else {
    try { target = testTarget(workflowId || '', { registry }); if (!target.testable) reason = 'needs-project'; }
    catch (e) { reason = e && e.code === 'NOT_VERSIONABLE' ? 'not-versionable' : 'no-workflow'; }
  }
  const ctx = target ? labelCtx(workflowId) : {};
  return {
    pipelineId: row.id, workflowId, workflowName: target ? target.row.name : (tpl.name || ''),
    title: row.title || '', request: row.prompt || '', files: extrasOf(row.id).map((p) => basename(p)), qa: pastAnswers(row.id),
    use, useLabel: use === 'draft' ? 'your draft' : useLabel(use, ctx), testable: !reason, reason,
    reasonText: reason ? NOT_TESTABLE_REASONS[reason] : null,
  };
}

/** Board 3 → an example; `skipped` names the files that did not fit (5 MB, 8 files). */
const exampleName = (name, past) => (typeof name === 'string' && name.trim() ? name.trim() : past.title || 'Example').slice(0, 120);

/** A past run that can become an example of `workflowId`, or the error why not. */
async function usablePastRun(workflowId, pipelineId, registry) {
  const past = await pastRunSummary(pipelineId, registry ? { registry } : {});
  if (past.workflowId !== workflowId) throw err('this run is of another workflow', 'BAD_REQUEST');
  if (!past.testable) throw err(NOT_TESTABLE_REASONS[past.reason] || NOT_TESTABLE_TEXT, past.reason === 'needs-project' ? 'NOT_TESTABLE' : 'BAD_REQUEST');
  return past;
}

export async function exampleFromRun(workflowId, { pipelineId, name, keepRequest = true, keepAnswers = true, verdict = null, note = null } = {}, { by = null, registry } = {}) {
  const past = await usablePastRun(workflowId, pipelineId, registry);
  if (verdict !== null && verdict !== 'good' && verdict !== 'not-good') throw err('verdict must be "good" or "not-good"', 'BAD_REQUEST');
  const clean = exampleName(name, past);
  const example = store.createExample(workflowId, { name: clean, request: keepRequest ? past.request : '', answers: keepAnswers ? past.qa : [], note },
    { by, from: { pipelineId: past.pipelineId, use: past.use, verdict } });
  const skipped = [];
  if (keepRequest) {
    const row = findPipelineRowById(past.pipelineId);
    const dir = await runDirForRow(row);
    for (const rel of extrasOf(row.id)) {
      try { store.putExampleFile(workflowId, example.id, { name: basename(rel), data: await readFile(join(dir, rel)) }); }
      catch { skipped.push(basename(rel)); }
    }
  }
  return { example: store.readExample(workflowId, example.id), skipped };
}

/** Board 19's "Add N examples": every picked run with its request, files and answers, no verdict (G4). Each run once;
 *  all of them are checked first, so a run that cannot become an example adds none. */
export async function examplesFromRuns(workflowId, pipelineIds, opts = {}) {
  const ids = [...new Set(pipelineIds)];
  for (const id of ids) {
    const past = await usablePastRun(workflowId, id, opts.registry);
    // The example as exampleFromRun would write it (a request too long, …): its first error, before anything is added.
    const { errors } = store.normaliseExample({ name: exampleName(undefined, past), request: past.request, answers: past.qa });
    if (errors.length) throw err(errors[0], 'BAD_REQUEST', { errors });
  }
  const examples = [];
  const skipped = [];
  for (const id of ids) {
    const r = await exampleFromRun(workflowId, { pipelineId: id }, opts);
    examples.push(r.example);
    skipped.push(...r.skipped);
  }
  return { examples, skipped };
}

function cellOf(ex, use, fpNow) {
  const tries = store.latestTriesFor({ workflowId: ex.workflowId, exampleId: ex.id, use });
  if (tries.length) {
    return { passed: tries.filter((t) => t.status === 'passed').length, total: tries.length,
      stale: tries.some((t) => t.fp !== fpNow || t.exampleFp !== ex.fingerprint), past: null };
  }
  if (ex.from && ex.from.verdict && ex.from.use != null && store.useRef(ex.from.use) === store.useRef(use)) {
    return { passed: null, total: null, stale: false, past: ex.from.verdict };   // D29
  }
  return null;
}

const firstExampleName = (run) => { const ex = store.readExample(run.workflowId, run.exampleIds[0]); return ex ? ex.name : ''; };
function modelInput(run, ctx) {
  const examples = run.exampleIds.map((id) => store.readExample(run.workflowId, id)).filter(Boolean).map(({ id, name }) => ({ id, name }));
  return { examples, a: run.a != null ? { label: useLabel(run.a, ctx) } : null, b: { label: useLabel(run.b, ctx) }, tries: store.triesOfRun(run.id) };
}

/** Boards 1 and 19 in one read. */
export async function testsOverview(workflowId, { registry = loadAgentRegistry(), fingerprintOf = (id, use) => useFingerprint(id, use) } = {}) {
  const { row, testable, reason } = testTarget(workflowId, { registry });
  const ctx = labelCtx(workflowId);
  const uses = [...(ctx.liveVersionNo ? [ctx.liveVersionNo] : []), 'draft'];
  const fpNow = {};
  for (const use of uses) {
    try { fpNow[store.useRef(use)] = await fingerprintOf(workflowId, use); } catch { fpNow[store.useRef(use)] = null; }
  }
  const examples = store.listExamples(workflowId).map((ex) => {
    const from = ex.from ? findPipelineRowById(ex.from.pipelineId) : null;
    return {
      id: ex.id, name: ex.name, hasRequest: !!ex.request.trim(), files: ex.files.map((f) => f.name),
      fromAt: from ? from.started_at || null : null, note: ex.note, tries: ex.tries,
      basics: basicsList(ex.basics).length, checks: ex.checks.length,
      cells: Object.fromEntries(uses.map((use) => [store.useRef(use), cellOf(ex, use, fpNow[store.useRef(use)])])),
    };
  });
  const runs = store.listTestRuns(workflowId, { limit: 20 });
  const running = runs.find((r) => r.status === 'running') || null;
  const last = runs.find((r) => r.kind === 'compare' && r.status !== 'running') || null;
  const own = running ? store.triesOfRun(running.id).filter((t) => t.runId === running.id) : [];
  return {
    workflowId, name: row.name, testable, reason, ctx,
    columns: uses.map((use) => ({ use, label: useLabel(use, ctx, 'column') })),
    examples,
    running: running ? { runId: running.id, title: testTitle(running, ctx, { mode: 'testing', exampleName: firstExampleName(running) }),
      done: own.filter((t) => FIN.has(t.status)).length, total: own.length } : null,
    latest: last ? { runId: last.id, title: latestTitle(last, ctx), finishedAt: last.finishedAt, examples: last.exampleIds.length,
      tries: last.tries, costUsd: store.spentOfRun(last.id), counts: compareModel(modelInput(last, ctx)).counts, status: last.status,
      stopReason: last.stopReason } : null,
    pastRuns: recentRuns(workflowId),
  };
}

/**
 * Board 30's notes (D35): the connectors a try without a project would load (the server's preview: the registry copies,
 * `untested` = no stand-in, and the servers from a project file), the ones Claude Code loads by itself, the workflow's
 * script steps on either side, and the engines other than Claude its agent steps run on. Read when the dialog asks, so
 * the engine is today's `run.engine` (`runEngine` overrides it, a test seam).
 */
async function connectorsOf(workflowId, uses, { connectorsPreview = null, runEngine = null } = {}) {
  let preview = {};
  let previewError = false;   // the dialog says it could not read the connectors, never "none"
  try { preview = connectorsPreview ? (await connectorsPreview()) || {} : {}; } catch { preview = {}; previewError = true; }
  const copies = Array.isArray(preview.copies) ? preview.copies : [];
  const fileServers = Array.isArray(preview.fileServers) ? preview.fileServers : [];
  let scripts = {};
  try { scripts = loadScriptRegistry() || {}; } catch { scripts = {}; }
  const names = [];
  const engines = [];
  for (const use of uses) {
    const g = use == null ? null : await useGraph(workflowId, use);
    for (const n of g ? g.nodes : []) if (n && n.kind === 'script') names.push((scripts[n.key] && scripts[n.key].displayName) || n.key || 'script');
    if (g) engines.push(...stepEngines(g, { runEngine }));
  }
  const notes = connectorNotes({ copies, fileServers, userScope: userScopeServerNames(), claudeAi: seenClaudeAiServers(), scripts: names, engines });
  return previewError ? { ...notes, previewError: true } : notes;
}

/** Board 4: per version, what would be tried, what can be reused, and what a try usually costs; board 30's notes. */
export async function testPlan(workflowId, { a = null, b = 'draft', exampleIds = [], tries = 3, connectors = 'pretend' } = {},
  { fingerprintOf = (id, use) => useFingerprint(id, use), mock = false, connectorsPreview = null, runEngine = null } = {}) {
  workflowRowOf(workflowId);
  const ctx = labelCtx(workflowId);
  const all = store.listExamples(workflowId);
  const examples = exampleIds.length ? all.filter((e) => exampleIds.includes(e.id)) : all;
  const side = async (use) => {
    if (use == null) return null;
    let fp = null;
    try { fp = await fingerprintOf(workflowId, use); } catch { fp = null; }
    let reusable = 0;
    let at = null;
    if (fp) {
      for (const ex of examples) {
        const kept = store.reusableTries({ workflowId, exampleId: ex.id, use, fp, exampleFp: ex.fingerprint, mock, connectors, limit: tries });
        reusable += kept.length;
        for (const t of kept) if (t.finishedAt && (!at || t.finishedAt > at)) at = t.finishedAt;
      }
    }
    const perTryUsd = perTryCost(workflowId, use);
    return { use, label: useLabel(use, ctx, 'select'), short: useLabel(use, ctx), want: examples.length * tries, reusable,
      reusableAt: at, perTryUsd, savesUsd: perTryUsd === null ? null : reusable * perTryUsd };
  };
  return { a: await side(a), b: await side(b), examples: examples.length, tries, perTryMs: perTryMs(workflowId),
    connectors: { mode: connectors, ...(await connectorsOf(workflowId, [a, b], { connectorsPreview, runEngine })) } };
}

/** C9 and board 20's "So far" column. */
function rowSummary(list, run) {
  const n = list.length;
  const tried = list.filter((t) => FIN.has(t.status)).length;
  const passed = list.filter((t) => t.status === 'passed').length;
  if (n && tried === n) return `Done · ${passed} of ${n} passed`;
  const running = list.findIndex((t) => t.status === 'running');
  if (running >= 0) return `Trying ${running + 1} of ${n}`;
  if (run.status !== 'running') return `Not finished · ${tried} of ${n} tried`;
  return tried ? `Tried ${tried} of ${n}` : 'Waiting';
}

/**
 * Boards 27/28's "Time taken" of a stopped or done test, in ms (null while it runs, or when nothing has times): how long
 * its own tries ran (startedAt → finishedAt), counted once where tries ran at the same time, so the stopped time before
 * a "Finish the rest" is left out and a try reused from an earlier test adds nothing. A test none of whose tries ran
 * (the quick check stopped it) takes its own createdAt → finishedAt. Not counted: the free quick check (a mock run of
 * seconds, with no times of its own) and a stopped try made again by Finish the rest (unlinked from the run).
 */
export function takenMs(run, tries) {
  if (!run || run.status === 'running') return null;
  const spans = (tries || []).filter((t) => t.runId === run.id)
    .map((t) => [Date.parse(t.startedAt), Date.parse(t.finishedAt)]).filter(([s, e]) => Number.isFinite(s) && Number.isFinite(e) && e >= s)
    .sort((x, y) => x[0] - y[0]);
  if (!spans.length) {
    const s = Date.parse(run.createdAt);
    const e = Date.parse(run.finishedAt);
    return Number.isFinite(s) && Number.isFinite(e) && e >= s ? e - s : null;
  }
  let total = 0;
  let [from, to] = spans[0];
  for (const [s, e] of spans.slice(1)) {
    if (s > to) { total += to - from; [from, to] = [s, e]; } else if (e > to) to = e;
  }
  return total + (to - from);
}

/** Board 20 (G8: two rows per example when both versions need tries). `costOf` = the runner's live cost. */
export function progressOf(workflowId, runId, { costOf = null } = {}) {
  const run = runOf(workflowId, runId);
  const ctx = labelCtx(workflowId);
  const tries = store.triesOfRun(run.id);
  const own = tries.filter((t) => t.runId === run.id);
  const both = run.a != null && own.some((t) => t.side === 'a');
  const sides = both ? ['a', 'b'] : ['b'];
  const rows = [];
  for (const id of run.exampleIds) {
    const ex = store.readExample(workflowId, id);
    for (const side of sides) {
      const list = tries.filter((t) => t.exampleId === id && t.side === side).sort((x, y) => x.tryNo - y.tryNo || x.id - y.id);
      rows.push({ exampleId: id, name: ex ? ex.name : 'A deleted example', label: both ? useLabel(side === 'a' ? run.a : run.b, ctx) : null,
        dots: list.map((t) => t.status), summary: rowSummary(list, run) });
    }
  }
  const costBy = new Map();
  const costFor = (use) => { const k = store.useRef(use); if (!costBy.has(k)) costBy.set(k, perTryCost(workflowId, use)); return costBy.get(k); };
  const estimateUsd = own.reduce((s, t) => { const c = costFor(t.use); return s === null || c === null ? null : s + c; }, 0);
  const remaining = own.filter((t) => t.status === 'waiting' || t.status === 'running').length;
  const ms = perTryMs(workflowId);
  return {
    run, title: testTitle(run, ctx, { mode: 'testing', exampleName: firstExampleName(run) }), rows,
    done: own.filter((t) => FIN.has(t.status)).length, total: own.length,
    costUsd: costOf ? costOf(run.id) : store.spentOfRun(run.id), estimateUsd, capUsd: run.capUsd,
    minutesLeft: ms !== null && remaining ? Math.max(1, Math.ceil((Math.ceil(remaining / TRIES_AT_ONCE) * ms) / 60000)) : null,
    takenMs: takenMs(run, own),
    quick: run.quick,
  };
}

async function changesBetween(workflowId, a, b, registry) {
  const ga = await useGraph(workflowId, a);
  const gb = await useGraph(workflowId, b);
  if (!ga || !gb) return [];
  const labelOf = (n) => (n && n.kind === 'agent' && registry[n.key] && registry[n.key].displayName) || (n && (n.key || n.kind)) || 'step';
  return diffGraphs(ga, gb, { labelOf }).map((c) => c.text);
}

/** Board 5: the model, Part 1's "what you changed" texts (graph changes only, D16), and the fair-comparison notes. */
export async function compareOf(workflowId, runId, { registry = loadAgentRegistry(), fingerprintOf = (id, use) => useFingerprint(id, use) } = {}) {
  const run = runOf(workflowId, runId);
  const ctx = labelCtx(workflowId);
  const input = modelInput(run, ctx);
  const changes = run.a != null ? await changesBetween(workflowId, run.a, run.b, registry) : [];
  const fair = [];
  for (const [use, fp] of [[run.a, run.aFp], [run.b, run.bFp]]) {
    if (use == null) continue;
    let now = null;
    try { now = await fingerprintOf(workflowId, use); } catch { now = null; }
    if (now !== fp) fair.push(use === 'draft' ? 'Your draft changed after this test.' : `${useLabel(use, ctx)} runs changed agent or script text since this test.`);
  }
  for (const id of run.exampleIds) {
    const ex = store.readExample(workflowId, id);
    if (!ex) fair.push('An example of this test was deleted since.');
    else if (input.tries.some((t) => t.exampleId === id && t.exampleFp !== ex.fingerprint)) fair.push(`"${ex.name}" was edited after this test.`);
  }
  return { run, title: testTitle(run, ctx), labels: { a: input.a ? input.a.label : null, b: input.b.label },
    examples: input.examples.length, costUsd: store.spentOfRun(run.id), model: compareModel(input), changes, fair };
}

/** Board 6 (G2: one column for Try it once now) and board 31 (what a pretend try would have sent). The cards show the
 *  first PREVIEW_MAX characters; tryResult reads all. */
export async function sideBySide(workflowId, runId, exampleId) {
  const run = runOf(workflowId, runId);
  const ex = store.readExample(workflowId, exampleId);
  if (!ex || !run.exampleIds.includes(ex.id)) throw err(`no example ${exampleId} in this test`, 'NOT_FOUND');
  const ctx = labelCtx(workflowId);
  const tries = store.triesOfRun(run.id).filter((t) => t.exampleId === ex.id && FIN.has(t.status));
  const list = (side) => tries.filter((t) => t.side === side).sort((x, y) => x.tryNo - y.tryNo || x.id - y.id);
  const A = run.a != null ? list('a') : [];
  const B = list('b');
  const view = async (t) => {
    if (!t) return null;
    const m = await mainResult(t.pipelineId);
    const text = typeof m.text === 'string' ? m.text : null;
    const sent = t.connectors === 'pretend' ? await wouldHaveSent(t.pipelineId) : null;
    return { tryId: t.id, status: t.status, verdict: t.verdict, name: m.name,
      text: text && text.length > PREVIEW_MAX ? text.slice(0, PREVIEW_MAX) : text, truncated: !!text && text.length > PREVIEW_MAX,
      connectors: t.connectors, wouldHaveSent: sent ? sent.sent : null, answeredReads: sent ? sent.reads : [] };
  };
  const out = [];
  for (let i = 0; i < Math.max(A.length, B.length); i += 1) out.push({ n: i + 1, a: await view(A[i]), b: await view(B[i]) });
  const labels = { a: run.a != null ? useLabel(run.a, ctx) : null, b: useLabel(run.b, ctx) };
  const m = compareModel({ examples: [{ id: ex.id, name: ex.name }], a: labels.a ? { label: labels.a } : null, b: { label: labels.b }, tries });
  return { run, compareTitle: testTitle(run, ctx, { exampleName: ex.name }), example: { id: ex.id, name: ex.name }, labels, row: m.examples[0],
    connectors: run.connectors, tries: out };
}

/** "Read the whole result". */
export async function tryResult(workflowId, runId, tryId) {
  const run = runOf(workflowId, runId);
  const t = store.triesOfRun(run.id).find((x) => x.id === Number(tryId));
  if (!t) throw err(`no try ${tryId} in this test`, 'NOT_FOUND');
  const m = await mainResult(t.pipelineId);
  return { name: m.name, text: m.text };
}

/** C13: "<workflow>: <test title>" for the results-ready toast. */
export function finishedText(workflowId, runId) {
  const run = store.readTestRun(runId);
  if (!run) return '';
  let name = workflowId;
  try { name = workflowRowOf(workflowId).name; } catch { /* deleted meanwhile: its id */ }
  return `${name}: ${testTitle(run, labelCtx(workflowId), { exampleName: firstExampleName(run) })}`;
}
