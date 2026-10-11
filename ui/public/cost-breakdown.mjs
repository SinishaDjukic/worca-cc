// ui/public/cost-breakdown.mjs — the run cost breakdown (the header cost's panel, the glance and Overview note).
// DOM builders only; the numbers come from src/shared/cost/breakdown.mjs (runCostBreakdown).
import { fmtAuxCalls, floorText } from '../../src/shared/cost/breakdown.mjs';

const awayLine = (b) => (b && Array.isArray(b.lines) ? b.lines.find((l) => l.kind === 'away') : null) || null;
/** A lower bound's value cell: `≥$x`; '' for a {free} model or under a cent (the note's count says it);
 *  'not priced' when the model had no list price. */
const floorValue = (floorUsd, fmtUsd) => (floorUsd == null ? 'not priced' : floorText(floorUsd, fmtUsd));

/** The glance tile's and the Overview cost card's note: "incl. $0.12 Away mode", or '' when no
 *  review was booked (a stopped review's lower bound is never "included"). */
export function costSummaryText(b, fmtUsd) {
  const away = awayLine(b);
  return away && away.calls > 0 ? `incl. ${fmtUsd(away.usd)} Away mode` : '';
}

/** The "Answered for you" heading's cost: what the booked reviews cost (a review booked after the
 *  user answered first included), else the stopped reviews' lower bound — apart, "not in total" —
 *  else ''. From the steps, never from the records: a review that answered nothing has no record. */
export function awayTotalText(b, fmtUsd) {
  const away = awayLine(b);
  if (!away) return '';
  if (away.calls > 0) return fmtUsd(away.usd);
  const floor = floorText(away.floorUsd, fmtUsd);
  return floor ? `${floor} · not in total` : '';
}

/** Rows: Agents, one per booked aux line (with its call count), a hairline, Total, then — apart and
 *  never summed — the reviews stopped before their result and the agent turns a pause, stop or crash
 *  cut off, each as a lower bound. `agentsUnknown`: the run's engine reports no cost (Cursor) — the Agents row reads
 *  "cost unknown" and the Total is worca's own calls only, never a $0.00 for the agents. */
export function costBreakdownEl(doc, b, { fmtUsd, agentsUnknown = false }) {
  const box = doc.createElement('div');
  box.className = 'cost-bd';
  const row = (cls, kind, label, value, note) => {
    const r = doc.createElement('div');
    r.className = `cost-bd-row${cls ? ` ${cls}` : ''}`;
    r.dataset.kind = kind;
    const l = doc.createElement('span'); l.className = 'cost-bd-l'; l.textContent = label;
    const v = doc.createElement('span'); v.className = 'cost-bd-v'; v.textContent = value;
    r.append(l, v);
    if (note) { const n = doc.createElement('span'); n.className = 'cost-bd-n'; n.textContent = note; r.appendChild(n); }
    box.appendChild(r);
  };
  row('', 'agents', 'Agents', agentsUnknown ? 'cost unknown' : fmtUsd(b.agents), '');
  for (const l of b.lines) {
    if (l.calls > 0 || l.usd > 0) row('', l.kind, l.label, fmtUsd(l.usd), fmtAuxCalls(l.kind, l.calls));
  }
  const hr = doc.createElement('hr');
  hr.className = 'cost-bd-hr';
  box.appendChild(hr);
  row('cost-bd-total', 'total', agentsUnknown ? "Total (worca's own calls)" : 'Total', fmtUsd(b.total), '');
  const away = awayLine(b);
  if (away && (away.stopped > 0 || away.floorUsd > 0)) {
    row('cost-bd-floor', 'stopped', 'Stopped reviews', floorValue(away.floorUsd, fmtUsd), `${fmtAuxCalls('away', away.stopped)} · not in total`);
  }
  const cut = b.cut || { turns: 0, floorUsd: null };
  if (cut.turns > 0) {
    row('cost-bd-floor', 'cut', 'Stopped agent turns', floorValue(cut.floorUsd, fmtUsd), `${cut.turns} turn${cut.turns === 1 ? '' : 's'} · not in total`);
  }
  return box;
}
