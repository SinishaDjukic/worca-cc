// src/core/workflow-tests/runner.mjs
// The test runner (plans/workflow-tests-part2-plan.md D27, D35–D37). It tries examples on one or two versions, at most
// MAX_PARALLEL at a time and one test per workflow, answers their questions (answers.mjs), stops when the cost cap is
// passed or something a try depends on changed, and judges every finished try (deps.judge). Each try is an ordinary
// no-project run started through the run handler (deps.startRun), marked as a test (D21), with the test's connectors
// mode (D35). The state lives in the store; this module keeps only what is live.
import * as store from './store.mjs';
import { tx } from '../db.mjs';
import { attachAnswerer } from './answers.mjs';
import { tryRunBody } from './try-body.mjs';
import { fmtUsd } from '../../shared/workflow-tests/checks.mjs';
import { REASON, REASON_CODES } from '../failure-policy.mjs';

export const MAX_PARALLEL = 3;   // D36. Library script checks stay one at a time (result.mjs), inside runBenchOnce's limit of 2.
export const COST_POLL_MS = 2000;
/** D37, G19: the refusal of a second start, and the hint the UI shows on its disabled buttons. */
export const BUSY_TEXT = 'A test of this workflow is running. Wait for it, or stop it first.';
/** C18: what changed since a test started (a refused "Finish the rest", or a test stopped as `changed`). */
export const changedText = (use) => `${use === 'draft' ? 'Your draft' : `v${use}`} changed since this test started: start a new test.`;
export const editedText = (name) => `"${name}" was edited since this test started: start a new test.`;
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
  const line = typeof detail === 'string' ? detail.trim().split(/\r?\n/)[0].slice(0, 300).replace(/[\s.]+$/, '') : '';
  return { fail: true, detail: `a step failed: ${line || 'the try paused'}` };
}
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
const validCap = (v) => Number.isFinite(v) && v > 0 && v <= 10000;

/** @param {object} deps see the Interfaces of Task 7 */
export function createTestRunner(deps) {
  const live = new Map();       // test run id → { stopping, detail, running: Map<key, {runKey}>, done }
  const starting = new Set();   // workflow ids between the BUSY check and their run row (a start awaits fingerprints)
  const pollMs = deps.pollMs ?? COST_POLL_MS;
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
    for (const rec of st.running.values()) if (rec.runKey) stopQuietly(rec.runKey);
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
      // Review M9 (D20): each side is checked, not only the draft: a saved version may still need a project.
      if (deps.targetOf) {
        for (const [, use] of sides) {
          const t = await deps.targetOf(workflowId, use);
          if (t && !t.testable) throw err(`${use === 'draft' ? 'Your draft' : `v${use}`} works on a project, and tests work for workflows without a project for now.`, 'NOT_TESTABLE');
        }
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
    const st = { stopping: null, detail: null, running: new Map(), done: null };
    live.set(runId, st);
    st.done = loop(runId, st)
      .catch((e) => { st.stopping = st.stopping || 'error'; st.detail = st.detail || msgOf(e); })
      .finally(() => {
        try {
          store.updateTestRun(runId, st.stopping
            ? { status: 'stopped', stopReason: st.stopping, stopDetail: st.detail, finishedAt: nowIso() }
            : { status: 'done', stopReason: null, stopDetail: null, finishedAt: nowIso() });
        } catch (e) {
          console.error(`[workflow-tests] could not close test ${runId}: ${msgOf(e)}`);   // recover() stops it on the next boot
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
    if (!(l && String(l.status) === 'paused')) return { refused: false, pipelineId, pause: null };
    await Promise.resolve().then(() => deps.stopRun(rec.runKey)).catch(() => {});
    const pause = pauseVerdict(l.pauseReason ?? null, l.pauseDetail ?? null);
    if (pause.stop) requestStop(st, pause.stop, pause.detail);
    return { refused: false, pipelineId, pause };
  }

  async function runTry(run, st, t) {
    const rec = { runKey: null, help: [], failReason: null, detach: null, outcome: null };
    const detach = () => { const d = rec.detach; rec.detach = null; if (d) d(); };
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
      const fail = (reason) => {
        if (rec.failReason) return;
        rec.failReason = reason;
        if (rec.runKey) stopQuietly(rec.runKey);
      };
      // Never an auto (--yes) run: canned answers need the question to wait (tryRunBody sets no `yes`).
      const body = tryRunBody(example, store.readExampleFiles(example.id), { workflowId: run.workflowId, tryNo: t.tryNo, mock: t.mock });
      const out = await deps.startRun(body, {
        startedBy: run.startedBy,
        workflowTest: {
          use: t.use,
          connectors: t.connectors,   // D35
          onOrch: (orch, { runKey }) => {
            rec.runKey = runKey;
            rec.detach = attachAnswerer(orch, example, { answer: (id, payload) => deps.answer(runKey, id, payload), onHelp: (x) => rec.help.push(x), onFail: fail });
          },
        },
      });
      const s = await settleRun(st, rec, out, 'the try did not start',
        (runKey, pipelineId) => store.updateTry(t.id, { runKey, pipelineId }));
      if (s.refused) {
        detach();
        rec.runKey = null;
        store.updateTry(t.id, { status: 'waiting', startedAt: null });   // never tried: it stays for "Finish the rest"
        return;
      }
      // A step error is a finished, failed try; any other pause leaves it unfinished (pauseVerdict).
      if (s.pause && s.pause.fail && !rec.failReason) rec.failReason = sentence(s.pause.detail);
      const unfinished = !!(s.pause && s.pause.stop);
      detach();
      rec.outcome = await deps.outcomeOf(s.pipelineId, { help: rec.help, failReason: rec.failReason, durationMs: Date.now() - t0 });
      const outcome = rec.outcome;
      if ((unfinished || st.stopping) && !rec.failReason && outcome.facts.status !== 'done') {
        store.updateTry(t.id, { status: 'stopped', costUsd: outcome.facts.costUsd, finishedAt: nowIso() });
        return;
      }
      const verdict = await deps.judge(example, outcome);
      store.updateTry(t.id, { status: verdict.passed ? 'passed' : 'failed', verdict, costUsd: outcome.facts.costUsd, finishedAt: nowIso() });
    } catch (e) {
      // Never leave a try 'running' behind: one that never started waits again, one that ran is stopped with its cost.
      if (rec.runKey) {
        stopQuietly(rec.runKey);
        const cost = rec.outcome ? rec.outcome.facts.costUsd : liveCost(rec.runKey);
        store.updateTry(t.id, { status: 'stopped', costUsd: cost, finishedAt: nowIso() });
      } else {
        store.updateTry(t.id, { status: 'waiting', startedAt: null });
      }
      requestStop(st, 'error', msgOf(e));
    } finally {
      detach();
      st.running.delete(t.id);
      notify(run);
    }
  }

  /** The free quick check: one mock try of the first example per version still to try ("every step is connected"). */
  async function quickCheck(run, st) {
    const example = store.readExample(run.workflowId, run.exampleIds[0]);
    if (!example) return { status: 'failed', detail: 'the first example was deleted' };
    const uses = [...new Map(store.triesOfRun(run.id).filter((t) => t.runId === run.id && t.status === 'waiting')
      .map((t) => [store.useRef(t.use), t.use])).values()];
    for (const use of uses) {
      if (st.stopping) return { status: 'waiting' };
      const rec = { runKey: null, failReason: null, detach: null };
      const key = `quick:${store.useRef(use)}`;
      st.running.set(key, rec);
      try {
        const out = await deps.startRun(tryRunBody(example, store.readExampleFiles(example.id), { workflowId: run.workflowId, tryNo: 0, quick: true }), {
          startedBy: run.startedBy,
          workflowTest: {
            use,
            connectors: 'pretend',   // a mock run sends nothing either way
            onOrch: (orch, { runKey }) => {
              rec.runKey = runKey;
              rec.detach = attachAnswerer(orch, { ...example, otherwise: 'pick' }, {
                answer: (id, payload) => deps.answer(runKey, id, payload),
                onFail: (r) => { if (!rec.failReason) { rec.failReason = r; stopQuietly(runKey); } },
              });
            },
          },
        });
        // A refused start or a pause that is not a step error says nothing about the workflow: the check still waits.
        const s = await settleRun(st, rec, out, 'the quick check did not start');
        if (s.refused || (s.pause && s.pause.stop)) return { status: 'waiting' };
        if (s.pause && s.pause.fail) return { status: 'failed', detail: s.pause.detail };
        if (rec.detach) { rec.detach(); rec.detach = null; }
        const o = await deps.outcomeOf(s.pipelineId, { failReason: rec.failReason });
        if (st.stopping) return { status: 'waiting' };
        if (o.facts.status !== 'done' || o.facts.failReason) return { status: 'failed', detail: o.facts.failReason || `the quick check ended as ${o.facts.status}` };
      } catch (e) {
        if (rec.runKey) stopQuietly(rec.runKey);
        requestStop(st, 'error', msgOf(e));
        return { status: 'waiting' };
      } finally {
        if (rec.detach) rec.detach();
        st.running.delete(key);
      }
    }
    return { status: 'passed' };
  }

  /** Resolves once the loop has stopped every running try and the run row says why (D27). */
  async function stop(runId, { reason = 'person' } = {}) {
    const run = store.readTestRun(runId);
    if (!run) throw err(`no test ${runId}`, 'NOT_FOUND');
    const st = live.get(run.id);
    if (!st) return run;
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
      for (const [use, fp] of [[run.a, run.aFp], [run.b, run.bFp]]) {
        if (use == null) continue;
        if ((await fingerprintNow(run.workflowId, use)) !== fp) throw err(changedText(use), 'BAD_REQUEST');
      }
      const left = store.triesOfRun(run.id).filter((t) => t.runId === run.id && (t.status === 'stopped' || t.status === 'waiting'));
      for (const t of left) {
        const ex = store.readExample(run.workflowId, t.exampleId);
        if (ex && ex.fingerprint !== t.exampleFp) throw err(editedText(ex.name), 'BAD_REQUEST');
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

  return { start, stop, continueRun, recover, idle, costOf };
}
