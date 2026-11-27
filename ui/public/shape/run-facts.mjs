// ui/public/shape/run-facts.mjs — Shaper small runs D2 (D10): a run's "Starts from" fact, its "Waits for" and
// "Needed by" facts (slice 11, the `/slice` answer's `links`) and its "Owns" rows, one box
// shared by the live run page, the saved run page and (through the re-hosted screens) the chat run panel. Painted from
// the `/slice` answer of a marked feature with the flag on (`owns` in it; src/core/shape/features.mjs sliceOfPipeline).
// The fact row is outline-body.mjs runItem's `.rd-kv` row; the Owns rows map a requirement as requirements-body.mjs does.
// The run's number and the feature title are not repeated: the head's kind chip says them.
import { buildCheckRows } from './check-row.mjs';

const el = (doc, tag, cls, text) => { const e = doc.createElement(tag); e.className = cls; if (text != null) e.textContent = text; return e; };

/** The "Starts from" value: the words, a named branch in mono. */
function startsValue(doc, s) {
  const dd = el(doc, 'dd', 'rd-kv-v');
  if (s.kind === 'branch' && s.branch) dd.append('the branch ', el(doc, 'span', 'mono', s.branch));
  else dd.textContent = s.text;
  return dd;
}

/** An Owns row: ✓ met, ✕ unmet, the waiting dot before a review; the id in its column, the text on one line, the full
 *  text in the row's tooltip. */
const ownRow = (o) => ({ id: o.id, idCol: true, label: o.text, pass: o.pass === true, tip: `${o.id} · ${o.text}`,
  // Small runs D3 (D4): the feature's one status word (src/shared/shape/req-status.mjs, via /slice `owns[].word`).
  ...(o.word ? { note: o.word, mark: o.mark, ariaLabel: o.word } : o.pass == null ? { mark: 'wait', ariaLabel: 'waiting' } : {}) });

/**
 * Paints `host`'s facts box from `info` (the `/slice` answer). Idempotent: a repaint updates the same box. Info null,
 * or without `owns` (flag off, an unmarked feature): the host is hidden and emptied. `startsFrom: null` (an old row
 * with no stored source) leaves out only the starts row; no `links` adds no link rows; a run that owns no ids has no
 * Owns list.
 * @returns {HTMLElement|null} the box
 */
export function mountRunFacts(host, info) {
  if (!host) return null;
  if (!info || !Array.isArray(info.owns)) { host.replaceChildren(); host.hidden = true; return null; }
  const doc = host.ownerDocument;
  let box = host.querySelector(':scope > .run-facts');
  if (!box) { box = el(doc, 'div', 'plan-body srows run-facts'); host.replaceChildren(box); }
  const parts = [];
  const rows = [];
  const fact = (key, label, dd) => { const row = el(doc, 'div', 'rd-kv-row'); row.dataset.fact = key; row.append(el(doc, 'dt', 'rd-kv-k', label), dd); rows.push(row); };
  if (info.startsFrom) fact('starts', 'Starts from', startsValue(doc, info.startsFrom));
  // Slice 11 (D8): Waits for is left out when the run waits for nothing; Needed by reads "nothing" when no run builds on it.
  const links = info.links && typeof info.links === 'object' ? info.links : null;
  if (links) {
    const waits = Array.isArray(links.waitsFor) ? links.waitsFor : [];
    const needed = Array.isArray(links.neededBy) ? links.neededBy : [];
    if (waits.length) fact('waits', 'Waits for', el(doc, 'dd', 'rd-kv-v', waits.join(', ')));
    fact('needed', 'Needed by', el(doc, 'dd', 'rd-kv-v', needed.length ? needed.join(', ') : 'nothing'));
  }
  if (rows.length) {
    const kv = el(doc, 'dl', 'rd-kv');
    kv.append(...rows);
    parts.push(kv);
  }
  if (info.owns.length) {
    const list = el(doc, 'div', 'plan-checks');
    list.append(...buildCheckRows(doc, { items: info.owns.map(ownRow) }));
    parts.push(el(doc, 'h3', 'shape-cl-title', 'Owns'), list);
  }
  box.replaceChildren(...parts);
  host.hidden = false;
  return box;
}
