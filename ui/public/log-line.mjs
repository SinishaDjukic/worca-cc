// ui/public/log-line.mjs

// Pure, DOM-free: the className for one log line, given its level and whether it
// belongs to a fanned-out sub-agent. Extracted so the sub-agent styling decision
// is unit-testable without booting app.js (mirrors composer-core.mjs).
export function logLineClass(level, sub) {
  return 'log-line lvl-' + (level || 'info') + (sub ? ' sub-agent' : '');
}

/** Local wall-clock hh:mm:ss for a log record's ts (ISO string or epoch ms).
 *  Shared by the rendered line and the clipboard serializer so a copied log
 *  reads exactly like the pane it came from. */
export function logLineTime(ts) {
  const d = ts ? new Date(ts) : new Date();
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  const ss = String(d.getSeconds()).padStart(2, '0');
  return `${hh}:${mm}:${ss}`;
}

/** One log record as plain text, in the same order the DOM line renders it:
 *  `<hh:mm:ss> [source] text`. The pane spaces its ts/src/msg spans with a flex
 *  `gap` rather than whitespace, so a native selection-copy would run them
 *  together — the copy affordance serializes from the model through here
 *  instead of reading the DOM. */
export function logLineText(rec) {
  if (!rec) return '';
  const src = rec.source ? `[${rec.source}] ` : '';
  return `${logLineTime(rec.ts)} ${src}${rec.text == null ? '' : String(rec.text)}`;
}

/** A whole (already filtered) sequence of records as newline-joined text, with
 *  the SAME "Cycle N" rules the pane draws (one cycleSeparatorBefore walk) —
 *  without them a copied re-run repeats its steps with no visible boundary.
 *  Rendered as `── Cycle N ──`: the pane's rule lines are CSS, plain text
 *  needs the dashes. */
export function serializeLog(recs) {
  const out = [];
  const state = newCycleState();
  for (const rec of recs || []) {
    if (!rec) continue;
    const sep = cycleSeparatorBefore(state, rec);
    if (sep) out.push(`── ${sep} ──`);
    out.push(logLineText(rec));
  }
  return out.join('\n');
}

/** One persisted NDJSON record projected to the UI log-record shape. EVERY
 *  consumer of the persisted log goes through here — the live-card resume seed
 *  and the History replay must agree on which fields survive, or an axis works
 *  in one pane while silently dead in the other (`cycle` was dropped by one of
 *  three hand-rolled copies of this projection). `cycle` drives the cycle
 *  picker AND the "── Cycle N ──" separators; `stream` is stderr provenance;
 *  `nodeId` / `executionId` (v2 graph runs) drive the node select and the
 *  execution chip. Absent attribution stays ABSENT (the filters test `!= null`). */
export function projectLogRecord(rec) {
  return {
    source: rec.source, level: rec.level, text: rec.text, ts: rec.ts, sub: !!rec.sub,
    ...(rec.stepIndex != null ? { stepIndex: rec.stepIndex } : {}),
    ...(rec.cycle != null ? { cycle: rec.cycle } : {}),
    ...(rec.nodeId != null ? { nodeId: rec.nodeId } : {}),
    ...(rec.executionId != null ? { executionId: rec.executionId } : {}),
    ...(rec.stream ? { stream: rec.stream } : {}),
  };
}

/** The separator cursor: nodeId -> the HIGHEST ordinal rendered for that node
 *  so far ('' buckets a record with no nodeId — orchestrator notices, and every
 *  v1-shaped log). One per pane, carried across a filter repaint so a live
 *  append after one agrees with it. */
export function newCycleState() {
  return new Map();
}

/**
 * The separator label to draw BEFORE `rec`, or null for none — and the ONE
 * place `state` advances.
 *
 * In v2 `cycle` is the PER-NODE ordinal (`orchestrator.mjs` stamps
 * `cycle: ctx.ordinal` beside `nodeId`), NOT v1's pipeline-wide rewind counter.
 * Two nodes stream concurrently at unrelated ordinals, so comparing `rec.cycle`
 * to "the last cycle rendered by ANY node" drew a rule on nearly every
 * alternation (MIN-37). The rule belongs where a NODE re-runs: `rec.cycle`
 * strictly exceeds the highest ordinal that node has already rendered.
 *
 * Consequences that are deliberate:
 *   · a node's FIRST line never gets a header, whatever its ordinal — so a node
 *     that starts late at ordinal 1 draws nothing;
 *   · alternation between nodes draws nothing;
 *   · a cycle-less notice (artifact event, git line) landing exactly at a
 *     boundary neither draws nor masks a rule — it does not touch the state.
 *
 * The state must be advanced from RENDERED records only, never from the model,
 * so a filter that hides an entire cycle cannot orphan a separator.
 *
 * @param {Map<string, number>} state from newCycleState(); mutated in place
 * @param {object|null} rec
 * @returns {string|null}
 */
export function cycleSeparatorBefore(state, rec) {
  if (!rec || rec.cycle == null) return null;
  const seen = state instanceof Map ? state : null;
  if (!seen) return null;
  const key = rec.nodeId == null ? '' : String(rec.nodeId);
  const n = Number(rec.cycle);
  if (!Number.isFinite(n)) return null;
  const last = seen.get(key);
  seen.set(key, last == null ? n : Math.max(last, n));
  if (last == null || n <= last) return null;
  return `Cycle ${rec.cycle}`;
}
