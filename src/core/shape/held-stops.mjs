// src/core/shape/held-stops.mjs — Shaper small runs C3 (D9): a person's answer to a stop question waits for the run's
// turn. While another slice of the feature is going, the answer is held on the runs-map entry (`entry.heldStop`, in
// memory) and the question stays open; once no other slice is going it is delivered: the run takes the answer, its
// question is resolved for every tab, and the feature card repaints. Lives outside the line-capped ui/server.mjs, which
// only wires it (re-exported by chain.mjs).
import { stopAnswerOk, stopOptionOf, heldRefusal, answeredRefusal, sendingRefusal } from '../../shared/shape/run-stops.mjs';
import { featureOfPipeline, turnOrder, liveSliceHeldResume, liveSliceResuming, liveSliceFrom } from './features.mjs';
import { heldStopTurn, fireSourceOf, mergingBackSliceOf } from './chain.mjs';
import { shaperSmallRunsOn, smallRunsOfFeature } from './small-runs.mjs';
import { requirementChangedFeedback } from '../../shared/shape/req-change.mjs';

/**
 * deps: { runs: Map of runs-map entries, liveSliceOf(id), broadcastFeature(featureId), resolvePending(entry, {id, reason}),
 * applyChange?(entry, stop, by) → {changeRun} (small runs C4: throws a refusal), now(): ms,
 * takeIn?(entry) → {ok, merged} | {ok:false, wait, after} | {ok:false, refused, reason} (slice 3: the run takes in the
 * finished work before its answer goes on; without it every answer is today's synchronous path),
 * resume?(pipelineId, opts) → Promise<{ok, runId?} | {ok:true, held:true, …}> (slice 7: the server's resumeRun; without
 * it no resume is held), refuse?(status, body) → Error (the server's ResumeError), audit?(pipelineId, text, by) }.
 * → { answer, deliver, clear, holdResume, heldResumeOf, overlay, dropResume, splitBootPicks, claimed, watchSkips }
 */
/** A runs-map entry's feature and run number: its slice when it carries one, else its pipeline's feature row. */
export function entryFeatureOf(entry) {
  const sl = entry && entry.orch && entry.orch.runShape && entry.orch.runShape.slice;
  if (sl && sl.feature && Number.isInteger(sl.index)) return { featureId: sl.feature, index: sl.index };
  const at = entry && entry.pipelineId ? featureOfPipeline(entry.pipelineId) : null;
  return at ? { featureId: at.featureId, index: at.idx } : null;
}

export function createHeldStops({ runs, liveSliceOf, broadcastFeature, resolvePending, applyChange = null, takeIn = null, resume = null, refuse = null, audit = null, now = Date.now }) {
  const featureOf = entryFeatureOf;
  const turnOf = (at) => (at ? heldStopTurn(at.featureId, at.index, { live: liveSliceOf, now: now() }) : { due: true });
  const repaint = (at) => { if (at) broadcastFeature(at.featureId); };
  /** Remember a stop the run has taken: one answer per stop. */
  const taken = (entry, id) => { (entry.answeredStops ||= new Set()).add(id); };
  const refusal = (message, code) => Object.assign(new Error(message), { code, status: 409 });

  /** Slice 3 (D3, D14): whether this stop's answer first takes in the finished work: a marked feature's stop
   *  with the flag on, except "Change it" (the re-plan takes in at its own start). */
  function takeInApplies(entry, pq, payload) {
    if (!takeIn || !pq || !pq.stop || !shaperSmallRunsOn()) return false;
    const at = featureOf(entry);
    if (!at || !smallRunsOfFeature(at.featureId)) return false;
    return stopOptionOf(pq.stop, payload)?.value !== 'change';
  }

  /** Slice 3 (D4): the run number of another run (not pipeline `pipelineId`) of feature `at`, on any base (the take-in
   *  takes in every finished run), that is done but still committing its work (its teardown has not settled), or null.
   *  A run with no recorded fire-time base takes in nothing, so nothing holds it. */
  function settlingSiblingOf(pipelineId, at) {
    if (!at || fireSourceOf(pipelineId) == null) return null;
    for (const e of runs.values()) {
      if (!e || e.pipelineId === pipelineId || e.status !== 'done' || e.settled === true) continue;
      const o = featureOf(e);
      if (o && o.featureId === at.featureId) return o.index;
    }
    return null;
  }

  /** Slice 1 (A1, D3): the run a resume of `pipelineId` waits for: one still saving its work in memory, else one still
   *  merging back (the resume's take-in runs after the run started, so it must not find a `wait`), or null. */
  function savingRunOf(pipelineId, at) {
    if (!at || fireSourceOf(pipelineId) == null) return null;
    return settlingSiblingOf(pipelineId, at) ?? mergingBackSliceOf(at.featureId, { exclude: pipelineId });
  }

  /** Take the work in for `entry` (marked as going while it runs, D13). → takeIn's answer */
  async function takingIn(entry, id) {
    entry.takingIn = id;
    entry.takeInRefused = null;                      // a new attempt replaces the last reason
    try { return await takeIn(entry); } finally { entry.takingIn = null; }
  }

  /** Answer question `id` of `entry`. A stop's answer must be one of its options (422) and only one may be held (409);
   *  it is held while another slice is going ({held:true}), else handed to the run now (the caller resolves the
   *  question, as for every other answer). A stop this run has already taken (`entry.answeredStops`, in memory) refuses
   *  a later answer with its id (409 STOP_ANSWERED). Any other question goes straight to the run. A refusal changes
   *  nothing. Slice 3: on a marked feature the run first takes in the finished work, so the answer comes back
   *  as a promise: held behind a run still saving its work, refused on a clash (409 TAKE_IN_REFUSED), else handed over. */
  function answer(entry, id, payload, by) {
    const pq = entry && entry.pendingQuestion;
    if (!pq || !pq.stop || pq.id !== id) {
      if (entry.answeredStops && entry.answeredStops.has(id)) {
        throw Object.assign(new Error(answeredRefusal()), { code: 'STOP_ANSWERED', status: 409 });
      }
      entry.orch.answer(id, payload, by);
      return undefined;
    }
    if (!stopAnswerOk(pq.stop, payload)) {
      throw Object.assign(new Error('invalid answer'), { code: 'INVALID_ANSWER',
        errors: [{ field: 'decision', path: 'decision', code: 'invalid', message: "not one of this stop's options" }] });
    }
    if (entry.takingIn) throw refusal(sendingRefusal(), 'STOP_HELD');
    if (entry.heldStop) throw Object.assign(new Error(heldRefusal(entry.heldStop.after)), { code: 'STOP_HELD', status: 409 });
    // Small runs C4 (D11): Change it with a proposal changes the requirement now, before the turn is read; a refusal
    // throws and the question stays open. Only the run's re-plan waits for its turn.
    if (applyChange && pq.stop.change && payload && payload.source === 'requirement') {
      const r = applyChange(entry, pq.stop, by);
      if (r && Number.isInteger(r.changeRun)) payload = { ...payload, feedback: requirementChangedFeedback(pq.stop.change, { changeRun: r.changeRun }) };
    }
    const at = featureOf(entry);
    const hold = (after) => { entry.takeInRefused = null; entry.heldStop = { id, payload, by, after }; repaint(at); return { held: true }; };
    const hand = () => { entry.takeInRefused = null; entry.orch.answer(id, payload, by); taken(entry, id); return undefined; };
    const turn = turnOf(at);
    if (!turn.due) return hold(turn.after);
    if (!takeInApplies(entry, pq, payload)) return hand();
    const settling = settlingSiblingOf(entry.pipelineId, at);
    if (settling != null) return hold(settling);
    return (async () => {
      const r = await takingIn(entry, id);
      if (!entry.pendingQuestion || entry.pendingQuestion.id !== id) {
        throw refusal('this stop changed while its answer was being sent', 'STALE');
      }
      if (r && r.wait) return hold(r.after);
      if (!r || !r.ok) throw refusal((r && r.reason) || 'the finished work could not be taken in', 'TAKE_IN_REFUSED');
      const again = turnOf(at);                      // D13: another run may have started meanwhile
      return again.due ? hand() : hold(again.after);
    })();
  }

  /** Hand held answer `h` to its run now. */
  function handHeld(entry, h, at) {
    entry.heldStop = null;
    entry.takeInRefused = null;
    entry.orch.answer(h.id, h.payload, h.by);
    taken(entry, h.id);
    resolvePending(entry, { id: h.id, reason: 'answered' });
    repaint(at);
  }
  /** Keep held answer `h` waiting behind run `after` (repaint when that changed). */
  function keepHeld(entry, h, after, at) {
    if (after !== h.after) { entry.heldStop = { ...h, after }; repaint(at); }
  }
  function dropHeld(entry, err) {
    entry.heldStop = null;
    try { repaint(featureOf(entry)); } catch { /* the repaint is best-effort */ }
    console.error(`[worca-ui] held stop answer not delivered: ${err && err.message ? err.message : err}`);
  }

  /** Slice 3: a held answer's delivery after the take-in. Never rejects. */
  async function deliverTakenIn(entry, h, at) {
    try {
      const r = await takingIn(entry, h.id);
      if (entry.heldStop !== h) return;                                        // cleared meanwhile (the run stopped)
      if (!entry.pendingQuestion || entry.pendingQuestion.id !== h.id) { entry.heldStop = null; return; }
      if (r && r.wait) { keepHeld(entry, h, r.after, at); return; }
      if (r && r.refused) {
        // D11: dropped, not kept; the open stop says why until the next answer.
        entry.heldStop = null;
        entry.takeInRefused = { id: h.id, reason: r.reason };
        repaint(at);
        return;
      }
      if (!r || !r.ok) throw new Error('the finished work could not be taken in');
      const turn = turnOf(at);
      if (!turn.due) { keepHeld(entry, h, turn.after, at); return; }
      handHeld(entry, h, at);
    } catch (err) {
      dropHeld(entry, err);
    }
  }

  /** One delivery of `entry`'s held answer: undefined when done now, else a promise (a take-in) that never rejects. */
  function deliverOne(entry) {
    const h = entry && entry.heldStop;
    if (!h || entry.takingIn) return undefined;
    try {
      if (!entry.pendingQuestion || entry.pendingQuestion.id !== h.id) { entry.heldStop = null; return undefined; }
      const at = featureOf(entry);
      const turn = turnOf(at);
      if (!turn.due) { keepHeld(entry, h, turn.after, at); return undefined; }
      if (takeInApplies(entry, entry.pendingQuestion, h.payload)) {
        const settling = settlingSiblingOf(entry.pipelineId, at);
        if (settling != null) { keepHeld(entry, h, settling, at); return undefined; }
        return deliverTakenIn(entry, h, at);
      }
      handHeld(entry, h, at);
    } catch (err) {
      dropHeld(entry, err);
    }
    return undefined;
  }

  // ── Slice 7 (D1, D5, D6): a resume waits its turn. Held resumes live only here, in memory, keyed by pipeline id; a
  // restart drops them all. A pipeline being resumed (a held delivery, or a resume whose turn was due, until its
  // resumeRun settles) is in `delivering` and reads as being resumed, so its turn is taken from the check on.
  const resumes = new Map();
  const delivering = new Set();
  const refusedResumes = new Map();                // pipelineId -> {code, error}: why its held resume did not go on
  const pausedHolds = new Set();                   // pipelines whose hold a person dropped with Pause (fit-2-1)
  const paintFeature = (featureId) => { try { broadcastFeature(featureId); } catch { /* the repaint is best-effort */ } };
  const inFlight = () => (refuse ? refuse(409, { error: 'this run is being resumed', code: 'RESUME_IN_FLIGHT' })
    : Object.assign(new Error('this run is being resumed'), { code: 'RESUME_IN_FLIGHT', status: 409 }));

  /** Hold a resume of paused `pipelineId` while another run of its marked feature is going (flag on). → null (go on
   *  now; a hold whose turn has come is dropped) | {ok:true, held:true, pipelineId, after}. While the pipeline is
   *  being resumed, its own held delivery (`opts.heldDelivery`) goes on and any other resume throws 409. When the turn
   *  is due and `ticket` is given, the pipeline is claimed (`ticket.claimed`) until `claimed` releases it. */
  function holdResume(pipelineId, opts = {}, ticket = null) {
    pausedHolds.delete(pipelineId);                // a new Resume replaces the last reason and a Pause's drop
    refusedResumes.delete(pipelineId);
    if (!resume || !pipelineId || !shaperSmallRunsOn()) return null;
    const at = featureOfPipeline(pipelineId);
    if (!at || !smallRunsOfFeature(at.featureId)) return null;
    if (delivering.has(pipelineId)) {
      if (opts.heldDelivery === true) return null;
      throw inFlight();
    }
    const where = { featureId: at.featureId, index: at.idx };
    const turn = turnOf(where);
    const after = turn.due ? savingRunOf(pipelineId, where) : turn.after;   // A1: a due turn still waits for a save
    if (after == null) {
      const had = resumes.delete(pipelineId);
      if (ticket) { delivering.add(pipelineId); ticket.claimed = true; }
      if (had || ticket) paintFeature(at.featureId);
      return null;
    }
    const { heldDelivery, ...kept } = opts;
    const was = resumes.get(pipelineId);
    resumes.set(pipelineId, { pipelineId, featureId: at.featureId, index: at.idx, opts: kept, after });
    if (!was || was.after !== after) paintFeature(at.featureId);   // a ticket re-held each tick repaints once
    return { ok: true, held: true, pipelineId, after };
  }

  /** Run one resume `fn(ticket)` of `pipelineId`; a claim holdResume made on its ticket is released once it settles
   *  (its runs-map entry is set, or it refused). */
  async function claimed(pipelineId, fn) {
    const ticket = { claimed: false };
    try { return await fn(ticket); } finally {
      if (ticket.claimed) {
        delivering.delete(pipelineId);
        const at = featureOfPipeline(pipelineId);
        if (at) paintFeature(at.featureId);
      }
    }
  }

  const heldResumeOf = (pipelineId) => { const r = resumes.get(pipelineId); return r ? { after: r.after } : null; };
  /** Whether an unattended resume (the network watch) leaves `pipelineId` alone: its resume is held, being delivered,
   *  or a person dropped its hold with Pause. */
  const watchSkips = (pipelineId) => resumes.has(pipelineId) || delivering.has(pipelineId) || pausedHolds.has(pipelineId);

  /** D9: the live slice as every turn reader sees it: `resuming` while delivering, `heldResume` while held, and
   *  `resumeRefused: {code, error}` once a held resume was refused at its turn (until the next Resume). */
  function overlay(pipelineId, slice) {
    if (delivering.has(pipelineId)) {
      if (!slice) return liveSliceResuming();
      const out = { ...slice, resuming: true };
      delete out.heldResume;
      return out;
    }
    const r = resumes.get(pipelineId);
    if (r) return liveSliceHeldResume(slice, r.after);
    const no = refusedResumes.get(pipelineId);
    return no ? { ...(slice || liveSliceFrom({ runId: null, status: 'paused' })), resumeRefused: no } : slice;
  }

  /** Drop the hold of `pipelineId` (Pause or Stop on the held run). `paused: true` (a person's Pause) also keeps the
   *  network watch from taking the run up again until the next Resume (watchSkips). → whether there was one */
  function dropResume(pipelineId, { paused = false } = {}) {
    refusedResumes.delete(pipelineId);
    const r = resumes.get(pipelineId);
    if (!r) return false;
    resumes.delete(pipelineId);
    if (paused) pausedHolds.add(pipelineId);
    paintFeature(r.featureId);
    return true;
  }

  /** A held resume refused at its turn: the run stays paused, and says why on the run (overlay and audit line). */
  function refusedAtTurn(rec, err) {
    const error = (err && err.body && err.body.error) || (err && err.message) || String(err);
    const code = (err && err.body && err.body.code) || (err && err.code) || null;
    refusedResumes.set(rec.pipelineId, { code, error });
    console.error(`[worca-ui] held resume not delivered: ${error}`);
    try { if (audit) audit(rec.pipelineId, `The resume held for its turn did not go on: ${error}. Resume again to go on.`, rec.opts.by || 'local'); }
    catch { /* the audit line is best-effort */ }
  }

  /** D11: of a marked feature's boot picks only the lowest run goes on; each other is held after it, resumed later as
   *  {by, mock}. Idempotent. Flag off, or no resume dep: the picks unchanged. */
  function splitBootPicks(picks, { mock = false } = {}) {
    if (!resume || !shaperSmallRunsOn()) return picks;
    const byFeature = new Map();
    for (const p of picks) {
      const at = p && p.pipelineId ? featureOfPipeline(p.pipelineId) : null;
      if (!at || !smallRunsOfFeature(at.featureId)) continue;
      if (!byFeature.has(at.featureId)) byFeature.set(at.featureId, []);
      byFeature.get(at.featureId).push({ pick: p, featureId: at.featureId, index: at.idx });
    }
    const heldPicks = new Set();
    for (const [featureId, items] of byFeature) {
      const [kept, ...rest] = turnOrder(items);
      for (const it of rest) {
        resumes.set(it.pick.pipelineId, { pipelineId: it.pick.pipelineId, featureId, index: it.index, opts: { by: it.pick.by, mock }, after: kept.index });
        heldPicks.add(it.pick);
      }
      if (rest.length) paintFeature(featureId);
    }
    return heldPicks.size ? picks.filter((p) => !heldPicks.has(p)) : picks;
  }

  /** One delivery of held resume `rec` through `resume` (the whole resume guard chain again, D5): undefined while its
   *  turn is not due, else a promise that never rejects. `check: false` is the flag-off pass (D13): no turn check. */
  function deliverResume(rec, { check = true } = {}) {
    const pid = rec.pipelineId;
    if (resumes.get(pid) !== rec) return undefined;
    if (check) {
      const turn = turnOf(rec);
      const after = turn.due ? savingRunOf(pid, rec) : turn.after;   // A1: a due turn still waits for a save
      if (after != null) {
        if (after !== rec.after) { rec.after = after; paintFeature(rec.featureId); }
        return undefined;
      }
    }
    resumes.delete(pid);
    delivering.add(pid);
    return Promise.resolve().then(() => resume(pid, { ...rec.opts, heldDelivery: true })).then((r) => {
      if (r && r.held) { resumes.set(pid, { ...rec, after: Number.isInteger(r.after) ? r.after : rec.after }); return; }
      if (!r || r.ok === false) throw Object.assign(new Error((r && r.error) || 'the resume was refused'), { code: r && r.code });
    }).catch((err) => refusedAtTurn(rec, err)).finally(() => {
      delivering.delete(pid);
      paintFeature(rec.featureId);
    });
  }

  /** One pass over the runs map: null when it finished synchronously, else a promise. With small runs on (slice 6,
   *  D4, D6) the held entries go in turnOrder, lowest run first, and an entry still held after its delivery blocks the
   *  later entries of its feature; otherwise runs-map order. */
  function pass() {
    if (!shaperSmallRunsOn()) {
      const list = [...runs.values()];
      const step = (i) => {
        for (; i < list.length; i++) {
          const p = deliverOne(list[i]);
          if (p) return p.then(() => step(i + 1));
        }
        return null;
      };
      // D13: the rule that held a resume is off, so a left-over one goes on with no turn check.
      const left = [...resumes.values()];
      const rest = (i) => {
        for (; i < left.length; i++) {
          const p = deliverResume(left[i], { check: false });
          if (p) return p.then(() => rest(i + 1));
        }
        return null;
      };
      const answers = step(0);
      return answers ? answers.then(() => rest(0)) : rest(0);
    }
    // Slice 7 (D7): held answers and held resumes go in one order.
    const list = turnOrder([
      ...[...runs.values()].filter((e) => e && e.heldStop).map((entry) => ({ entry, ...featureOf(entry) })),
      ...[...resumes.values()].map((rec) => ({ resume: rec, featureId: rec.featureId, index: rec.index })),
    ]);
    const blocked = new Set();
    const after = (it) => { if (it.resume ? resumes.has(it.resume.pipelineId) : it.entry.heldStop) blocked.add(it.featureId); };
    const step = (i) => {
      for (; i < list.length; i++) {
        const it = list[i];
        if (blocked.has(it.featureId)) continue;
        const p = it.resume ? deliverResume(it.resume) : deliverOne(it.entry);
        if (p) return p.then(() => { after(it); return step(i + 1); });
        after(it);
      }
      return null;
    };
    return step(0);
  }

  let flight = null;
  let again = false;
  /** Hand every held answer whose turn has come to its run, one at a time (a delivered run is going again, so the next
   *  held one waits for it). A held answer whose question is gone (paused, stopped, answered elsewhere) is dropped.
   *  Without a take-in it does all its work before returning; a call while a take-in is in flight runs the loop once
   *  more instead of starting a second one (D12). */
  function deliver() {
    if (flight) { again = true; return flight; }
    const first = pass();
    if (!first) return Promise.resolve();
    flight = (async () => {
      try {
        await first;
        while (again) { again = false; await pass(); }
      } finally { flight = null; again = false; }
    })();
    return flight;
  }

  /** Drop a held answer (the person stopped the run). */
  function clear(entry) {
    if (!entry || !entry.heldStop) return;
    entry.heldStop = null;
    try { repaint(featureOf(entry)); } catch { /* the repaint is best-effort */ }
  }

  return { answer, deliver, clear, holdResume, heldResumeOf, overlay, dropResume, splitBootPicks, claimed, watchSkips };
}
