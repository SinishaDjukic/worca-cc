import { html, nothing } from 'lit-html';

let _pending = null; // { label, message, confirmLabel, confirmVariant, cancelLabel, onConfirm, onCancel }

export function showConfirm(
  { label, message, confirmLabel, confirmVariant = 'danger', cancelLabel, onConfirm, onCancel },
  rerender,
) {
  _pending = { label, message, confirmLabel, confirmVariant, cancelLabel, onConfirm, onCancel };
  rerender();
  requestAnimationFrame(() => {
    document.getElementById('global-confirm-dialog')?.show();
  });
}

function dismiss(callback) {
  const dlg = document.getElementById('global-confirm-dialog');
  if (dlg) dlg.hide();
  const cb = callback;
  _pending = null;
  cb?.();
}

export function confirmDialogTemplate() {
  if (!_pending) return nothing;
  const { label, message, confirmLabel, confirmVariant, cancelLabel, onConfirm, onCancel } = _pending;
  return html`
    <sl-dialog id="global-confirm-dialog" label=${label} @sl-after-hide=${() => dismiss(onCancel)}>
      ${typeof message === 'string' ? html`<p>${message}</p>` : message}
      <div slot="footer" style="display:flex; justify-content:center; gap:0.75rem; width:100%">
        <sl-button variant="default" autofocus @click=${() => dismiss(onCancel)}>${cancelLabel || 'Cancel'}</sl-button>
        <sl-button variant=${confirmVariant} @click=${() => dismiss(onConfirm)}>${confirmLabel}</sl-button>
      </div>
    </sl-dialog>
  `;
}
