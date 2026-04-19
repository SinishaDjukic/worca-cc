import { html, nothing } from 'lit-html';
import { unsafeHTML } from 'lit-html/directives/unsafe-html.js';
import { confirmDialogTemplate, showConfirm } from '../utils/confirm-dialog.js';
import {
  Bell,
  ClipboardCopy,
  Coins,
  FolderOpen,
  iconSvg,
  Plus,
  RefreshCw,
  RotateCcw,
  Save,
  Settings,
  Shield,
  Trash2,
  Users,
  Workflow,
  X,
  Zap,
} from '../utils/icons.js';
import { STAGE_ORDER } from '../utils/stage-order.js';
import { isVersionBehind } from '../utils/version-compare.js';
import {
  addTag,
  filterSuggestions,
  isCustomized,
  KNOWN_TYPES,
  removeTag,
  SUBAGENT_DENYLIST,
} from './dispatch-tag-state.js';
import { integrationsTab } from './integrations.js';

// Stage-to-agent mapping (from stages.py STAGE_AGENT_MAP)
export const STAGE_AGENT_MAP = {
  plan: 'planner',
  plan_review: 'plan_reviewer',
  coordinate: 'coordinator',
  implement: 'implementer',
  test: 'tester',
  review: 'reviewer',
  pr: 'guardian',
  learn: 'learner',
};

/** Stages configurable via the settings UI (excludes preflight which has no agent). */
export const CONFIGURABLE_STAGES = STAGE_ORDER.filter((s) => s !== 'preflight');
export const AGENT_NAMES = [
  'planner',
  'plan_reviewer',
  'coordinator',
  'implementer',
  'tester',
  'reviewer',
  'guardian',
  'learner',
];
const MODEL_OPTIONS = ['opus', 'sonnet', 'haiku'];

const DEFAULT_STAGES = {
  plan: { agent: 'planner', enabled: true },
  plan_review: { agent: 'plan_reviewer', enabled: false },
  coordinate: { agent: 'coordinator', enabled: true },
  implement: { agent: 'implementer', enabled: true },
  test: { agent: 'tester', enabled: true },
  review: { agent: 'reviewer', enabled: true },
  pr: { agent: 'guardian', enabled: true },
  learn: { agent: 'learner', enabled: false },
};

export const PRICING_MODELS = ['opus', 'sonnet', 'haiku'];
export const PRICING_FIELDS = [
  { key: 'input_per_mtok', label: 'Input/MTok ($)' },
  { key: 'output_per_mtok', label: 'Output/MTok ($)' },
  { key: 'cache_write_per_mtok', label: 'Cache Write 5m/MTok ($)' },
  { key: 'cache_write_1h_per_mtok', label: 'Cache Write 1h/MTok ($)' },
  { key: 'cache_read_per_mtok', label: 'Cache Read/MTok ($)' },
];
// Zero-value fallback used only when server hasn't loaded yet.
// Real defaults live in src/worca/settings.json (single source of truth).
const EMPTY_MODEL = Object.fromEntries(PRICING_FIELDS.map((f) => [f.key, 0]));

const GUARD_RULES = [
  {
    key: 'block_rm_rf',
    label: 'Block rm -rf',
    description: 'Prevent recursive force-delete commands',
  },
  {
    key: 'block_env_write',
    label: 'Block .env writes',
    description: 'Prevent writing to .env files',
  },
  {
    key: 'block_force_push',
    label: 'Block force push',
    description: 'Prevent git push --force',
  },
  {
    key: 'restrict_git_commit',
    label: 'Restrict git commit',
    description: 'Only guardian agent may commit',
  },
];

const DEFAULT_GOVERNANCE = {
  guards: {
    block_rm_rf: true,
    block_env_write: true,
    block_force_push: true,
    restrict_git_commit: true,
  },
  test_gate_strikes: 2,
  subagent_dispatch: {
    planner: ['Explore'],
    coordinator: [],
    implementer: ['Explore'],
    tester: ['Explore'],
    reviewer: ['Explore'],
    guardian: ['Explore'],
    plan_reviewer: ['Explore'],
    learner: ['Explore'],
  },
};

// --- Module state ---
let settingsData = null;
let saveStatus = null; // null | 'saving' | 'success' | 'error'
let saveMessage = '';
let _settingsProjectId = null; // track which project settings are loaded for

// --- Dispatch tag state ---
let _dispatchTagState = {}; // agent -> { tags, input, showSuggestions, activeIndex }

// Discovered subagent types from GET /api/subagents. Falls back to KNOWN_TYPES
// (imported from dispatch-tag-state.js) when the fetch hasn't returned or fails.
let _discoveredKnownTypes = null;

function _getDispatchState(agent, initialTags) {
  if (!_dispatchTagState[agent]) {
    _dispatchTagState[agent] = {
      tags: [...(initialTags || [])],
      input: '',
      showSuggestions: false,
      activeIndex: -1,
    };
  }
  return _dispatchTagState[agent];
}

function _resetDispatchTagState() {
  _dispatchTagState = {};
}

function settingsUrl(projectId, suffix = '') {
  if (projectId) return `/api/projects/${projectId}/settings${suffix}`;
  return `/api/settings${suffix}`;
}

export async function loadSettings(projectId) {
  _settingsProjectId = projectId || null;
  try {
    const res = await fetch(settingsUrl(projectId));
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    settingsData = await res.json();
    // Ensure worca and governance defaults exist
    if (!settingsData.worca) settingsData.worca = {};
    // Ensure stages defaults exist
    if (!settingsData.worca.stages) {
      settingsData.worca.stages = { ...DEFAULT_STAGES };
    } else {
      for (const stage of CONFIGURABLE_STAGES) {
        if (!settingsData.worca.stages[stage]) {
          settingsData.worca.stages[stage] = { ...DEFAULT_STAGES[stage] };
        }
      }
    }
    // Ensure preflight defaults exist (script-based stage, not in CONFIGURABLE_STAGES)
    if (!settingsData.worca.stages.preflight) {
      settingsData.worca.stages.preflight = {
        enabled: true,
        script: '.claude/worca/scripts/preflight_checks.py',
        require: [],
      };
    } else {
      const pf = settingsData.worca.stages.preflight;
      if (pf.enabled === undefined) pf.enabled = true;
      if (!pf.script) pf.script = '.claude/worca/scripts/preflight_checks.py';
      if (!pf.require) pf.require = [];
    }
    if (!settingsData.worca.plan_path_template) {
      settingsData.worca.plan_path_template =
        'docs/plans/{timestamp}-{title_slug}.md';
    }
    if (!settingsData.worca.defaults) {
      settingsData.worca.defaults = { msize: 1, mloops: 1 };
    }
    if (!settingsData.worca.pricing) {
      settingsData.worca.pricing = {
        models: {},
        server_tools: {},
        currency: 'USD',
      };
    }
    if (!settingsData.worca.pricing.models)
      settingsData.worca.pricing.models = {};
    for (const model of PRICING_MODELS) {
      settingsData.worca.pricing.models[model] = {
        ...EMPTY_MODEL,
        ...(settingsData.worca.pricing.models[model] || {}),
      };
    }
    if (!settingsData.worca.pricing.server_tools)
      settingsData.worca.pricing.server_tools = {};
    if (!settingsData.worca.governance) {
      settingsData.worca.governance = { ...DEFAULT_GOVERNANCE };
    } else {
      const gov = settingsData.worca.governance;
      // Legacy fallback: if only old dispatch key present, use it under new name
      const hasNew = gov.subagent_dispatch !== undefined;
      const hasLegacy = gov.dispatch !== undefined && !hasNew;
      settingsData.worca.governance = {
        ...DEFAULT_GOVERNANCE,
        ...gov,
        guards: {
          ...DEFAULT_GOVERNANCE.guards,
          ...(gov.guards || {}),
        },
        subagent_dispatch: {
          ...DEFAULT_GOVERNANCE.subagent_dispatch,
          ...(hasNew ? gov.subagent_dispatch : hasLegacy ? gov.dispatch : {}),
        },
        _legacy_dispatch: hasLegacy,
      };
    }
    if (!settingsData.worca.events) {
      settingsData.worca.events = {
        enabled: true,
        agent_telemetry: false,
        hook_events: true,
        rate_limit_ms: 1000,
      };
    }
    if (!settingsData.worca.budget) {
      settingsData.worca.budget = {};
    }
    if (!settingsData.worca.webhooks) {
      settingsData.worca.webhooks = [];
    }
    _resetDispatchTagState();
    // Fetch the discovered subagents list for the dispatch editor. Best-effort:
    // on failure we keep _discoveredKnownTypes = null and the editor uses the
    // hardcoded KNOWN_TYPES fallback from dispatch-tag-state.js.
    try {
      const subRes = await fetch('/api/subagents');
      if (subRes.ok) {
        const body = await subRes.json();
        if (body?.ok && Array.isArray(body.subagents)) {
          _discoveredKnownTypes = body.subagents;
        }
      }
    } catch {
      // keep the fallback
    }
  } catch (err) {
    settingsData = null;
    saveStatus = 'error';
    saveMessage = `Failed to load settings: ${err.message}`;
  }
}

async function saveSettings(data, rerender, projectId) {
  saveStatus = 'saving';
  saveMessage = '';
  rerender();
  try {
    const res = await fetch(settingsUrl(projectId || _settingsProjectId), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const result = await res.json();
    settingsData = { worca: result.worca, permissions: result.permissions };
    saveStatus = 'success';
    saveMessage = 'Settings saved successfully';
  } catch (err) {
    saveStatus = 'error';
    saveMessage = `Failed to save: ${err.message}`;
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

async function resetSection(section, rerender, projectId) {
  saveStatus = 'saving';
  saveMessage = '';
  rerender();
  try {
    const res = await fetch(
      settingsUrl(projectId || _settingsProjectId, `/${section}`),
      { method: 'DELETE' },
    );
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const result = await res.json();
    settingsData = { worca: result.worca, permissions: result.permissions };
    // Re-apply defaults after reset
    await loadSettings(projectId || _settingsProjectId);
    saveStatus = 'success';
    saveMessage = `${section.charAt(0).toUpperCase() + section.slice(1)} reset to defaults`;
  } catch (err) {
    saveStatus = 'error';
    saveMessage = `Failed to reset: ${err.message}`;
  }
  rerender();
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

function confirmReset(section, rerender) {
  const label = section.charAt(0).toUpperCase() + section.slice(1);
  showConfirm(
    {
      label: `Reset ${label}`,
      message: html`Are you sure you want to reset <strong>${label}</strong> settings to their defaults?`,
      confirmLabel: 'Reset',
      confirmVariant: 'danger',
      onConfirm: () => resetSection(section, rerender),
    },
    rerender,
  );
}

// --- Read form values from DOM ---

function readAgentsFromDom() {
  const agents = {};
  for (const name of AGENT_NAMES) {
    const modelEl = document.getElementById(`agent-${name}-model`);
    const turnsEl = document.getElementById(`agent-${name}-turns`);
    agents[name] = {
      model: modelEl?.value || 'sonnet',
      max_turns: parseInt(turnsEl?.value, 10) || 30,
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
  for (const stage of CONFIGURABLE_STAGES) {
    const enabledEl = document.getElementById(`stage-${stage}-enabled`);
    const agentEl = document.getElementById(`stage-${stage}-agent`);
    stages[stage] = {
      agent: agentEl?.value || DEFAULT_STAGES[stage].agent,
      enabled: enabledEl?.checked ?? true,
    };
  }
  return stages;
}

function readPreflightFromDom() {
  const enabledEl = document.getElementById('preflight-enabled');
  const scriptEl = document.getElementById('preflight-script');
  const requireEl = document.getElementById('preflight-require');
  const requireVal = (requireEl?.value || '').trim();
  return {
    enabled: enabledEl?.checked ?? true,
    script:
      scriptEl?.value?.trim() || '.claude/worca/scripts/preflight_checks.py',
    require: requireVal
      ? requireVal
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean)
      : [],
  };
}

function readGovernanceFromDom() {
  const guards = {};
  for (const rule of GUARD_RULES) {
    const el = document.getElementById(`guard-${rule.key}`);
    guards[rule.key] = el?.checked ?? true;
  }
  const strikeEl = document.getElementById('test-gate-strikes');
  const test_gate_strikes = parseInt(strikeEl?.value, 10) || 2;

  const subagent_dispatch = {};
  for (const agent of AGENT_NAMES) {
    subagent_dispatch[agent] = [...(_dispatchTagState[agent]?.tags || [])];
  }

  return { guards, test_gate_strikes, subagent_dispatch };
}

export function readPermissionsFromDom() {
  const inputs = document.querySelectorAll('.perm-input');
  return Array.from(inputs)
    .map((el) => el.value.trim())
    .filter((v) => v.length > 0);
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
  const searchEl = document.getElementById(
    'pricing-server_tools-web_search_per_request',
  );
  const fetchEl = document.getElementById(
    'pricing-server_tools-web_fetch_per_request',
  );
  return {
    models,
    server_tools: {
      web_search_per_request: parseFloat(searchEl?.value) || 0,
      web_fetch_per_request: parseFloat(fetchEl?.value) || 0,
    },
    currency: settingsData?.worca?.pricing?.currency || 'USD',
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
        ${AGENT_NAMES.map((name) => {
          const agent = agents[name] || {};
          return html`
            <div class="settings-card">
              <div class="settings-card-header">
                <span class="settings-card-title">${name}</span>
              </div>
              <div class="settings-card-body">
                <div class="settings-field">
                  <label class="settings-label">Model</label>
                  <sl-select id="agent-${name}-model" .value="${agent.model || 'sonnet'}" size="small">
                    ${MODEL_OPTIONS.map((m) => html`<sl-option value="${m}">${m}</sl-option>`)}
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
          saveSettings({ worca: { agents } }, rerender);
        }}>
          ${unsafeHTML(iconSvg(Save, 14))}
          Save
        </sl-button>
        <sl-button variant="default" size="small" outline @click=${() => confirmReset('agents', rerender)}>
          ${unsafeHTML(iconSvg(RefreshCw, 14))}
          Reset
        </sl-button>
      </div>
    </div>
  `;
}

function pipelineTab(worca, rerender) {
  const loops = worca.loops || {};
  const stages = worca.stages || DEFAULT_STAGES;

  const preflight = stages.preflight || {
    enabled: true,
    script: '.claude/worca/scripts/preflight_checks.py',
    require: [],
  };

  return html`
    <div class="settings-tab-content">
      <h3 class="settings-section-title">Preflight</h3>
      <div class="settings-grid">
        <div class="settings-field">
          <div class="settings-switch-row">
            <sl-switch id="preflight-enabled" ?checked=${preflight.enabled !== false} size="small">Enable Preflight Checks</sl-switch>
            <span class="settings-switch-desc">Run pre-flight validation before the pipeline starts</span>
          </div>
        </div>
        <div class="settings-field">
          <label class="settings-label">Script Path</label>
          <sl-input id="preflight-script" value="${preflight.script || '.claude/worca/scripts/preflight_checks.py'}" size="small" placeholder=".claude/worca/scripts/preflight_checks.py"></sl-input>
        </div>
        <div class="settings-field">
          <label class="settings-label">Required Checks</label>
          <sl-input id="preflight-require" value="${(preflight.require || []).join(', ')}" size="small" placeholder="e.g. git_clean, branch_exists"></sl-input>
          <span class="settings-field-hint">Comma-separated list of checks that must pass</span>
        </div>
      </div>

      <h3 class="settings-section-title">Stage Configuration</h3>
      <div class="settings-cards">
        ${CONFIGURABLE_STAGES.map((stage) => {
          const stageConfig = stages[stage] || DEFAULT_STAGES[stage];
          const enabled = stageConfig.enabled !== false;
          return html`
            <div class="settings-card pipeline-stage-node ${enabled ? 'pipeline-stage-node--enabled' : 'pipeline-stage-node--disabled'}">
              <div class="settings-card-header">
                <span class="settings-card-title ${enabled ? '' : 'pipeline-stage-name--disabled'}">${stage}</span>
                <sl-switch id="stage-${stage}-enabled" ?checked=${enabled} size="small"
                  @sl-change=${(e) => {
                    const node = e.target.closest('.pipeline-stage-node');
                    if (e.target.checked) {
                      node.classList.remove('pipeline-stage-node--disabled');
                      node.classList.add('pipeline-stage-node--enabled');
                      node
                        .querySelector('.settings-card-title')
                        .classList.remove('pipeline-stage-name--disabled');
                    } else {
                      node.classList.remove('pipeline-stage-node--enabled');
                      node.classList.add('pipeline-stage-node--disabled');
                      node
                        .querySelector('.settings-card-title')
                        .classList.add('pipeline-stage-name--disabled');
                    }
                  }}></sl-switch>
              </div>
              <div class="settings-card-body">
                <div class="settings-field">
                  <label class="settings-label">Agent</label>
                  <sl-select id="stage-${stage}-agent" .value="${stageConfig.agent || STAGE_AGENT_MAP[stage]}" size="small" hoist>
                    ${AGENT_NAMES.map((a) => html`<sl-option value="${a}">${a}</sl-option>`)}
                  </sl-select>
                </div>
              </div>
            </div>
          `;
        })}
      </div>

      <h3 class="settings-section-title">Loop Limits</h3>
      <div class="settings-grid">
        ${[
          { key: 'implement_test', label: 'Implement \u2194 Test' },
          { key: 'pr_changes', label: 'PR Changes' },
          { key: 'restart_planning', label: 'Restart Planning' },
        ].map(
          (item) => html`
          <div class="settings-field">
            <label class="settings-label">${item.label}</label>
            <sl-input id="loop-${item.key}" type="number" value="${loops[item.key] || 0}" size="small" min="0" max="50"></sl-input>
          </div>
        `,
        )}
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
          <sl-input id="defaults-msize" type="number" value="${worca.defaults?.msize || 1}" size="small" min="1" max="10"></sl-input>
          <span class="settings-field-hint">Scales max_turns per stage</span>
        </div>
        <div class="settings-field">
          <label class="settings-label">Loop Multiplier (mloops)</label>
          <sl-input id="defaults-mloops" type="number" value="${worca.defaults?.mloops || 1}" size="small" min="1" max="10"></sl-input>
          <span class="settings-field-hint">Scales max loop iterations</span>
        </div>
      </div>

      <div class="settings-tab-actions">
        <sl-button variant="primary" size="small" @click=${() => {
          const { loops, plan_path_template, defaults } = readPipelineFromDom();
          const stages = readStagesFromDom();
          stages.preflight = readPreflightFromDom();
          const payload = {
            worca: { loops, stages, plan_path_template, defaults },
          };
          saveSettings(payload, rerender);
        }}>
          ${unsafeHTML(iconSvg(Save, 14))}
          Save
        </sl-button>
        <sl-button variant="default" size="small" outline @click=${() => confirmReset('pipeline', rerender)}>
          ${unsafeHTML(iconSvg(RefreshCw, 14))}
          Reset
        </sl-button>
      </div>
    </div>
  `;
}

function dispatchTagRowView(agent, initialTags, defaultTags, rerender) {
  const state = _getDispatchState(agent, initialTags);
  const knownTypes = _discoveredKnownTypes || KNOWN_TYPES;
  const suggestions = filterSuggestions(
    state.input,
    knownTypes,
    state.tags,
    SUBAGENT_DENYLIST,
  );
  const customized = isCustomized(state.tags, defaultTags);

  function handleInput(e) {
    state.input = e.target.value;
    state.showSuggestions = true;
    state.activeIndex = -1;
    rerender();
  }

  function handleFocus() {
    state.showSuggestions = true;
    rerender();
  }

  function handleBlur() {
    // Delay to allow click on suggestion to fire first
    setTimeout(() => {
      state.showSuggestions = false;
      rerender();
    }, 150);
  }

  function handleKeydown(e) {
    if (e.key === 'Enter') {
      e.preventDefault();
      if (state.activeIndex >= 0 && suggestions[state.activeIndex]) {
        const item = suggestions[state.activeIndex];
        if (!item.denied) {
          const result = addTag(state.tags, item.name, SUBAGENT_DENYLIST);
          state.tags = result.tags;
          state.input = '';
          state.showSuggestions = false;
          state.activeIndex = -1;
          rerender();
        }
      } else if (state.input.trim()) {
        const result = addTag(state.tags, state.input, SUBAGENT_DENYLIST);
        state.tags = result.tags;
        state.input = '';
        state.showSuggestions = false;
        state.activeIndex = -1;
        rerender();
      }
    } else if (e.key === 'Backspace' && !state.input && state.tags.length > 0) {
      state.tags = removeTag(state.tags, state.tags[state.tags.length - 1]);
      rerender();
    } else if (e.key === 'Escape') {
      state.showSuggestions = false;
      state.activeIndex = -1;
      rerender();
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      state.activeIndex = Math.min(
        state.activeIndex + 1,
        suggestions.length - 1,
      );
      rerender();
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      state.activeIndex = Math.max(state.activeIndex - 1, -1);
      rerender();
    }
  }

  function pickSuggestion(item) {
    if (item.denied) return;
    const result = addTag(state.tags, item.name, SUBAGENT_DENYLIST);
    state.tags = result.tags;
    state.input = '';
    state.showSuggestions = false;
    state.activeIndex = -1;
    rerender();
  }

  function resetToDefault() {
    state.tags = [...defaultTags];
    state.input = '';
    state.showSuggestions = false;
    state.activeIndex = -1;
    rerender();
  }

  return html`
    <div class="settings-dispatch-row">
      <span class="settings-dispatch-agent">${agent}</span>
      <div class="dispatch-tag-input-wrapper">
        <div class="dispatch-tag-input" id="dispatch-${agent}">
          ${state.tags.map(
            (tag) => html`<sl-tag
              size="small"
              removable
              data-value="${tag}"
              @sl-remove=${() => {
                state.tags = removeTag(state.tags, tag);
                rerender();
              }}
            >${tag}</sl-tag>`,
          )}
          <input
            type="text"
            class="dispatch-tag-input-field"
            placeholder="${state.tags.length === 0 ? 'none' : ''}"
            .value=${state.input}
            @input=${handleInput}
            @focus=${handleFocus}
            @blur=${handleBlur}
            @keydown=${handleKeydown}
          />
        </div>
        ${
          state.showSuggestions && suggestions.length > 0
            ? html`<div class="dispatch-suggestions">
              ${(() => {
                let lastGroup = null;
                return suggestions.map((item, i) => {
                  const groupHeader =
                    item.group !== lastGroup
                      ? html`<div class="group-label">${item.group}</div>`
                      : nothing;
                  lastGroup = item.group;
                  return html`${groupHeader}<div
                    class="item ${item.denied ? 'denied' : ''} ${i === state.activeIndex ? 'active' : ''}"
                    title=${
                      item.denied
                        ? 'Blocked by denylist — cannot be used in pipeline mode'
                        : ''
                    }
                    @mousedown=${() => pickSuggestion(item)}
                  >${item.name} <span class="item-label">${item.label}</span></div>`;
                });
              })()}
            </div>`
            : nothing
        }
      </div>
      ${
        customized
          ? html`<sl-icon-button
            title="Reset to default"
            label="Reset to default"
            class="dispatch-reset-btn"
            @click=${resetToDefault}
          >${unsafeHTML(iconSvg(RotateCcw, 14))}</sl-icon-button>`
          : html`<span class="dispatch-reset-placeholder"></span>`
      }
    </div>
  `;
}

function governanceTab(worca, permissions, rerender) {
  const governance = worca.governance || DEFAULT_GOVERNANCE;
  const guards = governance.guards || DEFAULT_GOVERNANCE.guards;
  const subagent_dispatch =
    governance.subagent_dispatch || DEFAULT_GOVERNANCE.subagent_dispatch;
  const isLegacy = governance._legacy_dispatch === true;
  if (!permissions.allow) permissions.allow = [];
  const permList = permissions.allow;

  return html`
    <div class="settings-tab-content">
      <h3 class="settings-section-title">Guard Rules</h3>
      <div class="settings-switches">
        ${GUARD_RULES.map(
          (rule) => html`
          <div class="settings-switch-row">
            <sl-switch id="guard-${rule.key}" ?checked=${guards[rule.key] !== false} size="small">
              ${rule.label}
            </sl-switch>
            <span class="settings-switch-desc">${rule.description}</span>
          </div>
        `,
        )}
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
      ${
        isLegacy
          ? html`
        <sl-alert variant="warning" open>
          <strong>Legacy configuration detected.</strong>
          Your settings use the old <code>governance.dispatch</code> key.
          Saving will migrate to <code>governance.subagent_dispatch</code>.
        </sl-alert>
      `
          : nothing
      }
      <sl-alert variant="neutral" open>
        <strong>Denylist:</strong> <code>general-purpose</code> is always blocked and cannot be added to dispatch rules.
      </sl-alert>
      <div class="settings-dispatch-table">
        ${AGENT_NAMES.map((agent) =>
          dispatchTagRowView(
            agent,
            subagent_dispatch[agent] || [],
            DEFAULT_GOVERNANCE.subagent_dispatch[agent] || [],
            rerender,
          ),
        )}
      </div>

      <h3 class="settings-section-title">Permissions</h3>
      <div class="settings-permissions" id="permissions-list">
        ${permList.map(
          (p, i) => html`
          <div class="settings-perm-item settings-perm-item--editable">
            <sl-input class="perm-input" value="${p}" size="small" placeholder="e.g. Bash(pytest *)"></sl-input>
            <sl-icon-button name="x" label="Remove" class="perm-remove-btn" @click=${() => {
              permList.splice(i, 1);
              rerender();
            }}>${unsafeHTML(iconSvg(X, 14))}</sl-icon-button>
          </div>
        `,
        )}
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
          saveSettings(
            { worca: { governance }, permissions: { allow } },
            rerender,
          );
        }}>
          ${unsafeHTML(iconSvg(Save, 14))}
          Save
        </sl-button>
        <sl-button variant="default" size="small" outline @click=${() => confirmReset('governance', rerender)}>
          ${unsafeHTML(iconSvg(RefreshCw, 14))}
          Reset
        </sl-button>
      </div>
    </div>
  `;
}

// --- Versions state ---
let versionsData = null;
let versionsLoading = false;
let versionsError = null;

async function loadVersions(rerender, force = false) {
  versionsLoading = true;
  versionsError = null;
  rerender();
  try {
    const url = force ? '/api/versions?force=1' : '/api/versions';
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    versionsData = await res.json();
  } catch (err) {
    versionsError = err.message;
  } finally {
    versionsLoading = false;
    rerender();
  }
}

function relativeTime(isoStr) {
  if (!isoStr) return '';
  const diffMs = Date.now() - new Date(isoStr).getTime();
  const secs = Math.floor(diffMs / 1000);
  if (secs < 60) return 'just now';
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  return `${hrs}h ago`;
}

function copyInstallCmd(cmd, btn) {
  navigator.clipboard.writeText(cmd).then(() => {
    const icon = btn.querySelector('.version-copy-icon');
    if (icon) {
      icon.textContent = '✓';
      setTimeout(() => {
        icon.textContent = '';
      }, 1500);
    }
  });
}

function versionRow(label, value, installCmd, tooltip) {
  if (value === undefined) return nothing;
  const valueContent = html`${value || '—'}`;
  return html`
    <div class="version-row">
      <span class="version-row-label">${label}</span>
      <span class="version-row-value">${
        value && installCmd
          ? html`
        <sl-tooltip content="Copy: ${installCmd}">
          <button class="version-copy-btn" @click=${(e) => copyInstallCmd(installCmd, e.currentTarget)}>
            <span class="version-copy-icon">${unsafeHTML(iconSvg(ClipboardCopy, 12))}</span>
          </button>
        </sl-tooltip>
      `
          : nothing
      }${tooltip ? html`<sl-tooltip content="${tooltip}">${valueContent}</sl-tooltip>` : valueContent}</span>
    </div>
  `;
}

function versionsSection(rerender) {
  // Auto-load on first render
  if (!versionsData && !versionsLoading && !versionsError) {
    loadVersions(rerender);
  }

  if (versionsLoading && !versionsData) {
    return html`
      <h3 class="settings-section-title">Worca Versions</h3>
      <div class="settings-card">
        <div class="settings-muted">Loading version info…</div>
      </div>
    `;
  }

  if (versionsError && !versionsData) {
    return html`
      <h3 class="settings-section-title">Worca Versions</h3>
      <div class="settings-card">
        <div class="settings-muted">Failed to load versions: ${versionsError}</div>
        <div class="version-refresh">
          <sl-button size="small" @click=${() => loadVersions(rerender, true)}>
            ${unsafeHTML(iconSvg(RefreshCw, 14))}
            Retry
          </sl-button>
        </div>
      </div>
    `;
  }

  if (!versionsData) return nothing;

  const { worcaCc, worcaUi, devPath, installDir, cachedAt } = versionsData;

  function devVersionLabel(version, devStatus) {
    if (!version) return null;
    if (!devStatus || (devStatus.ahead === 0 && !devStatus.dirty))
      return version;
    const parts = [version];
    if (devStatus.ahead > 0) parts.push(`+ ${devStatus.ahead}`);
    if (devStatus.dirty) parts.push('(dirty)');
    return parts.join(' ');
  }

  function devTooltip(devStatus) {
    if (!devStatus || (devStatus.ahead === 0 && !devStatus.dirty)) return null;
    const parts = [];
    if (devStatus.ahead > 0)
      parts.push(
        `${devStatus.ahead} commit${devStatus.ahead === 1 ? '' : 's'} ahead of the last version tag`,
      );
    if (devStatus.dirty) parts.push('Working tree has uncommitted changes');
    return parts.join('. ');
  }

  return html`
    <h3 class="settings-section-title">Worca Versions</h3>
    <div class="settings-grid settings-grid--versions">
      <div class="settings-card">
        <div class="settings-card-header">
          <span class="settings-card-title version-title-exact">worca-cc</span>
          <sl-badge variant="neutral" pill>pypi</sl-badge>
        </div>
        <div class="settings-card-body">
          ${versionRow('Installed', worcaCc?.installed)}
          ${versionRow('Latest', worcaCc?.latest, worcaCc?.latest ? `pip install --upgrade worca-cc==${worcaCc.latest}` : null)}
          ${versionRow('Latest RC', worcaCc?.latestRc, worcaCc?.latestRc ? `pip install --upgrade worca-cc==${worcaCc.latestRc}` : null)}
          ${versionRow('Local repo', devVersionLabel(devPath?.worcaCc, devPath?.worcaCcDev), null, devTooltip(devPath?.worcaCcDev))}
        </div>
      </div>
      <div class="settings-card">
        <div class="settings-card-header">
          <span class="settings-card-title version-title-exact">@worca/ui</span>
          <sl-badge variant="neutral" pill>npm</sl-badge>
        </div>
        <div class="settings-card-body">
          ${versionRow('Installed', worcaUi?.installed)}
          ${versionRow('Latest', worcaUi?.latest, worcaUi?.latest ? `npm install -g @worca/ui@${worcaUi.latest}` : null)}
          ${versionRow('Latest RC', worcaUi?.latestRc, worcaUi?.latestRc ? `npm install -g @worca/ui@${worcaUi.latestRc}` : null)}
          ${versionRow('Local repo', devVersionLabel(devPath?.worcaUi, devPath?.worcaUiDev), null, devTooltip(devPath?.worcaUiDev))}
        </div>
      </div>
    </div>
    ${
      installDir
        ? html`
      <div class="install-path-row">
        <span class="install-path-label">Current worca-ui instance</span>
        <code class="install-path-value">${installDir}</code>
      </div>
    `
        : nothing
    }
    <div class="version-refresh">
      <sl-button size="small" @click=${() => loadVersions(rerender, true)} ?loading=${versionsLoading}>
        ${unsafeHTML(iconSvg(RefreshCw, 14))}
        Refresh
      </sl-button>
      <span class="version-refresh-hint">Updated ${relativeTime(cachedAt)}</span>
    </div>
  `;
}

function preferencesTab(
  preferences,
  { onThemeToggle, onSaveSourceRepo, rerender },
) {
  const theme = preferences?.theme || 'light';
  const sourceRepo = preferences?.source_repo || '';

  return html`
    <div class="settings-tab-content">
      <h3 class="settings-section-title">Appearance</h3>
      <div class="settings-switches">
        <div class="settings-switch-row">
          <sl-switch ?checked=${theme === 'dark'} size="small" @sl-change=${onThemeToggle}>Dark Mode</sl-switch>
          <span class="settings-switch-desc">Toggle between light and dark theme</span>
        </div>
      </div>

      <h3 class="settings-section-title">Development</h3>
      <div class="settings-grid">
        <div class="settings-field" style="grid-column: span 2;">
          <label class="settings-label">Worca Local Repo</label>
          <sl-input id="pref-source-repo" value="${sourceRepo}" size="small" placeholder="~/dev/worca-cc"></sl-input>
          <span class="settings-field-hint">Local worca-cc repo path for development. Used by <code>worca init --upgrade</code> instead of the installed package.</span>
        </div>
      </div>
      <div class="settings-tab-actions">
        <sl-button variant="primary" size="small" @click=${() => {
          const el = document.getElementById('pref-source-repo');
          const val = el?.value?.trim() || '';
          onSaveSourceRepo(val);
        }}>
          ${unsafeHTML(iconSvg(Save, 14))}
          Save
        </sl-button>
      </div>

      ${rerender ? versionsSection(rerender) : nothing}
    </div>
  `;
}

function pricingTab(worca, rerender) {
  const pricing = worca.pricing || {};
  const models = pricing.models || {};
  const serverTools = pricing.server_tools || {};

  return html`
    <div class="settings-tab-content">
      <h3 class="settings-section-title">Pricing</h3>
      <div class="pricing-table-wrap">
        <table class="pricing-table">
          <thead>
            <tr>
              <th>Model</th>
              ${PRICING_FIELDS.map((f) => html`<th>${f.label}</th>`)}
            </tr>
          </thead>
          <tbody>
            ${PRICING_MODELS.map((model) => {
              const costs = models[model] || EMPTY_MODEL;
              return html`
                <tr>
                  <td class="pricing-model-name">${model}</td>
                  ${PRICING_FIELDS.map(
                    (f) => html`
                    <td>
                      <sl-input
                        class="pricing-input"
                        id="pricing-${model}-${f.key}"
                        type="number"
                        step="0.01"
                        min="0"
                        value="${costs[f.key] ?? 0}"
                        size="small"
                      ></sl-input>
                    </td>
                  `,
                  )}
                </tr>
              `;
            })}
          </tbody>
        </table>
      </div>

      <div class="pricing-table-wrap">
        <table class="pricing-table pricing-table--auto">
          <thead>
            <tr>
              <th>Server Tools</th>
              <th>Request ($)</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td class="pricing-model-name">Web Search</td>
              <td>
                <sl-input
                  class="pricing-input"
                  id="pricing-server_tools-web_search_per_request"
                  type="number"
                  step="0.001"
                  min="0"
                  value="${serverTools.web_search_per_request ?? 0.01}"
                  size="small"
                ></sl-input>
              </td>
            </tr>
            <tr>
              <td class="pricing-model-name">Web Fetch</td>
              <td>
                <sl-input
                  class="pricing-input"
                  id="pricing-server_tools-web_fetch_per_request"
                  type="number"
                  step="0.001"
                  min="0"
                  value="${serverTools.web_fetch_per_request ?? 0.01}"
                  size="small"
                ></sl-input>
              </td>
            </tr>
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
          saveSettings({ worca: { pricing: pricingData } }, rerender);
        }}>
          ${unsafeHTML(iconSvg(Save, 14))}
          Save
        </sl-button>
        <sl-button variant="default" size="small" outline @click=${() => confirmReset('pricing', rerender)}>
          ${unsafeHTML(iconSvg(RefreshCw, 14))}
          Reset
        </sl-button>
      </div>
    </div>
  `;
}

const NOTIF_EVENT_LABELS = {
  run_completed: {
    label: 'Run Completed',
    desc: 'When a pipeline run finishes successfully',
  },
  run_failed: {
    label: 'Run Failed',
    desc: 'When a pipeline run fails at any stage',
  },
  approval_needed: {
    label: 'Approval Required',
    desc: 'When a stage is waiting for plan or PR approval',
  },
  test_failures: {
    label: 'Test Failures',
    desc: 'When a test iteration ends with failures',
  },
  loop_limit_warning: {
    label: 'Loop Limit Warning',
    desc: 'When a stage approaches its configured loop limit',
  },
};

function notificationsTab(
  preferences,
  { rerender, onSaveNotifications, onRequestPermission },
) {
  const notifPrefs = preferences?.notifications || {};
  const permission =
    typeof Notification !== 'undefined'
      ? Notification.permission
      : 'unsupported';
  const enabled = permission === 'granted' && (notifPrefs.enabled ?? true);
  const sound = notifPrefs.sound ?? false;
  const events = notifPrefs.events || {};
  const permBadge =
    permission === 'granted'
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
        ${
          permission === 'default'
            ? html`
          <sl-button size="small" variant="primary" @click=${async () => {
            if (onRequestPermission) {
              await onRequestPermission();
            } else if (typeof Notification !== 'undefined') {
              await Notification.requestPermission();
            }
            rerender();
          }}>Enable Notifications</sl-button>
        `
            : ''
        }
      </div>

      ${
        notGranted
          ? html`
        <div style="font-size: 12px; color: var(--muted); margin-bottom: 8px;">
          ${permission === 'denied' ? 'Notifications are blocked. Enable in your browser settings to use these controls.' : 'Grant notification permission to use these controls.'}
        </div>
      `
          : ''
      }

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
        ${Object.entries(NOTIF_EVENT_LABELS).map(
          ([key, { label, desc }]) => html`
          <div class="settings-switch-row">
            <sl-switch id="notif-evt-${key}" ?checked=${events[key] ?? true} size="small" ?disabled=${notGranted}>${label}</sl-switch>
            <span class="settings-switch-desc">${desc}</span>
          </div>
        `,
        )}
      </div>

      <div class="settings-tab-actions">
        <sl-button variant="primary" size="small" ?disabled=${notGranted} @click=${() => {
          const notifEnabled =
            document.getElementById('notif-enabled')?.checked ?? true;
          const notifSound =
            document.getElementById('notif-sound')?.checked ?? false;
          const eventPrefs = {};
          for (const key of Object.keys(NOTIF_EVENT_LABELS)) {
            eventPrefs[key] =
              document.getElementById(`notif-evt-${key}`)?.checked ?? true;
          }
          onSaveNotifications({
            enabled: notifEnabled,
            sound: notifSound,
            events: eventPrefs,
          });
        }}>
          ${unsafeHTML(iconSvg(Save, 14))}
          Save
        </sl-button>
      </div>
    </div>
  `;
}

// --- Webhook tab state ---
const webhookTestResults = {};

function readEventsFromDom() {
  return {
    enabled: document.getElementById('events-enabled')?.checked ?? true,
    agent_telemetry:
      document.getElementById('events-agent-telemetry')?.checked ?? false,
    hook_events: document.getElementById('events-hook-events')?.checked ?? true,
    rate_limit_ms:
      parseInt(document.getElementById('events-rate-limit-ms')?.value, 10) ||
      1000,
  };
}

function readBudgetFromDom() {
  const budget = {};
  const maxCostVal = parseFloat(
    document.getElementById('budget-max-cost')?.value,
  );
  if (!Number.isNaN(maxCostVal) && maxCostVal > 0)
    budget.max_cost_usd = maxCostVal;
  const warningPctVal = parseInt(
    document.getElementById('budget-warning-pct')?.value,
    10,
  );
  if (!Number.isNaN(warningPctVal)) budget.warning_pct = warningPctVal;
  return budget;
}

function readWebhooksFromDom() {
  const webhooks = settingsData?.worca?.webhooks || [];
  return webhooks.map((_, i) => {
    const eventsVal = (
      document.getElementById(`webhook-${i}-events`)?.value || ''
    ).trim();
    return {
      url: document.getElementById(`webhook-${i}-url`)?.value?.trim() || '',
      secret: document.getElementById(`webhook-${i}-secret`)?.value || '',
      events: eventsVal
        ? eventsVal
            .split(',')
            .map((s) => s.trim())
            .filter(Boolean)
        : [],
      timeout_ms:
        parseInt(
          document.getElementById(`webhook-${i}-timeout-ms`)?.value,
          10,
        ) || 10000,
      max_retries:
        parseInt(document.getElementById(`webhook-${i}-retries`)?.value, 10) ||
        3,
      rate_limit_ms:
        parseInt(
          document.getElementById(`webhook-${i}-rate-limit-ms`)?.value,
          10,
        ) || 1000,
      control:
        document.getElementById(`webhook-${i}-control`)?.checked ?? false,
    };
  });
}

function webhookEntry(wh, i, rerender) {
  const testResult = webhookTestResults[i];
  return html`
    <div class="settings-card webhook-card">
      <div class="settings-card-header">
        <span class="settings-card-title">Webhook ${i + 1}</span>
      </div>
      <div class="settings-card-body">
        <div class="settings-field">
          <label class="settings-label">URL *</label>
          <sl-input id="webhook-${i}-url" value="${wh.url || ''}" size="small" placeholder="https://example.com/webhook"></sl-input>
        </div>
        <div class="settings-field">
          <label class="settings-label">Secret</label>
          <sl-input id="webhook-${i}-secret" value="${wh.secret || ''}" size="small" type="password" placeholder="HMAC signing secret (optional)"></sl-input>
        </div>
        <div class="settings-field">
          <label class="settings-label">Event Patterns</label>
          <sl-input id="webhook-${i}-events" value="${(wh.events || []).join(', ')}" size="small" placeholder="e.g. pipeline.run.*, pipeline.stage.*"></sl-input>
          <span class="settings-field-hint">Comma-separated glob patterns — empty means all events</span>
        </div>
        <div class="settings-grid settings-grid--3col">
          <div class="settings-field">
            <label class="settings-label">Timeout (ms)</label>
            <sl-input id="webhook-${i}-timeout-ms" type="number" value="${wh.timeout_ms ?? 10000}" size="small" min="1"></sl-input>
          </div>
          <div class="settings-field">
            <label class="settings-label">Retries</label>
            <sl-input id="webhook-${i}-retries" type="number" value="${wh.max_retries ?? 3}" size="small" min="0" max="10"></sl-input>
          </div>
          <div class="settings-field">
            <label class="settings-label">Rate Limit (ms)</label>
            <sl-input id="webhook-${i}-rate-limit-ms" type="number" value="${wh.rate_limit_ms ?? 1000}" size="small" min="0"></sl-input>
          </div>
        </div>
        <div class="settings-switch-row">
          <sl-switch id="webhook-${i}-control" ?checked=${wh.control === true} size="small">Control Webhook</sl-switch>
          <span class="settings-switch-desc">Allow this webhook to control the pipeline (requires non-empty secret)</span>
        </div>
        <div class="webhook-actions">
          <sl-button size="small" @click=${async () => {
            const url =
              document.getElementById(`webhook-${i}-url`)?.value?.trim() || '';
            const secret =
              document.getElementById(`webhook-${i}-secret`)?.value || '';
            const timeout_ms =
              parseInt(
                document.getElementById(`webhook-${i}-timeout-ms`)?.value,
                10,
              ) || 10000;
            try {
              const res = await fetch('/api/webhooks/test', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ url, secret, timeout_ms }),
              });
              webhookTestResults[i] = await res.json();
            } catch (err) {
              webhookTestResults[i] = { ok: false, error: err.message };
            }
            rerender();
          }}>Test</sl-button>
          <sl-button size="small" variant="danger" outline @click=${() => {
            const url = wh.url || `Webhook ${i + 1}`;
            showConfirm(
              {
                label: 'Remove Webhook',
                message: html`Are you sure you want to remove <strong>${url}</strong>?`,
                confirmLabel: 'Remove',
                confirmVariant: 'danger',
                onConfirm: () => {
                  settingsData.worca.webhooks.splice(i, 1);
                  delete webhookTestResults[i];
                  rerender();
                },
              },
              rerender,
            );
          }}>
            ${unsafeHTML(iconSvg(Trash2, 14))}
            Remove
          </sl-button>
          ${
            testResult
              ? html`
            <span class="webhook-test-result ${testResult.ok ? 'webhook-test-result--ok' : 'webhook-test-result--err'}">
              ${testResult.ok ? `${testResult.status_code} OK (${testResult.response_ms}ms)` : testResult.error || 'failed'}
            </span>
          `
              : nothing
          }
        </div>
      </div>
    </div>
  `;
}

function webhooksTab(worca, rerender) {
  const events = worca.events || {
    enabled: true,
    agent_telemetry: false,
    hook_events: true,
    rate_limit_ms: 1000,
  };
  const budget = worca.budget || {};
  const webhooks = worca.webhooks || [];

  return html`
    <div class="settings-tab-content">
      <h3 class="settings-section-title">Event System</h3>
      <div class="settings-switches">
        <div class="settings-switch-row">
          <sl-switch id="events-enabled" ?checked=${events.enabled !== false} size="small">Events Enabled</sl-switch>
          <span class="settings-switch-desc">Enable pipeline event emission to JSONL file and webhooks</span>
        </div>
        <div class="settings-switch-row">
          <sl-switch id="events-agent-telemetry" ?checked=${events.agent_telemetry === true} size="small">Agent Telemetry</sl-switch>
          <span class="settings-switch-desc">Include per-tool-call telemetry events (high volume)</span>
        </div>
        <div class="settings-switch-row">
          <sl-switch id="events-hook-events" ?checked=${events.hook_events !== false} size="small">Hook Events</sl-switch>
          <span class="settings-switch-desc">Include hook governance events (guard blocks, test gate strikes)</span>
        </div>
      </div>
      <div class="settings-grid">
        <div class="settings-field">
          <label class="settings-label">Rate Limit (ms)</label>
          <sl-input id="events-rate-limit-ms" type="number" value="${events.rate_limit_ms ?? 1000}" size="small" min="0"></sl-input>
          <span class="settings-field-hint">Minimum interval between same event type per webhook (0 = unlimited)</span>
        </div>
      </div>

      <h3 class="settings-section-title">Budget</h3>
      <div class="settings-grid">
        <div class="settings-field">
          <label class="settings-label">Max Cost (USD)</label>
          <sl-input id="budget-max-cost" type="number" step="0.01" min="0.01" value="${budget.max_cost_usd || ''}" size="small" placeholder="e.g. 10.00"></sl-input>
          <span class="settings-field-hint">Hard limit — pipeline aborts when total cost exceeds this</span>
        </div>
        <div class="settings-field">
          <label class="settings-label">Warning Threshold (%)</label>
          <sl-input id="budget-warning-pct" type="number" min="0" max="100" value="${budget.warning_pct ?? 80}" size="small"></sl-input>
          <span class="settings-field-hint">Emit cost.budget_warning at this percentage of max cost</span>
        </div>
      </div>

      <h3 class="settings-section-title">Webhooks</h3>
      <div class="webhooks-list">
        ${webhooks.length === 0 ? html`<span class="settings-muted">No webhooks configured</span>` : nothing}
        ${webhooks.map((wh, i) => webhookEntry(wh, i, rerender))}
      </div>
      <sl-button size="small" variant="text" @click=${() => {
        settingsData.worca.webhooks = [
          ...(settingsData.worca.webhooks || []),
          {
            url: '',
            secret: '',
            events: [],
            timeout_ms: 10000,
            max_retries: 3,
            rate_limit_ms: 1000,
            control: false,
          },
        ];
        rerender();
      }}>
        ${unsafeHTML(iconSvg(Plus, 14))}
        Add Webhook
      </sl-button>

      <div class="settings-tab-actions">
        <sl-button variant="primary" size="small" @click=${() => {
          const eventsConfig = readEventsFromDom();
          const budgetConfig = readBudgetFromDom();
          const webhooksConfig = readWebhooksFromDom();
          saveSettings(
            {
              worca: {
                events: eventsConfig,
                budget: budgetConfig,
                webhooks: webhooksConfig,
              },
            },
            rerender,
          );
        }}>
          ${unsafeHTML(iconSvg(Save, 14))}
          Save
        </sl-button>
        <sl-button variant="default" size="small" outline @click=${() => confirmReset('webhooks', rerender)}>
          ${unsafeHTML(iconSvg(RefreshCw, 14))}
          Reset
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
        @sl-after-hide=${() => {
          saveStatus = null;
          saveMessage = '';
          rerender();
        }}>
        ${saveMessage}
      </sl-alert>
    </div>
  `;
}

// --- Projects tab ---

function projectsTab(
  projects,
  { onProjectAdd, onProjectRemove, onProjectsRefresh, rerender: _rerender },
) {
  const list = projects || [];

  // Load version info for active version comparison
  if (!versionsData && !versionsLoading && !versionsError) {
    loadVersions(_rerender);
  }
  const activeWorcaCc = versionsData?.activeWorcaCc || null;

  function confirmRemove(projectName) {
    showConfirm(
      {
        label: 'Remove Project',
        message: html`Are you sure you want to remove <strong>${projectName}</strong>? This only unregisters the project — no files are deleted.`,
        confirmLabel: 'Remove',
        confirmVariant: 'danger',
        onConfirm: () => {
          fetch(`/api/projects/${projectName}`, { method: 'DELETE' })
            .then((r) => r.json())
            .then((data) => {
              if (data.ok) onProjectRemove?.(projectName);
            })
            .catch(() => {});
        },
      },
      _rerender,
    );
  }

  function confirmWorcaUpdate(projectName) {
    showConfirm(
      {
        label: 'Update Worca',
        message: html`Update worca pipeline files in <strong>${projectName}</strong>?`,
        confirmLabel: 'Update',
        confirmVariant: 'primary',
        onConfirm: () => {
          fetch(`/api/projects/${projectName}/worca-setup`, {
            method: 'POST',
          })
            .then((r) => r.json())
            .then((data) => {
              if (data.ok) {
                // Wait for the background process to finish, then refresh
                setTimeout(() => onProjectsRefresh?.(), 3000);
              }
            })
            .catch(() => {});
        },
      },
      _rerender,
    );
  }

  function handleOpenAddDialog() {
    onProjectAdd?.({ openDialog: true });
  }

  return html`
    <div class="settings-card">
      <h3>Projects</h3>
      <div class="projects-list">
        ${list.map(
          (p) => html`
          <div class="projects-list-item">
            <div>
              <div class="project-name">${p.name}</div>
              <div class="project-path">${p.path}</div>
            </div>
            <div style="display:flex; align-items:center; gap:0.5rem;">
              <sl-badge variant="${!p.worcaVersion ? 'warning' : !activeWorcaCc ? 'neutral' : isVersionBehind(p.worcaVersion, activeWorcaCc) ? 'warning' : 'success'}" pill>worca-cc: ${p.worcaVersion || 'unknown'}</sl-badge>
              <sl-button
                size="small"
                variant="primary"
                outline
                @click=${() => confirmWorcaUpdate(p.name)}
              >
                ${unsafeHTML(iconSvg(RefreshCw, 14))}
                Update
              </sl-button>
              <sl-button
                size="small"
                variant="danger"
                outline
                @click=${() => confirmRemove(p.name)}
              >
                ${unsafeHTML(iconSvg(Trash2, 14))}
                Remove
              </sl-button>
            </div>
          </div>
        `,
        )}
        ${list.length === 0 ? html`<div class="empty-state">No projects registered</div>` : nothing}
      </div>
      <div style="margin-top: 12px;">
        <sl-button size="small" @click=${handleOpenAddDialog}>
          ${unsafeHTML(iconSvg(Plus, 14))}
          Add Project
        </sl-button>
      </div>
    </div>
    ${confirmDialogTemplate()}
  `;
}

// --- Main exports ---

/**
 * Global settings view — Preferences, Notifications, Projects tabs.
 * Does not depend on currentProjectId.
 */
export function settingsView(
  preferences,
  {
    rerender,
    onThemeToggle,
    onSaveSourceRepo,
    onSaveNotifications,
    onRequestPermission,
    projects,
    onProjectAdd,
    onProjectRemove,
    onProjectsRefresh,
    integrations,
    onIgStartEdit,
    onIgCancelEdit,
    onIgFieldChange,
    onIgEventToggle,
    onIgSave,
    onIgRemove,
    onIgDetect,
    onIgToggleEnabled,
  } = {},
) {
  // Reload base settings when switching from project-scoped view
  if (_settingsProjectId !== null) {
    loadSettings(null).then(() => rerender());
    return html`<div class="empty-state">Loading settings\u2026</div>`;
  }

  return html`
    ${feedbackAlert(rerender)}
    <div class="settings-page">
      <sl-tab-group>
        <sl-tab slot="nav" panel="projects">
          ${unsafeHTML(iconSvg(FolderOpen, 14))}
          Projects
        </sl-tab>
        <sl-tab slot="nav" panel="notifications">
          ${unsafeHTML(iconSvg(Bell, 14))}
          Notifications
        </sl-tab>
        <sl-tab slot="nav" panel="preferences">
          ${unsafeHTML(iconSvg(Settings, 14))}
          Preferences
        </sl-tab>
        <sl-tab slot="nav" panel="integrations">
          ${unsafeHTML(iconSvg(Zap, 14))}
          Integrations
        </sl-tab>

        <sl-tab-panel name="projects">${projectsTab(projects, { onProjectAdd, onProjectRemove, onProjectsRefresh, rerender })}</sl-tab-panel>
        <sl-tab-panel name="notifications">${notificationsTab(preferences, { rerender, onSaveNotifications, onRequestPermission })}</sl-tab-panel>
        <sl-tab-panel name="preferences">${preferencesTab(preferences, { onThemeToggle, onSaveSourceRepo, rerender })}</sl-tab-panel>
        <sl-tab-panel name="integrations">${integrationsTab(integrations || {}, { onStartEdit: onIgStartEdit, onCancelEdit: onIgCancelEdit, onFieldChange: onIgFieldChange, onEventToggle: onIgEventToggle, onSave: onIgSave, onRemove: onIgRemove, onDetect: onIgDetect, onToggleEnabled: onIgToggleEnabled })}</sl-tab-panel>
      </sl-tab-group>
    </div>
  `;
}

/**
 * Project-scoped settings view — Agents, Pipeline, Governance, Webhooks tabs.
 * Reloads when currentProjectId changes.
 */
export function projectSettingsView(
  _preferences,
  { rerender, currentProjectId } = {},
) {
  // Reload settings when the active project changes
  if (currentProjectId !== _settingsProjectId) {
    loadSettings(currentProjectId).then(() => rerender());
    return html`<div class="empty-state">Loading settings\u2026</div>`;
  }

  if (!settingsData) {
    return html`<div class="empty-state">Loading settings\u2026</div>`;
  }

  const worca = settingsData.worca || {};
  const permissions = settingsData.permissions || {};

  return html`
    ${feedbackAlert(rerender)}
    ${confirmDialogTemplate()}
    <div class="settings-page">
      <sl-tab-group>
        <sl-tab slot="nav" panel="agents">
          ${unsafeHTML(iconSvg(Users, 14))}
          Agents
        </sl-tab>
        <sl-tab slot="nav" panel="pipeline">
          ${unsafeHTML(iconSvg(Workflow, 14))}
          Pipeline
        </sl-tab>
        <sl-tab slot="nav" panel="governance">
          ${unsafeHTML(iconSvg(Shield, 14))}
          Governance
        </sl-tab>
        <sl-tab slot="nav" panel="pricing">
          ${unsafeHTML(iconSvg(Coins, 14))}
          Pricing
        </sl-tab>
        <sl-tab slot="nav" panel="webhooks">
          ${unsafeHTML(iconSvg(Zap, 14))}
          Webhooks
        </sl-tab>

        <sl-tab-panel name="agents">${agentsTab(worca, rerender)}</sl-tab-panel>
        <sl-tab-panel name="pipeline">${pipelineTab(worca, rerender)}</sl-tab-panel>
        <sl-tab-panel name="governance">${governanceTab(worca, permissions, rerender)}</sl-tab-panel>
        <sl-tab-panel name="pricing">${pricingTab(worca, rerender)}</sl-tab-panel>
        <sl-tab-panel name="webhooks">${webhooksTab(worca, rerender)}</sl-tab-panel>
      </sl-tab-group>
    </div>
  `;
}

// Test-only exports
export { preferencesTab as _preferencesTab };
export { projectsTab as _projectsTab };
