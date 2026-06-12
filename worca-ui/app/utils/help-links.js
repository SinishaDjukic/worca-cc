/**
 * In-app help links — PROTOTYPE (W-061, prototype/W-061-help-mode-toggle).
 *
 * Pattern: badges are HIDDEN by default and only revealed when the user
 * activates help mode via the right-edge "Help" tab or the `?` keyboard
 * shortcut (see help-mode.js). This is the alternative to the always-on
 * inline `?` icon approach in docs/plans/W-061-in-app-help-links.md.
 *
 * Public API:
 *   HELP_LINKS  — frozen helpId → { slug, title } map.
 *   helpUrl(id) — resolves an id to a docs.worca.dev URL (or null if unknown).
 *   helpFor(id) — lit-html template that renders a discoverable .help-badge.
 *                 The badge is `display: none` until `body.help-mode-active`
 *                 flips it on, at which point it absolutely positions to the
 *                 top-right of its parent and pulses gently.
 *
 * Slug discipline: page-level only, never anchors. Page slugs require an
 * explicit file rename so a reviewer notices; auto-generated anchor IDs
 * silently break on heading renames.
 *
 * Registry corrections vs. the original W-061 plan (post W-062 + W-063):
 *   + timeline-view           — W-063 added running-pipelines/timeline-view.md
 *   + templates               — W-062 surfaces; configuration/pipeline-templates.md
 *   + authoring-templates     — advanced/authoring-templates.md
 *   + configuration-precedence — settings.js:96 already links here
 *   + settings-overview       — better fit for the Preferences tab
 *   - effort / permissions     — those tabs no longer exist in settings.js
 *                                (folded into the template editor)
 *   + access-map              — running-pipelines/access-map.md (W-064 surface)
 *   + custom-flows            — advanced/custom-pipeline-flows.md (W-070/071/072)
 */

import { html } from 'lit-html';

// Build-time override (see worca-ui/scripts/build-frontend.js). Defaults to
// production docs. esbuild's `define` substitutes the literal at build time;
// the typeof guard keeps tests / Node runs from blowing up on an undefined
// global.
const DOCS_BASE =
  typeof WORCA_DOCS_BASE !== 'undefined'
    ? WORCA_DOCS_BASE
    : 'https://docs.worca.dev';

export const HELP_LINKS = Object.freeze({
  // Concepts
  'pipeline-stages': {
    slug: 'concepts/the-pipeline-and-stages',
    title: 'Pipeline & stages',
  },
  governance: { slug: 'concepts/governance', title: 'Governance' },
  lifecycle: {
    slug: 'concepts/lifecycle-and-state',
    title: 'Run lifecycle & state',
  },
  templates: {
    slug: 'concepts/pipeline-templates',
    title: 'Pipeline templates',
  },
  'plans-guides': {
    slug: 'concepts/plans-work-requests-and-guides',
    title: 'Plans, work requests & guides',
  },

  // Configuration
  'agents-models': {
    slug: 'configuration/agents-and-models',
    title: 'Agents & models',
  },
  models: {
    slug: 'configuration/models',
    title: 'Models',
  },
  'claude-md-mode': {
    slug: 'configuration/claude-md-mode',
    title: 'CLAUDE.md load mode',
  },
  'min-effort': {
    slug: 'configuration/agents-and-models',
    title: 'Recommended effort floors',
  },
  'stages-config': {
    slug: 'configuration/stages',
    title: 'Stage configuration',
  },
  loops: {
    slug: 'configuration/loops-and-circuit-breaker',
    title: 'Loops & circuit breaker',
  },
  secrets: { slug: 'configuration/secrets', title: 'Secrets' },
  'configuration-precedence': {
    slug: 'configuration/precedence',
    title: 'Configuration precedence',
  },
  'settings-overview': {
    slug: 'configuration/settings-overview',
    title: 'Settings overview',
  },

  // Running pipelines
  launching: {
    slug: 'running-pipelines/launching-a-run',
    title: 'Launching a run',
  },
  monitoring: {
    slug: 'running-pipelines/monitoring-a-run',
    title: 'Monitoring a run',
  },
  controlling: {
    slug: 'running-pipelines/controlling-a-run',
    title: 'Controlling a run',
  },
  reviewing: {
    slug: 'running-pipelines/reviewing-the-result',
    title: 'Reviewing the result',
  },
  'timeline-view': {
    slug: 'running-pipelines/timeline-view',
    title: 'Timeline view',
  },
  'access-map': {
    slug: 'running-pipelines/access-map',
    title: 'Access Map',
  },

  // Advanced
  effort: { slug: 'advanced/tuning-effort', title: 'Effort levels' },
  dispatch: {
    slug: 'advanced/dispatch-governance',
    title: 'Dispatch governance',
  },
  crg: { slug: 'advanced/code-review-graph', title: 'Code Review Graph' },
  graphify: {
    slug: 'advanced/knowledge-graph',
    title: 'Knowledge graph (Graphify)',
  },
  'fleet-runs': { slug: 'advanced/fleet-runs', title: 'Fleet runs' },
  'workspace-runs': {
    slug: 'advanced/workspace-runs',
    title: 'Workspace runs',
  },
  worktrees: { slug: 'advanced/worktree-cleanup', title: 'Worktree cleanup' },
  'agent-prompt': {
    slug: 'advanced/anatomy-of-an-agent-prompt',
    title: 'Anatomy of an agent prompt',
  },
  'authoring-templates': {
    slug: 'advanced/authoring-templates',
    title: 'Authoring templates',
  },
  'custom-flows': {
    slug: 'advanced/custom-pipeline-flows',
    title: 'Custom pipeline flows',
  },

  // Integrations
  webhooks: { slug: 'integrations/webhooks', title: 'Webhooks' },
  chat: { slug: 'integrations/chat-integrations', title: 'Chat integrations' },
  events: { slug: 'integrations/events-overview', title: 'Events overview' },

  // Getting started
  'first-run': {
    slug: 'getting-started/your-first-run',
    title: 'Your first run',
  },
  'add-project': {
    slug: 'getting-started/add-your-project',
    title: 'Add your project',
  },
});

/**
 * Resolve a helpId to a docs.worca.dev URL.
 * @param {string} id
 * @returns {string|null}
 */
export function helpUrl(id) {
  const entry = HELP_LINKS[id];
  if (!entry) return null;
  return `${DOCS_BASE}/${entry.slug}/`;
}

/**
 * lit-html template that renders a help badge anchored to its parent.
 *
 * The badge is invisible until help mode activates (see help-mode.js). When
 * active, it absolutely positions to the top-right corner of its parent and
 * pulses. Click opens the doc page in a new tab.
 *
 * Usage:
 *   <div class="help-host">
 *     <h3>Dispatch governance</h3>
 *     ${helpFor('dispatch')}
 *   </div>
 *
 * The `.help-host` class on the parent is recommended (sets position:
 * relative) but not strictly required — Shoelace components like sl-tab are
 * already positioned hosts, and `body.help-mode-active *:has(> .help-badge)`
 * in styles.css handles the auto-relative case for plain parents.
 *
 * Returns null and warns in dev for unknown ids — never crashes a view.
 */
export function helpFor(id) {
  const entry = HELP_LINKS[id];
  if (!entry) {
    if (typeof console !== 'undefined') {
      console.warn(`helpFor: unknown id "${id}"`);
    }
    return null;
  }
  const url = `${DOCS_BASE}/${entry.slug}/`;
  // The "?" glyph is plain text rather than a lucide SVG so we don't get
  // the container artifact baked into every lucide help-icon variant
  // (circle-question-mark, badge-question-mark, etc. all draw their own
  // outline shape around the ?). With text we have just the glyph, sized
  // and weighted via the .help-badge__glyph CSS rule.
  return html`<a
    class="help-badge"
    href=${url}
    target="_blank"
    rel="noopener noreferrer"
    title="Help: ${entry.title}"
    aria-label="Open help: ${entry.title}"
    data-help-id=${id}
  ><span class="help-badge__glyph" aria-hidden="true">?</span></a>`;
}
