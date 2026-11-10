// src/core/workflow-tests/service.mjs
// The Tests pages' read models (plans/workflow-tests-part2-plan.md Task 9): the overview (boards 1, 19), a past run as an
// example (board 3, D29), the plan of a test (board 4), its progress (board 20), the compare (board 5) and one example
// side by side (board 6). Writes go through store.mjs and runner.mjs.
import { readFile, open } from 'node:fs/promises';
import { join, basename } from 'node:path';
import { getDb, prepare } from '../db.mjs';
import { isSafeWorkflowId } from '../workflows.mjs';
import { isReservedWorkflowId } from '../graph/builtin-workflows.mjs';
import { isVersionableRow, liveVersionNo, latestVersion, listRevisions } from '../workflow-revisions.mjs';
import { loadAgentRegistry } from '../agent-registry.mjs';
import { modelLabeler } from '../workflow-versions.mjs';
import { findPipelineRowById, readStepQuestions, readClarifyRow, runDirForRow, resolveIndexedArtifactFileForRow,
  readStoreMeta } from '../artifacts.mjs';
import { isNoProjectKey, testCopyDirFor } from '../store.mjs';
import { listProjects } from '../projects.mjs';
import { readProjectActions } from '../config.mjs';
import { workModeOfRow } from '../project-kind.mjs';
import { diffGraphs } from '../../shared/graph/diff-graphs.mjs';
import { basicsList } from '../../shared/workflow-tests/checks.mjs';
import { useLabel, testTitle, latestTitle, compareModel, TRIES_AT_ONCE } from '../../shared/workflow-tests/compare.mjs';
import { loadScriptRegistry } from '../script-registry.mjs';
import * as store from './store.mjs';
import { changedSinceStart } from './changed.mjs';
import { useGraph, useFingerprint } from './uses.mjs';
import { testTargetOf, exampleReadiness } from './try-body.mjs';
import { ensureStartCommit, treeBytes, freeDiskBytes, removeTryCheckout, pinStart, listBranches, behindCount, headOf, commitExists,
  commitDate, copySubject, remoteUrl } from './project-copy.mjs';
import { parseRemoteUrl, forgeOf as forgeOfRemote, FORGE_LABEL } from '../forge.mjs';
import { pushRemoteOf } from './guard-calls.mjs';
import { leftOutText, folderMissingText, folderProjectText, notRegisteredText, diskRefusalText, diskRefusalOnceText, PAST_RUN_REFUSALS } from '../../shared/workflow-tests/project-text.mjs';
import { mainResult } from './result.mjs';
import { readBefore, beforeSpecOf, beforeHash } from './before-run.mjs';
import { DIFF_PATCH_FILE } from '../results.mjs';
import { connectorNotes, userScopeServerNames, seenClaudeAiServers, wouldHaveSent, stepEngines, scriptSteps, readConnectorCalls } from './connectors.mjs';

/** Why a past run cannot become an example (3a D62 removed Part 2's D20 "needs a project": every workflow can be tested). */
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
  const name = reg ? reg.name : example.project ? example.project.name || example.project.key : '';   // never the key while a name is known
  if (reason === 'missing') return folderMissingText(name, reg ? reg.path : '');
  if (reason === 'folder') return folderProjectText(name);
  if (reason === 'not-registered') return notRegisteredText(name);   // P20's sentence, not "pick its project first"
  return leftOutText([example.name]);   // pick-project
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

/** fn over every item, at most `limit` at once; the results keep the items' order. */
async function mapLimit(items, limit, fn) {
  const out = new Array(items.length);
  let next = 0;
  const worker = async () => { while (next < items.length) { const i = next; next += 1; out[i] = await fn(items[i], i); } };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}
export const PROJECT_READS_AT_ONCE = 4;

/** The editor's project select (board 32): every registered project, the branch its folder is on, its setup. Read only;
 *  the folders are read PROJECT_READS_AT_ONCE at a time. */
export async function projectsForTests({ projects = null } = {}) {
  const list = projects || await listProjects();
  const out = await mapLimit(list, PROJECT_READS_AT_ONCE, async (p) => {
    const head = p.exists && p.vcs === 'git' ? await headOf(p.path) : null;
    return { key: p.key, name: p.name, path: p.path, exists: p.exists, vcs: p.vcs,
      current: head ? { branch: head.branch, sha: head.sha, short: head.sha.slice(0, 7), at: head.at, subject: head.subject } : null, setupCmd: setupOf(p.key) };
  });
  return { projects: out };
}

/**
 * A project's name as the page shows it, never its internal key while any name is known: the registry's, else the name
 * stored with the example's pin, else the name Worca kept when the project last ran (store_meta), else any example's
 * stored pin name. The key only when none is known.
 */
export function projectNameOf(key, { projects = [], pinName = null } = {}) {
  const reg = (projects || []).find((p) => p.key === key);
  if (reg && reg.name) return reg.name;
  if (pinName) return pinName;
  let meta = null;
  try { meta = readStoreMeta(key); } catch { meta = null; }
  if (meta && typeof meta.name === 'string' && meta.name && meta.name !== key) return meta.name;
  const pinned = prepare('SELECT project_name AS n FROM wf_test_example_projects WHERE project_key = ? AND project_name IS NOT NULL LIMIT 1').get(key);
  return pinned && pinned.n ? pinned.n : key;
}

/** The start point dialog (P2): a Git project's local branches. Read only. */
export async function projectBranches(key) {
  const reg = (await listProjects()).find((p) => p.key === key);
  if (!reg || !reg.exists || reg.vcs !== 'git') throw err('no such Git project', 'NOT_FOUND');
  return { branches: (await listBranches(reg.path)).map((b) => ({ ...b, short: b.sha.slice(0, 7) })) };
}

/** F26: the subject of a start's commit, read from Worca's copy of the project (read only, kept per commit); null when the
 *  copy does not have it. Never the person's folder (fix round 1). */
export function subjectOfStart({ key, sha }) {
  return copySubject(key, sha);
}

/** Board 32 / 38: an example's project as the page shows it, with its drift (D63). The name: projectNameOf. `behindMemo`
 *  (a Map) shares one drift count between the examples of one page read that start at the same point. */
export async function projectView(project, { projects = null, behindMemo = null } = {}) {
  if (!project) return null;
  const { state, reg } = await projectStateOf(project, { projects });
  let behind = null;
  if (state === 'ok') {
    const memoKey = JSON.stringify([reg.path, project.startSha, project.startRef]);
    if (behindMemo && behindMemo.has(memoKey)) behind = await behindMemo.get(memoKey);
    else {
      const p = behindCount({ projectDir: reg.path, startSha: project.startSha, startRef: project.startRef });
      if (behindMemo) behindMemo.set(memoKey, p);
      behind = await p;
    }
  }
  return { key: project.key, name: reg ? reg.name : projectNameOf(project.key, { pinName: project.name }), path: reg ? reg.path : null,
    state, startSha: project.startSha, subject: await copySubject(project.key, project.startSha),   // F26: from Worca's copy
    short: project.startSha.slice(0, 7), startRef: project.startRef, startAt: project.startAt, changes: !!project.changesSha256,
    setupCmd: project.setupCmd, behind };
}

/**
 * A save's `project` field → the pin to store (D41, D63, P3, P4): undefined keeps, null removes. Pins again only when the
 * start point changes; the person's repository is only read. The rules for `project: { key, ref?, includeChanges?,
 * setupCmd?, repin? }`:
 * - same key, `ref` left out or null, no `repin`, the changes switch unchanged: the start point is kept (a null ref is
 *   "no change", never "the branch the folder is on now");
 * - `ref` names another branch: the newest commit of that branch;
 * - `repin: true` is the explicit "change the start" action ("Start from the latest", the start point dialog): the newest
 *   commit of `ref`, else of the branch the folder is on;
 * - switching the changes on or off pins again from the same branch;
 * - another key (P4): the same commit when that repository has it, else the newest commit of its current branch.
 */
export async function resolveProjectInput(was, input) {
  if (input === undefined) return undefined;
  if (input === null) return null;
  if (typeof input !== 'object' || Array.isArray(input)) throw err('pick a project', 'BAD_REQUEST');
  const key = String(input.key || '');
  if (input.ref !== undefined && input.ref !== null && typeof input.ref !== 'string') throw err('pick a branch of the project', 'BAD_REQUEST');
  const ref = input.ref == null ? undefined : input.ref;   // null = no change, as undefined
  const prev = was && was.project ? was.project : null;
  const samePrev = !!prev && prev.key === key;
  // The setup: a string is the person's ('' = no setup; the store keeps null); null or left out keeps the pin's, and a
  // project picked anew starts with the project's own setup.
  const setupCmd = typeof input.setupCmd === 'string' ? input.setupCmd : samePrev ? prev.setupCmd : setupOf(key);
  const wantsChanges = input.includeChanges === undefined ? !!(prev && prev.changesSha256) : !!input.includeChanges;
  const same = samePrev && input.repin !== true && (ref === undefined || ref === prev.startRef) && wantsChanges === !!prev.changesSha256;
  const { state, reg } = await projectStateOf({ key });
  // Task 10 review: the kept pin needs no ready project, so a request-only edit saves while the folder is missing, the
  // project is a Folder project or left the registry. A try refuses it (prepareProject); a new key or start is checked.
  if (same) return { ...prev, name: reg ? reg.name : prev.name, changes: store.readExampleChanges(was.id), setupCmd };
  if (state === 'not-registered') throw err('pick a project', 'BAD_REQUEST');
  if (state === 'missing') throw err(folderMissingText(reg.name, reg.path), 'NOT_READY');
  if (state === 'folder') throw err(folderProjectText(reg.name), 'NOT_READY');
  // P4: the same start, when the project's repository (re-added under another key, say) still has that commit.
  const keepSha = prev && ref === undefined && input.repin !== true && !wantsChanges && prev.key !== key
    && await commitExists(reg.path, prev.startSha) ? prev.startSha : null;
  // Not a repin and no new branch: the pin follows the branch it followed (the changes switched).
  const pinRef = keepSha ? prev.startRef : ref !== undefined ? ref : input.repin !== true && prev && prev.key === key ? prev.startRef : null;
  const pin = await pinStart({ key, name: reg.name, projectDir: reg.path, ref: pinRef,
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

/** How long one try usually takes, in ms; null = unknown. U-T8 (F21): `mock` = from the mock tries' own times (a mock
 *  try takes seconds), never from a real run's; with none, unknown. */
export function perTryMs(workflowId, { mock = false } = {}) {
  getDb();
  const own = avgOf(`SELECT AVG((julianday(finished_at) - julianday(started_at)) * 86400000) AS c, COUNT(*) AS n FROM (SELECT started_at, finished_at
      FROM wf_test_tries WHERE workflow_id = ? AND mock = ? AND status IN ('passed', 'failed') AND started_at IS NOT NULL
      AND finished_at IS NOT NULL ORDER BY id DESC LIMIT 10)`, workflowId, mock ? 1 : 0);
  if (mock) return own;
  return own
    ?? avgOf(`SELECT AVG((julianday(updated_at) - julianday(started_at)) * 86400000) AS c, COUNT(*) AS n FROM (SELECT started_at, updated_at
      FROM pipelines WHERE is_test IS NULL AND status = 'done' AND started_at IS NOT NULL AND updated_at IS NOT NULL
      AND ${templateIdSql} = ? ORDER BY started_at DESC LIMIT 20)`, workflowId);
}

const normPrompt = (s) => String(s ?? '').normalize('NFKC').toLowerCase().replace(/\s+/g, ' ').trim();
const extrasOf = (pipelineId) => prepare("SELECT rel_path FROM artifacts WHERE pipeline_id = ? AND kind = 'extra' ORDER BY rel_path")
  .all(pipelineId).map((r) => r.rel_path);

/** Boards 19, 25, 38, 39 (D65): the workflow's newest finished runs, any target, never a try. A Folder or workspace run,
 *  or a project run with no recorded start, is listed with its refusal (it cannot be picked). An exactly equal request is
 *  "the same". `project` is the run's project's name (projectNameOf; a workspace run: its members), null without one. */
export async function recentRuns(workflowId, { limit = 10, projects = null } = {}) {
  getDb();
  const list = projects || await listProjects();
  const rows = prepare(`SELECT id, title, prompt, status, started_at, project_key, target, branch, workspace_meta FROM pipelines
      WHERE is_test IS NULL AND archived_at IS NULL AND deleted_at IS NULL AND status IN ('done', 'stopped', 'error') AND ${templateIdSql} = ?
      ORDER BY started_at DESC LIMIT ?`).all(workflowId, limit);
  const first = new Map();
  const asExample = new Map(store.listExamples(workflowId).filter((e) => e.from && e.from.pipelineId).map((e) => [e.from.pipelineId, e.name]));   // F25
  return rows.map((r) => {
    const key = normPrompt(r.prompt);
    const sameAs = key && first.has(key) ? first.get(key) : null;
    if (key && !first.has(key)) first.set(key, r.title || r.id);
    const ws = r.target === 'workspace';
    const own = !ws && !isNoProjectKey(r.project_key);
    const refusal = ws ? 'workspace' : own && workModeOfRow(r) !== 'git' ? 'folder' : own && !startOfRow(r) ? 'no-start' : null;
    const regName = (k) => (k ? (list.find((p) => p.key === k) || {}).name || null : null);
    const wsProjects = ws ? (parse(r.workspace_meta, {}) || {}).projects : null;
    const members = Array.isArray(wsProjects) ? wsProjects.filter(Boolean)
      .map((m) => regName(m.projectKey) || m.projectName || m.name || (m.projectKey ? projectNameOf(m.projectKey, { projects: list }) : null))
      .filter(Boolean) : [];
    const project = ws ? members.join(', ') || null : own ? projectNameOf(r.project_key, { projects: list }) : null;
    return { pipelineId: r.id, title: r.title || r.id, at: r.started_at, status: r.status, files: extrasOf(r.id).length, sameAs, alreadyExample: asExample.get(r.id) ?? null, project, refusal,
      refusalText: refusal ? PAST_RUN_REFUSALS[REFUSAL_REASON[refusal]] : null };
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

const REFUSAL_REASON = Object.freeze({ workspace: 'workspace-run', folder: 'folder-run', 'no-start': 'no-start' });

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
    const projects = await listProjects();
    const reg = projects.find((p) => p.key === row.project_key) || null;
    project = { key: row.project_key, name: projectNameOf(row.project_key, { projects }), startSha: start.sha, short: start.sha.slice(0, 7), startRef: start.ref, subject: await copySubject(row.project_key, start.sha),
      startAt: (reg && reg.exists ? await commitDate(reg.path, start.sha) : null) || row.started_at || null, setupCmd: setupOf(row.project_key) };
  }
  return {
    pipelineId: row.id, workflowId, workflowName: target ? target.row.name : (tpl.name || ''),
    title: row.title || '', at: row.started_at || null, request: row.prompt || '', files: extrasOf(row.id).map((p) => basename(p)), qa: pastAnswers(row.id),
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
  if (!past.testable) throw err(NOT_TESTABLE_REASONS[past.reason], 'BAD_REQUEST');
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
    // A string is the dialog's field ('' = no setup; the store keeps it as null); null or left out: the project's setup.
    project = { ...pin, setupCmd: typeof setupCmd === 'string' ? setupCmd.trim() : past.project.setupCmd };
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
      stale: tries.some((t) => t.fp !== fpNow || t.exampleFp !== ex.fingerprint), past: null,
      pastGood: !!(ex.from && ex.from.verdict === 'good' && ex.from.use != null && store.useRef(ex.from.use) === store.useRef(use)) };   // F34: the tries replaced a good past mark
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

/** U-T7 (F13, D7): the newest saved version whose useFingerprint equals the draft's, or null (a fingerprint that cannot be
 *  read is never "the same"). Such a draft is not a new version: the list hides its column, the dialog labels it. */
async function draftSameAs(workflowId, fingerprintOf, draftFp) {
  if (!draftFp) return null;
  const nos = listRevisions(workflowId).map((r) => r.versionNo).filter((n) => Number.isInteger(n)).sort((x, y) => y - x);
  for (const no of nos) {
    let fp = null;
    try { fp = await fingerprintOf(workflowId, no); } catch { fp = null; }
    if (fp && fp === draftFp) return no;
  }
  return null;
}

/** Boards 1 and 19 in one read. */
export async function testsOverview(workflowId, { registry = loadAgentRegistry(), fingerprintOf = (id, use) => useFingerprint(id, use) } = {}) {
  const { row, needsProject } = testTarget(workflowId, { registry });   // D62: always testable, so the overview no longer says so
  const ctx = labelCtx(workflowId);
  const uses = [...(ctx.liveVersionNo ? [ctx.liveVersionNo] : []), 'draft'];
  const fpNow = {};
  for (const use of uses) {
    try { fpNow[store.useRef(use)] = await fingerprintOf(workflowId, use); } catch { fpNow[store.useRef(use)] = null; }
  }
  const sameAs = await draftSameAs(workflowId, fingerprintOf, fpNow.draft);
  const projects = await listProjects();   // read once: every example's project and the past runs' names
  const behindMemo = new Map();   // one drift count per start point and folder, however many examples share it
  const examples = [];
  for (const ex of store.listExamples(workflowId)) {
    const from = ex.from ? findPipelineRowById(ex.from.pipelineId) : null;
    const project = await projectView(ex.project, { projects, behindMemo });
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
    workflowId, name: row.name, needsProject, ctx,
    draftSameAs: sameAs,   // U-T7 (D7): an identical draft has no column of its own
    columns: uses.filter((use) => !(use === 'draft' && sameAs !== null && uses.length > 1)).map((use) => ({ use, label: useLabel(use, ctx, 'column') })),
    examples,
    running: running ? { runId: running.id, title: testTitle(running, ctx, { mode: 'testing', exampleName: firstExampleName(running) }),
      done: own.filter((t) => FIN.has(t.status)).length, total: own.length,
      exampleIds: running.exampleIds } : null,   // U-T9 (F17): the editor asks before a save that would stop it
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

/**
 * 3b (D75, U2): the command runs a test still has to make on its start points (none kept), and how long they take (each
 * one's setup plus its command's last time); null when there are none. `ms` is null when one of them was never measured.
 * `cmd` names the command when there is one.
 */
export async function beforePlanOf(examples, { readKept = (s) => readBefore(s), setupMsOf = store.avgSetupMs, commandMsOf = store.lastCommandMs } = {}) {
  const seen = new Set();
  const cmds = new Set();
  let runs = 0;
  let ms = 0;
  let unknown = false;
  for (const ex of examples) {
    if (!ex || !ex.project) continue;
    for (const c of ex.checks || []) {
      if (c.kind !== 'command') continue;
      const spec = beforeSpecOf(ex, c);
      const h = `${spec.key}/${beforeHash(spec)}`;
      if (seen.has(h)) continue;
      seen.add(h);
      if (await readKept(spec)) continue;
      runs += 1;
      cmds.add(c.cmd);
      const s = spec.setupCmd ? setupMsOf(ex.id, ex.project.startCommit) : 0;
      const m = commandMsOf(ex.id, c.id);
      if (s == null || m == null) unknown = true; else ms += s + m;
    }
  }
  return runs ? { runs, ms: unknown ? null : ms, cmd: cmds.size === 1 ? [...cmds][0] : null } : null;
}

/** Board 4: per version, what would be tried, what can be reused, and what a try usually costs; board 30's notes. */
export async function testPlan(workflowId, { a = null, b = 'draft', exampleIds = [], tries = 3, connectors = 'pretend' } = {},
  { fingerprintOf = (id, use) => useFingerprint(id, use), mock = false, connectorsPreview = null, runEngine = null, registry: reg0 = null } = {}) {
  workflowRowOf(workflowId);
  const ctx = labelCtx(workflowId);
  const all = store.listExamples(workflowId);
  const examples = exampleIds.length ? all.filter((e) => exampleIds.includes(e.id)) : all;
  // D62: only the examples that can be tried count; the others are named in the dialog's hint (board 34).
  const projects = await listProjects();
  const registry = reg0 || loadAgentRegistry();   // reg0: a test's registry (whether the workflow needs a project)
  const readyEx = [];
  const leftOut = [];
  for (const ex of examples) {
    let why = null;   // the first version's reason (P27: the dialog says "pick its project first" only for pick-project)
    for (const use of [a, b].filter((u) => u != null)) {
      const t = await targetFor(workflowId, use, ex, { registry, projects });
      if (!t.ready && !why) why = t.reason;
    }
    if (why) leftOut.push({ ex, why }); else readyEx.push(ex);
  }
  const leftOutWhy = leftOut.map(({ ex, why }) => ({ name: ex.name, reason: why }));
  const projEx = readyEx.filter((e) => e.project);
  const names = [...new Set(projEx.map((e) => projectNameOf(e.project.key, { projects, pinName: e.project.name })))];
  const setupMsList = projEx.map((e) => store.avgSetupMs(e.id, e.project.startCommit)).filter((n) => n != null);
  const cmds = [...new Set(projEx.map((e) => e.project.setupCmd).filter(Boolean))];
  const one = names.length === 1 && projEx.length ? projects.find((p) => p.key === projEx[0].project.key) : null;
  const project = projEx.length ? {
    names, leftOut: leftOutWhy.map((x) => x.name), leftOutWhy,
    disk: await diskPlanOf(projEx, { tries, sides: a != null ? 2 : 1, projects }),
    setupCmd: cmds.length === 1 ? cmds[0] : null,
    setupMs: setupMsList.length ? Math.round(setupMsList.reduce((sum, n) => sum + n, 0) / setupMsList.length) : null,
    before: await beforePlanOf(projEx),   // 3b (D75): the command runs before the change still to make
  } : (leftOut.length ? { names: [], leftOut: leftOutWhy.map((x) => x.name), leftOutWhy, disk: null, setupCmd: null, setupMs: null, before: null } : null);
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
    const sameAs = use === 'draft' ? await draftSameAs(workflowId, fingerprintOf, fp) : null;   // U-T7 (D7)
    // U-T4: a draft identical to v{n} is not "your changes": it is named as the version picker names it.
    const same = sameAs !== null;
    return { use, sameAs, label: same ? `Your draft (same as v${sameAs})` : useLabel(use, ctx, 'select'),
      short: same ? `your draft (same as v${sameAs})` : useLabel(use, ctx), want: readyEx.length * tries, reusable,
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

/** U-T8 (F43): workflow id → the highest cost shown while its test runs, so "Cost so far" never goes down (a live run's
 *  cost is 0 once its run is gone, before its row is read). One test per workflow runs at a time (D37), so a new test
 *  replaces the entry: the map is bounded by the number of workflows, even when a page was closed mid-test. In memory only. */
const COST_SHOWN = new Map();
export const costShownSize = () => COST_SHOWN.size;
function shownCost(workflowId, run, usd) {
  const key = `${run.id}|${run.createdAt}`;   // the creation time too: an id is never reused, a test database's may be
  if (run.status !== 'running') { if (COST_SHOWN.get(workflowId)?.key === key) COST_SHOWN.delete(workflowId); return usd; }
  const seen = COST_SHOWN.get(workflowId);
  const top = Math.max(usd, seen && seen.key === key ? seen.top : usd);
  COST_SHOWN.set(workflowId, { key, top });
  return top;
}

/** Board 20 (G8: two rows per example when both versions need tries). `costOf` = the runner's live cost. 3a (board 35):
 *  `phaseOf` = what a running project try is doing now (the runner's); `project.disk` is filled by progressDisk. 3b (D75):
 *  `beforeNowOf` = what the before phase is doing now (the runner's), the answer's `before`. U-T8: `stoppingOf` = the
 *  runner's stopping read, the answer's `stopping`. */
export function progressOf(workflowId, runId, { costOf = null, phaseOf = null, beforeNowOf = null, stoppingOf = null } = {}) {
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
    if (bad) setupStop = { cmd: bad.setup.cmd, tail: bad.setup.tail || '', exampleId: bad.exampleId, exampleName: ex ? ex.name : '', label: useLabel(bad.use, ctx), tryNo: bad.tryNo,
      // P38: filled by progressEdited (async, in the route): what continueRun checks.
      edited: false };
  }
  const before = beforeNowOf ? beforeNowOf(run.id) : null;
  const startOf = (ex) => ({ ref: ex.project.startRef, short: ex.project.startSha.slice(0, 7), at: ex.project.startAt, key: ex.project.key, sha: ex.project.startSha });
  const phases = (() => {
    const ex = firstNow ? store.readExample(workflowId, firstNow.exampleId) : null;
    if (ex && ex.project) {
      return { exampleName: firstNow.name, label: firstNow.label || useLabel(run.b, ctx), tryNo: firstNow.now.tryNo, phase: firstNow.now.phase,
        start: startOf(ex), setupCmd: ex.project.setupCmd };
    }
    // Board 42: no try yet, the before phase runs: the steps of a try, none current, from the first project example.
    if (firstNow || !before || run.status !== 'running' || !projectRows.length) return null;
    return { before: true, phase: null, start: startOf(projectRows[0]), setupCmd: projectRows[0].project.setupCmd };
  })();
  const project = projectRows.length ? { phases, disk: null, setupStop } : null;   // disk: progressDisk (async), in the route
  const costBy = new Map();
  const costFor = (use) => { const k = store.useRef(use); if (!costBy.has(k)) costBy.set(k, perTryCost(workflowId, use)); return costBy.get(k); };
  const estimateUsd = own.reduce((s, t) => { const c = costFor(t.use); return s === null || c === null ? null : s + c; }, 0);
  const remaining = own.filter((t) => t.status === 'waiting' || t.status === 'running').length;
  const ms = perTryMs(workflowId, { mock: own.some((t) => t.mock) });   // U-T8 (F21): a mock test's time left from mock tries
  return {
    run, title: testTitle(run, ctx, { mode: run.status === 'running' ? 'testing' : 'compare', exampleName: firstExampleName(run) }), rows,
    done: own.filter((t) => FIN.has(t.status)).length, total: own.length,
    costUsd: shownCost(workflowId, run, costOf ? costOf(run.id) : store.spentOfRun(run.id)), estimateUsd, capUsd: run.capUsd,
    minutesLeft: ms !== null && remaining ? Math.max(1, Math.ceil((Math.ceil(remaining / TRIES_AT_ONCE) * ms) / 60000)) : null,
    takenMs: takenMs(run, own),
    quick: run.quick,
    before,
    project,
    madeAgain: store.madeAgainOf(run.id),   // U-T2: tries made again after a problem in Worca (never counted)
    stopping: run.status === 'running' && !!(stoppingOf && stoppingOf(run.id)),   // U-T8 (F19): the runner's stopping read
  };
}

/** P38: would "Finish the rest" be refused (the draft or a tested version changed, or an example of a stopped/waiting try
 *  was edited)? Then the page offers a new test instead. Same check as continueRun's (changed.mjs). */
export async function progressEdited(workflowId, run, { fingerprintOf = (id, use) => useFingerprint(id, use) } = {}) {
  const fingerprintNow = async (id, use) => { try { return await fingerprintOf(id, use); } catch { return null; } };
  return (await changedSinceStart(run, { fingerprintNow })) !== null;
}

// A running test's disk need, worked out at its first poll and kept while it runs (only free space is read again).
const NEED_OF_RUN = new Map();

/** Board 35's "Disk in use" (D60): free at the start minus free now, of about the need. The route adds it (statfs is async).
 *  The need (the trees of the examples' start points) is worked out once per running test; each poll reads free space only.
 *  `planOf` and `freeDisk` are seams for the tests. */
export async function progressDisk(workflowId, run, { diskOf = null, planOf = (exs, o) => diskPlanOf(exs, o), freeDisk = freeDiskBytes } = {}) {
  const exs = run.exampleIds.map((id) => store.readExample(workflowId, id)).filter((x) => x && x.project);
  if (!exs.length) return null;
  const running = run.status === 'running';
  let needBytes;
  let free;
  if (running && NEED_OF_RUN.has(run.id)) {
    needBytes = NEED_OF_RUN.get(run.id);
    free = await freeDisk();
  } else {
    const plan = await planOf(exs, { tries: run.tries, sides: run.a != null ? 2 : 1 });
    needBytes = plan ? plan.needBytes : null;
    free = plan ? plan.freeBytes : await freeDisk();
    if (running) NEED_OF_RUN.set(run.id, needBytes);
  }
  if (!running) NEED_OF_RUN.delete(run.id);   // a finished test is read rarely; "Finish the rest" works it out again
  const start = diskOf ? (diskOf(run.id) || {}).freeAtStart ?? null : null;
  return { inUseBytes: start != null && free != null ? Math.max(0, start - free) : null, needBytes, freeBytes: free ?? null };
}

async function changesBetween(workflowId, a, b, registry, modelLabel) {
  const ga = await useGraph(workflowId, a);
  const gb = await useGraph(workflowId, b);
  if (!ga || !gb) return [];
  const labelOf = (n) => (n && n.kind === 'agent' && registry[n.key] && registry[n.key].displayName) || (n && (n.key || n.kind)) || 'step';
  return diffGraphs(ga, gb, { labelOf, modelLabel }).map((c) => c.text);
}

/** Board 5: the model, Part 1's "what you changed" texts (graph changes only, D16), and the fair-comparison notes. */
export async function compareOf(workflowId, runId, { registry = loadAgentRegistry(), fingerprintOf = (id, use) => useFingerprint(id, use), modelLabel = null } = {}) {
  const run = runOf(workflowId, runId);
  const ctx = labelCtx(workflowId);
  const input = modelInput(run, ctx);
  const changes = run.a != null ? await changesBetween(workflowId, run.a, run.b, registry, await modelLabeler({ modelLabel })) : [];
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
    examples: input.examples.length, costUsd: store.spentOfRun(run.id), model: compareModel(input), changes, fair,
    madeAgain: store.madeAgainOf(run.id) };   // U-T2: the page adds it to the fair-comparison lines
}

/** Board 6 (G2: one column for Try it once now) and board 31 (what a pretend try would have sent). The cards show the
 *  first PREVIEW_MAX characters; tryResult reads all. 3a (boards 36, 37): a project try's changes and setup, and what the
 *  guard stopped in both modes. `forgeFor(remoteNames)` → forgeOf (forgeNamer): only the remotes the guarded pushes
 *  named are looked up. */
export async function sideBySide(workflowId, runId, exampleId, { forgeFor = null } = {}) {
  const run = runOf(workflowId, runId);
  const ex = store.readExample(workflowId, exampleId);
  if (!ex || !run.exampleIds.includes(ex.id)) throw err(`no example ${exampleId} in this test`, 'NOT_FOUND');
  const ctx = labelCtx(workflowId);
  const tries = store.triesOfRun(run.id).filter((t) => t.exampleId === ex.id && FIN.has(t.status));
  const list = (side) => tries.filter((t) => t.side === side).sort((x, y) => x.tryNo - y.tryNo || x.id - y.id);
  const A = run.a != null ? list('a') : [];
  const B = list('b');
  let forgeOf = null;
  if (forgeFor) {
    const names = new Set();
    for (const t of [...A, ...B]) for (const e of await readConnectorCalls(t.pipelineId)) { const n = pushRemoteOf(e); if (n) names.add(n); }
    forgeOf = names.size ? await forgeFor([...names]) : null;
  }
  const view = async (t) => {
    if (!t) return null;
    const m = await mainResult(t.pipelineId);
    const text = typeof m.text === 'string' ? m.text : null;
    // 3a D68: the guard's rows in both modes. A real try has no stand-ins, so its log holds only what the guard stopped.
    const sent = await wouldHaveSent(t.pipelineId, forgeOf ? { forgeOf } : {});
    return { tryId: t.id, status: t.status, verdict: t.verdict, name: m.name,
      text: text && text.length > PREVIEW_MAX ? text.slice(0, PREVIEW_MAX) : text, truncated: !!text && text.length > PREVIEW_MAX,
      connectors: t.connectors, wouldHaveSent: sent.sent, answeredReads: sent.reads,
      // U-T12 (F23, board 47): what Worca asked in this try; null for an older try that never kept it.
      asked: t.verdict && t.verdict.facts && Array.isArray(t.verdict.facts.asked) ? t.verdict.facts.asked : null,
      project: t.startCommit || t.changes ? { changes: t.changes, setup: t.setup ? { cmd: t.setup.cmd, ms: t.setup.ms } : null } : null };
  };
  const out = [];
  for (let i = 0; i < Math.max(A.length, B.length); i += 1) out.push({ n: i + 1, a: await view(A[i]), b: await view(B[i]) });
  const labels = { a: run.a != null ? useLabel(run.a, ctx) : null, b: useLabel(run.b, ctx) };
  const m = compareModel({ examples: [{ id: ex.id, name: ex.name }], a: labels.a ? { label: labels.a } : null, b: { label: labels.b }, tries });
  return { run, compareTitle: testTitle(run, ctx, { exampleName: ex.name }), example: { id: ex.id, name: ex.name }, labels, row: m.examples[0],
    connectors: run.connectors, tries: out,
    start: ex.project ? { ref: ex.project.startRef, short: ex.project.startSha.slice(0, 7), at: ex.project.startAt, sha: ex.project.startSha, subject: await subjectOfStart({ key: ex.project.key, sha: ex.project.startSha }), setupCmd: ex.project.setupCmd,
      setupMs: store.avgSetupMs(ex.id, ex.project.startCommit) } : null,
    nothingPushed: !!ex.project,
  };
}

/** P9: the forge of each named remote of the real project, for board 37's "… on GitHub". Read only: one
 *  `git remote get-url <name>` per name (the read-only allowlist), never a listing of every remote. */
export async function forgeNamer(key, names = []) {
  const reg = (await listProjects()).find((p) => p.key === key);
  const by = new Map();
  if (reg && reg.exists) {
    for (const name of [...new Set(names)].slice(0, 10)) {
      const url = await remoteUrl(reg.path, name);
      const forge = url ? forgeOfRemote(parseRemoteUrl(url)) : null;
      by.set(name, forge ? FORGE_LABEL[forge] || null : null);
    }
  }
  return (name) => by.get(name) || null;
}

export const TRY_PATCH_MAX = 5 * 1024 * 1024;
/** A try's whole diff (board 36's "Read all the changes"): at most TRY_PATCH_MAX bytes are read; `cut` says the diff is
 *  longer (the text then ends at its last whole line). '' when it has none. */
export async function tryChanges(workflowId, runId, tryId, { maxBytes = TRY_PATCH_MAX } = {}) {
  const run = runOf(workflowId, runId);
  const t = store.triesOfRun(run.id).find((x) => x.id === Number(tryId));
  if (!t) throw err(`no try ${tryId} in this test`, 'NOT_FOUND');
  const row = t.pipelineId ? findPipelineRowById(t.pipelineId) : null;
  const hit = row ? await resolveIndexedArtifactFileForRow(row, DIFF_PATCH_FILE) : null;
  if (!hit) return { patch: '', cut: false };
  let fh = null;
  try {
    fh = await open(hit.file, 'r');
    const size = (await fh.stat()).size;
    const buf = Buffer.alloc(Math.min(size, maxBytes));
    const { bytesRead } = buf.length ? await fh.read(buf, 0, buf.length, 0) : { bytesRead: 0 };
    let bytes = buf.subarray(0, bytesRead);
    const cut = size > maxBytes;
    if (cut) { const nl = bytes.lastIndexOf(0x0a); if (nl >= 0) bytes = bytes.subarray(0, nl + 1); }   // never half a line or character
    return { patch: bytes.toString('utf8'), cut };
  } catch { return { patch: '', cut: false }; }   // a live run rewrote it meanwhile: nothing to show
  finally { if (fh) await fh.close().catch(() => {}); }
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
