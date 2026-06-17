// app/utils/notes-dialog.js — editable per-profile human notes.
//
// A single global <sl-dialog> in the app shell with a textarea. showNotesDialog()
// is given the notes already loaded from the server (GET in main.js); on Save the
// textarea value is read at click time (lit-html is stateless) and handed to
// onSave, which PUTs it back. Notes persist server-side alongside the profile's
// results, so they survive reloads and aren't browser-local.

import { html, nothing } from 'lit-html';

let _pending = null;

/**
 * Open the notes dialog.
 * @param {object} opts
 * @param {string} opts.profile             profile name (dialog title)
 * @param {string} opts.notes               current notes text (already fetched)
 * @param {(text: string) => void} opts.onSave
 * @param {() => void} rerender
 */
export function showNotesDialog({ profile, notes, onSave }, rerender) {
  _pending = { profile, notes: notes || '', onSave };
  rerender();
  requestAnimationFrame(() => {
    document.getElementById('notes-dialog')?.show();
  });
}

function dismiss(save) {
  const pending = _pending;
  let text = pending?.notes ?? '';
  if (save) {
    text = document.getElementById('notes-textarea')?.value ?? text;
  }
  document.getElementById('notes-dialog')?.hide();
  _pending = null;
  if (save && pending?.onSave) pending.onSave(text);
}

/** The dialog template — render once in the app shell. Renders nothing when idle. */
export function notesDialogTemplate() {
  if (!_pending) return nothing;
  const { profile, notes } = _pending;
  return html`
    <sl-dialog
      id="notes-dialog"
      label="Notes — ${profile}"
      @sl-after-hide=${() => {
        if (_pending) _pending = null;
      }}
    >
      <textarea
        id="notes-textarea"
        class="notes-textarea"
        rows="16"
        placeholder="Human notes for this profile / run — context, intent, observations…"
        .value=${notes}
      ></textarea>
      <div
        slot="footer"
        style="display:flex; justify-content:flex-end; gap:0.5rem; width:100%"
      >
        <sl-button variant="default" @click=${() => dismiss(false)}>
          Close
        </sl-button>
        <sl-button variant="primary" @click=${() => dismiss(true)}>
          Save
        </sl-button>
      </div>
    </sl-dialog>
  `;
}

/** Test seam: current pending request (or null). */
export function _pendingNotes() {
  return _pending;
}
