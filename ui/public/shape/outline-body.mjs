// ui/public/shape/outline-body.mjs — the slice outline ask (spec §3.8, screen 8): Chat's live run card and the run
// page. Merges and removals are previewed here (applyOutlineEdits) and posted with Plan slice 1; the server re-applies
// them (L4). Gate off (deps.extras false): read-only slices, Plan slice 1 / Don't slice / Send changes / Stop (L13).
// src/shared is served as is (ui/server.mjs:1556), the same way plan-body.mjs:5 imports it.
import { applyOutlineEdits, checkSlices, outlineFixFeedback } from '../../../src/shared/shape/slices.mjs';
import { buildCheckRow } from './check-row.mjs';
import { SEND_FAILED } from './plan-body.mjs';

export function renderOutlineBody(panel, pq, deps) {
  const { doc } = deps;
  const plan = pq.plan || {};
  const asked = plan.outline || { why: '', slices: [] };
  const h = (tag, cls, text) => { const e = doc.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
  const btn = (cls, text) => { const b = h('button', `btn ${cls}`, text); b.type = 'button'; return b; };
  const body = h('div', 'plan-body outline-body');
  const err = h('div', 'plan-err'); err.hidden = true; err.setAttribute('role', 'alert');
  // A re-ask after a failed feature creation carries the person's edits (plan.edits, L5); start from them if they
  // still apply.
  const carried = Array.isArray(plan.edits) ? plan.edits.filter((e) => e && (e.op === 'merge' || e.op === 'remove') && typeof e.id === 'string') : [];
  let edits = deps.extras && carried.length && applyOutlineEdits(asked, carried).ok ? carried : [];
  let busy = false;
  const send = (payload) => {
    if (busy) return;
    busy = true; err.hidden = true;
    Promise.resolve(deps.submit(payload))
      .then((ok) => { if (ok === false && err.hidden) setErrors([{ message: SEND_FAILED }]); },
        () => { if (err.hidden) setErrors([{ message: SEND_FAILED }]); })
      .finally(() => { busy = false; });
  };

  const meta = h('div', 'plan-meta');
  const why = h('p', 'outline-why');
  const list = h('ol', 'outline-slices');
  const checkHost = h('div', 'outline-check');
  body.append(meta, why, list, checkHost);
  if (plan.error) { err.hidden = false; err.textContent = plan.error; }

  let approveEach = null;
  if (deps.extras) {
    const label = h('label', 'outline-approve-each');
    approveEach = h('input'); approveEach.type = 'checkbox'; approveEach.checked = plan.approveEach !== false;   // a re-ask keeps the choice
    label.append(approveEach, doc.createTextNode(' Approve each slice\'s plan'));
    body.appendChild(label);
  }

  let typed = null;
  if (plan.revisable) {
    typed = h('textarea', 'plan-feedback');
    typed.rows = 2; typed.placeholder = 'Ask for changes to the slices in your own words…';
    typed.setAttribute('aria-label', 'Changes to the slices');
    const sendBtn = btn('plan-revise', 'Send changes');
    sendBtn.addEventListener('click', () => {
      const text = typed.value.trim();
      if (!text) { setErrors([{ path: 'feedback', message: 'Write what should change first' }]); return; }
      send({ decision: 'revise', feedback: text });
    });
    const row = h('div', 'plan-typed'); row.append(typed, sendBtn); body.appendChild(row);
  }

  const foot = h('div', 'qpanel-foot plan-actions');
  const approve = btn('btn-primary outline-approve', 'Plan slice 1');
  approve.addEventListener('click', () => send({ decision: 'approve', ...(edits.length ? { edits } : {}), ...(approveEach ? { approveEach: approveEach.checked } : {}) }));
  const flat = btn('outline-flat', 'Don\'t slice');
  flat.addEventListener('click', () => send({ decision: 'flat' }));
  const stop = btn('plan-stop', 'Stop');
  stop.addEventListener('click', async () => {
    if (await deps.confirm({ title: 'Stop this run', message: 'The outline stays in the run\'s artifacts.', confirmLabel: 'Stop', danger: true })) send({ decision: 'stop' });
  });
  // Undo edits: shown only while there are edits. It is not a .qpanel-foot action, so it posts nothing.
  const undo = btn('outline-undo', 'Undo edits');
  undo.addEventListener('click', () => { edits = []; paint(); });
  foot.append(approve, flat, stop);
  body.append(undo, err, foot);
  panel.appendChild(body);
  paint();

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
    meta.textContent = `${n} ${n === 1 ? 'slice' : 'slices'} · v${plan.round || 1} · Outline ${check.passed}/${check.total}`;
    undo.hidden = !edits.length;
    why.textContent = outline.why || '';
    why.hidden = !outline.why;
    list.replaceChildren(...outline.slices.map((s, i) => sliceItem(s, i, outline.slices.length)));
    checkHost.replaceChildren(buildCheckRow(doc, check, {
      onFix: deps.extras && plan.revisable ? (it) => send({ decision: 'revise', feedback: outlineFixFeedback(it) }) : null,
    }));
    approve.textContent = outline.slices.length < 2 ? 'Plan it as one' : check.ok ? 'Plan slice 1' : 'Plan slice 1 anyway';
  }

  function sliceItem(s, i, n) {
    const li = h('li', 'outline-slice');
    li.dataset.slice = s.id;
    const head = h('div', 'outline-slice-head');
    head.append(h('b', 'outline-slice-title', s.title));
    if (s.estimate) head.appendChild(h('span', `outline-est ${s.estimate}`, s.estimate));
    li.appendChild(head);
    if (s.goal) li.appendChild(h('div', 'outline-goal', s.goal));
    if (s.acceptance.length) {
      const ul = h('ul', 'outline-acceptance');
      for (const a of s.acceptance) ul.appendChild(h('li', null, a));
      li.appendChild(ul);
    }
    if (deps.extras) {
      const tools = h('div', 'outline-slice-tools');
      if (i + 1 < n) {
        const m = btn('outline-merge', 'Merge with next');
        m.addEventListener('click', () => { edits = [...edits, { op: 'merge', id: s.id }]; paint(); });
        tools.appendChild(m);
      }
      if (n > 1) {
        const rm = btn('outline-remove', 'Remove');
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
