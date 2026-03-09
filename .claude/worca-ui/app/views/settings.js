import { html, nothing } from 'lit-html';
import { unsafeHTML } from 'lit-html/directives/unsafe-html.js';
import { iconSvg, Users, Shield, GitBranch, ChevronRight, Save, Settings } from '../utils/icons.js';

// Stage-to-agent mapping (from stages.py STAGE_AGENT_MAP)
const STAGE_AGENT_MAP = {
  plan: 'planner',
  coordinate: 'coordinator',
  implement: 'implementer',
  test: 'tester',
  review: 'guardian',
  pr: 'guardian'
};

const STAGE_ORDER = ['plan', 'coordinate', 'implement', 'test', 'review', 'pr'];
const AGENT_NAMES = ['planner', 'coordinator', 'implementer', 'tester', 'guardian'];
const MODEL_OPTIONS = ['opus', 'sonnet', 'haiku'];

const GUARD_RULES = [
  { key: 'block_rm_rf', label: 'Block rm -rf', description: 'Prevent recursive force-delete commands' },
  { key: 'block_env_write', label: 'Block .env writes', description: 'Prevent writing to .env files' },
  { key: 'block_force_push', label: 'Block force push', description: 'Prevent git push --force' },
  { key: 'restrict_git_commit', label: 'Restrict git commit', description: 'Only guardian agent may commit' },
];

const DEFAULT_GOVERNANCE = {
  guards: { block_rm_rf: true, block_env_write: true, block_force_push: true, restrict_git_commit: true },
  test_gate_strikes: 2,
  dispatch: {
    planner: [],
    coordinator: ['implementer'],
    implementer: [],
    tester: [],
    guardian: []
  }
};

// --- Module state ---
let settingsData = null;
let saveStatus = null; // null | 'saving' | 'success' | 'error'
let saveMessage = '';

export async function loadSettings() {
  try {
    const res = await fetch('/api/settings');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    settingsData = await res.json();
    // Ensure worca and governance defaults exist
    if (!settingsData.worca) settingsData.worca = {};
    if (!settingsData.worca.governance) {
      settingsData.worca.governance = { ...DEFAULT_GOVERNANCE };
    } else {
      settingsData.worca.governance = {
        ...DEFAULT_GOVERNANCE,
        ...settingsData.worca.governance,
        guards: { ...DEFAULT_GOVERNANCE.guards, ...(settingsData.worca.governance.guards || {}) },
        dispatch: { ...DEFAULT_GOVERNANCE.dispatch, ...(settingsData.worca.governance.dispatch || {}) }
      };
    }
  } catch (err) {
    settingsData = null;
    saveStatus = 'error';
    saveMessage = 'Failed to load settings: ' + err.message;
  }
}

async function saveSettings(data, rerender) {
  saveStatus = 'saving';
  saveMessage = '';
  rerender();
  try {
    const res = await fetch('/api/settings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data)
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const result = await res.json();
    settingsData = { worca: result.worca, permissions: result.permissions };
    saveStatus = 'success';
    saveMessage = 'Settings saved successfully';
  } catch (err) {
    saveStatus = 'error';
    saveMessage = 'Failed to save: ' + err.message;
  }
  rerender();
  // Auto-clear success after 3s
  if (saveStatus === 'success') {
    setTimeout(() => {
      if (saveStatus === 'success') {
        saveStatus = null;
        saveMessage = '';
        rerender();
      }
    }, 3000);
  }
}

// --- Read form values from DOM ---

function readAgentsFromDom() {
  const agents = {};
  for (const name of AGENT_NAMES) {
    const modelEl = document.getElementById(`agent-${name}-model`);
    const turnsEl = document.getElementById(`agent-${name}-turns`);
    agents[name] = {
      model: modelEl?.value || 'sonnet',
      max_turns: parseInt(turnsEl?.value, 10) || 30
    };
  }
  return agents;
}

function readPipelineFromDom() {
  const loops = {};
  for (const key of ['implement_test', 'code_review', 'pr_changes', 'restart_planning']) {
    const el = document.getElementById(`loop-${key}`);
    loops[key] = parseInt(el?.value, 10) || 0;
  }
  return { loops };
}

function readGovernanceFromDom() {
  const guards = {};
  for (const rule of GUARD_RULES) {
    const el = document.getElementById(`guard-${rule.key}`);
    guards[rule.key] = el?.checked ?? true;
  }
  const strikeEl = document.getElementById('test-gate-strikes');
  const test_gate_strikes = parseInt(strikeEl?.value, 10) || 2;

  const dispatch = {};
  for (const agent of AGENT_NAMES) {
    const el = document.getElementById(`dispatch-${agent}`);
    const val = (el?.value || '').trim();
    dispatch[agent] = val ? val.split(',').map(s => s.trim()).filter(Boolean) : [];
  }

  return { guards, test_gate_strikes, dispatch };
}

// --- Tab views ---

function agentsTab(worca, rerender) {
  const agents = worca.agents || {};
  return html`
    <div class="settings-tab-content">
      <div class="settings-cards">
        ${AGENT_NAMES.map(name => {
          const agent = agents[name] || {};
          return html`
            <div class="settings-card">
              <div class="settings-card-header">
                <span class="settings-card-icon">${unsafeHTML(iconSvg(Users, 18))}</span>
                <span class="settings-card-title">${name}</span>
              </div>
              <div class="settings-card-body">
                <div class="settings-field">
                  <label class="settings-label">Model</label>
                  <sl-select id="agent-${name}-model" .value="${agent.model || 'sonnet'}" size="small">
                    ${MODEL_OPTIONS.map(m => html`<sl-option value="${m}">${m}</sl-option>`)}
                  </sl-select>
                </div>
                <div class="settings-field">
                  <label class="settings-label">Max Turns</label>
                  <sl-input id="agent-${name}-turns" type="number" value="${agent.max_turns || 30}" size="small" min="1" max="200"></sl-input>
                </div>
              </div>
            </div>
          `;
        })}
      </div>
      <div class="settings-tab-actions">
        <sl-button variant="primary" size="small" @click=${() => {
          const agents = readAgentsFromDom();
          saveSettings({ worca: { ...settingsData.worca, agents }, permissions: settingsData.permissions }, rerender);
        }}>
          ${unsafeHTML(iconSvg(Save, 14))}
          Save Agents
        </sl-button>
      </div>
    </div>
  `;
}

function pipelineTab(worca, rerender) {
  const loops = worca.loops || {};

  return html`
    <div class="settings-tab-content">
      <h3 class="settings-section-title">Stage Order</h3>
      <div class="pipeline-flow">
        ${STAGE_ORDER.map((stage, i) => html`
          <div class="pipeline-stage-node">
            <div class="pipeline-stage-name">${stage}</div>
            <div class="pipeline-stage-agent">${STAGE_AGENT_MAP[stage]}</div>
          </div>
          ${i < STAGE_ORDER.length - 1 ? html`
            <span class="pipeline-arrow">${unsafeHTML(iconSvg(ChevronRight, 16))}</span>
          ` : nothing}
        `)}
      </div>

      <h3 class="settings-section-title">Loop Limits</h3>
      <div class="settings-grid">
        ${[
          { key: 'implement_test', label: 'Implement \u2194 Test' },
          { key: 'code_review', label: 'Code Review' },
          { key: 'pr_changes', label: 'PR Changes' },
          { key: 'restart_planning', label: 'Restart Planning' }
        ].map(item => html`
          <div class="settings-field">
            <label class="settings-label">${item.label}</label>
            <sl-input id="loop-${item.key}" type="number" value="${loops[item.key] || 0}" size="small" min="0" max="50"></sl-input>
          </div>
        `)}
      </div>

      <div class="settings-tab-actions">
        <sl-button variant="primary" size="small" @click=${() => {
          const { loops } = readPipelineFromDom();
          saveSettings({ worca: { ...settingsData.worca, loops }, permissions: settingsData.permissions }, rerender);
        }}>
          ${unsafeHTML(iconSvg(Save, 14))}
          Save Pipeline
        </sl-button>
      </div>
    </div>
  `;
}

function governanceTab(worca, permissions, rerender) {
  const governance = worca.governance || DEFAULT_GOVERNANCE;
  const guards = governance.guards || DEFAULT_GOVERNANCE.guards;
  const dispatch = governance.dispatch || DEFAULT_GOVERNANCE.dispatch;
  const permList = permissions.allow || [];

  return html`
    <div class="settings-tab-content">
      <h3 class="settings-section-title">Guard Rules</h3>
      <div class="settings-switches">
        ${GUARD_RULES.map(rule => html`
          <div class="settings-switch-row">
            <sl-switch id="guard-${rule.key}" ?checked=${guards[rule.key] !== false} size="small">
              ${rule.label}
            </sl-switch>
            <span class="settings-switch-desc">${rule.description}</span>
          </div>
        `)}
      </div>

      <h3 class="settings-section-title">Test Gate</h3>
      <div class="settings-grid">
        <div class="settings-field">
          <label class="settings-label">Strike Threshold</label>
          <sl-input id="test-gate-strikes" type="number" value="${governance.test_gate_strikes || 2}" size="small" min="1" max="10"></sl-input>
          <span class="settings-field-hint">Consecutive test failures before blocking</span>
        </div>
      </div>

      <h3 class="settings-section-title">Dispatch Rules</h3>
      <div class="settings-dispatch-table">
        ${AGENT_NAMES.map(agent => html`
          <div class="settings-dispatch-row">
            <span class="settings-dispatch-agent">${agent}</span>
            <sl-input id="dispatch-${agent}" value="${(dispatch[agent] || []).join(', ')}" size="small" placeholder="none"></sl-input>
          </div>
        `)}
      </div>

      <h3 class="settings-section-title">Permissions</h3>
      <div class="settings-permissions">
        ${permList.length > 0
          ? permList.map(p => html`<div class="settings-perm-item"><code>${p}</code></div>`)
          : html`<span class="settings-muted">No permissions configured</span>`}
      </div>

      <div class="settings-tab-actions">
        <sl-button variant="primary" size="small" @click=${() => {
          const governance = readGovernanceFromDom();
          saveSettings({ worca: { ...settingsData.worca, governance }, permissions: settingsData.permissions }, rerender);
        }}>
          ${unsafeHTML(iconSvg(Save, 14))}
          Save Governance
        </sl-button>
      </div>
    </div>
  `;
}

function preferencesTab(preferences, onThemeToggle) {
  const theme = preferences?.theme || 'light';
  return html`
    <div class="settings-tab-content">
      <h3 class="settings-section-title">Appearance</h3>
      <div class="settings-switches">
        <div class="settings-switch-row">
          <sl-switch ?checked=${theme === 'dark'} size="small" @sl-change=${onThemeToggle}>Dark Mode</sl-switch>
          <span class="settings-switch-desc">Toggle between light and dark theme</span>
        </div>
      </div>
    </div>
  `;
}

// --- Feedback alert ---

function feedbackAlert(rerender) {
  if (!saveStatus || saveStatus === 'saving') return nothing;
  const variant = saveStatus === 'success' ? 'success' : 'danger';
  return html`
    <div class="settings-toast">
      <sl-alert variant="${variant}" open closable duration="3000"
        @sl-after-hide=${() => { saveStatus = null; saveMessage = ''; rerender(); }}>
        ${saveMessage}
      </sl-alert>
    </div>
  `;
}

// --- Main export ---

export function settingsView(preferences, { rerender, onThemeToggle }) {
  if (!settingsData) {
    return html`<div class="empty-state">Loading settings\u2026</div>`;
  }

  const worca = settingsData.worca || {};
  const permissions = settingsData.permissions || {};

  return html`
    ${feedbackAlert(rerender)}
    <div class="settings-page">
      <sl-tab-group>
        <sl-tab slot="nav" panel="agents">
          ${unsafeHTML(iconSvg(Users, 14))}
          Agents
        </sl-tab>
        <sl-tab slot="nav" panel="pipeline">
          ${unsafeHTML(iconSvg(GitBranch, 14))}
          Pipeline
        </sl-tab>
        <sl-tab slot="nav" panel="governance">
          ${unsafeHTML(iconSvg(Shield, 14))}
          Governance
        </sl-tab>
        <sl-tab slot="nav" panel="preferences">
          ${unsafeHTML(iconSvg(Settings, 14))}
          Preferences
        </sl-tab>

        <sl-tab-panel name="agents">${agentsTab(worca, rerender)}</sl-tab-panel>
        <sl-tab-panel name="pipeline">${pipelineTab(worca, rerender)}</sl-tab-panel>
        <sl-tab-panel name="governance">${governanceTab(worca, permissions, rerender)}</sl-tab-panel>
        <sl-tab-panel name="preferences">${preferencesTab(preferences, onThemeToggle)}</sl-tab-panel>
      </sl-tab-group>
    </div>
  `;
}
