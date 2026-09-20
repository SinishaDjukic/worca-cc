// src/shared/graph/script-icons.mjs
// The twenty icons a script picks from (script-wizard plan S9), as the SAME SVG
// fragments a sidecar stores in `icon` — so the canvas, the manifest, the run
// monitor and a plugin export never learn a second shape. Stroke icons on a
// 24×24 box; no fill or stroke attribute (the tile and the canvas set the
// colour). Every fragment passes manifest.mjs's sanitizeIcon unchanged (pinned).
// Names are plain words that are NOT DOM globals: test/shared-graph-purity.test.mjs
// scans this file's code for `document` / `window` / `navigator` — so the page icon is `page`.
export const SCRIPT_ICONS = Object.freeze([
  { name: 'terminal', svg: '<path d="M4 17l6-5-6-5"/><path d="M12 19h8"/>' },
  { name: 'code', svg: '<path d="M8 4l-4 8 4 8"/><path d="M16 4l4 8-4 8"/>' },
  { name: 'flask', svg: '<path d="M9 3h6"/><path d="M10 3v6L4.5 19a1 1 0 0 0 .9 1.5h13.2a1 1 0 0 0 .9-1.5L14 9V3"/><path d="M7 15h10"/>' },
  { name: 'branch', svg: '<circle cx="6" cy="6" r="2"/><circle cx="6" cy="18" r="2"/><circle cx="18" cy="8" r="2"/><path d="M6 8v8"/><path d="M18 10a6 6 0 0 1-6 6h-2"/>' },
  { name: 'page', svg: '<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5"/><path d="M9 13h6M9 17h6"/>' },
  { name: 'funnel', svg: '<path d="M4 5h16l-6 7v6l-4 2v-8z"/>' },
  { name: 'bolt', svg: '<path d="M13 3L5 14h6l-1 7 8-11h-6z"/>' },
  { name: 'globe', svg: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18"/><path d="M12 3a14 14 0 0 1 0 18a14 14 0 0 1 0-18z"/>' },
  { name: 'gear', svg: '<circle cx="12" cy="12" r="3"/><circle cx="12" cy="12" r="7"/><path d="M12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6l1.5 1.5M16.9 16.9l1.5 1.5M5.6 18.4l1.5-1.5M16.9 7.1l1.5-1.5"/>' },
  { name: 'shield', svg: '<path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z"/>' },
  { name: 'database', svg: '<ellipse cx="12" cy="6" rx="8" ry="3"/><path d="M4 6v12c0 1.7 3.6 3 8 3s8-1.3 8-3V6"/><path d="M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3"/>' },
  { name: 'box', svg: '<path d="M12 3l8 4.5v9L12 21l-8-4.5v-9z"/><path d="M4 7.5l8 4.5 8-4.5M12 12v9"/>' },
  { name: 'clock', svg: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>' },
  { name: 'bug', svg: '<rect x="8" y="8" width="8" height="11" rx="4"/><path d="M12 8V5M4 13h4M16 13h4M5 19l3-2.5M19 19l-3-2.5M9 5l-1-2M15 5l1-2"/>' },
  { name: 'chart', svg: '<path d="M5 20v-8M11 20V5M17 20v-5M3 20h18"/>' },
  { name: 'lock', svg: '<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>' },
  { name: 'cloud', svg: '<path d="M18 10h-1.3A8 8 0 1 0 9 20h9a5 5 0 0 0 0-10z"/>' },
  { name: 'search', svg: '<circle cx="11" cy="11" r="6.5"/><path d="M20 20l-4.3-4.3"/>' },
  { name: 'mail', svg: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 7l9 6 9-6"/>' },
  { name: 'tag', svg: '<path d="M3 12V4h8l9 9-8 8z"/><circle cx="7.5" cy="8.5" r="1.2"/>' },
].map(Object.freeze));

/** The glyph a script card wears when its sidecar ships no icon: an ƒ. (Moved from
 *  ui/public/graph/view.mjs, which re-exports it.) */
export const SCRIPT_GLYPH = '<path d="M15 4h-1.2a2.8 2.8 0 0 0-2.8 2.8V9H8M11 9v6.2A2.8 2.8 0 0 1 8.2 18H7" stroke-linecap="round" stroke-linejoin="round"></path>';

const byName = new Map(SCRIPT_ICONS.map((i) => [i.name, i.svg]));
const bySvg = new Map(SCRIPT_ICONS.map((i) => [i.svg, i.name]));

/** The set's name for a stored fragment, '' for anything else (a hand-written icon keeps rendering, no tile lights). */
export function iconNameOf(svg) {
  return bySvg.get(String(svg || '').trim()) || '';
}

export function iconSvgOf(name) {
  return byName.get(String(name || '')) || '';
}
