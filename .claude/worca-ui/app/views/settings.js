import { html, nothing } from 'lit-html';
import { unsafeHTML } from 'lit-html/directives/unsafe-html.js';
import { iconSvg, Users, Shield, GitBranch, ChevronRight, Save, Settings, Bell, Plus, X } from '../utils/icons.js';

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

const DEFAULT_STAGES = {
  plan:       { agent: 'planner',     enabled: true },
  coordinate: { agent: 'coordinator', enabled: true },
  implement:  { agent: 'implementer', enabled: true },
  test:       { agent: 'tester',      enabled: true },
  review:     { agent: 'guardian',     enabled: true },
  pr:         { agent: 'guardian',     enabled: true }
};

export const PRICING_MODELS = ['opus', 'sonnet'];
export const PRICING_FIELDS = [
  { key: 'input_per_mtok', label: 'Input/MTok' },
  { key: 'output_per_mtok', label: 'Output/MTok' },
  { key: 'cache_write_per_mtok', label: 'Cache Write/MTok' },
  { key: 'cache_read_per_mtok', label: 'Cache Read/MTok' },
];
export const DEFAULT_PRICING = {
  models: {
    opus: { input_per_mtok: 15, output_per_mtok: 75, cache_write_per_mtok: 18.75, cache_read_per_mtok: 1.5 },
    sonnet: { input_per_mtok: 3, output_per_mtok: 15, cache_write_per_mtok: 3.75, cache_read_per_mtok: 0.3 },
  },
  currency: 'USD',
  last_updated: '2025-05-01',
};

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
    // Ensure stages defaults exist
    if (!settingsData.worca.stages) {
      settingsData.worca.stages = { ...DEFAULT_STAGES };
    } else {
      for (const stage of STAGE_ORDER) {
        if (!settingsData.worca.stages[stage]) {
          settingsData.worca.stages[stage] = { ...DEFAULT_STAGES[stage] };
        }
      }
    }
    if (!settingsData.worca.plan_path_template) {
      settingsData.worca.plan_path_template = 'docs/plans/{timestamp}-{title_slug}.md';
    }
    if (!settingsData.worca.defaults) {
      settingsData.worca.defaults = { msize: 1, mloops: 1 };
    }
    if (!settingsData.worca.pricing) {
      settingsData.worca.pricing = { ...DEFAULT_PRICING, models: { ...DEFAULT_PRICING.models } };
    } else {
      if (!settingsData.worca.pricing.models) settingsData.worca.pricing.models = {};
      for (const model of PRICING_MODELS) {
        settingsData.worca.pricing.models[model] = {
          ...DEFAULT_PRICING.models[model],
          ...(settingsData.worca.pricing.models[model] || {}),
        };
      }
    }
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
  for (const key of ['implement_test', 'pr_changes', 'restart_planning']) {
    const el = document.getElementById(`loop-${key}`);
    loops[key] = parseInt(el?.value, 10) || 0;
  }
  const planPathEl = document.getElementById('plan-path-template');
  const plan_path_template = planPathEl?.value?.trim() || '';
  const msizeEl = document.getElementById('defaults-msize');
  const mloopsEl = document.getElementById('defaults-mloops');
  const defaults = {
    msize: parseInt(msizeEl?.value, 10) || 1,
    mloops: parseInt(mloopsEl?.value, 10) || 1,
  };
  return { loops, plan_path_template, defaults };
}

function readStagesFromDom() {
  const stages = {};
  for (const stage of STAGE_ORDER) {
    const enabledEl = document.getElementById(`stage-${stage}-enabled`);
    const agentEl = document.getElementById(`stage-${stage}-agent`);
    stages[stage] = {
      agent: agentEl?.value || DEFAULT_STAGES[stage].agent,
      enabled: enabledEl?.checked ?? true
    };
  }
  return stages;
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

export function readPermissionsFromDom() {
  const inputs = document.querySelectorAll('.perm-input');
  return Array.from(inputs)
    .map(el => el.value.trim())
    .filter(v => v.length > 0);
}

export function readPricingFromDom() {
  const models = {};
  for (const model of PRICING_MODELS) {
    models[model] = {};
    for (const field of PRICING_FIELDS) {
      const el = document.getElementById(`pricing-${model}-${field.key}`);
      models[model][field.key] = parseFloat(el?.value) || 0;
    }
  }
  return {
    models,
    currency: DEFAULT_PRICING.currency,
    last_updated: new Date().toISOString().slice(0, 10),
  };
}

export function getDefaults() {
  return settingsData?.worca?.defaults || { msize: 1, mloops: 1 };
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
  const stages = worca.stages || DEFAULT_STAGES;

  return html`
    <div class="settings-tab-content">
      <h3 class="settings-section-title">Stage Configuration</h3>
      <div class="pipeline-flow">
        ${STAGE_ORDER.map((stage, i) => {
          const stageConfig = stages[stage] || DEFAULT_STAGES[stage];
          const enabled = stageConfig.enabled !== false;
          return html`
            <div class="pipeline-stage-node ${enabled ? 'pipeline-stage-node--enabled' : 'pipeline-stage-node--disabled'}">
              <div class="pipeline-stage-header">
                <span class="pipeline-stage-name ${enabled ? '' : 'pipeline-stage-name--disabled'}">${stage}</span>
                <sl-switch id="stage-${stage}-enabled" ?checked=${enabled} size="small"
                  @sl-change=${(e) => {
                    const node = e.target.closest('.pipeline-stage-node');
                    if (e.target.checked) {
                      node.classList.remove('pipeline-stage-node--disabled');
                      node.classList.add('pipeline-stage-node--enabled');
                      node.querySelector('.pipeline-stage-name').classList.remove('pipeline-stage-name--disabled');
                    } else {
                      node.classList.remove('pipeline-stage-node--enabled');
                      node.classList.add('pipeline-stage-node--disabled');
                      node.querySelector('.pipeline-stage-name').classList.add('pipeline-stage-name--disabled');
                    }
                  }}></sl-switch>
              </div>
              <div class="settings-field pipeline-stage-field">
                <label class="settings-label">Agent</label>
                <sl-select id="stage-${stage}-agent" .value="${stageConfig.agent || STAGE_AGENT_MAP[stage]}" size="small">
                  ${AGENT_NAMES.map(a => html`<sl-option value="${a}">${a}</sl-option>`)}
                </sl-select>
              </div>
            </div>
            ${i < STAGE_ORDER.length - 1 ? html`
              <span class="pipeline-arrow">${unsafeHTML(iconSvg(ChevronRight, 16))}</span>
            ` : nothing}
          `;
        })}
      </div>

      <h3 class="settings-section-title">Loop Limits</h3>
      <div class="settings-grid">
        ${[
          { key: 'implement_test', label: 'Implement \u2194 Test' },
          { key: 'pr_changes', label: 'PR Changes' },
          { key: 'restart_planning', label: 'Restart Planning' }
        ].map(item => html`
          <div class="settings-field">
            <label class="settings-label">${item.label}</label>
            <sl-input id="loop-${item.key}" type="number" value="${loops[item.key] || 0}" size="small" min="0" max="50"></sl-input>
          </div>
        `)}
      </div>

      <h3 class="settings-section-title">Plan Path Template</h3>
      <div class="settings-grid">
        <div class="settings-field">
          <label class="settings-label">Path Template</label>
          <sl-input id="plan-path-template" value="${worca.plan_path_template || ''}" size="small" placeholder="docs/plans/{timestamp}-{title_slug}.md"></sl-input>
          <span class="settings-field-hint">Placeholders: {timestamp}, {title_slug} — Default: docs/plans/{timestamp}-{title_slug}.md</span>
        </div>
      </div>

      <h3 class="settings-section-title">Run Defaults</h3>
      <div class="settings-grid">
        <div class="settings-field">
          <label class="settings-label">Size Multiplier (msize)</label>
          <sl-input id="defaults-msize" type="number" value="${(worca.defaults || {}).msize || 1}" size="small" min="1" max="10"></sl-input>
          <span class="settings-field-hint">Scales max_turns per stage</span>
        </div>
        <div class="settings-field">
          <label class="settings-label">Loop Multiplier (mloops)</label>
          <sl-input id="defaults-mloops" type="number" value="${(worca.defaults || {}).mloops || 1}" size="small" min="1" max="10"></sl-input>
          <span class="settings-field-hint">Scales max loop iterations</span>
        </div>
      </div>

      <div class="settings-tab-actions">
        <sl-button variant="primary" size="small" @click=${() => {
          const { loops, plan_path_template, defaults } = readPipelineFromDom();
          const stages = readStagesFromDom();
          saveSettings({ worca: { ...settingsData.worca, loops, stages, plan_path_template, defaults }, permissions: settingsData.permissions }, rerender);
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
  if (!permissions.allow) permissions.allow = [];
  const permList = permissions.allow;

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
      <div class="settings-permissions" id="permissions-list">
        ${permList.map((p, i) => html`
          <div class="settings-perm-item settings-perm-item--editable">
            <sl-input class="perm-input" value="${p}" size="small" placeholder="e.g. Bash(pytest *)"></sl-input>
            <sl-icon-button name="x" label="Remove" class="perm-remove-btn" @click=${() => {
              permList.splice(i, 1);
              rerender();
            }}>${unsafeHTML(iconSvg(X, 14))}</sl-icon-button>
          </div>
        `)}
        ${permList.length === 0 ? html`<span class="settings-muted">No permissions configured</span>` : nothing}
      </div>
      <sl-button size="small" variant="text" @click=${() => {
        permList.push('');
        rerender();
      }}>
        ${unsafeHTML(iconSvg(Plus, 14))}
        Add Permission
      </sl-button>

      <div class="settings-tab-actions">
        <sl-button variant="primary" size="small" @click=${() => {
          const governance = readGovernanceFromDom();
          const allow = readPermissionsFromDom();
          saveSettings({ worca: { ...settingsData.worca, governance }, permissions: { allow } }, rerender);
        }}>
          ${unsafeHTML(iconSvg(Save, 14))}
          Save Governance
        </sl-button>
      </div>
    </div>
  `;
}

function preferencesTab(preferences, worca, { onThemeToggle, rerender }) {
  const theme = preferences?.theme || 'light';
  const pricing = worca.pricing || DEFAULT_PRICING;
  const models = pricing.models || DEFAULT_PRICING.models;

  return html`
    <div class="settings-tab-content">
      <h3 class="settings-section-title">Appearance</h3>
      <div class="settings-switches">
        <div class="settings-switch-row">
          <sl-switch ?checked=${theme === 'dark'} size="small" @sl-change=${onThemeToggle}>Dark Mode</sl-switch>
          <span class="settings-switch-desc">Toggle between light and dark theme</span>
        </div>
      </div>

      <h3 class="settings-section-title">Pricing</h3>
      <div class="pricing-table-wrap">
        <table class="pricing-table">
          <thead>
            <tr>
              <th>Model</th>
              ${PRICING_FIELDS.map(f => html`<th>${f.label}</th>`)}
            </tr>
          </thead>
          <tbody>
            ${PRICING_MODELS.map(model => {
              const costs = models[model] || DEFAULT_PRICING.models[model];
              return html`
                <tr>
                  <td class="pricing-model-name">${model}</td>
                  ${PRICING_FIELDS.map(f => html`
                    <td>
                      <sl-input
                        id="pricing-${model}-${f.key}"
                        type="number"
                        step="0.01"
                        min="0"
                        value="${costs[f.key] ?? 0}"
                        size="small"
                      ></sl-input>
                    </td>
                  `)}
                </tr>
              `;
            })}
          </tbody>
        </table>
      </div>
      <div class="pricing-info">
        <span class="settings-muted">Currency: ${pricing.currency || 'USD'}</span>
        <span class="settings-muted">Last updated: ${pricing.last_updated || 'N/A'}</span>
      </div>

      <div class="settings-tab-actions">
        <sl-button variant="primary" size="small" @click=${() => {
          const pricingData = readPricingFromDom();
          saveSettings({ worca: { ...settingsData.worca, pricing: pricingData }, permissions: settingsData.permissions }, rerender);
        }}>
          ${unsafeHTML(iconSvg(Save, 14))}
          Save Pricing
        </sl-button>
      </div>
    </div>
  `;
}

const NOTIF_EVENT_LABELS = {
  run_completed: { label: 'Run Completed', desc: 'When a pipeline run finishes successfully' },
  run_failed: { label: 'Run Failed', desc: 'When a pipeline run fails at any stage' },
  approval_needed: { label: 'Approval Required', desc: 'When a stage is waiting for plan or PR approval' },
  test_failures: { label: 'Test Failures', desc: 'When a test iteration ends with failures' },
  loop_limit_warning: { label: 'Loop Limit Warning', desc: 'When a stage approaches its configured loop limit' },
};

function notificationsTab(preferences, { rerender, onSaveNotifications }) {
  const notifPrefs = preferences?.notifications || {};
  const enabled = notifPrefs.enabled ?? true;
  const sound = notifPrefs.sound ?? false;
  const events = notifPrefs.events || {};

  const permission = typeof Notification !== 'undefined' ? Notification.permission : 'unsupported';
  const permBadge = permission === 'granted'
    ? html`<sl-badge variant="success" pill>Granted</sl-badge>`
    : permission === 'denied'
      ? html`<sl-badge variant="danger" pill>Blocked</sl-badge>`
      : permission === 'default'
        ? html`<sl-badge variant="neutral" pill>Not Yet Asked</sl-badge>`
        : html`<sl-badge variant="neutral" pill>Not Supported</sl-badge>`;

  const notGranted = permission !== 'granted';

  return html`
    <div class="settings-tab-content">
      <h3 class="settings-section-title">Browser Notifications</h3>
      <div style="display: flex; align-items: center; gap: 12px; margin-bottom: 8px;">
        <span style="font-size: 13px; color: var(--muted);">Permission Status:</span>
        ${permBadge}
        ${permission === 'default' ? html`
          <sl-button size="small" variant="primary" @click=${async () => {
            if (typeof Notification !== 'undefined') {
              await Notification.requestPermission();
              rerender();
            }
          }}>Enable Notifications</sl-button>
        ` : ''}
      </div>

      ${notGranted ? html`
        <div style="font-size: 12px; color: var(--muted); margin-bottom: 8px;">
          ${permission === 'denied' ? 'Notifications are blocked. Enable in your browser settings to use these controls.' : 'Grant notification permission to use these controls.'}
        </div>
      ` : ''}

      <div class="settings-switches">
        <div class="settings-switch-row">
          <sl-switch id="notif-enabled" ?checked=${enabled} size="small" ?disabled=${notGranted}>Notifications Enabled</sl-switch>
          <span class="settings-switch-desc">Master toggle for all browser notifications</span>
        </div>
        <div class="settings-switch-row">
          <sl-switch id="notif-sound" ?checked=${sound} size="small" ?disabled=${notGranted}>Sound for Critical Events</sl-switch>
          <span class="settings-switch-desc">Play a short audio cue for failed runs and approval requests</span>
        </div>
      </div>

      <h3 class="settings-section-title">Notification Events</h3>
      <div class="settings-switches">
        ${Object.entries(NOTIF_EVENT_LABELS).map(([key, { label, desc }]) => html`
          <div class="settings-switch-row">
            <sl-switch id="notif-evt-${key}" ?checked=${events[key] ?? true} size="small" ?disabled=${notGranted}>${label}</sl-switch>
            <span class="settings-switch-desc">${desc}</span>
          </div>
        `)}
      </div>

      <div class="settings-tab-actions">
        <sl-button variant="primary" size="small" ?disabled=${notGranted} @click=${() => {
          const notifEnabled = document.getElementById('notif-enabled')?.checked ?? true;
          const notifSound = document.getElementById('notif-sound')?.checked ?? false;
          const eventPrefs = {};
          for (const key of Object.keys(NOTIF_EVENT_LABELS)) {
            eventPrefs[key] = document.getElementById(`notif-evt-${key}`)?.checked ?? true;
          }
          onSaveNotifications({
            enabled: notifEnabled,
            sound: notifSound,
            events: eventPrefs,
          });
        }}>
          ${unsafeHTML(iconSvg(Save, 14))}
          Save Notifications
        </sl-button>
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

export function settingsView(preferences, { rerender, onThemeToggle, onSaveNotifications }) {
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
        <sl-tab slot="nav" panel="notifications">
          ${unsafeHTML(iconSvg(Bell, 14))}
          Notifications
        </sl-tab>

        <sl-tab-panel name="agents">${agentsTab(worca, rerender)}</sl-tab-panel>
        <sl-tab-panel name="pipeline">${pipelineTab(worca, rerender)}</sl-tab-panel>
        <sl-tab-panel name="governance">${governanceTab(worca, permissions, rerender)}</sl-tab-panel>
        <sl-tab-panel name="preferences">${preferencesTab(preferences, worca, { onThemeToggle, rerender })}</sl-tab-panel>
        <sl-tab-panel name="notifications">${notificationsTab(preferences, { rerender, onSaveNotifications })}</sl-tab-panel>
      </sl-tab-group>
    </div>
  `;
}

// Test-only export
export { preferencesTab as _preferencesTab };
