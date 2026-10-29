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
import { findPipelineRowById, readStepQuestions, readClarifyRow, runDirForRow, resolveIndexedArtifactForRow } from '../artifacts.mjs';
import { isNoProjectKey, testCopyDirFor } from '../store.mjs';
import { listProjects } from '../projects.mjs';
import { readProjectActions } from '../config.mjs';
import { listRemotes } from '../git-info.mjs';
import { workModeOfRow } from '../project-kind.mjs';
import { diffGraphs } from '../../shared/graph/diff-graphs.mjs';
import { basicsList } from '../../shared/workflow-tests/checks.mjs';
import { useLabel, testTitle, latestTitle, compareModel, TRIES_AT_ONCE } from '../../shared/workflow-tests/compare.mjs';
import { loadScriptRegistry } from '../script-registry.mjs';
import * as store from './store.mjs';
import { useGraph, useFingerprint } from './uses.mjs';
import { testTargetOf, exampleReadiness } from './try-body.mjs';
import { ensureStartCommit, treeBytes, freeDiskBytes, removeTryCheckout, pinStart, listBranches, behindCount, headOf, commitExists,
  commitDate } from './project-copy.mjs';
import { leftOutText, folderMissingText, folderProjectText, diskRefusalText, diskRefusalOnceText, PAST_RUN_REFUSALS } from '../../shared/workflow-tests/project-text.mjs';
import { mainResult } from './result.mjs';
import { DIFF_PATCH_FILE } from '../results.mjs';
import { connectorNotes, userScopeServerNames, seenClaudeAiServers, wouldHaveSent, stepEngines, scriptSteps } from './connectors.mjs';

/** Part 2's D20 sentence. 3a (D62) tests every workflow, so nothing produces it any more; kept for old callers. */
export const NOT_TESTABLE_TEXT = 'This workflow works on a project, and tests work for workflows without a project for now.';
export const NOT_TESTABLE_REASONS = Object.freeze({
  'test-try': 'A test try cannot become an example.',
  'not-finished': 'Wait until the run has finished.',
  'not-versionable': 'Its workflow comes from a plugin or is built in, so it has no tests.',
  'no-workflow': 'Its workflow was deleted.',
  ...PAST_RUN_REFUSALS,   // 3a D65: folder-run, workspace-run, no-start (board 39)
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

/** D62 (replaces D20): every saved user workflow can be tested; `needsProject` says what its examples need. */
export function testTarget(workflowId, { registry = loadAgentRegistry() } = {}) {
  const row = workflowRowOf(workflowId);
  return { row, ...testTargetOf(row.graph, registry) };
}

export const DISK_MARGIN = 1.2;

/** The project an example names, as the registry knows it now (D62). */
export async function projectStateOf(project, { projects = null } = {}) {
  const list = projects || await listProjects();
  const reg = list.find((p) => p.key === project.key) || null;
  const state = !reg ? 'not-registered' : !reg.exists ? 'missing' : reg.vcs !== 'git' ? 'folder' : 'ok';
  return { state, reg };
}

/** The sentence for an example a test cannot try (board 39's cards; board 34's left-out hint). */
export function readinessText(example, reason, { reg = null } = {}) {
  const name = reg ? reg.name : example.project ? example.project.key : '';
  if (reason === 'missing') return folderMissingText(name, reg ? reg.path : '');
  if (reason === 'folder') return folderProjectText(name);
  return leftOutText([example.name]);   // pick-project, not-registered
}

/** The runner's targetOf (D62): one example on one version. */
export async function targetFor(workflowId, use, example, { registry = loadAgentRegistry(), projects = null } = {}) {
  const g = await useGraph(workflowId, use);
  const needsProject = g ? testTargetOf(g, registry).needsProject : false;
  const { state, reg } = example.project ? await projectStateOf(example.project, { projects }) : { state: null, reg: null };
  const r = exampleReadiness({ needsProject, example, state });
  return { ...r, text: r.ready ? null : readinessText(example, r.reason, { reg }) };
}

/**
 * D60: what a test of these examples needs on disk while it runs, and what is free. One try needs the example's last
 * measured checkout, else its start tree (`git ls-tree`, read only) plus its patch. The test needs the 3 largest tries at
 * once, times DISK_MARGIN. null when no example has a project. `counts` (example id → tries left) replaces tries × sides
 * for "Finish the rest". `measuredOf`, `treeSize` and `freeDisk` are seams for the tests.
 */
export async function diskPlanOf(examples, { tries = 3, sides = 1, projects = null, counts = null,
  measuredOf = store.lastDiskBytes, treeSize = treeBytes, freeDisk = freeDiskBytes } = {}) {
  const list = projects || await listProjects();
  const per = [];
  for (const ex of examples) {
    if (!ex.project) continue;
    const reg = list.find((p) => p.key === ex.project.key);
    const measured = measuredOf(ex.id, ex.project.startCommit);
    const bytes = measured ?? (reg && reg.exists ? ((await treeSize({ projectDir: reg.path, sha: ex.project.startSha })) ?? 0) + (ex.project.changesBytes || 0) : 0);
    const n = counts && counts[ex.id] != null ? Number(counts[ex.id]) : tries * sides;
    for (let k = 0; k < Math.min(n, TRIES_AT_ONCE); k += 1) per.push(bytes);
  }
  if (!per.length) return null;
  const needBytes = Math.ceil(DISK_MARGIN * per.sort((x, y) => y - x).slice(0, TRIES_AT_ONCE).reduce((s, n) => s + n, 0));
  const freeBytes = await freeDisk();
  const enough = freeBytes === null || freeBytes >= needBytes;
  return { needBytes, freeBytes, enough, text: enough ? null : diskRefusalText(needBytes, freeBytes), once: enough ? null : diskRefusalOnceText(needBytes, freeBytes) };
}

/** Before a try (D42): the example's start commit in Worca's copy of its project. */
export async function prepareProject(example) {
  const { state, reg } = await projectStateOf(example.project);
  if (state !== 'ok') throw err(readinessText(example, state, { reg }), 'NOT_READY');
  return ensureStartCommit({ key: example.project.key, projectDir: reg.path, project: example.project, changes: store.readExampleChanges(example.id) });
}

/** D61: a project try's checkout, its branch in the copy and its run folder, once its run has settled. */
export async function cleanupTry(outcome) {
  const p = outcome && outcome.project;
  if (!p || !p.key) return { removed: true, error: null };
  return removeTryCheckout({ copyDir: testCopyDirFor(p.key), worktreeDir: p.checkoutDir, branch: p.branch, runRoot: p.runRoot, pipelineId: outcome.pipelineId });
}

/** The project's own setup command (its Actions settings), the default of an example's "Before each try, run". */
const setupOf = (key) => { try { return readProjectActions(key).setup || null; } catch { return null; } };

/** The editor's project select (board 32): every registered project, the branch its folder is on, its setup. Read only. */
export async function projectsForTests() {
  const out = [];
  for (const p of await listProjects()) {
    const head = p.exists && p.vcs === 'git' ? await headOf(p.path) : null;
    out.push({ key: p.key, name: p.name, path: p.path, exists: p.exists, vcs: p.vcs,
      current: head ? { branch: head.branch, sha: head.sha, short: head.sha.slice(0, 7), at: head.at } : null, setupCmd: setupOf(p.key) });
  }
  return { projects: out };
}

/** The start point dialog (P2): a Git project's local branches. Read only. */
export async function projectBranches(key) {
  const reg = (await listProjects()).find((p) => p.key === key);
  if (!reg || !reg.exists || reg.vcs !== 'git') throw err('no such Git project', 'NOT_FOUND');
  return { branches: (await listBranches(reg.path)).map((b) => ({ ...b, short: b.sha.slice(0, 7) })) };
}

/** Board 32 / 38: an example's project as the page shows it, with its drift (D63). The name is the registry's. */
export async function projectView(project, { projects = null } = {}) {
  if (!project) return null;
  const { state, reg } = await projectStateOf(project, { projects });
  const behind = state === 'ok' ? await behindCount({ projectDir: reg.path, startSha: project.startSha, startRef: project.startRef }) : null;
  return { key: project.key, name: reg ? reg.name : project.key, path: reg ? reg.path : null, state, startSha: project.startSha,
    short: project.startSha.slice(0, 7), startRef: project.startRef, startAt: project.startAt, changes: !!project.changesSha256,
    setupCmd: project.setupCmd, behind };
}

/**
 * A save's `project` field → the pin to store (D41, D63, P3, P4): undefined keeps, null removes. Pins again only when the
 * start point changes (another project or branch, "Start from the latest", the changes switched); the person's
 * repository is only read.
 */
export async function resolveProjectInput(was, input) {
  if (input === undefined) return undefined;
  if (input === null) return null;
  if (typeof input !== 'object' || Array.isArray(input)) throw err('pick a project', 'BAD_REQUEST');
  const key = String(input.key || '');
  const { state, reg } = await projectStateOf({ key });
  if (state === 'not-registered') throw err('pick a project', 'BAD_REQUEST');
  if (state === 'missing') throw err(folderMissingText(reg.name, reg.path), 'NOT_READY');
  if (state === 'folder') throw err(folderProjectText(reg.name), 'NOT_READY');
  if (input.ref !== undefined && input.ref !== null && typeof input.ref !== 'string') throw err('pick a branch of the project', 'BAD_REQUEST');
  const prev = was && was.project ? was.project : null;
  const setupCmd = typeof input.setupCmd === 'string' ? input.setupCmd : prev ? prev.setupCmd : setupOf(key);
  const wantsChanges = input.includeChanges === undefined ? !!(prev && prev.changesSha256) : !!input.includeChanges;
  const same = prev && prev.key === key && input.repin !== true && (input.ref === undefined || input.ref === prev.startRef)
    && wantsChanges === !!prev.changesSha256;
  if (same) return { ...prev, changes: store.readExampleChanges(was.id), setupCmd };
  // P4: the same start, when the project's repository (re-added under another key, say) still has that commit.
  const keepSha = prev && input.ref === undefined && input.repin !== true && !wantsChanges && prev.key !== key
    && await commitExists(reg.path, prev.startSha) ? prev.startSha : null;
  const pin = await pinStart({ key, name: reg.name, projectDir: reg.path, ref: keepSha ? prev.startRef : (input.ref ?? null),
    sha: keepSha, includeChanges: wantsChanges });
  return { ...pin, setupCmd };
}

/** Create (id null) or update an example; its `project` input goes through resolveProjectInput. */
export async function saveExample(workflowId, id, body = {}, { by = null } = {}) {
  const was = id == null ? null : store.readExample(workflowId, id);
  if (id != null && !was) throw err(`no example ${id}`, 'NOT_FOUND');
  const { project: input, ...fields } = body && typeof body === 'object' ? body : {};
  const project = await resolveProjectInput(was, input);
  return id == null ? store.createExample(workflowId, fields, { by, project: project ?? null })
    : store.updateExample(workflowId, was.id, fields, { project });
}

/** D63: "Start from the latest": the newest commit of the example's branch, now. */
export async function startFromLatest(workflowId, id) {
  const ex = store.readExample(workflowId, id);
  if (!ex) throw err(`no example ${id}`, 'NOT_FOUND');
  if (!ex.project || !ex.project.startRef) throw err('this example does not follow a branch', 'BAD_REQUEST');
  return saveExample(workflowId, ex.id, { project: { key: ex.project.key, ref: ex.project.startRef, repin: true } });
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

/** Boards 19, 25, 38, 39 (D65): the workflow's newest finished runs, any target, never a try. A Folder or workspace run is
 *  listed with its refusal. An exactly equal request is "the same". `project` is the registry's name of the run's
 *  project (a workspace run: its members), null without one. */
export async function recentRuns(workflowId, { limit = 10, projects = null } = {}) {
  getDb();
  const list = projects || await listProjects();
  const rows = prepare(`SELECT id, title, prompt, status, started_at, project_key, target, branch, workspace_meta FROM pipelines
      WHERE is_test IS NULL AND archived_at IS NULL AND deleted_at IS NULL AND status IN ('done', 'stopped', 'error') AND ${templateIdSql} = ?
      ORDER BY started_at DESC LIMIT ?`).all(workflowId, limit);
  const first = new Map();
  return rows.map((r) => {
    const key = normPrompt(r.prompt);
    const sameAs = key && first.has(key) ? first.get(key) : null;
    if (key && !first.has(key)) first.set(key, r.title || r.id);
    const ws = r.target === 'workspace';
    const refusal = ws ? 'workspace' : !isNoProjectKey(r.project_key) && workModeOfRow(r) !== 'git' ? 'folder' : null;
    const nameOf = (k) => (k ? (list.find((p) => p.key === k) || {}).name || null : null);   // the registry's name, never the key
    const wsProjects = ws ? (parse(r.workspace_meta, {}) || {}).projects : null;
    const members = Array.isArray(wsProjects) ? wsProjects.map((m) => m && (nameOf(m.projectKey) || m.projectName || m.name)).filter(Boolean) : [];
    const project = ws ? members.join(', ') || null : isNoProjectKey(r.project_key) ? null : nameOf(r.project_key);
    return { pipelineId: r.id, title: r.title || r.id, at: r.started_at, status: r.status, files: extrasOf(r.id).length, sameAs, project, refusal,
      refusalText: refusal ? PAST_RUN_REFUSALS[`${refusal}-run`] : null };
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

/** D65: where a single-project git run started: its branch record's baseSha (else diffBase), on its source branch. */
function startOfRow(row) {
  const br = parse(row.branch, {}) || {};
  const sha = typeof br.baseSha === 'string' && br.baseSha ? br.baseSha : typeof br.diffBase === 'string' && br.diffBase ? br.diffBase : null;
  return sha ? { sha, ref: typeof br.source === 'string' && br.source ? br.source : null } : null;
}

/** Board 3 (3a: boards 38, 39): what "Use this run as a test example" keeps, and whether it can. A project run's example
 *  starts where the run started (D65); a Folder or workspace run, or one with no recorded start, cannot be one. */
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
  else if (row.target === 'workspace') reason = 'workspace-run';
  else if (!isNoProjectKey(row.project_key) && workModeOfRow(row) !== 'git') reason = 'folder-run';
  else if (!isNoProjectKey(row.project_key) && !startOfRow(row)) reason = 'no-start';
  else {
    try { target = testTarget(workflowId || '', { registry }); }   // D62: a workflow is always testable now
    catch (e) { reason = e && e.code === 'NOT_VERSIONABLE' ? 'not-versionable' : 'no-workflow'; }
  }
  const ctx = target ? labelCtx(workflowId) : {};
  let project = null;
  const start = !reason && !isNoProjectKey(row.project_key) ? startOfRow(row) : null;
  if (start) {
    const reg = (await listProjects()).find((p) => p.key === row.project_key) || null;   // the registry's name, never the key
    project = { key: row.project_key, name: reg ? reg.name : row.project_key, startSha: start.sha, short: start.sha.slice(0, 7), startRef: start.ref,
      startAt: (reg && reg.exists ? await commitDate(reg.path, start.sha) : null) || row.started_at || null, setupCmd: setupOf(row.project_key) };
  }
  return {
    pipelineId: row.id, workflowId, workflowName: target ? target.row.name : (tpl.name || ''),
    title: row.title || '', request: row.prompt || '', files: extrasOf(row.id).map((p) => basename(p)), qa: pastAnswers(row.id),
    use, useLabel: use === 'draft' ? 'your draft' : useLabel(use, ctx), testable: !reason, reason,
    reasonText: reason ? NOT_TESTABLE_REASONS[reason] : null,
    project,
  };
}

/** Board 3 → an example; `skipped` names the files that did not fit (5 MB, 8 files). */
const exampleName = (name, past) => (typeof name === 'string' && name.trim() ? name.trim() : past.title || 'Example').slice(0, 120);

/** A past run that can become an example of `workflowId`, or the error why not. */
async function usablePastRun(workflowId, pipelineId, registry) {
  const past = await pastRunSummary(pipelineId, registry ? { registry } : {});
  if (past.workflowId !== workflowId) throw err('this run is of another workflow', 'BAD_REQUEST');
  if (!past.testable) throw err(NOT_TESTABLE_REASONS[past.reason] || NOT_TESTABLE_TEXT, 'BAD_REQUEST');
  return past;
}

export async function exampleFromRun(workflowId, { pipelineId, name, keepRequest = true, keepAnswers = true, verdict = null, note = null,
  setupCmd = null } = {}, { by = null, registry } = {}) {
  const past = await usablePastRun(workflowId, pipelineId, registry);
  if (verdict !== null && verdict !== 'good' && verdict !== 'not-good') throw err('verdict must be "good" or "not-good"', 'BAD_REQUEST');
  const clean = exampleName(name, past);
  // D65: a project run's example starts exactly where the run started, with no changes (runs start from commits).
  let project = null;
  if (past.project) {
    const { state, reg } = await projectStateOf({ key: past.project.key });
    if (state !== 'ok') throw err(readinessText({ name: clean, project: past.project }, state, { reg }), 'NOT_READY');
    const pin = await pinStart({ key: past.project.key, name: reg.name, projectDir: reg.path, sha: past.project.startSha, ref: past.project.startRef });
    project = { ...pin, setupCmd: typeof setupCmd === 'string' && setupCmd.trim() ? setupCmd.trim() : past.project.setupCmd };
  }
  const example = store.createExample(workflowId, { name: clean, request: keepRequest ? past.request : '', answers: keepAnswers ? past.qa : [], note },
    { by, from: { pipelineId: past.pipelineId, use: past.use, verdict }, project });
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
    const { errors } = store.normaliseExample({ name: exampleName(undefined, past), request: past.request, answers: past.qa },
      { hasProject: !!past.project });   // D65: a project run's example carries its project
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
  const { row, testable, reason, needsProject } = testTarget(workflowId, { registry });
  const ctx = labelCtx(workflowId);
  const uses = [...(ctx.liveVersionNo ? [ctx.liveVersionNo] : []), 'draft'];
  const fpNow = {};
  for (const use of uses) {
    try { fpNow[store.useRef(use)] = await fingerprintOf(workflowId, use); } catch { fpNow[store.useRef(use)] = null; }
  }
  const projects = await listProjects();   // read once: every example's project and the past runs' names
  const examples = [];
  for (const ex of store.listExamples(workflowId)) {
    const from = ex.from ? findPipelineRowById(ex.from.pipelineId) : null;
    const project = await projectView(ex.project, { projects });
    // D62: whether a test can try it (the draft's needs; targetFor checks each version again at the start).
    const ready = exampleReadiness({ needsProject, example: ex, state: project ? project.state : null });
    examples.push({
      id: ex.id, name: ex.name, hasRequest: !!ex.request.trim(), files: ex.files.map((f) => f.name),
      fromAt: from ? from.started_at || null : null, note: ex.note, tries: ex.tries,
      basics: basicsList(ex.basics).length, checks: ex.checks.length,
      cells: Object.fromEntries(uses.map((use) => [store.useRef(use), cellOf(ex, use, fpNow[store.useRef(use)])])),
      project, ready: ready.ready, reason: ready.reason,
      readyText: ready.ready ? null : readinessText(ex, ready.reason, { reg: project ? projects.find((p) => p.key === project.key) || null : null }),
    });
  }
  const runs = store.listTestRuns(workflowId, { limit: 20 });
  const running = runs.find((r) => r.status === 'running') || null;
  const last = runs.find((r) => r.kind === 'compare' && r.status !== 'running') || null;
  const own = running ? store.triesOfRun(running.id).filter((t) => t.runId === running.id) : [];
  return {
    workflowId, name: row.name, testable, reason, needsProject, ctx,
    columns: uses.map((use) => ({ use, label: useLabel(use, ctx, 'column') })),
    examples,
    running: running ? { runId: running.id, title: testTitle(running, ctx, { mode: 'testing', exampleName: firstExampleName(running) }),
      done: own.filter((t) => FIN.has(t.status)).length, total: own.length } : null,
    latest: last ? { runId: last.id, title: latestTitle(last, ctx), finishedAt: last.finishedAt, examples: last.exampleIds.length,
      tries: last.tries, costUsd: store.spentOfRun(last.id), counts: compareModel(modelInput(last, ctx)).counts, status: last.status,
      stopReason: last.stopReason } : null,
    pastRuns: await recentRuns(workflowId, { projects }),
  };
}

/**
 * Board 30's notes (D35): the connectors a try without a project would load (the server's preview: the registry copies,
 * `untested` = no stand-in, and the servers from a project file), the ones Claude Code loads by itself, the workflow's
 * script steps on either side, and the engines other than Claude its agent steps run on. Read when the dialog asks, so
 * the engine is today's `run.engine` (`runEngine` overrides it, a test seam).
 */
async function connectorsOf(workflowId, uses, { connectorsPreview = null, runEngine = null, mode = 'pretend', scope = null } = {}) {
  let preview = {};
  let previewError = false;   // the dialog says it could not read the connectors, never "none"
  // 3a: `scope` = the one project the test's examples work on ({ key, name, projectDir }), else null (no project).
  try { preview = connectorsPreview ? (await connectorsPreview(scope)) || {} : {}; } catch { preview = {}; previewError = true; }
  const copies = Array.isArray(preview.copies) ? preview.copies : [];
  const fileServers = Array.isArray(preview.fileServers) ? preview.fileServers : [];
  let scripts = {};
  try { scripts = loadScriptRegistry() || {}; } catch { scripts = {}; }
  const names = [];
  const quick = [];
  const engines = [];
  for (const use of uses) {
    const g = use == null ? null : await useGraph(workflowId, use);
    const steps = scriptSteps(g, scripts);
    names.push(...steps.names);
    quick.push(...steps.quick);
    if (g) engines.push(...stepEngines(g, { runEngine }));
  }
  const notes = connectorNotes({ copies, fileServers, userScope: userScopeServerNames(), claudeAi: seenClaudeAiServers(), scripts: names,
    quickScripts: quick, engines, mode });
  return previewError ? { ...notes, previewError: true } : notes;
}

/** Board 4: per version, what would be tried, what can be reused, and what a try usually costs; board 30's notes. */
export async function testPlan(workflowId, { a = null, b = 'draft', exampleIds = [], tries = 3, connectors = 'pretend' } = {},
  { fingerprintOf = (id, use) => useFingerprint(id, use), mock = false, connectorsPreview = null, runEngine = null } = {}) {
  workflowRowOf(workflowId);
  const ctx = labelCtx(workflowId);
  const all = store.listExamples(workflowId);
  const examples = exampleIds.length ? all.filter((e) => exampleIds.includes(e.id)) : all;
  // D62: only the examples that can be tried count; the others are named in the dialog's hint (board 34).
  const projects = await listProjects();
  const registry = loadAgentRegistry();
  const readyEx = [];
  const leftOut = [];
  for (const ex of examples) {
    let ok = true;
    for (const use of [a, b].filter((u) => u != null)) { if (!(await targetFor(workflowId, use, ex, { registry, projects })).ready) ok = false; }
    (ok ? readyEx : leftOut).push(ex);
  }
  const projEx = readyEx.filter((e) => e.project);
  const names = [...new Set(projEx.map((e) => (projects.find((p) => p.key === e.project.key) || {}).name || e.project.key))];
  const setupMsList = projEx.map((e) => store.avgSetupMs(e.id, e.project.startCommit)).filter((n) => n != null);
  const cmds = [...new Set(projEx.map((e) => e.project.setupCmd).filter(Boolean))];
  const one = names.length === 1 && projEx.length ? projects.find((p) => p.key === projEx[0].project.key) : null;
  const project = projEx.length ? {
    names, leftOut: leftOut.map((e) => e.name),
    disk: await diskPlanOf(projEx, { tries, sides: a != null ? 2 : 1, projects }),
    setupCmd: cmds.length === 1 ? cmds[0] : null,
    setupMs: setupMsList.length ? Math.round(setupMsList.reduce((sum, n) => sum + n, 0) / setupMsList.length) : null,
  } : (leftOut.length ? { names: [], leftOut: leftOut.map((e) => e.name), disk: null, setupCmd: null, setupMs: null } : null);
  const side = async (use) => {
    if (use == null) return null;
    let fp = null;
    try { fp = await fingerprintOf(workflowId, use); } catch { fp = null; }
    let reusable = 0;
    let at = null;
    if (fp) {
      for (const ex of readyEx) {
        const kept = store.reusableTries({ workflowId, exampleId: ex.id, use, fp, exampleFp: ex.fingerprint, mock, connectors, limit: tries });
        reusable += kept.length;
        for (const t of kept) if (t.finishedAt && (!at || t.finishedAt > at)) at = t.finishedAt;
      }
    }
    const perTryUsd = perTryCost(workflowId, use);
    return { use, label: useLabel(use, ctx, 'select'), short: useLabel(use, ctx), want: readyEx.length * tries, reusable,
      reusableAt: at, perTryUsd, savesUsd: perTryUsd === null ? null : reusable * perTryUsd };
  };
  return { a: await side(a), b: await side(b), examples: readyEx.length, tries, perTryMs: perTryMs(workflowId), project,
    connectors: { mode: connectors, ...(await connectorsOf(workflowId, [a, b], { connectorsPreview, runEngine, mode: connectors,
      scope: one ? { key: one.key, name: one.name, projectDir: one.path } : null })) } };
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

/** Board 20 (G8: two rows per example when both versions need tries). `costOf` = the runner's live cost. 3a (board 35):
 *  `phaseOf` = what a running project try is doing now (the runner's); `project.disk` is filled by progressDisk. */
export function progressOf(workflowId, runId, { costOf = null, phaseOf = null } = {}) {
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
      // Board 35: a project example's running try and its phase. An example without a project has none (its brief
      // 'preparing' is not "copying the project").
      const running = ex && ex.project ? list.find((t) => t.status === 'running') : null;
      const ph = running && phaseOf ? phaseOf(run.id, running.id) : null;
      const now = running ? { tryNo: running.tryNo, phase: ph ? ph.phase : 'working', checking: ph ? ph.checking : null,
        setupCmd: ex.project.setupCmd, startedMs: ph ? ph.startedMs : null } : null;
      rows.push({ exampleId: id, name: ex ? ex.name : 'A deleted example', label: both ? useLabel(side === 'a' ? run.a : run.b, ctx) : null,
        dots: list.map((t) => t.status), summary: rowSummary(list, run), now });
    }
  }
  // Board 35: the phase card shows the first running project try; a setup stop shows its output.
  const firstNow = rows.find((r) => r.now);
  const projectRows = run.exampleIds.map((id) => store.readExample(workflowId, id)).filter((x) => x && x.project);
  let setupStop = null;
  if (run.stopReason === 'setup') {
    const bad = own.find((t) => t.setup && t.setup.ok === false);
    const ex = bad ? store.readExample(workflowId, bad.exampleId) : null;
    if (bad) setupStop = { cmd: bad.setup.cmd, tail: bad.setup.tail || '', exampleId: bad.exampleId, exampleName: ex ? ex.name : '', label: useLabel(bad.use, ctx), tryNo: bad.tryNo };
  }
  const phases = (() => {
    const ex = firstNow ? store.readExample(workflowId, firstNow.exampleId) : null;
    if (!ex || !ex.project) return null;
    return { exampleName: firstNow.name, label: firstNow.label || useLabel(run.b, ctx), tryNo: firstNow.now.tryNo, phase: firstNow.now.phase,
      start: { ref: ex.project.startRef, short: ex.project.startSha.slice(0, 7), at: ex.project.startAt }, setupCmd: ex.project.setupCmd };
  })();
  const project = projectRows.length ? { phases, disk: null, setupStop } : null;   // disk: progressDisk (async), in the route
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
    project,
  };
}

/** Board 35's "Disk in use" (D60): free at the start minus free now, of about the need. The route adds it (statfs is async). */
export async function progressDisk(workflowId, run, { diskOf = null } = {}) {
  const exs = run.exampleIds.map((id) => store.readExample(workflowId, id)).filter((x) => x && x.project);
  if (!exs.length) return null;
  const plan = await diskPlanOf(exs, { tries: run.tries, sides: run.a != null ? 2 : 1 });
  const free = plan ? plan.freeBytes : null;
  const start = diskOf ? (diskOf(run.id) || {}).freeAtStart ?? null : null;
  return { inUseBytes: start != null && free != null ? Math.max(0, start - free) : null, needBytes: plan ? plan.needBytes : null, freeBytes: free };
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
 *  first PREVIEW_MAX characters; tryResult reads all. 3a (boards 36, 37): a project try's changes and setup, and what the
 *  guard stopped in both modes; `forgeOf` names a remote's forge (forgeNamer). */
export async function sideBySide(workflowId, runId, exampleId, { forgeOf = null } = {}) {
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
    // 3a D68: the guard's rows in both modes. A real try has no stand-ins, so its log holds only what the guard stopped.
    const sent = await wouldHaveSent(t.pipelineId, forgeOf ? { forgeOf } : {});
    return { tryId: t.id, status: t.status, verdict: t.verdict, name: m.name,
      text: text && text.length > PREVIEW_MAX ? text.slice(0, PREVIEW_MAX) : text, truncated: !!text && text.length > PREVIEW_MAX,
      connectors: t.connectors, wouldHaveSent: sent.sent, answeredReads: sent.reads,
      project: t.startCommit || t.changes ? { changes: t.changes, setup: t.setup ? { cmd: t.setup.cmd, ms: t.setup.ms } : null } : null };
  };
  const out = [];
  for (let i = 0; i < Math.max(A.length, B.length); i += 1) out.push({ n: i + 1, a: await view(A[i]), b: await view(B[i]) });
  const labels = { a: run.a != null ? useLabel(run.a, ctx) : null, b: useLabel(run.b, ctx) };
  const m = compareModel({ examples: [{ id: ex.id, name: ex.name }], a: labels.a ? { label: labels.a } : null, b: { label: labels.b }, tries });
  return { run, compareTitle: testTitle(run, ctx, { exampleName: ex.name }), example: { id: ex.id, name: ex.name }, labels, row: m.examples[0],
    connectors: run.connectors, tries: out,
    start: ex.project ? { ref: ex.project.startRef, short: ex.project.startSha.slice(0, 7), at: ex.project.startAt, setupCmd: ex.project.setupCmd,
      setupMs: store.avgSetupMs(ex.id, ex.project.startCommit) } : null,
    nothingPushed: !!ex.project,
  };
}

const FORGE_NAMES = Object.freeze({ github: 'GitHub', azure: 'Azure DevOps' });
/** P9: the forge of the real project's remote by its name, for board 37's "… on GitHub". Read only (`git remote -v`). */
export async function forgeNamer(key) {
  const reg = (await listProjects()).find((p) => p.key === key);
  if (!reg || !reg.exists) return () => null;
  const r = await listRemotes(reg.path);
  const by = new Map((r.ok ? r.remotes : []).map((x) => [x.name, FORGE_NAMES[x.forge] || null]));
  return (name) => by.get(name) || null;
}

export const TRY_PATCH_MAX = 5 * 1024 * 1024;
/** A try's whole diff (board 36's "Read all the changes"), at most TRY_PATCH_MAX characters; '' when it has none. */
export async function tryChanges(workflowId, runId, tryId) {
  const run = runOf(workflowId, runId);
  const t = store.triesOfRun(run.id).find((x) => x.id === Number(tryId));
  if (!t) throw err(`no try ${tryId} in this test`, 'NOT_FOUND');
  const row = t.pipelineId ? findPipelineRowById(t.pipelineId) : null;
  const hit = row ? await resolveIndexedArtifactForRow(row, DIFF_PATCH_FILE) : null;
  const patch = hit ? hit.text : '';
  return { patch: patch.length > TRY_PATCH_MAX ? patch.slice(0, TRY_PATCH_MAX) : patch };
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
