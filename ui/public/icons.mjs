// ui/public/icons.mjs — Worca's one stroke icon set (runs-redesign spec §1.3): 24×24, stroke 2, round caps,
// sized 12–16px with the text. The markup is this module's own literal, never data.
const open = (size) => `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">`;

export const ICONS = Object.freeze({
  run: '<path d="M8 5.5v13l10.5-6.5z"></path>',
  shape: '<rect x="5" y="4.5" width="14" height="16" rx="2.2"></rect><path d="M9.5 3h5v3h-5zM8.5 11l1.3 1.3 2.4-2.4M8.5 16l1.3 1.3 2.4-2.4M14 11.5h2M14 16.5h2"></path>',
  workflow: '<rect x="3" y="9" width="6" height="6" rx="1.6"></rect><rect x="15" y="4" width="6" height="5.5" rx="1.6"></rect><rect x="15" y="14.5" width="6" height="5.5" rx="1.6"></rect><path d="M9 12h2.5M11.5 12V6.8H15M11.5 12v5.3H15"></path>',
  schedule: '<rect x="3.5" y="5" width="17" height="15.5" rx="3"></rect><path d="M3.5 10h17M8 3v4M16 3v4"></path><path d="M12 13.2v2.6l1.8 1.1"></path>',
  track: '<path d="M3 12h4l2.5-6 4 12 2.5-6H21"></path>',
  diff: '<path d="M12 4.5v7M8.5 8h7M8.5 17.5h7"></path>',
  script: '<path d="M8.5 8 4.5 12l4 4M15.5 8l4 4-4 4M13.5 5.5l-3 13"></path>',
  clone: '<path d="M12 4v11M7.5 10.5 12 15l4.5-4.5M5 19.5h14"></path>',
  project: '<path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path><path d="M12 11v6M9 14h6"></path>',
  more: '<circle cx="6" cy="12" r="1.5" fill="currentColor" stroke="none"></circle><circle cx="12" cy="12" r="1.5" fill="currentColor" stroke="none"></circle><circle cx="18" cy="12" r="1.5" fill="currentColor" stroke="none"></circle>',
  away: '<path d="M19.5 14.5A8 8 0 0 1 9.5 4.5a8 8 0 1 0 10 10z"></path>',
  'stepped-out': '<path d="M14 2.2a1.8 1.8 0 1 1 0 3.6 1.8 1.8 0 0 1 0-3.6z"></path><path d="M13 8l-1.5 5.5"></path><path d="M8.5 12l2-3.2 2.5-.8 2.5 2.5 2.5 1"></path><path d="M11.5 13.5l2.5 3 1 4.5"></path><path d="M11.5 13.5l-1.5 3.5-3 3.5"></path>',
  metrics: '<path d="M4 19h16"></path><path d="M6 15l4-5 4 3 4-6"></path>',
  model: '<path d="M12 3l8 4.5v9L12 21l-8-4.5v-9L12 3z"></path><path d="M4 7.5l8 4.5 8-4.5M12 12v9"></path>',
  workspace: '<rect x="3" y="3" width="7" height="7" rx="1.6"></rect><rect x="14" y="3" width="7" height="7" rx="1.6"></rect><rect x="3" y="14" width="7" height="7" rx="1.6"></rect><path d="M14 17.5h7M17.5 14v7"></path>',
  remember: '<path d="M7 4.5h10v15l-5-3.5-5 3.5z"></path>',
  tasks: '<path d="M10 7h10M10 12h10M10 17h10M4 7l1.2 1.2L7.5 6M4 12l1.2 1.2 2.3-2.2M4 17l1.2 1.2 2.3-2.2"></path>',
  x: '<path d="M7 7l10 10M17 7 7 17"></path>',
  chevron: '<path d="M9.5 6l6 6-6 6"></path>',
  'chevron-left': '<path d="M14.5 6l-6 6 6 6"></path>',
  'chevron-down': '<path d="M6 9.5l6 6 6-6"></path>',
  'chevron-up': '<path d="M6 14.5l6-6 6 6"></path>',
  check: '<path d="M5 12.5l4.5 4.5L19 7.5"></path>',
  plus: '<path d="M12 5v14M5 12h14"></path>',
  play: '<path d="M8 5.5v13l10.5-6.5z"></path>',
  pause: '<path d="M9 5v14M15 5v14"></path>',
  'arrow-up': '<path d="M12 19V5M6 11l6-6 6 6"></path>',
  'arrow-down': '<path d="M12 5v14M6 13l6 6 6-6"></path>',
  copy: '<rect x="9" y="9" width="11" height="11" rx="2"></rect><path d="M5 15V6a2 2 0 0 1 2-2h8"></path>',
  refresh: '<path d="M20 11a8 8 0 1 0-2.3 5.7M20 4v7h-7"></path>',
  question: '<path d="M9.2 9.2a2.9 2.9 0 1 1 4.2 2.6c-.9.5-1.4 1.1-1.4 2v.4"></path><path d="M12 17.6h.01"></path>',
  alert: '<path d="M12 6.8v6.6"></path><path d="M12 17.6h.01"></path>',
  'pull-request': '<circle cx="6" cy="6" r="2.2"></circle><circle cx="6" cy="18" r="2.2"></circle><circle cx="18" cy="18" r="2.2"></circle><path d="M6 8.2v7.6"></path><path d="M18 15.8V9a3 3 0 0 0-3-3h-4"></path><path d="M13 3.5 10.5 6 13 8.5"></path>',
  // A pull request with a plus where its head will be: Create PR.
  'pr-create': '<circle cx="6" cy="6" r="2.5"></circle><path d="M6 8.5V21M13 6h3a2 2 0 0 1 2 2v3M18 15v6M15 18h6"></path>',
  'pull-request-draft': '<circle cx="6" cy="6" r="2.2"></circle><circle cx="6" cy="18" r="2.2"></circle><circle cx="18" cy="18" r="2.2"></circle><path d="M6 8.2v7.6"></path><path d="M18 6v1.5M18 10.5v1.5"></path>',
  'pull-request-closed': '<circle cx="6" cy="6" r="2.2"></circle><circle cx="6" cy="18" r="2.2"></circle><circle cx="18" cy="18" r="2.2"></circle><path d="M6 8.2v7.6"></path><path d="M15.5 4.5l5 5M20.5 4.5l-5 5"></path>',
  merge: '<circle cx="6" cy="5.5" r="2.2"></circle><circle cx="6" cy="18.5" r="2.2"></circle><circle cx="18" cy="12" r="2.2"></circle><path d="M6 7.7v8.6"></path><path d="M6 7.7c0 2.4 2.5 4.3 9.8 4.3"></path>',
  search: '<circle cx="11" cy="11" r="7"></circle><path d="M20 20l-3.5-3.5"></path>',
  key: '<circle cx="8" cy="15" r="4"></circle><path d="M11 12l9-9M17 6l3 3"></path>',
  external: '<path d="M14 4h6v6M20 4l-9 9"></path><path d="M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"></path>',
  git: '<circle cx="6" cy="6" r="2.2"></circle><circle cx="6" cy="18" r="2.2"></circle><circle cx="18" cy="8" r="2.2"></circle><path d="M6 8.2v7.6M18 10.2c0 4-6 3-10.5 6.3"></path>',
  folder: '<path d="M3 7.5A1.5 1.5 0 0 1 4.5 6h4l2 2.2H19.5A1.5 1.5 0 0 1 21 9.7v8.3A1.5 1.5 0 0 1 19.5 19.5h-15A1.5 1.5 0 0 1 3 18z"></path>',
  link: '<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1"></path><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"></path>',
  shield: '<path d="M12 3l8 3v6c0 4.5-3.4 7.6-8 9-4.6-1.4-8-4.5-8-9V6l8-3z"></path><path d="M9 12l2 2 4-4"></path>',
  pulse: '<path d="M3 12h4l2-5 4 10 2-5h6"></path>',
  gear: '<circle cx="12" cy="12" r="3"></circle><path d="M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3M5.3 5.3l2.1 2.1M16.6 16.6l2.1 2.1M5.3 18.7l2.1-2.1M16.6 7.4l2.1-2.1"></path>',
  trash: '<path d="M3 6h18M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2m2 0v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"></path><path d="M10 11v6M14 11v6"></path>',
  spinner: '<path d="M12 3a9 9 0 1 0 9 9"></path>',
  bag: '<path d="M5 8h14l-1.2 12H6.2L5 8z"></path><path d="M9 10V6.5a3 3 0 0 1 6 0V10"></path>',
  tray: '<path d="M4 13h4l1.5 2.5h5L16 13h4"></path><path d="M5.5 5h13L21 13v5a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-5z"></path>',
  chat: '<path d="M20 12a7.5 7.5 0 0 1-10.9 6.7L4 20l1.4-4.3A7.5 7.5 0 1 1 20 12z"></path>',
  plug: '<path d="M9 3v5M15 3v5"></path><path d="M6 8h12v3a6 6 0 0 1-12 0V8z"></path><path d="M12 17v4"></path>',
  cube: '<path d="M12 3l8 4.5v9L12 21l-8-4.5v-9L12 3z"></path><path d="M4 7.5l8 4.5 8-4.5M12 12v9"></path>',
  agent: '<rect x="4" y="8" width="16" height="12" rx="3"></rect><path d="M12 4v4M9 13h.01M15 13h.01"></path>',
  skill: '<path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z"></path>',
  layers: '<path d="M12 3l9 4.5-9 4.5-9-4.5z"></path><path d="M3 12l9 4.5 9-4.5"></path><path d="M3 16.5l9 4.5 9-4.5"></path>',
  none: '<rect x="5" y="5" width="14" height="14" rx="3" stroke-dasharray="3 3"></rect>',
});

const px = (size) => (Number(size) > 0 ? Number(size) : 16);

/** The SVG markup for icon `name` at `size` px. An unknown name gives an empty box, as homeIcon did. */
export function iconSvg(name, size = 16) {
  return `${open(px(size))}${Object.hasOwn(ICONS, name) ? ICONS[name] : ''}</svg>`;
}

/** A `span` (class `cls`, `size` px square, aria-hidden) holding icon `name`; the button around it carries the label. */
export function icon(doc, name, size = 16, cls = 'ic') {
  const span = doc.createElement('span');
  span.className = cls;
  span.setAttribute('aria-hidden', 'true');
  span.style.width = `${px(size)}px`;
  span.style.height = `${px(size)}px`;
  span.innerHTML = iconSvg(name, size);
  return span;
}
