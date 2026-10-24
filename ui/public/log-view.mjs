// ui/public/log-view.mjs — Run logs: Summaries / Raw (#911 slice 3, flag commandSummaries).
// A Claude Code Bash call's log record carries its own `description` as `desc` (run-harness.mjs); Summaries
// shows it in place of the clipped command, Raw shows the record's text as before. Codex and Cursor give no
// description, so their lines read raw in both modes. Pure DOM helpers, no app state: app.js owns the flag and
// the stored choice. The choice is per browser, like the drawer height (log-drawer.mjs HEIGHT_KEY).

export const LOG_VIEW_KEY = 'worca-cc.logs.view';
const VIEWS = ['summary', 'raw'];

/** The stored view, 'summary' when nothing valid is stored or the storage throws. */
export function readLogView(storage) {
  try { const v = storage ? storage.getItem(LOG_VIEW_KEY) : null; return VIEWS.includes(v) ? v : 'summary'; } catch { return 'summary'; }
}

export function writeLogView(storage, view) {
  if (!VIEWS.includes(view)) return;
  try { if (storage) storage.setItem(LOG_VIEW_KEY, view); } catch { /* private mode */ }
}

const descOf = (rec) => (typeof rec?.desc === 'string' && rec.desc ? rec.desc : '');

/** The message text a log line shows in `view`. */
export function logMsgText(rec, view) {
  const raw = rec?.text == null ? '' : String(rec.text);
  const d = descOf(rec);
  return view === 'summary' && d ? `→ ${d}` : raw;
}

/** Fill one `.log-msg`. A summarised line keeps both texts on the node, so applyLogView can swap it in place. */
export function paintLogMsg(m, rec, view) {
  const d = descOf(rec);
  if (d) { m.dataset.desc = d; m.dataset.raw = rec.text == null ? '' : String(rec.text); }
  m.textContent = logMsgText(rec, view);
  if (view === 'summary' && d) m.title = m.dataset.raw;
  else m.removeAttribute('title');
}

/** Press the button for `view` in one Summaries / Raw switch. */
export function syncLogViewSeg(seg, view) {
  for (const b of seg.querySelectorAll('button[data-log-view]')) {
    const on = b.dataset.logView === view;
    b.setAttribute('aria-pressed', String(on));
    b.classList.toggle('on', on);
  }
}

/** Re-show every summarised line and every switch under `root` in `view`: no pane is rebuilt. */
export function applyLogView(root, view) {
  for (const m of root.querySelectorAll('.log-msg[data-desc]')) paintLogMsg(m, { text: m.dataset.raw, desc: m.dataset.desc }, view);
  for (const seg of root.querySelectorAll('.log-view-seg')) syncLogViewSeg(seg, view);
}
