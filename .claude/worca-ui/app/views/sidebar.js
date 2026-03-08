import { html } from 'lit-html';
import { unsafeHTML } from 'lit-html/directives/unsafe-html.js';
import { iconSvg, Sun, Moon, Activity, Archive } from '../utils/icons.js';

export function sidebarView(state, route, connectionState, { onNavigate, onThemeToggle }) {
  const { runs, preferences } = state;
  const runList = Object.values(runs);
  const activeCount = runList.filter(r => r.active).length;
  const historyCount = runList.filter(r => !r.active).length;

  const connClass = connectionState === 'open' ? 'connected'
    : connectionState === 'reconnecting' ? 'reconnecting' : 'disconnected';
  const connLabel = connectionState === 'open' ? 'Connected'
    : connectionState === 'reconnecting' ? 'Reconnecting\u2026' : 'Disconnected';

  const themeIcon = preferences.theme === 'dark' ? iconSvg(Sun, 18) : iconSvg(Moon, 18);

  return html`
    <aside class="sidebar ${preferences.sidebarCollapsed ? 'collapsed' : ''}">
      <div class="sidebar-logo">
        <span class="logo-text">WORCA</span>
      </div>

      <div class="sidebar-section">
        <div class="sidebar-section-header">Pipeline</div>
        <div class="sidebar-item ${route.section === 'active' ? 'active' : ''}"
             @click=${() => onNavigate('active')}>
          <span class="sidebar-item-left">
            ${unsafeHTML(iconSvg(Activity, 16))}
            <span>Active</span>
          </span>
          ${activeCount > 0 ? html`<sl-badge variant="primary" pill>${activeCount}</sl-badge>` : ''}
        </div>
        <div class="sidebar-item ${route.section === 'history' ? 'active' : ''}"
             @click=${() => onNavigate('history')}>
          <span class="sidebar-item-left">
            ${unsafeHTML(iconSvg(Archive, 16))}
            <span>History</span>
          </span>
          ${historyCount > 0 ? html`<sl-badge variant="neutral" pill>${historyCount}</sl-badge>` : ''}
        </div>
      </div>

      <div class="sidebar-footer">
        <div class="connection-indicator ${connClass}">
          <span class="conn-dot"></span>
          <span class="conn-label">${connLabel}</span>
        </div>
        <button
          class="theme-toggle-btn"
          aria-label="Toggle theme"
          @click=${onThemeToggle}
        >${unsafeHTML(themeIcon)}</button>
      </div>
    </aside>
  `;
}
