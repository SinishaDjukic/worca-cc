import { html, nothing } from 'lit-html';
import { unsafeHTML } from 'lit-html/directives/unsafe-html.js';
import { dagGraphView } from './dag-graph.js';
import {
  filePickerButton,
  guideUploadWidget,
  planModeRadio,
} from './launcher-shared.js';
import { isAtCapacity } from './new-run.js';

const GUIDE_CAP_BYTES_DEFAULT = 128 * 1024; // matches src/worca/settings.json + GUIDE_MAX_BYTES_DEFAULT in work_request.py

function resolveGuideCap(appState) {
  return (
    appState?.preferences?.worca?.guide?.max_bytes ?? GUIDE_CAP_BYTES_DEFAULT
  );
}

// ── module-level form state ─────────────────────────────────────────────────
//
// Naming mirrors `new-run.js` so the two launcher pages share vocabulary:
// `sourceType` (none|source|spec) drives whether a source value is shown,
// `sourceValue` holds the GitHub/spec reference, `prompt` is always
// available, and `planFile` is the optional plan-file path that maps to
// the API's `plan_mode='explicit'` shortcut.

// ── launcher mode ──────────────────────────────────────────────────────────
let launcherMode = 'fleet'; // 'fleet' | 'workspace'

// ── fleet-mode state ───────────────────────────────────────────────────────
let selectedProjects = [];
let projectFilter = '';
let sourceType = 'none';
let sourceValue = '';
let prompt = '';
let planFile = '';
let guides = [];
let headTemplate = 'migration/{slug}/{project}';
let baseBranch = '';
let baseBranchError = null;
let baseBranchValidating = false;
let planMode = 'none';
let planFirstProject = '';
let maxParallel = 5;
let failureThreshold = 0.3;
let submitStatus = null;
let submitError = '';

// ── workspace-mode state ───────────────────────────────────────────────────
let selectedWorkspace = '';
let workspaceData = null; // { name, repos: [{name, depends_on, ...}] }
let workspacePlanMode = 'master'; // master | existing | per-repo | independent
let workspacePlanPath = '';
let workspacePlanFile = null; // File object from file picker
let perRepoPlans = {}; // { projectName: { name, size, file } }
let ghAuthStatus = null; // null | 'checking' | 'ok' | 'failed'
let ghAuthErrors = []; // [{org, command}]
let skipAuthCheck = false;
let initTimeout = 60;

const FLEET_HEAD_TEMPLATE_DEFAULT = 'migration/{slug}/{project}';
const WORKSPACE_HEAD_TEMPLATE_DEFAULT = 'workspace/{slug}/{repo}';

export function resetLauncherState(overrides = {}) {
  launcherMode = overrides.launcherMode ?? 'fleet';
  selectedProjects = overrides.selectedProjects ?? [];
  projectFilter = overrides.projectFilter ?? '';
  sourceType = overrides.sourceType ?? 'none';
  sourceValue = overrides.sourceValue ?? '';
  prompt = overrides.prompt ?? '';
  planFile = overrides.planFile ?? '';
  guides = overrides.guides ?? [];
  headTemplate =
    overrides.headTemplate ??
    (launcherMode === 'workspace'
      ? WORKSPACE_HEAD_TEMPLATE_DEFAULT
      : FLEET_HEAD_TEMPLATE_DEFAULT);
  baseBranch = overrides.baseBranch ?? '';
  baseBranchError = overrides.baseBranchError ?? null;
  baseBranchValidating = overrides.baseBranchValidating ?? false;
  planMode = overrides.planMode ?? 'none';
  planFirstProject = overrides.planFirstProject ?? '';
  maxParallel = overrides.maxParallel ?? 5;
  failureThreshold = overrides.failureThreshold ?? 0.3;
  selectedWorkspace = overrides.selectedWorkspace ?? '';
  workspaceData = overrides.workspaceData ?? null;
  workspacePlanMode = overrides.workspacePlanMode ?? 'master';
  workspacePlanPath = overrides.workspacePlanPath ?? '';
  workspacePlanFile = overrides.workspacePlanFile ?? null;
  perRepoPlans = overrides.perRepoPlans ?? {};
  ghAuthStatus = overrides.ghAuthStatus ?? null;
  ghAuthErrors = overrides.ghAuthErrors ?? [];
  skipAuthCheck = overrides.skipAuthCheck ?? false;
  initTimeout = overrides.initTimeout ?? 60;
  submitStatus = null;
  submitError = '';
}

// ── helpers ─────────────────────────────────────────────────────────────────

function _detectCollision(_template, _projects) {
  // Disabled: the head-branch template field is hidden because
  // `--head-template` is dead config (run_fleet never passes it through to
  // run_worktree, which hardcodes `worca/{slug}-{run_id}`). Even if it
  // weren't, distinct projects = distinct git remotes = distinct branch
  // namespaces, so a same-name branch in three repos is not a collision.
  // Kept as a stub so call sites + tests don't need to change shape.
  return false;
}

function _sourceLabel(type) {
  if (type === 'source') return 'GitHub Issue';
  if (type === 'spec') return 'Specification';
  if (type === 'pr') return 'GitHub PR';
  return '';
}

function _hasSource() {
  return sourceType !== 'none' && sourceValue.trim().length > 0;
}

function _canLaunch() {
  const guidesTotalBytes = guides.reduce((s, g) => s + (g.size || 0), 0);
  const hasContent = prompt.trim().length > 0 || _hasSource();
  const guidesOk = guidesTotalBytes <= GUIDE_CAP_BYTES_DEFAULT;
  const baseBranchOk = !((baseBranchError?.missing_in?.length ?? 0) > 0);

  if (launcherMode === 'workspace') {
    const hasWorkspace = !!(selectedWorkspace && workspaceData);
    const authOk = ghAuthStatus !== 'failed' || skipAuthCheck;
    return hasWorkspace && hasContent && guidesOk && baseBranchOk && authOk;
  }

  return (
    selectedProjects.length > 0 &&
    hasContent &&
    !_detectCollision(headTemplate, selectedProjects) &&
    baseBranchOk &&
    guidesOk
  );
}

// ── exported submit-state used by main.js for the page-header button ─────

export function getFleetLauncherSubmitState() {
  return {
    submitStatus,
    isSubmitting: submitStatus === 'submitting',
    canLaunch: _canLaunch(),
  };
}

export async function submitFleetLauncher({ rerender, onStarted } = {}) {
  if (launcherMode === 'workspace') {
    return _submitWorkspaceLauncher({ rerender, onStarted });
  }

  if (sourceType !== 'none' && !sourceValue.trim()) {
    submitStatus = 'error';
    submitError = `Please enter a ${_sourceLabel(sourceType).toLowerCase()}.`;
    rerender?.();
    return;
  }
  if (!prompt.trim() && !_hasSource()) {
    submitStatus = 'error';
    submitError = 'Please provide at least one of: a work source, or a prompt.';
    rerender?.();
    return;
  }
  if (selectedProjects.length === 0) {
    submitStatus = 'error';
    submitError = 'Please select at least one project.';
    rerender?.();
    return;
  }
  if (_detectCollision(headTemplate, selectedProjects)) {
    submitStatus = 'error';
    submitError =
      'Head branch template resolves to the same name across projects. Add {project} for uniqueness.';
    rerender?.();
    return;
  }

  submitStatus = 'submitting';
  submitError = '';
  rerender?.();

  try {
    const formData = new FormData();
    formData.append('projects', JSON.stringify(selectedProjects));
    if (prompt.trim()) formData.append('prompt', prompt);
    if (_hasSource()) formData.append('source', sourceValue);
    if (headTemplate) formData.append('head_template', headTemplate);
    if (baseBranch) formData.append('base_branch', baseBranch);
    const wirePlanMode = planFile ? 'explicit' : planMode;
    formData.append('plan_mode', wirePlanMode);
    if (wirePlanMode === 'explicit' && planFile)
      formData.append('plan', planFile);
    if (wirePlanMode === 'plan-first' && planFirstProject)
      formData.append('plan_first', planFirstProject);
    formData.append('max_parallel', String(maxParallel));
    formData.append('fleet_failure_threshold', String(failureThreshold));
    for (const g of guides) {
      if (g.file) formData.append('guide_files', g.file, g.name);
    }

    const resp = await fetch('/api/fleet-runs', {
      method: 'POST',
      body: formData,
    });
    const data = await resp.json();

    if (data.ok && data.fleet_id) {
      submitStatus = null;
      onStarted?.(data.fleet_id);
    } else {
      submitStatus = 'error';
      submitError = data.error || 'Launch failed';
      rerender?.();
    }
  } catch (err) {
    submitStatus = 'error';
    submitError = err.message || 'Network error';
    rerender?.();
  }
}

async function _submitWorkspaceLauncher({ rerender, onStarted } = {}) {
  if (!selectedWorkspace || !workspaceData) {
    submitStatus = 'error';
    submitError = 'Please select a workspace.';
    rerender?.();
    return;
  }
  if (!prompt.trim() && !_hasSource()) {
    submitStatus = 'error';
    submitError = 'Please provide at least one of: a work source, or a prompt.';
    rerender?.();
    return;
  }
  if (ghAuthStatus === 'failed' && !skipAuthCheck) {
    submitStatus = 'error';
    submitError =
      'GitHub authentication check failed. Fix auth or check "Skip auth check".';
    rerender?.();
    return;
  }

  submitStatus = 'submitting';
  submitError = '';
  rerender?.();

  try {
    const formData = new FormData();
    // Server expects `workspace_name` (matches the on-disk
    // ~/.worca/workspaces.d/<name>.json registration filename); the launcher
    // historically sent `workspace`, which the server silently dropped and
    // rejected with "workspace_name is required".
    formData.append('workspace_name', selectedWorkspace);
    if (prompt.trim()) formData.append('prompt', prompt);
    if (_hasSource()) formData.append('source', sourceValue);
    // Workspace runs use `branch_template` (per-repo branch name template),
    // not the per-project `head_template` used by fleet runs. Map the
    // launcher's head-template field across so the server actually picks it
    // up — keeping the legacy field name unsent avoids confusion.
    if (headTemplate) formData.append('branch_template', headTemplate);
    formData.append('plan_mode', workspacePlanMode);
    if (workspacePlanMode === 'existing') {
      if (workspacePlanFile?.file) {
        formData.append(
          'workspace_plan_file',
          workspacePlanFile.file,
          workspacePlanFile.name,
        );
      } else if (workspacePlanPath) {
        formData.append('workspace_plan', workspacePlanPath);
      }
    }
    if (workspacePlanMode === 'per-repo') {
      for (const [projName, entry] of Object.entries(perRepoPlans)) {
        if (entry?.file) {
          formData.append(`project_plan_${projName}`, entry.file, entry.name);
        }
      }
    }
    formData.append('max_parallel', String(maxParallel));
    for (const g of guides) {
      if (g.file) formData.append('guide_files', g.file, g.name);
    }

    const resp = await fetch('/api/workspace-runs', {
      method: 'POST',
      body: formData,
    });
    const data = await resp.json();

    if (data.ok && data.workspace_id) {
      submitStatus = null;
      onStarted?.(data.workspace_id);
    } else {
      submitStatus = 'error';
      submitError = data.error || 'Launch failed';
      rerender?.();
    }
  } catch (err) {
    submitStatus = 'error';
    submitError = err.message || 'Network error';
    rerender?.();
  }
}

// ── sub-views ────────────────────────────────────────────────────────────────

function _projectsSection(appProjects, { rerender } = {}) {
  const filtered = appProjects.filter((p) => {
    if (!projectFilter) return true;
    const q = projectFilter.toLowerCase();
    return (
      (p.name || '').toLowerCase().includes(q) ||
      (p.path || '').toLowerCase().includes(q)
    );
  });

  return html`
    <div class="new-run-section">
      <h3 class="new-run-section-title">Projects</h3>
      <div class="settings-field">
        <label class="settings-label">Targets</label>
        <div class="fleet-launcher-projects-controls">
          <sl-input
            class="input-project-filter"
            size="small"
            placeholder="Filter projects…"
            value="${projectFilter}"
            @sl-input=${
              rerender
                ? (e) => {
                    projectFilter = e.target.value;
                    rerender();
                  }
                : null
            }
          ></sl-input>
          <sl-button
            size="small"
            variant="default"
            class="btn-select-all-projects"
            @click=${
              rerender
                ? () => {
                    selectedProjects =
                      selectedProjects.length === appProjects.length
                        ? []
                        : appProjects.map((p) => p.path);
                    rerender();
                  }
                : null
            }
          >
            ${selectedProjects.length === appProjects.length ? 'Deselect all' : 'Select all'}
          </sl-button>
        </div>
        <sl-select
          class="fleet-launcher-projects"
          multiple
          clearable
          .value=${selectedProjects}
          @sl-change=${
            rerender
              ? (e) => {
                  const v = e.target.value;
                  selectedProjects = Array.isArray(v)
                    ? v.filter(Boolean)
                    : typeof v === 'string' && v
                      ? v.split(' ').filter(Boolean)
                      : [];
                  rerender();
                }
              : null
          }
        >
          ${filtered.map(
            (p) => html`
              <sl-option value="${p.path}">${p.name || p.path.split('/').pop()} — ${p.path}</sl-option>
            `,
          )}
        </sl-select>
        <span class="settings-field-hint">Choose 2+ registered projects. Fleet runs apply one work-request to each, isolated per project.</span>
      </div>
    </div>
  `;
}

// Mirrors `new-run.js` "Work Source" section: Source Type select +
// optional Source value + Plan File. Same vocabulary so users moving
// between the two launchers don't have to learn two mental models.
function _workSourceSection({ rerender } = {}) {
  return html`
    <div class="new-run-section">
      <h3 class="new-run-section-title">Work Source</h3>
      <div class="settings-field">
        <label class="settings-label">Source Type</label>
        <sl-select
          class="select-fleet-source-type"
          value=${sourceType}
          @sl-change=${
            rerender
              ? (e) => {
                  sourceType = e.target.value;
                  rerender();
                }
              : null
          }
        >
          <sl-option value="none">Prompt (Shared)</sl-option>
          <sl-option value="spec">Specification</sl-option>
          <sl-option value="source">GitHub Issue</sl-option>
          <sl-option value="pr">GitHub PR</sl-option>
        </sl-select>
      </div>
      ${
        sourceType !== 'none'
          ? html`
            <div class="settings-field">
              <label class="settings-label">${_sourceLabel(sourceType)}</label>
              <sl-input
                class="input-fleet-source"
                placeholder=${sourceType === 'source' ? 'gh:issue:123 or https://github.com/…' : sourceType === 'pr' ? 'gh:pr:123 or https://github.com/owner/repo/pull/123' : 'path/to/spec.md'}
                value="${sourceValue}"
                @sl-input=${
                  rerender
                    ? (e) => {
                        sourceValue = e.target.value;
                        rerender();
                      }
                    : null
                }
              ></sl-input>
              <span class="settings-field-hint">${sourceType === 'source' ? 'GitHub issue reference resolved per project.' : sourceType === 'pr' ? 'GitHub PR number or URL. Fetches unresolved review comments and runs in revision mode.' : 'Path resolved relative to each project root.'}</span>
            </div>
          `
          : nothing
      }
      <div class="settings-field">
        <label class="settings-label">Plan File (optional)</label>
        <sl-input
          class="input-fleet-plan-file"
          placeholder="docs/plans/W-NNN-short-description.md"
          value="${planFile}"
          @sl-input=${
            rerender
              ? (e) => {
                  planFile = e.target.value;
                  rerender();
                }
              : null
          }
        ></sl-input>
        <span class="settings-field-hint">Skips per-child planning when set. Path resolved relative to each project root.</span>
      </div>
    </div>
  `;
}

function _promptSection({ rerender } = {}) {
  const promptLabel = _hasSource()
    ? 'Additional Instructions (optional)'
    : 'Prompt (required)';
  return html`
    <div class="new-run-section">
      <h3 class="new-run-section-title">Prompt</h3>
      <div class="settings-field">
        <label class="settings-label">${promptLabel}</label>
        <sl-textarea
          class="textarea-fleet-prompt"
          rows="8"
          placeholder="Describe the change to apply across all selected projects…"
          value="${prompt}"
          @sl-input=${
            rerender
              ? (e) => {
                  prompt = e.target.value;
                  rerender();
                }
              : null
          }
        ></sl-textarea>
      </div>
    </div>
  `;
}

function _guideSection({ rerender, guideCapBytes } = {}) {
  return html`
    <div class="new-run-section">
      <h3 class="new-run-section-title">Reference Guide</h3>
      <div class="settings-field">
        <label class="settings-label">Optional normative material</label>
        ${guideUploadWidget(
          { guides },
          {
            maxBytes: guideCapBytes,
            onChange: rerender
              ? (ev) => {
                  if (ev.type === 'add-files') {
                    for (const f of ev.files) {
                      guides = [
                        ...guides,
                        { name: f.name, size: f.size, file: f },
                      ];
                    }
                  } else if (ev.type === 'remove-file') {
                    guides = guides.filter((_, i) => i !== ev.index);
                  }
                  rerender();
                }
              : undefined,
          },
        )}
        <span class="settings-field-hint">Attached guides are pinned to every stage's user message and treated as authoritative over the prompt.</span>
      </div>
    </div>
  `;
}

function _advancedSection({ rerender } = {}) {
  // Plan-mode controls only matter when there's no Plan File set — a
  // file overrides the per-child strategy with `explicit` at submit time.
  const showPlanModeRadio = !planFile;
  return html`
    <div class="new-run-section">
      <h3 class="new-run-section-title">Advanced Options</h3>
      <div class="new-run-advanced">
        <div class="advanced-subgroup">
          <div class="advanced-subgroup-title">Branches</div>
        <div class="settings-field">
          <label class="settings-label">PR base branch (optional)</label>
          <sl-input
            class="input-base-branch"
            placeholder="main"
            value="${baseBranch}"
            @sl-change=${
              rerender
                ? async (e) => {
                    baseBranch = e.target.value.trim();
                    baseBranchError = null;
                    if (baseBranch && selectedProjects.length > 0) {
                      baseBranchValidating = true;
                      rerender();
                      try {
                        const resp = await fetch(
                          '/api/fleet-runs/validate-base',
                          {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({
                              projects: selectedProjects,
                              base_branch: baseBranch,
                            }),
                          },
                        );
                        const data = await resp.json();
                        baseBranchError =
                          !data.ok && data.missing_in?.length
                            ? { missing_in: data.missing_in }
                            : null;
                      } catch {
                        // non-blocking
                      } finally {
                        baseBranchValidating = false;
                        rerender();
                      }
                    } else {
                      rerender();
                    }
                  }
                : null
            }
          ></sl-input>
          <span class="settings-field-hint">Branch the worktrees fork from and PRs target. Leave blank to use each project's default.</span>
          ${
            baseBranchValidating
              ? html`<div class="base-branch-validating"><sl-spinner></sl-spinner> Checking…</div>`
              : nothing
          }
          ${
            baseBranchError?.missing_in?.length
              ? html`
                <div class="base-branch-error">
                  Branch not found in:
                  <ul class="base-branch-missing-list">
                    ${baseBranchError.missing_in.map(
                      (p) => html`<li>${p.split('/').pop() || p}</li>`,
                    )}
                  </ul>
                </div>
              `
              : nothing
          }
        </div>

        ${
          nothing /* Head branch template hidden — `--head-template` is
                    dead config end-to-end (run_fleet stores it but never
                    forwards to run_worktree, which hardcodes the worktree
                    branch as `worca/{slug}-{run_id}`). Re-mount
                    headTemplateInput here when run_worktree starts
                    consuming the template. */
        }
        </div>

        ${
          showPlanModeRadio
            ? html`
              <div class="advanced-subgroup">
                <div class="advanced-subgroup-title">Planning</div>
              <div class="settings-field">
                <label class="settings-label">Per-project planning strategy</label>
                ${planModeRadio(
                  {
                    planMode,
                    planPath: '',
                    planFirstProject,
                    selectedProjects,
                  },
                  {
                    options: [
                      { value: 'none', label: 'Independent plans (default)' },
                      {
                        value: 'plan-first',
                        label: 'Plan-first reference project',
                      },
                    ],
                    onChange: rerender
                      ? (ev) => {
                          if (ev.type === 'set-plan-mode') planMode = ev.value;
                          else if (ev.type === 'set-plan-first-project')
                            planFirstProject = ev.value;
                          rerender();
                        }
                      : undefined,
                  },
                )}
                <span class="settings-field-hint">Independent: each project runs its own Planner. Plan-first: one reference project plans, others adopt it. Set a Plan File above to skip planning entirely.</span>
              </div>
              </div>
            `
            : nothing
        }

        <div class="advanced-subgroup">
          <div class="advanced-subgroup-title">Concurrency</div>
        <div class="new-run-grid">
          <div class="settings-field">
            <label class="settings-label">Max parallel runs</label>
            <sl-input
              class="input-max-parallel"
              type="number"
              min="1"
              max="20"
              value="${maxParallel}"
              @sl-input=${
                rerender
                  ? (e) => {
                      maxParallel = Number(e.target.value) || 5;
                      rerender();
                    }
                  : null
              }
            ></sl-input>
            <span class="settings-field-hint">Maximum concurrent child pipelines. Higher = faster but more API spend.</span>
          </div>
          <div class="settings-field">
            <label class="settings-label">Circuit-breaker threshold: ${Math.round(failureThreshold * 100)}%</label>
            <sl-range
              class="input-failure-threshold"
              min="0"
              max="1"
              step="0.05"
              value="${failureThreshold}"
              @sl-input=${
                rerender
                  ? (e) => {
                      failureThreshold = Number(e.target.value);
                      rerender();
                    }
                  : null
              }
            ></sl-range>
            <span class="settings-field-hint">Failure ratio that halts unstarted children after at least 3 have completed.</span>
          </div>
        </div>
        </div>
      </div>
    </div>
  `;
}

// ── workspace-mode sub-views ────────────────────────────────────────────────

// In-form Fleet/Workspace radio toggle was removed once the sidebar got
// dedicated entries (#/fleet-runs/new vs #/workspace-runs/new) — the URL is
// the canonical source of mode now. Keeping it in-form created an
// inconsistent state (URL says workspace, radio says fleet) and confused
// users about why both options appeared on a page they reached via the
// "+ New Workspace" affordance.

function _workspaceSelectSection(appState, { rerender } = {}) {
  const workspaces = appState?.workspaces || [];
  const hasNone = workspaces.length === 0;

  return html`
    <div class="new-run-section">
      <h3 class="new-run-section-title">Workspace</h3>
      <div class="settings-field">
        <label class="settings-label">Select workspace</label>
        <sl-select
          class="select-workspace"
          value="${selectedWorkspace}"
          ?disabled=${hasNone}
          @sl-change=${
            rerender
              ? async (e) => {
                  selectedWorkspace = e.target.value;
                  const ws = workspaces.find(
                    (w) => w.name === selectedWorkspace,
                  );
                  workspaceData = ws || null;
                  // gh auth pre-flight skipped — server check is a no-op
                  // stub and the panel is hidden. Keep state slots intact so
                  // tests + skip-checkbox still work when the panel returns.
                  ghAuthStatus = null;
                  ghAuthErrors = [];
                  rerender();
                }
              : null
          }
        >
          ${workspaces.map(
            (ws) => html`
              <sl-option value="${ws.name}">${ws.name}</sl-option>
            `,
          )}
        </sl-select>
        ${
          hasNone
            ? html`
              <span class="settings-field-hint">
                No workspace definitions registered yet — manage them in
                <a href="#/workspaces">Configuration → Workspaces</a>.
              </span>
            `
            : html`<span class="settings-field-hint">Choose a workspace definition. Projects and dependencies are determined by the workspace.</span>`
        }
      </div>
      ${
        workspaceData
          ? html`
            <div class="workspace-pinned-repos">
              <label class="settings-label">Projects (from workspace)</label>
              <div class="workspace-repo-tags">
                ${workspaceData.projects.map(
                  (r) =>
                    html`<sl-tag size="small" class="workspace-repo-tag">${r.name}</sl-tag>`,
                )}
              </div>
            </div>
          `
          : nothing
      }
    </div>
  `;
}

function _workspaceDagSection() {
  if (
    !workspaceData ||
    !workspaceData.projects ||
    workspaceData.projects.length < 2
  )
    return nothing;

  const dagProjects = workspaceData.projects.map((r) => ({
    name: r.name,
    status: 'pending',
    depends_on: r.depends_on || [],
  }));
  const { svg } = dagGraphView({ projects: dagProjects }, { mode: 'preview' });
  if (!svg) return nothing;

  return html`
    <div class="new-run-section">
      <h3 class="new-run-section-title">Dependency Graph</h3>
      <div class="dag-preview">${unsafeHTML(svg)}</div>
    </div>
  `;
}

function _ghAuthSection({ rerender } = {}) {
  if (!workspaceData) return nothing;

  return html`
    <div class="new-run-section">
      <h3 class="new-run-section-title">GitHub Authentication</h3>
      ${
        ghAuthStatus === 'checking'
          ? html`<div class="gh-auth-checking"><sl-spinner></sl-spinner> Checking authentication…</div>`
          : nothing
      }
      ${
        ghAuthStatus === 'ok'
          ? html`<div class="gh-auth-ok"><sl-badge variant="success">All orgs authenticated</sl-badge></div>`
          : nothing
      }
      ${
        ghAuthStatus === 'failed' && ghAuthErrors.length > 0
          ? html`
            <div class="gh-auth-errors">
              ${ghAuthErrors.map(
                (err) => html`
                  <sl-alert variant="danger" open class="gh-auth-error">
                    <strong>${err.org}</strong> — not authenticated.<br>
                    Run: <code>${err.command}</code>
                  </sl-alert>
                `,
              )}
              <sl-checkbox
                class="checkbox-skip-auth"
                ?checked=${skipAuthCheck}
                @sl-change=${
                  rerender
                    ? (e) => {
                        skipAuthCheck = e.target.checked;
                        rerender();
                      }
                    : null
                }
              >Skip auth check (PRs may fail)</sl-checkbox>
            </div>
          `
          : nothing
      }
    </div>
  `;
}

function _workspacePlanSection({ rerender } = {}) {
  const showPlanMode = !planFile;
  if (!showPlanMode) return nothing;

  const wsOptions = [
    { value: 'master', label: 'Master planner (default)' },
    { value: 'existing', label: 'Use existing workspace plan' },
    { value: 'per-repo', label: 'Skip planning, use per-repo plans' },
    { value: 'independent', label: 'Independent plans' },
  ];

  return html`
    <div class="advanced-subgroup">
      <div class="advanced-subgroup-title">Planning</div>
      <div class="settings-field">
        <label class="settings-label">Workspace planning strategy</label>
        ${planModeRadio(
          {
            planMode: workspacePlanMode,
            planPath: workspacePlanPath,
            selectedProjects: workspaceData
              ? workspaceData.projects.map((r) => r.name)
              : [],
          },
          {
            options: wsOptions,
            onChange: rerender
              ? (ev) => {
                  if (ev.type === 'set-plan-mode') workspacePlanMode = ev.value;
                  else if (ev.type === 'set-plan-path')
                    workspacePlanPath = ev.value;
                  rerender();
                }
              : undefined,
          },
        )}
        ${
          workspacePlanMode === 'existing'
            ? html`
              <div class="workspace-plan-upload">
                ${filePickerButton({
                  label: 'Browse workspace plan',
                  accept: '.json',
                  multiple: false,
                  className: 'btn-workspace-plan-browse',
                  onFiles: rerender
                    ? (files) => {
                        workspacePlanFile = files[0]
                          ? {
                              name: files[0].name,
                              size: files[0].size,
                              file: files[0],
                            }
                          : null;
                        rerender();
                      }
                    : undefined,
                })}
                ${
                  workspacePlanFile
                    ? html`
                      <sl-tag
                        removable
                        class="workspace-plan-tag"
                        @sl-remove=${
                          rerender
                            ? () => {
                                workspacePlanFile = null;
                                rerender();
                              }
                            : null
                        }
                      >${workspacePlanFile.name}</sl-tag>
                    `
                    : nothing
                }
                <sl-details class="workspace-plan-advanced" summary="Advanced: server-side path">
                  <sl-input
                    class="input-workspace-plan-path"
                    placeholder="workspace-plan.json"
                    value="${workspacePlanPath}"
                    @sl-input=${
                      rerender
                        ? (e) => {
                            workspacePlanPath = e.target.value;
                            rerender();
                          }
                        : null
                    }
                  ></sl-input>
                  <span class="settings-field-hint">File upload takes precedence over this path.</span>
                </sl-details>
              </div>
            `
            : nothing
        }
        ${
          workspacePlanMode === 'per-repo'
            ? html`
              <div class="per-project-plans">
                ${(workspaceData?.projects || []).map(
                  (proj) => html`
                    <div class="per-project-plan-row">
                      <span class="per-project-plan-name">${proj.name}</span>
                      ${filePickerButton({
                        label: perRepoPlans[proj.name]
                          ? perRepoPlans[proj.name].name
                          : 'Browse plan',
                        accept: '.md,.txt',
                        multiple: false,
                        className: 'btn-per-repo-plan-browse',
                        onFiles: rerender
                          ? (files) => {
                              if (files[0]) {
                                perRepoPlans = {
                                  ...perRepoPlans,
                                  [proj.name]: {
                                    name: files[0].name,
                                    size: files[0].size,
                                    file: files[0],
                                  },
                                };
                              }
                              rerender();
                            }
                          : undefined,
                      })}
                      ${
                        perRepoPlans[proj.name]
                          ? html`
                            <sl-tag
                              removable
                              class="per-project-plan-tag"
                              @sl-remove=${
                                rerender
                                  ? () => {
                                      const next = { ...perRepoPlans };
                                      delete next[proj.name];
                                      perRepoPlans = next;
                                      rerender();
                                    }
                                  : null
                              }
                            >${perRepoPlans[proj.name].name}</sl-tag>
                          `
                          : nothing
                      }
                    </div>
                  `,
                )}
                <sl-alert variant="neutral" open class="per-repo-fallback-alert">
                  Projects without a plan file will fallback to their own Planner.
                </sl-alert>
              </div>
            `
            : nothing
        }
        ${
          workspacePlanMode === 'independent'
            ? html`
              <sl-alert variant="warning" open class="plan-mode-independent-warning">
                Each repo runs its own Planner independently. Strategies may diverge across
                repos.
              </sl-alert>
            `
            : nothing
        }
        <span class="settings-field-hint">Master planner: a single shared plan is produced for the whole workspace and decomposed into per-project sub-plans. Independent: each project runs its own Planner.</span>
      </div>
    </div>
  `;
}

function _initTimeoutSection({ rerender } = {}) {
  return html`
    <div class="settings-field">
      <label class="settings-label">Init timeout (seconds)</label>
      <sl-input
        class="input-init-timeout"
        type="number"
        min="10"
        max="300"
        value="${initTimeout}"
        @sl-input=${
          rerender
            ? (e) => {
                initTimeout = Number(e.target.value) || 60;
                rerender();
              }
            : null
        }
      ></sl-input>
      <span class="settings-field-hint">Maximum time to wait for each project's worca init to complete.</span>
    </div>
  `;
}

async function _validateGhAuth(ws, { rerender } = {}) {
  ghAuthStatus = 'checking';
  rerender?.();
  try {
    const resp = await fetch('/api/workspace-runs/validate-gh-auth', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ workspace: ws.name }),
    });
    const data = await resp.json();
    if (data.ok) {
      ghAuthStatus = 'ok';
      ghAuthErrors = [];
    } else {
      ghAuthStatus = 'failed';
      ghAuthErrors = data.errors || [];
    }
  } catch {
    ghAuthStatus = null;
    ghAuthErrors = [];
  }
  rerender?.();
}

function _advancedWorkspaceSection({ rerender } = {}) {
  const wsRepoNames = workspaceData
    ? workspaceData.projects.map((r) => r.name)
    : [];

  return html`
    <div class="new-run-section">
      <h3 class="new-run-section-title">Advanced Options</h3>
      <div class="new-run-advanced">
        <div class="advanced-subgroup">
          <div class="advanced-subgroup-title">Branches</div>
          <div class="settings-field">
            <label class="settings-label">PR base branch (optional)</label>
            <sl-input
              class="input-base-branch"
              placeholder="main"
              value="${baseBranch}"
              @sl-change=${
                rerender
                  ? async (e) => {
                      baseBranch = e.target.value.trim();
                      baseBranchError = null;
                      if (baseBranch && wsRepoNames.length > 0) {
                        baseBranchValidating = true;
                        rerender();
                        try {
                          const resp = await fetch(
                            '/api/fleet-runs/validate-base',
                            {
                              method: 'POST',
                              headers: { 'Content-Type': 'application/json' },
                              body: JSON.stringify({
                                projects: wsRepoNames,
                                base_branch: baseBranch,
                              }),
                            },
                          );
                          const data = await resp.json();
                          baseBranchError =
                            !data.ok && data.missing_in?.length
                              ? { missing_in: data.missing_in }
                              : null;
                        } catch {
                          // non-blocking
                        } finally {
                          baseBranchValidating = false;
                          rerender();
                        }
                      } else {
                        rerender();
                      }
                    }
                  : null
              }
            ></sl-input>
            <span class="settings-field-hint">Branch the worktrees fork from and PRs target. Leave blank to use each project's default.</span>
          </div>
          ${
            nothing /* Branch template hidden — workspace branch_template
                      is captured in the manifest but dag_executor never
                      consumes it; the actual branch is hardcoded by
                      run_worktree. Re-mount when the wiring exists. */
          }
        </div>

        ${_workspacePlanSection({ rerender })}

        <div class="advanced-subgroup">
          <div class="advanced-subgroup-title">Concurrency</div>
          <div class="new-run-grid">
            <div class="settings-field">
              <label class="settings-label">Max parallel runs</label>
              <sl-input
                class="input-max-parallel"
                type="number"
                min="1"
                max="20"
                value="${maxParallel}"
                @sl-input=${
                  rerender
                    ? (e) => {
                        maxParallel = Number(e.target.value) || 5;
                        rerender();
                      }
                    : null
                }
              ></sl-input>
              <span class="settings-field-hint">Maximum concurrent child pipelines per tier.</span>
            </div>
            <div class="settings-field">
              <label class="settings-label">Circuit-breaker threshold: ${Math.round(failureThreshold * 100)}%</label>
              <sl-range
                class="input-failure-threshold"
                min="0"
                max="1"
                step="0.05"
                value="${failureThreshold}"
                @sl-input=${
                  rerender
                    ? (e) => {
                        failureThreshold = Number(e.target.value);
                        rerender();
                      }
                    : null
                }
              ></sl-range>
              <span class="settings-field-hint">Failure ratio that halts unstarted children after at least 3 have completed.</span>
            </div>
          </div>
        </div>

        <div class="advanced-subgroup">
          <div class="advanced-subgroup-title">Initialization</div>
          ${_initTimeoutSection({ rerender })}
        </div>
      </div>
    </div>
  `;
}

// ── main view ────────────────────────────────────────────────────────────────

export function fleetLauncherView(appState, { rerender } = {}) {
  const appProjects = appState?.projects || [];
  const guideCapBytes = resolveGuideCap(appState);
  const atCapacity = isAtCapacity(appState);
  const isWorkspace = launcherMode === 'workspace';

  return html`
    <div class="new-run-page fleet-launcher-page">
      ${
        atCapacity
          ? html`
            <sl-alert variant="warning" open class="capacity-warning">
              Pipeline limit reached — ${appState?.totalRunning ?? 0} of ${appState?.maxConcurrentPipelines ?? 10} slots in use. Stop a running pipeline or increase the limit in Settings.
            </sl-alert>
          `
          : nothing
      }
      ${
        submitStatus === 'error'
          ? html`<div class="new-run-error">${submitError}</div>`
          : nothing
      }
      <div class="new-run-form">
        ${isWorkspace ? _workspaceSelectSection(appState, { rerender }) : _projectsSection(appProjects, { rerender })}
        ${isWorkspace ? _workspaceDagSection() : nothing}
${
  nothing /* gh auth panel hidden — defaultValidateGhAuth is a no-op
              stub server-side, so the always-green badge would lie. Re-mount
              `_ghAuthSection({ rerender })` here when the real check ships. */
}
        ${_workSourceSection({ rerender })}
        ${_promptSection({ rerender })}
        ${_guideSection({ rerender, guideCapBytes })}
        ${isWorkspace ? _advancedWorkspaceSection({ rerender }) : _advancedSection({ rerender })}
      </div>
    </div>
  `;
}
