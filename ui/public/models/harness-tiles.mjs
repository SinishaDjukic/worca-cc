// ui/public/models/harness-tiles.mjs — the harness tiles (models-menu P5, DESIGN JOB-1): one tile per harness you pick
// by sight. Claude Code's tile is the big one and says "Best performance", every other harness says "Beta", each says
// Ready / Not ready, and the picked one has an ink edge and a tick disc. Pure DOM: `doc` is injected and nothing is
// fetched. Step 1 of Add model draws them, and the Jobs tab will. A caller reads the pick from aria-pressed.
import { MODEL_ENGINE_NAMES, engineLabel, isBetaEngine } from '../../../src/shared/engine-switch.mjs';
import { markTile } from './brand-marks.mjs';

const SVG_NS = 'http://www.w3.org/2000/svg';

const el = (doc, tag, cls, text) => {
  const node = doc.createElement(tag);
  if (cls) node.className = cls;
  if (text != null) node.textContent = text;
  return node;
};

/** svg.mdl-hx-check: the disc and the tick drawn together, so the tick cannot drift off centre. */
function tickDisc(doc) {
  const svg = doc.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('class', 'mdl-hx-check');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');
  const disc = doc.createElementNS(SVG_NS, 'circle');
  disc.setAttribute('cx', '12');
  disc.setAttribute('cy', '12');
  disc.setAttribute('r', '12');
  const tick = doc.createElementNS(SVG_NS, 'path');
  tick.setAttribute('d', 'M6.7 11.8l3.5 3.5 7.1-7.4');
  svg.append(disc, tick);
  return svg;
}

/** span.mdl-hx-state: '' with no tone while the engine list is unknown (no dot), else a .mdl-st word. */
function stateLine(doc, { known, ready, isDefault }) {
  if (!known) return el(doc, 'span', 'mdl-hx-state', '');
  if (!ready) return el(doc, 'span', 'mdl-hx-state mdl-st off', 'Not ready');
  return el(doc, 'span', 'mdl-hx-state mdl-st ok', isDefault ? 'Ready · Default for new runs' : 'Ready');
}

/** engines: [{ name, ready, reason }] | null (the /api/engines rows: { name, label, ready, reason, broker? }).
 *  picked, defaultEngine: engine names. locks: [{ name, reason }]. showDefault: add " · Default for new runs".
 *  → div.mdl-hx[role=group][aria-label=<label>] with one button.mdl-hx-t[data-engine][aria-pressed] per engine in
 *    MODEL_ENGINE_NAMES order: the mark (xl on Claude Code, lg elsewhere), span.mdl-hx-name (engineLabel),
 *    span.mdl-hx-state.mdl-st.ok|.off ("Ready" | "Not ready"; empty, no tone, when engines is null; an engine
 *    missing from a non-null list is not ready), span.badge.blue "Beta" on beta engines, span.badge.mdl-best
 *    "Best performance" on Claude Code, svg.mdl-hx-check on the picked one. Classes: `best` on Claude Code, `on`
 *    when picked, `off` when not ready. A locked engine is disabled with the lock's reason as title (a lock wins);
 *    a not-ready engine stays pickable (L10) with its reason as title. Clicking an enabled tile moves `on`,
 *    aria-pressed and the tick to it; a click on a locked tile does nothing (a synthetic click fires on a disabled
 *    button too). A locked `picked` is never pressed: the first unlocked tile is (Claude Code, which the broker never
 *    locks), so a caller reading aria-pressed never gets a harness this instance will not start. */
export function renderHarnessTiles(doc, { engines = null, picked = 'claude', defaultEngine = 'claude', locks = [], showDefault = false, label = 'Harness' } = {}) {
  const group = el(doc, 'div', 'mdl-hx');
  group.setAttribute('role', 'group');
  group.setAttribute('aria-label', label);
  const known = Array.isArray(engines);
  const rows = new Map(known ? engines.filter((r) => r && r.name).map((r) => [r.name, r]) : []);
  const lockOf = new Map((Array.isArray(locks) ? locks : []).filter((l) => l && l.name).map((l) => [l.name, l]));
  const check = tickDisc(doc);

  const pick = (tile) => {
    for (const t of group.querySelectorAll('.mdl-hx-t')) {
      const on = t === tile;
      t.classList.toggle('on', on);
      t.setAttribute('aria-pressed', String(on));
    }
    tile.append(check);
  };

  for (const name of MODEL_ENGINE_NAMES) {
    const best = name === 'claude';
    const row = rows.get(name);
    const ready = known && !!row?.ready;
    const tile = el(doc, 'button', 'mdl-hx-t');
    tile.type = 'button';
    tile.dataset.engine = name;
    tile.setAttribute('aria-pressed', 'false');
    if (best) tile.classList.add('best');
    if (known && !ready) tile.classList.add('off');
    tile.append(
      markTile(doc, { kind: 'harness', key: name, size: best ? 'xl' : 'lg' }),
      el(doc, 'span', 'mdl-hx-name', engineLabel(name)),
      stateLine(doc, { known, ready, isDefault: showDefault && name === defaultEngine }),
    );
    if (isBetaEngine(name)) tile.append(el(doc, 'span', 'badge blue', 'Beta'));
    if (best) tile.append(el(doc, 'span', 'badge mdl-best', 'Best performance'));
    const lock = lockOf.get(name);
    if (lock) {
      tile.disabled = true;
      if (lock.reason) tile.title = lock.reason;
    } else if (known && !ready && row?.reason) {
      tile.title = row.reason;
    }
    tile.addEventListener('click', () => { if (!tile.disabled) pick(tile); });
    group.append(tile);
  }
  const all = [...group.children];
  const want = all.find((t) => t.dataset.engine === picked);
  const first = want && want.disabled ? all.find((t) => !t.disabled) : want;
  if (first) pick(first);
  return group;
}
