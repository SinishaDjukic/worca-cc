// ui/public/models/provider-state.mjs — the Providers tab's state words and folded summary lines (models-menu P3,
// DESIGN PRV-7). Pure: no DOM. Each row of PROVIDER_ROWS gets a state { tone, text, fix } and a one-line summary
// worked out from GET /api/providers; a missing payload, a missing block or an unparsable address falls back to the
// defaults the Providers tab's rows render with (bridge-view.mjs).
import { IMAGE_SERVICES } from '../../../src/shared/image-services.mjs';
import { brokerState, providerRowOf } from '../bridge-view.mjs';

/** Each block when the payload has none: the server's defaults, as bridge-view.mjs renders them. */
const DEFAULTS = Object.freeze({
  copilot: Object.freeze({ connected: false, accountType: 'individual', maxConcurrent: 4 }),
  openrouter: Object.freeze({ keySet: false, keySource: null, keyRef: null, keyMasked: null, legacyKey: false, maxConcurrent: 8 }),
  openai: Object.freeze({ configured: false, keySet: false, baseUrl: '', maxConcurrent: 8 }),
  anthropic: Object.freeze({ configured: false, keySet: false, baseUrl: '', maxConcurrent: 8 }),
});

/** The rows whose key the credential broker holds while it is on, and whose models providerModelCounts counts. */
const MODEL_ROWS = Object.freeze(['copilot', 'openrouter', 'openai', 'anthropic']);

const blockOf = (providers, name) => ({ ...(DEFAULTS[name] || {}), ...((providers || {})[name] || {}) });
const state = (tone, text, fix = '') => ({ tone, text, fix });
const capital = (text) => text.charAt(0).toUpperCase() + text.slice(1);
/** A `${VAR}` reference as the payload sends it; the generic one when it sends none. */
const refOf = (ref) => ref || '${VAR}';

/** The broker pill's words as a row state: green is ok, red is fail, "add your … on the key page" is need, other grey is off. */
function brokerRowState(pill) {
  const tone = pill.cls === 'green' ? 'ok' : pill.cls === 'red' ? 'fail' : pill.text.startsWith('add your ') ? 'need' : 'off';
  return state(tone, capital(pill.text));
}

function copilotState(c, hasModels) {
  if (c.connected) return state('ok', 'Connected');
  if (c.tokenSource === 'env') return state('fail', `Token ${refOf(c.tokenRef)} not set`);
  if (hasModels) return state('need', 'Needs sign-in', 'Sign in');
  return state('off', 'Not connected');
}

/** openrouter, openai and anthropic: a key Worca holds, kept as text or as a `${VAR}` reference. */
function keyedState(name, k, hasModels) {
  if (name === 'openrouter') {
    if (k.legacyKey && k.keySet) return state('ok', 'Key from OpenAI-compatible');
    if (k.keySet) return state('ok', 'Key set');
  } else if (k.configured) return state('ok', 'Key set');
  if (k.keySource === 'env') return state('fail', `Key ${refOf(k.keyRef)} not set`);
  if (k.keyOptional) return state('ok', 'Local, no key needed');
  if (hasModels) return state('need', 'Needs key', 'Set key');
  return state('off', 'No key');
}

/** Speech: only a side that runs on your server (engine 'server') can need anything. */
function speechState(sp) {
  const servers = ['stt', 'tts'].map((kind) => (sp && sp[kind]) || {}).filter((side) => side.engine === 'server');
  const missing = servers.find((side) => side.keyMissing);
  if (missing) return state('fail', `Key ${refOf(missing.keyRef)} not set`);
  if (servers.some((side) => !side.configured)) return state('need', 'Not configured');
  if (servers.length) return state('ok', 'Configured');
  return state('ok', 'In the browser');
}

/** The image service a payload names; OpenAI when it names none (as the Images row renders it). */
const imageServiceOf = (im) => IMAGE_SERVICES[im.service || 'openai'];

/** Images (PRV-7): the first thing a picture still needs. A row never saved is not set up, not amber. */
function imagesState(im) {
  if (im.configured) return state('ok', 'Ready');
  if (im.price == null && !im.keySet) return state('off', 'Not set up');
  if (im.service === 'other' && !im.baseUrl) return state('need', 'Address missing');
  if (!im.model) return state('need', imageServiceOf(im)?.models?.length ? 'Pick a model' : 'Model missing');
  if (im.price == null) return state('need', 'Price missing');
  if (im.keyMissing) return state('fail', 'Key missing');
  if (!im.keySet) return state('need', 'Key missing');
  return state('off', 'Not set up');
}

function soundState(s) {
  if (s.configured) return state('ok', 'Ready');
  if (s.keyMissing) return state('fail', 'Key missing');
  return state('off', 'Not set up');
}

/** → { tone: 'ok'|'need'|'fail'|'off', text, fix: ''|'Sign in'|'Set key' } for one of PROVIDER_ROWS. */
export function providerState(providers, name, { hasModels = false } = {}) {
  const p = providers || {};
  if (MODEL_ROWS.includes(name) && p.broker && p.broker.enabled) return brokerRowState(brokerState(p.broker, name));
  switch (name) {
    case 'copilot': return copilotState(blockOf(p, name), hasModels);
    case 'openrouter': case 'openai': case 'anthropic': return keyedState(name, blockOf(p, name), hasModels);
    case 'speech': return speechState(p.speech);
    case 'images': return imagesState(p.images || {});
    case 'sound': return soundState(p.sound || {});
    default: return state('off', '');
  }
}

/** An address's host with its port; the text as written when it does not parse. */
function hostOf(url) {
  try { return new URL(String(url)).host; } catch { return String(url ?? ''); }
}

/** The folded row's one line. counts = { copilot, openrouter, openai, anthropic }. */
export function providerSummary(providers, name, counts = {}) {
  const p = providers || {};
  const m = Number((counts || {})[name]) || 0;
  const models = m > 0 ? ` · ${m} ${m === 1 ? 'model' : 'models'}` : '';
  const atATime = (k) => `${k.maxConcurrent} requests at a time${models}`;
  switch (name) {
    case 'copilot': {
      const c = blockOf(p, name);
      return `${capital(String(c.accountType || DEFAULTS.copilot.accountType))} · ${atATime(c)}`;
    }
    case 'openrouter': return `openrouter.ai · ${atATime(blockOf(p, name))}`;
    case 'openai': case 'anthropic': {
      const k = blockOf(p, name);
      return `${hostOf(k.baseUrl)} · ${atATime(k)}`;
    }
    case 'speech': return 'Chat voice · speech-to-text and text-to-speech';
    case 'images': {
      const im = p.images || {};
      const label = (imageServiceOf(im) || IMAGE_SERVICES.openai).label;
      return `Design pictures · ${label}${im.model ? ` · ${im.model}` : ''}`;
    }
    case 'sound': return 'Design voice and music · ElevenLabs';
    default: return '';
  }
}

/** Models (global + plugin + policy) per provider row, by providerRowOf; other rows are not counted. */
export function providerModelCounts(models, providers) {
  const counts = { copilot: 0, openrouter: 0, openai: 0, anthropic: 0 };
  for (const model of Array.isArray(models) ? models : []) {
    const row = providerRowOf(model, providers);
    if (MODEL_ROWS.includes(row)) counts[row] += 1;
  }
  return counts;
}
