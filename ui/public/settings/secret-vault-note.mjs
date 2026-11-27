// ui/public/settings/secret-vault-note.mjs — the one note under a secret field (a provider key, an MCP or plugin
// secret, the proxy password) while the secret vault keeps what is typed there: "Stored in the secret vault." Only with
// the secretVault flag on and a key store that works here (not in a container, not locked, not missing). The field and
// its masked display stay as they are. One status read per page load, shared by every field.
import { flagOn } from '../flags.mjs';

export const VAULT_NOTE_TEXT = 'Stored in the secret vault.';
let pending = null;

/** Whether a save goes into the vault now (GET /api/secrets/status), cached for the page; false on any failure. */
export function vaultTakesSaves(doc = globalThis.document, fetchFn = (u) => fetch(u)) {
  if (!flagOn('secretVault', doc)) return Promise.resolve(false);
  pending ??= Promise.resolve()
    .then(() => fetchFn('/api/secrets/status'))
    .then((r) => (r && r.ok ? r.json() : null))
    .then((s) => !!s && s.state === 'ready' && s.vault !== 'unreadable')
    .catch(() => false);
  return pending;
}

/** Tests and a status change (Turn on, Reset) drop the cached answer. */
export function forgetVaultNoteStatus() { pending = null; }

/**
 * Add the note once the answer is in; at most one per field. In a divided row (.drow) it is the row's help line under
 * its label (docs/design-system.md, form rows); elsewhere it follows the field. Never throws.
 */
export function addVaultNote(input, { fetchFn } = {}) {
  const doc = input?.ownerDocument;
  if (!doc || !flagOn('secretVault', doc)) return;
  vaultTakesSaves(doc, fetchFn).then((yes) => {
    const host = input.parentElement;
    if (!yes || !host) return;
    const row = input.closest('.drow');
    const label = row ? row.querySelector(':scope > .drow-label') : null;
    if ((label ? row : host).querySelector('.sv-field-note')) return;
    const n = doc.createElement('small');
    n.className = label ? 'hint drow-help sv-field-note' : 'hint sv-field-note';
    n.textContent = VAULT_NOTE_TEXT;
    if (label) label.after(n); else input.after(n);
  }, () => {});
}
