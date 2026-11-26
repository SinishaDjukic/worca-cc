// src/core/secrets/last-status.mjs — the server's last secret vault status (GET /api/secrets/status, the start probe),
// kept so the chat can read it without asking the OS key store itself (no Keychain prompt from a chat turn). Holds the
// status object only: state, backend label, vault state, a fixed message code, the time. Never a value or a key.

let last = null;

/** Keep `status` (the route's answer) as the last one; anything that is not an object is ignored. */
export function noteLastStatus(status) {
  if (status && typeof status === 'object' && typeof status.state === 'string') {
    last = { state: status.state, label: typeof status.label === 'string' ? status.label : null,
      vault: typeof status.vault === 'string' ? status.vault : 'unknown', checkedAt: typeof status.checkedAt === 'string' ? status.checkedAt : null };
  }
}

/** The last status, or null before the first check. */
export function lastStatus() { return last; }

/** Tests. */
export function _resetLastStatus() { last = null; }
