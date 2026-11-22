// src/core/secrets/refs.mjs — Worca vault references, the closed set of owner stores, the owner check and the
// vault's refusal error. Pure (node:crypto only), so the stores of later slices can recognise a reference
// synchronously without loading the crypto, the lock or the OS key store. A reference carries no owner: the
// owner lives inside the encrypted entry, and the vault compares it on every use.
import { createHash, randomBytes } from 'node:crypto';

export const VAULT_REF_PREFIX = 'worca:vault:v1:';
export const VAULT_STORES = Object.freeze(['settings', 'mcp', 'plugin', 'proxy']);

const REF_RE = /^worca:vault:v1:[A-Za-z0-9_-]{22}$/;
const MAX_FIELD = 256;

/** Whether `value` is exactly a Worca vault reference. */
export function isVaultRef(value) {
  return typeof value === 'string' && REF_RE.test(value);
}

/** A fresh reference: the prefix plus 16 random bytes in base64url (22 characters). */
export function newVaultRef() {
  return VAULT_REF_PREFIX + randomBytes(16).toString('base64url');
}

/** The id part of a reference, or null when `ref` is not one. */
export function refId(ref) {
  return isVaultRef(ref) ? ref.slice(VAULT_REF_PREFIX.length) : null;
}

/** The refusal table: `VaultError.code` → the message the user sees. N and NAME are filled from the options. */
export const VAULT_MESSAGES = Object.freeze({
  'store-unavailable': 'no OS key store is available for the Worca vault',
  'store-locked': 'the OS key store is locked or did not answer in time',
  'item-missing': 'the vault key is missing from the OS key store; the vault cannot be read',
  'wrong-key': 'the vault was encrypted with a different key; it was not used',
  'tampered': 'the vault file was changed outside Worca or is damaged; it was not used',
  'unsupported-format': 'the vault file was written by a newer Worca (format N)',
  'bad-ref': 'not a Worca vault reference',
  'unknown-ref': 'the vault has no entry for this reference',
  'cross-owner': 'this vault reference belongs to another setting; it was not used',
  'bad-owner': 'invalid vault owner',
  'bad-value': 'invalid vault value',
  'lock-busy': 'another Worca process holds the vault lock; try again',
  'lock-nested': 'the vault lock is already held by this operation',
  'lock-order': 'cannot wait on the NAME lock while holding the vault lock',
  'aside-exists': 'a moved-aside vault of that name already exists; try again',
  'store-check': 'the OS key store did not pass its write and read check; nothing was moved',
  'changed': 'a secret changed while exporting; nothing was removed',
});

/**
 * A vault refusal. Fixed messages only: it never carries a cause, a value, a key, a ciphertext or a path.
 * `format` (an integer) fills `unsupported-format`; `name` (a lock name from code) fills `lock-order`.
 */
export class VaultError extends Error {
  constructor(code, { reason, format, name } = {}) {
    const text = VAULT_MESSAGES[code] ?? 'the Worca vault refused the operation';
    super(text.replace('format N', `format ${Number.isInteger(format) ? format : 'N'}`).replace('NAME', String(name ?? 'other')));
    this.name = 'VaultError';
    this.code = code;
    if (reason !== undefined) this.reason = reason;
  }
}

/**
 * The owner field of a record in a store with nested keys (MCP `SERVERID/FIELDKEY`, plugin `NAME/PROFILE/FIELDKEY`):
 * the parts joined with `/`, or `sha256:` plus the join's hex digest when the join is longer than the owner limit, so
 * every owner passes checkOwner.
 */
export function ownerField(parts) {
  const joined = parts.map(String).join('/');
  return joined.length > MAX_FIELD ? 'sha256:' + createHash('sha256').update(joined).digest('hex') : joined;
}

/** The action for a locked store, shared by the status lines and every refused save. */
export const UNLOCK_LINE = 'Unlock the OS key store, then run `worca secrets status` again.';

/** The action text appended to a vault refusal (with its leading space): unlock for a locked store, else status. */
export function vaultActionLine(reason) {
  return reason === 'store-locked' ? ` ${UNLOCK_LINE}` : ' Run `worca secrets status` to see why.';
}

/** null when `{ store, field }` names a valid owner, else the `bad-owner` refusal. */
export function checkOwner({ store, field } = {}) {
  const ok = VAULT_STORES.includes(store) && typeof field === 'string' &&
    field.length >= 1 && field.length <= MAX_FIELD && !/\p{Cc}/u.test(field);
  return ok ? null : { code: 'bad-owner', message: VAULT_MESSAGES['bad-owner'] };
}
