// ui/public/credentials-view.mjs
// Pure DOM renderer for the Settings "My model credentials" card
// (docs/credential-broker.md). Same contract as chat-settings-view.mjs: a detached
// element, no fetch, no listeners — app.js owns I/O and mounting; node:test drives
// it via jsdom. Status only: which of the signed-in person's credential slots hold a
// key, as the credential broker reports it (GET /api/credentials). Keys are entered
// on the broker's own key page, never here.

function h(doc, tag, cls, text) {
  const n = doc.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
}

export const CREDENTIAL_STATE_TEXT = Object.freeze({
  set: 'Set', missing: 'Not set', invalid: 'Rejected', keyless: 'No key needed', operator: 'Provided by the team',
});
const STATE_TONE = Object.freeze({ set: 'green', missing: 'slate', invalid: 'red', keyless: 'blue', operator: 'blue' });

/**
 * @param {{enabled:boolean, mode?:string, keyPage?:string|null, person?:string|null, slots?:object[], error?:string}} data
 * @param {Document} [doc]
 * @returns {HTMLElement}
 */
export function renderCredentials(data, doc = document) {
  const box = h(doc, 'div', 'cred-view');
  if (data?.error) {
    box.append(h(doc, 'p', 'hint err', `The credential broker didn't answer: ${data.error}`));
    return box;
  }
  if (data?.mode === 'single') {
    box.append(h(doc, 'p', 'hint', 'Model keys are held by the credential broker. To change them, update the broker\'s secrets and restart it.'));
  } else if (!data?.person) {
    box.append(h(doc, 'p', 'hint', 'Sign in through your team\'s sign-in page to see your credentials.'));
    return box;
  }
  const list = h(doc, 'ul', 'cred-list');
  for (const s of data.slots || []) {
    const text = s.state === 'set' && s.suffix ? `Set ••••${s.suffix}` : (CREDENTIAL_STATE_TEXT[s.state] || s.state);
    const row = h(doc, 'li', 'cred-row');
    row.append(h(doc, 'span', 'cred-name', s.label || s.id), h(doc, 'span', `cred-chip tone-${STATE_TONE[s.state] || 'slate'}`, text));
    list.append(row);
  }
  box.append(list);
  if (data.mode === 'multi' && data.keyPage) {
    const missing = (data.slots || []).some((s) => s.state === 'missing' || s.state === 'invalid');
    const actions = h(doc, 'div', 'cred-actions');
    const a = h(doc, 'a', `btn ${missing ? 'btn-primary' : 'btn-ghost'} btn-mini`, 'Manage keys');
    a.href = data.keyPage;
    a.target = '_blank';
    a.rel = 'noopener';
    actions.append(a, h(doc, 'small', 'hint', 'Opens the key page in a new tab. Reopen Settings afterwards to see the change.'));
    box.append(actions);
  }
  return box;
}
