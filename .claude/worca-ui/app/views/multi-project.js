import { html, nothing } from 'lit-html';
import { unsafeHTML } from 'lit-html/directives/unsafe-html.js';
import { iconSvg, Play, Square, Loader, FileText, FolderOpen, Plus, Check, X, Clock } from '../utils/icons.js';

// Module-level state
let projects = []; // Array of { path: string, name: string }
let prompt = '';
let guideContent = '';
let guideName = '';
let msize = 1;
let mloops = 1;
let maxParallel = 3;
let submitStatus = null; // null | 'submitting' | 'error'
let submitError = '';
let multiRuns = []; // fetched from server
let pollingTimer = null;

function statusIcon(status) {
  if (status === 'completed') return html`<span class="mp-status mp-status--ok">${unsafeHTML(iconSvg(Check, 14))}</span>`;
  if (status === 'running') return html`<span class="mp-status mp-status--running">${unsafeHTML(iconSvg(Loader, 14, 'icon-spin'))}</span>`;
  if (status === 'error') return html`<span class="mp-status mp-status--error">${unsafeHTML(iconSvg(X, 14))}</span>`;
  if (status === 'pending') return html`<span class="mp-status mp-status--pending">${unsafeHTML(iconSvg(Clock, 14))}</span>`;
  return '';
}

function addProject(path) {
  const trimmed = path.trim();
  if (!trimmed) return;
  if (projects.find(p => p.path === trimmed)) return;
  const name = trimmed.split('/').filter(Boolean).pop() || trimmed;
  projects.push({ path: trimmed, name });
}

function removeProject(index) {
  projects.splice(index, 1);
}

function handleGuideFile(e) {
  const file = e.target.files?.[0];
  if (!file) return;
  guideName = file.name;
  const reader = new FileReader();
  reader.onload = () => {
    guideContent = reader.result;
  };
  reader.readAsText(file);
}

export function getMultiRunSubmitState() {
  return { submitStatus, isSubmitting: submitStatus === 'submitting' };
}

export async function submitMultiRun({ rerender, onStarted }) {
  if (projects.length === 0) {
    submitStatus = 'error';
    submitError = 'Add at least one project directory.';
    rerender();
    return;
  }
  if (!prompt.trim()) {
    submitStatus = 'error';
    submitError = 'Please enter a prompt.';
    rerender();
    return;
  }

  submitStatus = 'submitting';
  submitError = '';
  rerender();

  try {
    const body = {
      projects: projects.map(p => p.path),
      prompt: prompt.trim(),
      msize: Math.max(1, Math.min(10, msize)),
      mloops: Math.max(1, Math.min(10, mloops)),
      maxParallel: Math.max(1, Math.min(20, maxParallel)),
    };
    if (guideContent) body.guideContent = guideContent;

    const res = await fetch('/api/multi-runs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    const data = await res.json();
    if (data.ok) {
      submitStatus = null;
      onStarted(data.run.id);
    } else {
      submitStatus = 'error';
      submitError = data.error || 'Failed to start multi-project run';
      rerender();
    }
  } catch (err) {
    submitStatus = 'error';
    submitError = err.message || 'Network error';
    rerender();
  }
}

export async function fetchMultiRuns() {
  try {
    const res = await fetch('/api/multi-runs');
    const data = await res.json();
    if (data.ok) multiRuns = data.runs || [];
  } catch { /* ignore */ }
}

export async function fetchMultiRunDetail(runId) {
  try {
    const res = await fetch(`/api/multi-runs/${runId}`);
    const data = await res.json();
    if (data.ok) return data.run;
  } catch { /* ignore */ }
  return null;
}

export function startPolling(runId, rerender) {
  stopPolling();
  async function poll() {
    const run = await fetchMultiRunDetail(runId);
    if (run) {
      // Update in multiRuns list
      const idx = multiRuns.findIndex(r => r.id === runId);
      if (idx >= 0) multiRuns[idx] = run;
      else multiRuns.unshift(run);
      rerender();
      // Stop polling if completed
      if (run.completedAt) {
        stopPolling();
        return;
      }
    }
    pollingTimer = setTimeout(poll, 3000);
  }
  poll();
}

export function stopPolling() {
  if (pollingTimer) {
    clearTimeout(pollingTimer);
    pollingTimer = null;
  }
}

export async function stopMultiRun(runId, rerender) {
  try {
    await fetch(`/api/multi-runs/${runId}`, { method: 'DELETE' });
    const run = await fetchMultiRunDetail(runId);
    if (run) {
      const idx = multiRuns.findIndex(r => r.id === runId);
      if (idx >= 0) multiRuns[idx] = run;
    }
    rerender();
  } catch { /* ignore */ }
}

// --- Views ---

export function newMultiRunView(state, { rerender }) {
  function handleAddProject() {
    const input = document.getElementById('mp-project-input');
    if (input?.value) {
      addProject(input.value);
      input.value = '';
      rerender();
    }
  }

  function handleProjectKeydown(e) {
    if (e.key === 'Enter') {
      handleAddProject();
    }
  }

  return html`
    <div class="new-run-page">
      ${submitStatus === 'error' ? html`<div class="new-run-error">${submitError}</div>` : nothing}

      <div class="new-run-form">
        <div class="new-run-section">
          <h3 class="new-run-section-title">Project Directories</h3>
          <div class="mp-project-add">
            <sl-input id="mp-project-input"
              placeholder="/path/to/microservice"
              @keydown=${handleProjectKeydown}
            ></sl-input>
            <sl-button variant="default" @click=${handleAddProject}>
              ${unsafeHTML(iconSvg(Plus, 14))} Add
            </sl-button>
          </div>
          ${projects.length > 0 ? html`
            <div class="mp-project-list">
              ${projects.map((p, i) => html`
                <div class="mp-project-item">
                  <span class="mp-project-name">
                    ${unsafeHTML(iconSvg(FolderOpen, 14))}
                    ${p.name}
                  </span>
                  <span class="mp-project-path">${p.path}</span>
                  <button class="mp-project-remove" @click=${() => { removeProject(i); rerender(); }}>
                    ${unsafeHTML(iconSvg(X, 12))}
                  </button>
                </div>
              `)}
            </div>
          ` : html`<p class="mp-hint">Add project directories where the pipeline should run.</p>`}
        </div>

        <div class="new-run-section">
          <div class="settings-field">
            <label class="settings-label">Prompt</label>
            <sl-textarea id="mp-prompt" rows="6"
              placeholder="Describe the task to perform in each project..."
              @sl-input=${(e) => { prompt = e.target.value; }}
            ></sl-textarea>
          </div>

          <div class="settings-field">
            <label class="settings-label">Reference Guide (optional)</label>
            <div class="mp-guide-upload">
              <input type="file" id="mp-guide-file" accept=".md,.txt,.markdown"
                @change=${(e) => { handleGuideFile(e); rerender(); }} style="display:none">
              <sl-button variant="default" @click=${() => document.getElementById('mp-guide-file')?.click()}>
                ${unsafeHTML(iconSvg(FileText, 14))}
                ${guideName || 'Choose file...'}
              </sl-button>
              ${guideName ? html`
                <span class="mp-guide-info">${guideName} (${(guideContent.length / 1024).toFixed(1)}KB)</span>
                <button class="mp-project-remove" @click=${() => { guideContent = ''; guideName = ''; rerender(); }}>
                  ${unsafeHTML(iconSvg(X, 12))}
                </button>
              ` : nothing}
            </div>
            <span class="settings-field-hint">A shared document (migration guide, API spec, etc.) sent to all agents.</span>
          </div>
        </div>

        <div class="new-run-section">
          <h3 class="new-run-section-title">Options</h3>
          <div class="new-run-advanced">
            <div class="new-run-grid">
              <div class="settings-field">
                <label class="settings-label">Size Multiplier</label>
                <sl-input type="number" min="1" max="10" value="1"
                  @sl-input=${(e) => { msize = parseInt(e.target.value) || 1; }}></sl-input>
              </div>
              <div class="settings-field">
                <label class="settings-label">Loop Multiplier</label>
                <sl-input type="number" min="1" max="10" value="1"
                  @sl-input=${(e) => { mloops = parseInt(e.target.value) || 1; }}></sl-input>
              </div>
              <div class="settings-field">
                <label class="settings-label">Max Parallel</label>
                <sl-input type="number" min="1" max="20" value="3"
                  @sl-input=${(e) => { maxParallel = parseInt(e.target.value) || 3; }}></sl-input>
                <span class="settings-field-hint">Max concurrent pipelines</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  `;
}

export function multiRunDetailView(runId, { rerender }) {
  const run = multiRuns.find(r => r.id === runId);
  if (!run) {
    return html`<div class="mp-loading">Loading...</div>`;
  }

  const projectEntries = Object.values(run.projectStatuses || {});
  const isActive = !run.completedAt;
  const completed = projectEntries.filter(p => p.status === 'completed').length;
  const failed = projectEntries.filter(p => p.status === 'error').length;
  const running = projectEntries.filter(p => p.status === 'running').length;
  const pending = projectEntries.filter(p => p.status === 'pending').length;

  return html`
    <div class="mp-detail">
      <div class="mp-summary">
        <div class="mp-summary-stats">
          <span class="mp-stat">${projectEntries.length} projects</span>
          ${completed > 0 ? html`<span class="mp-stat mp-stat--ok">${completed} completed</span>` : ''}
          ${running > 0 ? html`<span class="mp-stat mp-stat--running">${running} running</span>` : ''}
          ${pending > 0 ? html`<span class="mp-stat mp-stat--pending">${pending} pending</span>` : ''}
          ${failed > 0 ? html`<span class="mp-stat mp-stat--error">${failed} failed</span>` : ''}
        </div>
        <div class="mp-prompt-preview">${run.prompt}</div>
        ${run.hasGuide ? html`<div class="mp-guide-badge">${unsafeHTML(iconSvg(FileText, 12))} Guide attached (${(run.guideLength / 1024).toFixed(1)}KB)</div>` : ''}
      </div>

      <div class="mp-projects-grid">
        ${projectEntries.map(proj => html`
          <div class="mp-project-card mp-project-card--${proj.status}">
            <div class="mp-project-card-header">
              ${statusIcon(proj.status)}
              <span class="mp-project-card-name">${proj.name}</span>
              ${proj.status === 'running' && proj.pid ? html`<span class="mp-project-pid">PID ${proj.pid}</span>` : ''}
            </div>
            <div class="mp-project-card-path">${proj.path}</div>
            ${proj.error ? html`<div class="mp-project-card-error">${proj.error}</div>` : ''}
            ${proj.pipelineStatus?.stages ? html`
              <div class="mp-project-stages">
                ${Object.entries(proj.pipelineStatus.stages).map(([key, stage]) => html`
                  <span class="mp-stage-badge mp-stage-badge--${stage.status}" title="${key}: ${stage.status}">
                    ${key.slice(0, 3).toUpperCase()}
                  </span>
                `)}
              </div>
            ` : ''}
          </div>
        `)}
      </div>
    </div>
  `;
}

export function multiRunListView({ onSelectRun, rerender }) {
  if (multiRuns.length === 0) {
    return html`<div class="mp-empty">No multi-project runs yet.</div>`;
  }

  return html`
    <div class="mp-run-list">
      ${multiRuns.map(run => {
        const projectEntries = Object.values(run.projectStatuses || {});
        const completed = projectEntries.filter(p => p.status === 'completed').length;
        const failed = projectEntries.filter(p => p.status === 'error').length;
        const isActive = !run.completedAt;

        return html`
          <div class="mp-run-card ${isActive ? 'mp-run-card--active' : ''}"
               @click=${() => onSelectRun(run.id)}>
            <div class="mp-run-card-header">
              ${isActive
                ? html`<sl-badge variant="warning" pill>${unsafeHTML(iconSvg(Loader, 10, 'icon-spin'))} Running</sl-badge>`
                : failed > 0
                  ? html`<sl-badge variant="danger" pill>${failed} failed</sl-badge>`
                  : html`<sl-badge variant="success" pill>Completed</sl-badge>`
              }
              <span class="mp-run-card-time">${new Date(run.startedAt).toLocaleString()}</span>
            </div>
            <div class="mp-run-card-prompt">${run.prompt.slice(0, 100)}${run.prompt.length > 100 ? '...' : ''}</div>
            <div class="mp-run-card-stats">
              ${projectEntries.length} projects |
              ${completed} completed |
              ${failed} failed
            </div>
          </div>
        `;
      })}
    </div>
  `;
}

export { multiRuns };
