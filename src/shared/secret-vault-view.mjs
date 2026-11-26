// src/shared/secret-vault-view.mjs — the secret vault's state in plain words, one model for Settings › General › Secret
// vault, the Security card's "Secrets at rest" row and the setup assistant (docs/secrets.md). Pure: it takes the status
// (GET /api/secrets/status) and the counts by kind (src/core/secrets/summary.mjs) and never sees a value or a name.
// Tones follow docs/design-system.md: `ok` (green) only for a protection that is active, `neutral` (grey) for a plain
// value, `attention` (amber) only where someone must act.

/** The kinds in display order, with their words (one, many). */
export const KIND_WORDS = Object.freeze({
  settings: ['provider or model key', 'provider and model keys'],
  mcp: ['MCP secret', 'MCP secrets'],
  plugin: ['plugin secret', 'plugin secrets'],
  proxy: ['proxy login', 'proxy logins'],
});
export const KINDS = Object.freeze(Object.keys(KIND_WORDS));

const n = (side, k) => Math.max(0, Number(side?.[k]) || 0);
export const totalOf = (side) => KINDS.reduce((s, k) => s + n(side, k), 0);

/** "2 provider and model keys, 1 MCP secret" (kinds with a count only), or '' for none. */
export function kindsLine(side) {
  return KINDS.filter((k) => n(side, k) > 0).map((k) => `${n(side, k)} ${KIND_WORDS[k][n(side, k) === 1 ? 0 : 1]}`).join(', ');
}

/**
 * The card's model. `status` is the route's answer (state ready | locked | unavailable | container; vault none |
 * readable | unreadable | unknown); `counts` `{ vault, files }`.
 * @returns {{state: string, value: string, tone: 'ok'|'neutral'|'attention', detail: string, primary: null|'turn-on'|'finish'|'reset'|'check'}}
 */
export function vaultModel(status, counts = {}) {
  const inVault = totalOf(counts.vault);
  const inFiles = totalOf(counts.files);
  const label = status?.label || 'the OS key store';
  if (!status || status.state === 'container') {
    return { state: 'container', value: 'Not available', tone: 'neutral', primary: null,
      detail: 'A container has no OS key store, so the vault does nothing here. The credential broker keeps keys out of the box.' };
  }
  if (status.state === 'locked') {
    return { state: 'locked', value: 'Locked', tone: 'attention', primary: 'check',
      detail: `${label} is locked. Unlock it (it may be asking for your password), then check again.` };
  }
  if (status.state === 'unavailable') {
    return { state: 'unavailable', value: 'No key store', tone: 'attention', primary: 'check',
      detail: inVault ? 'No OS key store answers, so the saved keys in the vault cannot be read. Set one up, then check again.'
        : 'No OS key store answers on this machine. Keys stay in their files, readable only by your user.' };
  }
  if (status.vault === 'unreadable') {
    return { state: 'unreadable', value: 'Unreadable', tone: 'attention', primary: 'reset',
      detail: 'The vault cannot be opened with the key in the key store. Reset moves it aside so a new one can start.' };
  }
  if (inVault > 0 && inFiles > 0) {
    return { state: 'interrupted', value: 'Move not finished', tone: 'attention', primary: 'finish',
      detail: `${inFiles} saved ${inFiles === 1 ? 'secret is' : 'secrets are'} still in their files. Finish moving them into the vault.` };
  }
  if (inVault === 0 && inFiles > 0) {
    return { state: 'off', value: 'Off', tone: 'neutral', primary: 'turn-on',
      detail: 'Saved keys are in their files, readable only by your user. Turn on moves them into the vault.' };
  }
  return { state: 'on', value: 'On', tone: 'ok', primary: null,
    detail: inVault ? `Saved keys are encrypted. The key that opens them is in ${label}.` : `New keys you save are encrypted. The key is in ${label}.` };
}

/**
 * The "Secrets at rest" posture row, or null when the vault plays no part (flag off and no vault in use).
 * `where` is the posture's (native | container | hardened | hosted); `vaultOn` true when the vault holds secrets here.
 */
export function secretsAtRestRow({ where, flagOn, vaultOn }) {
  if (!flagOn && !vaultOn) return null;
  if (where !== 'native') {
    return { id: 'secrets', label: 'Secrets at rest', status: 'off', value: 'Files (0600)', tone: 'neutral',
      detail: 'In their config files, readable only by Worca\'s user. The secret vault is not available in a container.' };
  }
  if (vaultOn) {
    return { id: 'secrets', label: 'Secrets at rest', status: 'on', value: 'Vault', tone: 'ok',
      detail: 'Encrypted in the secret vault. Its key is in the OS key store. Agents that run as you can still reach it.' };
  }
  return { id: 'secrets', label: 'Secrets at rest', status: 'off', value: 'Files (0600)', tone: 'neutral',
    detail: 'In their config files, readable only by your user.' };
}
