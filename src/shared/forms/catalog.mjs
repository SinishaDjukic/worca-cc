// src/shared/forms/catalog.mjs
// The host-owned widget catalog for agent ask forms (ask-forms spec §6.1). A form
// names widgets by string; only names listed here ever render. Pure and isomorphic:
// the registry, the plugin validator, the server and the browser read the same tables.

/** Bumped when a widget is added. A layout item may say `requires: { askCatalog: n }`. */
export const ASK_CATALOG_VERSION = 1;

export const INPUT_WIDGETS = Object.freeze(['text', 'textarea', 'number', 'slider', 'toggle', 'date',
  'select', 'multiselect', 'rank', 'table-select', 'review-list', 'gallery']);
export const DISPLAY_WIDGETS = Object.freeze(['markdown', 'callout', 'image', 'gallery', 'compare', 'pdf',
  'code', 'diff', 'table', 'json', 'file-list', 'media']);
export const LAYOUT_WIDGETS = Object.freeze(['group', 'columns', 'tabs']);

/** Limits, verbatim from the spec (§3, §7). */
export const ASK_LIMITS = Object.freeze({
  formsPerAgent: 8, askBlockBytes: 65536, filesPerAsk: 24,
  fileBytes: 26214400, askBytes: 104857600, dataBytes: 262144,
});

/** The layout-item vocabulary (spec §6.2): the keys every item may carry, then each widget's own.
 *  Gate 1 refuses anything else, and the renderer reads nothing else — one table, no drift. */
export const COMMON_ITEM_KEYS = Object.freeze(['widget', 'field', 'bind', 'label', 'help', 'when', 'requires', 'fallback']);
export const LAYOUT_ITEM_KEYS = Object.freeze({
  text: Object.freeze(['placeholder', 'mono']),
  textarea: Object.freeze(['placeholder', 'rows']),
  number: Object.freeze(['unit', 'placeholder']),
  slider: Object.freeze(['unit', 'minLabel', 'maxLabel']),
  toggle: Object.freeze([]),
  date: Object.freeze([]),
  select: Object.freeze(['style', 'options', 'labels', 'descriptions', 'tones', 'suggest']),
  multiselect: Object.freeze(['style', 'options', 'labels', 'descriptions']),
  rank: Object.freeze(['titleKey', 'metaKey']),
  'table-select': Object.freeze(['columns']),
  'review-list': Object.freeze(['titleKey', 'bodyKey', 'metaKey', 'labels', 'tones', 'notePlaceholder']),
  gallery: Object.freeze(['captionKey', 'fileKey']),
  markdown: Object.freeze([]),
  callout: Object.freeze(['text', 'title', 'tone']),
  image: Object.freeze(['caption']),
  compare: Object.freeze(['before', 'after', 'beforeLabel', 'afterLabel']),
  pdf: Object.freeze([]),
  media: Object.freeze([]),
  code: Object.freeze(['name', 'lang']),
  diff: Object.freeze(['name']),
  table: Object.freeze(['columns']),
  json: Object.freeze([]),
  'file-list': Object.freeze(['fileKey', 'noteKey']),
  group: Object.freeze(['title', 'children']),
  columns: Object.freeze(['columns']),
  tabs: Object.freeze(['tabs']),
});

const INPUT = new Set(INPUT_WIDGETS);
const DISPLAY = new Set(DISPLAY_WIDGETS);
const LAYOUT = new Set(LAYOUT_WIDGETS);

/** The answer-schema types each input widget can fill. */
const PAIRING = Object.freeze({
  text: ['string'], textarea: ['string'], date: ['string'],
  number: ['number', 'integer'], slider: ['number', 'integer'],
  toggle: ['boolean'],
  select: ['string', 'number', 'integer'],
  multiselect: ['array'], rank: ['array'], 'review-list': ['array'],
  'table-select': ['string', 'array'], gallery: ['string', 'array'],
});

export const isKnownWidget = (name) => INPUT.has(name) || DISPLAY.has(name) || LAYOUT.has(name);

/** 'input' | 'display' | 'layout' | null. `gallery` is the one name in two classes:
 *  with a `field` it collects a pick, without one it only shows. */
export function widgetClass(name, item) {
  if (name === 'gallery') return item && typeof item.field === 'string' ? 'input' : 'display';
  if (INPUT.has(name)) return 'input';
  if (DISPLAY.has(name)) return 'display';
  if (LAYOUT.has(name)) return 'layout';
  return null;
}

/** Can this input widget fill a field of this answer schema? */
export function widgetAcceptsType(name, schema) {
  const types = Object.hasOwn(PAIRING, name) ? PAIRING[name] : null;
  if (!types || !schema || typeof schema !== 'object') return false;
  if (!types.includes(schema.type)) return false;
  if (name === 'date') return schema.format === 'date';
  if (name === 'review-list') {
    const p = schema.items && schema.items.type === 'object' && schema.items.properties;
    return Boolean(p && p.id && p.id.type === 'string' && p.verdict && Array.isArray(p.verdict.enum) && p.verdict.enum.length > 0);
  }
  if (name === 'multiselect' || name === 'rank') return Boolean(schema.items && schema.items.type === 'string');
  return true;
}
