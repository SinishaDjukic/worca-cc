// ui/public/shape/run-agents.mjs — Shaper small runs C2 (D14): the run panel's Agents section, shared by the side
// panel and the live run page. One `.srows` list of check rows (buildCheckRows) under the Overview's section head,
// painted from the run's snapshot by the one word source (src/shared/shape/run-agents.mjs). A run without a Care plan
// has no section.
import { runAgentRows, agentDetail } from '../../../src/shared/shape/run-agents.mjs';
import { buildCheckRows } from './check-row.mjs';

const el = (doc, tag, cls, text) => { const e = doc.createElement(tag); e.className = cls; if (text != null) e.textContent = text; return e; };

/** Paints (or removes) the Agents section inside `host`. Idempotent: a repaint updates the same element. D2 (D13):
 *  `stored` (the `/slice` answer's stored facts) puts a done row's detail in place of the word `done` (✓ says done). */
export function mountRunAgents(host, snap, { stored } = {}) {
  if (!host) return null;
  const doc = host.ownerDocument;
  let box = host.querySelector(':scope > .run-agents');
  const rows = runAgentRows(snap);
  if (!rows.length) { if (box) box.remove(); return null; }
  if (!box) {
    box = el(doc, 'div', 'plan-body srows run-agents');
    box.append(el(doc, 'h3', 'shape-cl-title', 'Agents'), el(doc, 'p', 'shape-cl-caption', ''), el(doc, 'div', 'plan-checks'));
    host.append(box);
  }
  box.querySelector('.shape-cl-caption').textContent = `${rows.length} · no agent approves its own work`;
  box.querySelector('.plan-checks').replaceChildren(...buildCheckRows(doc, { items: rows.map((r) => ({
    pass: r.word === 'done', mark: r.mark, label: r.name, note: (r.word === 'done' && agentDetail(r, stored)) || r.word, ariaLabel: r.word, textWrap: true,
  })) }));
  return box;
}
