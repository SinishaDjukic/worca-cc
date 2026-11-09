// ui/public/shape/requirements-body.mjs — the Shaper's Requirements step (shapeRequirements): the `plan` ask that carries
// `plan.criteria` (or `plan.error`). Head · sub line · the decisions as ONE stacked OptionList (chat/question.mjs
// buildChatQuestion, Worca's pick pre-picked, each answer saying which persona wants it and why) · the agreed requirements
// folded, grouped by persona (check-row.mjs) · the foot. It adds no control of its own: every part is an existing builder.
// The decisions are worded for the lead (src/shared/answerer.mjs) and are built only once the lead is known.
import { buildChatQuestion } from '../chat/question.mjs';
import { buildCheckFold, buildCheckRows, swapOpen } from './check-row.mjs';
import { stepHead, stepSender } from './step-card.mjs';
import { buildFeedbackRow } from './feedback-row.mjs';
import { loadAnswerer, leadLabel } from '../answerer.mjs';
import { emptyState } from '../design-system/components/empty-state.mjs';
import { toElement } from '../design-system/components/html.mjs';
import { plainWords, wordsFor } from '../../../src/shared/answerer.mjs';
import { criterionPerspective } from '../../../src/shared/shape/requirements.mjs';

let whySeq = 0;

/** "Security and Design disagree" for two or more roles; one role by its label, plus " · your area" when it is the lead's. */
function whyOf(from, lead) {
  const roles = Array.isArray(from) ? from.filter((k) => typeof k === 'string' && k) : [];
  if (roles.length > 1) return `${roles.slice(0, -1).map(leadLabel).join(', ')} and ${leadLabel(roles[roles.length - 1])} disagree`;
  if (roles.length === 1) return `${leadLabel(roles[0])}${roles[0] === lead ? ' · your area' : ''}`;
  return '';
}

/** The reason's words for this lead; a reason with no letter or digit left counts as none, for every lead. */
function reasonOf(o, lead) {
  if (!/[A-Za-z0-9]/.test(plainWords(o.reason))) return '';
  return wordsFor({ reason: o.reason }, 'reason', lead, { strip: true, register: 'plain' });
}

/** An answer's sub line: `Security: why`, or just the name, or just the reason, or nothing. */
function subOf(o, lead) {
  const name = o.persona ? leadLabel(o.persona) : '';
  const reason = reasonOf(o, lead);
  return name && reason ? `${name}: ${reason}` : name || reason;
}

/** An item's label without its `R-x-n · ` prefix. */
const wordsOfItem = (it) => {
  const label = String(it.label ?? '');
  return it.id && label.startsWith(`${it.id} · `) ? label.slice(it.id.length + 3) : label;
};

/** The criteria check as one row per id, merged before anything is counted: criteriaCheck emits a passing and a failing
 *  item for a repeated id. `{ rows: [{ id, text, pass, detail, persona }], agreed, failing }`; an id the requirements
 *  lost has no text of its own, so its id is its label; an item with no id keeps its label and belongs to no persona. */
function agreedModel(criteria) {
  const items = criteria && Array.isArray(criteria.items) ? criteria.items : [];
  const texts = new Map((criteria && Array.isArray(criteria.criteria) ? criteria.criteria : []).map((c) => [c.id, c.text]));
  const rows = [];
  const byId = new Map();
  for (const it of items) {
    let row = it.id ? byId.get(it.id) : null;
    if (!row) {
      row = { id: it.id || null, text: it.id ? texts.get(it.id) || '' : wordsOfItem(it), pass: true, details: [], persona: it.id ? criterionPerspective(it.id) : null };
      rows.push(row);
      if (it.id) byId.set(it.id, row);
    }
    if (it.pass) row.text = row.text || wordsOfItem(it);
    else { row.pass = false; if (it.id) row.details.push(wordsOfItem(it)); }
  }
  const shaped = rows.map(({ details, ...row }) => ({ ...row, text: row.text || row.id, detail: [...new Set(details)].join(' · ') }));
  const failing = shaped.filter((r) => !r.pass).length;
  return { rows: shaped, agreed: shaped.length - failing, failing };
}

/** The personas of `rows` in order of first appearance, the lead's first and the unknown prefixes (`Other`) last. */
function personaGroups(rows, lead) {
  const groups = new Map();
  for (const row of rows) {
    if (!groups.has(row.persona)) groups.set(row.persona, { persona: row.persona, label: row.persona ? leadLabel(row.persona) : 'Other', rows: [] });
    groups.get(row.persona).rows.push(row);
  }
  const rank = (g) => (!g.persona ? 2 : g.persona === lead ? 0 : 1);
  return [...groups.values()].sort((a, b) => rank(a) - rank(b));
}

export function renderRequirementsBody(panel, pq, deps) {
  const { doc } = deps;
  const plan = pq.plan || {};
  const error = plan.error || null;
  const criteria = error ? null : plan.criteria || null;
  const decisions = !error && Array.isArray(plan.decisions) ? plan.decisions : [];
  const model = agreedModel(criteria);
  const { agreed, failing } = model;
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
  const count = decisions.length;
  const paintSub = (lead) => {
    const need = !count ? 'No decisions need you' : count === 1 ? '1 decision needs you' : `${count} decisions need you`;
    sub.textContent = `${need}${lead ? ` · as ${leadLabel(lead)}` : ''}`;
  };
  paintSub(plan.lead || null);

  const slot = h('div', 'shape-reqs-decisions');
  body.appendChild(slot);

  let lead = plan.lead || null;
  let agreedFold = null;
  if (error) {
    body.appendChild(toElement(doc, emptyState({ title: 'Could not load the requirements.', text: error.message || '', error: true })));
  } else if (!agreed && !failing) {
    body.appendChild(toElement(doc, emptyState({ title: 'No requirements were written.' })));
  } else {
    const foldText = () => [
      `${agreed} agreed`, ...(failing ? [`${failing} to fix`] : []),
      ...personaGroups(model.rows, lead).map((g) => `${g.label} ${g.rows.length}`),
    ].join(' · ');
    // Unfolded, a persona with a failing row comes first, and so does the failing row inside its group.
    const foldRows = () => {
      const list = h('dl', 'shape-reqs-agreed');
      const failed = (g) => g.rows.some((r) => !r.pass);
      const groups = personaGroups(model.rows, lead);
      for (const g of [...groups.filter(failed), ...groups.filter((x) => !failed(x))]) {
        const rows = h('dd');
        rows.append(...buildCheckRows(doc, { items: [...g.rows.filter((r) => !r.pass), ...g.rows.filter((r) => r.pass)].map((r) => ({
          id: r.id, label: r.text, pass: r.pass, detail: r.detail, ...(r.id && r.text !== r.id ? { tip: r.id } : {}),
        })) }));
        list.append(h('dt', '', g.label), rows);
      }
      return [list];
    };
    agreedFold = buildCheckFold(doc, criteria, undefined, { text: foldText, rows: foldRows, open: failing > 0 });
    body.append(agreedFold.line, agreedFold.rows);
  }

  const typed = plan.revisable ? buildFeedbackRow(doc, { label: 'Changes to the requirements', primary: true, onSend: (text) => {
    if (!text) { setErrors([{ path: 'feedback', message: 'Write what should change first' }]); return; }
    send({ decision: 'revise', feedback: text, decisions: picks() });
  } }) : null;
  if (typed) { typed.row.hidden = true; body.appendChild(typed.row); }

  const foot = h('div', 'qpanel-foot plan-actions');
  const note = h('span', 'qanswered');
  note.id = `shape-reqs-note-${++whySeq}`;
  // Open, the field takes over: the foot hides, so Send changes is the only primary. While a requirement fails, Ask for
  // changes is the way on, so it is the primary and Agree and plan a plain button.
  // The host's bar mirrors the foot's primary, so each change tells it (step-primary).
  const primaryChanged = () => panel.dispatchEvent(new doc.defaultView.CustomEvent('step-primary', { bubbles: true }));
  if (typed) {
    foot.appendChild(swapOpen(btn(`${failing ? 'btn-primary' : 'btn-quiet'} plan-ask-changes`, 'Ask for changes'), typed.row, typed.cancel,
      () => { foot.hidden = true; typed.typed.focus(); primaryChanged(); }, () => { foot.hidden = false; primaryChanged(); }));
  }
  let agree = null;
  if (error) {
    const retry = btn('btn-primary plan-retry', 'Try again');
    retry.addEventListener('click', (e) => { e.stopPropagation(); send({ decision: 'retry' }); });
    foot.appendChild(retry);
  } else {
    agree = btn(`${failing ? '' : 'btn-primary '}plan-approve`, 'Agree and plan');
    const hint = typed ? ': ask for changes' : '';
    const reason = !agreed && !failing ? `Nothing to agree yet${hint}` : failing ? `${failing} to fix${hint}` : '';
    // aria-disabled, not disabled: it stays in the tab order, keeps its words, and setPanelBusy cannot re-enable it
    let waiting = decisions.length > 0;            // the decisions are not on screen yet
    const syncAgree = () => {
      const shown = reason || (waiting ? 'Loading your role…' : '');
      if (shown || waiting) agree.setAttribute('aria-disabled', 'true'); else agree.removeAttribute('aria-disabled');
      if (shown) { agree.title = shown; agree.setAttribute('aria-describedby', note.id); } else { agree.removeAttribute('title'); agree.removeAttribute('aria-describedby'); }
      note.textContent = shown;
      // A failing card that can be revised says why in Ask for changes being the primary; the note only describes the button.
      note.hidden = !shown || (failing > 0 && !!typed);
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
  primaryChanged();
  panel.__plan = { setErrors };

  if (!decisions.length || error) return;
  const paintDecisions = (known) => {
    if (list) return;
    lead = known;
    paintSub(lead);
    if (agreedFold) agreedFold.update(criteria);
    list = buildChatQuestion(doc, {
      id: `req-${pq.id || 'q'}`,
      heading: 'Decisions',
      head: false,
      numbers: false,
      questions: decisions.map((d) => {
        const options = Array.isArray(d.options) ? d.options : [];
        return {
          id: d.id, text: d.text, plain: d.plain, why: options.some((o) => o.persona || o.reason) ? '' : whyOf(d.from, lead),
          options: options.map((o) => ({ value: o.value, label: o.label, plain: o.plain, sub: subOf(o, lead), recommended: o.value === d.recommended })),
        };
      }),
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
