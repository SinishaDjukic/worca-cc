// ui/public/shape/proposal.mjs — the run card's Shape it first parts (spec §3.2): perspective chips on a shaped card;
// the nudge (open decisions, both choices with estimates) on a nudged one. null when the card has neither.
import { buildPerspectiveChips } from './chips.mjs';
import { SHAPE_ATTENTION } from './plan-text.mjs';
import { chipsHiddenFor, PERSPECTIVES } from '../../../src/shared/shape/perspectives.mjs';
import { ANSWERER_LEAD_KEYS } from '../../../src/shared/answerer.mjs';
import { flagOn } from '../flags.mjs';
import { loadAnswerer, saveAnswerer, leadLabel } from '../answerer.mjs';
import { notify } from '../feedback.mjs';
import { toggleMenu } from '../workflows/menu.mjs';
import { iconSvg } from '../icons.mjs';
import { sentencePicker } from '../design-system/components/settings-row.mjs';
import { toElement } from '../design-system/components/html.mjs';

const usd = (n) => `$${Number(n || 0).toFixed(2)}`;
/** One choice's estimate, planning and build apart (D28); the history-only medians, or "no estimate yet". A card stored
 *  before the split (no planningUsd) keeps its single figure rather than reading "Planning ≈ $0.00". */
const money = (e) => (!e ? 'no estimate yet'
  : typeof e.planningUsd === 'number' ? `Planning ≈ ${usd(e.planningUsd)} + build ≈ ${usd(e.buildUsd)} · ~${e.minutes} min`
    : `≈ ${usd(e.costUsd)} · ~${e.minutes} min`);

/** The flag-on facts line: `Large task · ≈ $31 · ~84 min` (the shaped choice's estimate), or `no estimate yet`. */
function factsLine(n) {
  const e = n.estimates && n.estimates.shaped;
  const task = n.size ? `${n.size[0].toUpperCase()}${n.size.slice(1)} task` : 'This task';
  return `${task} · ${e ? `≈ $${Math.round(e.costUsd)} · ~${e.minutes} min` : 'no estimate yet'}`;
}
const bodyOf = (card, perspectives, extra = {}) => ({ workflowId: 'wf_shape', shape: {
  ...extra, perspectives,
  ...(card.shape && card.shape.slices ? { slices: card.shape.slices } : {}),
  ...((card.shape && card.shape.size) || (card.nudge && card.nudge.size) ? { size: (card.shape && card.shape.size) || card.nudge.size } : {}),
} });

let leadSeq = 0;
const noop = () => {};

/** shapeRequirements on, a nudged card: the facts line, then (medium or large) "You lead as [lead ▾], supported by
 *  [supporters ▾]." — SentencePicker triggers, each opening the live CompactMenu (toggleMenu). Small: the facts line and
 *  today's chips. `blocked()` is true until a lead is picked; `commit()` saves a lead the profile does not hold. */
function requirementsCard(doc, card, h, fetchFn) {
  const n = card.nudge;
  const el = h('div', 'shape-card');
  el.appendChild(h('div', 'shape-nudge-head shape-facts', factsLine(n)));
  const picked = n.perspectives;
  const hidden = chipsHiddenFor(picked);
  if (n.size !== 'medium' && n.size !== 'large') {
    const chips = buildPerspectiveChips(doc, { picked, hidden, collapsed: true });
    el.appendChild(chips.el);
    return { el, requirements: false, blocked: () => false, commit: noop, body: () => bodyOf(card, chips.value()) };
  }

  const offered = PERSPECTIVES.filter((p) => !hidden.includes(p.key)).map((p) => p.key);
  const supporters = new Set(picked.filter((k) => k !== 'product' && offered.includes(k)));
  let lead = null;          // the pick
  let saved = null;         // the profile's lead
  let leadBtn = null;
  let suppBtn = null;
  const labelId = `shape-lead-label-${++leadSeq}`;
  const emit = () => el.dispatchEvent(new doc.defaultView.CustomEvent('shape-lead-change'));
  const setText = (btn, text) => { btn.firstChild.textContent = text; };
  const supportersText = () => {
    const names = offered.filter((k) => supporters.has(k) && k !== lead).map(leadLabel);
    if (!names.length) return 'no one else';
    return names.length === 1 ? names[0] : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
  };
  const paint = () => { setText(leadBtn, lead ? leadLabel(lead) : 'pick a role'); setText(suppBtn, supportersText()); };
  const picker = (id, text, tip) => toElement(doc, sentencePicker({ id, text, items: [], tip, chevron: iconSvg('chevron-down', 12) })).querySelector('.spick-b');
  const wrap = (btn) => btn.closest('.spick');

  function paintSentence() {
    leadBtn = picker('shape-lead', 'pick a role', 'The role that leads the requirements');
    suppBtn = picker('shape-supporters', 'no one else', 'The roles that support the lead');
    leadBtn.addEventListener('click', () => toggleMenu({ doc, anchor: leadBtn, label: 'You lead as', items: ANSWERER_LEAD_KEYS.map((k) => ({
      label: leadLabel(k), checked: k === lead, ...(k === saved ? { hint: 'you, last time' } : {}),
      onSelect: () => { lead = k; paint(); emit(); },
    })) }));
    suppBtn.addEventListener('click', () => toggleMenu({ doc, anchor: suppBtn, label: 'Supported by', items: offered
      .filter((k) => k !== 'product' && k !== lead).map((k) => ({
        switch: true, label: leadLabel(k), checked: supporters.has(k),
        onToggle: (b) => {
          if (supporters.has(k)) supporters.delete(k); else supporters.add(k);
          b.setAttribute('aria-checked', String(supporters.has(k)));
          paint();
        },
      })) }));
    const line = h('div', 'shape-lead-line');
    const who = h('span', 'shape-lead-label', 'You lead as');
    who.id = labelId;
    line.append(who, ' ', wrap(leadBtn), ', supported by ', wrap(suppBtn), '.');
    paint();
    el.appendChild(line);
    emit();
  }
  loadAnswerer(fetchFn).then((p) => { saved = p.lead; lead = p.lead; paintSentence(); });

  return {
    el, requirements: true, labelId,
    blocked: () => lead == null,
    commit() {
      if (!lead || lead === saved) return;
      const chosen = lead;
      saveAnswerer(chosen, fetchFn).then(() => { saved = chosen; },
        () => notify({ tone: 'err', title: 'Could not save your lead role. It is used for this run only.' }, { doc }));
    },
    body: () => bodyOf(card, offered.filter((k) => k === 'product' || k === lead || (supporters.has(k) && k !== lead)),
      lead ? { lead } : {}),
  };
}

/** `opts.fetch`: the host's fetch for the answerer profile (default: the page's). */
export function shapeCardExtras(doc, card, { fetch: fetchFn } = {}) {
  if (!card || (!card.shape && !card.nudge)) return null;
  const h = (tag, cls, text) => { const e = doc.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
  if (card.nudge && !card.shape && flagOn('shapeRequirements', doc)) return requirementsCard(doc, card, h, fetchFn);
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
    el, requirements: false, blocked: () => false, commit: noop,
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
