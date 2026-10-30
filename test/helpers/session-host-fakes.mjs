// test/helpers/session-host-fakes.mjs — what every SessionHost test shares (session groups, Tasks 39–41): one session,
// its run-start decision, a recording harness port, member runOpts and memberInfo, and a transport the test releases.
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { splitCarried } from '../../src/core/session-cost.mjs';
import { sessionAuditLine } from '../../src/core/session-trace.mjs';
import { createOrchestrator } from '../../src/core/orchestrator.mjs';
import { readPipelineForResume } from '../../src/core/artifacts.mjs';
import { getDb } from '../../src/core/db.mjs';
import { _testing as mockT } from '../../src/core/engines/mock-session.mjs';
import { gitDir } from './git-dir.mjs';

export const SID = 's_aaaaaaaa';

/** A SessionSpec as resolveSessions builds it (Task 14), with the settings defaults filled. */
export function spec(members = ['n_a', 'n_b'], settings = {}) {
  return { sid: SID, members: [...members], closure: [...members], flows: [], internalWires: [], entryWires: [], exitWires: [],
    crossingLoops: [], settings: { label: 'One session', mode: 'subagents', hostModel: null, hostEffort: null, ...settings } };
}

/** The run-start gate's decisions (Task 44: `Map<sid, { mode, requested, reason, firstMemberModel }>`). */
export function decisions(mode = 'subagents', over = {}) {
  const reason = mode === 'separate' ? 'the Labs flag sessionGroups is off' : 'ok';
  return new Map([[SID, { mode, requested: 'subagents', reason, firstMemberModel: null, ...over }]]);
}

const NO_CHECKS = () => ({ ok: true, checks: [] });

/** The harness port (Task 42's `_sessionPort()` shape), recording everything. `bookTurn` books the cumulative growth per
 *  host session id (the run-level baseline, Task 34) and splits carried spend as `_bookSessionTurn` does (Task 33). */
export function fakePort(over = {}) {
  const totals = new Map();
  const port = {
    runId: 'p_test', pipelineDir: mkdtempSync(join(tmpdir(), 'sess-host-')), engine: 'claude', mock: true,
    records: [], booked: [], stamped: [], logs: [], audits: [], queued: [], seeded: [], summary: null,
    bookTurn(b) {
      port.booked.push(b);
      const none = { deltaUsd: null, memberUsd: null, hostOverheadUsd: null, costSource: 'none', hostPriced: false, overridden: false, carried: null, reconcile: NO_CHECKS() };
      if (over.engineCost === false) return none;                        // C24: blank, never $0
      if (Number.isFinite(b.cutEstimateUsd)) return { ...none, memberUsd: b.cutEstimateUsd, costSource: 'estimate' };
      if (Object.hasOwn(b, 'turnUsd')) {                                 // a result that is the turn's own cost (Task 65): Δ as it is
        if (!Number.isFinite(b.turnUsd)) return none;
        return { ...none, deltaUsd: b.turnUsd, memberUsd: b.turnUsd, hostOverheadUsd: 0, costSource: 'harness' };
      }
      if (!Number.isFinite(b.cumulativeUsd)) return none;
      const prev = totals.get(b.hostSessionId) ?? 0;
      const deltaUsd = Math.max(0, b.cumulativeUsd - prev);
      totals.set(b.hostSessionId, b.cumulativeUsd);
      // The carried split as Task 42 takes it: each cut part, oldest first, at its list price; the rest is this turn's.
      let rest = deltaUsd;
      const parts = (b.carried ? (b.carried.parts || [b.carried]) : []).map((p) => {
        const { carriedUsd, restUsd } = splitCarried({ deltaUsd: rest, cutUsd: p.cutListUsd ?? p.cutUsd });
        rest = restUsd;
        return { turnId: p.turnId ?? null, executionId: p.executionId ?? null, usd: carriedUsd };
      });
      return { deltaUsd, memberUsd: rest, hostOverheadUsd: 0, costSource: 'harness', hostPriced: true, overridden: false,
        carried: b.carried ? { usd: parts.reduce((a, p) => a + p.usd, 0), parts } : null, reconcile: NO_CHECKS() };
    },
    onRecord(sid, rec, summary) {
      port.records.push(rec);
      port.summary = summary;
      const line = sessionAuditLine(rec, summary);                       // what the harness audits (Task 43)
      if (line != null) port.audits.push(line);
    },
    stampRow(stepKey, ref) { port.stamped.push({ stepKey, ref }); },
    remainingBudgetUsd: () => null,
    checkCostLimits: () => {},
    seedBaseline(hostSessionId, usd) { port.seeded.push([hostSessionId, usd]); },
    onQueue(executionId, queued) { port.queued.push([executionId, queued]); },
    log(level, text, attr) { port.logs.push({ level, text, attr }); },
  };
  for (const [k, v] of Object.entries(over)) if (k !== 'engineCost') port[k] = v;
  return port;
}

/** A member's runOpts, as the executor builds them (`runOpts`), on the mock. */
export function memberOpts({ signal = new AbortController().signal, events = [] } = {}) {
  return { cwd: tmpdir(), systemPrompt: 'SYS', prompt: 'TASK', allowedTools: ['Read'], signal, onEvent: (e) => events.push(e), mock: true, engine: 'claude' };
}

/** A member's runOpts for the offline host (mock-session.mjs): a generic producer that writes `out.md` in its own dir, pinned to
 *  Opus at high effort. `executionId` only names the call; the host reads the execution from `member()`. */
export function mockMember(executionId, events = [], over = {}) {
  void executionId;
  const dir = mkdtempSync(join(tmpdir(), 'turn-'));
  return { cwd: dir, systemPrompt: 'SYS\nMOCK_ROLE: generic-producer', prompt: `TASK\nMOCK_OUT: ${join(dir, 'out.md')}`, allowedTools: ['Read'],
    signal: new AbortController().signal, onEvent: (e) => events.push(e), mock: true, engine: 'claude', model: 'claude-opus-5-5', effort: 'high', ...over };
}

/** memberInfo(full) (Task 45): a member that pins no model or effort of its own. */
export const member = (nodeId, n = 1) => ({ nodeId, executionId: `x:${nodeId}:${n}`, ordinal: n, label: `${nodeId} · cycle ${n}`, model: null, effort: null, fanOut: false });

/** The six frames of a clean host turn (Task 32's okTurn), for `agentType`, raw as the Claude runner hands them on. */
export function okFrames({ agentType, hostSessionId = 'H1', callId = 'T1', model = 'claude-haiku-4-5', cumulativeUsd = 0.42, subtype = 'success' } = {}) {
  return [
    { type: 'system', subtype: 'init', session_id: hostSessionId, model },
    { type: 'assistant', message: { id: `${callId}h1`, usage: { input_tokens: 900, output_tokens: 30, cache_read_input_tokens: 100 },
      content: [{ type: 'tool_use', id: callId, name: 'Agent', input: { subagent_type: agentType, description: 'Step', prompt: 'Begin your step.' } }] } },
    { type: 'assistant', parent_tool_use_id: callId, message: { id: `${callId}c1`, content: [{ type: 'text', text: 'member at work' }], usage: { input_tokens: 5000, output_tokens: 700 } } },
    { type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: callId, content: [{ type: 'text', text: 'REPORT' }] }] },
      tool_use_result: { usage: { input_tokens: 5000, output_tokens: 700 }, resolvedModel: 'claude-opus-5-5', totalDurationMs: 61000, totalTokens: 5700, agentId: `ag-${callId}` } },
    { type: 'assistant', message: { id: `${callId}h2`, usage: { input_tokens: 950, output_tokens: 2 }, content: [{ type: 'text', text: 'DONE' }] } },
    { type: 'result', subtype, is_error: subtype !== 'success', session_id: hostSessionId, total_cost_usd: cumulativeUsd, num_turns: 3, usage: { input_tokens: 1850 } },
  ];
}

/** A transport that plays `frames(hostOpts, i)` (raw stream-json objects) through `hostOpts.onEvent`, as the Claude runner
 *  hands them on, and rejects with an AbortError once the turn's signal fired, as a killed CLI does (`race: true` plays every
 *  frame and resolves regardless). Otherwise it rejects with `fail(i)` when that gives an error, else resolves. Every call's hostOpts is kept in `calls`. */
export function framesTransport(frames, { fail = () => null, race = false } = {}) {
  const calls = [];
  const transport = async (hostOpts) => {
    const i = calls.length;
    calls.push(hostOpts);
    for (const raw of frames(hostOpts, i)) {
      if (!race && hostOpts.signal?.aborted) throw Object.assign(new Error('aborted'), { name: 'AbortError' });
      hostOpts.onEvent?.(raw.type === 'hook-event' || raw.type === 'log' ? raw : { type: raw.type, raw });
    }
    if (!race && hostOpts.signal?.aborted) throw Object.assign(new Error('aborted'), { name: 'AbortError' });   // the kill
    const err = fail(i);
    if (err) throw err;
    return { text: 'DONE', exitCode: 0 };
  };
  return { transport, calls };
}

/** A transport whose every call parks until the test settles it: `ok(i, over)` plays a clean turn (okFrames) through
 *  `hostOpts.onEvent` and resolves; `fail(i, err)` rejects. The agentType is the one the dispatch line names. */
export function gatedTransport() {
  const calls = [];
  let hosts = 0;
  const transport = (hostOpts) => new Promise((resolve, reject) => { calls.push({ hostOpts, resolve, reject }); });
  function ok(i, over = {}) {
    const { hostOpts, resolve } = calls[i];
    const agentType = /subagent_type "([^"]+)"/.exec(String(hostOpts.prompt))?.[1] ?? null;
    const hostSessionId = hostOpts.resumeSessionId || `H${++hosts}`;
    for (const raw of okFrames({ agentType, hostSessionId, callId: `T${i + 1}`, ...over })) hostOpts.onEvent?.({ type: raw.type, raw });
    resolve({ text: 'DONE', exitCode: 0 });
  }
  const fail = (i, err) => calls[i].reject(err);
  return { transport, calls, ok, fail };
}

/** Hang `nodeId`'s FIRST dispatch (`x:<nodeId>:1`, attempt 1) on the mock host and call `onBound(seen)` once its member
 *  is bound (the mock's onMemberStart: member_bound is written, the turn is about to hang). `spendBeforeHang`: what the
 *  mock spends before it hangs, as a killed CLI spends money its result never reports. Restored by the returned undo. */
function hangFirstDispatch(nodeId, spendBeforeHang, onBound) {
  const prefix = `worca-x-${nodeId}-1-a1`;
  const prev = { behave: mockT.behave, onMemberStart: mockT.onMemberStart, spendBeforeHang: mockT.spendBeforeHang };
  let hung = false;
  mockT.spendBeforeHang = Number.isFinite(spendBeforeHang) ? spendBeforeHang : null;
  mockT.behave = (a) => {
    if (!hung && a.agentType === prefix) { hung = true; return 'hang'; }
    return prev.behave?.(a) ?? null;
  };
  mockT.onMemberStart = (a) => {
    prev.onMemberStart?.(a);
    if (a.agentType === prefix) onBound(mockT.seen.at(-1));
  };
  return () => { mockT.behave = prev.behave; mockT.onMemberStart = prev.onMemberStart; mockT.spendBeforeHang = prev.spendBeforeHang; };
}

/** A whole mock run of `workflowId`, paused (the user's Pause) while `nodeId`'s first dispatch is inside its host turn:
 *  member bound, the member at work. Resolves once the run settled as paused. → { orch, id } */
export async function pauseMidTurn({ workflowId, nodeId, spendBeforeHang = null }) {
  let orch = null;
  const undo = hangFirstDispatch(nodeId, spendBeforeHang, () => { queueMicrotask(() => orch.pause()); });
  try {
    orch = createOrchestrator({ projectDir: gitDir(`pause-${nodeId}`), workflowId, prompt: 'demo', auto: true, claude: { mock: true } });
    const res = await orch.run();
    if (res.status !== 'paused') throw new Error(`pauseMidTurn: the run ended ${res.status}${res.error ? ` (${res.error})` : ''}, not paused`);
    return { orch, id: orch.getState().id };
  } finally { undo(); }
}

/** A whole mock run of `workflowId` that "crashes" while `nodeId`'s first dispatch is inside its host turn: the first
 *  orchestrator is left hanging and cut off from the DB (it writes nothing more: no turn_end, no close), its heartbeat
 *  stops, and the row reads as a crashed server's reconcile leaves it (`interrupted`, the member row `running`).
 *  → { id, orch, hostSessionId } (hostSessionId: the host the hung turn ran on). */
export async function crashMidTurn({ workflowId, nodeId }) {
  let bound;
  const atBind = new Promise((resolve) => { bound = resolve; });
  const undo = hangFirstDispatch(nodeId, null, (seen) => bound(seen));
  let orch;
  try {
    orch = createOrchestrator({ projectDir: gitDir(`crash-${nodeId}`), workflowId, prompt: 'demo', auto: true, claude: { mock: true } });
    orch.run().catch(() => {});                                     // never settles: the process "died" mid-turn
    const seen = await atBind;
    const id = orch.getState().id;
    orch._persist = async () => {};                                 // a dead process writes nothing more
    orch._stopHeartbeat();
    const db = getDb();
    db.prepare("UPDATE pipelines SET status = 'interrupted', heartbeat_at = ? WHERE id = ?").run(new Date(Date.now() - 300_000).toISOString(), id);
    db.prepare("UPDATE pipeline_steps SET status = 'running' WHERE pipeline_id = ? AND key = ?").run(id, `x:${nodeId}:1`);
    if (!readPipelineForResume(id)) throw new Error('crashMidTurn: the row is not resumable');
    return { id, orch, hostSessionId: seen.hostSessionId };
  } finally { undo(); }
}
