// src/core/workflow-tests/result.mjs
// What one try produced and how it measures up (plans/workflow-tests-part2-plan.md D25): the facts the Basics read,
// the main result the text checks read, the paths of its result folder, and the Library script checks (run on the
// script bench, on a COPY of that folder, one at a time).
import { existsSync } from 'node:fs';
import { sep } from 'node:path';
import { mkdtemp, cp, rm, stat, lstat, readFile, realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, basename, extname } from 'node:path';
import { findPipelineRowById, readPipelineStateById, listRunArtifacts, resolveIndexedArtifactForRow, runDirForRow } from '../artifacts.mjs';
import { worcaHome } from '../projects.mjs';
import { RESULTS_FILE, DIFF_PATCH_FILE } from '../results.mjs';
import { WORK_ARTIFACT_KIND } from '../no-project-work.mjs';
import { runBenchOnce } from '../script-bench.mjs';
import { readScript } from '../script-store.mjs';
import { CONNECTOR_CALLS_FILE } from './connectors.mjs';
import { scratchTryLog, SETTINGS_IGNORED_FILE } from './try-guard-env.mjs';
import { runShellStep, readTrySetup, tryShellEnv, firstLine } from './shell-step.mjs';
import { DEFAULT_TIMEOUT_MS } from '../../shared/graph/script-meta.mjs';
import { runCheck, judgeTry, wordCount, checkLabel, TEXT_KINDS, SCOPE_KINDS, commandSummary } from '../../shared/workflow-tests/checks.mjs';

export const TEXT_EXTS = Object.freeze(new Set(['.md', '.markdown', '.txt', '.html', '.htm', '.csv', '.json', '.yaml', '.yml', '.xml']));
export const RESULT_TEXT_MAX = 2 * 1024 * 1024;
const BUSY_RETRIES = 5;
const BUSY_WAIT_MS = 3000;
// The race against the deadline is only a backstop: the bench is handed the script's own timeout and kills the child
// itself (freeing its slot and per-key lock). The backstop waits that long plus this margin.
export const SCRIPT_CHECK_MARGIN_MS = 60 * 1000;
const NONE = Object.freeze({ name: null, text: null, source: null });
const isText = (p) => TEXT_EXTS.has(extname(String(p || '')).toLowerCase());
const clip = (t) => (typeof t === 'string' && t.length > RESULT_TEXT_MAX ? t.slice(0, RESULT_TEXT_MAX) : t);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const parseJson = (t) => { try { return JSON.parse(t); } catch { return null; } };
/** 3a: a git try (it ran in Worca's copy of a project): its branch record has the commit it started from. */
export function isProjectRow(row) {
  const br = row && typeof row.branch === 'string' ? parseJson(row.branch) : null;
  return !!(br && typeof br.baseSha === 'string' && br.baseSha);
}

const STATUS_WORD = { A: 'added', C: 'added', M: 'changed', T: 'changed', R: 'renamed', D: 'removed' };
/** D47, D67: results.json (the harness's) as board 36 lists it. */
export function projectChanges(results, { max = 50 } = {}) {
  const r = results && typeof results === 'object' ? results : {};
  const rows = [...(Array.isArray(r.newFiles) ? r.newFiles : []), ...(Array.isArray(r.changedFiles) ? r.changedFiles : [])]
    .map((f) => ({ status: STATUS_WORD[String(f.status || 'M')[0]] || 'changed', path: String(f.path || ''), ...(f.from ? { from: String(f.from) } : {}),
      added: Number(f.added || 0), removed: Number(f.removed || 0), ...(f.binary ? { binary: true } : {}) }))
    .filter((f) => f.path)
    .sort((x, y) => (x.path < y.path ? -1 : x.path > y.path ? 1 : 0));
  const counts = { added: rows.filter((f) => f.status === 'added').length,
    changed: rows.filter((f) => f.status === 'changed' || f.status === 'renamed').length,
    removed: rows.filter((f) => f.status === 'removed').length };
  const s = r.summary && typeof r.summary === 'object' ? r.summary : {};
  return { files: rows.slice(0, max), paths: rows.filter((f) => f.status !== 'removed').map((f) => f.path), total: rows.length, counts,
    // 3b (D73): every path the try touched, a rename's old path too (a copy's source is unchanged), for the scope checks.
    touched: [...new Set(rows.flatMap((f) => (f.from && f.status === 'renamed' ? [f.from, f.path] : [f.path])))].sort(),
    added: Number(s.linesAdded || 0), removed: Number(s.linesRemoved || 0) };
}

/** D47: what a project try changed and where its checkout is (kept until its checks have run, D43). */
async function projectOutcome(row, dir) {
  const br = parseJson(row.branch) || {};
  const results = dir ? parseJson(await readFile(join(dir, RESULTS_FILE), 'utf8').catch(() => 'null')) : null;
  const wt = typeof br.worktreeDir === 'string' && br.worktreeDir && existsSync(br.worktreeDir) ? br.worktreeDir : null;
  return { key: row.project_key, base: br.baseSha || null, branch: br.feature || null, ...projectChanges(results),
    // results.json unreadable: the change list is unknown, never "nothing changed" (the scope checks then say Worca could not count).
    ...(results && typeof results === 'object' ? {} : { touched: null }),
    patchFile: dir && existsSync(join(dir, DIFF_PATCH_FILE)) ? join(dir, DIFF_PATCH_FILE) : null,
    checkoutDir: wt, runRoot: join(worcaHome(), 'runs', row.id) };
}

/** D25: the End node's result file, else its value, else the largest text file in the result folder. Never throws. */
export async function mainResult(pipelineId, { project } = {}) {
  try {
    const row = pipelineId ? findPipelineRowById(pipelineId) : null;
    if (!row) return { ...NONE };
    const result = readPipelineStateById(row.id)?.result || null;
    if (result && typeof result.path === 'string' && result.path && isText(result.path)) {
      const hit = await resolveIndexedArtifactForRow(row, result.path);
      if (hit) return { name: basename(hit.rel), text: clip(hit.text), source: 'end-file' };
    }
    if (result && result.value != null && result.value !== '') {
      return { name: null, text: clip(typeof result.value === 'string' ? result.value : JSON.stringify(result.value, null, 2)), source: 'end-value' };
    }
    // 3a D47: a project try's result is its End node's; the largest text file of a project is not a result.
    if (project ?? isProjectRow(row)) return { ...NONE };
    const work = (await listRunArtifacts(row.id, { kind: WORK_ARTIFACT_KIND })).filter((a) => isText(a.relPath))
      .sort((x, y) => y.bytes - x.bytes || (x.relPath < y.relPath ? -1 : 1));
    for (const a of work) {
      const hit = await resolveIndexedArtifactForRow(row, a.relPath);
      if (hit) return { name: basename(hit.rel), text: clip(hit.text), source: 'work' };
    }
    return { ...NONE };
  } catch { return { ...NONE }; }
}

const sumDeliveries = (wd) => Object.values(wd && typeof wd === 'object' ? wd : {})
  .reduce((s, n) => s + (Number.isFinite(Number(n)) ? Number(n) : 0), 0);

/** Everything the verdict needs from a finished try. `help` and `failReason` come from the runner (answers.mjs). */
export async function readTryOutcome(pipelineId, { help = [], failReason = null, durationMs = null } = {}) {
  const row = pipelineId ? findPipelineRowById(pipelineId) : null;
  const state = row ? readPipelineStateById(row.id) : null;
  const facts = {
    status: row ? row.status : 'error',
    costUsd: row ? Number(row.total_cost_usd || 0) : 0,
    durationMs,
    sentBack: sumDeliveries(state && state.wireDeliveries),   // correction 2: loop deliveries
    help,
    failReason: failReason || (row ? null : 'The try did not start.'),
  };
  const dir = row ? await runDirForRow(row).catch(() => null) : null;   // a Part 2 row may have no run folder on disk
  const projectRun = !!row && isProjectRow(row);
  const main = row ? await mainResult(row.id, { project: projectRun }) : { ...NONE };
  const project = projectRun ? await projectOutcome(row, dir) : null;
  const files = project ? project.paths : row ? (await listRunArtifacts(row.id, { kind: WORK_ARTIFACT_KIND })).map((a) => a.relPath) : [];
  // Task 5 fix review (concern 8): a spawn of this try ran without Worca's settings file (its canary's marker was missing).
  const settingsIgnored = !!dir && existsSync(join(dir, SETTINGS_IGNORED_FILE));
  return { pipelineId: row ? row.id : null, facts, ...main, files, project,
    setup: projectRun && dir ? await readTrySetup(dir) : null, logFile: dir ? join(dir, CONNECTOR_CALLS_FILE) : null,
    ...(settingsIgnored ? { settingsIgnored: true } : {}) };
}

let benchTail = Promise.resolve();
const declaredTimeout = async (key) => {
  try { const t = (await readScript(key))?.meta?.timeoutMs; return Number.isInteger(t) && t > 0 ? t : DEFAULT_TIMEOUT_MS; } catch { return DEFAULT_TIMEOUT_MS; }
};
const copyable = async (src) => { try { return !(await lstat(src)).isSymbolicLink(); } catch { return false; } };

/**
 * One Library script check (D18, D25) on a COPY of the try's result folder: a script may write into its cwd, and the
 * try's own result must stay as it was for the other checks and the side-by-side view. Serialised (one script check
 * at a time), so the bench's limits (2 at once, one per key: script-bench.mjs:335) only meet a person's own bench runs,
 * which are waited out. Met when the bench says `clean`.
 */
export function runScriptCheck(check, { pipelineId, cwdDir = null, logFile = null, runBench = runBenchOnce, waitMs = BUSY_WAIT_MS, deadlineMs = null,
  timeoutOf = declaredTimeout } = {}) {
  // Final review I1, I3 (D56): a check runs after the agent may have changed scripts, so it gets the try's full outward guard
  // (the script bench applies it to the child's env), writing to the try's log, or a scratch one when that is not known.
  const tryGuard = { logFile: logFile || scratchTryLog() };
  const notMet = (error) => ({ met: false, value: 'Not met', error });
  // U-T2: the bench threw, or the backstop timed out: Worca could not run the check, so it says nothing of the try.
  const notRun = (error) => ({ ...notMet(error), worcaProblem: true });
  // Does the whole job, setup included, and always removes its copy once it settles (even after a timeout).
  const work = async (state, timeoutMs) => {
    let scratch = null;
    try {
      const row = pipelineId ? findPipelineRowById(pipelineId) : null;
      if (pipelineId && !row) return notMet('The try was not found.');
      let dir = cwdDir;   // 3a D47: a project try's checkout is thrown away after its checks, so it needs no copy
      if (!dir) {
        scratch = await mkdtemp(join(tmpdir(), 'worca-wft-'));
        dir = scratch;
        if (row) {
          const src = join(await runDirForRow(row), 'work');
          try { if ((await stat(src)).isDirectory()) await cp(src, scratch, { recursive: true, force: true, filter: copyable }); } catch { /* no result folder: an empty one */ }
        }
      }
      for (let attempt = 0; ; attempt += 1) {
        try {
          const r = await runBench({ key: check.key, params: check.params || {}, inputs: {}, timeoutMs, cwd: { kind: 'dir', dir } }, { allowDirCwd: true, tryGuard });
          const met = !!r && r.status === 'clean';
          return { met, value: met ? 'Met' : String((r && (r.summary || r.status)) || 'Not met').split('\n')[0].slice(0, 120) };
        } catch (err) {
          if (err && err.code === 'BUSY' && attempt < BUSY_RETRIES && !state.timedOut) { await wait(waitMs); continue; }
          // The script was deleted from the Library: the person's doing, a normal Not met check (not Worca's problem).
          if (err && err.code === 'NOT_FOUND') return { met: false, value: 'The script is no longer in the Library.' };
          return notRun(err && err.message ? err.message : String(err));
        }
      }
    } catch (err) {
      return notRun(err && err.message ? err.message : String(err));
    } finally { if (scratch) await rm(scratch, { recursive: true, force: true }).catch(() => {}); }
  };
  const job = async () => {
    const state = { timedOut: false };
    const timeoutMs = await timeoutOf(check.key);
    let timer;
    const deadline = new Promise((resolve) => {
      timer = setTimeout(() => { state.timedOut = true; resolve(notRun('timed out')); }, deadlineMs ?? timeoutMs + SCRIPT_CHECK_MARGIN_MS);
    });
    return Promise.race([work(state, timeoutMs), deadline]).finally(() => clearTimeout(timer));
  };
  const p = benchTail.then(job, job);
  benchTail = p.catch(() => {});
  return p;
}

/** D58: a text check's file: from the checkout of a project try (a regular file inside it), else from the try's work/. */
export async function readCheckFile(outcome, rel) {
  const clean = String(rel || '').replace(/\\/g, '/');
  if (!clean || clean.startsWith('/') || /^[A-Za-z]:/.test(clean) || clean.split('/').includes('..')) return null;
  if (outcome.project) {
    const dir = outcome.project.checkoutDir;
    if (!dir) return null;
    const file = join(dir, ...clean.split('/'));
    try {
      if (!(await lstat(file)).isFile()) return null;
      // A linked folder on the way (a symlink, a Windows junction) must not lead out of the checkout.
      const fold = (p) => (process.platform === 'win32' ? p.toLowerCase() : p);
      const root = fold(await realpath(dir));
      const real = fold(await realpath(file));
      if (real !== root && !real.startsWith(root.endsWith(sep) ? root : root + sep)) return null;
      return clip(await readFile(file, 'utf8'));
    } catch { return null; }
  }
  const row = outcome.pipelineId ? findPipelineRowById(outcome.pipelineId) : null;
  const hit = row ? await resolveIndexedArtifactForRow(row, `work/${clean}`) : null;
  return hit ? clip(hit.text) : null;
}

/** D57: "The command passes": in the checkout, with the try's guard env, within its time limit. */
export async function runCommandCheck(check, { cwd, logFile = null, run = runShellStep } = {}) {
  const n = check.timeoutMin;
  const r = await run({ command: check.cmd, cwd, env: tryShellEnv({ logFile }), timeoutMs: n * 60_000 });
  if (r.timedOut) return { met: false, value: `Stopped after ${n} ${n === 1 ? 'minute' : 'minutes'}`, output: r.tail, timedOut: true };
  return { met: r.ok, value: commandSummary(r.tail) || (r.ok ? 'Met' : 'Ended with an error'), output: r.tail };
}

/**
 * The verdict of one try (D18, D47): the pure checks first (they read the result as the try left it), then the commands
 * and Library scripts in the example's order (they may change a project try's checkout).
 * @param {{basics: object, checks: Array}} example
 * @param {object} outcome readTryOutcome's answer
 * @param {{runScript?: Function, runCommand?: Function, readText?: Function, scriptName?: (key: string) => string, onCommand?: (cmd: string) => void}} [opts]
 */
export async function checkTry(example, outcome, { runScript = runScriptCheck, runCommand = runCommandCheck, readText = readCheckFile,
  scriptName = (k) => k, onCommand = () => {} } = {}) {
  const checks = example.checks || [];
  const results = new Array(checks.length);
  const later = [];
  for (const [i, check] of checks.entries()) {
    if (check.kind === 'script' || check.kind === 'command') { later.push(i); continue; }
    const label = checkLabel(check);
    let text = outcome.text;
    if (TEXT_KINDS.includes(check.kind) && check.file) {
      text = await readText(outcome, check.file);
      if (text === null) { results[i] = { id: check.id, label, met: false, value: `No file named ${check.file}` }; continue; }
    }
    const scoped = SCOPE_KINDS.includes(check.kind);
    const scope = scoped
      ? { kind: check.kind, ...(check.kind === 'under' ? { dirs: check.dirs } : check.kind === 'unchanged' ? { patterns: check.patterns } : { max: check.max }) } : {};
    let changes = outcome.project ? { touched: outcome.project.touched, total: Number(outcome.project.total || 0) } : null;
    // 3b (D73): a scope check counts the change list, not the copy. With no list, the copy-is-gone path's order: a try that did not
    // finish wrote no results.json because nothing changed (the harness skips it then), so it counts an empty list; a try that
    // finished and has none means Worca lost it: it could not count (U-T2), so a Worca problem, never the workflow's.
    if (scoped && changes && !Array.isArray(changes.touched)) {
      if (outcome.facts.status === 'done') {
        results[i] = { id: check.id, label, met: false, value: 'Not run: the list of changed files is gone', ...scope, worcaProblem: true };
        continue;
      }
      changes = { touched: [], total: 0 };
    }
    const r = runCheck(check, { text, files: outcome.files, changes });
    results[i] = { id: check.id, label, met: r.met, value: r.value, ...scope };
  }
  const cwdDir = outcome.project ? outcome.project.checkoutDir : null;
  for (const i of later) {
    const check = checks[i];
    const label = checkLabel(check, { scriptName: check.kind === 'script' ? scriptName(check.key) : null });
    const not = (value, extra = {}) => { results[i] = { id: check.id, label, met: false, value, ...extra }; };
    if (outcome.facts.status !== 'done') { not('Not run: the try did not finish'); continue; }
    // U-T2: Worca lost the copy it made: a Worca problem (worcaProblem), never the workflow's.
    if (outcome.project && !cwdDir) { not('Not run: the copy of the project is gone', { worcaProblem: true }); continue; }
    if (check.kind === 'command') {
      onCommand(check.cmd);
      let r;
      // U-T2: the command runner itself threw (it never ran the command): a Worca problem; its first line for developers.
      try { r = await runCommand(check, { cwd: cwdDir, logFile: outcome.logFile }); } catch (e) {
        r = { met: false, value: 'Ended with an error', error: firstLine(String((e && e.message) || e)), worcaProblem: true };
      }
      // Board 36: a command its time limit stopped says so in the side by side (timedOut), not "ended with an error".
      // Round 2 (M5): the kind and the command travel with the result, so the side by side sets it in code from data.
      results[i] = { id: check.id, kind: 'command', cmd: check.cmd, label, met: !!r.met, value: r.value, ...(r.output ? { output: r.output } : {}),
        ...(r.timedOut ? { timedOut: true } : {}), ...(r.worcaProblem ? { error: r.error, worcaProblem: true } : {}) };
      continue;
    }
    const r = await runScript(check, { pipelineId: outcome.pipelineId, cwdDir, logFile: outcome.logFile });
    results[i] = { id: check.id, label, met: !!r.met, value: r.value, ...(r.error ? { error: r.error } : {}), ...(r.worcaProblem ? { worcaProblem: true } : {}) };
  }
  return judgeTry(example, outcome.facts, results,
    { name: outcome.name, source: outcome.source, words: typeof outcome.text === 'string' ? wordCount(outcome.text) : null });
}
