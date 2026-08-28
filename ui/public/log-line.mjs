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
  let prevCycle = null;
  for (const rec of recs || []) {
    if (!rec) continue;
    const sep = cycleSeparatorBefore(prevCycle, rec);
    if (sep) out.push(`── ${sep} ──`);
    if (rec.cycle != null) prevCycle = rec.cycle;
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

/**
 * The separator label to draw BEFORE `rec`, or null for none.
 *
 * `cycle` is the feedback-loop rewind counter: when a reviewer returns blocking
 * issues the pipeline rewinds and re-runs the same steps with cycle+1, so a
 * re-run is otherwise indistinguishable from its first pass. A rule drawn at the
 * boundary makes that legible without the reader having to filter for it.
 *
 * `prevCycle` is the cycle of the last RENDERED record that HAD one — the
 * caller carries it past cycle-less notices (artifact events, git/orchestrator
 * lines), which land exactly at rewind boundaries and must not mask them. It
 * must come from rendered records, not the model, so a filter that hides an
 * entire cycle cannot orphan a separator. null (no cycled record rendered yet)
 * yields null: no leading "Cycle 1" header.
 */
export function cycleSeparatorBefore(prevCycle, rec) {
  if (!rec || rec.cycle == null) return null;
  if (prevCycle == null) return null;
  if (String(prevCycle) === String(rec.cycle)) return null;
  return `Cycle ${rec.cycle}`;
}
