// ui/public/credentials-view.mjs
// Pure DOM renderer for the Settings "My credentials" card
// (docs/credential-broker.md). Same contract as chat-settings-view.mjs: a detached
// element, no fetch, no listeners — app.js owns I/O and mounting; node:test drives
// it via jsdom. Status only: which of the signed-in person's credential slots hold a
// key, as the credential broker reports it (GET /api/credentials): their model keys and,
// with "push as me" on, their GitHub. Keys are entered on the broker's own key page,
// never here.

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

/** The broker's "push as me" slot (src/broker/slots.mjs): GitHub, not a model key. */
export const isGithubSlot = (s) => s?.id === 'github' || s?.protocol === 'github';

const GITHUB_STATE_TEXT = Object.freeze({ set: 'Connected', missing: 'Not connected', invalid: 'Rejected' });

/** What connecting GitHub does, by WORCA_GH_AS_PERSON mode. */
function githubNote(mode) {
  const what = 'Worca clones, pushes and creates PRs as you with it, for what you do and the runs you start.';
  return mode === 'required'
    ? `${what} Until you connect it, your pushes and pull requests fail.`
    : `${what} Until you connect it, Worca uses its own GitHub credential.`;
}

function slotRow(doc, s, label, text) {
  const row = h(doc, 'li', 'cred-row');
  row.append(h(doc, 'span', 'cred-name', label), h(doc, 'span', `cred-chip tone-${STATE_TONE[s.state] || 'slate'}`, text));
  return row;
}

/**
 * @param {{enabled:boolean, mode?:string, keyPage?:string|null, person?:string|null, slots?:object[], githubAsPerson?:string|null, error?:string}} data
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
  const slots = data.slots || [];
  const models = slots.filter((s) => !isGithubSlot(s));
  // GitHub ("push as me", docs/credential-broker.md) only when worca uses it: WORCA_GH_AS_PERSON on.
  const github = data.githubAsPerson ? slots.find(isGithubSlot) || null : null;

  const group = (title) => {
    const g = h(doc, 'div', 'cred-group');
    if (data.githubAsPerson) g.append(h(doc, 'h3', 'cred-group-title', title));
    return g;
  };

  const m = group('Models');
  const list = h(doc, 'ul', 'cred-list');
  for (const s of models) {
    list.append(slotRow(doc, s, s.label || s.id, s.state === 'set' && s.suffix ? `Set ••••${s.suffix}` : (CREDENTIAL_STATE_TEXT[s.state] || s.state)));
  }
  m.append(list);
  box.append(m);

  if (data.githubAsPerson) {
    const g = group('GitHub');
    if (github) {
      const gl = h(doc, 'ul', 'cred-list');
      const text = github.state === 'set' && github.suffix ? `Connected ••••${github.suffix}` : (GITHUB_STATE_TEXT[github.state] || CREDENTIAL_STATE_TEXT[github.state] || github.state);
      gl.append(slotRow(doc, github, 'Your GitHub account', text));
      g.append(gl, h(doc, 'p', 'hint cred-note', githubNote(data.githubAsPerson)));
    } else {
      g.append(h(doc, 'p', 'hint cred-note', 'Pushes and pull requests are set to go out as the person who acted, but the credential broker has no GitHub row to connect one: run it in multi mode, or set WORCA_BROKER_GITHUB_CLIENT_ID on it.'));
    }
    box.append(g);
  }

  if (data.mode === 'multi' && data.keyPage) {
    // A missing model key blocks runs on it; GitHub only blocks pushes when it is required.
    const needed = models.some((s) => s.state === 'missing' || s.state === 'invalid')
      || (github && data.githubAsPerson === 'required' && github.state !== 'set');
    const actions = h(doc, 'div', 'cred-actions');
    const a = h(doc, 'a', `btn ${needed ? 'btn-primary' : ''} btn-sm`.replace(/\s+/g, ' '), 'Manage keys');
    a.href = data.keyPage;
    a.target = '_blank';
    a.rel = 'noopener';
    actions.append(h(doc, 'small', 'hint cred-actions-hint', 'Opens the key page in a new tab. Reopen Settings afterwards to see the change.'), a);
    box.append(actions);
  }
  return box;
}
