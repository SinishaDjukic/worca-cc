// The line icons of a Rail page (docs/rail/components.md): one set, so no page keeps its own copy of a path.
const P = (d) => `<path d="${d}"></path>`;
export const ICONS = {
  check: P('M5 12.5l4.5 4.5L19 7.5'),
  now: '<circle cx="12" cy="12" r="4" fill="currentColor" stroke="none"></circle>',
  question: P('M9.2 9.2a2.9 2.9 0 1 1 4.2 2.6c-.9.5-1.4 1.1-1.4 2v.4') + P('M12 17.6h.01'),
  alert: P('M12 6.8v6.6') + P('M12 17.6h.01'),
  pause: P('M9 5v14M15 5v14'),
  stop: '<rect x="7" y="7" width="10" height="10" rx="1.5"></rect>',
  merge: '<circle cx="6" cy="5.5" r="2.2"></circle><circle cx="6" cy="18.5" r="2.2"></circle><circle cx="18" cy="12" r="2.2"></circle>' + P('M6 7.7v8.6') + P('M6 7.7c0 2.4 2.5 4.3 9.8 4.3'),
  refresh: P('M20 11a8 8 0 1 0-2.3 5.7M20 4v7h-7'),
  copy: '<rect x="9" y="9" width="11" height="11" rx="2"></rect>' + P('M5 15V6a2 2 0 0 1 2-2h8'),
  chevron: P('M6 9.5l6 6 6-6'),
  chevR: P('M9 6l6 6-6 6'),
  chevL: P('M15 6l-6 6 6 6'),
  plus: P('M12 5v14M5 12h14'),
  x: P('M7 7l10 10M17 7 7 17'),
  prc: '<circle cx="6" cy="6" r="2.5"></circle>' + P('M6 8.5V21M13 6h3a2 2 0 0 1 2 2v3M18 15v6M15 18h6'),
  pr: '<circle cx="6" cy="6" r="2.2"></circle><circle cx="6" cy="18" r="2.2"></circle><circle cx="18" cy="18" r="2.2"></circle>' + P('M6 8.2v7.6') + P('M18 15.8V9a3 3 0 0 0-3-3h-4') + P('M13 3.5 10.5 6 13 8.5'),
  up: P('M12 19V5M6 11l6-6 6 6'),
  download: P('M12 4v11M7 10.5l5 5 5-5M5 20h14'),
  play: P('M8 5.5v13l10.5-6.5z'),
  after: P('M5 12h11M12 7l5 5-5 5M20 5v14'),
  folder: P('M3 7.5A1.5 1.5 0 0 1 4.5 6h4l2 2.2H19.5A1.5 1.5 0 0 1 21 9.7v8.3A1.5 1.5 0 0 1 19.5 19.5h-15A1.5 1.5 0 0 1 3 18z'),
  signal: '<circle cx="12" cy="12" r="1.8" fill="currentColor" stroke="none"></circle>' + P('M8.5 8.5a5 5 0 0 0 0 7M15.5 8.5a5 5 0 0 1 0 7M5.6 5.6a9 9 0 0 0 0 12.8M18.4 5.6a9 9 0 0 1 0 12.8'),
  runs: P('M4 6h16M4 12h16M4 18h10'),
  chat: P('M5 5h14a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1H10l-4 3v-3H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1z'),
  clock: '<circle cx="12" cy="12" r="8"></circle>' + P('M12 8v4l3 2'),
  gear: '<circle cx="12" cy="12" r="3"></circle>' + P('M12 3v2.5M12 18.5V21M3 12h2.5M18.5 12H21M5.6 5.6l1.8 1.8M16.6 16.6l1.8 1.8M5.6 18.4l1.8-1.8M16.6 7.4l1.8-1.8'),
  more: '<circle cx="5" cy="12" r="1.4" fill="currentColor" stroke="none"></circle><circle cx="12" cy="12" r="1.4" fill="currentColor" stroke="none"></circle><circle cx="19" cy="12" r="1.4" fill="currentColor" stroke="none"></circle>',
  updown: P('M8 10l4-4 4 4M8 14l4 4 4-4'),
  sliders: P('M4 7.5h9M17 7.5h3M4 16.5h3M11 16.5h9') + '<circle cx="15" cy="7.5" r="2"></circle><circle cx="9" cy="16.5" r="2"></circle>',
  away: P('M14 2.2a1.8 1.8 0 1 1 0 3.6 1.8 1.8 0 0 1 0-3.6z') + P('M13 8l-1.5 5.5') + P('M8.5 12l2-3.2 2.5-.8 2.5 2.5 2.5 1') + P('M11.5 13.5l2.5 3 1 4.5') + P('M11.5 13.5l-1.5 3.5-3 3.5'),
  cup: P('M5 9h11v5a5 5 0 0 1-5 5h-1a5 5 0 0 1-5-5z') + P('M16 10.5h1.5a2.5 2.5 0 0 1 0 5H16') + P('M9 3.5v2.5M12.5 3.5v2.5'),
  monitor: P('M4 4.5h16a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1v-9a1 1 0 0 1 1-1z') + P('M8.5 19.5h7M12 15.5v4'),
  sun: '<circle cx="12" cy="12" r="4"></circle>' + P('M12 2.5v2M12 19.5v2M2.5 12h2M19.5 12h2M5.3 5.3l1.4 1.4M17.3 17.3l1.4 1.4M5.3 18.7l1.4-1.4M17.3 6.7l1.4-1.4'),
  moon: P('M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9z'),
  contrast: '<circle cx="12" cy="12" r="8"></circle><path d="M12 4a8 8 0 0 1 0 16z" fill="currentColor" stroke="none"></path>',
  tag: '<path d="M3 12V4a1 1 0 0 1 1-1h8l9 9-9 9z"></path><circle cx="8" cy="8" r="1.4" fill="currentColor"></circle>',
  sparkle: P('M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z'),
  dots: '<circle cx="5" cy="12" r="1.8" fill="currentColor" stroke="none"></circle><circle cx="12" cy="12" r="1.8" fill="currentColor" stroke="none"></circle><circle cx="19" cy="12" r="1.8" fill="currentColor" stroke="none"></circle>',
  chevSide: P('M9.5 6l6 6-6 6'),
  whoYou: P('M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8z') + P('M4.5 20a7.5 7.5 0 0 1 15 0'),
  whoAway: P('M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z'),
  whoDefault: P('M12 3v4M12 17v4M3 12h4M17 12h4'),
  eye: P('M2.5 12s3.5-6.5 9.5-6.5S21.5 12 21.5 12s-3.5 6.5-9.5 6.5S2.5 12 2.5 12z') + '<circle cx="12" cy="12" r="2.5"></circle>',
};

/** An icon's SVG, or '' for a name the set does not have. */
export function icon(name, size = 14, { stroke = 2, cls = '' } = {}) {
  if (!ICONS[name]) return '';
  return `<svg${cls ? ` class="${cls}"` : ''} width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${stroke}" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name]}</svg>`;
}
