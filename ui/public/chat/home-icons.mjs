// ui/public/chat/home-icons.mjs — the Chat home's line icons (worca Chat P6): quick-action tiles, the intent chip,
// the More trigger and the Recent chats chevron. One 24×24 stroke set in the sidebar's own style (index.html .nav
// svg: stroke 1.9, round caps); workflow, schedule, metrics, model and workspace reuse those very paths.
const open = (size) => `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">`;

export const HOME_ICONS = Object.freeze({
  run: '<path d="M8 5.5v13l10.5-6.5z"></path>',
  shape: '<rect x="5" y="4.5" width="14" height="16" rx="2.2"></rect><path d="M9.5 3h5v3h-5zM8.5 11l1.3 1.3 2.4-2.4M8.5 16l1.3 1.3 2.4-2.4M14 11.5h2M14 16.5h2"></path>',
  workflow: '<rect x="3" y="9" width="6" height="6" rx="1.6"></rect><rect x="15" y="4" width="6" height="5.5" rx="1.6"></rect><rect x="15" y="14.5" width="6" height="5.5" rx="1.6"></rect><path d="M9 12h2.5M11.5 12V6.8H15M11.5 12v5.3H15"></path>',
  schedule: '<rect x="3.5" y="5" width="17" height="15.5" rx="3"></rect><path d="M3.5 10h17M8 3v4M16 3v4"></path><path d="M12 13.2v2.6l1.8 1.1"></path>',
  track: '<path d="M3 12h4l2.5-6 4 12 2.5-6H21"></path>',
  diff: '<path d="M12 4.5v7M8.5 8h7M8.5 17.5h7"></path>',
  script: '<path d="M8.5 8 4.5 12l4 4M15.5 8l4 4-4 4M13.5 5.5l-3 13"></path>',
  clone: '<path d="M12 4v11M7.5 10.5 12 15l4.5-4.5M5 19.5h14"></path>',
  more: '<circle cx="6" cy="12" r="1.5" fill="currentColor" stroke="none"></circle><circle cx="12" cy="12" r="1.5" fill="currentColor" stroke="none"></circle><circle cx="18" cy="12" r="1.5" fill="currentColor" stroke="none"></circle>',
  away: '<path d="M19.5 14.5A8 8 0 0 1 9.5 4.5a8 8 0 1 0 10 10z"></path>',
  metrics: '<path d="M4 19h16"></path><path d="M6 15l4-5 4 3 4-6"></path>',
  model: '<path d="M12 3l8 4.5v9L12 21l-8-4.5v-9L12 3z"></path><path d="M4 7.5l8 4.5 8-4.5M12 12v9"></path>',
  workspace: '<rect x="3" y="3" width="7" height="7" rx="1.6"></rect><rect x="14" y="3" width="7" height="7" rx="1.6"></rect><rect x="3" y="14" width="7" height="7" rx="1.6"></rect><path d="M14 17.5h7M17.5 14v7"></path>',
  remember: '<path d="M7 4.5h10v15l-5-3.5-5 3.5z"></path>',
  tasks: '<path d="M10 7h10M10 12h10M10 17h10M4 7l1.2 1.2L7.5 6M4 12l1.2 1.2 2.3-2.2M4 17l1.2 1.2 2.3-2.2"></path>',
  x: '<path d="M7 7l10 10M17 7 7 17"></path>',
  chevron: '<path d="M9.5 6l6 6-6 6"></path>',
});

/** A `span.chat-ic` holding icon `name` at `size` px. The markup is this module's own literal — never data. */
export function homeIcon(doc, name, size = 16) {
  const px = Number(size) > 0 ? Number(size) : 16;
  const span = doc.createElement('span');
  span.className = 'chat-ic';
  span.setAttribute('aria-hidden', 'true');
  span.style.width = `${px}px`;
  span.style.height = `${px}px`;
  span.innerHTML = `${open(px)}${HOME_ICONS[name] || ''}</svg>`;
  return span;
}
