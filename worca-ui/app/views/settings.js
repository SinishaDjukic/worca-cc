import { html, nothing } from 'lit-html';
import { unsafeHTML } from 'lit-html/directives/unsafe-html.js';
import { DISPATCH_DEFAULTS } from '../../server/dispatch-defaults.js';
import reservedEnvKeysData from '../../server/schemas/reserved-env-keys.json';
import {
  confirmDialogTemplate,
  showConfirm,
  showInfo,
} from '../utils/confirm-dialog.js';
import { helpFor, helpUrl } from '../utils/help-links.js';
import {
  Bell,
  ClipboardCopy,
  ClipboardPaste,
  Coins,
  Copy,
  Database,
  FolderOpen,
  iconSvg,
  Pencil,
  Plus,
  RefreshCw,
  Save,
  Search,
  Settings,
  Shield,
  Trash2,
  Workflow,
  X,
  Zap,
} from '../utils/icons.js';
import {
  decodeModelEnvelope,
  encodeModelEnvelope,
} from '../utils/model-clipboard.js';
import { STAGE_ORDER } from '../utils/stage-order.js';
import { isVersionBehind } from '../utils/version-compare.js';
import { AGENT_NAMES } from './agent-names.js';
import { resetSectionConfig } from './dispatch-section.js';
import { integrationsTab } from './integrations.js';
import { crgTab } from './settings-code-review-graph.js';
import { graphifyTab } from './settings-graphify.js';

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
// AGENT_NAMES lives in agent-names.js so the sync test can import it without
// pulling settings.js' transitive JSON imports. Re-exported here so existing
// `import { AGENT_NAMES } from './settings.js'` callers keep working.
export { AGENT_NAMES } from './agent-names.js';

const DEFAULT_MODEL_KEYS = ['opus', 'sonnet', 'haiku'];

export const EFFORT_LEVELS = ['low', 'medium', 'high', 'xhigh', 'max'];
export const AUTO_MODES = ['disabled', 'reactive', 'adaptive'];

export const PLAN_REVIEW_MODES = ['review', 'review_and_edit'];
export const PLAN_REVIEW_ENFORCE_OPTIONS = [
  'auto',
  'review',
  'review_and_edit',
];

export function getModelKeys(worca) {
  const models = worca?.models || {};
  const keys = Object.keys(models);
  return keys.length > 0 ? keys : DEFAULT_MODEL_KEYS;
}

// Banner shown at the top of every Settings tab whose keys are template-driven
// (Agents, Pipeline, Effort, Governance.dispatch sub-panel). Phase 1 of the
// template-driven pipelines work made these keys lose to the selected template
// at run launch — the values here only apply when no template is in play and
// no worca.default_template is set.
export const TEMPLATE_DRIVEN_BANNER = html`
  <sl-alert variant="neutral" open class="template-driven-banner">
    <strong>Template-driven settings.</strong>
    When a pipeline template is in play at run launch — either picked
    explicitly or pinned via <code>worca.default_template</code> — these
    values are <em>not</em> applied. The selected template owns them. The
    values here only take effect when no template is selected.
    <a href=${helpUrl('configuration-precedence')} target="_blank" rel="noopener">Learn more →</a>
  </sl-alert>
`;

const GLOBAL_ONLY_KEY_PATHS = [
  ['parallel', 'cleanup_policy'],
  ['parallel', 'max_concurrent_pipelines'],
  ['ui', 'worktree_disk_warning_bytes'],
  ['circuit_breaker', 'classifier_model'],
];
const INERT_MILESTONE_KEYS_CLIENT = ['pr_approval', 'deploy_approval'];

export function detectMigrationNeeded(worca) {
  if (!worca) return false;
  for (const [section, key] of GLOBAL_ONLY_KEY_PATHS) {
    if (worca[section]?.[key] !== undefined) return true;
  }
  const m = worca.milestones;
  if (m) {
    for (const key of INERT_MILESTONE_KEYS_CLIENT) {
      if (m[key] === true) return true;
    }
  }
  return false;
}

export function countMigrated(autoMigrated) {
  if (!autoMigrated) return 0;
  let count = 0;
  if (autoMigrated.globalExtracted) {
    for (const section of Object.values(autoMigrated.globalExtracted)) {
      count += Object.keys(section).length;
    }
  }
  if (autoMigrated.removedMilestones) {
    count += autoMigrated.removedMilestones.length;
  }
  return count;
}

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

export const DEFAULT_GOVERNANCE = {
  guards: {
    block_rm_rf: true,
    block_env_write: true,
    block_force_push: true,
    restrict_git_commit: true,
  },
  test_gate_strikes: 2,
  dispatch_migration_version: 1,
  dispatch: {
    tools: { ...DISPATCH_DEFAULTS.tools },
    skills: { ...DISPATCH_DEFAULTS.skills },
    subagents: { ...DISPATCH_DEFAULTS.subagents },
  },
};

// --- Module state ---
let settingsData = null;
let saveStatus = null; // null | 'saving' | 'success' | 'error'
let saveMessage = '';
let _settingsProjectId = null; // track which project settings are loaded for
let _migrationNeeded = false;
let _migrationDismissed = false;
let _legacyDispatchDetected = false;

// --- Dispatch autocomplete state ---
let _discoveredKnownTypes = null;
let _knownTools = null;
let _knownSkills = null;

// --- Per-section dispatch editor state ({input, showSuggestions} per agent) ---
let _dispatchEditState = {
  tools: {},
  skills: {},
  subagents: {},
};

// --- Per-section expand/collapse state for the Governance tab. Sections
// collapse by default so the Governance tab doesn't dominate the page; the
// pattern mirrors the model-card env-vars sl-details. ---
const _dispatchSectionExpanded = {
  tools: false,
  skills: false,
  subagents: false,
};

function resetDispatchEditState() {
  _dispatchEditState = { tools: {}, skills: {}, subagents: {} };
}

function _toggleDispatchSection(section, expanded, rerender) {
  if (_dispatchSectionExpanded[section] === expanded) return;
  _dispatchSectionExpanded[section] = expanded;
  rerender();
}

function _dispatchSectionSummary(section, dispatch) {
  const cfg = dispatch[section] || DISPATCH_DEFAULTS[section];
  const alwaysCount = (cfg.always_disallowed || []).length;
  const deniedCount = (cfg.default_denied || []).length;
  const perAgentEntries = Object.entries(cfg.per_agent_allow || {}).filter(
    ([k]) => k !== '_defaults',
  );
  const customCount = perAgentEntries.length;
  const parts = [];
  parts.push(`${alwaysCount} always-disallowed`);
  if (deniedCount > 0) parts.push(`${deniedCount} default-denied`);
  if (customCount > 0)
    parts.push(
      `${customCount} customized agent${customCount === 1 ? '' : 's'}`,
    );
  return parts.join(' · ');
}

const _DISPATCH_SECTION_LABELS = {
  tools: 'Tools',
  skills: 'Skills',
  subagents: 'Subagents',
};

const _DISPATCH_SECTION_KEYS = new Set(['tools', 'skills', 'subagents']);

function _detectAndAbsorbLegacyDispatch(gov) {
  if (!gov || typeof gov !== 'object') return false;
  let detected = false;

  // Legacy flat shape: governance.dispatch = { planner: [...], ... }
  const dispatch = gov.dispatch;
  if (dispatch && typeof dispatch === 'object' && !Array.isArray(dispatch)) {
    const flatKeys = Object.keys(dispatch).filter(
      (k) => !_DISPATCH_SECTION_KEYS.has(k) && Array.isArray(dispatch[k]),
    );
    if (flatKeys.length > 0) {
      detected = true;
      if (!dispatch.subagents) dispatch.subagents = {};
      if (!dispatch.subagents.per_agent_allow) {
        dispatch.subagents.per_agent_allow = {};
      }
      for (const key of flatKeys) {
        if (!dispatch.subagents.per_agent_allow[key]) {
          dispatch.subagents.per_agent_allow[key] = dispatch[key];
        }
        delete dispatch[key];
      }
    }
  }

  // Pre-W-054 intermediate shape: governance.subagent_dispatch = { planner: [...] }
  if (gov.subagent_dispatch && typeof gov.subagent_dispatch === 'object') {
    detected = true;
    if (!gov.dispatch) gov.dispatch = {};
    if (!gov.dispatch.subagents) gov.dispatch.subagents = {};
    if (!gov.dispatch.subagents.per_agent_allow) {
      gov.dispatch.subagents.per_agent_allow = {};
    }
    for (const [k, v] of Object.entries(gov.subagent_dispatch)) {
      if (!gov.dispatch.subagents.per_agent_allow[k]) {
        gov.dispatch.subagents.per_agent_allow[k] = v;
      }
    }
    delete gov.subagent_dispatch;
  }

  return detected;
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
    for (const model of getModelKeys(settingsData.worca)) {
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
      // Detect and migrate legacy shapes (flat governance.dispatch, or
      // intermediate subagent_dispatch) into the W-054 nested shape in place.
      _legacyDispatchDetected = _detectAndAbsorbLegacyDispatch(gov);
      const serverDispatch = gov.dispatch || {};
      settingsData.worca.governance = {
        ...DEFAULT_GOVERNANCE,
        ...gov,
        guards: {
          ...DEFAULT_GOVERNANCE.guards,
          ...(gov.guards || {}),
        },
        dispatch: {
          tools: {
            always_disallowed:
              serverDispatch.tools?.always_disallowed ??
              DISPATCH_DEFAULTS.tools.always_disallowed,
            default_denied:
              serverDispatch.tools?.default_denied ??
              DISPATCH_DEFAULTS.tools.default_denied,
            per_agent_allow:
              serverDispatch.tools?.per_agent_allow ??
              DISPATCH_DEFAULTS.tools.per_agent_allow,
          },
          skills: {
            always_disallowed:
              serverDispatch.skills?.always_disallowed ??
              DISPATCH_DEFAULTS.skills.always_disallowed,
            default_denied:
              serverDispatch.skills?.default_denied ??
              DISPATCH_DEFAULTS.skills.default_denied,
            per_agent_allow:
              serverDispatch.skills?.per_agent_allow ??
              DISPATCH_DEFAULTS.skills.per_agent_allow,
          },
          subagents: {
            always_disallowed:
              serverDispatch.subagents?.always_disallowed ??
              DISPATCH_DEFAULTS.subagents.always_disallowed,
            default_denied:
              serverDispatch.subagents?.default_denied ??
              DISPATCH_DEFAULTS.subagents.default_denied,
            per_agent_allow:
              serverDispatch.subagents?.per_agent_allow ??
              DISPATCH_DEFAULTS.subagents.per_agent_allow,
          },
        },
      };
    }
    // Project defaults from keys.json (§10a). Keys in NORMALIZE_SKIP_KEYS
    // (pr_approval) are omitted so a load→save round-trip on a clean project
    // doesn't inject default-false values back into the file.
    if (!settingsData.worca.milestones) {
      settingsData.worca.milestones = { plan_approval: true };
    } else {
      settingsData.worca.milestones.plan_approval ??= true;
    }
    if (!settingsData.worca.circuit_breaker) {
      settingsData.worca.circuit_breaker = {
        enabled: true,
        max_consecutive_failures: 3,
      };
    } else {
      settingsData.worca.circuit_breaker.enabled ??= true;
      settingsData.worca.circuit_breaker.max_consecutive_failures ??= 3;
    }
    if (!settingsData.worca.parallel) {
      settingsData.worca.parallel = {
        worktree_base_dir: '.worktrees',
        default_base_branch: 'main',
      };
    } else {
      settingsData.worca.parallel.worktree_base_dir ??= '.worktrees';
      settingsData.worca.parallel.default_base_branch ??= 'main';
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
    _migrationNeeded = detectMigrationNeeded(settingsData.worca);
    _migrationDismissed = false;
    resetDispatchEditState();
    // Best-effort fetch of known items for dispatch autocomplete.
    // On failure we keep nulls and the editor uses hardcoded fallbacks.
    try {
      const [subRes, toolsRes, skillsRes] = await Promise.all([
        fetch('/api/subagents').catch(() => null),
        fetch('/api/tools').catch(() => null),
        fetch('/api/skills').catch(() => null),
      ]);
      if (subRes?.ok) {
        const body = await subRes.json();
        if (body?.ok && Array.isArray(body.subagents)) {
          _discoveredKnownTypes = body.subagents;
        }
      }
      if (toolsRes?.ok) {
        const body = await toolsRes.json();
        if (body?.ok && Array.isArray(body.tools)) {
          _knownTools = body.tools;
        }
      }
      if (skillsRes?.ok) {
        const body = await skillsRes.json();
        if (body?.ok && Array.isArray(body.skills)) {
          _knownSkills = body.skills;
        }
      }
    } catch {
      // keep the fallbacks
    }
  } catch (err) {
    settingsData = null;
    saveStatus = 'error';
    saveMessage = `Failed to load settings: ${err.message}`;
  }
}

export async function saveSettings(data, rerender, projectId) {
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
    const n = countMigrated(result.autoMigrated);
    if (n > 0) {
      _migrationNeeded = false;
      _migrationDismissed = true;
    }
    saveStatus = 'success';
    saveMessage =
      n > 0
        ? `${n} project setting${n === 1 ? ' was' : 's were'} moved to global Preferences`
        : 'Settings saved successfully';
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

// Per-section detail bodies for the Reset confirmation dialog. Sections not
// listed here fall back to the generic "Are you sure?" prompt.
const _RESET_DETAIL_MESSAGES = {
  models: html`
    <p>Resetting will:</p>
    <ul style="margin: 0.5rem 0; padding-left: 1.2rem; line-height: 1.5">
      <li>
        Remove the entire <code>worca.models</code> key from
        <code>.claude/settings.json</code> (committed) and
        <code>.claude/settings.local.json</code> (gitignored).
      </li>
      <li>
        Restore the three built-in entries
        (<code>opus</code>, <code>sonnet</code>, <code>haiku</code>) from the
        worca template defaults — back to their factory model IDs and no env
        vars.
      </li>
      <li>
        Discard <strong>all custom models</strong> you've added (e.g.
        <code>glm-ds</code>, <code>alt-fast</code>).
      </li>
      <li>
        Discard <strong>all environment-variable overrides</strong> on the
        built-in models.
      </li>
      <li>
        Cause any agent referencing a deleted custom model to fall back to
        opaque pass-through, which may fail if the underlying CLI doesn't
        recognize the name.
      </li>
    </ul>
    <p class="confirm-warning">
      <span aria-hidden="true">⚠</span>
      <span>This action cannot be undone.</span>
    </p>
  `,
};

export function confirmReset(section, rerender) {
  const label = section.charAt(0).toUpperCase() + section.slice(1);
  const detail = _RESET_DETAIL_MESSAGES[section];
  showConfirm(
    {
      label: `Reset ${label}`,
      message:
        detail ||
        html`Are you sure you want to reset <strong>${label}</strong> settings to their defaults?`,
      confirmLabel: 'Reset',
      confirmVariant: 'danger',
      onConfirm: () => resetSection(section, rerender),
    },
    rerender,
  );
}

// Governance-tab reset is staged in memory (NOT an immediate server reset like
// confirmReset/resetSection): it restores DEFAULT_GOVERNANCE in settingsData so
// the form re-renders to defaults, and the user must click Save to persist —
// matching the per-section Reset behaviour in the dispatch panels.
function resetGovernanceTabInMemory(rerender) {
  if (!settingsData?.worca) return;
  const current = settingsData.worca.governance || {};
  const reset = structuredClone(DEFAULT_GOVERNANCE);
  // The save path deep-merges and never deletes keys, so reset each dispatch
  // section through resetSectionConfig — that explicitly overwrites every
  // currently-customized per-agent entry with its default value so the reset
  // actually persists on Save (see resetSectionConfig).
  for (const section of ['tools', 'skills', 'subagents']) {
    reset.dispatch[section] = resetSectionConfig(
      current.dispatch?.[section],
      DISPATCH_DEFAULTS[section],
    );
  }
  settingsData.worca.governance = reset;
  resetDispatchEditState();
  saveStatus = null;
  saveMessage = '';
  rerender();
}

function confirmResetGovernance(rerender) {
  showConfirm(
    {
      label: 'Reset Governance',
      message: html`Reset all <strong>Governance</strong> settings (guard rules,
        test gate, and dispatch rules) to their defaults? Changes apply when you
        click <strong>Save</strong>.`,
      confirmLabel: 'Reset',
      confirmVariant: 'danger',
      onConfirm: () => resetGovernanceTabInMemory(rerender),
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

export function readPipelineFromDom() {
  // Note: loops, circuit_breaker, AND milestones (approval gates)
  // were removed from the Project Settings Pipeline tab in the
  // W-062 Phase 6 option-B cleanup. All three are template-driven
  // and edited via the Templates page. This function reads only
  // the cross-template knobs that remain.
  const planPathEl = document.getElementById('plan-path-template');
  const plan_path_template = planPathEl?.value?.trim() || '';
  const msizeEl = document.getElementById('defaults-msize');
  const mloopsEl = document.getElementById('defaults-mloops');
  const defaults = {
    msize: parseInt(msizeEl?.value, 10) || 1,
    mloops: parseInt(mloopsEl?.value, 10) || 1,
  };

  const parallel = {
    worktree_base_dir:
      document.getElementById('parallel-worktree-base-dir')?.value?.trim() ||
      '.worktrees',
    default_base_branch:
      document.getElementById('parallel-default-base-branch')?.value?.trim() ||
      'main',
  };

  const guide = {
    max_bytes:
      parseInt(document.getElementById('guide-max-bytes')?.value, 10) || 131072,
  };

  const fleet = {
    max_parallel:
      parseInt(document.getElementById('fleet-max-parallel')?.value, 10) || 5,
    failure_threshold:
      parseFloat(document.getElementById('fleet-failure-threshold')?.value) ||
      0.3,
  };

  return {
    plan_path_template,
    defaults,
    parallel,
    guide,
    fleet,
  };
}

export function readStagesFromDom() {
  const stages = {};
  for (const stage of CONFIGURABLE_STAGES) {
    const enabledEl = document.getElementById(`stage-${stage}-enabled`);
    const agentEl = document.getElementById(`stage-${stage}-agent`);
    stages[stage] = {
      agent: agentEl?.value || DEFAULT_STAGES[stage].agent,
      enabled: enabledEl?.checked ?? true,
    };
    if (stage === 'plan_review') {
      const modeEl = document.getElementById('stage-plan_review-mode');
      stages[stage].mode = modeEl?.value || 'review';
    }
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

export function readGovernanceFromDom() {
  // Project-Settings Governance owns only `guards` + permissions after
  // the W-062 Phase 6 cleanup. `dispatch`, `test_gate_strikes`, and
  // `plan_review_enforce` were all promoted to template-owned keys
  // (see TEMPLATE_OWNED_KEYS in src/worca/orchestrator/templates.py)
  // and edited via the Templates page.
  const guards = {};
  for (const rule of GUARD_RULES) {
    const el = document.getElementById(`guard-${rule.key}`);
    guards[rule.key] = el?.checked ?? true;
  }
  return { guards };
}

export function formatDiskThreshold(bytes) {
  if (bytes >= 1_000_000_000) {
    return { value: bytes / 1_000_000_000, unit: 'GB' };
  }
  return { value: bytes / 1_000_000, unit: 'MB' };
}

function readDiskThresholdFromDom() {
  const valueEl = document.getElementById('global-disk-threshold-value');
  const unitEl = document.getElementById('global-disk-threshold-unit');
  const value = parseFloat(valueEl?.value) || 2;
  const unit = unitEl?.value || 'GB';
  const multiplier = unit === 'GB' ? 1_000_000_000 : 1_000_000;
  return value * multiplier;
}

export function readGlobalsFromDom() {
  const diskBytes = readDiskThresholdFromDom();
  const cleanupEl = document.getElementById('global-cleanup-policy');
  const modelEl = document.getElementById('global-classifier-model');
  const maxConcurrentEl = document.getElementById('global-max-concurrent');

  return {
    worca: {
      ui: {
        worktree_disk_warning_bytes: diskBytes,
      },
      parallel: {
        cleanup_policy: cleanupEl?.value || 'never',
        max_concurrent_pipelines: parseInt(maxConcurrentEl?.value, 10) || 10,
      },
      circuit_breaker: {
        classifier_model: modelEl?.value || 'haiku',
      },
    },
  };
}

async function savePreferences(data, rerender, onStoreUpdate) {
  saveStatus = 'saving';
  saveMessage = '';
  rerender();
  try {
    const res = await fetch('/api/preferences', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const result = await res.json();
    if (result.ok && onStoreUpdate) {
      const p = result.preferences?.worca ?? {};
      onStoreUpdate({
        worktreeDiskWarningBytes:
          p.ui?.worktree_disk_warning_bytes ?? 2_000_000_000,
        classifierModel: p.circuit_breaker?.classifier_model ?? 'haiku',
        cleanupPolicy: p.parallel?.cleanup_policy ?? 'never',
        maxConcurrentPipelines: p.parallel?.max_concurrent_pipelines ?? 10,
      });
    }
    saveStatus = 'success';
    saveMessage = 'Preferences saved successfully';
  } catch (err) {
    saveStatus = 'error';
    saveMessage = `Failed to save: ${err.message}`;
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

export function readPermissionsFromDom() {
  const inputs = document.querySelectorAll('.perm-input');
  return Array.from(inputs)
    .map((el) => el.value.trim())
    .filter((v) => v.length > 0);
}

export function readPricingFromDom() {
  // Per-model pricing rows moved to the Models page (each model alias has
  // its own Pricing accordion in the editor). The Costs & Budgets tab now
  // only covers server-tool pricing + currency. We deliberately omit the
  // `models` key here so saveSettings' deep-merge preserves any per-model
  // pricing the runtime currently has — the Models editor owns writes to it.
  const searchEl = document.getElementById(
    'pricing-server_tools-web_search_per_request',
  );
  const fetchEl = document.getElementById(
    'pricing-server_tools-web_fetch_per_request',
  );
  return {
    server_tools: {
      web_search_per_request: parseFloat(searchEl?.value) || 0,
      web_fetch_per_request: parseFloat(fetchEl?.value) || 0,
    },
    currency: settingsData?.worca?.pricing?.currency || 'USD',
    last_updated: new Date().toISOString().slice(0, 10),
  };
}

export function readEffortFromDom() {
  const auto_mode =
    document.getElementById('effort-auto-mode')?.value || 'adaptive';
  const auto_cap = document.getElementById('effort-auto-cap')?.value || 'xhigh';

  const agents = {};
  for (const name of AGENT_NAMES) {
    const el = document.getElementById(`effort-agent-${name}`);
    const val = el?.value;
    if (val && val !== '') {
      agents[name] = { effort: val };
    } else {
      agents[name] = { effort: null };
    }
  }

  return { auto_mode, auto_cap, agents };
}

export function getDefaults() {
  return settingsData?.worca?.defaults || { msize: 1, mloops: 1 };
}

// --- Tab views ---

function _agentsTab(worca, rerender) {
  const agents = worca.agents || {};
  const modelOptions = getModelKeys(worca);
  return html`
    <div class="settings-tab-content">
      ${TEMPLATE_DRIVEN_BANNER}
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
                    ${modelOptions.map((m) => html`<sl-option value="${m}">${m}</sl-option>`)}
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

export function pipelineTab(worca, rerender) {
  const stages = worca.stages || DEFAULT_STAGES;
  const parallel = worca.parallel || {};
  const guide = worca.guide || {};
  const fleet = worca.fleet || {};

  const preflight = stages.preflight || {
    enabled: true,
    script: '.claude/worca/scripts/preflight_checks.py',
    require: [],
  };

  // Pipeline tab now holds only cross-template knobs (preflight,
  // plan path, run defaults, milestones, parallel, fleet & guide).
  // The template-driven keys (agents, stages config, loops,
  // circuit_breaker, effort, governance.dispatch) live on the
  // Templates page — no banner needed here because the dropped
  // content is no longer adjacent to where it used to live.

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

      <h3 class="settings-section-title">Execution & Parallelism</h3>
      <div class="settings-grid">
        <div class="settings-field">
          <label class="settings-label">Worktree Base Directory</label>
          <sl-input id="parallel-worktree-base-dir" value="${parallel.worktree_base_dir || '.worktrees'}" size="small" placeholder=".worktrees"></sl-input>
          <span class="settings-field-hint">Relative paths resolve from project root. Absolute and ~/-prefixed paths supported.</span>
        </div>
        <div class="settings-field">
          <label class="settings-label">Default PR Base Branch</label>
          <sl-input id="parallel-default-base-branch" value="${parallel.default_base_branch || 'main'}" size="small" placeholder="main"></sl-input>
          <span class="settings-field-hint">Used as the default when launching a new worktree-based run if --branch is not specified.</span>
        </div>
      </div>

      <h3 class="settings-section-title">Fleet & Guide</h3>
      <div class="settings-grid">
        <div class="settings-field">
          <label class="settings-label">Guide Max Bytes</label>
          <sl-input id="guide-max-bytes" type="number" value="${guide.max_bytes ?? 131072}" size="small" min="1024" max="10485760"></sl-input>
          <span class="settings-field-hint">Combined size cap (bytes) for --guide files attached to a run. Default 131072 (128 KiB) — fits ~15–25 pages of dense markdown. Pipeline raises a hard error if exceeded.</span>
        </div>
        <div class="settings-field">
          <label class="settings-label">Fleet Max Parallel</label>
          <sl-input id="fleet-max-parallel" type="number" value="${fleet.max_parallel ?? 5}" size="small" min="1" max="50"></sl-input>
          <span class="settings-field-hint">Maximum concurrent child pipelines per fleet run. Per-launch overrides via CLI --max-parallel or the launcher form.</span>
        </div>
        <div class="settings-field">
          <label class="settings-label">Fleet Failure Threshold</label>
          <sl-input id="fleet-failure-threshold" type="number" step="0.05" value="${fleet.failure_threshold ?? 0.3}" size="small" min="0" max="1"></sl-input>
          <span class="settings-field-hint">Failure ratio that trips the fleet circuit breaker and halts unstarted children. Default 0.30 (30%).</span>
        </div>
      </div>

      <div class="settings-tab-actions">
        <sl-button variant="primary" size="small" @click=${() => {
          const { plan_path_template, defaults, parallel, guide, fleet } =
            readPipelineFromDom();
          // Only preflight survives from the old `worca.stages` write
          // path — the per-stage config (agent + enabled + mode) is
          // template-driven now. Keep the rest of the stages payload
          // a minimal `{preflight}` so we don't accidentally clear
          // someone's stages config that exists in legacy settings.
          const stages = { preflight: readPreflightFromDom() };
          const payload = {
            worca: {
              stages,
              plan_path_template,
              defaults,
              parallel,
              guide,
              fleet,
            },
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

export function governanceTab(worca, permissions, rerender) {
  const governance = worca.governance || DEFAULT_GOVERNANCE;
  const guards = governance.guards || DEFAULT_GOVERNANCE.guards;
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

      <div class="pipelines-deep-link-card">
        <div class="pipelines-deep-link-content">
          <div class="pipelines-deep-link-icon">
            ${unsafeHTML(iconSvg(Shield, 20))}
          </div>
          <div class="pipelines-deep-link-text">
            <div class="pipelines-deep-link-title">Template-driven governance</div>
            <div class="pipelines-deep-link-desc">
              Dispatch rules (tool / skill / subagent allow / deny lists),
              the test-gate strike threshold, and the plan-review enforcement
              mode are template-driven — each template owns its own retry +
              review posture. Edit them on the Templates page. Guard rules
              above stay here because they're hook gates (project-machine
              concerns) that templates intentionally can't reach.
            </div>
          </div>
          <a
            href="${
              _settingsProjectId
                ? `#/project/${_settingsProjectId}/templates`
                : '#/templates'
            }"
            class="pipelines-deep-link-btn"
          >
            Edit templates
            ${unsafeHTML(iconSvg(Pencil, 14))}
          </a>
        </div>
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
        <sl-button variant="default" size="small" outline @click=${() => confirmResetGovernance(rerender)}>
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
  { onThemeToggle, onSaveSourceRepo, onSaveGlobals, rerender, globals },
) {
  const theme = preferences?.theme || 'light';
  const sourceRepo = preferences?.source_repo || '';
  const g = globals || {};
  const diskThreshold = formatDiskThreshold(
    g.worktreeDiskWarningBytes ?? 2_000_000_000,
  );
  const cleanupPolicy = g.cleanupPolicy || 'never';
  const classifierModel = g.classifierModel || 'haiku';
  const maxConcurrent = g.maxConcurrentPipelines ?? 10;

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

      <h3 class="settings-section-title">Worktrees</h3>
      <div class="settings-grid">
        <div class="settings-field">
          <label class="settings-label">Disk Warning Threshold</label>
          <div style="display: flex; gap: 8px; align-items: center;">
            <sl-input id="global-disk-threshold-value" type="number" value="${diskThreshold.value}" size="small" min="0.5" max="50" step="0.5" style="flex: 1;"></sl-input>
            <sl-select id="global-disk-threshold-unit" .value="${diskThreshold.unit}" size="small" style="width: 90px;" hoist>
              <sl-option value="MB">MB</sl-option>
              <sl-option value="GB">GB</sl-option>
            </sl-select>
          </div>
          <span class="settings-field-hint">Show a warning badge when worktree disk usage exceeds this value (0.5–50 GB)</span>
        </div>
        <div class="settings-field">
          <label class="settings-label">Cleanup Policy</label>
          <sl-select id="global-cleanup-policy" .value="${cleanupPolicy}" size="small" hoist>
            <sl-option value="never">Never</sl-option>
            <sl-option value="on-success">On Success</sl-option>
            <sl-option value="manual-only">Manual Only</sl-option>
          </sl-select>
          <span class="settings-field-hint">When to automatically remove completed worktrees</span>
        </div>
      </div>

      <h3 class="settings-section-title">Pipeline Execution</h3>
      <div class="settings-grid">
        <div class="settings-field">
          <label class="settings-label">Error Classifier Model</label>
          <sl-select id="global-classifier-model" .value="${classifierModel}" size="small" hoist>
            ${DEFAULT_MODEL_KEYS.map((m) => html`<sl-option value="${m}">${m}</sl-option>`)}
          </sl-select>
          <span class="settings-field-hint">Model used by the circuit breaker to classify errors</span>
        </div>
        <div class="settings-field">
          <label class="settings-label">Max Concurrent Pipelines</label>
          <sl-input id="global-max-concurrent" type="number" value="${maxConcurrent}" size="small" min="1" max="20"></sl-input>
          <span class="settings-field-hint">Maximum number of pipelines that can run simultaneously (1–20)</span>
        </div>
      </div>

      <div class="settings-tab-actions">
        <sl-button variant="primary" size="small" @click=${() => {
          const payload = readGlobalsFromDom();
          savePreferences(payload, rerender, onSaveGlobals);
        }}>
          ${unsafeHTML(iconSvg(Save, 14))}
          Save Global Settings
        </sl-button>
      </div>

      ${rerender ? versionsSection(rerender) : nothing}
    </div>
  `;
}

// ─── Models tab — local edit state ───────────────────────────────────────
//
// Each card has its own edit buffer keyed by model name. The buffer is
// lazily initialized from the server's worca config on first render after
// a load. Save flushes the buffer to the server (PUT /settings/model-env)
// and clears it; the next render then reads the fresh server state.
//
// Discard clears the buffer immediately, reverting the card to server state.
//
// Buffer shape:
//   Map<name, { id: string, env: Array<{ k: string, v: string, _id: string }>,
//               dirty: boolean }>
//
export const _modelsEditState = new Map();

const RESERVED_KEYS = new Set(reservedEnvKeysData.keys || []);
const RESERVED_PREFIXES = reservedEnvKeysData.prefixes || [];

const BUILTIN_MODEL_NAMES = new Set(['opus', 'sonnet', 'haiku']);

export function _envKeyValidationError(rawKey) {
  const k = String(rawKey || '').trim();
  if (!k) return null; // empty draft row — ignored on save, not flagged
  if (RESERVED_KEYS.has(k)) return `Reserved key: ${k}`;
  if (RESERVED_PREFIXES.some((p) => k.startsWith(p))) {
    return `Reserved prefix matches ${k}`;
  }
  return null;
}

export function _normalizeModelEntry(val) {
  if (typeof val === 'string') return { id: val, env: {} };
  if (val && typeof val === 'object') {
    return { id: val.id || '', env: val.env || {} };
  }
  return { id: '', env: {} };
}

function _envRowId(name, key, idx) {
  return `${name}-${key || 'new'}-${idx}-${Math.random().toString(36).slice(2, 7)}`;
}

export function _getOrInitModelState(name, serverEntry) {
  // Re-sync from server every render when the buffer is clean. Without this,
  // the buffer captures whatever state the server had on first render — if
  // settings were still loading, the buffer is stuck with empty values for
  // the rest of the page lifetime.
  const existing = _modelsEditState.get(name);
  if (existing?.dirty) return existing;
  const fresh = {
    id: serverEntry.id,
    env: Object.entries(serverEntry.env).map(([k, v], i) => ({
      k,
      v: String(v),
      _id: _envRowId(name, k, i),
    })),
    dirty: false,
    // Preserve user's manual expand/collapse across clean re-syncs so the
    // env panel doesn't snap shut while they're browsing it.
    envExpanded: existing?.envExpanded ?? false,
  };
  _modelsEditState.set(name, fresh);
  return fresh;
}

function _cardIsValid(name) {
  const s = _modelsEditState.get(name);
  if (!s) return true;
  return s.env.every((row) => _envKeyValidationError(row.k) === null);
}

// Names of model cards that successfully saved within the last
// MODEL_SAVED_INDICATOR_MS window. Populated by _saveModelEnv on success;
// cleared by a per-name timer or on the next edit. Used by _modelCardView
// to render a transient "Saved" pill in place of "Unsaved changes" so the
// user gets visible confirmation now that the Save button is no longer
// gated on dirty state.
export const _modelsRecentlySaved = new Map();
const MODEL_SAVED_INDICATOR_MS = 2000;

// Save is gated only by validity — we intentionally do NOT gate on
// state.dirty. The dirty flag is unreliable (a type-then-undo edit leaves
// dirty=true while values match the server), and idempotent re-saves are
// harmless: the PUT writes the same JSON to .claude/settings.local.json,
// which is deep-merged at read time with no watchers attached.
//
// Exported for unit testing — the BooleanAttributePart in the template
// can't be inspected via renderToString, so we pin the gate logic here.
export function _isCardSaveDisabled(name) {
  return !_cardIsValid(name);
}

function _updateEnvField(name, rowId, field, value, rerender) {
  const s = _modelsEditState.get(name);
  if (!s) return;
  const row = s.env.find((r) => r._id === rowId);
  if (!row) return;
  row[field] = value;
  s.dirty = true;
  s.envExpanded = true;
  // Rerender so the validation pill / Save-disabled state flips for key edits.
  // For value edits, the input is the source of truth and there's nothing
  // visual to change — skip rerender to avoid input flicker during typing.
  if (field === 'k') rerender();
}

function _updateModelId(name, value) {
  const s = _modelsEditState.get(name);
  if (!s) return;
  s.id = value;
  s.dirty = true;
}

function _addEnvRow(name, rerender) {
  const s = _modelsEditState.get(name);
  if (!s) return;
  s.env.push({ k: '', v: '', _id: _envRowId(name, '', s.env.length) });
  s.dirty = true;
  s.envExpanded = true;
  rerender();
  requestAnimationFrame(() => {
    const rows = document.querySelectorAll(
      `[data-model-card="${name}"] .model-env-row`,
    );
    const last = rows[rows.length - 1];
    last?.querySelector('.model-env-key')?.focus?.();
  });
}

function _removeEnvRow(name, rowId, rerender) {
  const s = _modelsEditState.get(name);
  if (!s) return;
  s.env = s.env.filter((r) => r._id !== rowId);
  s.dirty = true;
  s.envExpanded = true;
  rerender();
}

function _toggleEnvExpanded(name, expanded, rerender) {
  const s = _modelsEditState.get(name);
  if (!s) return;
  if (s.envExpanded === expanded) return;
  s.envExpanded = expanded;
  rerender();
}

function _discardModelEdits(name, rerender) {
  _modelsEditState.delete(name);
  rerender();
}

export async function _saveModelEnv(name, rerender) {
  const s = _modelsEditState.get(name);
  if (!s) return;
  const env = {};
  for (const row of s.env) {
    const k = row.k.trim();
    if (!k) continue; // skip empty draft rows
    if (_envKeyValidationError(k) !== null) continue; // validation already disables Save
    env[k] = row.v;
  }
  const url = _settingsProjectId
    ? `/api/projects/${_settingsProjectId}/settings/model-env`
    : '/api/settings/model-env';
  saveStatus = 'saving';
  saveMessage = '';
  rerender();
  try {
    const res = await fetch(url, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: name, id: s.id, env }),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(body.error || `HTTP ${res.status}`);
    }
    _modelsEditState.delete(name); // next render initializes from server
    saveStatus = 'success';
    saveMessage = `Saved ${name}`;
    // Per-card transient "Saved" pill — clears itself after the window.
    // Replaces an existing timer so back-to-back saves on the same card
    // don't double-schedule a rerender.
    const existingTimer = _modelsRecentlySaved.get(name);
    if (existingTimer) clearTimeout(existingTimer);
    const timerId = setTimeout(() => {
      _modelsRecentlySaved.delete(name);
      rerender();
    }, MODEL_SAVED_INDICATOR_MS);
    _modelsRecentlySaved.set(name, timerId);
    await loadSettings(_settingsProjectId);
  } catch (err) {
    saveStatus = 'error';
    saveMessage = `Failed to save ${name}: ${err.message}`;
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

export function _nextDuplicateName(sourceName, existingNames) {
  // Strip a trailing -NN[N] suffix so duplicating "glm-ds-01" yields
  // "glm-ds-02" rather than "glm-ds-01-01".
  const stripped = sourceName.replace(/-\d{2,3}$/, '');
  for (let i = 1; i <= 999; i++) {
    const suffix = i < 100 ? String(i).padStart(2, '0') : String(i);
    const candidate = `${stripped}-${suffix}`;
    if (!existingNames.has(candidate)) return candidate;
  }
  return null;
}

async function _duplicateModel(name, modelsConfig, rerender) {
  const existing = new Set(Object.keys(modelsConfig));
  const nextName = _nextDuplicateName(name, existing);
  if (!nextName) {
    saveStatus = 'error';
    saveMessage = `Cannot duplicate "${name}" — no free numeric suffix slot.`;
    rerender();
    return;
  }
  const source = _normalizeModelEntry(modelsConfig[name]);
  // Drop any local edit buffer for the new name so the next render reads
  // the freshly-saved server state.
  _modelsEditState.delete(nextName);

  const url = _settingsProjectId
    ? `/api/projects/${_settingsProjectId}/settings/model-env`
    : '/api/settings/model-env';
  saveStatus = 'saving';
  saveMessage = '';
  rerender();
  try {
    const res = await fetch(url, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: nextName,
        id: source.id,
        env: { ...source.env },
      }),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(body.error || `HTTP ${res.status}`);
    }
    saveStatus = 'success';
    saveMessage = `Duplicated ${name} → ${nextName}`;
    await loadSettings(_settingsProjectId);
  } catch (err) {
    saveStatus = 'error';
    saveMessage = `Failed to duplicate ${name}: ${err.message}`;
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

// --- Model rename (dialog + PUT-new + DELETE-old) -------------------------

let _renameState = null; // { oldName, draft, error } | null

export function _validateRename(draft, oldName, modelsConfig) {
  const trimmed = (draft || '').trim();
  if (!trimmed) return 'Name cannot be empty';
  if (trimmed === oldName) return null;
  if (modelsConfig[trimmed]) return `Model "${trimmed}" already exists`;
  return null;
}

function _promptRenameModel(oldName, modelsConfig, rerender) {
  _renameState = {
    oldName,
    draft: oldName,
    error: _validateRename(oldName, oldName, modelsConfig),
  };
  rerender();
  requestAnimationFrame(() => {
    document.getElementById('rename-model-dialog')?.show();
    document.getElementById('rename-model-input')?.focus?.();
  });
}

function _updateRenameDraft(value, modelsConfig, rerender) {
  if (!_renameState) return;
  _renameState.draft = value;
  _renameState.error = _validateRename(
    value,
    _renameState.oldName,
    modelsConfig,
  );
  rerender();
}

function _dismissRenameDialog(rerender) {
  document.getElementById('rename-model-dialog')?.hide();
  _renameState = null;
  rerender();
}

async function _commitRenameModel(modelsConfig, rerender) {
  if (!_renameState) return;
  const oldName = _renameState.oldName;
  const newName = (_renameState.draft || '').trim();
  if (_validateRename(newName, oldName, modelsConfig)) return;
  if (newName === oldName) {
    _dismissRenameDialog(rerender);
    return;
  }
  const source = _normalizeModelEntry(modelsConfig[oldName]);
  _modelsEditState.delete(newName);
  const putUrl = _settingsProjectId
    ? `/api/projects/${_settingsProjectId}/settings/model-env`
    : '/api/settings/model-env';
  const delUrl = _settingsProjectId
    ? `/api/projects/${_settingsProjectId}/settings/model-env?model=${encodeURIComponent(oldName)}`
    : `/api/settings/model-env?model=${encodeURIComponent(oldName)}`;
  saveStatus = 'saving';
  saveMessage = '';
  rerender();
  try {
    const putRes = await fetch(putUrl, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: newName,
        id: source.id,
        env: { ...source.env },
      }),
    });
    if (!putRes.ok) {
      const body = await putRes.json().catch(() => ({}));
      throw new Error(body.error || `HTTP ${putRes.status}`);
    }
    const delRes = await fetch(delUrl, { method: 'DELETE' });
    if (!delRes.ok) {
      const body = await delRes.json().catch(() => ({}));
      throw new Error(body.error || `HTTP ${delRes.status}`);
    }
    _modelsEditState.delete(oldName);
    saveStatus = 'success';
    saveMessage = `Renamed ${oldName} → ${newName}`;
    await loadSettings(_settingsProjectId);
  } catch (err) {
    saveStatus = 'error';
    saveMessage = `Failed to rename ${oldName}: ${err.message}`;
  }
  _dismissRenameDialog(rerender);
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

function _renameModelDialogTemplate(modelsConfig, rerender) {
  if (!_renameState) return nothing;
  const { oldName, draft, error } = _renameState;
  const trimmed = (draft || '').trim();
  const isUnchanged = trimmed === oldName;
  const confirmDisabled = Boolean(error) || isUnchanged;
  return html`
    <sl-dialog
      id="rename-model-dialog"
      label="Rename model"
      @sl-after-hide=${() => {
        if (_renameState) {
          _renameState = null;
          rerender();
        }
      }}
    >
      <p style="margin: 0 0 0.5rem">
        Rename <code>${oldName}</code> to:
      </p>
      <sl-input
        id="rename-model-input"
        class="rename-model-input ${error ? 'is-invalid' : ''}"
        size="small"
        value="${draft}"
        spellcheck="false"
        autocomplete="off"
        placeholder="new shorthand (e.g. alt-fast)"
        @sl-input=${(e) => _updateRenameDraft(e.target.value, modelsConfig, rerender)}
        @keydown=${(e) => {
          if (e.key === 'Enter' && !confirmDisabled) {
            e.preventDefault();
            _commitRenameModel(modelsConfig, rerender);
          }
        }}
      ></sl-input>
      ${error ? html`<p class="rename-model-error">${error}</p>` : nothing}
      <div
        slot="footer"
        style="display:flex; justify-content:flex-end; gap:0.5rem; width:100%"
      >
        <sl-button
          variant="default"
          @click=${() => _dismissRenameDialog(rerender)}
        >
          Cancel
        </sl-button>
        <sl-button
          variant="primary"
          ?disabled=${confirmDisabled}
          @click=${() => _commitRenameModel(modelsConfig, rerender)}
        >
          Rename
        </sl-button>
      </div>
    </sl-dialog>
  `;
}

async function _copyModelToClipboard(name, modelsConfig, rerender) {
  const source = _normalizeModelEntry(modelsConfig[name]);
  const text = encodeModelEnvelope({
    name,
    id: source.id,
    env: source.env,
  });
  try {
    if (!navigator.clipboard?.writeText) {
      throw new Error('Clipboard API unavailable');
    }
    await navigator.clipboard.writeText(text);
    saveStatus = 'success';
    const envCount = Object.keys(source.env).length;
    saveMessage =
      envCount > 0
        ? `Copied ${name} to clipboard (id + ${envCount} env ${envCount === 1 ? 'var' : 'vars'})`
        : `Copied ${name} to clipboard`;
  } catch (err) {
    saveStatus = 'error';
    saveMessage = `Failed to copy ${name}: ${err.message || 'clipboard write blocked'}`;
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

function _pasteInfoNoData(rerender) {
  showInfo(
    {
      label: 'No model data on the clipboard',
      message: html`
        <p>
          The clipboard didn't contain a worca model envelope. Use the
          <strong>Copy</strong> button on an existing model card to copy one,
          then click <strong>Paste</strong> again.
        </p>
      `,
    },
    rerender,
  );
}

function _pasteInfoPermissionDenied(rerender) {
  showInfo(
    {
      label: 'Clipboard access blocked',
      message: html`
        <p>
          Your browser blocked clipboard access. Allow clipboard read permission
          for this site in your browser settings, then try Paste again.
        </p>
      `,
    },
    rerender,
  );
}

function _pasteInfoUnsupported(rerender) {
  showInfo(
    {
      label: 'Paste not supported in this browser',
      message: html`
        <p>
          This browser doesn't expose clipboard reads to web pages (Firefox is
          the common case). Open
          <code>.claude/settings.local.json</code> directly to copy the model
          entry by hand.
        </p>
      `,
    },
    rerender,
  );
}

async function _pasteModelFromClipboard(modelsConfig, rerender) {
  if (!navigator.clipboard?.readText) {
    _pasteInfoUnsupported(rerender);
    return;
  }

  let text;
  try {
    text = await navigator.clipboard.readText();
  } catch (err) {
    if (err?.name === 'NotAllowedError') {
      _pasteInfoPermissionDenied(rerender);
    } else {
      _pasteInfoUnsupported(rerender);
    }
    return;
  }

  const decoded = decodeModelEnvelope(text);
  if (!decoded.ok) {
    _pasteInfoNoData(rerender);
    return;
  }

  const { name: rawName, id, env } = decoded.model;
  const existing = new Set(Object.keys(modelsConfig));
  let targetName = rawName;
  let renamed = false;
  if (existing.has(rawName)) {
    const next = _nextDuplicateName(rawName, existing);
    if (!next) {
      saveStatus = 'error';
      saveMessage = `Cannot paste "${rawName}" — no free numeric suffix slot.`;
      rerender();
      return;
    }
    targetName = next;
    renamed = true;
  }

  _modelsEditState.delete(targetName);

  const url = _settingsProjectId
    ? `/api/projects/${_settingsProjectId}/settings/model-env`
    : '/api/settings/model-env';
  saveStatus = 'saving';
  saveMessage = '';
  rerender();
  try {
    const res = await fetch(url, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: targetName,
        id: id || targetName,
        env: { ...env },
      }),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(body.error || `HTTP ${res.status}`);
    }
    saveStatus = 'success';
    saveMessage = renamed
      ? `Pasted ${rawName} as ${targetName} (name was taken)`
      : `Pasted ${targetName}`;
    await loadSettings(_settingsProjectId);
  } catch (err) {
    saveStatus = 'error';
    saveMessage = `Failed to paste ${targetName}: ${err.message}`;
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

function _promptDeleteModel(name, modelsConfig, rerender) {
  // After the W-051 storage split, any model with an id lives (at least
  // partially) in committed settings.json — deleting it means a write to
  // a tracked file.  Surface that explicitly instead of burying it in a
  // generic bullet list.
  const normalized = _normalizeModelEntry(modelsConfig[name]);
  const touchesCommittedFile = Boolean(normalized.id);

  showConfirm(
    {
      label: `Delete model "${name}"?`,
      message: html`
        <p>Deleting <strong>${name}</strong> will:</p>
        <ul style="margin: 0.5rem 0; padding-left: 1.2rem; line-height: 1.5">
          <li>
            Remove the model entry from
            <code>.claude/settings.local.json</code> (gitignored)${
              touchesCommittedFile
                ? html` and <code>.claude/settings.json</code> (committed)`
                : ''
            }.
          </li>
          <li>
            Discard the Model ID and all environment variables configured
            for this model.
          </li>
          <li>
            Cause any agent set to use <code>${name}</code> to fall back to
            opaque pass-through — the shorthand will be sent verbatim to
            <code>claude --model</code>, which may fail if the underlying CLI
            doesn't recognize the name.
          </li>
        </ul>
        ${
          touchesCommittedFile
            ? html`<p class="confirm-warning">
                <span aria-hidden="true">⚠</span>
                <span>
                  This <strong>modifies your committed
                  <code>.claude/settings.json</code></strong> on disk —
                  <code>${name}</code> will be removed without going through
                  git staging. Review with <code>git diff</code> before
                  committing.
                </span>
              </p>`
            : ''
        }
        <p class="confirm-warning">
          <span aria-hidden="true">⚠</span>
          <span>
            This action cannot be undone. You can re-add the model manually
            afterwards.
          </span>
        </p>
      `,
      confirmLabel: 'Delete',
      confirmVariant: 'danger',
      onConfirm: () => _deleteModel(name, modelsConfig, rerender),
    },
    rerender,
  );
}

async function _deleteModel(name, _modelsConfig, rerender) {
  // The server DELETE handler removes the model from BOTH settings.json
  // and settings.local.json. We then reload to refresh the merged view.
  _modelsEditState.delete(name);
  const url = _settingsProjectId
    ? `/api/projects/${_settingsProjectId}/settings/model-env?model=${encodeURIComponent(name)}`
    : `/api/settings/model-env?model=${encodeURIComponent(name)}`;
  saveStatus = 'saving';
  saveMessage = '';
  rerender();
  try {
    const res = await fetch(url, { method: 'DELETE' });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(body.error || `HTTP ${res.status}`);
    }
    saveStatus = 'success';
    saveMessage = `Deleted ${name}`;
    await loadSettings(_settingsProjectId);
  } catch (err) {
    saveStatus = 'error';
    saveMessage = `Failed to delete ${name}: ${err.message}`;
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

function _addModel(modelsConfig, rerender) {
  const nameEl = document.getElementById('new-model-name');
  const name = nameEl?.value?.trim();
  if (!name) return;
  if (modelsConfig[name]) {
    saveStatus = 'error';
    saveMessage = `Model "${name}" already exists`;
    rerender();
    return;
  }
  const idEl = document.getElementById('new-model-id');
  const id = idEl?.value?.trim() || name;
  const updated = { ...modelsConfig, [name]: { id, env: {} } };
  if (nameEl) nameEl.value = '';
  if (idEl) idEl.value = '';
  saveSettings({ worca: { models: updated } }, rerender);
}

function _modelEnvRowView(name, row, rerender) {
  const validationError = _envKeyValidationError(row.k);
  return html`
    <div class="model-env-row" data-row-id="${row._id}">
      <sl-input
        class="model-env-key ${validationError ? 'is-invalid' : ''}"
        title="${validationError || row.k || ''}"
        value="${row.k}"
        size="small"
        spellcheck="false"
        placeholder="KEY"
        @sl-input=${(e) => _updateEnvField(name, row._id, 'k', e.target.value, rerender)}
      ></sl-input>
      <sl-input
        class="model-env-value"
        value="${row.v}"
        size="small"
        spellcheck="false"
        placeholder="value"
        @sl-input=${(e) => _updateEnvField(name, row._id, 'v', e.target.value, rerender)}
      ></sl-input>
      ${
        validationError
          ? html`<sl-tooltip content="${validationError}">
              <span class="model-env-warn" aria-label="${validationError}">⚠</span>
            </sl-tooltip>`
          : html`<span class="model-env-warn-spacer"></span>`
      }
      <sl-tooltip content="Remove variable">
        <sl-button
          variant="text"
          size="small"
          class="model-env-remove"
          @click=${() => _removeEnvRow(name, row._id, rerender)}
        >
          ${unsafeHTML(iconSvg(Trash2, 13))}
        </sl-button>
      </sl-tooltip>
    </div>
  `;
}

function _modelCardView(name, serverEntryRaw, modelsConfig, rerender) {
  const entry = _normalizeModelEntry(serverEntryRaw);
  const state = _getOrInitModelState(name, entry);
  const isBuiltin = BUILTIN_MODEL_NAMES.has(name);
  const saveDisabled = _isCardSaveDisabled(name);
  const recentlySaved = _modelsRecentlySaved.has(name);
  const envCount = state.env.filter((r) => r.k.trim() !== '').length;
  const invalidCount = state.env.filter(
    (r) => _envKeyValidationError(r.k) !== null,
  ).length;
  const envExpanded = state.envExpanded;

  return html`
    <div
      class="settings-card model-card ${state.dirty ? 'is-dirty' : ''}"
      data-model-card="${name}"
    >
      <div class="settings-card-header">
        <span class="settings-card-title">${name}</span>
        <sl-badge variant="${isBuiltin ? 'neutral' : 'primary'}" pill>
          ${isBuiltin ? 'built-in' : 'custom'}
        </sl-badge>
      </div>
      <div class="settings-card-body">
        <div class="settings-field">
          <label class="settings-label">Model ID</label>
          <sl-input
            class="model-id-input"
            value="${state.id}"
            size="small"
            spellcheck="false"
            placeholder="full model ID"
            @sl-input=${(e) => _updateModelId(name, e.target.value)}
          ></sl-input>
        </div>

        <sl-details
          class="model-env-details ${invalidCount > 0 ? 'has-invalid' : ''}"
          ?open=${envExpanded}
          @sl-show=${() => _toggleEnvExpanded(name, true, rerender)}
          @sl-hide=${() => _toggleEnvExpanded(name, false, rerender)}
        >
          <div slot="summary" class="model-env-summary">
            <span class="settings-label">Environment Variables</span>
            ${
              invalidCount > 0
                ? html`<span class="model-env-invalid-chip"
                    >${invalidCount}
                    ${invalidCount === 1 ? 'invalid' : 'invalid'}</span
                  >`
                : html`<span class="settings-muted-small"
                    >${envCount} ${envCount === 1 ? 'var' : 'vars'}</span
                  >`
            }
          </div>

          ${
            state.env.length > 0
              ? html`<div class="model-env-table">
                  ${state.env.map((row) => _modelEnvRowView(name, row, rerender))}
                </div>`
              : nothing
          }

          <sl-button
            variant="text"
            size="small"
            class="model-env-add-btn"
            @click=${() => _addEnvRow(name, rerender)}
          >
            ${unsafeHTML(iconSvg(Plus, 12))}
            Add variable
          </sl-button>
        </sl-details>
      </div>

      <div class="model-card-actions">
        <sl-tooltip content="Rename this model's shorthand">
          <sl-button
            variant="default"
            size="small"
            class="model-rename-btn"
            @click=${() => _promptRenameModel(name, modelsConfig, rerender)}
          >
            ${unsafeHTML(iconSvg(Pencil, 12))}
            Rename
          </sl-button>
        </sl-tooltip>
        <sl-tooltip content="Duplicate this model with all its env vars">
          <sl-button
            variant="default"
            size="small"
            class="model-duplicate-btn"
            @click=${() => _duplicateModel(name, modelsConfig, rerender)}
          >
            ${unsafeHTML(iconSvg(Copy, 12))}
            Duplicate
          </sl-button>
        </sl-tooltip>
        <sl-tooltip
          content="Copy this model (id + env vars) to the clipboard. The clipboard may persist via OS clipboard history — be mindful with secret values."
        >
          <sl-button
            variant="default"
            size="small"
            class="model-copy-btn"
            @click=${() => _copyModelToClipboard(name, modelsConfig, rerender)}
          >
            ${unsafeHTML(iconSvg(ClipboardCopy, 12))}
            Copy
          </sl-button>
        </sl-tooltip>
        <sl-button
          variant="danger"
          size="small"
          class="model-delete-btn"
          @click=${() => _promptDeleteModel(name, modelsConfig, rerender)}
        >
          ${unsafeHTML(iconSvg(Trash2, 12))}
          Delete
        </sl-button>
        <span
          class="model-card-status ${recentlySaved && !state.dirty ? 'model-card-status--saved' : ''}"
        >
          ${state.dirty ? 'Unsaved changes' : recentlySaved ? 'Saved' : ''}
        </span>
        <sl-button
          variant="default"
          size="small"
          ?disabled=${!state.dirty}
          @click=${() => _discardModelEdits(name, rerender)}
        >
          Discard
        </sl-button>
        <sl-button
          variant="primary"
          size="small"
          ?disabled=${saveDisabled}
          @click=${() => _saveModelEnv(name, rerender)}
        >
          ${unsafeHTML(iconSvg(Save, 12))}
          Save
        </sl-button>
      </div>
    </div>
  `;
}

export function modelsTab(worca, rerender) {
  const modelsConfig = worca?.models || {};
  const modelKeys = getModelKeys(worca);

  return html`
    <div class="settings-tab-content">
      <h3 class="settings-section-title">Models</h3>
      <p class="settings-tab-description">
        Per-model environment variables are stored in
        <code>.claude/settings.local.json</code> (gitignored). Use them to route
        a single agent through an alternative endpoint, tune timeouts, or set
        provider-specific overrides. The built-in <code>opus</code>,
        <code>sonnet</code>, and <code>haiku</code> entries are always surfaced
        as defaults — deleting all of them simply restores them on the next load.
      </p>
      <div class="settings-cards models-cards">
        ${modelKeys.map((name) =>
          _modelCardView(name, modelsConfig[name], modelsConfig, rerender),
        )}
      </div>

      <div class="settings-field models-add-row">
        <label class="settings-label">Add Model</label>
        <div class="models-add-controls">
          <sl-input
            id="new-model-name"
            size="small"
            placeholder="shorthand (e.g. alt-fast)"
          ></sl-input>
          <sl-input
            id="new-model-id"
            size="small"
            placeholder="full model ID"
          ></sl-input>
          <sl-button
            variant="default"
            size="small"
            @click=${() => _addModel(modelsConfig, rerender)}
          >
            ${unsafeHTML(iconSvg(Plus, 14))}
            Add
          </sl-button>
          <sl-tooltip
            content="Paste a model that was copied from another project. On name collision, the pasted model gets a numeric suffix (same as Duplicate)."
          >
            <sl-button
              variant="default"
              size="small"
              class="model-paste-btn"
              @click=${() => _pasteModelFromClipboard(modelsConfig, rerender)}
            >
              ${unsafeHTML(iconSvg(ClipboardPaste, 14))}
              Paste
            </sl-button>
          </sl-tooltip>
        </div>
      </div>

      <div class="settings-tab-actions">
        <sl-button
          variant="default"
          size="small"
          outline
          @click=${() => confirmReset('models', rerender)}
        >
          ${unsafeHTML(iconSvg(RefreshCw, 14))}
          Reset all
        </sl-button>
      </div>
      ${_renameModelDialogTemplate(modelsConfig, rerender)}
    </div>
  `;
}

const _AUTO_MODE_HINTS = {
  disabled: 'Per-agent effort only; no runtime escalation on loopbacks.',
  reactive:
    'Per-agent effort as starting point; escalates on test failures and review bounces.',
  adaptive:
    'Coordinator classifies per-bead effort; escalates on loopbacks. Explicit per-agent values override.',
};

function _confirmMaxEffort(selectEl, previousValue, rerender) {
  showConfirm(
    {
      label: 'Confirm max effort',
      message: html`Setting effort to <strong>max</strong> significantly
        increases token consumption and cost. Continue?`,
      confirmLabel: 'Use max',
      confirmVariant: 'warning',
      onConfirm: () => {},
      onCancel: () => {
        selectEl.value = previousValue;
      },
    },
    rerender,
  );
}

export function effortTab(worca, rerender) {
  const effort = worca.effort || {};
  const agents = worca.agents || {};
  const autoMode = effort.auto_mode || 'adaptive';
  const autoCap = effort.auto_cap || 'xhigh';

  return html`
    <div class="settings-tab-content">
      ${TEMPLATE_DRIVEN_BANNER}
      <h3 class="settings-section-title">Effort Mode</h3>
      <div class="settings-grid">
        <div class="settings-field">
          <label class="settings-label">Auto Mode</label>
          <sl-select
            id="effort-auto-mode"
            .value="${autoMode}"
            size="small"
            hoist
          >
            ${AUTO_MODES.map(
              (m) => html`<sl-option value="${m}">${m}</sl-option>`,
            )}
          </sl-select>
          <span class="settings-field-hint"
            >${_AUTO_MODE_HINTS[autoMode] || ''}</span
          >
        </div>
        <div class="settings-field">
          <label class="settings-label">Auto Cap</label>
          <sl-select
            id="effort-auto-cap"
            .value="${autoCap}"
            size="small"
            hoist
            @sl-change=${(e) => {
              if (e.target.value === 'max') {
                _confirmMaxEffort(e.target, autoCap, rerender);
              }
            }}
          >
            ${EFFORT_LEVELS.map(
              (l) => html`<sl-option value="${l}">${l}</sl-option>`,
            )}
          </sl-select>
          <span class="settings-field-hint"
            >Ceiling for runtime-resolved effort levels</span
          >
        </div>
      </div>

      <h3 class="settings-section-title">Per-Agent Effort</h3>
      <div class="effort-agent-table">
        <table class="effort-table">
          <thead>
            <tr>
              <th>Agent</th>
              <th>Effort</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            ${AGENT_NAMES.map((name) => {
              const agentCfg = agents[name] || {};
              const currentEffort = agentCfg.effort || '';
              const hasExplicit = Boolean(agentCfg.effort);
              return html`
                <tr>
                  <td class="effort-agent-name">${name}</td>
                  <td>
                    <sl-select
                      id="effort-agent-${name}"
                      .value="${currentEffort}"
                      size="small"
                      hoist
                      @sl-change=${(e) => {
                        if (e.target.value === 'max') {
                          _confirmMaxEffort(e.target, currentEffort, rerender);
                        }
                      }}
                    >
                      <sl-option value="">(unset)</sl-option>
                      ${EFFORT_LEVELS.map(
                        (l) => html`<sl-option value="${l}">${l}</sl-option>`,
                      )}
                    </sl-select>
                  </td>
                  <td>
                    ${
                      !hasExplicit
                        ? html`<span
                            class="effort-inherit-hint settings-muted-small"
                            >inherits from auto mode</span
                          >`
                        : nothing
                    }
                  </td>
                </tr>
              `;
            })}
          </tbody>
        </table>
      </div>

      <div class="settings-tab-actions">
        <sl-button
          variant="primary"
          size="small"
          @click=${() => {
            const {
              auto_mode,
              auto_cap,
              agents: agentEfforts,
            } = readEffortFromDom();
            saveSettings(
              {
                worca: {
                  effort: { auto_mode, auto_cap },
                  agents: agentEfforts,
                },
              },
              rerender,
            );
          }}
        >
          ${unsafeHTML(iconSvg(Save, 14))}
          Save
        </sl-button>
        <sl-button
          variant="default"
          size="small"
          outline
          @click=${() => confirmReset('effort', rerender)}
        >
          ${unsafeHTML(iconSvg(RefreshCw, 14))}
          Reset
        </sl-button>
      </div>
    </div>
  `;
}

function pricingTab(worca, rerender) {
  const pricing = worca.pricing || {};
  const serverTools = pricing.server_tools || {};
  // Budget moved here from the Webhooks tab — Max Cost is a
  // pipeline-halt threshold (a cost circuit breaker), and Warning
  // Threshold emits a `cost.budget_warning` event at that
  // percentage of max. Both are project cost policy.
  const budget = worca.budget || {};

  return html`
    <div class="settings-tab-content">
      <sl-alert variant="neutral" open class="costs-budgets-models-link">
        <strong>Per-model pricing moved.</strong>
        Each model alias now carries its own pricing rates — edit them in the
        <a href="#" @click=${(e) => {
          e.preventDefault();
          window.location.hash = '#/models';
        }}>Models</a> page (open a card → Pricing accordion).
      </sl-alert>

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

      <h3 class="settings-section-title">Server tool pricing</h3>
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

      <sl-alert variant="neutral" open class="pricing-source-note">
        <strong>When are these rates applied?</strong>
        Only for model aliases whose <code>env</code> block in
        <code>worca.models</code> sets <code>ANTHROPIC_BASE_URL</code>
        (i.e. routes Claude CLI to a non-Anthropic endpoint). For runs against
        the default Anthropic endpoint — including the built-in
        <code>opus</code>, <code>sonnet</code>, and <code>haiku</code>
        shorthands — Claude CLI's own cost is the source of truth; the rates
        above are kept as a fallback for runs that end without a reported cost.
      </sl-alert>

      <div class="pricing-info">
        <span class="settings-muted">Currency: ${pricing.currency || 'USD'}</span>
        <span class="settings-muted">Last updated: ${pricing.last_updated || 'N/A'}</span>
      </div>

      <div class="settings-tab-actions">
        <sl-button variant="primary" size="small" @click=${() => {
          const pricingData = readPricingFromDom();
          const budgetData = readBudgetFromDom();
          saveSettings(
            { worca: { pricing: pricingData, budget: budgetData } },
            rerender,
          );
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
          const webhooksConfig = readWebhooksFromDom();
          saveSettings(
            {
              worca: {
                events: eventsConfig,
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

// --- Migration banner ---

async function triggerMigration(rerender) {
  saveStatus = 'saving';
  saveMessage = '';
  rerender();
  try {
    const res = await fetch(settingsUrl(_settingsProjectId), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ worca: {} }),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const result = await res.json();
    settingsData = { worca: result.worca, permissions: result.permissions };
    _migrationNeeded = false;
    _migrationDismissed = true;
    const n = countMigrated(result.autoMigrated);
    saveStatus = 'success';
    saveMessage =
      n > 0
        ? `${n} project setting${n === 1 ? ' was' : 's were'} moved to global Preferences`
        : 'Settings saved successfully';
  } catch (err) {
    saveStatus = 'error';
    saveMessage = `Migration failed: ${err.message}`;
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

function migrationBanner(rerender) {
  if (!_migrationNeeded || _migrationDismissed) return nothing;
  return html`
    <sl-alert variant="warning" open class="migration-banner">
      <strong>Legacy project settings detected.</strong>
      Some settings in this project belong in global Preferences.
      <sl-button
        size="small"
        variant="warning"
        outline
        style="margin-left: 8px;"
        @click=${() => triggerMigration(rerender)}
      >Migrate now</sl-button>
    </sl-alert>
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
    globals,
    onSaveGlobals,
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
          ${helpFor('add-project')}
        </sl-tab>
        <sl-tab slot="nav" panel="notifications">
          ${unsafeHTML(iconSvg(Bell, 14))}
          Notifications
          ${helpFor('events')}
        </sl-tab>
        <sl-tab slot="nav" panel="preferences">
          ${unsafeHTML(iconSvg(Settings, 14))}
          Preferences
          ${helpFor('settings-overview')}
        </sl-tab>
        <sl-tab slot="nav" panel="integrations">
          ${unsafeHTML(iconSvg(Zap, 14))}
          Integrations
          ${helpFor('chat')}
        </sl-tab>

        <sl-tab-panel name="projects">${projectsTab(projects, { onProjectAdd, onProjectRemove, onProjectsRefresh, rerender })}</sl-tab-panel>
        <sl-tab-panel name="notifications">${notificationsTab(preferences, { rerender, onSaveNotifications, onRequestPermission })}</sl-tab-panel>
        <sl-tab-panel name="preferences">${preferencesTab(preferences, { onThemeToggle, onSaveSourceRepo, onSaveGlobals, rerender, globals })}</sl-tab-panel>
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
    ${migrationBanner(rerender)}
    ${confirmDialogTemplate()}
    <div class="settings-page">
      <sl-tab-group>
        <!--
          Tab structure after W-062 Phase 6 option-B cleanup:
          template-driven keys (agents, effort, the stages/loops/
          circuit_breaker portions of pipeline, governance.dispatch)
          moved out of Project Settings entirely — they're owned by
          the selected template now, edited via the Templates page.
          The Agents and Effort tabs are gone; Pipeline keeps only
          its cross-template content (preflight, milestones, parallel,
          guide, fleet, defaults); Governance keeps only its hook
          guards (dispatch was the template-driven half).
        -->
        <!--
          Models tab removed — model alias management moved to the new
          top-level Models page so it can show all 3 tiers (builtin /
          user / project) in one place, the way Pipeline Templates does.
          Per-model pricing is now co-located on each model's editor page.
        -->
        <sl-tab slot="nav" panel="pipeline">
          ${unsafeHTML(iconSvg(Workflow, 14))}
          Pipeline
          ${helpFor('stages-config')}
        </sl-tab>
        <sl-tab slot="nav" panel="governance">
          ${unsafeHTML(iconSvg(Shield, 14))}
          Governance
          ${helpFor('governance')}
        </sl-tab>
        <sl-tab slot="nav" panel="pricing">
          ${unsafeHTML(iconSvg(Coins, 14))}
          Costs & Budgets
          ${helpFor('models')}
        </sl-tab>
        <sl-tab slot="nav" panel="webhooks">
          ${unsafeHTML(iconSvg(Zap, 14))}
          Webhooks
          ${helpFor('webhooks')}
        </sl-tab>
        <sl-tab slot="nav" panel="graphify">
          ${unsafeHTML(iconSvg(Database, 14))}
          Graphify
          ${helpFor('graphify')}
        </sl-tab>
        <sl-tab slot="nav" panel="code-review-graph">
          ${unsafeHTML(iconSvg(Search, 14))}
          Code Review Graph
          ${helpFor('crg')}
        </sl-tab>

        <sl-tab-panel name="pipeline">${pipelineTab(worca, rerender)}</sl-tab-panel>
        <sl-tab-panel name="governance">${governanceTab(worca, permissions, rerender)}</sl-tab-panel>
        <sl-tab-panel name="pricing">${pricingTab(worca, rerender)}</sl-tab-panel>
        <sl-tab-panel name="webhooks">${webhooksTab(worca, rerender)}</sl-tab-panel>
        <sl-tab-panel name="graphify">${graphifyTab(worca, rerender, _settingsProjectId)}</sl-tab-panel>
        <sl-tab-panel name="code-review-graph">${crgTab(worca, rerender, _settingsProjectId)}</sl-tab-panel>
      </sl-tab-group>
    </div>
  `;
}

// Test-only exports
export { preferencesTab as _preferencesTab };
export { projectsTab as _projectsTab };
export function _getMigrationNeeded() {
  return _migrationNeeded;
}
