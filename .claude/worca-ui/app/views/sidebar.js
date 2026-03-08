import { html } from 'lit-html';

export function sidebarView(state, route, connectionState, { onNavigate, onThemeToggle }) {
  const { runs, preferences } = state;
  const runList = Object.values(runs);
  const activeCount = runList.filter(r => r.active).length;
  const historyCount = runList.filter(r => !r.active).length;

  const connClass = connectionState === 'open' ? 'connected'
    : connectionState === 'reconnecting' ? 'reconnecting' : 'disconnected';
  const connLabel = connectionState === 'open' ? 'Connected'
    : connectionState === 'reconnecting' ? 'Reconnecting\u2026' : 'Disconnected';

  return html`
    <aside class="sidebar ${preferences.sidebarCollapsed ? 'collapsed' : ''}">
      <div class="sidebar-logo">
        <span class="logo-text">WORCA</span>
      </div>

      <div class="sidebar-section">
        <div class="sidebar-section-header">Pipeline</div>
        <div class="sidebar-item ${route.section === 'active' ? 'active' : ''}"
             @click=${() => onNavigate('active')}>
          Active
          ${activeCount > 0 ? html`<span class="badge">${activeCount}</span>` : ''}
        </div>
        <div class="sidebar-item ${route.section === 'history' ? 'active' : ''}"
             @click=${() => onNavigate('history')}>
          History
          ${historyCount > 0 ? html`<span class="badge">${historyCount}</span>` : ''}
        </div>
      </div>

      <div class="sidebar-footer">
        <div class="connection-indicator ${connClass}">
          <span class="conn-dot"></span>
          <span class="conn-label">${connLabel}</span>
        </div>
        <button class="theme-toggle" @click=${onThemeToggle}>
          ${preferences.theme === 'dark' ? '\u2600' : '\u263E'}
        </button>
      </div>
    </aside>
  `;
}
