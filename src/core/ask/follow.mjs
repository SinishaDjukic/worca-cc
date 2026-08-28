// src/core/ask/follow.mjs
// Follow a run started from an Ask Worca card (ask-worca-design.md §9.5, §11).
// attachRunFollower(orch, deps) subscribes to the orchestrator's state/phase/
// question/error/done events — every handler exception-guarded so nothing here
// can break a run (chat/notifier.mjs precedent) — and mirrors them into the
// thread through two injected closures:
//   post({kind, text, href})                     → a system message + notice
//   updateStatus({pipelineId?, status?, phase?, cardFailed?}) → ask_run_links + ask-run-status
// Message budget per run: ≤3 question notices (deduped by id) + exactly one of
// failed/finished. done{status:'error'} posts nothing — the richer `error`
// event already did (the orchestrator emits both for one failure).
// detach() removes the named listeners and latches; the follower self-detaches
// on error/done. Core module: no Express, no orchestrator import — driven by a
// bare EventEmitter in tests.
import { fmtMs, fmtUsd } from '../chat/renderers.mjs';

const MAX_QUESTION_NOTICES = 3;

export function attachRunFollower(orch, {
  threadId, runId, cardId = null, post = () => {}, updateStatus = () => {}, onDetached = null,
} = {}) {
  let detached = false;
  let seenPipelineId = false;
  let title = '';
  const seenQuestions = new Set();

  const guard = (fn) => (payload) => {
    if (detached) return;
    try { fn(payload && typeof payload === 'object' ? payload : {}); } catch { /* never break the run */ }
  };

  const snapshot = () => { try { return (typeof orch.getState === 'function' && orch.getState()) || {}; } catch { return {}; } };
  const runName = () => title || snapshot().title || 'run';
  const finishLine = (status) => {
    // Duration/cost live on the orchestrator state, not the done payload
    // (chat/renderers.mjs:53-74 reads them from meta the same way).
    const state = snapshot();
    const name = runName();
    const parts = [`Run finished — "${name}" · ${status}`];
    const dur = fmtMs(state.totalActiveMs);
    if (dur) parts.push(dur);
    const cost = fmtUsd(state.totalCostUsd);
    if (cost) parts.push(cost);
    return parts.join(' · ');
  };

  const handlers = {
    state: guard((p) => {
      if (typeof p.title === 'string' && p.title) title = p.title;
      const patch = {};
      // First truthy sight only (ui/server.mjs wireRun guard): null pre-createPipeline
      // snapshots and later re-emits must not churn the stored id.
      if (!seenPipelineId && typeof p.id === 'string' && p.id) {
        seenPipelineId = true;
        patch.pipelineId = p.id;
      }
      if (p.status) patch.status = p.status;
      updateStatus(patch);
    }),
    exec: guard((p) => {
      // The graph engine has no linear phase: report the agent that just started.
      if (p.status !== 'start') return;
      updateStatus({ phase: p.agentKey || p.nodeId || null, status: 'running' });
    }),
    question: guard((p) => {
      const qid = String(p.id ?? 'q');
      if (seenQuestions.has(qid) || seenQuestions.size >= MAX_QUESTION_NOTICES) return;
      seenQuestions.add(qid);
      post({
        kind: 'question',
        text: `Run "${title || 'run'}" is waiting for your answer (${p.kind || 'question'})`,
        href: `#running/${runId}`,
      });
    }),
    error: guard((p) => {
      const message = typeof p.message === 'string' && p.message ? p.message : 'unknown error';
      updateStatus({ status: 'error', cardFailed: message });
      post({ kind: 'failed', text: `Run failed: ${message}`, href: `#running/${runId}` });
      detach();
    }),
    done: guard((p) => {
      const status = p.status || 'done';
      updateStatus({ status });
      if (status === 'paused') {
        // Terminal for THIS orchestrator, not for the run: a resume builds a new
        // one (ui/server.mjs resumeRun), which re-attaches a fresh follower. So say
        // "paused" — never "finished" — and let go (review of PR #376).
        post({ kind: 'paused', text: `Run paused — "${runName()}" · resume it from Running`, href: `#running/${runId}` });
      } else if (status !== 'error') {
        post({ kind: 'done', text: finishLine(status), href: `#running/${runId}` });
      }
      detach();
    }),
  };

  function detach() {
    if (detached) return;
    detached = true;
    for (const [name, handler] of Object.entries(handlers)) {
      try { orch.removeListener?.(name, handler); } catch { /* already gone */ }
    }
    try { onDetached?.(); } catch { /* prune callback is best-effort */ }
  }

  for (const [name, handler] of Object.entries(handlers)) orch.on(name, handler);
  return { detach, get detached() { return detached; }, threadId, runId, cardId };
}
