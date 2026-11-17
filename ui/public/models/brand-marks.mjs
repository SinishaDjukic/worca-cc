// ui/public/models/brand-marks.mjs — the Models page's brand marks (models-menu contract C3). A harness, a provider or
// a model's vendor shows its logo from the icon pack, served one file at a time at /vendor/brand-icons on a tile that
// is light in both themes. With no known vendor the user's own model shows the worca mark on the blue gradient and a
// plugin's model the Marketplace bag on a gradient picked from the plugin's name. A vendor is worked out from the
// model's ids and name, never stored.
import { icon } from '../icons.mjs';

/** Engine → icon slug of the pack. */
export const HARNESS_MARKS = Object.freeze({
  claude: 'claudecode-color', codex: 'codex-color', copilot: 'githubcopilot', cursor: 'cursor',
  gemini: 'geminicli-color', goose: 'goose', opencode: 'opencode', qwen: 'qwen-color',
});

/** Provider → icon slug of the pack. */
export const PROVIDER_MARKS = Object.freeze({
  copilot: 'githubcopilot', openrouter: 'openrouter', openai: 'openai', anthropic: 'anthropic',
});

const vendor = (slug, name) => Object.freeze({ slug, name });

/** Vendor key → { slug, name }. vendorOf answers one of these keys or null. */
export const VENDOR_MARKS = Object.freeze({
  anthropic: vendor('claude-color', 'Anthropic'),
  openai: vendor('openai', 'OpenAI'),
  google: vendor('google-color', 'Google'),
  xai: vendor('xai', 'xAI'),
  microsoft: vendor('microsoft-color', 'Microsoft'),
  moonshot: vendor('moonshot', 'Moonshot AI'),
  baidu: vendor('baidu-color', 'Baidu'),
  meta: vendor('meta-color', 'Meta'),
  mistral: vendor('mistral-color', 'Mistral'),
  deepseek: vendor('deepseek-color', 'DeepSeek'),
  qwen: vendor('qwen-color', 'Qwen'),
  zhipu: vendor('zhipu-color', 'Zhipu'),
  cohere: vendor('cohere-color', 'Cohere'),
  nvidia: vendor('nvidia-color', 'NVIDIA'),
  perplexity: vendor('perplexity-color', 'Perplexity'),
  amazon: vendor('aws-color', 'Amazon'),
  minimax: vendor('minimax-color', 'MiniMax'),
});

// Upstream id prefixes that are not a vendor key as written.
const VENDOR_ALIASES = Object.freeze({
  'x-ai': 'xai', 'meta-llama': 'meta', mistralai: 'mistral', moonshotai: 'moonshot', 'z-ai': 'zhipu',
});

// The family guess over a model's id and name: the first match wins.
const FAMILIES = Object.freeze([
  [/claude|opus|sonnet|haiku|fable/, 'anthropic'],
  [/gpt|codex|\bo[1-9]\b|openai/, 'openai'],
  [/gemini|gemma/, 'google'],
  [/grok/, 'xai'],
  [/kimi|moonshot/, 'moonshot'],
  [/\bmai-|\bphi-/, 'microsoft'],
  [/ernie/, 'baidu'],
  [/llama/, 'meta'],
  [/mistral|mixtral|codestral|devstral/, 'mistral'],
  [/deepseek/, 'deepseek'],
  [/qwen|qwq/, 'qwen'],
  [/glm/, 'zhipu'],
  [/command-r/, 'cohere'],
  [/\bnova-/, 'amazon'],
  [/minimax/, 'minimax'],
]);

const isVendor = (key) => Object.hasOwn(VENDOR_MARKS, key);

/**
 * The model's vendor: a VENDOR_MARKS key or null. In order: the vendor prefix of `upstream.model` through the
 * aliases (an unknown prefix goes on to the family guess); a built-in (no upstream, no env keys) is Anthropic's when
 * it is a `claude-` model on the Claude engine or none, OpenAI's on the Codex engine; the family guess over the id
 * and the label; else null.
 */
export function vendorOf(model) {
  const m = model || {};
  const id = String(m.id ?? '');
  const upstream = String(m.upstream?.model ?? '');
  if (upstream.includes('/')) {
    const prefix = upstream.slice(0, upstream.indexOf('/')).toLowerCase();
    const key = Object.hasOwn(VENDOR_ALIASES, prefix) ? VENDOR_ALIASES[prefix] : prefix;
    if (isVendor(key)) return key;
  }
  if (!m.upstream && Object.keys(m.env || {}).length === 0) {
    if ((!m.engine || m.engine === 'claude') && id.startsWith('claude-')) return 'anthropic';
    if (m.engine === 'codex') return 'openai';
  }
  const text = `${id} ${m.label ?? ''}`.toLowerCase();
  for (const [re, key] of FAMILIES) if (re.test(text)) return key;
  return null;
}

/** The address of a mark of the pack. */
export function markUrl(slug) {
  return `/vendor/brand-icons/${encodeURIComponent(slug)}.svg`;
}

const GRADIENTS = Object.freeze(['indigo', 'teal', 'pink', 'blue', 'lime', 'slate']);

/** One of six gradient names, stable for a name: 'indigo'|'teal'|'pink'|'blue'|'lime'|'slate'. */
export function gradientOf(name) {
  let h = 0;
  for (const ch of String(name ?? '')) h = (Math.imul(h, 31) + ch.codePointAt(0)) >>> 0;
  return GRADIENTS[h % GRADIENTS.length];
}

// The glyph inside a tile, by tile size: icon() writes inline px, so CSS cannot size it.
const GLYPH_PX = Object.freeze({ sm: 12, md: 16, lg: 20, xl: 24 });

const SLUG_TABLES = Object.freeze({
  harness: (key) => (Object.hasOwn(HARNESS_MARKS, key) ? HARNESS_MARKS[key] : null),
  provider: (key) => (Object.hasOwn(PROVIDER_MARKS, key) ? PROVIDER_MARKS[key] : null),
  vendor: (key) => (isVendor(key) ? VENDOR_MARKS[key].slug : null),
});

const img = (doc, src, alt) => {
  const el = doc.createElement('img');
  el.setAttribute('src', src);
  el.setAttribute('alt', alt);
  return el;
};

/**
 * span.mdl-mark[.sm|.lg|.xl]. kind 'harness'|'provider'|'vendor' → the pack's mark as an image (alt = label; an
 * unknown key draws the cube on a blank tile); 'own' → the worca mark on the blue gradient; 'plugin' → the
 * Marketplace bag on gradientOf(key); 'glyph' → the icons.mjs icon `key` on a blank tile.
 */
export function markTile(doc, { kind, key = '', size = 'md', label = '' } = {}) {
  const tile = doc.createElement('span');
  const tileSize = Object.hasOwn(GLYPH_PX, size) ? size : 'md';
  const px = GLYPH_PX[tileSize];
  tile.className = tileSize === 'md' ? 'mdl-mark' : `mdl-mark ${tileSize}`;
  const slug = Object.hasOwn(SLUG_TABLES, kind) ? SLUG_TABLES[kind](String(key)) : null;
  if (slug) {
    tile.append(img(doc, markUrl(slug), String(label ?? '')));
  } else if (kind === 'own') {
    tile.classList.add('own', 'g-blue');
    tile.append(img(doc, '/assets/worca-mark-mask.png', ''));
  } else if (kind === 'plugin') {
    tile.classList.add('own', `g-${gradientOf(key)}`);
    tile.append(icon(doc, 'bag', px));
  } else {
    tile.classList.add('blank');
    tile.append(icon(doc, kind === 'glyph' ? String(key) : 'cube', px));
  }
  return tile;
}

/** markTile for a model row: its vendor's mark, else 'plugin' (plugin models) or 'own'. */
export function modelMark(doc, model, size = 'md') {
  const key = vendorOf(model);
  if (key) return markTile(doc, { kind: 'vendor', key, size, label: VENDOR_MARKS[key].name });
  if (model?.plugin) return markTile(doc, { kind: 'plugin', key: String(model.plugin), size });
  return markTile(doc, { kind: 'own', size });
}
