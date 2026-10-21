// ui/public/shape/feature-view.mjs — Shaper s3: the feature's head-less view for the Plans tab and the group page's
// Overview tab. The run model (run-status-card.mjs) owns the head, status line, bars and members on the group page;
// this view adds the re-planned note, the open step (deps.mountAsk), the step log, the Ship card (s4) and the controls
// (feature-actions.mjs). featureHeadline stays for the Plans row's summary line.
import { featureCardModel, paintFeatureLog } from './feature-card.mjs';
import { paintFeatureActions } from './feature-actions.mjs';
import { renderShipCard } from './ship-card.mjs';

const range = (xs) => (xs.length === 1 ? `slice ${xs[0]}` : `slices ${xs[0]}–${xs[xs.length - 1]}`);

export function featureHeadline(f) {
  if (f.status === 'canceled') return `Canceled · ${f.done} of ${f.total} slices done`;
  if (f.status === 'replanned' || f.status === 'replanning') return 'Re-planned';
  if (f.status === 'done') return `All ${f.total} slices done`;
  if (f.halted) {
    const word = f.halted.state === 'paused' ? 'paused' : f.halted.state === 'failed' ? 'could not start'
      : f.halted.state === 'missed' || f.halted.state === 'canceled' ? 'did not start' : 'stopped';
    return `Slice ${f.halted.index} ${word}${f.halted.waiting.length ? ` · ${range(f.halted.waiting)} waiting` : ''}`;
  }
  return `${f.done} of ${f.total} slices done`;
}

/** Run 4 (D18): the feature's card model, also for the group page's header ⋯. */
export const featureModelOf = (f, snapOf) => featureCardModel({ card: { pipelineId: f.originPipelineId || null, feature: f, log: f.log || [] }, snapOf: snapOf || (() => null) });

/** s4: the Ship card (ship-card.mjs) in place of the old Ship as block: the waiting line while runs go on, the ready
 *  card without Not now, the applied card once shipped; nothing for a canceled or re-planned feature. A failure comes
 *  back through deps.error (the foot shows it). */
function shipBlock(doc, f, deps) {
  const s = f.ship || {};
  const phase = s.mode ? 'applied' : s.ready ? 'ready' : f.status === 'active' ? 'waiting' : null;
  if (!phase) return doc.createDocumentFragment();
  const card = renderShipCard(doc, { phase, title: f.title, runs: f.total, files: s.files, added: s.linesAdded, deleted: s.linesRemoved,
    suggested: s.suggested, hint: s.hint || null, result: s.result || null }, {
    // The host repaints with deps.error on a failure (the foot shows it), as before.
    onShip: (mode, release) => Promise.resolve(deps.act('ship', { mode, ...(release ? { release } : {}) }, { focus: `ship-${mode}` })),
  });
  card.dataset.needsGit = '';   // shipping opens pull requests: hidden while git is missing (git-gate.mjs)
  return card;
}

/**
 * deps: { act(action, body, {focus}) → Promise<{ok, error?}>, confirm, openRun(ref), openPlan(controls), snapOf?(pid),
 *         pause?(target, btn), stop?(target), mountAsk?(slot, step), runsOpen?: boolean, error?: string,
 *         omit?: string[] (feature-actions keys the host's model footer already shows), inGroup?: boolean (the group page:
 *         no merge-order line and no ⋯, the page header owns both) }
 */
export function renderFeature(doc, f, deps) {
  const h = (tag, cls, text) => { const e = doc.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
  const m = featureModelOf(f, deps.snapOf);
  const el = h('section', `shape-feature${m.controls && m.controls.halted ? ' is-halted' : ''}`);
  el.dataset.feature = f.id;
  // F47: the host asked for an earlier feature; this is the one its Re-plan the rest started.
  if (f.replanOf) el.appendChild(h('div', 'shape-feature-replanned', 'Re-planned: the runs below replace the earlier outline'));
  // A slot only: the host swaps in its persistent ask element (P12), so a repaint never wipes a typed answer.
  if (m.step && deps.mountAsk) { const slot = h('div', 'shape-feature-ask'); el.appendChild(slot); deps.mountAsk(slot, m.step); }
  const log = h('ol', 'chat-rc-log shape-feature-log'); log.setAttribute('aria-label', 'Steps');
  el.appendChild(log);
  paintFeatureLog(doc, log, m.log);
  // Run 4 (D17): the group page states the merge order on its Runs tab and owns the ⋯ in its header.
  if (f.slices.length > 1 && !deps.inGroup) {
    const order = h('div', 'shape-feature-order', 'Merge in order: each run\'s branch starts from the one before.');
    order.dataset.needsGit = '';
    el.appendChild(order);
  }
  el.appendChild(shipBlock(doc, f, deps));
  const foot = h('div', 'shape-feature-actions');
  el.appendChild(foot);
  paintFeatureActions(doc, foot, m.controls, deps, { omit: deps.omit || [], menu: !deps.inGroup });
  return el;
}
