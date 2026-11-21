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
  // OpenAI's own API lists models whose names hold no `gpt` (Google's is `text-embedding-004`).
  [/gpt|codex|\bo[1-9]\b|openai|whisper|dall-e|\btts-1\b|\bsora-|davinci|babbage|text-embedding-(?:3|ada)|omni-moderation|computer-use-preview/, 'openai'],
  [/gemini|gemma/, 'google'],
  [/grok/, 'xai'],
  [/kimi|moonshot/, 'moonshot'],
  [/\bmai-|\bphi-/, 'microsoft'],
  [/ernie/, 'baidu'],
  // "ollama" is a server's word wherever it stands; no Meta model name holds it.
  [/(?<!o)llama/, 'meta'],
  [/mistral|mixtral|codestral|devstral/, 'mistral'],
  [/deepseek/, 'deepseek'],
  [/qwen|qwq/, 'qwen'],
  [/glm/, 'zhipu'],
  [/command-r/, 'cohere'],
  [/\bnova-/, 'amazon'],
  [/minimax/, 'minimax'],
]);

const isVendor = (key) => Object.hasOwn(VENDOR_MARKS, key);

/** The suffix an import adds to a label: the connection's name (" (Copilot)", " (OpenRouter)", " (OpenAI-compatible)"),
 *  never the vendor's; a server's own name (" (Ollama)") is not one. catalogue-model.mjs displayName drops it too. */
export const CONNECTION_SUFFIX_RE = / \((?:Copilot|OpenRouter|OpenAI-compatible)\)$/;

// A model imported from an endpoint has a label ending in its server's name (src/core/bridge/providers/endpoint.mjs
// SERVERS). It is not the vendor, and "Ollama" and "llama.cpp" hold Meta's family word: the guess drops it.
// " (Google Gemini)" names the vendor and stays a clue.
const SERVER_SUFFIX_RE = / \((Ollama|llama\.cpp|LM Studio|vLLM)\)$/;

// Duplicate (models-view.mjs suggestDuplicateId, suggestDuplicateLabel) adds `-copy` or `-copy-<n>` to the id and
// ` copy` to the label, once for each copy of a copy. Read from a short tail, so a long id costs no more than its length.
const COPY_RE = /[- ]copy(?:[- ]\d{1,3})?$/;
function withoutCopies(s) {
  let t = s;
  for (let m = COPY_RE.exec(t.slice(-9)); m; m = COPY_RE.exec(t.slice(-9))) t = t.slice(0, t.length - m[0].length);
  return t;
}

// An id minted for a model reached through a server or a connection is `<word>-<the model's name, slugged>`: the word
// names where it came from (endpoint.mjs endpointIdPrefix: `ollama`, `llama`, `local`, a host's `groq`, at most 16
// characters; connections.mjs suggestModelHandle: `openai`, `anthropic`, `copilot`, `gw`; copilot.mjs copilotCatalogId),
// never the model, and `ollama`, `llama` and `openai` hold a family word. The name is the upstream model's, or the one
// an imported model's label still gives after its wire id was edited. The slugs differ (endpoint.mjs slugModelId drops
// the path and `.gguf` and cuts at 48 characters, a hosted id is cut at 64), so the rest is compared by its letters and
// digits, a cut one by its start. An id typed by hand (`llama-guard` for `llama-guard3:8b`) is no such handle.
const SLUG_CUT = 48;
const WORD_MAX = 16;
const letters = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '');
const nameKeys = (name) => {
  const last = name.split(/[\\/]/).pop();
  return [name, last, last.replace(/\.gguf$/i, '')].map(letters);
};
function mintedRest(id, names) {
  const keys = [...new Set(names.filter(Boolean).flatMap(nameKeys))].filter(Boolean);
  for (let i = id.indexOf('-'); i > 0 && i <= WORD_MAX; i = id.indexOf('-', i + 1)) {
    const rest = id.slice(i + 1);
    const r = letters(rest);
    if (r && keys.some((n) => n === r || (rest.length >= SLUG_CUT && n.startsWith(r)))) return rest;
  }
  return null;
}

// The words only a minter puts first: a server's (endpoint.mjs ID_PREFIX) and a connection's. They never name the
// model's maker (`openai` and `anthropic` are minted for a connection serving any vendor's model), so such an id is read
// without its word however its rest came to be (`ollama-coder` typed for `qwen3-coder:30b`). llama.cpp's `llama` is
// also Meta's family word: it is the server's only beside its label's " (llama.cpp)". A host's word can hold dashes
// and is only dropped by an exact mint; a vendor's own API names it after the vendor (`mistral-` from api.mistral.ai),
// which stays a last clue.
const SOURCE_WORDS = new Set(['ollama', 'lmstudio', 'vllm', 'local', 'openrouter', 'dashscope', 'openai', 'anthropic', 'copilot', 'gw']);
const SERVER_WORDS = Object.freeze({ Ollama: 'ollama', 'llama.cpp': 'llama', 'LM Studio': 'lmstudio', vLLM: 'vllm' });
function sourceRest(id, server) {
  const i = id.indexOf('-');
  const word = i > 0 ? id.slice(0, i) : '';
  return word && (SOURCE_WORDS.has(word) || word === SERVER_WORDS[server]) ? id.slice(i + 1) : null;
}

/**
 * The model's vendor: a VENDOR_MARKS key or null. In order: the vendor prefix of `upstream.model` through the
 * aliases (an unknown prefix goes on to the family guess); a built-in (no upstream, no env keys) is Anthropic's when
 * it is a `claude-` model on the Claude engine or none, OpenAI's on the Codex engine; the family guess over the id
 * and the label, less what a Duplicate adds, a label that only repeats the id (GET /api/models lists a blank one as
 * the id), a connection's or server's name and the word a server or connection put first (mintedRest, sourceRest);
 * that word when it is a vendor's and no source word (SOURCE_WORDS); else null.
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
  const base = withoutCopies(id).toLowerCase();
  const shown = withoutCopies(String(m.label ?? ''));
  const bare = shown.toLowerCase() === base ? '' : shown.replace(CONNECTION_SUFFIX_RE, '');
  const server = SERVER_SUFFIX_RE.exec(bare)?.[1] ?? '';
  const label = bare.replace(SERVER_SUFFIX_RE, '');
  const rest = mintedRest(base, [upstream, label === shown ? '' : label]) ?? sourceRest(base, server);
  const own = rest ?? base;
  const text = `${own} ${label}`.toLowerCase();
  for (const [re, key] of FAMILIES) if (re.test(text)) return key;
  const word = rest === null ? '' : base.slice(0, base.length - rest.length - 1);
  return isVendor(word) && !SOURCE_WORDS.has(word) ? word : null;
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

/** ADD-2, FRM-1 ("a select with marks"): span.mdl-picksel holding `sel` itself and, inside its left edge, the sm
 *  markTile of `kind` ('provider' | 'harness') for the picked value, as the mock's closed select draws it. The mark
 *  follows every change event; a value set by code needs paintMarkedSelect. A value with no mark draws none. */
export function markedSelect(doc, sel, kind) {
  const wrap = doc.createElement('span');
  wrap.className = 'mdl-picksel';
  wrap.dataset.markKind = kind;
  wrap.append(sel);
  sel.addEventListener('change', () => paintMarkedSelect(wrap));
  paintMarkedSelect(wrap);
  return wrap;
}

/** Repaints a markedSelect's mark from its select's value (after code set it). */
export function paintMarkedSelect(wrap) {
  const sel = wrap && wrap.querySelector(':scope > select');
  if (!sel) return;
  wrap.querySelector(':scope > .mdl-mark')?.remove();
  const kind = wrap.dataset.markKind;
  const slug = Object.hasOwn(SLUG_TABLES, kind) ? SLUG_TABLES[kind](String(sel.value)) : null;
  wrap.classList.toggle('has-mark', !!slug);
  if (slug) wrap.prepend(markTile(wrap.ownerDocument, { kind, key: sel.value, size: 'sm' }));
}

/** markTile for a model row: its vendor's mark, else 'plugin' (plugin models) or 'own'. */
export function modelMark(doc, model, size = 'md') {
  const key = vendorOf(model);
  if (key) return markTile(doc, { kind: 'vendor', key, size, label: VENDOR_MARKS[key].name });
  if (model?.plugin) return markTile(doc, { kind: 'plugin', key: String(model.plugin), size });
  return markTile(doc, { kind: 'own', size });
}
