// ui/public/shape/requirements-body.mjs — the Shaper's Requirements step (shapeRequirements): the `plan` ask that carries
// `plan.criteria` (or `plan.error`). Head · sub line · the criteria rows (check-row.mjs) · the decisions as ONE OptionList
// (chat/question.mjs buildChatQuestion, Worca's pick pre-picked) · the foot. It adds no control of its own: every part is an
// existing builder. The decisions are worded for the lead (src/shared/answerer.mjs) and are built only once the lead is known.
import { buildChatQuestion } from '../chat/question.mjs';
import { buildCheckRows, swapOpen } from './check-row.mjs';
import { stepHead, stepSender } from './step-card.mjs';
import { buildFeedbackRow } from './feedback-row.mjs';
import { loadAnswerer, leadLabel } from '../answerer.mjs';
import { emptyState } from '../design-system/components/empty-state.mjs';
import { toElement } from '../design-system/components/html.mjs';

let whySeq = 0;

/** "Security and Design disagree" for two or more roles; one role by its label, plus " · your area" when it is the lead's. */
function whyOf(from, lead) {
  const roles = Array.isArray(from) ? from.filter((k) => typeof k === 'string' && k) : [];
  if (roles.length > 1) return `${roles.slice(0, -1).map(leadLabel).join(', ')} and ${leadLabel(roles[roles.length - 1])} disagree`;
  if (roles.length === 1) return `${leadLabel(roles[0])}${roles[0] === lead ? ' · your area' : ''}`;
  return '';
}

export function renderRequirementsBody(panel, pq, deps) {
  const { doc } = deps;
  const plan = pq.plan || {};
  const error = plan.error || null;
  const criteria = error ? null : plan.criteria || null;
  const decisions = !error && Array.isArray(plan.decisions) ? plan.decisions : [];
  const items = criteria && Array.isArray(criteria.items) ? criteria.items : [];
  const agreed = criteria && Array.isArray(criteria.criteria) ? criteria.criteria.length : items.length;
  const failing = items.filter((it) => !it.pass).length;
  const h = (tag, cls, text) => { const e = doc.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
  const btn = (cls, text) => { const b = h('button', `btn btn-sm ${cls}`, text); b.type = 'button'; return b; };
  const body = h('div', 'plan-body plan-card shape-reqs');
  const err = h('div', 'plan-err'); err.hidden = true; err.setAttribute('role', 'alert');
  let afterSubmit = () => {};
  const send = stepSender({ ...deps, submit: (payload) => {
    panel.dispatchEvent(new doc.defaultView.CustomEvent('plan-answer', { bubbles: true, detail: { ...payload } }));
    return deps.submit(payload);
  } }, err, { after: () => afterSubmit() });
  let list = null;                                 // the OptionList, once the lead is known
  let decisionsShown = () => {};                   // tells Agree and plan the decisions are on screen
  const picks = () => (list ? Object.fromEntries(list.picks()) : {});
  const setErrors = (errors) => {
    const msgs = Array.isArray(errors) ? errors : [];
    err.classList.remove('ok');
    err.textContent = msgs.map((e) => e.message || e.code || 'invalid').join(' · ');
    err.hidden = !msgs.length;
  };

  panel.appendChild(stepHead(doc, deps.title, deps.chip));
  const sub = h('div', 'plan-sub');
  if (!error) body.appendChild(sub);
  const paintSub = (lead) => {
    sub.textContent = `${agreed} agreed by the perspectives · ${decisions.length ? `${decisions.length} need you` : 'none need you'}${lead ? ` · as ${leadLabel(lead)}` : ''}`;
  };
  paintSub(plan.lead || null);

  if (error) {
    body.appendChild(toElement(doc, emptyState({ title: 'Could not load the requirements.', text: error.message || '', error: true })));
  } else if (!agreed && !failing) {
    body.appendChild(toElement(doc, emptyState({ title: 'No requirements were written.' })));
  } else {
    const rows = h('div', 'plan-checks');
    rows.append(...buildCheckRows(doc, criteria));
    body.appendChild(rows);
  }
  const slot = h('div', 'shape-reqs-decisions');
  body.appendChild(slot);

  const typed = plan.revisable ? buildFeedbackRow(doc, { label: 'Changes to the requirements', onSend: (text) => {
    if (!text) { setErrors([{ path: 'feedback', message: 'Write what should change first' }]); return; }
    send({ decision: 'revise', feedback: text, decisions: picks() });
  } }) : null;
  if (typed) { typed.row.hidden = true; body.appendChild(typed.row); }

  const foot = h('div', 'qpanel-foot plan-actions');
  const note = h('span', 'qanswered');
  note.id = `shape-reqs-note-${++whySeq}`;
  if (typed) foot.appendChild(swapOpen(btn('btn-quiet plan-ask-changes', 'Ask for changes'), typed.row, typed.cancel, () => typed.typed.focus()));
  let agree = null;
  if (error) {
    const retry = btn('btn-primary plan-retry', 'Try again');
    retry.addEventListener('click', (e) => { e.stopPropagation(); send({ decision: 'retry' }); });
    foot.appendChild(retry);
  } else {
    agree = btn('btn-primary plan-approve', 'Agree and plan');
    const hint = typed ? ': ask for changes' : '';
    const reason = !agreed && !failing ? `Nothing to agree yet${hint}` : failing ? `${failing} to fix${hint}` : '';
    // aria-disabled, not disabled: it stays in the tab order, keeps its words, and setPanelBusy cannot re-enable it
    let waiting = decisions.length > 0;            // the decisions are not on screen yet
    const syncAgree = () => {
      const shown = reason || (waiting ? 'Loading your role…' : '');
      if (shown || waiting) agree.setAttribute('aria-disabled', 'true'); else agree.removeAttribute('aria-disabled');
      if (shown) { agree.title = shown; agree.setAttribute('aria-describedby', note.id); } else { agree.removeAttribute('title'); agree.removeAttribute('aria-describedby'); }
      note.textContent = shown || (decisions.length ? 'Worca\'s picks marked · change any' : '');
    };
    agree.addEventListener('click', (e) => {
      e.stopPropagation();
      if (agree.getAttribute('aria-disabled') === 'true') return;
      send({ decision: 'approve', decisions: picks() });
    });
    foot.append(agree);
    decisionsShown = () => { waiting = false; syncAgree(); };
    syncAgree();
  }
  if (note.textContent) foot.insertBefore(note, foot.firstChild);
  body.append(err, foot);
  panel.appendChild(body);
  panel.dispatchEvent(new doc.defaultView.CustomEvent('step-primary', { bubbles: true }));
  panel.__plan = { setErrors };

  if (!decisions.length || error) return;
  const paintDecisions = (lead) => {
    if (list) return;
    paintSub(lead);
    list = buildChatQuestion(doc, {
      id: `req-${pq.id || 'q'}`,
      heading: `${decisions.length} need you`,
      questions: decisions.map((d) => ({
        id: d.id, text: d.text, plain: d.plain, why: whyOf(d.from, lead),
        options: (Array.isArray(d.options) ? d.options : []).map((o) => ({ value: o.value, label: o.label, plain: o.plain, recommended: o.value === d.recommended })),
      })),
      preset: new Map(decisions.filter((d) => d.recommended != null).map((d) => [d.id, d.recommended])),
      foot: false,
      submitLabel: () => '',
      onSubmit: () => {},
    }, { lead, strip: true, register: 'plain' });
    slot.appendChild(list.el);
    decisionsShown();
  };
  if (plan.lead) paintDecisions(plan.lead);
  else loadAnswerer(deps.fetch).then((p) => paintDecisions(p.lead));
}
