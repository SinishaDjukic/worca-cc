// ui/public/shape/slice-line.mjs — the slice line on a run page (D16, D22): which feature a run belongs to and, once
// it is done, which slice comes next. Pure copy; app.js paints it.
import { SLICE_STATE_LABELS } from './feature-card.mjs';

/** @returns {{text:string, href:string, openFeature:boolean}|null} */
export function sliceLineCopy(info, { done = false } = {}) {
  if (!info || !info.featureId) return null;
  const href = `#feature/${encodeURIComponent(info.featureId)}`;
  if (done) {
    const next = info.next ? ` · next: ${info.next.title} (${(SLICE_STATE_LABELS[info.next.state] || info.next.state || '').toLowerCase()})` : '';
    return { text: `Slice ${info.index} of ${info.total}${next}`, href, openFeature: true };
  }
  return { text: `Part of ${info.title} · slice ${info.index} of ${info.total} →`, href, openFeature: false };
}
