// test/helpers/session-host-fakes.mjs — what every SessionHost test shares (session groups, Tasks 39–41): one session,
// its run-start decision, a recording harness port, member runOpts and memberInfo, and a transport the test releases.
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { splitCarried } from '../../src/core/session-cost.mjs';
import { sessionAuditLine } from '../../src/core/session-trace.mjs';

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
