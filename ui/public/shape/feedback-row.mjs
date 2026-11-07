// ui/public/shape/feedback-row.mjs — Ask for changes' typed row, one module for the plan card (plan-body.mjs) and the
// Requirements card (requirements-body.mjs), so neither card imports the other for it.

/** Ask for changes' typed row, shared by the plan card and the Requirements card: the field, Cancel and Send changes.
 *  `onSend(text)` gets the trimmed text (maybe empty: the caller says what to do then). `primary: true` makes Send
 *  changes the primary, for a card that hides its foot while the field is open. */
export function buildFeedbackRow(doc, { label, onSend, primary = false }) {
  const h = (tag, cls, text) => { const e = doc.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
  const btn = (cls, text) => { const b = h('button', `btn btn-sm ${cls}`, text); b.type = 'button'; return b; };
  const typed = h('textarea', 'plan-feedback');
  typed.rows = 2;
  typed.placeholder = 'Ask for changes in your own words…';
  typed.setAttribute('aria-label', label);
  const cancel = btn('btn-quiet plan-typed-cancel', 'Cancel');
  const sendBtn = btn(primary ? 'btn-primary plan-revise' : 'plan-revise', 'Send changes');
  sendBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    onSend(typed.value.trim());
  });
  const acts = h('div', 'plan-typed-acts'); acts.append(cancel, sendBtn);
  const row = h('div', 'plan-typed'); row.append(typed, acts);
  return { row, typed, cancel };
}
