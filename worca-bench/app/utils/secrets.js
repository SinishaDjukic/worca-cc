// app/utils/secrets.js
//
// Browser-only store for grader credentials (SWE-bench API key + Modal tokens).
// These never touch the repo or the server's disk: they live solely in this
// browser's localStorage and are forwarded in the POST body on launch/regrade,
// where the server merges them into the runner subprocess's environment. All
// access is guarded — localStorage may be unavailable (private mode, quota).

const KEY = 'worca-bench:secrets';

// Allowlist of credential env-var names the dashboard knows how to forward.
// Kept in lockstep with GRADER_SECRET_KEYS in server/process-manager.js and
// SECRET_ENV_KEYS in worca_bench/worca_install.py.
export const SECRET_FIELDS = [
  {
    key: 'SWEBENCH_API_KEY',
    label: 'SWE-bench API key',
    hint: 'Hosted sb-cli grader (cloud). Get one with `sb-cli gen-api-key <email>`.',
  },
  {
    key: 'MODAL_TOKEN_ID',
    label: 'Modal token ID',
    hint: 'Modal serverless x86 grader — token id.',
  },
  {
    key: 'MODAL_TOKEN_SECRET',
    label: 'Modal token secret',
    hint: 'Modal serverless x86 grader — token secret.',
  },
];

const KEYS = SECRET_FIELDS.map((f) => f.key);

function _all() {
  try {
    const raw = localStorage.getItem(KEY);
    const parsed = raw ? JSON.parse(raw) : {};
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function _write(obj) {
  try {
    localStorage.setItem(KEY, JSON.stringify(obj));
  } catch {
    // localStorage unavailable or over quota — secrets just won't persist.
  }
}

/** All stored secrets as `{ENV_NAME: value}`, allowlisted + non-empty only. */
export function loadSecrets() {
  const all = _all();
  const out = {};
  for (const k of KEYS) {
    if (typeof all[k] === 'string' && all[k]) out[k] = all[k];
  }
  return out;
}

/**
 * Per-field "is it set?" map for status display — never returns the value
 * itself, so the UI can show "Set"/"Not set" without echoing a secret.
 */
export function secretStatus() {
  const set = loadSecrets();
  return Object.fromEntries(KEYS.map((k) => [k, Boolean(set[k])]));
}

/**
 * Merge a `{ENV_NAME: value}` patch. A field whose value is `''`/null is
 * cleared; absent fields are left untouched. Unknown keys are ignored.
 */
export function saveSecrets(patch) {
  if (!patch || typeof patch !== 'object') return;
  const all = _all();
  for (const k of KEYS) {
    if (!(k in patch)) continue;
    const v = patch[k];
    if (typeof v === 'string' && v.trim()) {
      all[k] = v.trim();
    } else {
      delete all[k];
    }
  }
  _write(all);
}

/** Remove a single stored secret. */
export function clearSecret(name) {
  if (!KEYS.includes(name)) return;
  const all = _all();
  delete all[name];
  _write(all);
}

/** Secrets to attach to a launch/regrade POST body, or undefined when none. */
export function launchSecrets() {
  const s = loadSecrets();
  return Object.keys(s).length ? s : undefined;
}
