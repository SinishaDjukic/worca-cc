// ui/public/shape/plan-body.mjs — the `plan` ask (spec §3.4, D10): Chat's live run card and the run page. With the
// gate off (deps.extras false) it keeps approve / revise / stop, so a held run is never stranded (D12, S4).
import { buildPerspectiveChips } from './chips.mjs';
import { planStats, perspectiveChangeFeedback, fixFeedback, sectionOwners } from './plan-text.mjs';
import { perspectiveByKey } from '../../../src/shared/shape/perspectives.mjs';
import { tagLevel } from '../ui-level.mjs';

export const SEND_FAILED = 'Could not send your answer. Try again.';

export function renderPlanBody(panel, pq, deps) {
  const { doc } = deps;
  const plan = pq.plan || {};
  const check = plan.check || null;
  const perspectives = Array.isArray(plan.perspectives) ? plan.perspectives : [];
  const h = (tag, cls, text) => { const e = doc.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
  const btn = (cls, text) => { const b = h('button', `btn ${cls}`, text); b.type = 'button'; return b; };
  const body = h('div', 'plan-body');
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

  // ---- header: file · sections · words · shape score. askHeading names the version and the score too (F28).
  const score = check && Number.isFinite(check.total) ? ` · Shape ${check.passed}/${check.total}` : '';
  const meta = h('div', 'plan-meta', `${plan.file ? String(plan.file).split(/[\\/]/).pop() : 'Plan'}${score}`);
  body.appendChild(meta);

  // ---- perspective chips + Update plan (D4, S5)
  if (deps.extras && plan.revisable) {
    const update = btn('plan-update', 'Update plan'); update.disabled = true;
    const was = new Set(['product', ...perspectives]);
    const same = (v) => v.length === was.size && v.every((k) => was.has(k));   // order-free: value() is in PERSPECTIVES order
    const chips = buildPerspectiveChips(doc, { picked: perspectives, fixed: ['ux'], collapsed: false,
      onChange: (v) => { update.disabled = same(v); } });
    afterSubmit = () => { update.disabled = same(chips.value()); };
    update.addEventListener('click', () => {
      const after = chips.value();
      send({ decision: 'revise', feedback: perspectiveChangeFeedback(perspectives, after), perspectives: after });
    });
    const row = h('div', 'plan-perspectives'); row.append(chips.el, update); body.appendChild(row);
  } else if (perspectives.length) {
    body.appendChild(h('div', 'plan-perspectives-ro', perspectives.map((k) => (perspectiveByKey(k) || {}).label || k).join(' · ')));
  }

  // ---- shape check row (D6): passing chips; each failing check with Fix
  if (check && Array.isArray(check.items)) {
    const row = h('div', 'plan-check');
    for (const it of check.items) {
      if (it.pass) { row.appendChild(h('span', 'plan-check-ok', `✓ ${it.label}`)); continue; }
      const bad = h('div', 'plan-check-bad');
      bad.append(h('span', 'plan-check-label', it.label), h('span', 'plan-check-detail', it.detail || ''));
      if (deps.extras && plan.revisable) {
        const fix = btn('plan-fix', 'Fix');
        fix.addEventListener('click', () => send({ decision: 'revise', feedback: fixFeedback(it) }));
        bad.appendChild(fix);
      }
      row.appendChild(bad);
    }
    body.appendChild(row);
  }

  // ---- the plan, collapsed to ~40%, with perspective tags and grounding marks
  const md = h('div', 'plan-md collapsed');
  const toggle = btn('plan-expand', 'Show the whole plan');
  toggle.addEventListener('click', () => { const c = md.classList.toggle('collapsed'); toggle.textContent = c ? 'Show the whole plan' : 'Collapse'; });
  let planText = '';
  if (deps.extras) {
    body.append(md, toggle);
    paintPlan(md, null);
  }

  // ---- versions: earlier rounds, collapsed (S6)
  const rounds = (deps.run && deps.run.shaping && Array.isArray(deps.run.shaping.rounds) ? deps.run.shaping.rounds : [])
    .filter((r) => r.round < (plan.round || 1));
  if (deps.extras && rounds.length) {
    const box = h('div', 'plan-versions');
    for (const r of rounds) {
      const d = h('details', 'plan-version');
      const score = r.total ? ` · Shape ${r.passed}/${r.total}` : '';
      d.appendChild(h('summary', null, `v${r.round}${score}${r.feedback ? ` · you asked: ${r.feedback}` : ''}`));
      const host = h('div', 'plan-md');
      d.appendChild(host);
      d.addEventListener('toggle', () => { if (d.open && !host.childNodes.length) paintPlan(host, r.round); }, { once: false });
      box.appendChild(d);
    }
    body.appendChild(box);
  }

  // ---- typed revise
  let typed = null;
  if (plan.revisable) {
    typed = h('textarea', 'plan-feedback');
    typed.rows = 2;
    typed.placeholder = 'Ask for changes in your own words…';
    typed.setAttribute('aria-label', 'Changes to the plan');
    const sendBtn = btn('plan-revise', 'Send changes');
    sendBtn.addEventListener('click', () => {
      const text = typed.value.trim();
      if (!text) { setErrors([{ path: 'feedback', message: 'Write what should change first' }]); return; }
      send({ decision: 'revise', feedback: text });
    });
    const row = h('div', 'plan-typed'); row.append(typed, sendBtn); body.appendChild(row);
  }

  // ---- actions (D10)
  const foot = h('div', 'qpanel-foot plan-actions');
  const approve = btn('btn-primary plan-approve', check && check.ok === false ? 'Run anyway' : 'Run this plan');
  approve.addEventListener('click', () => send({ decision: 'approve' }));
  const full = btn('plan-open-full', 'Open full plan');
  full.addEventListener('click', () => deps.openFull());
  const stop = btn('plan-stop', 'Stop');
  stop.addEventListener('click', async () => {
    const ok = await deps.confirm({ title: 'Stop this run', message: 'The plan stays in the run\'s artifacts.', confirmLabel: 'Stop', danger: true });
    if (ok) send({ decision: 'stop' });
  });
  foot.append(approve, full);
  const single = !(deps.run && deps.run.workspaceId);
  if (deps.extras && single) {
    const save = btn('plan-save', 'Save to plans/');
    save.addEventListener('click', () => savePlan(false));
    const open = btn('plan-open-new', 'Open in New run');
    tagLevel(open, 'advanced');
    open.addEventListener('click', async () => { const t = planText || ((await deps.fetchPlan()) || {}).text || ''; if (t) deps.openInNewRun(t); });
    foot.append(save, open);
  }
  foot.appendChild(stop);
  body.append(err, foot);
  panel.appendChild(body);

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
    if (!got || typeof got.text !== 'string') { host.textContent = 'The plan text is not available here. Use Open full plan.'; return; }
    if (!round) {
      planText = got.text;
      const { sections, words } = planStats(got.text);
      meta.textContent = `${got.name} · ${sections} section${sections === 1 ? '' : 's'} · ${words} words${score}`;
    }
    const ok = await deps.markdown.ensure();                       // hdMarkdown renders plain until loaded (F21)
    const out = ok ? deps.markdown.render(got.text) : { kind: 'plain' };
    if (out.kind !== 'md') { const pre = h('pre', null, got.text); host.replaceChildren(pre); return; }
    host.replaceChildren(out.frag);
    for (const h2 of host.querySelectorAll('h2')) {
      for (const k of sectionOwners(h2.textContent, perspectives)) h2.appendChild(h('span', 'plan-tag', (perspectiveByKey(k) || {}).label || k));
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
