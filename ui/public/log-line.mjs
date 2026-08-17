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

/** A whole (already filtered) sequence of records as newline-joined text. */
export function serializeLog(recs) {
  return (recs || []).filter(Boolean).map(logLineText).join('\n');
}

/**
 * The separator label to draw BEFORE `rec`, or null for none.
 *
 * `cycle` is the feedback-loop rewind counter: when a reviewer returns blocking
 * issues the pipeline rewinds and re-runs the same steps with cycle+1, so a
 * re-run is otherwise indistinguishable from its first pass. A rule drawn at the
 * boundary makes that legible without the reader having to filter for it.
 *
 * `prev` must be the previously RENDERED record, not the previous record in the
 * model — otherwise a filter that hides an entire cycle would leave an orphan
 * separator for a cycle with no lines under it. A null `prev` (first line in the
 * pane) yields null: no leading "Cycle 1" header.
 */
export function cycleSeparatorBefore(prev, rec) {
  if (!rec || rec.cycle == null) return null;
  if (!prev || prev.cycle == null) return null;
  if (String(prev.cycle) === String(rec.cycle)) return null;
  return `Cycle ${rec.cycle}`;
}
