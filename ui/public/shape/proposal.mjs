// ui/public/shape/proposal.mjs — the run card's Shape it first parts (spec §3.2): perspective chips on a shaped card;
// the nudge (open decisions, both choices with estimates) on a nudged one; the facts line and the
// lead sentence on either. null when the card has neither.
import { buildPerspectiveChips } from './chips.mjs';
import { chipsHiddenFor, perspectivesFor } from '../../../src/shared/shape/perspectives.mjs';
import { shapeRequirementsEligible } from '../../../src/shared/shape/requirements.mjs';
import { answererLeadKeys } from '../../../src/shared/answerer.mjs';
import { flagOn } from '../flags.mjs';
import { loadAnswerer, saveAnswerer, leadLabel } from '../answerer.mjs';
import { notify } from '../feedback.mjs';
import { toggleMenu } from '../workflows/menu.mjs';
import { icon } from '../icons.mjs';
import { segmented } from '../ask/widgets-input.mjs';
import { buildFacts, factRow, setFactText, syncFacts } from '../run-page-head.mjs';
import { fold, buildCheckFold } from './check-row.mjs';
import { stepHead, stepSender, errLine, ownButton } from './step-card.mjs';
import { CARE_LABELS, CARE_POSITIONS, CARE_TABLE, careCell, careGivesUp, careGivesUpSentence } from '../../../src/shared/shape/feature-record.mjs';

/** The facts line: `Large task · ≈ $31 · ~84 min` (the shaped choice's estimate), or `no estimate yet`. */
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

/** A shaped or nudged card: the facts line, then (a run the server gives the requirements stage)
 *  "You lead as [lead ▾], supported by [supporters ▾]." — quiet ▾ buttons, each opening the menu (toggleMenu).
 *  Otherwise the facts line and today's chips, `chipsEl` for a host that places them apart. `blocked()` is
 *  true until a lead is picked; `commit()` saves a lead the profile does not hold. */
function requirementsCard(doc, card, h, fetchFn) {
  const n = card.shape || card.nudge;
  const el = h('div', 'shape-card');
  el.appendChild(h('div', 'shape-nudge-head shape-facts', factsLine(n)));
  const picked = n.perspectives;
  const hidden = chipsHiddenFor(picked);
  // Small runs B3 (D21, D22): the live flag offers Compliance as a chip and as a lead (no run exists yet).
  const smallRuns = flagOn('shaperSmallRuns', doc);
  if (!shapeRequirementsEligible(n)) {
    const chips = buildPerspectiveChips(doc, { picked, hidden, collapsed: true, smallRuns });
    el.appendChild(chips.el);
    return { el, chipsEl: chips.el, requirements: false, blocked: () => false, commit: noop, body: () => bodyOf(card, chips.value()) };
  }

  const offered = perspectivesFor({ smallRuns }).filter((p) => !hidden.includes(p.key)).map((p) => p.key);
  const supporters = new Set(picked.filter((k) => k !== 'product' && offered.includes(k)));
  let lead = null;          // the pick
  let saved = null;         // the profile's lead
  let saving = null;        // the lead whose PUT is in flight
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
  const picker = (id, text, tip) => {
    const b = h('button', 'btn btn-sm btn-quiet shape-lead-pick', text);
    b.type = 'button';
    b.title = tip;
    b.dataset.menu = id;
    b.dataset.key = `pick:${id}`;
    b.setAttribute('aria-haspopup', 'menu');
    b.setAttribute('aria-expanded', 'false');
    b.appendChild(icon(doc, 'chevron-down', 12));
    return b;
  };

  function paintSentence() {
    leadBtn = picker('shape-lead', 'pick a role', 'The role that leads the requirements');
    suppBtn = picker('shape-supporters', 'no one else', 'The roles that support the lead');
    leadBtn.addEventListener('click', () => toggleMenu({ doc, anchor: leadBtn, label: 'You lead as', items: answererLeadKeys({ smallRuns }).map((k) => ({
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
    line.append(who, ' ', leadBtn, ', supported by ', suppBtn, '.');
    paint();
    el.appendChild(line);
    emit();
  }
  loadAnswerer(fetchFn).then((p) => { saved = p.lead; lead = p.lead; paintSentence(); });

  return {
    el, requirements: true, labelId,
    blocked: () => lead == null,
    commit() {
      if (!lead || lead === saved || lead === saving) return;
      const chosen = lead;
      saving = chosen;
      const settle = () => { if (saving === chosen) saving = null; };
      saveAnswerer(chosen, fetchFn).then(() => { settle(); saved = chosen; },
        () => { settle(); notify({ tone: 'err', title: 'Could not save your lead role. It is used for this run only.' }, { doc }); });
    },
    body: () => bodyOf(card, offered.filter((k) => k === 'product' || k === lead || (supporters.has(k) && k !== lead)),
      lead ? { lead } : {}),
  };
}

/** `opts.fetch`: the host's fetch for the answerer profile (default: the page's). */
export function shapeCardExtras(doc, card, { fetch: fetchFn } = {}) {
  if (!card || (!card.shape && !card.nudge)) return null;
  const h = (tag, cls, text) => { const e = doc.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
  return requirementsCard(doc, card, h, fetchFn);
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

// ---- Shaper small runs B2: the Start step's body (the one card's `.chat-rc-q`, ask kind `care`) ----
const CARE_ROWS = [['size', 'Size'], ['care', 'Care'], ['does', 'Does'], ['estimate', 'Estimate'], ['gives', 'Gives up'], ['history', 'History'], ['models', 'Models']];
const CARE_EVERY = 'In every position: every requirement is owned by one run or confirmed by a person; no agent approves its own work.';
const NOT_ENOUGH = 'not enough history yet';
const capOf = (doc, text) => { const c = doc.createElement('div'); c.className = 'cap'; c.textContent = text; return c; };
const lineOf = (doc, text) => { const d = doc.createElement('div'); d.textContent = text; return d; };
/** `.rd-kv-v` is one flex line: a value of several lines goes in one block child, so its lines stack. */
const stackOf = (doc, nodes) => { const d = doc.createElement('div'); d.append(...nodes); return d; };
const usd = (n) => (n < 10 ? n.toFixed(2) : String(Math.round(n)));
let careSeq = 0;

/**
 * The Start step (B2): the size, the Care dial preselected on Worca's pick with its reason, what the selected position
 * does, the estimates, what it gives up below the pick (one sentence, the full list in a fold), the History per
 * position, the models a person set, the "What … does" fold and one "Start requirements". `deps` = the step card's (`title`, `chip`, `submit`) plus `onPick`.
 * @returns {{el: HTMLElement, render: (panel: HTMLElement) => void, collect: () => object, setErrors: (errors: object[]) => void}}
 */
export function renderCareStart(doc, pq, deps = {}) {
  const start = (pq && pq.care) || {};
  const pick = start.pick && CARE_POSITIONS.includes(start.pick.position) ? start.pick.position : 'balanced';
  const names = start.names || {};
  const positions = start.positions || {};
  const history = start.history || {};
  let sel = pick;
  const el = doc.createElement('div');
  el.className = 'care-start';
  el.appendChild(stepHead(doc, deps.title || 'Your turn: how much care?', deps.chip || 'Start'));
  const kv = buildFacts(doc, CARE_ROWS);
  const value = (key) => factRow(kv, key).querySelector('.rd-kv-v');
  const careKey = factRow(kv, 'care').querySelector('.rd-kv-k');
  careKey.id = `care-k-${++careSeq}`;

  const facts = start.facts || {};
  value('size').textContent = start.size
    ? `${start.size[0].toUpperCase()}${start.size.slice(1)} · about ${facts.requirements} requirements` : 'Size not known yet';

  const err = errLine(doc);
  const seg = segmented({ doc, readonly: false }, CARE_POSITIONS.map((p) => ({ value: p, label: CARE_LABELS[p] })), pick,
    (p) => { sel = p; paint(); if (deps.onPick) deps.onPick(p); }, { idBase: `${careKey.id}-seg`, labelledBy: careKey.id });
  const pickBtn = seg.children[CARE_POSITIONS.indexOf(pick)];
  value('care').append(stackOf(doc, [seg, capOf(doc, start.pick && start.pick.reason ? start.pick.reason : ''), err]));

  const foldBtn = doc.createElement('button');
  foldBtn.type = 'button';
  foldBtn.className = 'btn plan-fold care-fold';
  const foldText = doc.createElement('span');
  foldText.className = 'plan-fold-text';
  const chev = doc.createElement('span');
  chev.className = 'plan-chev'; chev.textContent = '›'; chev.setAttribute('aria-hidden', 'true');
  foldBtn.append(foldText, chev);
  const region = doc.createElement('div');
  region.className = 'care-fold-body';
  region.hidden = true;
  fold(foldBtn, region);
  const tableKv = buildFacts(doc, CARE_TABLE.map((r) => [r.key, r.label]));
  region.append(tableKv, capOf(doc, CARE_EVERY));

  // Gives up: one sentence with "Recorded as your choice" on the same line, then every differing row in a fold,
  // closed by default (owner direction d9a830854). Built once, so the fold stays as the person left it.
  const givesLine = doc.createElement('div');
  givesLine.className = 'care-gives';
  const givesText = doc.createTextNode('');
  const givesCap = doc.createElement('span');
  givesCap.className = 'cap';
  givesCap.textContent = ' Recorded as your choice';
  givesLine.append(givesText, givesCap);
  const givesFold = buildCheckFold(doc, [], '', { text: (g) => `All ${g.length} differences`, rows: (d, g) => g.map((x) => lineOf(d, x)) });
  const givesBlock = stackOf(doc, [givesLine, givesFold.line, givesFold.rows]);

  function paint() {
    value('does').textContent = positions[sel] ? positions[sel].description : '';
    const est = value('estimate');
    const priced = CARE_POSITIONS.map((p) => (positions[p] && positions[p].estimate) || null);
    if (priced.every((e) => !e)) est.replaceChildren(doc.createTextNode(NOT_ENOUGH));
    else {
      const parts = [];
      CARE_POSITIONS.forEach((p, i) => {
        if (i) parts.push(doc.createTextNode(' · '));
        const t = priced[i] ? `${CARE_LABELS[p]} ≈ $${usd(priced[i].costUsd)}` : `${CARE_LABELS[p]}: ${NOT_ENOUGH}`;
        if (p === sel) { const b = doc.createElement('b'); b.textContent = t; parts.push(b); } else parts.push(doc.createTextNode(t));
      });
      const cap = doc.createElement('span');
      cap.className = 'cap';
      cap.textContent = ` ${start.size ? 'the whole build, from recorded step costs' : 'one run, from recorded step costs'}`;
      est.replaceChildren(stackOf(doc, [stackOf(doc, [...parts, cap]), ...(start.estimateCap ? [capOf(doc, start.estimateCap)] : [])]));
    }
    const gives = careGivesUp(sel, pick, names);
    if (gives.length) { givesText.textContent = careGivesUpSentence(sel, pick) || gives[0]; givesFold.update(gives); }
    value('gives').replaceChildren(...(gives.length ? [givesBlock] : []));
    if (gives.length) delete pickBtn.dataset.preset; else if (sel === pick) pickBtn.dataset.preset = '1';
    const hist = CARE_POSITIONS.map((p) => history[p] || { enough: false, line: `${CARE_LABELS[p]}: ${NOT_ENOUGH}` });
    value('history').replaceChildren(hist.every((x) => !x.enough)
      ? lineOf(doc, `Quality figures per position: ${NOT_ENOUGH}`) : stackOf(doc, hist.map((x) => lineOf(doc, x.line))));
    value('models').textContent = start.modelsLine ? start.modelsLine.replace(/^Models: /, '') : '';
    syncFacts(kv);
    foldText.textContent = `What ${CARE_LABELS[sel]} does`;
    for (const r of CARE_TABLE) setFactText(tableKv, r.key, careCell(r.key, sel, names));
    syncFacts(tableKv);
  }
  paint();
  el.append(kv, foldBtn, region);

  // The step card's sending state: the button is disabled while the answer posts, and enabled again before stepSender
  // gives the focus back to it after a failure (focus-after-disable).
  let go = null;
  const send = stepSender({ ...deps, doc, submit: (payload) => {
    go.disabled = true;
    return Promise.resolve().then(() => deps.submit(payload)).finally(() => { go.disabled = false; });
  } }, err);
  go = ownButton(doc, 'btn-sm btn-primary care-go', 'Start requirements', () => send({ care: { position: sel } }));
  const foot = doc.createElement('div');
  foot.className = 'qpanel-foot plan-actions';
  foot.appendChild(go);
  el.appendChild(foot);
  return {
    el,
    render: (panel) => panel.appendChild(el),
    collect: () => ({ care: { position: sel } }),
    setErrors: (errors) => {
      const first = Array.isArray(errors) && errors.find((e) => e && e.message);
      if (!first) return;
      err.classList.remove('ok');
      err.textContent = first.message;
      err.hidden = false;
    },
  };
}
