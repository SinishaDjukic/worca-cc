// src/core/ask/redact.mjs
// Best-effort secret redaction for the Ask Worca chat (ask-worca-design.md §6.1):
// the messenger patterns of chat/redact.mjs plus the credential shapes most
// likely to sit in a diff or an attachment. Pattern matching, NOT a guarantee —
// the design documents this as a limitation; never claim more.
import { redactSecrets } from '../chat/redact.mjs';

/** Extra patterns applied after redactSecrets (order matters only for overlapping hits). */
export const ASK_EXTRA_PATTERNS = Object.freeze([
  [/\bsk-ant-[A-Za-z0-9_-]{16,}/g, 'sk-ant-<redacted>'],                       // Anthropic API keys
  [/\bghp_[A-Za-z0-9]{20,}\b/g, 'ghp_<redacted>'],                              // GitHub classic PAT
  [/\bgithub_pat_[A-Za-z0-9_]{20,}\b/g, 'github_pat_<redacted>'],               // GitHub fine-grained PAT
  [/\bAKIA[0-9A-Z]{16}\b/g, 'AKIA<redacted>'],                                  // AWS access key id
  [/-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g,
    '-----BEGIN PRIVATE KEY-----\n<redacted>\n-----END PRIVATE KEY-----'],      // PEM private keys
]);

/**
 * Redact `s` for the model / the DB. null/undefined → ''. An unterminated PEM
 * block (e.g. split across two delta batches) is not matched — the persisted
 * copy is redacted whole, which is the documented live-view limitation.
 * @param {unknown} s
 * @returns {string}
 */
export function redactAskText(s) {
  if (s == null) return '';
  let out = redactSecrets(String(s));
  for (const [re, rep] of ASK_EXTRA_PATTERNS) out = out.replace(re, rep);
  return out;
}
