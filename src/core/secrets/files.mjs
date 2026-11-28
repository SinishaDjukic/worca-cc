// src/core/secrets/files.mjs
// The names of Worca's secret files, in one place: the agent deny rules written now (guardrails, Ask)
// and the files later vault slices create can never drift apart. Pure, no imports, so the guardrail and
// Ask modules can take the names without pulling the flags and settings chain.

/** The encrypted vault. */
export const VAULT_FILE = 'worca-vault.enc';
/** The WSL2 wrapped key beside the vault. */
export const WRAPPED_KEY_FILE = 'worca-vault.key';
/** Every vault file name starts with this. */
export const VAULT_NAME_PREFIX = 'worca-vault';
/** The cross-process vault lock beside the vault. */
export const VAULT_LOCK_FILE = VAULT_NAME_PREFIX + '.lock';
/** The cross-process lock of the one-time secret migration (migrate.mjs), beside the vault. */
export const MIGRATE_LOCK_FILE = VAULT_NAME_PREFIX + '.migrate.lock';
/** A moved-aside vault is `VAULT_FILE + VAULT_ASIDE_INFIX + <UTC stamp>`. */
export const VAULT_ASIDE_INFIX = '.unreadable-';
/** The pending one-time message about secrets moved into the vault (notice.mjs), in the Worca home. */
export const NOTICE_FILE = 'secrets-notice.json';
/** The saved proxy login; equal to PROXY_LOGIN_FILE in src/core/proxy-credentials.mjs (pinned by a test). */
export const PROXY_LOGIN_BASENAME = 'proxy-login.json';

/** Basename globs (show-files only): the names plus their temp and moved-aside copies. */
export const SECRET_FILE_GLOBS = Object.freeze([`${PROXY_LOGIN_BASENAME}*`, `${VAULT_NAME_PREFIX}*`]);
/** Root-anchored forms for every permission rule: a slash-less or `**\/` rule is cwd-relative in Claude Code. */
export const SECRET_FILE_RULE_PATHS = Object.freeze(SECRET_FILE_GLOBS.map((g) => `//**/${g}`));

/** Whether `basename` is one of Worca's secret files (or a temp or moved-aside copy). Case-insensitive. */
export function isSecretFileName(basename) {
  const b = String(basename ?? '').toLowerCase();
  return b.startsWith(PROXY_LOGIN_BASENAME) || b.startsWith(VAULT_NAME_PREFIX);
}
