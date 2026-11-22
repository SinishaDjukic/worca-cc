// ui/public/settings/secrets-row.mjs
// The About card's Secrets row (secretVault flag): the OS key store that would hold the vault key, its state in the
// existing About pill, and one action note only when the person must act. Each fact once: the backend in the
// value, the state in the pill, the action in the note. Below them, while one is pending, the message about secrets
// moved into the vault (the moved keys) with its Got it button. Split out of app.js so a test can drive it against
// the real #about-card markup. The flag gate lives here; with it off the row stays hidden and nothing is fetched.
import { flagOn } from '../flags.mjs';
import { notify as realNotify } from '../feedback.mjs';
import { keyName, noticeLines } from '../../../src/shared/secrets-notice.mjs';

const PILL = Object.freeze({ ready: 'Ready', locked: 'Locked', unavailable: 'Unavailable' });
const NOTE = Object.freeze({
  locked: 'Unlock the OS key store (it may be asking for your password), then reopen Settings.',
  unavailable: 'Set up an OS key store on this machine (Keychain, Credential Manager or a Secret Service), then reopen Settings.',
  unreadable: 'Run `worca secrets reset` in a terminal to move the unreadable vault aside and start a new one.',
});
// The row shows only with the flag on: while the store is not ready and no vault exists, saves go to the config file.
const VAULT_INACTIVE = 'The vault is not active: keys are saved in settings.json, protected by its file permissions.';

/** Paint `status` (GET /api/secrets/status) into the row, or hide the row when there is none. */
export function paintSecretsRowInto(doc, status) {
  const row = doc.getElementById('aboutSecretsRow');
  if (!row) return;
  const label = doc.getElementById('aboutSecretsBackend');
  const pill = doc.getElementById('aboutSecretsState');
  const note = doc.getElementById('aboutSecretsNote');
  if (!status || typeof status.label !== 'string' || !PILL[status.state]) { row.hidden = true; return; }
  const unreadable = status.state === 'ready' && status.vault === 'unreadable';
  label.textContent = status.label;
  pill.textContent = unreadable ? 'Vault unreadable' : PILL[status.state];
  if (unreadable || status.state !== 'ready') pill.dataset.state = 'warn';
  else delete pill.dataset.state;
  const action = unreadable ? NOTE.unreadable : NOTE[status.state];
  const text = action && status.state !== 'ready' && status.vault === 'none' ? `${action} ${VAULT_INACTIVE}` : action;
  note.textContent = text ?? '';
  note.hidden = !text;
  row.hidden = false;
}

/**
 * Paint `notice` (GET /api/secrets/notice) into the callout, with textContent only, or hide it when there is none.
 * The wording is the shared builder's Settings surface: no backend label (the row shows it) and no action line.
 */
export function paintSecretsNoticeInto(doc, notice) {
  const box = doc.getElementById('aboutSecretsNotice');
  if (!box) return;
  const keys = Array.isArray(notice?.keys) ? notice.keys.map(keyName).filter(Boolean) : [];
  if (!notice || typeof notice.id !== 'string' || !keys.length) { box.hidden = true; delete box.dataset.id; return; }
  const lines = noticeLines(notice, { surface: 'settings' });
  // lines: the moved sentence, the list sentence, one "  - NAME" per key, then the optional left sentence.
  doc.getElementById('aboutSecretsNoticeText').textContent = `${lines[0]} ${lines[1]}`;
  const list = doc.getElementById('aboutSecretsNoticeKeys');
  list.replaceChildren(...keys.map((k) => { const li = doc.createElement('li'); li.textContent = k; return li; }));
  const left = doc.getElementById('aboutSecretsNoticeLeft');
  const leftLine = lines.length > 2 + keys.length ? lines[2 + keys.length] : '';
  left.textContent = leftLine;
  left.hidden = !leftLine;
  box.dataset.id = notice.id;
  box.hidden = false;
}

const defaultPost = (url, body) => fetch(url, {
  method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
}).then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))));

// Got it: POST the shown id, hide the callout and move focus to the backend label; a failed POST keeps it shown.
function wireAck(doc, { postJson, notify }) {
  const btn = doc.getElementById('aboutSecretsNoticeAck');
  if (!btn || btn.dataset.wired) return;
  btn.dataset.wired = '1';
  btn.addEventListener('click', async () => {
    const box = doc.getElementById('aboutSecretsNotice');
    const id = box?.dataset.id;
    if (!id) return;
    try {
      await postJson('/api/secrets/notice/ack', { id });
    } catch {
      notify({ tone: 'warn', title: 'Not saved', detail: 'The message stays until Got it is saved. Try again, or run worca secrets ack.' }, { doc });
      return;
    }
    box.hidden = true;
    delete box.dataset.id;
    const after = doc.getElementById('aboutSecretsBackend');
    if (after) { if (!after.hasAttribute('tabindex')) after.setAttribute('tabindex', '-1'); after.focus(); }
  });
}

/**
 * Fetch and paint the row (and a pending notice) each time Settings opens. `fetchJson(url)` resolves the parsed body
 * or rejects; a failure keeps the row (or the callout) hidden. Nothing is fetched while the secretVault flag is off.
 * `postJson(url, body)` and `notify` are injectable for tests.
 */
export async function loadSecretsRow(doc, fetchJson, { postJson = defaultPost, notify = realNotify } = {}) {
  if (!flagOn('secretVault', doc)) { paintSecretsRowInto(doc, null); paintSecretsNoticeInto(doc, null); return; }
  wireAck(doc, { postJson, notify });
  let status = null;
  try { status = await fetchJson('/api/secrets/status'); } catch { status = null; }
  paintSecretsRowInto(doc, status);
  let notice = null;
  try { notice = (await fetchJson('/api/secrets/notice'))?.notice ?? null; } catch { notice = null; }
  paintSecretsNoticeInto(doc, notice);
}
