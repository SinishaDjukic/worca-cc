/**
 * Pipelines list view — card grid grouped by tier.
 *
 * Features:
 * - Card grid grouped by tier (Built-in/User/Project)
 * - Tier badges using badge color language
 * - Name/desc/tags display
 * - ★ Default badges
 * - Action row (Edit/Duplicate/Set default/Export/Delete)
 * - Shadows hint when effectiveTier !== "builtin"
 * - Empty states
 * - 30s polling for updates
 */

import { html, nothing } from 'lit-html';
import { ifDefined } from 'lit-html/directives/if-defined.js';
import { unsafeHTML } from 'lit-html/directives/unsafe-html.js';
import {
  Copy,
  Cpu,
  Download,
  FileText,
  FolderOpen,
  iconSvg,
  Plus,
  Trash2,
  Upload,
  Users,
} from '../utils/icons.js';

/**
 * Per-tier metadata for the section headers. Drives the icon, the
 * uppercase label, the one-line description, and the empty-state
 * placeholder shown when the tier has zero templates. Keeping this in
 * one map (rather than three inline `_tierSection` calls) means a copy
 * change touches one place.
 */
const TIER_SECTIONS = [
  {
    key: 'project',
    title: 'Project',
    icon: FolderOpen,
    desc: 'Stored in this repo at .claude/templates/ — versioned with code.',
    emptyTitle: 'No project templates yet',
    emptyDesc:
      'Click New, Import a bundle, or Duplicate a built-in to create one here.',
    // Project is the tier users land in this page to manage, so open
    // it by default. User and Built-in stay collapsed — their count
    // badge in the summary tells you at a glance whether there's
    // anything inside without expanding.
    defaultOpen: true,
  },
  {
    key: 'user',
    title: 'User',
    icon: Users,
    desc: 'Shared across all your projects from ~/.worca/templates/.',
    emptyTitle: 'No user templates yet',
    emptyDesc:
      'Duplicate a template into this scope to share it across every project on this machine.',
    defaultOpen: false,
  },
  {
    key: 'builtin',
    title: 'Built-in',
    icon: Cpu,
    desc: 'Ship with worca-cc. Immutable — duplicate to edit.',
    emptyTitle: 'No built-in templates found',
    emptyDesc:
      'These ship with worca-cc; run `worca init --upgrade` if you expect them and none show up.',
    defaultOpen: false,
  },
];

// Accept the legacy 'worca' tier alias so older server snapshots /
// cached responses still group correctly. Server's current contract
// uses 'builtin'.
function normalizeTier(tier) {
  if (!tier || tier === 'worca') return 'builtin';
  return tier;
}

/**
 * Export a template as a downloadable JSON bundle.
 *
 * Fetches the redacted bundle from the server and triggers a browser download.
 * Shows an error toast if the export fails.
 *
 * @param {string} projectId - Project ID for API scoping
 * @param {string} templateId - Template ID to export
 * @param {string} templateName - Optional template name for filename
 */
export async function exportTemplate(
  projectId,
  templateId,
  tier,
  templateName,
  mode = 'standalone',
) {
  try {
    const baseUrl = projectId
      ? `/api/projects/${projectId}/templates`
      : '/api/templates';

    // The bundle route is `/templates/:tier/:id/bundle` after the
    // (tier, id) primary-key redesign. Fall back to 'project' when
    // the caller didn't supply a tier — most card actions know it.
    const tierSlug = tier || 'project';
    // standalone (default) = self-contained config + resolved prompts;
    // delta = sparse overrides that re-merge on import.
    const modeParam = mode === 'delta' ? 'delta' : 'standalone';
    const response = await fetch(
      `${baseUrl}/${tierSlug}/${templateId}/bundle?mode=${modeParam}`,
    );

    if (!response.ok) {
      throw new Error(`Failed to export template (HTTP ${response.status})`);
    }

    const blob = await response.blob();

    // Prefer server-supplied filename from Content-Disposition header
    const cd = response.headers.get('Content-Disposition') || '';
    const cdMatch = cd.match(/filename="?([^";\s]+)"?/);
    const filename = cdMatch
      ? cdMatch[1]
      : `${templateName || templateId}-bundle.json`;

    // Create download link and trigger click
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();

    // Cleanup
    document.body.removeChild(a);
    URL.revokeObjectURL(url);

    // Dispatch success toast
    document.dispatchEvent(
      new CustomEvent('worca:toast', {
        detail: {
          message: `Template "${templateName || templateId}" exported successfully`,
          variant: 'success',
        },
      }),
    );

    return { success: true, filename };
  } catch (err) {
    // Dispatch error toast
    document.dispatchEvent(
      new CustomEvent('worca:toast', {
        detail: {
          message: `Failed to export template: ${err.message}`,
          variant: 'danger',
        },
      }),
    );

    return { success: false, error: err.message };
  }
}

/**
 * Create a public gist for a template via the server and return its URL.
 *
 * POSTs to the bundle route with `?format=gist` (the server returns
 * `{ ok, gist_url }`). Does NOT touch the clipboard or dispatch toasts — the
 * caller (the gist-export dialog) owns presentation. Maps the gh-unavailable
 * case to a friendly message.
 *
 * @param {string} projectId - Project ID for API scoping
 * @param {string} templateId - Template ID to gist
 * @param {string} tier - Template tier (defaults to 'project')
 * @returns {Promise<{ ok: true, gistUrl: string } | { ok: false, error: string }>}
 */
export async function createGist(projectId, templateId, tier) {
  try {
    const baseUrl = projectId
      ? `/api/projects/${projectId}/templates`
      : '/api/templates';

    // Bundle route is `/templates/:tier/:id/bundle` (the gist
    // format is the same endpoint with ?format=gist).
    const tierSlug = tier || 'project';
    const response = await fetch(
      `${baseUrl}/${tierSlug}/${templateId}/bundle?format=gist`,
      {
        method: 'POST',
      },
    );

    if (!response.ok) {
      let errMsg = `HTTP ${response.status}`;
      try {
        const data = await response.json();
        if (data?.error) errMsg = data.error;
      } catch (_) {}
      if (errMsg.includes('gh') || errMsg.includes('gist')) {
        return {
          ok: false,
          error: 'GitHub CLI (gh) is not available on the server',
        };
      }
      return { ok: false, error: errMsg };
    }

    const data = await response.json();
    if (!data.gist_url) {
      return { ok: false, error: 'No gist URL returned from server' };
    }

    return { ok: true, gistUrl: data.gist_url };
  } catch (err) {
    const message = err.message?.includes('gh')
      ? 'GitHub CLI (gh) is not available on the server'
      : err.message || 'Failed to create gist';
    return { ok: false, error: message };
  }
}

/**
 * Legacy clipboard+toast gist helper, retained for any non-dialog callers.
 * Delegates URL creation to {@link createGist}; the dialog flow no longer uses
 * this path (it shows the URL in a dialog instead of toasting).
 *
 * @param {string} projectId - Project ID for API scoping
 * @param {string} templateId - Template ID to gist
 * @param {string} tier - Template tier
 */
export async function copyGistUrl(projectId, templateId, tier) {
  const result = await createGist(projectId, templateId, tier);
  if (result.ok) {
    await navigator.clipboard.writeText(result.gistUrl);
    document.dispatchEvent(
      new CustomEvent('worca:toast', {
        detail: {
          message: `Gist URL copied to clipboard`,
          variant: 'success',
        },
      }),
    );
    return { success: true, gistUrl: result.gistUrl };
  }
  document.dispatchEvent(
    new CustomEvent('worca:toast', {
      detail: { message: result.error, variant: 'danger' },
    }),
  );
  return { success: false, error: result.error };
}

/**
 * Check if the GitHub CLI (gh) is available on the server.
 *
 * Caches the result to avoid repeated API calls.
 *
 * @param {string} projectId - Project ID for API scoping
 * @returns {Promise<boolean>} True if gh CLI is available
 */
export async function checkGistAvailability(projectId) {
  // Cache the result at module level
  if (this._ghAvailable !== undefined) {
    return this._ghAvailable;
  }

  try {
    const baseUrl = projectId ? `/api/projects/${projectId}` : '/api';
    const response = await fetch(`${baseUrl}/system/gh-cli-available`);

    if (!response.ok) {
      this._ghAvailable = false;
      return false;
    }

    const data = await response.json();
    this._ghAvailable = !!data.available;
    return this._ghAvailable;
  } catch {
    this._ghAvailable = false;
    return false;
  }
}

/**
 * Main pipelines list view.
 * @param {object} state - store state
 * @param {object} options - { rerender, onCreate, onEdit, onDuplicate, onDelete, onExport, defaultTemplate }
 */
export function pipelinesView(state, options) {
  const { onEdit, onDuplicate, onDelete, onExport, onGist, defaultTemplate } =
    options || {};
  const {
    templates = [],
    templatesLoaded = false,
    templatesError = null,
    worcaCliStatus = null,
  } = state;

  // Read-only / degraded mode: triggered when the worca-cc CLI is
  // missing or too old. The Pipelines list still renders (read paths
  // use the filesystem directly), but write actions are disabled and
  // a banner explains what to do.
  const degraded = worcaCliStatus && worcaCliStatus.ok === false;
  const handlers = {
    onEdit: degraded ? null : onEdit,
    onDuplicate: degraded ? null : onDuplicate,
    onDelete: degraded ? null : onDelete,
    onExport, // export is read-only — always available
    onGist, // gist is read-only — always available; card guards against has_overlays
  };

  // Group templates by tier. The API now returns a flat list where
  // each entry carries its own `tier` field; we just bucket by it.
  const templatesList = templates || [];
  const grouped = { project: [], user: [], builtin: [] };
  for (const t of templatesList) {
    const tier = normalizeTier(t.tier);
    if (grouped[tier]) grouped[tier].push(t);
  }

  const isLoaded = templatesLoaded;
  const hasError = templatesError !== null;

  return html`
    <div class="pipelines-view">
      <div class="pipelines-content">
        ${_degradedBanner(worcaCliStatus)}

        ${
          hasError
            ? html`
              <sl-alert variant="danger" open>
                <strong>Error loading templates</strong>
                ${templatesError}
              </sl-alert>
            `
            : ''
        }

        ${
          !isLoaded
            ? html`<sl-spinner class="pipelines-loading-spinner"></sl-spinner>`
            : html`
              ${
                // Always render all three sections, in applicability order
                // (project → user → built-in). Empty tiers stay visible
                // with a short note explaining what *would* live there,
                // so the structure of the page never depends on what the
                // current project happens to contain.
                TIER_SECTIONS.map((tier) =>
                  _tierSection(
                    tier,
                    grouped[tier.key] || [],
                    defaultTemplate,
                    handlers,
                  ),
                )
              }
            `
        }
      </div>
    </div>
  `;
}

/**
 * Render the worca-cc version-mismatch / not-installed banner.
 *
 * Returns nothing when the CLI is compatible (or status hasn't loaded
 * yet — staying quiet is better than flashing a banner that vanishes
 * once the probe lands).
 */
function _degradedBanner(status) {
  if (!status || status.ok !== false) return nothing;
  const installed = status.installed
    ? html`<code>worca-cc ${status.installed}</code>`
    : html`<em>worca CLI not found on PATH</em>`;
  return html`
    <sl-alert
      class="pipelines-cli-banner"
      variant="warning"
      open
      role="status"
    >
      <strong slot="header">Editing is disabled</strong>
      <div>
        This UI needs <code>worca-cc ${status.minimum}</code> or later for
        template create / edit / delete / duplicate. ${installed} is installed.
      </div>
      <div class="pipelines-cli-banner-hint">
        Upgrade with <code>pip install --upgrade 'worca-cc>=${status.minimum}'</code>,
        then reload this page. List, view, and export keep working in the meantime.
      </div>
    </sl-alert>
  `;
}

/**
 * Render a tier section as a collapsible `sl-details` — the same
 * pattern used by learnings-panel / live-output / log-viewer.
 *
 * Always rendered — empty tiers keep their header (count = 0) and
 * show a small note in the body so the page structure is consistent
 * regardless of what the project happens to contain. Defaults: Project
 * + User open (writable, frequently edited); Built-in collapsed
 * (reference, kept tucked away until the user wants to see them).
 */
function _tierSection(tier, templates, defaultTemplateId, handlers) {
  const list = templates || [];
  const count = list.length;

  return html`
    <sl-details
      class="pipelines-tier-section pipelines-tier-section--${tier.key}"
      ?open=${tier.defaultOpen}
    >
      <div slot="summary" class="tier-section-header">
        <span class="tier-section-icon">
          ${unsafeHTML(iconSvg(tier.icon, 16))}
        </span>
        <span class="tier-section-title">${tier.title}</span>
        <sl-badge variant="neutral" pill class="tier-section-count"
          >${count}</sl-badge
        >
        <span class="tier-section-desc">${tier.desc}</span>
      </div>
      ${
        count > 0
          ? html`
              <div class="pipelines-grid">
                ${list.map((t) =>
                  _templateCard(t, defaultTemplateId, handlers),
                )}
              </div>
            `
          : html`
              <div class="tier-section-empty">
                <div class="tier-section-empty-title">${tier.emptyTitle}</div>
                <p class="tier-section-empty-desc">${tier.emptyDesc}</p>
              </div>
            `
      }
    </sl-details>
  `;
}

/**
 * Render a single template card.
 *
 * The card body is the primary affordance for editing:
 * - Project/User templates: clicking anywhere outside an action button
 *   opens the editor in Edit mode.
 * - Built-in templates: clicking opens the canonical "shadow & edit"
 *   flow — a project-scope copy is created and the editor opens on it.
 *   The visible Duplicate button is kept as an explicit affordance for
 *   users who want to see what's about to happen before they click.
 *
 * Action buttons (Duplicate / Set Default / Export / Delete) stop
 * propagation so they don't double-fire as a card click.
 */
function _templateCard(template, defaultTemplate, handlers) {
  const { onEdit, onDuplicate, onDelete, onExport, onGist } = handlers || {};
  const {
    id,
    name,
    description,
    tier,
    builtin = false,
    has_overlays = false,
  } = template;

  const resolvedTier = normalizeTier(tier);
  // defaultTemplate is now `{tier, id}` (or null when unset); accept the
  // legacy bare-string form too for backwards-compat with old caches.
  const defaultRef =
    typeof defaultTemplate === 'string'
      ? { tier: null, id: defaultTemplate }
      : defaultTemplate || {};
  const isDefault =
    id === defaultRef.id &&
    (!defaultRef.tier || normalizeTier(defaultRef.tier) === resolvedTier);
  const isBuiltin = resolvedTier === 'builtin' || builtin;

  // Whole-card click → open the editor. For built-ins the editor
  // renders read-only (form inputs disabled, no Save button); to
  // actually fork a built-in the user clicks the explicit Duplicate
  // button. One gesture, one meaning: "show me this template".
  const cardClick = onEdit;
  const cardClickable = Boolean(cardClick);
  const cardClass = `run-card template-card${cardClickable ? ' template-card--clickable' : ''}`;
  const cardTitle = !cardClickable
    ? 'Upgrade worca-cc to enable editing'
    : isBuiltin
      ? 'Click to view template (read-only) — use Duplicate to edit'
      : 'Click to edit template';
  const onCardActivate = cardClickable
    ? () => cardClick(id, resolvedTier)
    : null;
  const onCardKeydown = cardClickable
    ? (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          cardClick(id, resolvedTier);
        }
      }
    : null;
  // Action buttons live inside the card; without stopPropagation each
  // click would also trigger the card-level edit. The handler returns a
  // closure rather than the bound action so we keep one indirection
  // point if we ever need to log/track these events centrally.
  const stop = (e) => e.stopPropagation();

  return html`
    <div
      class=${cardClass}
      role=${ifDefined(cardClickable ? 'button' : undefined)}
      tabindex=${ifDefined(cardClickable ? '0' : undefined)}
      title=${cardTitle}
      aria-disabled=${ifDefined(cardClickable ? undefined : 'true')}
      @click=${onCardActivate}
      @keydown=${onCardKeydown}
    >
      <div class="run-card-top">
        <span class="run-card-status">${unsafeHTML(iconSvg(FileText, 16))}</span>
        <span class="run-card-title">${name || id}</span>
        ${
          isDefault
            ? html`<sl-badge variant="primary" pill class="template-default-badge" title="Default template"
              >★ Default</sl-badge
            >`
            : ''
        }
      </div>
      <div class="template-card-id-row">
        <span class="template-card-id-badge" title="Template id">
          <span class="template-card-id-label">ID:</span>
          <code class="template-card-id">${id}</code>
        </span>
      </div>

      ${
        description
          ? html`<div class="run-card-meta">
          <span class="run-card-meta-item">
            <span class="meta-value">${description}</span>
          </span>
        </div>`
          : ''
      }

      <div class="run-card-actions" @click=${stop}>
        <button
          class="action-btn action-btn--secondary"
          ?disabled=${!onDuplicate}
          @click=${() => onDuplicate?.(id, resolvedTier)}
          title=${
            onDuplicate
              ? 'Duplicate to another storage location'
              : 'Upgrade worca-cc to enable duplicate'
          }
        >
          ${unsafeHTML(iconSvg(Copy, 14))}
          Duplicate
        </button>
        <button
          class="action-btn action-btn--secondary"
          @click=${() => onExport?.(id, resolvedTier)}
          title="Export template bundle"
        >
          ${unsafeHTML(iconSvg(Download, 14))}
          Export
        </button>
        ${
          has_overlays
            ? ''
            : html`<button
                class="action-btn action-btn--secondary"
                @click=${() => onGist?.(id, resolvedTier)}
                title="Export as a GitHub gist and copy the URL"
              >
                ${unsafeHTML(iconSvg(Copy, 14))}
                Export (gist)
              </button>`
        }
        ${
          !isBuiltin
            ? html`<button
              class="action-btn action-btn--danger template-card-delete-push"
              ?disabled=${!onDelete}
              @click=${() => onDelete?.(id, resolvedTier)}
              title=${
                onDelete
                  ? 'Delete template'
                  : 'Upgrade worca-cc to enable delete'
              }
            >
              ${unsafeHTML(iconSvg(Trash2, 14))}
              Delete
            </button>`
            : ''
        }
      </div>
    </div>
  `;
}

/**
 * Empty state for pipelines view.
 *
 * `onCreate` / `onImport` are passed `null` in degraded mode so the
 * Create / Import buttons render disabled. Disabling rather than
 * hiding keeps the affordance discoverable (and the banner above
 * explains why).
 */
function _emptyState(onCreate, onImport, degraded = false) {
  const createDisabled = !onCreate || degraded;
  const importDisabled = !onImport || degraded;
  return html`
    <div class="empty-state pipelines-empty">
      <div class="empty-state-icon">${unsafeHTML(iconSvg(FileText, 48))}</div>
      <h2>No templates yet</h2>
      <p>Get started by importing a template or creating one from scratch.</p>
      <div class="empty-state-actions">
        <sl-button
          variant="primary"
          ?disabled=${createDisabled}
          @click=${() => onCreate?.()}
        >
          ${unsafeHTML(iconSvg(Plus, 16))} Create Template
        </sl-button>
        <sl-button
          variant="default"
          ?disabled=${importDisabled}
          @click=${() => onImport?.()}
        >
          ${unsafeHTML(iconSvg(Upload, 16))} Import Bundle
        </sl-button>
      </div>
      <div class="empty-state-hint">
        <p>Or start from a built-in template by duplicating it to your project or user scope.</p>
      </div>
    </div>
  `;
}

/**
 * Fetch templates from the server.
 *
 * Returns `{ templates, defaultTemplate }`. The server returns the
 * project's `default_template` pointer in the same response so the
 * Pipeline Templates page can render the ★ Default badge on the
 * first paint — without that the cards flash in once, then re-render
 * after a separate /settings round-trip lands.
 *
 * Existing callers that destructure only `templates` continue to
 * work because the function previously returned the bare array.
 * Callers that want the bundle should use the returned object;
 * legacy array consumers (e.g. `const templates = await fetchTemplates(...)`)
 * still work via the `templates` property on the returned object.
 */
export function fetchTemplates(projectId) {
  const url = projectId
    ? `/api/projects/${projectId}/templates`
    : '/api/templates';
  return fetch(url).then(async (res) => {
    const data = await res.json();
    if (!data.ok) throw new Error(data.error || 'Failed to fetch templates');
    const templates = data.templates || [];
    // Provide both shapes: a callable array-like for legacy callers
    // and a `defaultTemplate` field for the new bundled flow.
    Object.defineProperty(templates, 'defaultTemplate', {
      value: data.default_template || null,
      enumerable: false,
    });
    return templates;
  });
}

/**
 * Create a template polling interval.
 * Call this from main.js to set up polling with access to store and rerender.
 * Returns a cleanup function.
 */
export function setupTemplatePolling(
  state,
  store,
  rerender,
  intervalMs = 30000,
) {
  // Helper to fetch and update state
  const fetchAndUpdate = async () => {
    try {
      const templates = await fetchTemplates(state.currentProjectId || null);
      store.setState({
        templates,
        templatesLoaded: true,
        templatesError: null,
      });
      rerender();
    } catch (err) {
      console.error('Failed to fetch templates:', err);
      store.setState({ templatesError: err.message, templatesLoaded: true });
      rerender();
    }
  };

  // Initial fetch
  fetchAndUpdate();

  // Set up polling
  const interval = setInterval(fetchAndUpdate, intervalMs);
  return () => clearInterval(interval);
}
