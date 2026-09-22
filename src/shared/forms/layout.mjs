// src/shared/forms/layout.mjs
// Walking a form layout (spec §3, §10): children of the three layout widgets, `when`
// visibility, and the `requires` / `fallback` downgrade. Every consumer — gate 1, the
// renderer, the projection, answer collection — walks through here so they agree on
// which items exist and which fields are live.
import { ASK_CATALOG_VERSION, isKnownWidget } from './catalog.mjs';

const isObject = (v) => Boolean(v) && typeof v === 'object' && !Array.isArray(v);
const list = (v) => (Array.isArray(v) ? v : []);

/** The item that actually renders on a host with this catalog: the item itself, its
 *  `fallback` (recursively), or null when neither is renderable. */
export function effectiveItem(item, catalogVersion = ASK_CATALOG_VERSION) {
  for (let cur = item, hops = 0; isObject(cur) && hops < 4; cur = cur.fallback, hops += 1) {
    const needs = isObject(cur.requires) && Number.isInteger(cur.requires.askCatalog) ? cur.requires.askCatalog : 1;
    if (isKnownWidget(cur.widget) && needs <= catalogVersion) return cur;
  }
  return null;
}

/** Child item arrays of a layout widget; [] for everything else. */
export function childrenOf(item) {
  if (!isObject(item)) return [];
  if (item.widget === 'group') return [list(item.children)];
  if (item.widget === 'columns') return list(item.columns).map(list);
  if (item.widget === 'tabs') return list(item.tabs).map((t) => list(t && t.children));
  return [];
}

/** Depth-first. `fn(raw, effective, parents)`; children come from the effective item. */
export function walkLayout(layout, fn, parents = []) {
  for (const raw of list(layout)) {
    const eff = effectiveItem(raw);
    fn(raw, eff, parents);
    for (const kids of childrenOf(eff || raw)) walkLayout(kids, fn, [...parents, eff || raw]);
  }
}

/** `{ field: value }` or `{ field: [v1, v2] }`, equality only, all keys must hold. */
export function whenOk(when, values) {
  if (!isObject(when)) return true;
  // own values only: an inherited `constructor` is not something the human answered
  const got = (field) => (isObject(values) && Object.hasOwn(values, field) ? values[field] : undefined);
  return Object.entries(when).every(([field, want]) => (
    Array.isArray(want) ? want.includes(got(field)) : got(field) === want));
}

/** Answer fields whose item — and every ancestor — passes its `when`. */
export function visibleFields(layout, values) {
  const out = [];
  (function visit(items) {
    for (const raw of list(items)) {
      const eff = effectiveItem(raw);
      if (!eff || !whenOk(eff.when, values)) continue;
      if (typeof eff.field === 'string') out.push(eff.field);
      for (const kids of childrenOf(eff)) visit(kids);
    }
  })(layout);
  return out;
}

/** Unique effective widget names, in layout order. */
export function widgetsUsed(layout) {
  const seen = [];
  walkLayout(layout, (raw, eff) => { if (eff && !seen.includes(eff.widget)) seen.push(eff.widget); });
  return seen;
}
