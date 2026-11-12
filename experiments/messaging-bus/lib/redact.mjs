// experiments/messaging-bus/lib/redact.mjs — what the hook must never publish (plan §3.3 "Never auto-published", §4.3).
// The product's src/core/redact.mjs covers only `wbt_` tokens, and the spike may not import src/.

const MASK = '[redacted]';

/** Secret-shaped values. Global regexes; no nested quantifiers. */
export const SECRET_PATTERNS = [
  // a BEGIN with no END (a clipped block) is masked to the end of the text
  /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?(?:-----END [A-Z ]*PRIVATE KEY-----|$)/g,
  /\bwbt_[A-Za-z0-9_-]{8,}/g,
  /\bgithub_pat_[A-Za-z0-9_]{20,}/g,
  /\bgh[poasu]_[A-Za-z0-9]{20,}/g,
  /\bsk-ant-[A-Za-z0-9_-]{10,}/g,
  /\bsk-[A-Za-z0-9_-]{20,}/g,
  /\bAKIA[0-9A-Z]{16}\b/g,
  /\bxox[abprs]-[A-Za-z0-9-]{10,}/g,
];

const USERINFO = /\b([a-z][a-z0-9+.-]*:\/\/)[^\s/@]+@/gi;
// no word boundary before the key: GITHUB_TOKEN=, DB_PASSWORD: and apiToken: are keys too
const KEY_VALUE = /(token|secret|password|api[_-]?key)(\s*[:=]\s*)\S+/gi;

/**
 * Secret-shaped values and URL userinfo only. E7's replay fixture uses this for its hunk bodies: the
 * key = value rule below also rewrites ordinary code (`token: newUiToken()`), which would break the
 * replay's final-blob check.
 */
export function redactSecretValues(s) {
  let out = String(s ?? '');
  for (const p of SECRET_PATTERNS) out = out.replace(p, MASK);
  return out.replace(USERINFO, (_, scheme) => `${scheme}${MASK}@`);
}

export function redactText(s) {
  return redactSecretValues(s).replace(KEY_VALUE, (_, k, sep) => `${k}${sep}${MASK}`);
}

/** `.env*`, `*.pem`, `*.key`, `id_rsa*`, `*credentials*`, `.npmrc`, `.netrc` (any directory). */
export function isSecretPath(path) {
  const name = String(path ?? '').split('/').pop().toLowerCase();
  return name.startsWith('.env') || name.endsWith('.pem') || name.endsWith('.key') || name.startsWith('id_rsa')
    || name.includes('credentials') || name === '.npmrc' || name === '.netrc';
}
