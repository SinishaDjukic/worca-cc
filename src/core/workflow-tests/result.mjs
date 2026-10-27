// src/core/workflow-tests/result.mjs
// What one try produced and how it measures up (plans/workflow-tests-part2-plan.md D25): the facts the Basics read,
// the main result the text checks read, the paths of its result folder, and the Library script checks (run on the
// script bench, on a COPY of that folder, one at a time).
import { mkdtemp, cp, rm, stat, lstat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, basename, extname } from 'node:path';
import { findPipelineRowById, readPipelineStateById, listRunArtifacts, resolveIndexedArtifactForRow, runDirForRow } from '../artifacts.mjs';
import { WORK_ARTIFACT_KIND } from '../no-project-work.mjs';
import { runBenchOnce } from '../script-bench.mjs';
import { readScript } from '../script-store.mjs';
import { DEFAULT_TIMEOUT_MS } from '../../shared/graph/script-meta.mjs';
import { runCheck, judgeTry, wordCount, checkLabel } from '../../shared/workflow-tests/checks.mjs';

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

/** D25: the End node's result file, else its value, else the largest text file in the result folder. Never throws. */
export async function mainResult(pipelineId) {
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
  const main = row ? await mainResult(row.id) : { ...NONE };
  const files = row ? (await listRunArtifacts(row.id, { kind: WORK_ARTIFACT_KIND })).map((a) => a.relPath) : [];
  return { pipelineId: row ? row.id : null, facts, ...main, files };
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
export function runScriptCheck(check, { pipelineId, runBench = runBenchOnce, waitMs = BUSY_WAIT_MS, deadlineMs = null, timeoutOf = declaredTimeout } = {}) {
  const notMet = (error) => ({ met: false, value: 'Not met', error });
  // Does the whole job, setup included, and always removes its copy once it settles (even after a timeout).
  const work = async (state, timeoutMs) => {
    let scratch = null;
    try {
      const row = pipelineId ? findPipelineRowById(pipelineId) : null;
      if (pipelineId && !row) return notMet('The try was not found.');
      scratch = await mkdtemp(join(tmpdir(), 'worca-wft-'));
      if (row) {
        const src = join(await runDirForRow(row), 'work');
        try { if ((await stat(src)).isDirectory()) await cp(src, scratch, { recursive: true, force: true, filter: copyable }); } catch { /* no result folder: an empty one */ }
      }
      for (let attempt = 0; ; attempt += 1) {
        try {
          const r = await runBench({ key: check.key, params: check.params || {}, inputs: {}, timeoutMs, cwd: { kind: 'dir', dir: scratch } }, { allowDirCwd: true });
          const met = !!r && r.status === 'clean';
          return { met, value: met ? 'Met' : String((r && (r.summary || r.status)) || 'Not met').split('\n')[0].slice(0, 120) };
        } catch (err) {
          if (err && err.code === 'BUSY' && attempt < BUSY_RETRIES && !state.timedOut) { await wait(waitMs); continue; }
          return notMet(err && err.message ? err.message : String(err));
        }
      }
    } catch (err) {
      return notMet(err && err.message ? err.message : String(err));
    } finally { if (scratch) await rm(scratch, { recursive: true, force: true }).catch(() => {}); }
  };
  const job = async () => {
    const state = { timedOut: false };
    const timeoutMs = await timeoutOf(check.key);
    let timer;
    const deadline = new Promise((resolve) => {
      timer = setTimeout(() => { state.timedOut = true; resolve(notMet('timed out')); }, deadlineMs ?? timeoutMs + SCRIPT_CHECK_MARGIN_MS);
    });
    return Promise.race([work(state, timeoutMs), deadline]).finally(() => clearTimeout(timer));
  };
  const p = benchTail.then(job, job);
  benchTail = p.catch(() => {});
  return p;
}

/**
 * The verdict of one try: every built-in check on its main result and files, then its script checks (D18).
 * @param {{basics: object, checks: Array}} example
 * @param {object} outcome readTryOutcome's answer
 * @param {{runScript?: Function, scriptName?: (key: string) => string}} [opts]
 */
export async function checkTry(example, outcome, { runScript = runScriptCheck, scriptName = (k) => k } = {}) {
  const results = [];
  for (const check of example.checks || []) {
    const label = checkLabel(check, { scriptName: check.kind === 'script' ? scriptName(check.key) : null });
    if (check.kind === 'script') {
      if (outcome.facts.status !== 'done') { results.push({ id: check.id, label, met: false, value: 'Not run: the try did not finish' }); continue; }
      const r = await runScript(check, { pipelineId: outcome.pipelineId });
      results.push({ id: check.id, label, met: !!r.met, value: r.value, ...(r.error ? { error: r.error } : {}) });
      continue;
    }
    const r = runCheck(check, { text: outcome.text, files: outcome.files });
    results.push({ id: check.id, label, met: r.met, value: r.value });
  }
  return judgeTry(example, outcome.facts, results,
    { name: outcome.name, source: outcome.source, words: typeof outcome.text === 'string' ? wordCount(outcome.text) : null });
}
