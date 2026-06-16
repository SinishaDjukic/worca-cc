import { html } from 'lit-html';
import { profileCardView } from './profile-card.js';

/**
 * Dashboard landing view: a grid of profile cards.
 *
 * @param {object[]} profiles  aggregate summaries
 * @param {object} [handlers]  forwarded to each profile card
 */
export function profileListView(profiles, handlers = {}) {
  if (!profiles || profiles.length === 0) {
    return html`
      <div class="empty-state">
        <p>No benchmark results yet.</p>
        <p class="empty-state-hint">Run a profile to populate <code>results.jsonl</code> in the target directory.</p>
      </div>
    `;
  }
  return html`
    <div class="profile-grid">
      ${profiles.map((p) => profileCardView(p, handlers))}
    </div>
  `;
}

/**
 * The dashboard body — the profile card grid. The page title and the
 * "Compare all" action now live in main.js's shared content header.
 *
 * @param {object[]} profiles
 * @param {object} [handlers]  forwarded to each profile card (onOpen, onRun)
 */
export function dashboardView(profiles, handlers = {}) {
  return html`<section class="page">${profileListView(profiles, handlers)}</section>`;
}
