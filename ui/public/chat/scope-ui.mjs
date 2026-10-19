// ui/public/chat/scope-ui.mjs — Projects, any way P4b: the chat scope's shared pieces. Reading a chat's scope from its
// context (as the server's `chatScopeOf` reads it, SEAMS S41), the scope menu's line icons (canvas ScopeMenu) and
// P1b's one kind chip, re-exported so every chat module takes it from here (SEAMS S11). Pure: DOM only through `doc`.
import { KIND_LABELS } from '../run-kind.mjs';

export { kindChip, projectKind } from '../run-kind.mjs';

export const NO_PROJECT_LABEL = KIND_LABELS.none;

const SVG_NS = 'http://www.w3.org/2000/svg';
const FOLDER = 'M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z';
const TILE = { width: 7, height: 7, rx: 1 };

// The children of each icon, in order: [tag, attributes]. One 24×24 stroke set in the sidebar's style.
const ICONS = Object.freeze({
  none: [['circle', { cx: 12, cy: 12, r: 9, 'stroke-dasharray': '3 3' }]],
  project: [['path', { d: FOLDER }]],
  workspace: [
    ['rect', { x: 3, y: 3, ...TILE }],
    ['rect', { x: 14, y: 3, ...TILE }],
    ['rect', { x: 3, y: 14, ...TILE }],
    ['path', { d: 'M17.5 14v7M14 17.5h7' }],
  ],
  add: [['path', { d: FOLDER }], ['path', { d: 'M12 11v6M9 14h6' }]],
});

const nonEmpty = (v) => typeof v === 'string' && v !== '';

/** A chat's scope from its context: a pin (or a stored context without `pinned`) names it by its one key, project
 *  first; `pinned:false`, no key, or no object at all is No project. A `projectDir` alone names nothing. */
export function scopeFromContext(context) {
  const none = { pinned: false, projectKey: null, workspaceId: null };
  if (!context || typeof context !== 'object' || Array.isArray(context) || context.pinned === false) return none;
  if (nonEmpty(context.projectKey)) return { pinned: true, projectKey: context.projectKey, workspaceId: null };
  if (nonEmpty(context.workspaceId)) return { pinned: true, projectKey: null, workspaceId: context.workspaceId };
  return none;
}

/** 'none' | 'project' | 'workspace', by the same rule as `scopeFromContext`. */
export function scopeKind(scope) {
  const s = scopeFromContext(scope);
  if (s.projectKey) return 'project';
  if (s.workspaceId) return 'workspace';
  return 'none';
}

/** A decorative stroke icon for `kind` ('none' | 'project' | 'workspace' | 'add'; anything else draws 'none'). */
export function scopeIcon(doc, kind, size = 14) {
  const svg = doc.createElementNS(SVG_NS, 'svg');
  const attrs = {
    width: size, height: size, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', 'stroke-width': '1.9',
    'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'aria-hidden': 'true', focusable: 'false',
  };
  for (const [k, v] of Object.entries(attrs)) svg.setAttribute(k, String(v));
  for (const [tag, childAttrs] of Object.hasOwn(ICONS, kind) ? ICONS[kind] : ICONS.none) {
    const el = doc.createElementNS(SVG_NS, tag);
    for (const [k, v] of Object.entries(childAttrs)) el.setAttribute(k, String(v));
    svg.appendChild(el);
  }
  return svg;
}
