// app/utils/regrade-dialog.js — pick the grading backend for a regrade.
//
// Mirrors confirm-dialog.js: a single global <sl-dialog> lives in the app shell;
// showRegradeDialog() stores the pending request, rerenders, then opens it. The
// dialog offers the three real grade backends (local Docker / SWE-bench cloud /
// Modal) and remembers the last pick in localStorage so future regrades default
// to it. The chosen mode is read from the DOM at confirm time (lit-html is
// stateless) and handed to onConfirm(mode).

import { html, nothing } from 'lit-html';

const MODE_KEY = 'worca-bench:regrade-mode';
const DEFAULT_MODE = 'sb-cli';

export const REGRADE_MODES = [
  {
    value: 'local-docker',
    label: 'Local (Docker)',
    hint: 'Run the SWE-bench harness in local Docker. Free, but Verified images are x86 — unreliable on Apple Silicon.',
  },
  {
    value: 'sb-cli',
    label: 'SWE-bench Cloud (sb-cli)',
    hint: 'Hosted official grader. Needs a SWE-bench API key (Settings).',
  },
  {
    value: 'modal',
    label: 'Modal (serverless x86)',
    hint: 'Run the harness on Modal’s x86 workers. Needs Modal tokens (Settings).',
  },
];

const _VALUES = new Set(REGRADE_MODES.map((m) => m.value));

/** Last-used grade backend (defaults to sb-cli), guarded against bad storage. */
export function loadRegradeMode() {
  try {
    const v = localStorage.getItem(MODE_KEY);
    return v && _VALUES.has(v) ? v : DEFAULT_MODE;
  } catch {
    return DEFAULT_MODE;
  }
}

/** Persist the chosen backend as the new default (best-effort). */
export function saveRegradeMode(mode) {
  if (!_VALUES.has(mode)) return;
  try {
    localStorage.setItem(MODE_KEY, mode);
  } catch {
    // localStorage unavailable — the choice just won't persist.
  }
}

let _pending = null;

/**
 * Open the regrade-backend dialog.
 *
 * @param {object} opts
 * @param {string} opts.title                 dialog title (e.g. one instance, or "all of <profile>")
 * @param {(mode: string) => void} opts.onConfirm  called with the chosen backend
 * @param {() => void} rerender
 */
export function showRegradeDialog({ title, onConfirm }, rerender) {
  _pending = { title, onConfirm, mode: loadRegradeMode() };
  rerender();
  requestAnimationFrame(() => {
    document.getElementById('regrade-dialog')?.show();
  });
}

function dismiss(confirmed) {
  const dlg = document.getElementById('regrade-dialog');
  const pending = _pending;
  let mode = pending?.mode || DEFAULT_MODE;
  if (confirmed) {
    const picked = document.getElementById('regrade-mode-group')?.value;
    if (picked && _VALUES.has(picked)) mode = picked;
  }
  dlg?.hide();
  _pending = null;
  if (confirmed && pending?.onConfirm) {
    saveRegradeMode(mode);
    pending.onConfirm(mode);
  }
}

/** The dialog template — render once in the app shell. Renders nothing when idle. */
export function regradeDialogTemplate() {
  if (!_pending) return nothing;
  const { title, mode } = _pending;
  return html`
    <sl-dialog
      id="regrade-dialog"
      label=${title}
      @sl-after-hide=${() => {
        // Closing via the X / backdrop counts as cancel (clear pending once).
        if (_pending) {
          _pending = null;
        }
      }}
    >
      <p class="regrade-dialog-intro">
        Re-grade from the saved diff(s) — no pipeline re-run. Pick the grading
        backend:
      </p>
      <sl-radio-group id="regrade-mode-group" value=${mode}>
        ${REGRADE_MODES.map(
          (m) => html`<sl-radio value=${m.value}>
            <span class="regrade-mode-label">${m.label}</span>
            <span class="regrade-mode-hint">${m.hint}</span>
          </sl-radio>`,
        )}
      </sl-radio-group>
      <div
        slot="footer"
        style="display:flex; justify-content:flex-end; gap:0.5rem; width:100%"
      >
        <sl-button variant="default" @click=${() => dismiss(false)}>
          Cancel
        </sl-button>
        <sl-button variant="primary" @click=${() => dismiss(true)}>
          Re-grade
        </sl-button>
      </div>
    </sl-dialog>
  `;
}

/** Test seam: current pending request (or null). */
export function _pendingRegrade() {
  return _pending;
}
