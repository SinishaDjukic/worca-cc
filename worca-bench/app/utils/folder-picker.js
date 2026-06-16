// app/utils/folder-picker.js — server-side directory browser dialog.
//
// A browser can't hand the server an absolute path (the File System Access API
// only yields a name), so this picker drives a backend dir listing (/api/fs/list):
// navigate into subfolders, go up, and "Select this folder" returns the absolute
// path via onPick. A single global <sl-dialog> lives in the app shell.

import { html, nothing } from 'lit-html';
import { unsafeHTML } from 'lit-html/directives/unsafe-html.js';

const FOLDER =
  '<svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z"/></svg>';
const UP =
  '<svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m18 15-6-6-6 6"/></svg>';

let _state = null; // { path, parent, dirs, loading, error, onPick }
let _rerender = () => {};

export function openFolderPicker({ onPick }, rerender) {
  _rerender = rerender;
  _state = {
    path: null,
    parent: null,
    dirs: [],
    loading: true,
    error: null,
    onPick,
  };
  rerender();
  requestAnimationFrame(() => {
    document.getElementById('folder-picker-dialog')?.show();
  });
  loadDir(null);
}

async function loadDir(path) {
  _state = { ..._state, loading: true, error: null };
  _rerender();
  try {
    const url = path
      ? `/api/fs/list?path=${encodeURIComponent(path)}`
      : '/api/fs/list';
    const res = await fetch(url);
    const data = await res.json();
    if (!res.ok || !data.ok) throw new Error(data.error || 'listing failed');
    _state = {
      ..._state,
      path: data.path,
      parent: data.parent,
      dirs: data.dirs,
      loading: false,
    };
  } catch (err) {
    _state = { ..._state, loading: false, error: err.message };
  }
  _rerender();
}

function close() {
  document.getElementById('folder-picker-dialog')?.hide();
  _state = null;
}

/** Render once in the app shell. Renders nothing when idle. */
export function folderPickerTemplate() {
  if (!_state) return nothing;
  const s = _state;
  return html`
    <sl-dialog
      id="folder-picker-dialog"
      label="Select a folder"
      class="folder-picker-dialog"
      @sl-after-hide=${() => {
        _state = null;
      }}
    >
      <div class="folder-picker">
        <div class="folder-picker-path" title=${s.path || ''}>
          ${s.path || '…'}
        </div>
        ${
          s.error
            ? html`<div class="settings-alert" role="alert">${s.error}</div>`
            : nothing
        }
        <div class="folder-picker-list">
          ${
            s.parent
              ? html`<button
                  class="folder-picker-item folder-picker-up"
                  @click=${() => loadDir(s.parent)}
                >
                  <span class="folder-picker-icon">${unsafeHTML(UP)}</span> ..
                </button>`
              : nothing
          }
          ${
            s.loading
              ? html`<div class="folder-picker-empty">Loading…</div>`
              : s.dirs.map(
                  (d) => html`<button
                    class="folder-picker-item"
                    @click=${() => loadDir(d.path)}
                  >
                    <span class="folder-picker-icon">${unsafeHTML(FOLDER)}</span>
                    ${d.name}
                  </button>`,
                )
          }
          ${
            !s.loading && s.dirs.length === 0 && !s.error
              ? html`<div class="folder-picker-empty">No subfolders.</div>`
              : nothing
          }
        </div>
      </div>
      <div
        slot="footer"
        style="display:flex; justify-content:space-between; gap:0.5rem; width:100%"
      >
        <sl-button variant="default" @click=${close}>Cancel</sl-button>
        <sl-button
          variant="primary"
          ?disabled=${!s.path}
          @click=${() => {
            const picked = s.path;
            const cb = s.onPick;
            close();
            if (picked) cb?.(picked);
          }}
          >Select this folder</sl-button
        >
      </div>
    </sl-dialog>
  `;
}
