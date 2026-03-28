import { html, nothing } from 'lit-html';

let dialogError = '';

export function addProjectDialogView(state, { onProjectAdd, onClose }) {
  const { addProjectDialogOpen } = state;
  if (!addProjectDialogOpen) return nothing;

  function handleSubmit(e) {
    e.preventDefault();
    const nameEl = document.getElementById('add-project-name');
    const pathEl = document.getElementById('add-project-path');
    const name = nameEl?.value?.trim() || '';
    const path = pathEl?.value?.trim() || '';

    if (!name) {
      dialogError = 'Name is required';
      onClose?.({ rerender: true });
      return;
    }
    if (!path || !path.startsWith('/')) {
      dialogError = 'Path must be an absolute path';
      onClose?.({ rerender: true });
      return;
    }

    dialogError = '';
    fetch('/api/projects', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, path }),
    })
      .then((r) => r.json())
      .then((data) => {
        if (data.ok) {
          dialogError = '';
          onProjectAdd?.(data.project);
        } else {
          dialogError = data.error || 'Failed to add project';
          onClose?.({ rerender: true });
        }
      })
      .catch((err) => {
        dialogError = err.message || 'Network error';
        onClose?.({ rerender: true });
      });
  }

  function handleDialogHide() {
    dialogError = '';
    onClose?.();
  }

  return html`
    <sl-dialog
      label="Add Project"
      open
      @sl-after-hide=${handleDialogHide}
    >
      <form @submit=${handleSubmit}>
        <div class="settings-field" style="margin-bottom: 16px;">
          <label class="settings-label">Project Name</label>
          <sl-input
            id="add-project-name"
            placeholder="my-project"
            required
            pattern="[a-z0-9][a-z0-9_-]*"
          ></sl-input>
        </div>
        <div class="settings-field" style="margin-bottom: 16px;">
          <label class="settings-label">Project Path</label>
          <sl-input
            id="add-project-path"
            placeholder="/path/to/project"
            required
          ></sl-input>
        </div>
        ${dialogError ? html`
          <div style="color: var(--status-failed); font-size: 0.85rem; margin-bottom: 12px;">
            ${dialogError}
          </div>
        ` : nothing}
        <sl-button slot="footer" @click=${handleDialogHide}>Cancel</sl-button>
        <sl-button slot="footer" variant="primary" type="submit" @click=${handleSubmit}>
          Add Project
        </sl-button>
      </form>
    </sl-dialog>
  `;
}

// Test-only export
export function _getDialogError() {
  return dialogError;
}
export function _setDialogError(err) {
  dialogError = err;
}
