// app/utils/run-prefs.js
//
// Per-profile persistence of the "Run options" launcher controls (reps, max
// tests, max parallel, canary, engine modes) in the browser's localStorage, so
// a page reload restores what the user last set instead of snapping back to the
// profile defaults. Values are stored in their raw control form (strings for
// the number inputs, radio values like 'on'/'off'/'structural') keyed by
// profile name. All access is guarded — localStorage may be unavailable
// (private mode, quota) and persistence is best-effort, never fatal.

const KEY = 'worca-bench:run-options';

function _all() {
  try {
    const raw = localStorage.getItem(KEY);
    const parsed = raw ? JSON.parse(raw) : {};
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

/** Saved run-option controls for a profile, or `{}` when none/unavailable. */
export function loadRunPrefs(profile) {
  if (!profile) return {};
  const v = _all()[profile];
  return v && typeof v === 'object' ? v : {};
}

/** Persist the raw control values for a profile (best-effort). */
export function saveRunPrefs(profile, prefs) {
  if (!profile) return;
  try {
    const all = _all();
    all[profile] = prefs;
    localStorage.setItem(KEY, JSON.stringify(all));
  } catch {
    // localStorage unavailable or over quota — settings just won't persist.
  }
}
