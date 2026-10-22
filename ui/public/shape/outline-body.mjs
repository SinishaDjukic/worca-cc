// ui/public/shape/outline-body.mjs — the outline ask, the Split step card (spec §3.8, screen 8; D30–D32; shaper-cards
// D1, D8, D9, D11, D14): Chat's live run card, the run page and the feature page. ONE layout with the gate on and off:
// head, a summary, the runs as a compact list with a per-run ⋯ (Merge with next / Remove), Undo edits, the
// Ask-me-before-each-run switch, a folded check line, and Ask for changes / Approve N runs / ⋯ (Fix all, Don't split,
// Stop). Merges and removals are previewed here (applyOutlineEdits) and posted with the approve; the server re-applies
// them (L4). The UI says "run"; the engine, payloads and server error texts keep "slice".
// src/shared is served as is (ui/server.mjs:1556), the same way plan-body.mjs imports it.
import { applyOutlineEdits, checkSlices, outlineFixAllFeedback } from '../../../src/shared/shape/slices.mjs';
import { swapOpen, buildCheckFold } from './check-row.mjs';
import { stepHead, stepSender } from './step-card.mjs';
import { toggleMenu } from '../workflows/menu.mjs';
import { icon } from '../icons.mjs';
import { makeSwitch } from '../switch.mjs';

/** "3 runs · v2 · why" — the round only after the first, the why when set. */
export function outlineSummary(outline, round = 1) {
  const n = Array.isArray(outline && outline.slices) ? outline.slices.length : 0;
  const why = String((outline && outline.why) || '').trim();
  return [`${n} ${n === 1 ? 'run' : 'runs'}`, round > 1 ? `v${round}` : '', why].filter(Boolean).join(' · ');
}

/** D11: the primary names how many runs it starts; with fewer than 2 it plans the change as one. */
export const approveRunsLabel = (n) => (n < 2 ? 'Plan it as one' : `Approve ${n} runs`);

/** The outline check as the card shows it: a slice is a run (Don't slice is Don't split). The Planner's feedback keeps
 *  the core wording, so only the drawn rows go through this. */
const runWord = (t) => String(t || '').split(/("[^"]*")/).map((part, i) => (i % 2 ? part   // a quoted title stays as written
  : part.replace(/Don't slice/g, 'Don\'t split').replace(/no slicing/g, 'no split')
    .replace(/\b([Ss])lice(s?)\b/g, (_, s, pl) => `${s === 'S' ? 'R' : 'r'}un${pl}`))).join('');
const runWorded = (c) => ({ ...c, items: c.items.map((it) => ({ ...it, label: runWord(it.label), detail: runWord(it.detail) })) });

export function renderOutlineBody(panel, pq, deps) {
  const { doc } = deps;
  const plan = pq.plan || {};
  const asked = plan.outline || { why: '', slices: [] };
  const h = (tag, cls, text) => { const e = doc.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
  const btn = (cls, text) => { const b = h('button', `btn btn-sm ${cls}`, text); b.type = 'button'; return b; };
  // A re-ask after a failed feature creation carries the person's edits (plan.edits, L5); start from them if they
  // still apply.
  const carried = Array.isArray(plan.edits) ? plan.edits.filter((e) => e && (e.op === 'merge' || e.op === 'remove') && typeof e.id === 'string') : [];
  let edits = carried.length && applyOutlineEdits(asked, carried).ok ? carried : [];
  panel.appendChild(stepHead(doc, deps.title, deps.chip));
  const body = h('div', 'plan-body plan-card outline-body');
  const err = h('div', 'plan-err'); err.hidden = true; err.setAttribute('role', 'alert');
  const send = stepSender(deps, err);
  const typedRow = () => {
    const typed = h('textarea', 'plan-feedback');
    typed.rows = 2; typed.placeholder = 'Ask for changes to the runs in your own words…';
    typed.setAttribute('aria-label', 'Changes to the runs');
    const cancel = btn('btn-quiet plan-typed-cancel', 'Cancel');
    const sendBtn = btn('plan-revise', 'Send changes');
    sendBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      const text = typed.value.trim();
      if (!text) { setErrors([{ path: 'feedback', message: 'Write what should change first' }]); return; }
      send({ decision: 'revise', feedback: text });
    });
    const acts = h('div', 'plan-typed-acts'); acts.append(cancel, sendBtn);
    const row = h('div', 'plan-typed'); row.append(typed, acts);
    return { row, typed, cancel };
  };

  const summary = h('p', 'plan-summary outline-summary');
  const list = h('ol', 'outline-slices');
  // Undo edits: shown only while there are edits. It posts nothing.
  const undo = btn('outline-undo', 'Undo edits');
  undo.addEventListener('click', (e) => { e.stopPropagation(); edits = []; paint(); });
  // D19: off unless chosen; a re-ask keeps the choice
  const { row: each, input: eachBox } = makeSwitch(doc, { label: 'Ask me before each run', checked: plan.approveEach === true, rowClass: 'outline-approve-each' });
  const under = h('div', 'outline-under'); under.append(undo, each);
  const checks = buildCheckFold(doc, runWorded(checkSlices(asked)), 'Outline');
  body.append(summary, list, under, checks.line, checks.rows);

  // Ask for changes: closed by default, then Send changes (D30)
  const typed = plan.revisable ? typedRow() : null;
  if (typed) { typed.row.hidden = true; body.appendChild(typed.row); }

  const approve = btn('btn-primary outline-approve', '');
  approve.addEventListener('click', (e) => {
    e.stopPropagation();
    send({ decision: 'approve', ...(edits.length ? { edits } : {}), approveEach: eachBox.checked });
  });
  const foot = h('div', 'qpanel-foot plan-actions');
  if (typed) foot.appendChild(swapOpen(btn('plan-ask-changes', 'Ask for changes'), typed.row, typed.cancel, () => typed.typed.focus()));
  foot.append(approve, moreButton());
  body.append(err, foot);
  if (plan.error) { err.hidden = false; err.textContent = plan.error; }
  panel.appendChild(body);
  paint();

  function currentOutline() { const r = applyOutlineEdits(asked, edits); return r.ok ? r.outline : asked; }

  function paint() {
    let r = applyOutlineEdits(asked, edits);
    if (!r.ok) {                     // never post an edit the server would refuse: drop it and say why
      setErrors([{ path: 'edits', message: r.error }]);
      edits = edits.slice(0, -1);
      r = applyOutlineEdits(asked, edits);
    }
    const outline = r.ok ? r.outline : asked;
    const n = outline.slices.length;
    list.replaceChildren(...outline.slices.map((s, i) => runItem(s, i, n)));
    summary.textContent = outlineSummary(outline, plan.round || 1);
    checks.update(runWorded(checkSlices(outline)));
    undo.hidden = !edits.length;
    approve.textContent = approveRunsLabel(n);
    panel.dispatchEvent(new doc.defaultView.CustomEvent('step-primary', { bubbles: true }));
  }

  // The number is the existing `.outline-slice-title::before` CSS counter: no second number in the markup.
  function runItem(s, i, n) {
    const li = h('li', 'outline-slice');
    li.dataset.slice = s.id;
    const head = h('div', 'outline-slice-head');
    head.appendChild(h('b', 'outline-slice-title', s.title));
    if (s.estimate) head.appendChild(h('span', 'badge grey outline-est', s.estimate));
    const tools = [
      ...(i + 1 < n ? [{ label: 'Merge with next', onSelect: () => { edits = [...edits, { op: 'merge', id: s.id }]; paint(); } }] : []),
      ...(n > 1 ? [{ label: 'Remove', onSelect: () => { edits = [...edits, { op: 'remove', id: s.id }]; paint(); } }] : []),
    ];
    if (tools.length) {
      const more = btn('btn-quiet btn-icon outline-row-more');
      more.append(icon(doc, 'more', 16));
      more.setAttribute('aria-label', `More for run ${i + 1}`);
      more.setAttribute('aria-haspopup', 'menu');
      more.addEventListener('click', (e) => { e.stopPropagation(); toggleMenu({ doc, anchor: more, align: 'end', label: `More for run ${i + 1}`, items: tools }); });
      head.appendChild(more);
    }
    li.appendChild(head);
    if (s.goal) li.appendChild(h('div', 'outline-goal', s.goal));
    return li;
  }

  function moreButton() {
    const more = btn('btn-quiet btn-icon plan-more');
    more.append(icon(doc, 'more', 16));
    more.setAttribute('aria-label', 'More for these runs');
    more.setAttribute('aria-haspopup', 'menu');
    more.addEventListener('click', (e) => {
      e.stopPropagation();
      const c = checkSlices(currentOutline());
      toggleMenu({ doc, anchor: more, align: 'end', label: 'More for these runs', items: [
        ...(plan.revisable && c.items.some((it) => !it.pass) ? [{ label: 'Fix all', onSelect: () => send({ decision: 'revise', feedback: outlineFixAllFeedback(c.items) }) }] : []),
        { label: 'Don\'t split (plan it as one)', onSelect: () => send({ decision: 'flat' }) },
        { label: 'Stop', onSelect: async () => {
          if (await deps.confirm({ title: 'Stop this run', message: 'The outline stays in the run\'s artifacts.', confirmLabel: 'Stop', danger: true })) send({ decision: 'stop' });
        } },
      ] });
    });
    return more;
  }

  function setErrors(errors) {
    const l = Array.isArray(errors) ? errors : [];
    err.classList.remove('ok');
    err.textContent = l.map((e) => e.message || e.code || 'invalid').join(' · ');
    err.hidden = !l.length;
  }
  panel.__plan = { setErrors };
}
