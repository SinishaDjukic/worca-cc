// src/core/shape/held-stops.mjs — Shaper small runs C3 (D9): a person's answer to a stop question waits for the run's
// turn. While another slice of the feature is going, the answer is held on the runs-map entry (`entry.heldStop`, in
// memory) and the question stays open; once no other slice is going it is delivered: the run takes the answer, its
// question is resolved for every tab, and the feature card repaints. Lives outside the line-capped ui/server.mjs, which
// only wires it (re-exported by chain.mjs).
import { stopAnswerOk, stopOptionOf, heldRefusal, answeredRefusal, sendingRefusal } from '../../shared/shape/run-stops.mjs';
import { featureOfPipeline } from './features.mjs';
import { heldStopTurn, fireSourceOf } from './chain.mjs';
import { shaperSmallRunsOn, smallRunsOfFeature } from './small-runs.mjs';
import { requirementChangedFeedback } from '../../shared/shape/req-change.mjs';

/**
 * deps: { runs: Map of runs-map entries, liveSliceOf(id), broadcastFeature(featureId), resolvePending(entry, {id, reason}),
 * applyChange?(entry, stop, by) → {changeRun} (small runs C4: throws a refusal), now(): ms,
 * takeIn?(entry) → {ok, merged} | {ok:false, wait, after} | {ok:false, refused, reason} (slice 3: the run takes in the
 * finished same-base work before its answer goes on; without it every answer is today's synchronous path) }.
 * → { answer, deliver, clear }
 */
/** A runs-map entry's feature and run number: its slice when it carries one, else its pipeline's feature row. */
export function entryFeatureOf(entry) {
  const sl = entry && entry.orch && entry.orch.runShape && entry.orch.runShape.slice;
  if (sl && sl.feature && Number.isInteger(sl.index)) return { featureId: sl.feature, index: sl.index };
  const at = entry && entry.pipelineId ? featureOfPipeline(entry.pipelineId) : null;
  return at ? { featureId: at.featureId, index: at.idx } : null;
}

export function createHeldStops({ runs, liveSliceOf, broadcastFeature, resolvePending, applyChange = null, takeIn = null, now = Date.now }) {
  const featureOf = entryFeatureOf;
  const turnOf = (at) => (at ? heldStopTurn(at.featureId, at.index, { live: liveSliceOf, now: now() }) : { due: true });
  const repaint = (at) => { if (at) broadcastFeature(at.featureId); };
  /** Remember a stop the run has taken: one answer per stop. */
  const taken = (entry, id) => { (entry.answeredStops ||= new Set()).add(id); };
  const refusal = (message, code) => Object.assign(new Error(message), { code, status: 409 });

  /** Slice 3 (D3, D14): whether this stop's answer first takes in the finished same-base work: a marked feature's stop
   *  with the flag on, except "Change it" (the re-plan takes in at its own start). */
  function takeInApplies(entry, pq, payload) {
    if (!takeIn || !pq || !pq.stop || !shaperSmallRunsOn()) return false;
    const at = featureOf(entry);
    if (!at || !smallRunsOfFeature(at.featureId)) return false;
    return stopOptionOf(pq.stop, payload)?.value !== 'change';
  }

  /** Slice 3 (D4): the run number of another run of the entry's feature, on the same fire-time base, that is done but
   *  still committing its work (its teardown has not settled), or null. */
  function settlingSiblingOf(entry, at) {
    if (!at) return null;
    const own = fireSourceOf(entry.pipelineId);
    if (own == null) return null;
    for (const e of runs.values()) {
      if (!e || e === entry || e.status !== 'done' || e.settled === true) continue;
      const o = featureOf(e);
      if (o && o.featureId === at.featureId && fireSourceOf(e.pipelineId) === own) return o.index;
    }
    return null;
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
   *  nothing. Slice 3: on a marked feature the run first takes in the finished same-base work, so the answer comes back
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
    const settling = settlingSiblingOf(entry, at);
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
        const settling = settlingSiblingOf(entry, at);
        if (settling != null) { keepHeld(entry, h, settling, at); return undefined; }
        return deliverTakenIn(entry, h, at);
      }
      handHeld(entry, h, at);
    } catch (err) {
      dropHeld(entry, err);
    }
    return undefined;
  }

  /** One pass over the runs map: null when it finished synchronously, else a promise. */
  function pass() {
    const list = [...runs.values()];
    const step = (i) => {
      for (; i < list.length; i++) {
        const p = deliverOne(list[i]);
        if (p) return p.then(() => step(i + 1));
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

  return { answer, deliver, clear };
}
