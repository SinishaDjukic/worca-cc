// app/utils/confirm-dialog.js — reusable confirmation dialog.
//
// Ported from worca-ui (app/utils/confirm-dialog.js). A single global <sl-dialog>
// lives in the app shell; showConfirm() stores the pending request, triggers a
// rerender, then opens the dialog. Destructive actions (e.g. removing a result
// dir) route through this so they always require explicit confirmation.

import { html, nothing } from 'lit-html';

let _pending = null;

/**
 * Open the global confirmation dialog.
 *
 * @param {object} opts
 * @param {string} opts.label              dialog title
 * @param {string|object} opts.message     body text or a lit template
 * @param {string} opts.confirmLabel       confirm button text
 * @param {'danger'|'primary'|'warning'|'default'} [opts.confirmVariant='danger']
 * @param {string} [opts.cancelLabel='Cancel']
 * @param {boolean} [opts.singleButton=false]  info-style (no cancel)
 * @param {() => void} [opts.onConfirm]
 * @param {() => void} [opts.onCancel]
 * @param {() => void} rerender
 */
export function showConfirm(
  {
    label,
    message,
    confirmLabel,
    confirmVariant = 'danger',
    cancelLabel,
    singleButton = false,
    onConfirm,
    onCancel,
  },
  rerender,
) {
  _pending = {
    label,
    message,
    confirmLabel,
    confirmVariant,
    cancelLabel,
    singleButton,
    onConfirm,
    onCancel,
  };
  rerender();
  requestAnimationFrame(() => {
    document.getElementById('global-confirm-dialog')?.show();
  });
}

function dismiss(callback) {
  document.getElementById('global-confirm-dialog')?.hide();
  const cb = callback;
  _pending = null;
  cb?.();
}

/** The dialog template — render once in the app shell. Renders nothing when idle. */
export function confirmDialogTemplate() {
  if (!_pending) return nothing;
  const {
    label,
    message,
    confirmLabel,
    confirmVariant,
    cancelLabel,
    singleButton,
    onConfirm,
    onCancel,
  } = _pending;
  return html`
    <sl-dialog
      id="global-confirm-dialog"
      label=${label}
      @sl-after-hide=${() => dismiss(onCancel)}
    >
      ${typeof message === 'string' ? html`<p>${message}</p>` : message}
      <div
        slot="footer"
        style="display:flex; justify-content:flex-end; gap:0.5rem; width:100%"
      >
        ${
          singleButton
            ? nothing
            : html`<sl-button
                variant="default"
                @click=${() => dismiss(onCancel)}
                >${cancelLabel || 'Cancel'}</sl-button
              >`
        }
        <sl-button
          variant=${confirmVariant}
          ?autofocus=${singleButton}
          @click=${() => dismiss(onConfirm)}
          >${confirmLabel}</sl-button
        >
      </div>
    </sl-dialog>
  `;
}

/** Test seam: current pending request (or null). */
export function _pendingConfirm() {
  return _pending;
}
