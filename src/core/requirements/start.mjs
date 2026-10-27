// src/core/requirements/start.mjs
// Start in Worca (plans/requirements-a2-design.md D5, D6, D8, D10): a feature's spec becomes a normal run,
// started through the run handler the server injects (deps.startRun), never around it. The spec the run
// got is frozen in req_starts, and so are the files it sent (A8 D14). No import of ui/server.mjs: the handler arrives as
// a dependency.
import { randomUUID } from 'node:crypto';
import { tx } from '../db.mjs';
import { RequirementsError } from './spec.mjs';
import {
  requireFeature, listTurns, latestStart, createStart, appendTurn, linkPipeline, startByRunId, startByPipelineId, listAttachments,
} from './store.mjs';
import { isBusy } from './interview.mjs';
import { runFiles, unsendableRunFile, cannotGoWithRun } from './attachment-job.mjs';
import { markStarting, unmarkStarting, isStarting } from './starting.mjs';
import { readiness } from './ready.mjs';
import { renderTaskMarkdown } from './markdown.mjs';

export const REASON_MAX = 500;
export const DEFAULT_WORKFLOW_ID = 'wf_auto';
const WORKFLOW_ID = /^wf_[a-z0-9_-]+$/i;

/** A start is between the run handler's call and its stored row (starting.mjs): a second start waits its turn, and so do
 *  archive, a scope change (edits.mjs) and a follow-up round (interview.mjs). */
export { isStarting };

/** The run handler's refusal as a RequirementsError (D6): 403 budget → BUDGET, 400 → BAD_REQUEST, other 4xx
 *  → CONFLICT, anything else a plain Error (500). Carries the handler's own message. */
function refusal(res) {
  const status = Number(res && res.status);
  const given = res && res.body && typeof res.body.error === 'string' && res.body.error.trim();
  const message = given || `the run could not start (HTTP ${Number.isFinite(status) ? status : '?'})`;
  if (status === 403) return new RequirementsError('BUDGET', message);
  if (status === 400) return new RequirementsError('BAD_REQUEST', message);
  if (status > 400 && status < 500) return new RequirementsError('CONFLICT', message);
  return new Error(message);
}

/**
 * Start a run from a feature (D5, D6). Refused while busy, archived or without a target, always; when any
 * other check fails, only with a reason (1–500 characters), else NOT_READY with the failing keys. A8 D14: the
 * switched-on files and documents go as `extrasFiles` (the key only when there are some), each with the sha256 the
 * staging checks its copy against; one Worca cannot open refuses the start (CONFLICT, naming it), so a run never
 * goes without a file the product owner chose. The start row records `files`.
 * @param {number} seq
 * @param {{ reason?:string, workflowId?:string, sourceBranch?:string }} input
 * @param {{ by?:string|null }} who
 * @param {{ startRun:(body:object, opts:{runId:string, startedBy:string|null,
 *     extrasFiles?:Array<{id:string, name:string, path:string, sha256:string}>})=>Promise<{status:number, body:any}>,
 *   target:{ ok:boolean, label?:string, hint?:string, name?:string, path?:string }, newRunId?:()=>string }} deps
 * @returns {Promise<{ runId:string, version:number }>}
 */
export async function startFeature(seq, { reason, workflowId, sourceBranch } = {}, { by = null } = {}, deps = {}) {
  const { startRun, target = { ok: false }, newRunId = randomUUID } = deps;
  if (typeof startRun !== 'function') throw new Error('starting runs is not available');
  const f = requireFeature(seq);
  if (f.status === 'archived') throw new RequirementsError('CONFLICT', 'this feature is archived; restore it first');
  if (isBusy(f.seq)) throw new RequirementsError('BUSY', 'Worca is still working on this feature. Try again in a moment.');
  if (isStarting(f.seq)) throw new RequirementsError('BUSY', 'this feature is already starting a run. Try again in a moment.');
  markStarting(f.seq);   // before the first await: two starts at once cannot both pass
  try {
    // A8 D8: a file no round asked about fails "Interview finished" here too (an override, with a reason)
    const r = readiness(f, { turns: listTurns(f.seq), target, files: listAttachments('feature', f.seq) });
    if (!target || !target.ok) throw new RequirementsError('CONFLICT', r.checks.find((c) => c.key === 'target').hint);
    const failing = r.checks.filter((c) => !c.ok).map((c) => c.key);
    const why = typeof reason === 'string' ? reason.trim() : '';
    if (failing.length) {
      if (!why) throw new RequirementsError('NOT_READY', 'This feature is not Ready. Give a reason to start it anyway.', { failing });
      if (why.length > REASON_MAX) throw new RequirementsError('BAD_REQUEST', `the reason must be at most ${REASON_MAX} characters`);
    }
    let wf = DEFAULT_WORKFLOW_ID;
    if (workflowId !== undefined && workflowId !== null && workflowId !== '') {
      if (typeof workflowId !== 'string' || !WORKFLOW_ID.test(workflowId)) throw new RequirementsError('BAD_REQUEST', 'workflowId is not a workflow id');
      wf = workflowId;
    }
    const branch = typeof sourceBranch === 'string' && sourceBranch.trim() ? sourceBranch.trim() : null;

    const version = ((latestStart(f.seq) || {}).version || 0) + 1;
    const spec = structuredClone(f.spec);
    const body = {
      promptMarkdown: renderTaskMarkdown(f, { spec, targetName: target.name || null, version }),
      title: `${f.id}: ${f.title}`,
      ...(f.scopeType === 'workspace' ? { workspaceId: f.scopeKey } : { projectDir: target.path }),
      workflowId: wf,
      guardrailsId: 'normal',
      ...(branch ? { sourceBranch: branch } : {}),
    };
    const sent = runFiles(f);   // A8 D14
    const bad = unsendableRunFile(sent);
    if (bad) throw new RequirementsError('CONFLICT', cannotGoWithRun(bad.name));
    const runId = newRunId();
    const res = await startRun(body, { runId, startedBy: by,
      ...(sent.length ? { extrasFiles: sent.map(({ id, name, path, sha256 }) => ({ id, name, path, sha256 })) } : {}) });
    const status = Number(res && res.status);
    if (!(status >= 200 && status <= 299)) throw refusal(res);
    const stored = (res.body && typeof res.body.runId === 'string' && res.body.runId) || runId;
    try {
      tx(() => {
        createStart({ featureSeq: f.seq, version, runId: stored, spec, title: f.title, ready: r.ok, failing,
          reason: failing.length ? why : null, workflowId: body.workflowId, sourceBranch: body.sourceBranch || null,
          files: sent.map(({ id, name, sha256, from }) => ({ id, name, sha256, from })) }, { by });
        appendTurn(f.seq, { kind: 'start', payload: { version, runId: stored, override: failing.length > 0 } }, { by });
      });
    } catch (err) {
      // The run is already started: without its row the feature never learns of it (an orphan run).
      console.error(`[worca-ui] requirements: run ${stored} started for ${f.id}, but its start could not be stored: ${err && err.message ? err.message : err}`);
      throw err;
    }
    return { runId: stored, version };
  } finally {
    unmarkStarting(f.seq);
  }
}

/**
 * One start as the page shows it (D10). `runSummary({ runId, pipelineId })` (injected; may be async, may
 * throw) → `{ status, phase, costUsd, pipelineId, href? } | null`. When it knows a pipeline id the row lacks,
 * the row is linked (the run-event hook normally does that first, D9). Its `href` (the live run, which a
 * resume gives a new UUID, or the saved run's History page) wins over `#running/<runId>`.
 */
export async function startView(start, runSummary = () => null) {
  let s = null;
  try { s = (await runSummary({ runId: start.runId, pipelineId: start.pipelineId })) || null; } catch { s = null; }
  let pipelineId = start.pipelineId || null;
  if (!pipelineId && s && typeof s.pipelineId === 'string' && s.pipelineId) {
    linkPipeline(start.runId, s.pipelineId);
    pipelineId = s.pipelineId;
  }
  return {
    version: start.version, runId: start.runId, pipelineId, startedBy: start.startedBy, startedAt: start.startedAt,
    ready: start.ready, failing: start.failing, reason: start.reason, workflowId: start.workflowId, sourceBranch: start.sourceBranch,
    files: start.files || [],   // A8 D14: what the start sent, [{ id, name, sha256, from }]
    run: s ? { status: s.status ?? null, phase: s.phase ?? null, costUsd: s.costUsd ?? null,
      href: (typeof s.href === 'string' && s.href) || `#running/${start.runId}`,
      ...(s.waiting === true ? { waiting: true } : {}) } : null,   // the live run waits for the person
  };
}

/**
 * The run-event hook `wireRun` in ui/server.mjs calls for every event of every run (D9). Only `state`,
 * `done`, `error` and `question` do work, and only for runs a start made (one indexed lookup): the first
 * `state` with a pipeline id fills `pipeline_id`, and the feature is notified when the run's status changed
 * since its last event or the pipeline id was just linked, when the run asks the person something, and at
 * the first `state` after that (the answer let it go on; the page reads whether it still waits). A resumed
 * run has a new UUID but the same pipeline: when the run id is unknown, the pipeline id (the `state`
 * payload's, else the entry's `pipelineId`) finds the start. Never throws.
 * @param {{ notify:(seq:number)=>void }} o  the requirements change notifier (checks the flag itself)
 * @returns {(runId:string, name:string, payload:any, pipelineId?:string|null)=>void}
 */
export function createRunEventHook({ notify }) {
  const last = new Map();   // runId → the status its last event carried
  const asked = new Set();  // runIds whose last news was a question
  return (runId, name, payload, pipelineId = null) => {
    if (name !== 'state' && name !== 'done' && name !== 'error' && name !== 'question') return;
    try {
      const p = payload && typeof payload === 'object' ? payload : {};
      const pid = name === 'state' && typeof p.id === 'string' && p.id ? p.id
        : typeof pipelineId === 'string' && pipelineId ? pipelineId : null;
      const start = startByRunId(runId) || (pid ? startByPipelineId(pid) : null);
      if (!start) return;
      if (name === 'question') { asked.add(runId); notify(start.featureSeq); return; }
      const answered = asked.delete(runId);
      let linked = false;
      if (name === 'state' && typeof p.id === 'string' && p.id) linked = linkPipeline(start.runId, p.id);
      const status = name === 'state' ? (p.status || null) : name === 'done' ? (p.status || 'done') : 'error';
      const changed = status != null && last.get(runId) !== status;
      if (name === 'state') { if (status != null) last.set(runId, status); } else last.delete(runId);
      if (changed || linked || answered) notify(start.featureSeq);
    } catch (err) {
      console.error(`[worca-ui] requirements run link failed: ${err && err.message ? err.message : err}`);
    }
  };
}
