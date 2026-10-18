// ui/public/shape/feature-view.mjs — Shaper s3: the one feature card for the Plans tab (Runs folded) and the group page
// (Runs open, the open step mounted). The same parts as the Chat feature card, from featureCardModel: head, status line,
// group bar, open step, step log, Runs, Ship as, and the controls (feature-actions.mjs). featureHeadline stays for the
// Plans row's summary line.
import { featureCardModel, paintFeatureLog, paintFeatureMembers } from './feature-card.mjs';
import { paintFeatureActions } from './feature-actions.mjs';
import { renderRowIcon } from '../runs-list.mjs';
import { paintChainBar } from '../run-progress-bar.mjs';

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

const modelOf = (f, snapOf) => featureCardModel({ card: { pipelineId: f.originPipelineId || null, feature: f, log: f.log || [] }, snapOf: snapOf || (() => null) });

function paintHead(doc, el, m) {
  const ic = el.querySelector('.shape-feature-head > .runs-ic');
  ic.className = `runs-ic runs-ic-${m.icon}`;
  ic.replaceChildren(renderRowIcon(doc, m.icon));
  el.querySelector('.shape-feature-chip').textContent = m.chip || '';
  el.querySelector('.shape-feature-status').textContent = m.status || '';
  paintChainBar(el.querySelector('.shape-feature-chain'), m.group);
}

/** The Ship as / Shipped block (D24); empty until every run is done. A failure comes back through deps.error. */
function shipBlock(doc, h, f, deps) {
  const frag = doc.createDocumentFragment();
  const btn = (cls, text, act) => { const b = h('button', `btn ${cls}`, text); b.type = 'button'; b.dataset.act = act; return b; };
  if (f.ship && f.ship.mode) {
    const done = h('div', 'shape-feature-shipped', f.ship.mode === 'one' ? 'Shipped as one PR' : 'Shipped as stacked PRs');
    if (f.ship.prUrl) { const a = h('a', null, ' · open it'); a.href = f.ship.prUrl; a.target = '_blank'; a.rel = 'noopener'; done.appendChild(a); }
    frag.appendChild(done);
  } else if (f.ship && f.ship.ready) {
    const box = h('div', 'shape-feature-ship');
    box.appendChild(h('div', 'shape-feature-ship-head', 'Ship as'));
    for (const [mode, label] of [['stacked', 'Stacked PRs'], ['one', 'One PR']]) {
      const b = btn(`shape-feature-ship-${mode}${f.ship.suggested === mode ? ' btn-primary' : ''}`,
        f.ship.suggested === mode ? `${label} (suggested)` : label, `shape-feature-ship-${mode}`);
      // F39: name the control before disabling it; the host repaints with deps.error on a failure.
      b.addEventListener('click', async () => {
        const focus = b.dataset.act;
        b.disabled = true;
        await Promise.resolve().then(() => deps.act('ship', { mode }, { focus })).catch(() => null);
        if (b.isConnected) b.disabled = false;
      });
      box.appendChild(b);
    }
    if (f.ship.suggested) {
      box.appendChild(h('div', 'shape-feature-ship-why', f.ship.suggested === 'one'
        ? `This feature adds ${f.ship.linesAdded} lines: one PR is easier to review.`
        : `This feature adds ${f.ship.linesAdded} lines: stacked PRs keep each review small.`));
    }
    frag.appendChild(box);
  }
  return frag;
}

/**
 * deps: { act(action, body, {focus}) → Promise<{ok, error?}>, confirm, openRun(ref), openPlan(controls), snapOf?(pid),
 *         pause?(target, btn), stop?(target), mountAsk?(slot, step), runsOpen?: boolean, error?: string }
 */
export function renderFeature(doc, f, deps) {
  const h = (tag, cls, text) => { const e = doc.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
  const m = modelOf(f, deps.snapOf);
  const el = h('section', `shape-feature${m.controls && m.controls.halted ? ' is-halted' : ''}`);
  el.dataset.feature = f.id;
  const head = h('div', 'shape-feature-head');
  head.append(h('span', 'runs-ic'), h('span', 'shape-feature-chip'), h('span', 'shape-feature-title', f.title));
  el.appendChild(head);
  // F47: the host asked for an earlier feature; this is the one its Re-plan the rest started.
  if (f.replanOf) el.appendChild(h('div', 'shape-feature-replanned', 'Re-planned: the runs below replace the earlier outline'));
  const status = h('div', 'shape-feature-status'); status.setAttribute('role', 'status');
  el.append(status, h('div', 'run-chain shape-feature-chain'));
  paintHead(doc, el, m);
  // A slot only: the host swaps in its persistent ask element (P12), so a repaint never wipes a typed answer.
  if (m.step && deps.mountAsk) { const slot = h('div', 'shape-feature-ask'); el.appendChild(slot); deps.mountAsk(slot, m.step); }
  const log = h('ol', 'chat-rc-log shape-feature-log'); log.setAttribute('aria-label', 'Steps');
  el.appendChild(log);
  paintFeatureLog(doc, log, m.log);
  const runs = h('details', 'shape-feature-runs');
  runs.open = !!deps.runsOpen;
  runs.appendChild(h('summary', 'shape-feature-runs-tab', `Runs · ${m.members.length}`));
  const ol = h('ol', 'chat-rc-members'); ol.setAttribute('aria-label', 'Runs');
  runs.appendChild(ol);
  el.appendChild(runs);
  paintFeatureMembers(doc, ol, m.members, { open: (row) => deps.openRun(row) });
  if (f.slices.length > 1) el.appendChild(h('div', 'shape-feature-order', 'Merge in order: each run\'s branch starts from the one before.'));
  el.appendChild(shipBlock(doc, h, f, deps));
  const foot = h('div', 'shape-feature-actions');
  el.appendChild(foot);
  paintFeatureActions(doc, foot, m.controls, deps);
  return el;
}

/** D14: a run frame on the group page moves the chip, icon, status line and group bar, without a fetch or a rebuild. */
export function refreshFeatureStatus(el, f, snapOf) {
  if (el && f) paintHead(el.ownerDocument, el, modelOf(f, snapOf));
}
