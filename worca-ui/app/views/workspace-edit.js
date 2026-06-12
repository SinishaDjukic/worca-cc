import { html, nothing } from 'lit-html';
import { unsafeHTML } from 'lit-html/directives/unsafe-html.js';
import { dagGraphView } from './dag-graph.js';

let workspaceName = '';
let parentPath = '';
// `repos` is the merged list: union of currently-registered repos and any
// other git repos discovered by scanning the parent dir. Registered ones
// stay pre-checked; unregistered siblings are unchecked but selectable so
// the edit form supports both removing AND adding members symmetrically.
let projects = [];
let selectedProjects = [];
let dependencies = {};
let integrationCmd = '';
let integrationCwd = '';
let umbrellaRepo = '';
let originalProjectNames = [];
let hasActiveRuns = false;
let loadStatus = null;
let loadError = '';
let scanStatus = null; // null | 'scanning' | 'done' | 'error'
let scanError = '';
let submitStatus = null;
let submitError = '';

export function resetWorkspaceEditState(overrides = {}) {
  workspaceName = overrides.workspaceName ?? '';
  parentPath = overrides.parentPath ?? '';
  projects = overrides.projects ?? [];
  selectedProjects = overrides.selectedProjects ?? [];
  dependencies = overrides.dependencies ?? {};
  integrationCmd = overrides.integrationCmd ?? '';
  integrationCwd = overrides.integrationCwd ?? '';
  umbrellaRepo = overrides.umbrellaRepo ?? '';
  originalProjectNames = overrides.originalProjectNames ?? [];
  hasActiveRuns = overrides.hasActiveRuns ?? false;
  loadStatus = overrides.loadStatus ?? null;
  loadError = overrides.loadError ?? '';
  scanStatus = overrides.scanStatus ?? null;
  scanError = overrides.scanError ?? '';
  submitStatus = overrides.submitStatus ?? null;
  submitError = overrides.submitError ?? '';
}

function _detectCycle(repoNames, deps) {
  const inDegree = {};
  const dependents = {};
  for (const name of repoNames) {
    inDegree[name] = 0;
    dependents[name] = [];
  }
  for (const name of repoNames) {
    for (const dep of deps[name] || []) {
      if (!(dep in inDegree)) continue;
      inDegree[name]++;
      dependents[dep].push(name);
    }
  }
  const queue = Object.keys(inDegree).filter((n) => inDegree[n] === 0);
  let processed = 0;
  const next = [...queue];
  while (next.length > 0) {
    const name = next.shift();
    processed++;
    for (const dep of dependents[name] || []) {
      inDegree[dep]--;
      if (inDegree[dep] === 0) next.push(dep);
    }
  }
  return processed !== repoNames.length;
}

function _hasCycle() {
  return (
    selectedProjects.length >= 2 && _detectCycle(selectedProjects, dependencies)
  );
}

function _hasAddedRepos() {
  if (originalProjectNames.length === 0) return false;
  const origSet = new Set(originalProjectNames);
  return selectedProjects.some((name) => !origSet.has(name));
}

export function getWorkspaceEditSubmitState() {
  const hasCycle = _hasCycle();
  return {
    canSubmit:
      loadStatus === 'done' &&
      workspaceName.trim().length > 0 &&
      selectedProjects.length > 0 &&
      !hasCycle,
    isSubmitting: submitStatus === 'submitting',
    submitStatus,
  };
}

export async function loadWorkspace({ name, rerender } = {}) {
  loadStatus = 'loading';
  loadError = '';
  scanStatus = null;
  scanError = '';
  rerender?.();

  try {
    const resp = await fetch(`/api/workspaces/${encodeURIComponent(name)}`);
    const data = await resp.json();
    if (data.ok) {
      const ws = data.workspace;
      workspaceName = ws.name || name;
      parentPath = data.path || '';
      const registered = ws.projects || [];
      selectedProjects = registered.map((r) => r.name);
      dependencies = {};
      for (const r of registered) {
        if (r.depends_on?.length) dependencies[r.name] = [...r.depends_on];
      }
      integrationCmd = ws.integration_test?.command || '';
      integrationCwd = ws.integration_test?.cwd || '';
      umbrellaRepo = ws.umbrella_repo || '';
      originalProjectNames = registered.map((r) => r.name);
      hasActiveRuns = false;

      // Seed repos with the registered set first; the scan below will merge
      // in any additional unregistered sibling repos discovered on disk.
      projects = registered.map((r) => ({
        name: r.name,
        path: r.path || r.name,
        registered: true,
      }));
      loadStatus = 'done';
      rerender?.();

      // Best-effort: scan the parent for sibling git repos so the user can
      // re-add ones they previously unchecked, or include new repos that
      // appeared after the workspace was created. A scan failure is
      // non-fatal — the form still works in remove-only mode.
      if (parentPath) {
        await _scanForAdditions({ rerender });
      }
      return;
    }
    loadStatus = 'error';
    loadError = data.error || 'Failed to load workspace';
  } catch (err) {
    loadStatus = 'error';
    loadError = err.message || 'Network error';
  }
  rerender?.();
}

// Native folder picker for adding an arbitrary repo outside the workspace
// parent. Same logic as workspace-create.addExternalRepo — keep the two in
// sync if you change the path normalization rules.
export async function addExternalRepo({ rerender } = {}) {
  try {
    const resp = await fetch('/api/choose-directory', { method: 'POST' });
    const data = await resp.json();
    if (!(data.ok && data.path)) return;
    const picked = data.path;
    const parent = (parentPath || '').replace(/\/+$/, '');
    let path = picked;
    if (parent && picked.startsWith(`${parent}/`)) {
      path = picked.slice(parent.length + 1);
    }
    const baseName = picked.split('/').filter(Boolean).pop() || 'repo';
    let name = baseName;
    let i = 2;
    const existingNames = new Set(projects.map((r) => r.name));
    while (existingNames.has(name)) {
      name = `${baseName}-${i}`;
      i++;
    }
    projects = [...projects, { name, path, registered: false, external: true }];
    selectedProjects = [...selectedProjects, name];
    rerender?.();
  } catch {
    // User cancelled or picker tool missing — silent.
  }
}

async function _scanForAdditions({ rerender } = {}) {
  scanStatus = 'scanning';
  scanError = '';
  rerender?.();
  try {
    const resp = await fetch('/api/workspaces/scan', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ parent_path: parentPath }),
    });
    const data = await resp.json();
    if (!data.ok) {
      scanStatus = 'error';
      scanError = data.error || 'Scan failed';
      rerender?.();
      return;
    }
    const registeredByName = new Map(projects.map((r) => [r.name, r]));
    const merged = [...projects];
    for (const found of data.projects || []) {
      if (registeredByName.has(found.name)) continue;
      merged.push({
        name: found.name,
        path: found.path || found.name,
        registered: false,
      });
    }
    // Stable sort: registered first (preserves load order), then siblings
    // alphabetically — keeps the user's existing layout intact and groups
    // additions at the bottom where they're visually distinct.
    projects = merged;
    scanStatus = 'done';
  } catch (err) {
    scanStatus = 'error';
    scanError = err.message || 'Network error';
  }
  rerender?.();
}

export async function submitWorkspaceEdit({ rerender, onUpdated } = {}) {
  if (selectedProjects.length === 0) {
    submitStatus = 'error';
    submitError = 'At least one repository is required.';
    rerender?.();
    return;
  }
  if (_hasCycle()) {
    submitStatus = 'error';
    submitError = 'Dependency cycle detected. Fix before saving.';
    rerender?.();
    return;
  }

  submitStatus = 'submitting';
  submitError = '';
  rerender?.();

  const updatedProjects = selectedProjects.map((name) => {
    const orig = projects.find((r) => r.name === name);
    return {
      name,
      path: orig?.path || name,
      depends_on: dependencies[name] || [],
    };
  });

  const body = {
    name: workspaceName.trim(),
    projects: updatedProjects,
  };
  if (integrationCmd.trim()) {
    body.integration_test = {
      command: integrationCmd.trim(),
      cwd: integrationCwd.trim() || undefined,
    };
  }
  if (umbrellaRepo.trim()) {
    body.umbrella_repo = umbrellaRepo.trim();
  }

  try {
    const resp = await fetch(
      `/api/workspaces/${encodeURIComponent(workspaceName)}`,
      {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      },
    );
    const data = await resp.json();

    if (data.ok) {
      submitStatus = null;
      originalProjectNames = selectedProjects.slice();
      onUpdated?.(workspaceName);
    } else {
      submitStatus = 'error';
      submitError = data.error || 'Update failed';
      rerender?.();
    }
  } catch (err) {
    submitStatus = 'error';
    submitError = err.message || 'Network error';
    rerender?.();
  }
}

// ── sub-views ──────────────────────────────────────────────────────────────

function _nameSection() {
  return html`
    <div class="new-run-section">
      <h3 class="new-run-section-title">Workspace</h3>
      <div class="settings-field">
        <label class="settings-label">Name</label>
        <sl-input
          class="input-workspace-name"
          value="${workspaceName}"
          disabled
        ></sl-input>
        <span class="settings-field-hint">Workspace name cannot be changed after creation.</span>
      </div>
    </div>
  `;
}

function _repoChecklistSection({ rerender } = {}) {
  if (projects.length === 0 && scanStatus !== 'scanning') return nothing;

  return html`
    <div class="new-run-section">
      <h3 class="new-run-section-title">Projects</h3>
      ${
        scanStatus === 'scanning'
          ? html`<div class="ws-edit-scan-status"><sl-spinner></sl-spinner> Scanning ${parentPath} for additional projects…</div>`
          : nothing
      }
      ${
        scanStatus === 'error'
          ? html`
            <sl-alert variant="warning" open class="ws-edit-scan-error">
              Couldn't scan ${parentPath} for additional repositories: ${scanError}. You can still remove existing repos.
            </sl-alert>
          `
          : nothing
      }
      <div class="project-checklist">
        ${projects.map(
          (project) => html`
            <div class="project-checklist-item">
              <sl-checkbox
                class="checkbox-project-${project.name}"
                ?checked=${selectedProjects.includes(project.name)}
                @sl-change=${
                  rerender
                    ? (e) => {
                        if (e.target.checked) {
                          selectedProjects = [
                            ...selectedProjects,
                            project.name,
                          ];
                        } else {
                          selectedProjects = selectedProjects.filter(
                            (n) => n !== project.name,
                          );
                          const newDeps = { ...dependencies };
                          delete newDeps[project.name];
                          for (const key of Object.keys(newDeps)) {
                            newDeps[key] = newDeps[key].filter(
                              (d) => d !== project.name,
                            );
                          }
                          dependencies = newDeps;
                        }
                        rerender();
                      }
                    : null
                }
              >${project.name}</sl-checkbox>
              ${
                project.external
                  ? html`<sl-tag size="small" variant="primary" class="ws-external-tag" title="${project.path}">External</sl-tag>`
                  : project.registered === false
                    ? html`<sl-tag size="small" variant="neutral" class="ws-edit-new-tag">Available</sl-tag>`
                    : nothing
              }
            </div>
          `,
        )}
      </div>
      <div class="project-checklist-actions">
        <sl-button
          class="btn-add-external-project"
          size="small"
          @click=${rerender ? () => addExternalRepo({ rerender }) : null}
        >
          + Add external repo…
        </sl-button>
        <span class="settings-field-hint">
          Pick a repo from anywhere on disk — useful when a workspace member
          lives outside the parent directory.
        </span>
      </div>
    </div>
  `;
}

function _depEditorSection({ rerender } = {}) {
  if (selectedProjects.length < 2) return nothing;

  const hasCycle = _hasCycle();
  const dagProjects = selectedProjects.map((name) => ({
    name,
    status: 'pending',
    depends_on: dependencies[name] || [],
  }));
  const { svg } = dagGraphView({ projects: dagProjects }, { mode: 'edit' });

  return html`
    <div class="new-run-section">
      <h3 class="new-run-section-title">Dependencies</h3>
      <div class="dep-editor">
        ${selectedProjects.map(
          (name) => html`
            <div class="dep-row dep-row-${name}">
              <span class="dep-repo-name">${name}</span>
              <span class="dep-arrow">depends on</span>
              <sl-select
                class="select-dep-${name}"
                size="small"
                multiple
                clearable
                .value=${dependencies[name] || []}
                @sl-change=${
                  rerender
                    ? (e) => {
                        const v = e.target.value;
                        const vals = Array.isArray(v)
                          ? v.filter(Boolean)
                          : typeof v === 'string' && v
                            ? v.split(' ').filter(Boolean)
                            : [];
                        dependencies = { ...dependencies, [name]: vals };
                        rerender();
                      }
                    : null
                }
              >
                ${selectedProjects
                  .filter((r) => r !== name)
                  .map((r) => html`<sl-option value="${r}">${r}</sl-option>`)}
              </sl-select>
            </div>
          `,
        )}
      </div>
      ${
        hasCycle
          ? html`
            <sl-alert variant="danger" open class="cycle-warning">
              Dependency cycle detected. Remove a dependency to fix.
            </sl-alert>
          `
          : nothing
      }
      ${
        svg
          ? html`
            <div class="dag-preview-block">
              <label class="settings-label dag-preview-label">Dependency Graph</label>
              <div class="dag-preview">${unsafeHTML(svg)}</div>
            </div>
          `
          : nothing
      }
    </div>
  `;
}

function _integrationSection({ rerender } = {}) {
  return html`
    <div class="new-run-section">
      <h3 class="new-run-section-title">Integration Test (optional)</h3>
      <div class="settings-field">
        <label class="settings-label">Command</label>
        <sl-input
          class="input-integration-cmd"
          placeholder="npm test -- --integration"
          value="${integrationCmd}"
          @sl-input=${
            rerender
              ? (e) => {
                  integrationCmd = e.target.value;
                  rerender();
                }
              : null
          }
        ></sl-input>
        <span class="settings-field-hint">Shell command run after all projects complete. Exit 0 = pass.</span>
      </div>
      <div class="settings-field">
        <label class="settings-label">Working directory (optional)</label>
        <sl-input
          class="input-integration-cwd"
          placeholder="Defaults to parent directory"
          value="${integrationCwd}"
          @sl-input=${
            rerender
              ? (e) => {
                  integrationCwd = e.target.value;
                  rerender();
                }
              : null
          }
        ></sl-input>
      </div>
    </div>
  `;
}

function _umbrellaSection({ rerender } = {}) {
  return html`
    <div class="new-run-section">
      <h3 class="new-run-section-title">Umbrella Repository (optional)</h3>
      <div class="settings-field">
        <label class="settings-label">Repository</label>
        <sl-input
          class="input-umbrella-repo"
          placeholder="org/umbrella-repo"
          value="${umbrellaRepo}"
          @sl-input=${
            rerender
              ? (e) => {
                  umbrellaRepo = e.target.value;
                  rerender();
                }
              : null
          }
        ></sl-input>
        <span class="settings-field-hint">GitHub repo for the umbrella issue linking all workspace PRs.</span>
      </div>
    </div>
  `;
}

function _snapshotBanner() {
  if (!hasActiveRuns) return nothing;
  return html`
    <sl-alert variant="warning" open class="ws-edit-snapshot-banner">
      Active runs exist. Changes will apply to future runs only — in-flight runs use a snapshot of the previous configuration.
    </sl-alert>
  `;
}

function _initAction() {
  if (!_hasAddedRepos()) return nothing;
  const origSet = new Set(originalProjectNames);
  const added = selectedProjects.filter((n) => !origSet.has(n));
  return html`
    <sl-alert variant="primary" open class="ws-edit-init-action">
      New repos added: ${added.join(', ')}. Run <code>worca init</code> in newly-added repos before launching a workspace run.
    </sl-alert>
  `;
}

// ── main view ──────────────────────────────────────────────────────────────

export function workspaceEditView(_appState, { rerender } = {}) {
  if (loadStatus === 'loading') {
    return html`<div class="ws-edit-loading"><sl-spinner></sl-spinner> Loading workspace…</div>`;
  }

  if (loadStatus === 'error') {
    return html`<div class="ws-edit-load-error"><sl-alert variant="danger" open>${loadError}</sl-alert></div>`;
  }

  if (loadStatus !== 'done') {
    return nothing;
  }

  return html`
    <div class="new-run-page workspace-edit-page">
      ${_snapshotBanner()}
      ${
        submitStatus === 'error'
          ? html`<div class="ws-edit-error">${submitError}</div>`
          : nothing
      }
      <div class="new-run-form">
        ${_nameSection()}
        ${_repoChecklistSection({ rerender })}
        ${_depEditorSection({ rerender })}
        ${_integrationSection({ rerender })}
        ${_umbrellaSection({ rerender })}
      </div>
      ${_initAction()}
    </div>
  `;
}
