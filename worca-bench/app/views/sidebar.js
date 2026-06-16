// app/views/sidebar.js — worca-bench left-rail navigation.
//
// Mirrors worca-ui/app/views/sidebar.js structure + class names so the
// benchmark dashboard shares the real app shell's look: a fixed-width
// `.sidebar` with a logo block and `.sidebar-section` / `.sidebar-item`
// nav entries. The active section is highlighted via the `.active` class.
//
// Unlike worca-ui this rail is stateless and collapse-free. Dashboard,
// Compare, Leaderboard, and Settings are all top-level sections reached from
// here; only true drill-downs (profile detail) get a content-header back
// button — the peer sections rely on the sidebar to navigate.

import { html } from 'lit-html';
import { unsafeHTML } from 'lit-html/directives/unsafe-html.js';

// Lucide-derived icon paths, rendered inline via unsafeHTML to keep
// worca-bench dependency-light (no lucide package) while matching worca-ui's
// `iconSvg()` affordance in the sidebar items.
const ICON_PATHS = Object.freeze({
  // LayoutDashboard
  dashboard:
    '<rect width="7" height="9" x="3" y="3" rx="1"/><rect width="7" height="5" x="14" y="3" rx="1"/><rect width="7" height="9" x="14" y="12" rx="1"/><rect width="7" height="5" x="3" y="16" rx="1"/>',
  // GitCompare
  compare:
    '<circle cx="18" cy="18" r="3"/><circle cx="6" cy="6" r="3"/><path d="M13 6h3a2 2 0 0 1 2 2v7"/><path d="M11 18H8a2 2 0 0 1-2-2V9"/>',
  // Trophy
  leaderboard:
    '<path d="M6 9H4.5a2.5 2.5 0 0 1 0-5H6"/><path d="M18 9h1.5a2.5 2.5 0 0 0 0-5H18"/><path d="M4 22h16"/><path d="M10 14.66V17c0 .55-.47.98-.97 1.21C7.85 18.75 7 20.24 7 22"/><path d="M14 14.66V17c0 .55.47.98.97 1.21C16.15 18.75 17 20.24 17 22"/><path d="M18 2H6v7a6 6 0 0 0 12 0V2Z"/>',
  // Settings (gear)
  settings:
    '<path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/><circle cx="12" cy="12" r="3"/>',
});

function iconSvg(name, size = 16) {
  const path = ICON_PATHS[name] || '';
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${path}</svg>`;
}

const NAV_ITEMS = Object.freeze([
  { key: 'dashboard', label: 'Dashboard', icon: 'dashboard' },
  { key: 'compare', label: 'Compare', icon: 'compare' },
  { key: 'leaderboard', label: 'Leaderboard', icon: 'leaderboard' },
]);

const WORKSPACE_ITEMS = Object.freeze([
  { key: 'settings', label: 'Settings', icon: 'settings' },
]);

function navItem(item, activeKey, onNavigate) {
  return html`
    <div
      class="sidebar-item ${activeKey === item.key ? 'active' : ''}"
      @click=${() => onNavigate?.(item.key)}
    >
      <span class="sidebar-item-left">
        ${unsafeHTML(iconSvg(item.icon, 16))}
        <span>${item.label}</span>
      </span>
    </div>
  `;
}

/**
 * The left-rail navigation.
 *
 * @param {string} activeKey   one of 'dashboard' | 'compare' | 'leaderboard'
 * @param {object} [handlers]
 * @param {(key: string) => void} [handlers.onNavigate]
 */
export function sidebarView(activeKey, { onNavigate } = {}) {
  return html`
    <aside class="sidebar">
      <div class="sidebar-logo">
        <span
          class="logo-text"
          style="cursor:pointer"
          @click=${() => onNavigate?.('dashboard')}
        >worca-bench</span>
      </div>

      <div class="sidebar-section">
        <div class="sidebar-section-header">Benchmarks</div>
        ${NAV_ITEMS.map((item) => navItem(item, activeKey, onNavigate))}
      </div>

      <div class="sidebar-section">
        <div class="sidebar-section-header">Workspace</div>
        ${WORKSPACE_ITEMS.map((item) => navItem(item, activeKey, onNavigate))}
      </div>
    </aside>
  `;
}
