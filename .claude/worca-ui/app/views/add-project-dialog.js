import { html, nothing } from 'lit-html';

let dialogError = '';

function showError(msg) {
  dialogError = msg;
  const el = document.getElementById('add-project-error');
  if (el) {
    el.textContent = msg;
    el.style.display = msg ? 'block' : 'none';
  }
}

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
      showError('Name is required');
      return;
    }
    if (!path || !path.startsWith('/')) {
      showError('Path must be an absolute path');
      return;
    }

    const normalizedPath = path.replace(/\/+$/, '');
    const existingProjects = state.projects || [];
    const duplicate = existingProjects.find(
      (p) => (p.path || '').replace(/\/+$/, '') === normalizedPath,
    );
    if (duplicate) {
      showError(`A project with this path already exists: "${duplicate.name}"`);
      return;
    }

    showError('');
    fetch('/api/projects', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, path }),
    })
      .then((r) => r.json())
      .then((data) => {
        if (data.ok) {
          showError('');
          onProjectAdd?.(data.project);
        } else {
          showError(data.error || 'Failed to add project');
        }
      })
      .catch((err) => {
        showError(err.message || 'Network error');
      });
  }

  function handleDialogHide(e) {
    // Ignore hide events from elements disconnected during rerender
    if (!e.target.isConnected) return;
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
        <div
          id="add-project-error"
          style="color: var(--status-failed); font-size: 0.85rem; margin-bottom: 12px; display: ${dialogError ? 'block' : 'none'};"
        >${dialogError}</div>
        <div slot="footer" style="display:flex; justify-content:center; gap:0.75rem; width:100%">
          <sl-button autofocus @click=${handleDialogHide}>Cancel</sl-button>
          <sl-button variant="primary" @click=${handleSubmit}>Add Project</sl-button>
        </div>
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
