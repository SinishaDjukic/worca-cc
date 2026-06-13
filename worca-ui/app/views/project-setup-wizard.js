/**
 * Project Setup Wizard (W-073).
 *
 * A 5-step dialog that configures a handful of worca settings keys after a
 * project (or workspace) is added, and is re-triggerable from Settings:
 *
 *   1. Preflight        — read-only diagnostics (git, base branch, tools)
 *   2. PR Base Branch   — confirm/edit the detected base branch
 *   3. Optional Tools   — enable graphify / CRG (or show install command)
 *   4. Default Template — pick a default pipeline template
 *   5. Complete         — summary + non-blocking notifications hint
 *
 * UI-only: every step writes through the server setup endpoints
 * (`/api/projects/:id/setup/*` for single projects,
 * `/api/workspaces/:name/setup/*` for workspaces). No CLI or Python changes.
 *
 * State is module-level (mirrors other stateless lit-html views in this app):
 * `openProjectSetupWizard()` seeds it and kicks off the preflight fetch,
 * `projectSetupWizardView()` renders it, `closeProjectSetupWizard()` tears down.
 */

import { html, nothing } from 'lit-html';
import { ref } from 'lit-html/directives/ref.js';
import { unsafeHTML } from 'lit-html/directives/unsafe-html.js';
import {
  ArrowLeft,
  ArrowRight,
  Bell,
  CircleCheck,
  CircleSlash,
  Download,
  iconSvg,
} from '../utils/icons.js';
import { crgInstallCommand } from './settings-code-review-graph.js';
import { graphifyInstallCommand } from './settings-graphify.js';

// Action-statement title per step key. The active step sequence is built
// dynamically (the 'install' step only appears when worca isn't installed).
const STEP_META = {
  preflight: 'Your Project Environment',
  install: 'Install Worca',
  branch: 'Set PR Base Branch',
  tools: 'Enable Optional Tools',
  template: 'Set Default Template',
  complete: "You're All Set",
};

/**
 * Build the active step sequence. The install step is inserted right after
 * preflight when worca isn't installed in a single project — without the
 * runtime there are no built-in templates to choose, so we offer to install
 * it inline rather than dead-ending the template step. Computed once at
 * preflight load so the sequence (and step indices) stay stable even after the
 * user installs mid-wizard.
 */
function _buildSteps({ isWorkspace, worcaInstalled }) {
  const needsInstall = !isWorkspace && !worcaInstalled;
  return [
    'preflight',
    ...(needsInstall ? ['install'] : []),
    'branch',
    'tools',
    'template',
    'complete',
  ];
}

// null when closed; otherwise the live wizard state object.
let _state = null;

/** Test/introspection helper. */
export function _getWizardState() {
  return _state;
}

function _preflightUrl(s) {
  return s.isWorkspace
    ? `/api/workspaces/${encodeURIComponent(s.target)}/setup/preflight`
    : `/api/projects/${encodeURIComponent(s.target)}/setup/preflight`;
}

function _applyUrl(s) {
  return s.isWorkspace
    ? `/api/workspaces/${encodeURIComponent(s.target)}/setup/apply`
    : `/api/projects/${encodeURIComponent(s.target)}/setup/apply`;
}

async function _applyPatch(s, patch) {
  try {
    const res = await fetch(_applyUrl(s), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patch),
    });
    return await res.json();
  } catch {
    return { ok: false };
  }
}

/**
 * Open the wizard for a project (single) or workspace.
 * @param {object} opts
 * @param {string} opts.target - project name (single) or workspace name
 * @param {boolean} [opts.isWorkspace]
 * @param {number} [opts.projectCount]
 * @param {Function} rerender
 */
export function openProjectSetupWizard(
  { target, isWorkspace = false, projectCount = 1 } = {},
  rerender,
) {
  _state = {
    step: 1,
    // Sequence of step keys; finalized once preflight resolves. Until then a
    // sensible default keeps the indicator from flashing.
    steps: ['preflight', 'branch', 'tools', 'template', 'complete'],
    isWorkspace,
    target,
    projectCount,
    loading: true,
    error: null,
    preflight: null,
    worcaInstalled: true,
    installing: false,
    baseBranch: '',
    graphifyEnabled: false,
    crgEnabled: false,
    templateSel: null,
    templates: null,
    // Whether any chat integration is configured — gates the notify card on the
    // final step. Assume true until the fetch resolves so the card never flashes.
    hasIntegrations: true,
    applied: { baseBranch: null, graphify: null, crg: null, template: null },
  };
  _fetchPreflight(rerender);
  _fetchIntegrations(rerender);
}

const INTEGRATION_ADAPTERS = ['telegram', 'discord', 'slack', 'generic'];

// Detect whether any chat integration is configured (~/.worca/integrations).
async function _fetchIntegrations(rerender) {
  const s = _state;
  if (!s) return;
  try {
    const cfg = await fetch('/api/integrations/config').then((r) => r.json());
    if (!_state || _state !== s) return;
    s.hasIntegrations = INTEGRATION_ADAPTERS.some((k) => cfg?.[k]);
    rerender?.();
  } catch {
    /* leave hasIntegrations as-is (assume configured → hide the nudge) */
  }
}

// Close the wizard and land on global Settings → Integrations.
function _goToIntegrations(rerender) {
  closeProjectSetupWizard(rerender);
  window.location.hash = '#/settings';
  // The settings page may need a frame to mount; poll briefly for its tab group.
  const activate = (tries = 0) => {
    const tg = document.querySelector('.settings-page sl-tab-group');
    if (tg && typeof tg.show === 'function') {
      tg.show('integrations');
      return;
    }
    if (tries < 30) requestAnimationFrame(() => activate(tries + 1));
  };
  requestAnimationFrame(() => activate());
}

/** Step key at the current 1-based position. */
function _curKey(s) {
  return s.steps[s.step - 1];
}

export function closeProjectSetupWizard(rerender) {
  _state = null;
  rerender?.();
  // Notify the app so it can refresh the projects table — the install step may
  // have changed a project's worca version. One listener in main.js handles it.
  try {
    window.dispatchEvent(new CustomEvent('worca:setup-closed'));
  } catch {
    /* no window (non-browser) — nothing to refresh */
  }
}

async function _fetchPreflight(rerender) {
  const s = _state;
  if (!s) return;
  s.loading = true;
  rerender?.();
  try {
    const res = await fetch(_preflightUrl(s));
    const data = await res.json();
    if (!_state || _state !== s) return; // wizard closed/reopened mid-flight
    if (!data.ok) {
      s.error = data.error || 'Failed to load setup preflight';
      s.loading = false;
      rerender?.();
      return;
    }
    s.preflight = data;
    s.worcaInstalled = s.isWorkspace ? true : Boolean(data.worcaInstalled);
    // Finalize the step sequence now that we know whether worca is installed.
    // Preserve the current key across the rebuild so an in-flight recheck
    // doesn't snap the user to a different step.
    const prevKey = _curKey(s);
    s.steps = _buildSteps(s);
    const idx = s.steps.indexOf(prevKey);
    if (idx >= 0) s.step = idx + 1;
    // Seed editable values. Re-running the wizard pre-populates from current
    // settings; first run falls back to the detected base branch.
    if (s.isWorkspace) {
      if (typeof data.projectCount === 'number')
        s.projectCount = data.projectCount;
      s.baseBranch = _dominantBaseBranch(data.projects) || 'main';
      const anyGraphify = (data.projects || []).some(
        (p) => p.currentSettings?.graphifyEnabled,
      );
      const anyCrg = (data.projects || []).some(
        (p) => p.currentSettings?.crgEnabled,
      );
      s.graphifyEnabled = anyGraphify;
      s.crgEnabled = anyCrg;
      s.templates = (data.templates || []).filter((t) => t.tier !== 'project');
      const dt = _firstDefaultTemplate(data.projects);
      // Drop a saved default that no longer resolves to an available template
      // (orphaned/legacy pointer) so the dropdown shows "No default" instead
      // of rendering blank.
      s.templateSel =
        dt && s.templates.some((t) => _sameTemplate(t, dt)) ? dt : null;
    } else {
      const cur = data.currentSettings || {};
      s.baseBranch = cur.baseBranch || data.baseBranch || 'main';
      s.graphifyEnabled = Boolean(cur.graphifyEnabled);
      s.crgEnabled = Boolean(cur.crgEnabled);
      s.templateSel = _normalizeTemplatePointer(cur.defaultTemplate);
    }
    s.loading = false;
    rerender?.();
    if (!s.isWorkspace) _fetchTemplates(rerender);
  } catch (err) {
    if (!_state || _state !== s) return;
    s.error = err?.message || 'Network error';
    s.loading = false;
    rerender?.();
  }
}

async function _fetchTemplates(rerender) {
  const s = _state;
  if (!s || s.isWorkspace) return;
  try {
    const res = await fetch(
      `/api/projects/${encodeURIComponent(s.target)}/templates`,
    );
    const data = await res.json();
    if (!_state || _state !== s) return;
    s.templates = data.templates || [];
    // Reconcile a seeded default against the catalog — an orphaned/legacy
    // pointer (id not present) resets to "No default" so the dropdown renders.
    if (
      s.templateSel &&
      !s.templates.some((t) => _sameTemplate(t, s.templateSel))
    ) {
      s.templateSel = null;
    }
    rerender?.();
  } catch {
    if (_state === s) {
      s.templates = [];
      rerender?.();
    }
  }
}

function _dominantBaseBranch(projects) {
  const counts = {};
  for (const p of projects || []) {
    const b = p.baseBranch;
    if (b) counts[b] = (counts[b] || 0) + 1;
  }
  let best = null;
  let bestN = 0;
  for (const [b, n] of Object.entries(counts)) {
    if (n > bestN) {
      best = b;
      bestN = n;
    }
  }
  return best;
}

function _firstDefaultTemplate(projects) {
  for (const p of projects || []) {
    const dt = _normalizeTemplatePointer(p.currentSettings?.defaultTemplate);
    if (dt) return dt;
  }
  return null;
}

// `worca.default_template` is canonically { tier, id }. Tolerate a bare string
// id (legacy) by treating it as tier-agnostic.
function _normalizeTemplatePointer(dt) {
  if (!dt) return null;
  if (typeof dt === 'string') return { tier: null, id: dt };
  if (typeof dt.id === 'string') return { tier: dt.tier ?? null, id: dt.id };
  return null;
}

function _sameTemplate(a, b) {
  if (!a || !b) return false;
  return (
    a.id === b.id && (a.tier == null || b.tier == null || a.tier === b.tier)
  );
}

// ─── Navigation ────────────────────────────────────────────────────────────

function _goto(step, rerender) {
  if (!_state) return;
  _state.step = Math.max(1, Math.min(_state.steps.length, step));
  rerender();
}

function _next(rerender) {
  if (_state) _goto(_state.step + 1, rerender);
}

async function _applyBaseBranchAndNext(rerender) {
  const s = _state;
  if (!s) return;
  const branch = (s.baseBranch || '').trim();
  if (branch) {
    const r = await _applyPatch(s, { baseBranch: branch });
    s.applied.baseBranch = r.ok ? branch : null;
  }
  _next(rerender);
}

async function _toggleTool(which, enabled, rerender) {
  const s = _state;
  if (!s) return;
  if (which === 'graphify') {
    s.graphifyEnabled = enabled;
    const r = await _applyPatch(s, { graphifyEnabled: enabled });
    s.applied.graphify = r.ok ? enabled : null;
  } else {
    s.crgEnabled = enabled;
    const r = await _applyPatch(s, { crgEnabled: enabled });
    s.applied.crg = r.ok ? enabled : null;
  }
  rerender();
}

async function _applyTemplateAndNext(rerender) {
  const s = _state;
  if (!s) return;
  const sel = s.templateSel;
  const patch = sel
    ? { template: { tier: sel.tier, id: sel.id } }
    : { template: null };
  const r = await _applyPatch(s, patch);
  s.applied.template = r.ok ? (sel ? sel.id : '__none__') : null;
  _next(rerender);
}

/**
 * Install worca into the project (single-project install step). Spawns
 * `worca init --upgrade` server-side, then polls preflight until the runtime
 * appears so built-in templates become selectable. Best-effort with a timeout.
 */
async function _installWorca(rerender) {
  const s = _state;
  if (!s || s.installing) return;
  s.installing = true;
  s.installError = null;
  rerender();
  try {
    const res = await fetch(
      `/api/projects/${encodeURIComponent(s.target)}/worca-setup`,
      { method: 'POST' },
    );
    const data = await res.json().catch(() => ({}));
    if (data.ok === false) throw new Error(data.error || 'install failed');
    // Poll preflight until the runtime is detected (worca init is async).
    for (let i = 0; i < 20; i++) {
      await new Promise((r) => setTimeout(r, 1500));
      if (!_state || _state !== s) return;
      const pf = await fetch(_preflightUrl(s))
        .then((r) => r.json())
        .catch(() => null);
      if (pf?.worcaInstalled) {
        s.worcaInstalled = true;
        s.preflight = { ...s.preflight, worcaInstalled: true };
        break;
      }
    }
    if (!_state || _state !== s) return;
    s.installing = false;
    if (s.worcaInstalled) {
      _fetchTemplates(rerender); // built-in templates now exist
    } else {
      s.installError =
        'Install is taking longer than expected — check the project and try again.';
    }
    rerender();
  } catch (err) {
    if (_state !== s) return;
    s.installing = false;
    s.installError = err?.message || 'Install failed';
    rerender();
  }
}

async function _recheckTools(rerender) {
  const s = _state;
  if (!s) return;
  // Invalidate the shared detection caches, then re-pull the preflight.
  const q = s.isWorkspace ? '' : `?project=${encodeURIComponent(s.target)}`;
  await Promise.allSettled([
    fetch(`/api/graphify/recheck${q}`, { method: 'POST' }),
    fetch(`/api/crg/recheck${q}`, { method: 'POST' }),
  ]);
  // Preserve in-flight edits across the refetch.
  const keep = {
    baseBranch: s.baseBranch,
    templateSel: s.templateSel,
    applied: s.applied,
  };
  await _fetchPreflight(rerender);
  // Only restore if this is still the same wizard run — a close+reopen for a
  // different project during the refetch must not be clobbered with stale edits.
  // _fetchPreflight already preserved the current step key (tools), so don't
  // touch s.step here.
  if (_state === s) {
    _state.baseBranch = keep.baseBranch;
    _state.templateSel = keep.templateSel;
    _state.applied = keep.applied;
    rerender();
  }
}

// ─── Render ──────────────────────────────────────────────────────────────

function _stepIndicator(s) {
  const step = s.step;
  const total = s.steps.length;
  const dots = [];
  for (let i = 1; i <= total; i++) {
    const cls =
      i < step
        ? 'wizard-dot done'
        : i === step
          ? 'wizard-dot active'
          : 'wizard-dot';
    dots.push(
      html`<span class="${cls}" data-step="${i}">${
        i < step ? unsafeHTML(iconSvg(CircleCheck, 14)) : i
      }</span>`,
    );
    if (i < total) {
      dots.push(
        html`<span class="wizard-dot-line ${i < step ? 'done' : ''}"></span>`,
      );
    }
  }
  return html`
    <div class="wizard-steps">
      <div class="wizard-dots">${dots}</div>
      <div class="wizard-step-title">${STEP_META[_curKey(s)]}</div>
    </div>
  `;
}

function _checkRow(ok, label, detail) {
  return html`
    <div class="wizard-check ${ok ? 'ok' : 'no'}">
      <span class="wizard-check-icon">${unsafeHTML(
        iconSvg(ok ? CircleCheck : CircleSlash, 16),
      )}</span>
      <span class="wizard-check-label">${label}</span>
      ${detail ? html`<span class="wizard-check-detail">· ${detail}</span>` : nothing}
    </div>
  `;
}

function _preflightStep(s) {
  const pf = s.preflight || {};
  if (s.isWorkspace) {
    const onMain = (pf.projects || []).filter(
      (p) => p.baseBranch === 'main',
    ).length;
    return html`
      <p class="wizard-intro">Checked ${s.projectCount} project${
        s.projectCount === 1 ? '' : 's'
      } in this workspace.</p>
      ${_checkRow(true, 'Workspace projects', `${pf.projectCount ?? 0}`)}
      ${_checkRow(
        true,
        'Base branches',
        `${onMain}/${pf.projectCount ?? 0} on main`,
      )}
      ${_checkRow(pf.graphifyInstalled, 'Graphify', pf.graphifyInstalled ? 'installed' : 'not installed')}
      ${_checkRow(pf.crgInstalled, 'CRG', pf.crgInstalled ? 'installed' : 'not installed')}
    `;
  }
  return html`
    ${_checkRow(pf.isGitRepo, 'Git repository', pf.isGitRepo ? 'detected' : 'not a git repo')}
    ${_checkRow(s.worcaInstalled, 'Worca runtime', s.worcaInstalled ? 'installed' : 'not installed')}
    ${_checkRow(true, 'PR base branch', pf.baseBranch)}
    ${_checkRow(pf.graphifyInstalled, 'Graphify', pf.graphifyInstalled ? 'installed' : 'not installed')}
    ${_checkRow(pf.crgInstalled, 'CRG', pf.crgInstalled ? 'installed' : 'not installed')}
  `;
}

function _installStep(s, rerender) {
  if (s.worcaInstalled) {
    return html`
      <div class="wizard-install-done">
        <span class="wizard-check-icon">${unsafeHTML(iconSvg(CircleCheck, 18))}</span>
        <div>
          <strong>Worca is installed.</strong>
          <div class="wizard-hint">
            Built-in pipeline templates are now available in the next steps.
          </div>
        </div>
      </div>
    `;
  }
  // worca init requires a git repository (it scaffolds .claude/ itself, but
  // bails if there's no .git). Block the install and tell the user.
  if (s.preflight && !s.preflight.isGitRepo) {
    return html`
      <p class="wizard-intro">
        This project doesn't have the worca runtime yet.
      </p>
      <div class="wizard-error">
        Worca requires a git repository. Run <code>git init</code> in this
        project first, then re-open setup to install.
      </div>
    `;
  }
  return html`
    <p class="wizard-intro">
      This project doesn't have the worca runtime yet. Installing it adds the
      pipeline files and the built-in templates you'll pick from next.
    </p>
    ${
      s.installError
        ? html`<div class="wizard-error">${s.installError}</div>`
        : nothing
    }
    <div class="wizard-install-action">
      <sl-button
        class="wizard-install-btn"
        variant="primary"
        ?loading=${s.installing}
        @click=${() => _installWorca(rerender)}
      >
        ${unsafeHTML(iconSvg(Download, 14))} Install Worca
      </sl-button>
    </div>
    <div class="wizard-hint">
      Runs <code>worca init --upgrade</code> in this project — it creates
      <code>.claude/</code> if needed and preserves any existing settings.
      Or skip and continue without it.
    </div>
  `;
}

function _baseBranchStep(s) {
  return html`
    <p class="wizard-intro">New pull requests will target this branch.</p>
    <label class="wizard-label" for="wizard-base-branch">Base branch</label>
    <sl-input
      id="wizard-base-branch"
      class="wizard-base-branch"
      value=${s.baseBranch}
      @sl-input=${(e) => {
        s.baseBranch = e.target.value;
      }}
    ></sl-input>
    <div class="wizard-hint">${
      s.isWorkspace
        ? `Applies to all ${s.projectCount} project${s.projectCount === 1 ? '' : 's'}.`
        : 'Detected from git remote.'
    }</div>
  `;
}

function _toolBlock(
  rerender,
  { key, name, desc, installed, enabled, installCmd },
) {
  return html`
    <div class="wizard-tool">
      <div class="wizard-tool-head">
        <span class="wizard-tool-name">${name}</span>
        ${
          installed
            ? html`<sl-switch
                size="small"
                ?checked=${enabled}
                @sl-change=${(e) => _toggleTool(key, e.target.checked, rerender)}
              >${enabled ? 'on' : 'off'}</sl-switch>`
            : html`<span class="wizard-tool-status">not installed</span>`
        }
      </div>
      <div class="wizard-tool-desc">${desc}</div>
      ${
        installed
          ? nothing
          : html`
            <div class="wizard-install">
              <code class="wizard-install-cmd">${installCmd}</code>
              <sl-copy-button value=${installCmd}></sl-copy-button>
            </div>
          `
      }
    </div>
  `;
}

function _toolsStep(s, rerender) {
  const pf = s.preflight || {};
  return html`
    ${_toolBlock(rerender, {
      key: 'graphify',
      name: 'Graphify',
      desc: 'Code knowledge graph for smarter planning',
      installed: pf.graphifyInstalled,
      enabled: s.graphifyEnabled,
      installCmd: graphifyInstallCommand(),
    })}
    <div class="wizard-divider"></div>
    ${_toolBlock(rerender, {
      key: 'crg',
      name: 'CRG',
      desc: 'Static code-review graph',
      installed: pf.crgInstalled,
      enabled: s.crgEnabled,
      installCmd: crgInstallCommand(),
    })}
    ${
      pf.graphifyInstalled && pf.crgInstalled
        ? nothing
        : html`<div class="wizard-recheck">
            <sl-button size="small" @click=${() => _recheckTools(rerender)}>Check again</sl-button>
          </div>`
    }
  `;
}

function _templateStep(s, rerender) {
  if (s.templates === null) {
    return html`<div class="wizard-loading"><sl-spinner></sl-spinner> Loading templates…</div>`;
  }
  // No templates resolvable — almost always because worca isn't installed in
  // this project yet (built-in templates live in .claude/worca/templates/,
  // created by worca init). Explain it rather than showing a bare radio.
  if (s.templates.length === 0) {
    return html`
      <div class="wizard-empty">
        <p>No pipeline templates found for ${
          s.isWorkspace ? 'these projects' : 'this project'
        }.</p>
        <p class="wizard-empty-hint">
          Built-in templates become available once worca is installed — use the
          <strong>Update</strong> action on the project row in Settings. You can
          continue now and choose a template per run.
        </p>
      </div>
      <label class="wizard-radio-none">
        <input type="radio" name="wizard-template" checked disabled />
        No default — choose per run
      </label>
    `;
  }
  const sel = s.templateSel;
  const selectedTemplate =
    s.templates.find((t) => _sameTemplate(t, sel)) || null;
  const tiers = _templatesByTier(s.templates);
  const onChange = (e) => {
    // '__none__' is the "No default" sentinel — sl-select doesn't derive a
    // display label for an empty-string value, so we can't use '' here.
    const id = e.target.value === '__none__' ? '' : e.target.value;
    const found = id ? s.templates.find((t) => t.id === id) : null;
    s.templateSel = found ? { tier: found.tier, id: found.id } : null;
    rerender();
  };
  // The selected template's description is rendered in a fixed-height slot so
  // picking a template (or a longer description) never reflows the dialog.
  // Long text is line-clamped with an sl-tooltip exposing the full copy.
  const desc = selectedTemplate?.description || '';
  return html`
    ${
      s.isWorkspace
        ? html`<div class="wizard-note">Only globally accessible templates are
            listed. Project-specific templates can be configured per project later.</div>`
        : nothing
    }
    <label class="wizard-label" for="wizard-template-select">Default template</label>
    <sl-select
      id="wizard-template-select"
      class="wizard-template-select"
      ${ref(_refreshSlSelectDisplay)}
      value=${sel?.id ?? '__none__'}
      @sl-change=${onChange}
    >
      <sl-option value="__none__">No default — choose per run</sl-option>
      ${_tierGroup('User', tiers.user)}
      ${_tierGroup('Project', tiers.project)}
      ${_tierGroup('Built-in', tiers.builtin)}
    </sl-select>
    <div class="wizard-template-desc-slot">
      ${
        sel
          ? html`
              <div class="wizard-template-desc-label">Description:</div>
              ${
                desc
                  ? html`<sl-tooltip content=${desc}>
                      <div class="wizard-template-desc-clamp">${desc}</div>
                    </sl-tooltip>`
                  : html`<div class="wizard-template-desc-clamp">No description.</div>`
              }
            `
          : html`<span class="wizard-template-desc-empty">Pick a template to
              pin it as this project’s default.</span>`
      }
    </div>
    ${
      s.isWorkspace
        ? html`<div class="wizard-hint">Applies to all ${s.projectCount} project${
            s.projectCount === 1 ? '' : 's'
          } in this workspace.</div>`
        : nothing
    }
  `;
}

// Force sl-select to re-derive its display label once its lit-rendered options
// are connected. Without this, a preset value (e.g. an existing default
// template) renders a blank control because selectionChanged() runs before the
// grouped options mount. Mirrors new-run.js's _refreshSlSelectDisplay.
function _refreshSlSelectDisplay(el) {
  if (!el || el.__dynamicLabelObserverAttached) return;
  el.__dynamicLabelObserverAttached = true;
  const refresh = () => {
    if (typeof el.selectionChanged === 'function') el.selectionChanged();
  };
  const observer = new MutationObserver(refresh);
  observer.observe(el, { characterData: true, childList: true, subtree: true });
  Promise.resolve().then(refresh);
}

// Group templates by tier for the grouped <sl-select>, mirroring new-run.js.
function _templatesByTier(templates) {
  const result = { builtin: [], project: [], user: [] };
  for (const t of templates || []) {
    const tier = t.tier === 'worca' ? 'builtin' : t.tier;
    if (result[tier]) result[tier].push(t);
  }
  return result;
}

function _tierGroup(label, items) {
  if (!items || items.length === 0) return nothing;
  return html`
    <sl-divider></sl-divider>
    <small class="template-group-label">${label}</small>
    ${items.map(
      (t) => html`<sl-option class="template-grouped" value=${t.id}>
        ${t.name || t.id}
      </sl-option>`,
    )}
  `;
}

function _summaryRow(applied, doneLabel, skipLabel) {
  if (applied === null || applied === undefined) {
    return html`<div class="wizard-summary-row skipped">
      <span class="wizard-summary-icon">${unsafeHTML(iconSvg(CircleSlash, 16))}</span>
      ${skipLabel}
    </div>`;
  }
  return html`<div class="wizard-summary-row done">
    <span class="wizard-summary-icon">${unsafeHTML(iconSvg(CircleCheck, 16))}</span>
    ${doneLabel}
  </div>`;
}

function _completeStep(s, rerender) {
  const a = s.applied;
  const templateLabel =
    a.template === '__none__'
      ? 'Default template: none (choose per run)'
      : a.template
        ? `Default template: ${a.template}`
        : null;
  return html`
    ${_summaryRow(
      a.baseBranch,
      `Base branch set to ${a.baseBranch}`,
      'Base branch unchanged',
    )}
    ${_summaryRow(
      a.graphify,
      `Graphify ${a.graphify ? 'enabled' : 'disabled'}`,
      'Graphify unchanged',
    )}
    ${_summaryRow(
      a.crg,
      `CRG ${a.crg ? 'enabled' : 'disabled'}`,
      'CRG unchanged',
    )}
    ${_summaryRow(
      templateLabel === null ? null : true,
      templateLabel || '',
      'Default template unchanged',
    )}
    ${
      s.hasIntegrations
        ? nothing
        : html`<div class="wizard-notify-card">
            <span class="wizard-notify-icon">${unsafeHTML(iconSvg(Bell, 16))}</span>
            <div class="wizard-notify-body">
              <strong>Get notified when runs complete</strong>
              <div class="wizard-notify-sub">
                Set up Slack, Discord, or Telegram.
              </div>
            </div>
            <sl-button
              size="small"
              variant="primary"
              @click=${() => _goToIntegrations(rerender)}
            >Configure Now</sl-button>
          </div>`
    }
  `;
}

function _footer(s, rerender) {
  const key = _curKey(s);
  // Final step: just Done (the summary is the end of the flow).
  if (key === 'complete') {
    return html`
      <span slot="footer"></span>
      <div slot="footer" class="wizard-footer-right">
        <sl-button variant="primary" @click=${() => closeProjectSetupWizard(rerender)}>Done</sl-button>
      </div>
    `;
  }
  // Every other step: Skip Setup (left, dismisses the wizard) · Back + Next
  // (right). Back is hidden on the first step. The advancing action applies
  // this step's value where relevant, then moves on.
  const isFirst = s.step === 1;
  const nextLabel = isFirst ? 'Continue' : 'Next';
  const onNext =
    key === 'branch'
      ? () => _applyBaseBranchAndNext(rerender)
      : key === 'template'
        ? () => _applyTemplateAndNext(rerender)
        : () => _next(rerender);
  return html`
    <sl-button slot="footer" variant="default" @click=${() => closeProjectSetupWizard(rerender)}>Skip Setup</sl-button>
    <div slot="footer" class="wizard-footer-right">
      ${
        isFirst
          ? nothing
          : html`<sl-button variant="default" @click=${() => _goto(s.step - 1, rerender)}>
              ${unsafeHTML(iconSvg(ArrowLeft, 14))} Back
            </sl-button>`
      }
      <sl-button variant="primary" ?disabled=${isFirst && s.loading} @click=${onNext}>
        ${nextLabel} ${unsafeHTML(iconSvg(ArrowRight, 14))}
      </sl-button>
    </div>
  `;
}

function _body(s, rerender) {
  if (s.loading)
    return html`<div class="wizard-loading"><sl-spinner></sl-spinner> Loading…</div>`;
  if (s.error) return html`<div class="wizard-error">${s.error}</div>`;
  switch (_curKey(s)) {
    case 'preflight':
      return _preflightStep(s);
    case 'install':
      return _installStep(s, rerender);
    case 'branch':
      return _baseBranchStep(s);
    case 'tools':
      return _toolsStep(s, rerender);
    case 'template':
      return _templateStep(s, rerender);
    case 'complete':
      return _completeStep(s, rerender);
    default:
      return nothing;
  }
}

/**
 * Render the wizard dialog. Returns `nothing` when closed.
 */
export function projectSetupWizardView(rerender) {
  const s = _state;
  if (!s) return nothing;
  const label = s.isWorkspace ? 'Workspace Setup' : 'Project Setup';
  return html`
    <sl-dialog
      class="project-setup-wizard"
      label=${label}
      open
      style="--width: 480px"
      @sl-after-hide=${(e) => {
        // Escape, overlay click, and the [×] button all close non-destructively
        // — settings applied so far are already persisted. Teardown here.
        if (e.target.classList.contains('project-setup-wizard')) {
          closeProjectSetupWizard(rerender);
        }
      }}
    >
      ${_stepIndicator(s)}
      <div class="wizard-body">${_body(s, rerender)}</div>
      ${_footer(s, rerender)}
    </sl-dialog>
  `;
}
