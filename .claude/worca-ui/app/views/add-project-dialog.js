import { html, nothing } from 'lit-html';
import { unsafeHTML } from 'lit-html/directives/unsafe-html.js';
import { showConfirm } from '../utils/confirm-dialog.js';
import { FolderOpen, iconSvg } from '../utils/icons.js';

let dialogError = '';
let nameManuallyEdited = false;

function showError(msg) {
  dialogError = msg;
  const el = document.getElementById('add-project-error');
  if (el) {
    el.textContent = msg;
    el.style.display = msg ? 'block' : 'none';
  }
}

export function addProjectDialogView(state, { onProjectAdd, onClose, rerender }) {
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
          // Register project first, then offer worca setup
          onProjectAdd?.(data.project);
          offerWorcaSetup(name, rerender);
        } else {
          showError(data.error || 'Failed to add project');
        }
      })
      .catch((err) => {
        showError(err.message || 'Network error');
      });
  }

  function autoPopulateName(path) {
    if (nameManuallyEdited) return;
    const nameEl = document.getElementById('add-project-name');
    if (!nameEl) return;
    const segments = path.replace(/\/+$/, '').split('/');
    const lastSegment = segments[segments.length - 1] || '';
    const sanitized = lastSegment
      .toLowerCase()
      .replace(/[^a-z0-9_-]/g, '-')
      .replace(/^-+/, '')
      .replace(/-+$/, '');
    nameEl.value = sanitized;
  }

  function handlePathInput(e) {
    autoPopulateName(e.target.value || '');
  }

  function handleNameInput() {
    nameManuallyEdited = true;
  }

  async function handleBrowse() {
    try {
      const resp = await fetch('/api/choose-directory', { method: 'POST' });
      const data = await resp.json();
      if (data.ok && data.path) {
        const pathEl = document.getElementById('add-project-path');
        if (pathEl) pathEl.value = data.path;
        autoPopulateName(data.path);
      }
    } catch { /* user cancelled or error */ }
  }

  function handleDialogHide(e) {
    // Ignore hide events from elements disconnected during rerender
    if (!e.target.isConnected) return;
    dialogError = '';
    nameManuallyEdited = false;
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
          <label class="settings-label">Project Path</label>
          <div style="display:flex; gap:8px; align-items:stretch;">
            <sl-input
              id="add-project-path"
              placeholder="/path/to/project"
              required
              style="flex:1"
              @sl-input=${handlePathInput}
            ></sl-input>
            <sl-button size="medium" @click=${handleBrowse} title="Browse…" style="--sl-input-height-medium:100%">
              ${unsafeHTML(iconSvg(FolderOpen, 16))}
            </sl-button>
          </div>
        </div>
        <div class="settings-field" style="margin-bottom: 16px;">
          <label class="settings-label">Project Name</label>
          <sl-input
            id="add-project-name"
            placeholder="my-project"
            required
            pattern="[a-z0-9][a-z0-9_-]*"
            @sl-input=${handleNameInput}
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

/**
 * After project is registered, check worca status and offer install/update.
 */
function offerWorcaSetup(projectName, rerender) {
  if (!rerender) return;

  fetch(`/api/projects/${projectName}/worca-status`)
    .then((r) => r.json())
    .then((data) => {
      if (!data.ok) return;

      const installed = data.installed;
      const label = installed ? 'Update Worca' : 'Install Worca';
      const message = installed
        ? `Update worca in "${projectName}" with the latest pipeline files?`
        : `Install worca pipeline in "${projectName}"?`;
      const confirmLabel = 'Yes';

      showConfirm({
        label,
        message,
        confirmLabel,
        cancelLabel: 'No',
        confirmVariant: 'primary',
        onConfirm: () => {
          fetch(`/api/projects/${projectName}/worca-setup`, { method: 'POST' })
            .catch(() => {});
        },
      }, rerender);
    })
    .catch(() => {});
}

// Test-only export
export function _getDialogError() {
  return dialogError;
}
export function _setDialogError(err) {
  dialogError = err;
}
