// ui/public/setup-vault-choice.mjs — the setup assistant's "Secret vault" choice on the Model access step
// (docs/secrets.md). Only on a native install with the secretVault flag on, a key store that can be used and keys still
// in their files (GET /api/setup/detect `vault`, decided with no key store call: no Keychain prompt). One skippable
// choice: Keep in files (the default, nothing sent) or Move into the vault (apply runs the key store's write and read
// check, then moves them). With the vault already on, one plain line says so.
import { docsLink } from './docs-links.mjs';

export const VAULT_TITLE = 'Secret vault';
export const VAULT_LINE = 'Encrypts the keys Worca saves, with a key your OS key store holds. It is not a sandbox.';

/** The section, or null when there is nothing to offer. `value`: 'move' | 'keep' | undefined; `onPick(v)`. */
export function vaultChoiceSection({ doc, vault, value, onPick, seg, section }) {
  if (!vault || vault.state === 'container' || vault.state === 'flag-off' || vault.state === 'unavailable') return null;
  const el = (tag, cls, text) => { const n = doc.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; };
  const more = el('p', 'hint sa-vault-docs');
  more.append(docsLink(doc, 'secrets', 'Secrets and the vault'));
  if (!vault.offer) {
    return section(VAULT_TITLE, null, el('p', 'hint sa-vault-line', `On · saved keys are encrypted, with the key in ${vault.label}.`), more);
  }
  const control = seg([['keep', 'Keep in files'], ['move', 'Move into the vault']], value === 'move' ? 'move' : 'keep',
    (v) => onPick(v === 'move' ? 'move' : undefined), { label: VAULT_TITLE });
  control.classList.add('sa-vault-pick');
  const n = vault.inFiles;
  const line = el('p', 'hint sa-vault-line', value === 'move'
    ? `Worca checks ${vault.label} first, then moves ${n} saved ${n === 1 ? 'secret' : 'secrets'} into the vault.`
    : `${n} saved ${n === 1 ? 'secret stays' : 'secrets stay'} in ${n === 1 ? 'its file' : 'their files'}, readable only by your user. You can turn the vault on later in Settings.`);
  return section(VAULT_TITLE, VAULT_LINE, control, line, more);
}
