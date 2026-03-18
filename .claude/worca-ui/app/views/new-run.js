import { html, nothing } from 'lit-html';
import { unsafeHTML } from 'lit-html/directives/unsafe-html.js';
import { iconSvg, FileText } from '../utils/icons.js';
import { getDefaults } from './settings.js';

// Module-level state
let sourceType = 'none';
let submitStatus = null; // null | 'submitting' | 'error'
let submitError = '';
let planFiles = null; // cached response
let planFilter = '';
let planDropdownOpen = false;
let selectedPlan = '';
let branches = null; // null = not fetched, [] = fetched but empty
let selectedBranch = ''; // empty = new branch

/**
 * Reset module state for testing or re-initialization.
 */
export function resetNewRunState(overrides = {}) {
  sourceType = overrides.sourceType ?? 'none';
  submitStatus = null;
  submitError = '';
  selectedPlan = overrides.selectedPlan ?? '';
  planFilter = overrides.selectedPlan ?? '';
  selectedBranch = '';
}

function sourceLabel(type) {
  if (type === 'source') return 'GitHub Issue URL';
  if (type === 'spec') return 'Spec File Path';
  return '';
}

function fetchBranches() {
  if (branches !== null) return Promise.resolve(branches);
  return fetch('/api/branches')
    .then(r => r.json())
    .then(data => {
      branches = (data.ok && data.branches) || [];
      return branches;
    })
    .catch(() => { branches = []; return []; });
}

function fetchPlanFiles() {
  if (planFiles) return Promise.resolve(planFiles);
  return fetch('/api/plan-files')
    .then(r => r.json())
    .then(data => {
      if (data.ok) planFiles = data.files;
      return planFiles || [];
    })
    .catch(() => []);
}

function filteredPlanFiles() {
  if (!planFiles) return [];
  if (!planFilter) return planFiles;
  const term = planFilter.toLowerCase();
  return planFiles.filter(f =>
    f.name.toLowerCase().includes(term) || f.path.toLowerCase().includes(term)
  );
}

function groupedPlanFiles(files) {
  const groups = {};
  for (const f of files) {
    if (!groups[f.dir]) groups[f.dir] = [];
    groups[f.dir].push(f);
  }
  return groups;
}

export function getNewRunSubmitState() {
  return { submitStatus, isSubmitting: submitStatus === 'submitting' };
}

export async function submitNewRun({ rerender, onStarted }) {
  const sourceValueEl = document.getElementById('new-run-source-value');
  const promptEl = document.getElementById('new-run-prompt');
  const msizeEl = document.getElementById('new-run-msize');
  const mloopsEl = document.getElementById('new-run-mloops');

  const sourceValue = sourceValueEl?.value?.trim() || '';
  const promptValue = promptEl?.value?.trim() || '';

  const hasSource = sourceType !== 'none' && sourceValue.length > 0;
  const hasPlan = !!selectedPlan;
  const hasPrompt = promptValue.length > 0;

  // Validation: sourceType requires a sourceValue
  if (sourceType !== 'none' && !sourceValue) {
    submitStatus = 'error';
    submitError = `Please enter a ${sourceLabel(sourceType).toLowerCase()}.`;
    rerender();
    return;
  }

  // Validation: at least one of source, plan, or prompt required
  if (!hasSource && !hasPlan && !hasPrompt) {
    submitStatus = 'error';
    submitError = 'Please provide at least one of: a work source, a plan file, or a prompt.';
    rerender();
    return;
  }

  const msize = msizeEl ? parseInt(msizeEl.value, 10) || 1 : 1;
  const mloops = mloopsEl ? parseInt(mloopsEl.value, 10) || 1 : 1;

  submitStatus = 'submitting';
  submitError = '';
  rerender();

  try {
    const body = {
      sourceType,
      msize: Math.max(1, Math.min(10, msize)),
      mloops: Math.max(1, Math.min(10, mloops)),
    };
    if (hasSource) body.sourceValue = sourceValue;
    if (hasPrompt) body.prompt = promptValue;
    if (hasPlan) body.planFile = selectedPlan;
    if (selectedBranch) body.branch = selectedBranch;

    const res = await fetch('/api/runs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    const data = await res.json();
    if (data.ok) {
      submitStatus = null;
      onStarted();
    } else {
      submitStatus = 'error';
      submitError = data.error || 'Failed to start pipeline';
      rerender();
    }
  } catch (err) {
    submitStatus = 'error';
    submitError = err.message || 'Network error';
    rerender();
  }
}

export function newRunView(state, { rerender }) {

  function handleSourceTypeChange(e) {
    sourceType = e.target.value;
    rerender();
  }

  // Fetch branches once (null = not yet fetched)
  if (branches === null) {
    fetchBranches().then(() => rerender());
  }

  function handleBranchChange(e) {
    selectedBranch = e.target.value;
    rerender();
  }

  function handlePlanFocus() {
    fetchPlanFiles().then(() => {
      planDropdownOpen = true;
      rerender();
    });
  }

  function handlePlanInput(e) {
    planFilter = e.target.value;
    selectedPlan = '';
    planDropdownOpen = true;
    rerender();
  }

  function handlePlanBlur() {
    // Delay to allow click events on dropdown items
    setTimeout(() => {
      planDropdownOpen = false;
      rerender();
    }, 200);
  }

  function handlePlanSelect(file) {
    selectedPlan = file.path;
    planFilter = file.path;
    planDropdownOpen = false;
    rerender();
  }

  function handlePlanClear() {
    selectedPlan = '';
    planFilter = '';
    rerender();
  }

  const filtered = filteredPlanFiles();
  const grouped = groupedPlanFiles(filtered);

  const hasSource = sourceType !== 'none';
  const hasPlan = !!selectedPlan;
  const promptRequired = !hasSource && !hasPlan;
  const promptLabel = promptRequired ? 'Prompt (required)' : 'Additional Instructions (optional)';

  return html`
    <div class="new-run-page">
      ${submitStatus === 'error' ? html`<div class="new-run-error">${submitError}</div>` : nothing}

      <div class="new-run-form">
        <!-- Section 1: Work Source -->
        <div class="new-run-section">
          <h3 class="new-run-section-title">Work Source</h3>
          <div class="settings-field">
            <label class="settings-label">Source Type</label>
            <sl-select id="new-run-source-type" value=${sourceType} @sl-change=${handleSourceTypeChange}>
              <sl-option value="none">None</sl-option>
              <sl-option value="source">GitHub Issue</sl-option>
              <sl-option value="spec">Spec File</sl-option>
            </sl-select>
          </div>

          ${sourceType !== 'none' ? html`
            <div class="settings-field">
              <label class="settings-label">${sourceLabel(sourceType)}</label>
              <sl-input id="new-run-source-value" placeholder=${sourceType === 'source' ? 'https://github.com/...' : 'path/to/spec.md'}></sl-input>
            </div>
          ` : nothing}

          <div class="settings-field">
            <label class="settings-label">Plan File (optional)</label>
            <div class="plan-autocomplete">
              <sl-input
                id="new-run-plan"
                placeholder="Type to search plan files..."
                .value=${planFilter}
                @sl-input=${handlePlanInput}
                @sl-focus=${handlePlanFocus}
                @sl-blur=${handlePlanBlur}
                clearable
                @sl-clear=${handlePlanClear}
              >
                <span slot="prefix">${unsafeHTML(iconSvg(FileText, 14))}</span>
              </sl-input>
              ${planDropdownOpen && filtered.length > 0 ? html`
                <div class="plan-dropdown">
                  ${Object.entries(grouped).map(([dir, files]) => html`
                    <div class="plan-group-header">${dir}/</div>
                    ${files.map(f => html`
                      <div class="plan-item" @mousedown=${() => handlePlanSelect(f)}>
                        ${f.name}
                      </div>
                    `)}
                  `)}
                </div>
              ` : nothing}
            </div>
            <span class="settings-field-hint">Skips the planning stage. Relative to project root.</span>
          </div>
        </div>

        <!-- Section 2: Prompt -->
        <div class="new-run-section">
          <h3 class="new-run-section-title">Prompt</h3>
          <div class="settings-field">
            <label class="settings-label">${promptLabel}</label>
            <sl-textarea id="new-run-prompt" rows="8" placeholder="Describe what the pipeline should do..."></sl-textarea>
          </div>
        </div>

        <!-- Section 3: Advanced Options -->
        <div class="new-run-section">
          <h3 class="new-run-section-title">Advanced Options</h3>
          <div class="new-run-advanced">
            <div class="new-run-grid">
              <div class="settings-field">
                <label class="settings-label">Size Multiplier (msize)</label>
                <sl-input id="new-run-msize" type="number" min="1" max="10" value="${getDefaults().msize}"></sl-input>
                <span class="settings-field-hint">Scales max_turns per stage (1-10)</span>
              </div>

              <div class="settings-field">
                <label class="settings-label">Loop Multiplier (mloops)</label>
                <sl-input id="new-run-mloops" type="number" min="1" max="10" value="${getDefaults().mloops}"></sl-input>
                <span class="settings-field-hint">Scales max loop iterations (1-10)</span>
              </div>
            </div>

            <div class="settings-field">
              <label class="settings-label">Branch</label>
              <sl-select value=${selectedBranch} @sl-change=${handleBranchChange}>
                <sl-option value="">&lt;New branch&gt;</sl-option>
                ${(branches || []).map(b => html`
                  <sl-option value=${b}>${b}</sl-option>
                `)}
              </sl-select>
              <span class="settings-field-hint">Use an existing branch instead of creating a new one</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  `;
}
