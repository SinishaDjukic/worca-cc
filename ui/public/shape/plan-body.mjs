// ui/public/shape/plan-body.mjs — the `plan` ask (spec §3.4, D10, D30–D32): Chat's live run card and the run page.
// Gate on (deps.extras): one decision card — summary, a folded check line, a perspectives line, Approve and build /
// Ask for changes / Full plan / ⋯. Gate off: the held body keeps approve / revise / stop, so a held run is never
// stranded (D12, S4).
import { buildPerspectiveChips } from './chips.mjs';
import { planStats, perspectiveChangeFeedback, fixAllFeedback, sectionOwners, planSummary, checkLine, unmetLine,
  approveLabel } from './plan-text.mjs';
import { perspectiveByKey, PERSPECTIVES, chipsHiddenFor } from '../../../src/shared/shape/perspectives.mjs';
import { levelAtLeast } from '../ui-level.mjs';
import { toggleMenu } from '../workflows/menu.mjs';

export const SEND_FAILED = 'Could not send your answer. Try again.';

const labelOf = (k) => (perspectiveByKey(k) || {}).label || k;

export function renderPlanBody(panel, pq, deps) {
  const { doc } = deps;
  const plan = pq.plan || {};
  const check = plan.check || null;
  const items = check && Array.isArray(check.items) ? check.items : [];
  const perspectives = Array.isArray(plan.perspectives) ? plan.perspectives : [];
  const h = (tag, cls, text) => { const e = doc.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
  const btn = (cls, text) => { const b = h('button', `btn ${cls}`, text); b.type = 'button'; return b; };
  const body = h('div', deps.extras ? 'plan-body plan-card' : 'plan-body');
  const err = h('div', 'plan-err'); err.hidden = true; err.setAttribute('role', 'alert');
  let busy = false;
  let afterSubmit = () => {};                     // re-derives controls setPanelBusy re-enabled (F32)
  const send = (payload) => {
    if (busy) return;
    busy = true; err.hidden = true;
    // submit is postAnswer: true on 200 only. A 422 has already painted its field errors through setErrors (the
    // alert is showing). Any other failure (404, 409, 500, network) is only in the run log (F33): say so here.
    Promise.resolve(deps.submit(payload))
      .then((ok) => { if (ok === false && err.hidden) setErrors([{ message: SEND_FAILED }]); },
        () => { if (err.hidden) setErrors([{ message: SEND_FAILED }]); })
      .finally(() => { busy = false; afterSubmit(); });
  };
  const score = check && Number.isFinite(check.total) ? ` · Shape ${check.passed}/${check.total}` : '';
  const fileName = plan.file ? String(plan.file).split(/[\\/]/).pop() : 'Plan';
  let planText = '';
  let meta = null;
  let summary = null;

  // A control that shows/hides `region` (folded by default).
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
    typed.rows = 2;
    typed.placeholder = 'Ask for changes in your own words…';
    typed.setAttribute('aria-label', 'Changes to the plan');
    const sendBtn = btn('plan-revise', 'Send changes');
    sendBtn.addEventListener('click', () => {
      const text = typed.value.trim();
      if (!text) { setErrors([{ path: 'feedback', message: 'Write what should change first' }]); return; }
      send({ decision: 'revise', feedback: text });
    });
    const row = h('div', 'plan-typed'); row.append(typed, sendBtn);
    return { row, typed };
  };

  if (deps.extras) renderCard(); else renderHeld();
  panel.appendChild(body);

  // ---- gate off: today's held body (D12) — the label never says "anyway" (D32)
  function renderHeld() {
    meta = h('div', 'plan-meta', `${fileName}${score}`);
    body.appendChild(meta);
    if (perspectives.length) body.appendChild(h('div', 'plan-perspectives-ro', perspectives.map(labelOf).join(' · ')));
    if (items.length) {
      const row = h('div', 'plan-check');
      for (const it of items) {
        if (it.pass) { row.appendChild(h('span', 'plan-check-ok', `✓ ${it.label}`)); continue; }
        const bad = h('div', 'plan-check-bad');
        bad.append(h('span', 'plan-check-label', it.label), h('span', 'plan-check-detail', it.detail || ''));
        row.appendChild(bad);
      }
      body.appendChild(row);
    }
    if (plan.revisable) body.appendChild(typedRow().row);
    const foot = h('div', 'qpanel-foot plan-actions');
    const approve = btn('btn-primary plan-approve', 'Run this plan');
    approve.addEventListener('click', () => send({ decision: 'approve' }));
    const full = btn('plan-open-full', 'Open full plan');
    full.addEventListener('click', () => deps.openFull());
    const stop = btn('plan-stop', 'Stop');
    stop.addEventListener('click', async () => {
      const ok = await deps.confirm({ title: 'Stop this run', message: 'The plan stays in the run\'s artifacts.', confirmLabel: 'Stop', danger: true });
      if (ok) send({ decision: 'stop' });
    });
    foot.append(approve, full, stop);
    body.append(err, foot);
  }

  // ---- gate on: the decision card (D30)
  function renderCard() {
    const title = deps.run && deps.run.title && deps.run.title !== '(untitled)' ? String(deps.run.title) : '';
    body.appendChild(h('div', 'plan-sub', `${title ? `${title} · ` : ''}v${plan.round || 1}`));
    summary = h('p', 'plan-summary'); summary.hidden = true;
    body.appendChild(summary);

    // D19: a later slice's planner said the slice can't be built as outlined: that is why this plan stopped
    if (plan.outlineChange) {
      const note = h('div', 'shape-plan-outline-change');
      note.append(h('div', 'shape-plan-outline-change-head', 'The planner says this slice can\'t be built as outlined:'),
        h('p', 'shape-plan-outline-change-text', String(plan.outlineChange)));
      body.appendChild(note);
    }

    // one check line, folded; neutral rows with ✓ / ✕; one Fix all (D32)
    if (items.length) {
      const rows = h('div', 'plan-checks'); rows.hidden = true;
      for (const it of items) {
        const row = h('div', `plan-check-row${it.pass ? ' ok' : ''}`);
        const mark = h('span', 'plan-check-mark', it.pass ? '✓' : '✕'); mark.setAttribute('aria-label', it.pass ? 'met' : 'unmet');
        row.append(mark, h('span', 'plan-check-label', it.label));
        if (!it.pass && it.detail) row.appendChild(h('span', 'plan-check-detail', it.detail));
        rows.appendChild(row);
      }
      if (plan.revisable && items.some((it) => !it.pass)) {
        const fixAll = btn('plan-fix-all', 'Fix all');
        fixAll.addEventListener('click', () => send({ decision: 'revise', feedback: fixAllFeedback(items) }));
        rows.appendChild(fixAll);
      }
      const line = btn('plan-fold plan-check-line', null);
      const chev = h('span', 'plan-chev', '›'); chev.setAttribute('aria-hidden', 'true');
      line.append(h('span', 'plan-fold-text', checkLine(check)), chev);
      body.append(fold(line, rows), rows);
    }

    // perspectives as a line; "edit" opens today's chips + Update plan in place (D31)
    const was = PERSPECTIVES.map((p) => p.key).filter((k) => k === 'product' || perspectives.includes(k));
    const pline = h('div', 'plan-persp-line');
    pline.appendChild(h('span', 'plan-persp-names', was.map(labelOf).join(' · ')));
    body.appendChild(pline);
    if (plan.revisable) {
      const update = btn('plan-update', 'Update plan'); update.disabled = true;
      const same = (v) => v.length === was.length && v.every((k) => was.includes(k));   // order-free
      const chips = buildPerspectiveChips(doc, { picked: perspectives, fixed: ['ux'], hidden: chipsHiddenFor(perspectives), collapsed: false,
        onChange: (v) => { update.disabled = same(v); } });
      afterSubmit = () => { update.disabled = same(chips.value()); };
      update.addEventListener('click', () => {
        const after = chips.value();
        send({ decision: 'revise', feedback: perspectiveChangeFeedback(perspectives, after), perspectives: after });
      });
      const row = h('div', 'plan-perspectives'); row.hidden = true; row.append(chips.el, update);
      pline.append(' — ', fold(btn('plan-persp-edit', 'edit'), row));
      body.appendChild(row);
    }

    // Full plan: inline, with tags, grounding marks and the earlier versions (clarify answers)
    const fullView = h('div', 'plan-full-view'); fullView.hidden = true;
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

    // Ask for changes: closed by default, then Send changes (D30)
    const typed = plan.revisable ? typedRow() : null;
    if (typed) { typed.row.hidden = true; body.appendChild(typed.row); }

    const foot = h('div', 'qpanel-foot plan-actions');
    const approve = btn('btn-primary plan-approve', approveLabel(plan));
    approve.addEventListener('click', () => send({ decision: 'approve' }));
    foot.appendChild(approve);
    if (typed) foot.appendChild(fold(btn('plan-ask-changes', 'Ask for changes'), typed.row, () => typed.typed.focus()));
    const full = fold(btn('plan-full', 'Full plan'), fullView);
    full.addEventListener('click', () => { full.textContent = fullView.hidden ? 'Full plan' : 'Hide plan'; });
    foot.appendChild(full);
    if (!(deps.run && deps.run.workspaceId)) {
      const more = btn('btn-ghost plan-more', '⋯');
      more.setAttribute('aria-label', 'More for this plan');
      more.setAttribute('aria-haspopup', 'menu');
      more.addEventListener('click', () => toggleMenu({ doc, anchor: more, align: 'end', label: 'More for this plan', items: [
        { label: 'Save to plans/', onSelect: () => savePlan(false) },
        ...(levelAtLeast('advanced', doc) ? [{ label: 'Open in New run', onSelect: openInNewRun }] : []),
      ] }));
      foot.appendChild(more);
    }
    body.append(err, foot);
    if (check && check.ok === false && unmetLine(check)) body.appendChild(h('div', 'plan-unmet', unmetLine(check)));
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
