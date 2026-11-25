// src/core/shape/held-stops.mjs — Shaper small runs C3 (D9): a person's answer to a stop question waits for the run's
// turn. While another slice of the feature is going, the answer is held on the runs-map entry (`entry.heldStop`, in
// memory) and the question stays open; once no other slice is going it is delivered: the run takes the answer, its
// question is resolved for every tab, and the feature card repaints. Lives outside the line-capped ui/server.mjs, which
// only wires it (re-exported by chain.mjs).
import { stopAnswerOk, heldRefusal, answeredRefusal } from '../../shared/shape/run-stops.mjs';
import { featureOfPipeline } from './features.mjs';
import { heldStopTurn } from './chain.mjs';
import { requirementChangedFeedback } from '../../shared/shape/req-change.mjs';

/**
 * deps: { runs: Map of runs-map entries, liveSliceOf(id), broadcastFeature(featureId), resolvePending(entry, {id, reason}),
 * applyChange?(entry, stop, by) → {changeRun} (small runs C4: throws a refusal), now(): ms }. → { answer, deliver, clear }
 */
/** A runs-map entry's feature and run number: its slice when it carries one, else its pipeline's feature row. */
export function entryFeatureOf(entry) {
  const sl = entry && entry.orch && entry.orch.runShape && entry.orch.runShape.slice;
  if (sl && sl.feature && Number.isInteger(sl.index)) return { featureId: sl.feature, index: sl.index };
  const at = entry && entry.pipelineId ? featureOfPipeline(entry.pipelineId) : null;
  return at ? { featureId: at.featureId, index: at.idx } : null;
}

export function createHeldStops({ runs, liveSliceOf, broadcastFeature, resolvePending, applyChange = null, now = Date.now }) {
  const featureOf = entryFeatureOf;
  const turnOf = (at) => (at ? heldStopTurn(at.featureId, at.index, { live: liveSliceOf, now: now() }) : { due: true });
  const repaint = (at) => { if (at) broadcastFeature(at.featureId); };
  /** Remember a stop the run has taken: one answer per stop. */
  const taken = (entry, id) => { (entry.answeredStops ||= new Set()).add(id); };

  /** Answer question `id` of `entry`. A stop's answer must be one of its options (422) and only one may be held (409);
   *  it is held while another slice is going ({held:true}), else handed to the run now (the caller resolves the
   *  question, as for every other answer). A stop this run has already taken (`entry.answeredStops`, in memory) refuses
   *  a later answer with its id (409 STOP_ANSWERED). Any other question goes straight to the run. A refusal changes
   *  nothing. */
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
    if (entry.heldStop) throw Object.assign(new Error(heldRefusal(entry.heldStop.after)), { code: 'STOP_HELD', status: 409 });
    // Small runs C4 (D11): Change it with a proposal changes the requirement now, before the turn is read; a refusal
    // throws and the question stays open. Only the run's re-plan waits for its turn.
    if (applyChange && pq.stop.change && payload && payload.source === 'requirement') {
      const r = applyChange(entry, pq.stop, by);
      if (r && Number.isInteger(r.changeRun)) payload = { ...payload, feedback: requirementChangedFeedback(pq.stop.change, { changeRun: r.changeRun }) };
    }
    const at = featureOf(entry);
    const turn = turnOf(at);
    if (!turn.due) {
      entry.heldStop = { id, payload, by, after: turn.after };
      repaint(at);
      return { held: true };
    }
    entry.orch.answer(id, payload, by);
    taken(entry, id);
    return undefined;
  }

  /** Hand every held answer whose turn has come to its run, one at a time (a delivered run is going again, so the next
   *  held one waits for it). A held answer whose question is gone (paused, stopped, answered elsewhere) is dropped. */
  function deliver() {
    for (const entry of runs.values()) {
      const h = entry && entry.heldStop;
      if (!h) continue;
      try {
        if (!entry.pendingQuestion || entry.pendingQuestion.id !== h.id) { entry.heldStop = null; continue; }
        const at = featureOf(entry);
        const turn = turnOf(at);
        if (!turn.due) { if (turn.after !== h.after) { entry.heldStop = { ...h, after: turn.after }; repaint(at); } continue; }
        entry.heldStop = null;
        entry.orch.answer(h.id, h.payload, h.by);
        taken(entry, h.id);
        resolvePending(entry, { id: h.id, reason: 'answered' });
        repaint(at);
      } catch (err) {
        entry.heldStop = null;
        try { repaint(featureOf(entry)); } catch { /* the repaint is best-effort */ }
        console.error(`[worca-ui] held stop answer not delivered: ${err && err.message ? err.message : err}`);
      }
    }
  }

  /** Drop a held answer (the person stopped the run). */
  function clear(entry) {
    if (!entry || !entry.heldStop) return;
    entry.heldStop = null;
    try { repaint(featureOf(entry)); } catch { /* the repaint is best-effort */ }
  }

  return { answer, deliver, clear };
}
