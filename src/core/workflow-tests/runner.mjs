// src/core/workflow-tests/runner.mjs
// The test runner (plans/workflow-tests-part2-plan.md D27, D35–D37). It tries examples on one or two versions, at most
// MAX_PARALLEL at a time and one test per workflow, answers their questions (answers.mjs), stops when the cost cap is
// passed or something a try depends on changed, and judges every finished try (deps.judge). Each try is an ordinary
// no-project run started through the run handler (deps.startRun), marked as a test (D21), with the test's connectors
// mode (D35). The state lives in the store; this module keeps only what is live.
import * as store from './store.mjs';
import { changedText, editedText, changedSinceStart, leftTries } from './changed.mjs';
import { tx } from '../db.mjs';
import { attachAnswerer } from './answers.mjs';
import { tryRunBody } from './try-body.mjs';
import { fmtUsd } from '../../shared/workflow-tests/checks.mjs';
import { REASON, REASON_CODES } from '../failure-policy.mjs';
import { setupFailedText, worcaTryText, worcaProblemText } from '../../shared/workflow-tests/project-text.mjs';
import { TRY_SETUP_STAGE, firstLine } from './shell-step.mjs';
import { PLUGINS_OFF_STAGE } from './project-claude-settings.mjs';
import { WORKTREE_STAGE } from '../setup-stages.mjs';
import { releaseCopy } from './project-copy.mjs';
import { beforeSpecOf } from './before-run.mjs';

export const MAX_PARALLEL = 3;   // D36. Library script checks stay one at a time (result.mjs), inside runBenchOnce's limit of 2.
export const COST_POLL_MS = 2000;
/** D37, G19: the refusal of a second start, and the hint the UI shows on its disabled buttons. */
export const BUSY_TEXT = 'A test of this workflow is running. Wait for it, or stop it first.';
/** C18: what changed since a test started (a refused "Finish the rest", or a test stopped as `changed`). */
export { changedText, editedText };
/** A stored detail (no full stop): the UI says "Stopped: Worca could not save how this test ended." */
export const CLOSE_FAILED_TEXT = 'Worca could not save how this test ended';
const err = store.testError;
const msgOf = (e) => (e && e.message ? e.message : String(e));
/** The start handler's 403s are spending refusals (the total cost limit, the team total cap); any other 403 is a refusal. */
const SPENDING_RE = /cost limit|cost cap|total cap|spending/i;
/** Why a refused start stops the test: 503 is a drain, a spending 403 the budget, anything else 'refused'. */
const refusalOf = (code, body = {}) => (code === 503 ? 'drain'
  : code === 403 && (body.budget !== undefined || body.code === 'team_total' || SPENDING_RE.test(String(body.error || ''))) ? 'budget'
    : 'refused');
/**
 * The `<reason>` of "Stopped: <reason>." (C7) for a try that paused on something that is neither a step error, a
 * drain nor a cost cap. The runner's own words: failure-policy's labels speak of resuming, and a try is never resumed.
 * No full stop: the UI composes the sentence.
 */
export const PAUSE_REFUSED_TEXT = Object.freeze({
  [REASON.USAGE_LIMIT]: 'the AI account reached its usage limit',
  [REASON.RECOVERABLE]: 'a step hit an error that Worca could retry',
  [REASON.TERMINATED]: 'the run was ended',
  [REASON.NIGHT_GUARDRAIL]: "Away mode's safety limit paused it",
});
/** Any other such code (one failure-policy adds later). */
export const PAUSE_REFUSED_OTHER = 'the try could not go on';
const COST_PAUSES = new Set([REASON.COST_PIPELINE, REASON.COST_TOTAL, REASON.COST_PIPELINE_POLICY, REASON.COST_TOTAL_POLICY]);
/**
 * What a paused try means (failure-policy.mjs REASON). Nobody resumes a try (boot auto-resume skips it, resumeRun
 * refuses it), so its run is always stopped. A step error (or a code this table does not know) is a finished, failed
 * try. A drain, a cost cap, a usage limit, a recoverable error or a stopped CLI leave it unfinished: the test stops
 * ('drain', 'budget', or 'refused' with PAUSE_REFUSED_TEXT) and "Finish the rest" makes it again. The UI words drain
 * and budget itself (C7), so their detail is null. Nobody can pause a hidden try, so a pause with no reason (or
 * 'manual') is judged like an unknown code. A detail is one line with no full stop: the UI composes the sentence.
 * @returns {{stop: string, detail: string|null} | {fail: true, detail: string}}
 */
export function pauseVerdict(reason, detail = null) {
  if (reason === REASON.DRAIN) return { stop: 'drain', detail: null };
  if (COST_PAUSES.has(reason)) return { stop: 'budget', detail: null };
  if (reason != null && reason !== REASON.ERROR && REASON_CODES.includes(reason)) {
    return { stop: 'refused', detail: PAUSE_REFUSED_TEXT[reason] || PAUSE_REFUSED_OTHER };
  }
  const line = firstLine(detail).replace(/[\s.]+$/, '');
  return { fail: true, detail: `a step failed: ${line || 'the try paused'}` };
}
/**
 * U-T2 (D2): did Worca itself fail to run this try (never the workflow)? In order: an error pause while the run was still
 * in its own setup (state.setupStage set, and not the person's setup command, TRY_SETUP_STAGE, which stays D55); a
 * started try with no run row (readTryOutcome's "The try did not start."); the answerer's own failure (answers.mjs's
 * `{ worca: true }`); a check Worca could not run (result.mjs's `worcaProblem`). A step error after the setup, the
 * person's setup command and a check that ran and missed are the workflow's. Concern 8 (Task 5 fix review): a try one of whose
 * spawns ran without Worca's settings file (readTryOutcome's `settingsIgnored`) is Worca's too ('settings'). `detail` is the raw first line: for the
 * server log and the try's verdict (For developers), never the page's sentences.
 * @param {{pause?: object|null, liveState?: {setupStage?: string|null}|null, outcome?: object|null,
 *   failReason?: {reason: string|null, worca?: boolean}|null, checkErrors?: Array}} o
 * @returns {{kind: 'copy'|'start'|'settings'|'answer'|'check', detail: string} | null}
 */
export function worcaProblemOf({ pause = null, liveState = null, outcome = null, failReason = null, checkErrors = [] } = {}) {
  const stage = liveState && typeof liveState.setupStage === 'string' && liveState.setupStage ? liveState.setupStage : null;
  if (pause && pause.fail && stage && stage !== TRY_SETUP_STAGE) return { kind: 'copy', detail: firstLine(pause.raw) || stage };
  if (outcome && !outcome.pipelineId) return { kind: 'start', detail: firstLine(outcome.facts && outcome.facts.failReason) || 'The try did not start.' };
  // Task 5 fix review (concern 8): a spawn ran without Worca's settings file (the canary's marker missing): its guards may
  // not have applied, so the try says nothing of the workflow.
  if (outcome && outcome.settingsIgnored === true) return { kind: 'settings', detail: 'Claude Code did not load Worca\'s settings for this try (an invalid settings file or a managed hooks policy).' };
  if (failReason && failReason.worca && failReason.reason) return { kind: 'answer', detail: firstLine(failReason.reason) };
  const bad = (Array.isArray(checkErrors) ? checkErrors : []).find((c) => c && c.worcaProblem);
  if (bad) return { kind: 'check', detail: firstLine(bad.error || bad.value) };
  return null;
}
/** The server log's line for a Worca problem (its raw detail goes nowhere else but the try's verdict). */
const logProblem = (what, p) => { console.warn(`[workflow-tests] Worca could not run ${what} (${p.kind}): ${p.detail || 'no detail'}`); };
/** A verdict detail as a try's fail reason: a sentence, like answers.mjs's. */
const sentence = (t) => `${t.charAt(0).toUpperCase()}${t.slice(1)}${/[.!?]$/.test(t) ? '' : '.'}`;
const nowIso = () => new Date().toISOString();
/** A poll tick that can be cleared, so a finished race leaves no timer behind. */
const tick = (ms) => {
  let t = null;
  const p = new Promise((r) => { t = setTimeout(r, ms); if (t && t.unref) t.unref(); });
  return { p, cancel: () => clearTimeout(t) };
};
const quiet = (p) => { Promise.resolve(p).catch(() => {}); };
const capError = () => err('the cost limit must be more than $0 and at most $10,000', 'BAD_REQUEST');
/**
 * D60: the refusal of a test the disk cannot hold. "Try it once now" (one example, one try, one version) gets the
 * one-try sentence (board 39); every other test the test sentence (board 34).
 */
const diskRefusal = (d, { once }) => Object.assign(err(once && d.once ? d.once : d.text, 'NO_DISK'),
  { disk: { needBytes: d.needBytes ?? null, freeBytes: d.freeBytes ?? null } });   // board 39: the editor's card shows the numbers
const validCap = (v) => Number.isFinite(v) && v > 0 && v <= 10000;

/** @param {object} deps see the Interfaces of Task 7 */
export function createTestRunner(deps) {
  const live = new Map();       // test run id → { stopping, detail, running: Map<key, {runKey}>, done }
  const starting = new Set();   // workflow ids between the BUSY check and their run row (a start awaits fingerprints)
  const pollMs = deps.pollMs ?? COST_POLL_MS;
  /** 3b (D75): a before run's key in a test: one example's one command check. */
  const beforeKey = (exampleId, checkId) => `${exampleId}|${checkId}`;
  const notify = (run, extra = {}) => {
    // D33: `testRunId`, never `runId`: a tab turns any frame with a runId into a run.
    try { if (deps.notify) deps.notify({ type: 'workflow-tests-changed', workflowId: run.workflowId, testRunId: run.id, ...extra }); } catch { /* a frame only */ }
  };

  /** D27: the run's own finished and stopped tries plus what its live tries have spent so far. */
  function costOf(runId) {
    let usd = store.spentOfRun(runId);
    const st = live.get(Number(runId));
    for (const rec of st ? st.running.values() : []) usd += liveCost(rec.runKey);
    return usd;
  }

  function requestStop(st, reason, detail = null) {
    if (st.stopping) return;
    st.stopping = reason;
    st.detail = detail;
    if (st.beforeAbort) st.beforeAbort.abort();   // 3b (D75): a before run stops with the test
    for (const rec of st.running.values()) if (rec.runKey) stopQuietly(rec.runKey);
  }

  /** A test whose end could not be saved: stopped as an error, so the workflow is free again. */
  function closeAsError(runId) {
    return store.updateTestRun(runId, { status: 'stopped', stopReason: 'error', stopDetail: CLOSE_FAILED_TEXT, finishedAt: nowIso() });
  }

  /** Stop a try's run and never throw: the run may already have ended. */
  function stopQuietly(runKey) { try { quiet(deps.stopRun(runKey)); } catch { /* it ended already */ } }
  /** What a live try's run has spent so far. */
  function liveCost(runKey) {
    const l = runKey ? deps.liveRun(runKey) : null;
    return Number((l && l.orch && l.orch.state && l.orch.state.totalCostUsd) || 0);
  }

  /** Today's fingerprint of `use`, or null when it is gone (a deleted version). */
  const fingerprintNow = async (workflowId, use) => { try { return await deps.fingerprintOf(workflowId, use); } catch { return null; } };

  async function start({ workflowId, kind = 'compare', a = null, b, exampleIds = [], tries, reuseA = true, reuseB = false,
    quickCheck = false, capUsd = null, connectors = 'pretend', by = null }) {
    if (starting.has(workflowId) || store.runningTestRun(workflowId)) throw err(BUSY_TEXT, 'BUSY');
    starting.add(workflowId);
    try {
      if (kind !== 'compare' && kind !== 'once') throw err('kind must be "compare" or "once"', 'BAD_REQUEST');
      if (kind === 'compare' && a == null) throw err('pick the version to compare with', 'BAD_REQUEST');
      if (kind === 'once') a = null;   // one version: there is no side A
      b = store.parseUse(b);
      if (b === null || (a != null && store.parseUse(a) === null)) throw err('pick a saved version or your draft', 'BAD_REQUEST');
      if (a != null) a = store.parseUse(a);
      if (a != null && store.useRef(a) === store.useRef(b)) throw err('pick two different versions to compare', 'BAD_REQUEST');
      if (!(Number.isInteger(tries) && tries >= 1 && tries <= store.MAX_TRIES)) throw err(`tries must be 1 to ${store.MAX_TRIES}`, 'BAD_REQUEST');
      if (capUsd !== null && !validCap(capUsd)) throw capError();
      if (!store.CONNECTOR_MODES.includes(connectors)) throw err('connectors must be "pretend" or "real"', 'BAD_REQUEST');
      const ids = [...new Set((exampleIds || []).map(Number))];
      if (!ids.length) throw err('pick at least one example', 'BAD_REQUEST');
      const examples = ids.map((id) => store.readExample(workflowId, id));
      const gone = ids.find((_id, i) => !examples[i]);
      if (gone !== undefined) throw err(`no example ${gone}`, 'NOT_FOUND');
      const empty = examples.find((ex) => !ex.request.trim());
      if (empty) throw err(`Write the request of "${empty.name}" first.`, 'BAD_REQUEST');
      const sides = [...(a != null ? [['a', a, reuseA]] : []), ['b', b, reuseB]];
      // The project registry, read once per start: every example and the disk plan see the same list.
      const projects = deps.listProjects && (deps.targetOf || deps.diskCheck) ? await deps.listProjects() : null;
      // D62 (replaces D20): each example on each side. A version that needs a project tries only examples that have
      // one, and an example whose project cannot be used now is left out; the first such example names the refusal.
      if (deps.targetOf) {
        for (const ex of examples) {
          for (const [, use] of sides) {
            const t = await deps.targetOf(workflowId, use, ex, { projects });
            if (t && !t.ready) throw err(t.text, 'NOT_READY');
          }
        }
      }
      // D60: free disk for the largest tries at once, before anything is written.
      if (deps.diskCheck) {
        const d = await deps.diskCheck({ workflowId, examples, tries, uses: sides.map(([, use]) => use), projects });
        if (d && d.enough === false) throw diskRefusal(d, { once: kind === 'once' && examples.length === 1 && tries === 1 });
      }
      const fps = {};
      for (const [side, use] of sides) fps[side] = await deps.fingerprintOf(workflowId, use);   // NOT_FOUND: a version that is gone
      const mock = !!(deps.mockMode && deps.mockMode());
      // One transaction: a half-written test would hold the workflow BUSY until a restart.
      const run = tx(() => {
        const row = store.createTestRun({ workflowId, kind, a, b, aFp: fps.a ?? null, bFp: fps.b, exampleIds: ids, tries,
          quick: quickCheck ? { status: 'waiting' } : null, capUsd, connectors, by });
        fillTries(row.id, { workflowId, examples, sides, fps, mock, connectors, tries });
        return row;
      });
      drive(run.id);
      return store.readTestRun(run.id);
    } finally { starting.delete(workflowId); }
  }

  /** Each example and side gets `tries` tries: the reusable finished ones first (D26), then new waiting ones. */
  function fillTries(runId, { workflowId, examples, sides, fps, mock, connectors, tries }) {
    for (const ex of examples) {
      for (const [side, use, reuse] of sides) {
        const kept = reuse
          ? store.reusableTries({ workflowId, exampleId: ex.id, use, fp: fps[side], exampleFp: ex.fingerprint, mock, connectors, limit: tries }) : [];
        for (const t of kept) store.linkTry(runId, t.id, side);
        for (let n = kept.length + 1; n <= tries; n += 1) {
          const t = store.insertTry({ runId, workflowId, exampleId: ex.id, use, fp: fps[side], exampleFp: ex.fingerprint, tryNo: n, mock, connectors });
          store.linkTry(runId, t.id, side);
        }
      }
    }
  }

  function drive(runId) {
    // madeAgain: the slots (example, side, try number) this drive made again after a Worca problem (U-T2: once each).
    // 3b (D75): before = the before runs' results (judge's beforeOf); beforeNow = what the before phase does now (beforeNowOf).
    const st = { stopping: null, detail: null, running: new Map(), done: null, madeAgain: new Set(), before: null, beforeNow: null, beforeAbort: null };
    live.set(runId, st);
    st.freeAtStart = null;   // D60, board 35's "Disk in use": free disk now minus free disk later
    if (deps.freeDisk) Promise.resolve().then(() => deps.freeDisk()).then((n) => { st.freeAtStart = n; }, () => {});
    st.done = loop(runId, st)
      .catch((e) => { st.stopping = st.stopping || 'error'; st.detail = st.detail || msgOf(e); })
      .finally(() => {
        try {
          store.updateTestRun(runId, st.stopping
            ? { status: 'stopped', stopReason: st.stopping, stopDetail: st.detail, finishedAt: nowIso() }
            : { status: 'done', stopReason: null, stopDetail: null, finishedAt: nowIso() });
        } catch (e) {
          console.error(`[workflow-tests] could not close test ${runId}: ${msgOf(e)}`);
          // M4: a row left running holds the workflow BUSY. Try the smallest close; if that fails too, Stop testing
          // ends it (stop() on a test nothing drives), and recover() does on the next boot.
          try { closeAsError(runId); } catch { /* the store is not writable: stop() or recover() */ }
        } finally {
          live.delete(runId);   // always: a test that is not live never answers BUSY from memory
        }
        let run = null;
        try { run = store.readTestRun(runId); } catch { /* the frame is only a hint */ }
        if (run) notify(run, { finished: true, status: run.status });
      });
    return st.done;
  }

  /** Example by example (the run's order), then try by try, the old version first (D27). */
  function queueOf(run) {
    const order = new Map(run.exampleIds.map((id, i) => [id, i]));
    return store.triesOfRun(run.id).filter((t) => t.runId === run.id && t.status === 'waiting')
      .sort((x, y) => (order.get(x.exampleId) ?? 0) - (order.get(y.exampleId) ?? 0) || x.tryNo - y.tryNo
        || (x.side < y.side ? -1 : x.side > y.side ? 1 : 0));
  }

  async function loop(runId, st) {
    const run = store.readTestRun(runId);
    if (run.quick && run.quick.status === 'waiting') {
      store.updateTestRun(runId, { quick: { status: 'running' } });
      notify(run);
      const quick = await quickCheck(run, st);
      store.updateTestRun(runId, { quick });
      notify(run);
      if (quick.status === 'failed') { requestStop(st, 'quick-check', quick.detail); return; }
      if (st.stopping) return;
    }
    // 3b (D75): before any try, each project example's command checks run once on its start point (kept results are reused).
    await beforePhase(run, st);
    if (st.stopping) return;
    const inflight = new Set();
    try {
      for (;;) {
        if (st.stopping) break;
        const waiting = queueOf(run);
        if (!waiting.length && !inflight.size) break;
        while (!st.stopping && inflight.size < MAX_PARALLEL && waiting.length) {
          if (run.capUsd !== null && costOf(runId) >= run.capUsd) { requestStop(st, 'cap'); break; }
          const p = runTry(run, st, waiting.shift()).finally(() => inflight.delete(p));
          inflight.add(p);
        }
        if (!inflight.size) continue;
        const t = tick(pollMs);
        try { await Promise.race([...inflight, t.p]); } finally { t.cancel(); }
        if (!st.stopping && run.capUsd !== null && costOf(runId) > run.capUsd) requestStop(st, 'cap');
      }
    } catch (e) {
      requestStop(st, 'error', msgOf(e));   // its running tries are stopped, never left to run unwatched
    } finally {
      await Promise.allSettled([...inflight]);
    }
  }

  /**
   * 3b (D75): the command checks of the examples that still have tries to make, one at a time, on their start points. The
   * results stay in `st.before` for the judge (beforeOf, a synchronous lookup). A project that cannot be used stops the test
   * as a try would; a before run that fails is recorded as not run and the tries go on (their own setup decides, D55).
   * prepareProject holds the copy (U-T1) and has left the key lock when it returns: the before run's clone takes that lock
   * itself, and the hold is released once the before run has ended.
   */
  async function beforePhase(run, st) {
    st.before = new Map();
    if (!deps.beforeRun) return;
    const ids = [...new Set(queueOf(run).map((t) => t.exampleId))];
    const jobs = [];
    for (const id of ids) {
      const ex = store.readExample(run.workflowId, id);
      if (!ex || !ex.project) continue;
      for (const c of ex.checks || []) if (c.kind === 'command') jobs.push({ ex, check: c });
    }
    if (!jobs.length) return;
    st.beforeAbort = new AbortController();
    try {
      for (const [i, { ex, check }] of jobs.entries()) {
        if (st.stopping) return;
        st.beforeNow = { exampleId: ex.id, exampleName: ex.name, cmd: check.cmd, phase: 'copy', n: i + 1, of: jobs.length, startedMs: Date.now() };
        notify(run);
        let project;
        try { project = await deps.prepareProject(ex); } catch (e) {
          requestStop(st, e && e.code === 'NOT_READY' ? 'refused' : 'error', msgOf(e));
          return;
        }
        let rec;
        try {
          if (st.stopping) return;
          const spec = beforeSpecOf(ex, check, (project && project.startCommit) || ex.project.startCommit);
          // The progress page repaints only on a frame: each change of phase sends one (Task 13 review).
          const onPhase = (p) => { if (st.beforeNow && st.beforeNow.phase !== p) { st.beforeNow.phase = p; notify(run); } };
          rec = await deps.beforeRun(spec, { signal: st.beforeAbort.signal, onPhase });
        } catch (e) {
          rec = { ran: false, reason: 'error', text: msgOf(e) };
        } finally {
          if (project) releaseCopy(ex.project.key);
        }
        st.before.set(beforeKey(ex.id, check.id), rec);
      }
    } finally {
      st.beforeNow = null;
      st.beforeAbort = null;
      notify(run);
    }
  }

  /**
   * After deps.startRun, for a try and the quick check alike: a refused start stops the test (refusalOf); a started
   * run is stopped at once when the test is stopping, waited to its end, and, when it paused, stopped and mapped
   * (pauseVerdict; a 'stop' verdict stops the test). `onStarted` records the run before the wait.
   * @returns {Promise<{refused: true} | {refused: false, pipelineId: string|null, pause: null|object}>}
   */
  async function settleRun(st, rec, out, notStarted, onStarted = () => {}) {
    if (!out || out.status !== 200 || !out.body || !out.body.runId) {
      const body = (out && out.body) || {};
      requestStop(st, refusalOf(out ? out.status : 0, body), body.error || notStarted);
      return { refused: true };
    }
    rec.runKey = out.body.runId;
    onStarted(rec.runKey, out.body.pipelineId || null);
    if (st.stopping) stopQuietly(rec.runKey);
    let l = deps.liveRun(rec.runKey);
    if (l && l.launch) await Promise.resolve(l.launch).catch(() => {});
    l = deps.liveRun(rec.runKey);
    const pipelineId = out.body.pipelineId || (l && l.pipelineId) || null;
    if (!(l && String(l.status) === 'paused')) return { refused: false, pipelineId, pause: null, liveState: null };
    // U-T2: where the run was when it paused (its setup stage stays set until the setup ends), read before it is stopped.
    const liveState = { setupStage: (l.orch && l.orch.state && l.orch.state.setupStage) || null };
    await Promise.resolve().then(() => deps.stopRun(rec.runKey)).catch(() => {});
    const pause = { ...pauseVerdict(l.pauseReason ?? null, l.pauseDetail ?? null), raw: l.pauseDetail ?? null };
    if (pause.stop) requestStop(st, pause.stop, pause.detail);
    return { refused: false, pipelineId, pause, liveState };
  }

  async function runTry(run, st, t) {
    // phase 'preparing' from the start: until its run starts, Worca is getting the try ready (its checks, the copy).
    const rec = { runKey: null, pipelineId: null, help: [], asked: [], failReason: null, loopLimit: null, detach: null, outcome: null, project: null,
      phase: 'preparing', checking: null, startedMs: Date.now() };
    const detach = () => { const d = rec.detach; rec.detach = null; if (d) d(); };
    // The try row's pipeline id: written once, the first time it is known (never overwritten with null).
    const notePipelineId = (id) => {
      if (typeof id !== 'string' || !id || rec.pipelineId) return;
      rec.pipelineId = id;
      store.updateTry(t.id, { pipelineId: id });
    };
    st.running.set(t.id, rec);
    store.updateTry(t.id, { status: 'running', startedAt: nowIso() });   // before the first await: the loop sees it at once
    const t0 = Date.now();
    try {
      const example = store.readExample(run.workflowId, t.exampleId);
      if (!example) { store.updateTry(t.id, { status: 'stopped', finishedAt: nowIso() }); return; }
      // D27 (review I3): a try runs today's draft, Library and example. If any of them changed since the test started,
      // it would run one state and be stored as another (and be reused for the old one): the test stops first.
      const changed = example.fingerprint !== t.exampleFp ? editedText(example.name)
        : (await fingerprintNow(run.workflowId, t.use)) !== t.fp ? changedText(t.use) : null;
      if (changed) {
        store.updateTry(t.id, { status: 'waiting', startedAt: null });   // never tried: it stays as it was
        requestStop(st, 'changed', changed);
        return;
      }
      if (st.stopping) { store.updateTry(t.id, { status: 'waiting', startedAt: null }); return; }
      notify(run);
      // attachAnswerer may call this more than once (one per question): the first reason wins, the run is stopped once.
      const fail = (reason, o = null) => {
        if (rec.failReason) return;
        rec.failReason = reason;
        rec.failWorca = !!(o && o.worca);   // U-T2: the answerer itself failed
        if (rec.runKey) stopQuietly(rec.runKey);
      };
      // 3a (D42): a project example's try runs in Worca's copy of the project, from the example's start commit.
      if (example.project) {
        rec.phase = 'preparing';
        rec.project = await deps.prepareProject(example);   // NOT_READY: the catch stops the test as refused
        if (rec.project) rec.copyKey = example.project.key;   // U-T1 (F1): it holds the copy until cleanUp releases it
        if (st.stopping) { store.updateTry(t.id, { status: 'waiting', startedAt: null }); return; }
      }
      rec.phase = 'working';
      rec.startedMs = Date.now();
      // Never an auto (--yes) run: canned answers need the question to wait (tryRunBody sets no `yes`).
      const body = tryRunBody(example, store.readExampleFiles(example.id), { workflowId: run.workflowId, tryNo: t.tryNo, mock: t.mock,
        ...(rec.project ? { project: rec.project } : {}) });
      const out = await deps.startRun(body, {
        startedBy: run.startedBy,
        workflowTest: {
          use: t.use,
          connectors: t.connectors,   // D35
          ...(example.project ? { project: { key: example.project.key, setupCmd: example.project.setupCmd } } : {}),
          onOrch: (orch, { runKey }) => {
            rec.runKey = runKey;
            const off = attachAnswerer(orch, example, { answer: (id, payload) => deps.answer(runKey, id, payload), onHelp: (x) => rec.help.push(x), onFail: fail,
              onLoopLimit: (l) => { if (!rec.loopLimit) rec.loopLimit = l; },
              // U-T12 (F23): what the workflow asked, for the side by side; nothing after the try failed (it is being stopped).
              onAsked: (a) => { if (!rec.failReason) rec.asked.push(a); } });
            // The pipeline id goes on the row as soon as the run has one (its state names it), so a crash mid-try still
            // leaves it there for the boot recovery and the cleanup sweep (3a Task 8 review).
            const onState = (p) => notePipelineId((p && typeof p.id === 'string' && p.id) || (deps.liveRun(runKey) || {}).pipelineId || null);
            if (typeof orch.on === 'function') orch.on('state', onState);
            rec.detach = () => { off(); if (typeof orch.off === 'function') orch.off('state', onState); };
          },
        },
      });
      const s = await settleRun(st, rec, out, 'the try did not start',
        (runKey, pipelineId) => { store.updateTry(t.id, { runKey }); notePipelineId(pipelineId); });
      if (s.refused) {
        detach();
        rec.runKey = null;
        store.updateTry(t.id, { status: 'waiting', startedAt: null });   // never tried: it stays for "Finish the rest"
        return;
      }
      // A project try's start answers without its pipeline id (the run makes its worktree first). The state listener
      // above records it as soon as it exists; after the settle, the id the launch gave it is the fallback, so the side by
      // side, its diff and what the guard stopped can always be read (3a Task 8).
      notePipelineId(s.pipelineId);
      // A step error is a finished, failed try; any other pause leaves it unfinished (pauseVerdict).
      if (s.pause && s.pause.fail && !rec.failReason) rec.failReason = sentence(s.pause.detail);
      const unfinished = !!(s.pause && s.pause.stop);
      detach();
      rec.outcome = await deps.outcomeOf(s.pipelineId, { help: rec.help, failReason: rec.failReason, loopLimit: rec.loopLimit, asked: rec.asked,
        durationMs: Date.now() - t0 });
      const outcome = rec.outcome;
      const facts = outcome.project ? projectFacts(rec, outcome) : {};
      // D55: a setup that failed is the test's problem, not the workflow's: the test stops and this try is not judged.
      // Only try-setup.json's ok:false is one: a run that ended in error without it is judged as the workflow's.
      if (outcome.setup && outcome.setup.ok === false) {
        store.updateTry(t.id, { status: 'stopped', costUsd: outcome.facts.costUsd, finishedAt: nowIso(), ...facts });
        requestStop(st, 'setup', setupFailedText(outcome.setup.cmd));
        return;
      }
      // U-T2: a try Worca itself could not run is never judged: it is set aside (and made again once).
      const problem = unfinished || st.stopping ? null
        : worcaProblemOf({ pause: s.pause, liveState: s.liveState, outcome, failReason: { reason: rec.failReason, worca: rec.failWorca } });
      if (problem) { setAside(run, st, t, problem, { costUsd: outcome.facts.costUsd, ...facts }); return; }
      if ((unfinished || st.stopping) && !rec.failReason && outcome.facts.status !== 'done') {
        store.updateTry(t.id, { status: 'stopped', costUsd: outcome.facts.costUsd, finishedAt: nowIso(), ...facts });
        return;
      }
      rec.phase = 'checking';
      const verdict = await deps.judge(example, outcome, { onCommand: (cmd) => { rec.checking = cmd; },
        beforeOf: (check) => (st.before ? st.before.get(beforeKey(example.id, check.id)) ?? null : null) });
      const checkProblem = worcaProblemOf({ checkErrors: verdict && verdict.checks });   // U-T2: a check Worca could not run
      if (checkProblem) { setAside(run, st, t, checkProblem, { costUsd: outcome.facts.costUsd, ...facts }); return; }
      // D60: the checkout's size after its setup, measured once per example and start.
      const diskBytes = outcome.project && outcome.project.checkoutDir && deps.measureDisk && facts.startCommit
        && store.lastDiskBytes(example.id, facts.startCommit) === null ? await deps.measureDisk(outcome.project.checkoutDir) : null;
      store.updateTry(t.id, { status: verdict.passed ? 'passed' : 'failed', verdict, costUsd: outcome.facts.costUsd, finishedAt: nowIso(),
        ...facts, ...(diskBytes != null ? { diskBytes } : {}) });
    } catch (e) {
      // Never leave a try 'running' behind: one that never started waits again, one that ran is stopped with its cost.
      if (rec.runKey) {
        stopQuietly(rec.runKey);
        const cost = rec.outcome ? rec.outcome.facts.costUsd : liveCost(rec.runKey);
        store.updateTry(t.id, { status: 'stopped', costUsd: cost, finishedAt: nowIso() });
      } else {
        store.updateTry(t.id, { status: 'waiting', startedAt: null });
      }
      requestStop(st, e && e.code === 'NOT_READY' ? 'refused' : 'error', msgOf(e));
    } finally {
      detach();
      if (rec.project) await cleanUp(rec);   // D61: however it ended
      st.running.delete(t.id);
      notify(run);
    }
  }

  /**
   * U-T2 (D2): a try with a Worca problem is stored stopped with `verdict.worcaProblem` (never judged, never in a rate:
   * compareModel counts only passed and failed). The first time on its slot (example, side, try number) in this drive
   * it is made again at once, as continueRun does (unlinked, so its cost stays in the test's cost, not in its results);
   * the second time the test stops as 'worca'. The fresh try goes through runTry like any other, so its copy is held
   * and released the same way (U-T1).
   */
  function setAside(run, st, t, problem, patch) {
    // The raw first line (worcaProblemDetail) stays in the stored verdict and the server log only; showing it in the UI
    // ("For developers") is deferred to a later UI task that will be designed first.
    logProblem(`try ${t.id} of test ${run.id}`, problem);
    const verdict = { worcaProblem: worcaTryText(problem.kind), ...(problem.detail ? { worcaProblemDetail: problem.detail } : {}) };
    const slot = `${t.exampleId}:${t.side}:${t.tryNo}`;
    const again = !st.stopping && !st.madeAgain.has(slot);
    tx(() => {
      store.updateTry(t.id, { status: 'stopped', verdict, finishedAt: nowIso(), ...patch });
      if (!again) return;
      store.unlinkTry(run.id, t.id);
      const fresh = store.insertTry({ runId: run.id, workflowId: t.workflowId, exampleId: t.exampleId, use: t.use, fp: t.fp,
        exampleFp: t.exampleFp, tryNo: t.tryNo, mock: t.mock, connectors: t.connectors });
      store.linkTry(run.id, fresh.id, t.side);
    });
    if (again) st.madeAgain.add(slot);
    else requestStop(st, 'worca', worcaProblemText(problem.kind));   // a no-op while the test is already stopping
  }

  /** What a project try stores on its row (D67): its start, its change list without the paths, its setup run. */
  function projectFacts(rec, outcome) {
    const { files, total, counts, added, removed } = outcome.project;
    return { startCommit: rec.project ? rec.project.startCommit : null, changes: { files, total, counts, added, removed },
      ...(outcome.setup ? { setup: outcome.setup } : {}) };
  }

  /** D61: a project try's checkout, branch and run folder go once its run has settled. Never throws: the boot sweep
   *  takes whatever a failure leaves. U-T1 (F1): then the copy the try held (ensureStartCommit) is released, however the
   *  cleanup went; a try that never got its copy (no copyKey) releases nothing. */
  async function cleanUp(rec) {
    try {
      if (rec.runKey) { const l = deps.liveRun(rec.runKey); if (l && l.launch) await Promise.resolve(l.launch).catch(() => {}); }
      const o = rec.outcome || (rec.pipelineId ? await deps.outcomeOf(rec.pipelineId, {}) : null);
      if (o && o.project && deps.cleanupTry) await deps.cleanupTry(o);
    } catch { /* boot sweep */ } finally {
      if (rec.copyKey) { releaseCopy(rec.copyKey); rec.copyKey = null; }
    }
  }

  /** The free quick check: one mock try of the first example per version still to try ("every step is connected"). */
  async function quickCheck(run, st) {
    const example = store.readExample(run.workflowId, run.exampleIds[0]);
    if (!example) return { status: 'failed', detail: 'the first example was deleted' };
    const uses = [...new Map(store.triesOfRun(run.id).filter((t) => t.runId === run.id && t.status === 'waiting')
      .map((t) => [store.useRef(t.use), t.use])).values()];
    for (const use of uses) {
      // U-T2 (D2): a Worca problem makes the quick check again once; the second time the test stops as 'worca'.
      for (let attempt = 1; ; attempt += 1) {
        if (st.stopping) return { status: 'waiting' };
        const r = await quickOnce(run, st, example, use);
        if (!r.worca) { if (r.status !== 'passed') return r; break; }
        logProblem(`the quick check of test ${run.id}`, r.worca);
        if (attempt >= 2) { requestStop(st, 'worca', worcaProblemText(r.worca.kind)); return { status: 'waiting' }; }
      }
    }
    return { status: 'passed' };
  }

  /** One mock try of the quick check on `use`: {status} as quickCheck's, or {worca} for a Worca problem (U-T2). */
  async function quickOnce(run, st, example, use) {
    const rec = { runKey: null, pipelineId: null, failReason: null, failWorca: false, detach: null, outcome: null, project: null };
    const key = `quick:${store.useRef(use)}`;
    st.running.set(key, rec);
    try {
      const project = example.project ? await deps.prepareProject(example) : null;   // 3a: the quick check runs in the copy too
      rec.project = project;
      if (project) rec.copyKey = example.project.key;   // U-T1 (F1): held until cleanUp
      const out = await deps.startRun(tryRunBody(example, store.readExampleFiles(example.id), { workflowId: run.workflowId, tryNo: 0, quick: true,
        ...(project ? { project } : {}) }), {
        startedBy: run.startedBy,
        workflowTest: {
          use,
          connectors: 'pretend',   // a mock run sends nothing either way
          // No setup: a mock run needs no installed dependencies.
          ...(example.project ? { project: { key: example.project.key, setupCmd: null } } : {}),
          onOrch: (orch, { runKey }) => {
            rec.runKey = runKey;
            rec.detach = attachAnswerer(orch, { ...example, otherwise: 'pick' }, {
              answer: (id, payload) => deps.answer(runKey, id, payload),
              onFail: (r, o) => { if (!rec.failReason) { rec.failReason = r; rec.failWorca = !!(o && o.worca); stopQuietly(runKey); } },
            });
          },
        },
      });
      // A refused start or a pause that is not a step error says nothing about the workflow: the check still waits.
      const s = await settleRun(st, rec, out, 'the quick check did not start', (runKey, pipelineId) => { rec.pipelineId = pipelineId; });
      if (s.refused || (s.pause && s.pause.stop)) return { status: 'waiting' };
      const setupProblem = st.stopping ? null : worcaProblemOf({ pause: s.pause, liveState: s.liveState });
      if (setupProblem) return { worca: setupProblem };
      if (s.pause && s.pause.fail) return { status: 'failed', detail: s.pause.detail };
      if (rec.detach) { rec.detach(); rec.detach = null; }
      const o = await deps.outcomeOf(s.pipelineId, { failReason: rec.failReason });
      rec.outcome = o;
      if (st.stopping) return { status: 'waiting' };
      const problem = worcaProblemOf({ outcome: o, failReason: { reason: rec.failReason, worca: rec.failWorca } });
      if (problem) return { worca: problem };
      if (o.facts.status !== 'done' || o.facts.failReason) return { status: 'failed', detail: o.facts.failReason || `the quick check ended as ${o.facts.status}` };
      return { status: 'passed' };
    } catch (e) {
      if (rec.runKey) stopQuietly(rec.runKey);
      requestStop(st, e && e.code === 'NOT_READY' ? 'refused' : 'error', msgOf(e));
      return { status: 'waiting' };
    } finally {
      if (rec.detach) rec.detach();
      if (rec.project) await cleanUp(rec);
      st.running.delete(key);
    }
  }

  /** Resolves once the loop has stopped every running try and the run row says why (D27). */
  async function stop(runId, { reason = 'person' } = {}) {
    const run = store.readTestRun(runId);
    if (!run) throw err(`no test ${runId}`, 'NOT_FOUND');
    const st = live.get(run.id);
    if (!st) {
      // M4: still running in the store but nothing drives it (its close failed): end it now, or the workflow stays BUSY.
      if (run.status !== 'running') return run;
      const closed = closeAsError(run.id);
      notify(closed, { finished: true, status: closed.status });
      return closed;
    }
    requestStop(st, reason);
    await st.done;
    return store.readTestRun(run.id);
  }

  /**
   * "Finish the rest": the stopped and waiting tries, only while nothing they depend on changed (D26/D27). After a
   * restart (recoverInterruptedTestRuns) the waiting tries are still waiting and the running ones are stopped: both
   * are made here. A stopped try is made again as a new try; it stays in the run's cost.
   */
  async function continueRun(runId, { capUsd } = {}) {
    const run = store.readTestRun(runId);
    if (!run) throw err(`no test ${runId}`, 'NOT_FOUND');
    if (run.status !== 'stopped' || live.has(run.id)) throw err('only a stopped test can be finished', 'BAD_REQUEST');
    if (store.runningTestRun(run.workflowId) || starting.has(run.workflowId)) throw err(BUSY_TEXT, 'BUSY');
    starting.add(run.workflowId);   // D37: a second "Finish the rest" (or a start) while this one awaits fingerprints
    try {
      const left = leftTries(run);
      const leftExamples = new Map();
      const leftCounts = {};
      const refusal = await changedSinceStart(run, { fingerprintNow, left, examples: leftExamples });
      if (refusal) throw err(refusal, 'BAD_REQUEST');
      for (const t of left) { const ex = leftExamples.get(t.exampleId); if (ex) leftCounts[ex.id] = (leftCounts[ex.id] || 0) + 1; }
      for (const [id, ex] of [...leftExamples]) if (!ex) leftExamples.delete(id);
      // D60: Finish the rest makes tries again (D55: "Try again" after a setup failure is this), so the disk must hold the
      // largest of what is left, at once, before anything is written.
      if (deps.diskCheck && leftExamples.size) {
        const projects = deps.listProjects ? await deps.listProjects() : null;
        const d = await deps.diskCheck({ workflowId: run.workflowId, examples: [...leftExamples.values()], tries: run.tries,
          uses: [run.a, run.b].filter((u) => u != null), counts: leftCounts, projects });
        if (d && d.enough === false) throw diskRefusal(d, { once: run.kind === 'once' && left.length === 1 });
      }
      if (capUsd !== undefined && capUsd !== null && !validCap(capUsd)) throw capError();
      const cap = capUsd !== undefined && capUsd !== null ? capUsd : run.capUsd;
      const spent = store.spentOfRun(run.id);
      if (cap !== null && cap <= spent) throw err(`Raise the cost limit above ${fmtUsd(spent)} to finish the rest.`, 'BAD_REQUEST');
      tx(() => {
        for (const t of left.filter((x) => x.status === 'stopped')) {
          store.unlinkTry(run.id, t.id);   // it stays in the run's cost (run_id), not in its results
          const fresh = store.insertTry({ runId: run.id, workflowId: t.workflowId, exampleId: t.exampleId, use: t.use, fp: t.fp,
            exampleFp: t.exampleFp, tryNo: t.tryNo, mock: t.mock, connectors: t.connectors });
          store.linkTry(run.id, fresh.id, t.side);
        }
        store.updateTestRun(run.id, { status: 'running', stopReason: null, stopDetail: null, finishedAt: null, capUsd: cap,
          ...(run.quick && run.quick.status !== 'passed' ? { quick: { status: 'waiting' } } : {}) });
      });
      drive(run.id);
      return store.readTestRun(run.id);
    } finally { starting.delete(run.workflowId); }
  }

  /** After a restart nothing drives a running test any more: it is stopped ('restart'). @returns {number} */
  function recover() { return store.recoverInterruptedTestRuns().runs; }

  function idle(runId) { const st = live.get(Number(runId)); return st ? st.done : Promise.resolve(); }

  /** Board 35: what a running try is doing now. The harness's setup stage tells setup and the worktree apart. */
  function phaseOf(runId, tryId) {
    const st = live.get(Number(runId));
    const rec = st ? st.running.get(Number(tryId)) : null;
    if (!rec) return null;
    let phase = rec.phase;
    if (phase === 'working' && rec.runKey) {
      const l = deps.liveRun(rec.runKey);
      const stage = l && l.orch && l.orch.state ? l.orch.state.setupStage : null;
      if (stage === TRY_SETUP_STAGE) phase = 'setup';
      else if (stage === WORKTREE_STAGE || stage === PLUGINS_OFF_STAGE) phase = 'preparing';   // 3b (D72): Worca's own
    }
    return { phase, checking: rec.checking, startedMs: rec.startedMs };
  }

  /** D60: what was free when the test started, for board 35's "Disk in use". */
  function diskOf(runId) { const st = live.get(Number(runId)); return st ? { freeAtStart: st.freeAtStart ?? null } : null; }

  /** 3b (D75, U3): what the before phase is doing now, or null. */
  function beforeNowOf(runId) { const st = live.get(Number(runId)); return st && st.beforeNow ? { ...st.beforeNow } : null; }

  return { start, stop, continueRun, recover, idle, costOf, phaseOf, diskOf, beforeNowOf };
}
