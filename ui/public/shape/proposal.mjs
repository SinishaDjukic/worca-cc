// ui/public/shape/proposal.mjs — the run card's Shape it first parts (spec §3.2): perspective chips on a shaped card;
// the nudge (open decisions, both choices with estimates) on a nudged one. null when the card has neither.
import { buildPerspectiveChips } from './chips.mjs';
import { SHAPE_ATTENTION } from './plan-text.mjs';
import { chipsHiddenFor } from '../../../src/shared/shape/perspectives.mjs';

const usd = (n) => `$${Number(n || 0).toFixed(2)}`;
/** One choice's estimate, planning and build apart (D28); the history-only medians, or "no estimate yet". A card stored
 *  before the split (no planningUsd) keeps its single figure rather than reading "Planning ≈ $0.00". */
const money = (e) => (!e ? 'no estimate yet'
  : typeof e.planningUsd === 'number' ? `Planning ≈ ${usd(e.planningUsd)} + build ≈ ${usd(e.buildUsd)} · ~${e.minutes} min`
    : `≈ ${usd(e.costUsd)} · ~${e.minutes} min`);

export function shapeCardExtras(doc, card) {
  if (!card || (!card.shape && !card.nudge)) return null;
  const h = (tag, cls, text) => { const e = doc.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
  const el = h('div', 'shape-card');
  const picked = card.shape ? card.shape.perspectives : card.nudge.perspectives;
  // UX picks wf_shape_ux at start; the server re-derives it (resolveShapeRequest), so every chip is free here.
  const chips = buildPerspectiveChips(doc, { picked, hidden: chipsHiddenFor(picked), collapsed: true });
  if (card.nudge) {
    const n = card.nudge;
    if (n.openDecisions.length) {
      el.appendChild(h('div', 'shape-nudge-head', `This task leaves ${n.openDecisions.length} decision${n.openDecisions.length === 1 ? '' : 's'} open`));
      const ul = h('ul', 'shape-nudge-list');
      for (const d of n.openDecisions) ul.appendChild(h('li', null, d));
      el.appendChild(ul);
    } else {
      el.appendChild(h('div', 'shape-nudge-head', 'This is a large task'));
    }
    const est = n.estimates || {};
    const choices = h('div', 'shape-choices');
    const asIs = h('div', 'shape-choice');
    asIs.append(h('b', null, 'Run as is'), h('span', null, 'The run decides these itself and may stop to ask you mid-run.'),
      h('span', 'shape-est', n.asIsAuto ? 'Auto picks the workflow at start' : money(est.asIs)));
    const shaped = h('div', 'shape-choice primary');
    shaped.append(h('b', null, 'Shaper'),
      h('span', null, 'Up to 3 questions now, then a plan you approve before anything is built.'),
      h('span', 'shape-est', `${money(est.shaped)} · ${SHAPE_ATTENTION}`));
    choices.append(asIs, shaped);
    el.appendChild(choices);
  }
  el.appendChild(chips.el);
  return {
    el,
    /** The POST /api/run fields of a shaped start: the server picks wf_shape or wf_shape_ux from the perspectives. */
    body: () => ({ workflowId: 'wf_shape', shape: {
      perspectives: chips.value(),
      ...(card.shape && card.shape.slices ? { slices: card.shape.slices } : {}),
      ...((card.shape && card.shape.size) || (card.nudge && card.nudge.size) ? { size: (card.shape && card.shape.size) || card.nudge.size } : {}),
    } }),
  };
}

/** The shaped card's one line on what happens next (D20). `likelySlices` is filled from slice 4 (#730) on. */
export function shapeWhatHappens(shape) {
  const n = shape && Number.isInteger(shape.likelySlices) && shape.likelySlices > 1 ? shape.likelySlices : 0;
  return `Up to 3 questions, then a plan you approve.${n ? ` Likely ${n} slices, one PR each.` : ''}`;
}

/** The collapsed Advanced's summary on a shaped card (D20): what it holds, at a glance. */
export function shapeAdvancedSummary({ engine = '', guardrails = '', agents = 0, overrides = 0 } = {}) {
  const parts = ['Advanced'];
  if (engine) parts.push(engine);
  if (guardrails) parts.push(`${guardrails} guardrails`);
  if (agents) {
    const a = `${agents} agent${agents === 1 ? '' : 's'}`;
    parts.push(overrides ? `${a}, ${overrides} changed from workflow defaults` : `${a} on workflow defaults`);
  }
  return parts.join(' · ');
}
