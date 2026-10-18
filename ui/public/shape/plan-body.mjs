// ui/public/shape/plan-body.mjs — the `plan` ask (spec §3.4, D10, D30–D32; shaper-cards D1): Chat's live run card, the
// run page and the feature page. ONE step card with the gate on and off: head, summary, a folded check line, a
// perspectives line, Ask for changes / Full plan / Approve and build / ⋯ (Fix all, Save to plans/, Open in New run, Stop).
// The gate off (deps.extras false) only drops the controls whose routes are gated: the plan text (summary, inline Full
// plan → the artifact popup), perspectives edit, Save and Open in New run.
import { buildPerspectiveChips } from './chips.mjs';
import { planStats, perspectiveChangeFeedback, fixAllFeedback, sectionOwners, planSummary, unmetLine,
  approveLabel } from './plan-text.mjs';
import { perspectiveByKey, PERSPECTIVES } from '../../../src/shared/shape/perspectives.mjs';
import { levelAtLeast } from '../ui-level.mjs';
import { toggleMenu } from '../workflows/menu.mjs';
import { fold, buildCheckFold } from './check-row.mjs';
import { SEND_FAILED, stepHead, stepSender } from './step-card.mjs';

export { SEND_FAILED };

const labelOf = (k) => (perspectiveByKey(k) || {}).label || k;

export function renderPlanBody(panel, pq, deps) {
  const { doc } = deps;
  const plan = pq.plan || {};
  const check = plan.check || null;
  const items = check && Array.isArray(check.items) ? check.items : [];
  const perspectives = Array.isArray(plan.perspectives) ? plan.perspectives : [];
  const h = (tag, cls, text) => { const e = doc.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
  const btn = (cls, text) => { const b = h('button', `btn ${cls}`, text); b.type = 'button'; return b; };
  const body = h('div', 'plan-body plan-card');
  const err = h('div', 'plan-err'); err.hidden = true; err.setAttribute('role', 'alert');
  let afterSubmit = () => {};                     // re-derives controls setPanelBusy re-enabled (F32)
  const send = stepSender(deps, err, { after: () => afterSubmit() });
  const score = check && Number.isFinite(check.total) ? ` · Shape ${check.passed}/${check.total}` : '';
  const fileName = plan.file ? String(plan.file).split(/[\\/]/).pop() : 'Plan';
  let planText = '';
  let meta = null;
  let summary = null;

  const typedRow = () => {
    const typed = h('textarea', 'plan-feedback');
    typed.rows = 2;
    typed.placeholder = 'Ask for changes in your own words…';
    typed.setAttribute('aria-label', 'Changes to the plan');
    const sendBtn = btn('plan-revise', 'Send changes');
    sendBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      const text = typed.value.trim();
      if (!text) { setErrors([{ path: 'feedback', message: 'Write what should change first' }]); return; }
      send({ decision: 'revise', feedback: text });
    });
    const row = h('div', 'plan-typed'); row.append(typed, sendBtn);
    return { row, typed };
  };

  panel.appendChild(stepHead(doc, deps.title, deps.chip));
  const title = deps.run && deps.run.title && deps.run.title !== '(untitled)' ? String(deps.run.title) : '';
  body.appendChild(h('div', 'plan-sub', `${title ? `${title} · ` : ''}v${plan.round || 1}`));
  // the summary comes from the plan text, which only the gated route serves
  if (deps.extras) { summary = h('p', 'plan-summary'); summary.hidden = true; body.appendChild(summary); }

  // D19: a later run's planner said the run can't be built as outlined: that is why this plan stopped
  if (plan.outlineChange) {
    const note = h('div', 'shape-plan-outline-change');
    note.append(h('div', 'shape-plan-outline-change-head', 'The planner says this run can\'t be built as outlined:'),
      h('p', 'shape-plan-outline-change-text', String(plan.outlineChange)));
    body.appendChild(note);
  }

  // Shaper s5 (D12): what the chat added to this run, and the ideas saved for it
  if (Array.isArray(plan.notes) && plan.notes.length) {
    const box = h('div', 'shape-plan-notes');
    box.appendChild(h('div', 'shape-plan-notes-head', 'From the chat'));
    const ul = h('ul', 'shape-plan-notes-list');
    for (const n of plan.notes) ul.appendChild(h('li', null, `${n.kind === 'idea' ? 'Saved for later' : 'Added to this run'}: ${n.text}`));
    box.appendChild(ul);
    body.appendChild(box);
  }

  // one check line, folded; neutral rows with ✓ / ✕ (D7); Fix all lives in ⋯ (D8)
  if (items.length) { const f = buildCheckFold(doc, check, 'Shape'); body.append(f.line, f.rows); }

  // perspectives as a line; "edit" opens today's chips + Update plan in place (D31) — the gate on only
  const was = PERSPECTIVES.map((p) => p.key).filter((k) => k === 'product' || perspectives.includes(k));
  const pline = h('div', 'plan-persp-line');
  pline.appendChild(h('span', 'plan-persp-names', was.map(labelOf).join(' · ')));
  body.appendChild(pline);
  if (deps.extras && plan.revisable) {
    const update = btn('plan-update', 'Update plan'); update.disabled = true;
    const same = (v) => v.length === was.length && v.every((k) => was.includes(k));   // order-free
    const chips = buildPerspectiveChips(doc, { picked: perspectives, fixed: ['ux'], collapsed: false,
      onChange: (v) => { update.disabled = same(v); } });
    afterSubmit = () => { update.disabled = same(chips.value()); };
    update.addEventListener('click', (e) => {
      e.stopPropagation();
      const after = chips.value();
      send({ decision: 'revise', feedback: perspectiveChangeFeedback(perspectives, after), perspectives: after });
    });
    const row = h('div', 'plan-perspectives'); row.hidden = true; row.append(chips.el, update);
    pline.append(' — ', fold(btn('plan-persp-edit', 'edit'), row));
    body.appendChild(row);
  }

  // Full plan, the gate on: inline, with tags, grounding marks and the earlier versions (clarify answers)
  let fullView = null;
  if (deps.extras) {
    fullView = h('div', 'plan-full-view'); fullView.hidden = true;
    meta = h('div', 'plan-meta', `${fileName}${score}`);
    const md = h('div', 'plan-md');
    fullView.append(meta, md);
    const rounds = (deps.run && deps.run.shaping && Array.isArray(deps.run.shaping.rounds) ? deps.run.shaping.rounds : [])
      .filter((r) => r.round < (plan.round || 1));
    if (rounds.length) {
      const box = h('div', 'plan-versions');
      for (const r of rounds) {
        const d = h('details', 'plan-version');
        const s = r.total ? ` · Shape ${r.passed}/${r.total}` : '';
        d.appendChild(h('summary', null, `v${r.round}${s}${r.feedback ? ` · you asked: ${r.feedback}` : ''}`));
        const host = h('div', 'plan-md');
        d.appendChild(host);
        d.addEventListener('toggle', () => { if (d.open && !host.childNodes.length) paintPlan(host, r.round); });
        box.appendChild(d);
      }
      fullView.appendChild(box);
    }
    body.appendChild(fullView);
    paintPlan(md, null);
  }

  // Ask for changes: closed by default, then Send changes (D30)
  const typed = plan.revisable ? typedRow() : null;
  if (typed) { typed.row.hidden = true; body.appendChild(typed.row); }

  const foot = h('div', 'qpanel-foot plan-actions');
  if (typed) foot.appendChild(fold(btn('plan-ask-changes', 'Ask for changes'), typed.row, () => typed.typed.focus()));
  foot.appendChild(fullButton());
  const approve = btn('btn-primary plan-approve', approveLabel(plan));
  approve.addEventListener('click', (e) => { e.stopPropagation(); send({ decision: 'approve' }); });
  foot.appendChild(approve);
  foot.appendChild(moreButton());
  body.append(err, foot);
  if (check && check.ok === false && unmetLine(check)) body.appendChild(h('div', 'plan-unmet', unmetLine(check)));
  panel.appendChild(body);

  /** Gate on: the inline fold (Full plan / Hide plan). Gate off: the artifact popup. Same label either way. */
  function fullButton() {
    if (!deps.extras) {
      const b = btn('plan-full', 'Full plan');
      b.addEventListener('click', (e) => { e.stopPropagation(); deps.openFull(); });
      return b;
    }
    const b = fold(btn('plan-full', 'Full plan'), fullView);
    b.addEventListener('click', () => { b.textContent = fullView.hidden ? 'Full plan' : 'Hide plan'; });
    return b;
  }

  function moreButton() {
    const more = btn('btn-ghost plan-more', '⋯');
    more.setAttribute('aria-label', 'More for this plan');
    more.setAttribute('aria-haspopup', 'menu');
    const ws = !!(deps.run && deps.run.workspaceId);
    more.addEventListener('click', (e) => { e.stopPropagation(); toggleMenu({ doc, anchor: more, align: 'end', label: 'More for this plan', items: [
      ...(plan.revisable && items.some((it) => !it.pass) ? [{ label: 'Fix all', onSelect: () => send({ decision: 'revise', feedback: fixAllFeedback(items) }) }] : []),
      ...(deps.extras && !ws ? [{ label: 'Save to plans/', onSelect: () => savePlan(false) }] : []),
      ...(deps.extras && !ws && levelAtLeast('advanced', doc) ? [{ label: 'Open in New run', onSelect: openInNewRun }] : []),
      { label: 'Stop', onSelect: stopRun },
    ] }); });
    return more;
  }

  async function stopRun() {
    if (await deps.confirm({ title: 'Stop this run', message: 'The plan stays in the run\'s artifacts.', confirmLabel: 'Stop', danger: true })) send({ decision: 'stop' });
  }

  async function openInNewRun() {
    const t = planText || ((await deps.fetchPlan()) || {}).text || '';
    if (t) deps.openInNewRun(t);
  }

  async function savePlan(overwrite) {
    const r = await deps.savePlan(overwrite);
    if (r && r.status === 409 && r.body && r.body.error === 'exists') {
      if (await deps.confirm({ title: 'Replace the saved plan', message: `${r.body.path} already exists. Replace it?`, confirmLabel: 'Replace' })) return savePlan(true);
      return;
    }
    if (!r || r.status !== 200) { setErrors([{ path: 'save', message: (r && r.body && r.body.error) || 'Could not save the plan' }]); return; }
    err.hidden = false; err.classList.add('ok'); err.textContent = `Saved to ${r.body.path}`;
  }

  async function paintPlan(host, round) {
    const got = await deps.fetchPlan(round || undefined);
    if (!got || typeof got.text !== 'string') { host.textContent = 'The plan text is not available here.'; return; }
    if (!round) {
      planText = got.text;
      const { sections, words } = planStats(got.text);
      meta.textContent = `${got.name} · ${sections} section${sections === 1 ? '' : 's'} · ${words} words${score}`;
      if (summary) { summary.textContent = planSummary(got.text); summary.hidden = !summary.textContent; }
    }
    const ok = await deps.markdown.ensure();                       // hdMarkdown renders plain until loaded (F21)
    const out = ok ? deps.markdown.render(got.text) : { kind: 'plain' };
    if (out.kind !== 'md') { const pre = h('pre', null, got.text); host.replaceChildren(pre); return; }
    host.replaceChildren(out.frag);
    for (const h2 of host.querySelectorAll('h2')) {
      for (const k of sectionOwners(h2.textContent, perspectives)) h2.appendChild(h('span', 'plan-tag', labelOf(k)));
    }
    const marks = !round && check && Array.isArray(check.grounding) ? check.grounding : [];
    for (const code of host.querySelectorAll('code')) {
      if (code.closest('pre')) continue;
      const t = code.textContent.trim();
      const g = marks.find((m) => t === m.path || t.startsWith(`${m.path}:`));
      if (!g) continue;
      code.after(h('span', `plan-ground ${g.found ? 'found' : g.isNew ? 'new' : 'missing'}`, g.found ? '✓ exists' : g.isNew ? 'new' : 'not found'));
    }
  }

  function setErrors(errors) {
    const list = Array.isArray(errors) ? errors : [];
    err.classList.remove('ok');
    err.textContent = list.map((e) => e.message || e.code || 'invalid').join(' · ');
    err.hidden = !list.length;
  }
  panel.__plan = { setErrors };
}
