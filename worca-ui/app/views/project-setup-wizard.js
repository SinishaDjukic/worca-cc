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
import { unsafeHTML } from 'lit-html/directives/unsafe-html.js';
import {
  ArrowLeft,
  ArrowRight,
  Bell,
  CircleCheck,
  CircleSlash,
  iconSvg,
} from '../utils/icons.js';
import { crgInstallCommand } from './settings-code-review-graph.js';
import { graphifyInstallCommand } from './settings-graphify.js';

const STEP_TITLES = [
  'Preflight',
  'PR Base Branch',
  'Optional Tools',
  'Default Template',
  'Complete',
];
const TOTAL_STEPS = STEP_TITLES.length;

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
    isWorkspace,
    target,
    projectCount,
    loading: true,
    error: null,
    preflight: null,
    baseBranch: '',
    graphifyEnabled: false,
    crgEnabled: false,
    templateSel: null,
    templates: null,
    applied: { baseBranch: null, graphify: null, crg: null, template: null },
  };
  _fetchPreflight(rerender);
}

export function closeProjectSetupWizard(rerender) {
  _state = null;
  rerender?.();
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
      s.templateSel = dt;
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
  _state.step = Math.max(1, Math.min(TOTAL_STEPS, step));
  rerender();
}

async function _applyBaseBranchAndNext(rerender) {
  const s = _state;
  if (!s) return;
  const branch = (s.baseBranch || '').trim();
  if (branch) {
    const r = await _applyPatch(s, { baseBranch: branch });
    s.applied.baseBranch = r.ok ? branch : null;
  }
  _goto(3, rerender);
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
  _goto(5, rerender);
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
  if (_state === s) {
    _state.baseBranch = keep.baseBranch;
    _state.templateSel = keep.templateSel;
    _state.applied = keep.applied;
    _state.step = 3;
    rerender();
  }
}

// ─── Render ──────────────────────────────────────────────────────────────

function _stepIndicator(step) {
  const dots = [];
  for (let i = 1; i <= TOTAL_STEPS; i++) {
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
    if (i < TOTAL_STEPS) {
      dots.push(
        html`<span class="wizard-dot-line ${i < step ? 'done' : ''}"></span>`,
      );
    }
  }
  return html`
    <div class="wizard-steps">
      <div class="wizard-dots">${dots}</div>
      <div class="wizard-step-title">${STEP_TITLES[step - 1]}</div>
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
      <p class="wizard-intro">Checking ${s.projectCount} project${
        s.projectCount === 1 ? '' : 's'
      } in this workspace…</p>
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
    <p class="wizard-intro">Checking your project environment…</p>
    ${_checkRow(pf.isGitRepo, 'Git repository', pf.isGitRepo ? 'detected' : 'not a git repo')}
    ${_checkRow(true, 'PR base branch', pf.baseBranch)}
    ${_checkRow(pf.graphifyInstalled, 'Graphify', pf.graphifyInstalled ? 'installed' : 'not installed')}
    ${_checkRow(pf.crgInstalled, 'CRG', pf.crgInstalled ? 'installed' : 'not installed')}
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
    return html`<div class="wizard-loading">Loading templates…</div>`;
  }
  const sel = s.templateSel;
  const selectedTemplate =
    s.templates.find((t) => _sameTemplate(t, sel)) || null;
  return html`
    ${
      s.isWorkspace
        ? html`<div class="wizard-note">Only globally accessible templates are
            listed. Project-specific templates can be configured per project later.</div>`
        : nothing
    }
    <div class="wizard-template-cards">
      ${s.templates.map((t) => {
        const isSel = _sameTemplate(t, sel);
        return html`
          <button
            type="button"
            class="wizard-template-card ${isSel ? 'selected' : ''}"
            @click=${() => {
              s.templateSel = { tier: t.tier, id: t.id };
              rerender();
            }}
          >
            ${t.name || t.id}
          </button>
        `;
      })}
    </div>
    ${
      selectedTemplate
        ? html`<div class="wizard-template-desc">
            <strong>${selectedTemplate.name || selectedTemplate.id}</strong>
            <div>${selectedTemplate.description || 'No description.'}</div>
          </div>`
        : nothing
    }
    <label class="wizard-radio-none">
      <input
        type="radio"
        name="wizard-template"
        ?checked=${!sel}
        @change=${() => {
          s.templateSel = null;
          rerender();
        }}
      />
      No default — choose per run
    </label>
    ${
      s.isWorkspace
        ? html`<div class="wizard-hint">Applies to all ${s.projectCount} project${
            s.projectCount === 1 ? '' : 's'
          } in this workspace.</div>`
        : nothing
    }
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

function _completeStep(s) {
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
    <div class="wizard-notify-card">
      <span class="wizard-notify-icon">${unsafeHTML(iconSvg(Bell, 16))}</span>
      <div>
        <strong>Get notified when runs complete</strong>
        <div class="wizard-notify-sub">
          Set up Slack, Discord, or Telegram in
          <a href="#/settings" @click=${() => closeProjectSetupWizard()}>Integrations →</a>
        </div>
      </div>
    </div>
  `;
}

function _footer(s, rerender) {
  const step = s.step;
  if (step === 1) {
    return html`
      <sl-button slot="footer" variant="text" @click=${() => closeProjectSetupWizard(rerender)}>Skip Setup</sl-button>
      <sl-button slot="footer" variant="primary" ?disabled=${s.loading} @click=${() => _goto(2, rerender)}>
        Continue ${unsafeHTML(iconSvg(ArrowRight, 14))}
      </sl-button>
    `;
  }
  if (step === 5) {
    return html`
      <sl-button slot="footer" variant="primary" @click=${() => closeProjectSetupWizard(rerender)}>Done</sl-button>
    `;
  }
  // Steps 2–4: Back · Skip · Next
  const onNext =
    step === 2
      ? () => _applyBaseBranchAndNext(rerender)
      : step === 4
        ? () => _applyTemplateAndNext(rerender)
        : () => _goto(step + 1, rerender);
  return html`
    <sl-button slot="footer" variant="text" @click=${() => _goto(step - 1, rerender)}>
      ${unsafeHTML(iconSvg(ArrowLeft, 14))} Back
    </sl-button>
    <span slot="footer" class="wizard-footer-spacer"></span>
    <sl-button slot="footer" variant="default" @click=${() => _goto(step + 1, rerender)}>Skip</sl-button>
    <sl-button slot="footer" variant="primary" @click=${onNext}>
      Next ${unsafeHTML(iconSvg(ArrowRight, 14))}
    </sl-button>
  `;
}

function _body(s, rerender) {
  if (s.loading) return html`<div class="wizard-loading">Loading…</div>`;
  if (s.error) return html`<div class="wizard-error">${s.error}</div>`;
  switch (s.step) {
    case 1:
      return _preflightStep(s);
    case 2:
      return _baseBranchStep(s);
    case 3:
      return _toolsStep(s, rerender);
    case 4:
      return _templateStep(s, rerender);
    case 5:
      return _completeStep(s);
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
      @sl-request-close=${(e) => {
        // Allow the close button + overlay; teardown happens in sl-after-hide.
        if (e.detail.source === 'keyboard') e.preventDefault();
      }}
      @sl-after-hide=${(e) => {
        if (e.target.classList.contains('project-setup-wizard')) {
          closeProjectSetupWizard(rerender);
        }
      }}
    >
      ${_stepIndicator(s.step)}
      <div class="wizard-body">${_body(s, rerender)}</div>
      ${_footer(s, rerender)}
    </sl-dialog>
  `;
}
