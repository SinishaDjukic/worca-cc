import { html, nothing } from 'lit-html';
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
 * The dashboard section header with a compare shortcut.
 *
 * @param {object[]} profiles
 * @param {object} [handlers]
 * @param {() => void} [handlers.onCompare]
 */
export function dashboardView(profiles, handlers = {}) {
  return html`
    <section class="page">
      <div class="page-head">
        <h1>Benchmark Profiles</h1>
        ${
          profiles && profiles.length > 1 && handlers.onCompare
            ? html`<button class="action-btn" @click=${handlers.onCompare}>Compare all</button>`
            : nothing
        }
      </div>
      ${profileListView(profiles, handlers)}
    </section>
  `;
}
