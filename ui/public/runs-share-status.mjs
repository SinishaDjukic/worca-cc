// ui/public/runs-share-status.mjs — the status line under Settings › Run sharing (run sharing s1). Pure DOM: no fetch.
// `status` is GET /api/projects/:key/runs-share → status. The failure wording is team metrics' own (pushFailLabel, D23).
import { pushFailLabel } from './team-metrics-surfaces.mjs';
import { formatWhen } from './memory-view.mjs';

/** @returns {HTMLElement} a `small.hint.runs-share-status[data-kind]` (ok | error | none) */
export function renderRunsShareStatus(doc, status) {
  const el = doc.createElement('small');
  el.className = 'hint runs-share-status';
  const s = status || {};
  if (s.lastErrorCode) {
    el.dataset.kind = 'error';
    const head = doc.createElement('b');
    head.textContent = pushFailLabel({ lastErrorCode: s.lastErrorCode, hint: s.hint });
    const detail = s.hint ? `To fix: ${s.hint}` : String(s.lastError || '').trim().split('\n')[0];
    el.append(head);
    if (detail) el.append(' · ', detail);
  } else if (s.lastPushAt) {
    el.dataset.kind = 'ok';
    el.textContent = `Branch ${s.branch || 'worca-runs'} · last push ${formatWhen(s.lastPushAt) || String(s.lastPushAt)}`;
  } else {
    el.dataset.kind = 'none';
    el.textContent = 'Not pushed yet';
  }
  return el;
}
