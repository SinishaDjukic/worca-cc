// ui/public/shape/outline-body.mjs — the slice outline ask (spec §3.8, screen 8; D30–D32): Chat's live run card and
// the run page. Gate on (deps.extras): one decision card — a summary, the slices as a compact list, one Edit slices
// mode (Merge with next / Remove / Undo edits), a folded check line with one Fix all, the Approve-each switch, and
// Plan slice 1 / Ask for changes / ⋯ (Don't slice); no Stop (the top bar's, D31). Merges and removals are previewed
// here (applyOutlineEdits) and posted with Plan slice 1; the server re-applies them (L4). Gate off: today's held body —
// read-only slices, Plan slice 1 / Don't slice / Send changes / Stop (L13).
// src/shared is served as is (ui/server.mjs:1556), the same way plan-body.mjs:5 imports it.
import { applyOutlineEdits, checkSlices, outlineFixAllFeedback } from '../../../src/shared/shape/slices.mjs';
import { buildCheckRow } from './check-row.mjs';
import { SEND_FAILED } from './plan-body.mjs';
import { checkLine } from './plan-text.mjs';
import { toggleMenu } from '../workflows/menu.mjs';

/** The card's one summary line (D30): "2 slices · v2 · why" — the round only after the first, the why when set. */
export function outlineSummary(outline, round = 1) {
  const n = Array.isArray(outline && outline.slices) ? outline.slices.length : 0;
  const why = String((outline && outline.why) || '').trim();
  return [`${n} ${n === 1 ? 'slice' : 'slices'}`, round > 1 ? `v${round}` : '', why].filter(Boolean).join(' · ');
}

export function renderOutlineBody(panel, pq, deps) {
  const { doc } = deps;
  const plan = pq.plan || {};
  const asked = plan.outline || { why: '', slices: [] };
  const card = !!deps.extras;
  const h = (tag, cls, text) => { const e = doc.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
  const btn = (cls, text) => { const b = h('button', `btn ${cls}`, text); b.type = 'button'; return b; };
  const body = h('div', card ? 'plan-body plan-card outline-body' : 'plan-body outline-body');
  const err = h('div', 'plan-err'); err.hidden = true; err.setAttribute('role', 'alert');
  // A re-ask after a failed feature creation carries the person's edits (plan.edits, L5); start from them if they
  // still apply.
  const carried = Array.isArray(plan.edits) ? plan.edits.filter((e) => e && (e.op === 'merge' || e.op === 'remove') && typeof e.id === 'string') : [];
  let edits = card && carried.length && applyOutlineEdits(asked, carried).ok ? carried : [];
  let editing = false;                               // the Edit slices mode (D31: closed until used)
  let busy = false;
  const send = (payload) => {
    if (busy) return;
    busy = true; err.hidden = true;
    Promise.resolve(deps.submit(payload))
      .then((ok) => { if (ok === false && err.hidden) setErrors([{ message: SEND_FAILED }]); },
        () => { if (err.hidden) setErrors([{ message: SEND_FAILED }]); })
      .finally(() => { busy = false; });
  };
  // A control that shows/hides `region` (folded by default) — plan-body.mjs's fold, kept local (that file is the plan
  // card's, D30).
  const fold = (b, region, onOpen) => {
    b.setAttribute('aria-expanded', 'false');
    b.addEventListener('click', () => {
      region.hidden = !region.hidden;
      b.setAttribute('aria-expanded', String(!region.hidden));
      if (!region.hidden && onOpen) onOpen();
    });
    return b;
  };
  const typedRow = () => {
    const typed = h('textarea', 'plan-feedback');
    typed.rows = 2; typed.placeholder = 'Ask for changes to the slices in your own words…';
    typed.setAttribute('aria-label', 'Changes to the slices');
    const sendBtn = btn('plan-revise', 'Send changes');
    sendBtn.addEventListener('click', () => {
      const text = typed.value.trim();
      if (!text) { setErrors([{ path: 'feedback', message: 'Write what should change first' }]); return; }
      send({ decision: 'revise', feedback: text });
    });
    const row = h('div', 'plan-typed'); row.append(typed, sendBtn);
    return { row, typed };
  };

  const list = h('ol', 'outline-slices');
  let approveEach = null;
  const approveEachRow = () => {
    const label = h('label', 'outline-approve-each');
    approveEach = h('input'); approveEach.type = 'checkbox'; approveEach.checked = plan.approveEach === true;   // D19: off unless chosen; a re-ask keeps the choice
    label.append(approveEach, doc.createTextNode(' Approve each slice\'s plan'));
    return label;
  };
  const approve = btn('btn-primary outline-approve', 'Plan slice 1');
  approve.addEventListener('click', () => send({ decision: 'approve', ...(edits.length ? { edits } : {}), ...(approveEach ? { approveEach: approveEach.checked } : {}) }));
  // Undo edits: shown only while there are edits (and, on the card, while editing). It posts nothing.
  const undo = btn('btn-sm outline-undo', 'Undo edits');
  undo.addEventListener('click', () => { edits = []; paint(); });

  // per-mode parts paint() fills
  let meta = null; let why = null; let checkHost = null;            // held
  let summary = null; let checkText = null; let checkRows = null;   // card
  let editBtn = null;

  if (card) renderCard(); else renderHeld();
  if (plan.error) { err.hidden = false; err.textContent = plan.error; }
  panel.appendChild(body);
  paint();

  // ---- gate off: today's held body, unchanged (L13)
  function renderHeld() {
    meta = h('div', 'plan-meta');
    why = h('p', 'outline-why');
    checkHost = h('div', 'outline-check');
    body.append(meta, why, list, checkHost);
    if (plan.revisable) body.appendChild(typedRow().row);
    const foot = h('div', 'qpanel-foot plan-actions');
    const flat = btn('outline-flat', 'Don\'t slice');
    flat.addEventListener('click', () => send({ decision: 'flat' }));
    const stop = btn('plan-stop', 'Stop');
    stop.addEventListener('click', async () => {
      if (await deps.confirm({ title: 'Stop this run', message: 'The outline stays in the run\'s artifacts.', confirmLabel: 'Stop', danger: true })) send({ decision: 'stop' });
    });
    foot.append(approve, flat, stop);
    body.append(undo, err, foot);
  }

  // ---- gate on: the decision card (D30–D32)
  function renderCard() {
    summary = h('p', 'plan-summary outline-summary');
    body.append(summary, list);

    // under the list: Edit slices (reveals the per-slice tools and Undo edits) and the Approve-each switch
    const under = h('div', 'outline-under');
    editBtn = btn('plan-persp-edit outline-edit', 'Edit slices');
    editBtn.setAttribute('aria-expanded', 'false');
    editBtn.addEventListener('click', () => { editing = !editing; paint(); });
    under.append(editBtn, undo, approveEachRow());
    body.appendChild(under);

    // one check line, folded; neutral rows with ✓ / ✕; one Fix all (D32)
    checkRows = h('div', 'plan-checks'); checkRows.hidden = true;
    const line = btn('plan-fold plan-check-line', null);
    checkText = h('span', 'plan-fold-text');
    const chev = h('span', 'plan-chev', '›'); chev.setAttribute('aria-hidden', 'true');
    line.append(checkText, chev);
    body.append(fold(line, checkRows), checkRows);

    // Ask for changes: closed by default, then Send changes (D30)
    const typed = plan.revisable ? typedRow() : null;
    if (typed) { typed.row.hidden = true; body.appendChild(typed.row); }

    const foot = h('div', 'qpanel-foot plan-actions');
    foot.appendChild(approve);
    if (typed) foot.appendChild(fold(btn('plan-ask-changes', 'Ask for changes'), typed.row, () => typed.typed.focus()));
    const more = btn('btn-quiet btn-icon plan-more', '⋯');
    more.setAttribute('aria-label', 'More for these slices');
    more.setAttribute('aria-haspopup', 'menu');
    more.addEventListener('click', () => toggleMenu({ doc, anchor: more, align: 'end', label: 'More for these slices', items: [
      { label: 'Don\'t slice', onSelect: () => send({ decision: 'flat' }) },
    ] }));
    foot.appendChild(more);
    body.append(err, foot);
  }

  function paint() {
    let r = applyOutlineEdits(asked, edits);
    if (!r.ok) {                     // never post an edit the server would refuse: drop it and say why
      setErrors([{ path: 'edits', message: r.error }]);
      edits = edits.slice(0, -1);
      r = applyOutlineEdits(asked, edits);
    }
    const outline = r.ok ? r.outline : asked;
    const check = checkSlices(outline);
    const n = outline.slices.length;
    list.replaceChildren(...outline.slices.map((s, i) => sliceItem(s, i, n)));
    if (card) {
      summary.textContent = outlineSummary(outline, plan.round || 1);
      checkText.textContent = checkLine(check, 'Outline');
      paintChecks(check);
      editBtn.textContent = editing ? 'Done editing' : 'Edit slices';
      editBtn.setAttribute('aria-expanded', String(editing));
      undo.hidden = !(editing && edits.length);
      approve.textContent = n < 2 ? 'Plan it as one' : 'Plan slice 1';             // D32: never "anyway"
      return;
    }
    meta.textContent = `${n} ${n === 1 ? 'slice' : 'slices'} · v${plan.round || 1} · Outline ${check.passed}/${check.total}`;
    undo.hidden = !edits.length;
    why.textContent = outline.why || '';
    why.hidden = !outline.why;
    checkHost.replaceChildren(buildCheckRow(doc, check));
    approve.textContent = n < 2 ? 'Plan it as one' : check.ok ? 'Plan slice 1' : 'Plan slice 1 anyway';
  }

  // The folded rows: repainted in place, so an open fold stays open across an edit.
  function paintChecks(check) {
    const rows = check.items.map((it) => {
      const row = h('div', `plan-check-row${it.pass ? ' ok' : ''}`);
      const mark = h('span', 'plan-check-mark', it.pass ? '✓' : '✕'); mark.setAttribute('aria-label', it.pass ? 'met' : 'unmet');
      row.append(mark, h('span', 'plan-check-label', it.label));
      if (!it.pass && it.detail) row.appendChild(h('span', 'plan-check-detail', it.detail));
      return row;
    });
    if (plan.revisable && check.items.some((it) => !it.pass)) {
      const fixAll = btn('btn-sm plan-fix-all', 'Fix all');
      fixAll.addEventListener('click', () => send({ decision: 'revise', feedback: outlineFixAllFeedback(check.items) }));
      rows.push(fixAll);
    }
    checkRows.replaceChildren(...rows);
  }

  function sliceItem(s, i, n) {
    const li = h('li', 'outline-slice');
    li.dataset.slice = s.id;
    const head = h('div', 'outline-slice-head');
    head.append(h('b', 'outline-slice-title', s.title));
    if (s.estimate) head.appendChild(h('span', `outline-est ${s.estimate}`, s.estimate));
    li.appendChild(head);
    if (s.goal) li.appendChild(h('div', 'outline-goal', s.goal));
    if (!card && s.acceptance.length) {             // the card's list is compact: number, name, size, one line (D30)
      const ul = h('ul', 'outline-acceptance');
      for (const a of s.acceptance) ul.appendChild(h('li', null, a));
      li.appendChild(ul);
    }
    if (card && editing) {
      const tools = h('div', 'outline-slice-tools');
      if (i + 1 < n) {
        const m = btn('btn-sm outline-merge', 'Merge with next');
        m.addEventListener('click', () => { edits = [...edits, { op: 'merge', id: s.id }]; paint(); });
        tools.appendChild(m);
      }
      if (n > 1) {
        const rm = btn('btn-sm outline-remove', 'Remove');
        rm.addEventListener('click', () => { edits = [...edits, { op: 'remove', id: s.id }]; paint(); });
        tools.appendChild(rm);
      }
      li.appendChild(tools);
    }
    return li;
  }

  function setErrors(errors) {
    const l = Array.isArray(errors) ? errors : [];
    err.classList.remove('ok');
    err.textContent = l.map((e) => e.message || e.code || 'invalid').join(' · ');
    err.hidden = !l.length;
  }
  panel.__plan = { setErrors };
}
