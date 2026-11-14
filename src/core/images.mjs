// src/core/images.mjs
// Design pictures: the one place worca calls an image service (an OpenAI-compatible images
// endpoint, a preset per service, set up on the Providers page beside Speech). The key and the
// call stay in the server: an agent never meets either. `generatePicture` answers bytes; the
// build side saves them. fetch is injectable for tests; mock mode answers a flat PNG and makes
// no call at all.
import { createHash } from 'node:crypto';
import { crc32, deflateSync } from 'node:zlib';
import { setTimeout as sleep } from 'node:timers/promises';
import { imagesConfig, resolveProviderSecret } from './settings.mjs';
import { modelEnvRef, maskModelEnvValue, isUpstreamBaseUrl, isLocalBaseUrl, envFlag } from './model-env.mjs';
import { brokerEnabled } from './broker-client.mjs';
import { sniffMime } from './ask-files.mjs';
import { imageSize } from './ask/show-files.mjs';
import { IMAGE_SERVICES, IMAGE_SHAPES, IMAGE_SIZE, IMAGE_ASPECT, IMAGES_MAX_PROMPT, originOf } from '../shared/image-services.mjs';

export { IMAGES_MAX_PROMPT };

/** A call ends after this long (SPEC D8). */
export const IMAGES_TIMEOUT_MS = 180_000;
/** The largest picture worca keeps (SPEC D8). */
export const IMAGES_MAX_BYTES = 20 * 1024 * 1024;

// A 20 MiB picture as base64, plus room for the JSON around it.
const JSON_CAP = Math.ceil(IMAGES_MAX_BYTES * 4 / 3) + 64 * 1024;
const RETRY_MAX_MS = 30_000;
const MOCK_DELAY_MAX_MS = 10_000;
const MOCK_SIZE = Object.freeze({ wide: [384, 256], tall: [256, 384], square: [256, 256] });
const PICTURE_EXT = new Map([['image/png', 'png'], ['image/jpeg', 'jpg'], ['image/webp', 'webp']]);
const EXT_MIME = Object.freeze({ png: 'image/png', jpg: 'image/jpeg', webp: 'image/webp' });
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const TEST_PROMPT = 'A small blue ceramic cup on a plain light grey table, soft daylight. No text, letters or logos.';

// The reasons of SPEC §7, word for word.
const PICTURES_OFF = 'pictures are off for this design';
const KEY_REJECTED = 'the image service rejected the key';
const UNREACHABLE = 'the image service could not be reached';
const NOT_A_PICTURE = 'the image service answered with something that is not a picture';
const VAR_REFUSED = 'Save the row before testing a key kept in a variable';
const VAR_UNSET = "the key's ${VAR} is not set in worca's environment";

/** A failure with one of SPEC §7's reasons. status: 400 bad input, 409 not set up, 502 the service, 504 time. */
export class ImagesError extends Error {
  constructor(message, status = 502) { super(message); this.name = 'ImagesError'; this.status = status; }
}

/** What a caller's stop rejects with: never an ImagesError, never the words of a §7 reason. */
const abortError = () => new DOMException('This operation was aborted', 'AbortError');

/** Ready = an address, a model, a price (0 counts), and a key that resolves, or no key on a local or private address. */
function readyOf(c) {
  if (!c.baseUrl || !c.model || c.price === null) return false;
  return c.apiKey ? !!resolveProviderSecret(c.apiKey) : isLocalBaseUrl(c.baseUrl);
}

/** GET /api/providers and the Providers page: never a key, only where it comes from. */
export function imagesState() {
  const c = imagesConfig();
  const { apiKey, ...rest } = c;
  const ref = modelEnvRef(apiKey);
  return {
    ...rest,
    configured: readyOf(c),
    settable: !brokerEnabled(),
    keySet: !!apiKey,
    keySource: !apiKey ? null : ref ? 'env' : 'stored',
    keyRef: ref ? apiKey : null,
    keyMasked: apiKey && !ref ? maskModelEnvValue(apiKey) : null,
    keyMissing: !!apiKey && !resolveProviderSecret(apiKey),
  };
}

/** Whether a picture can be asked for now: synchronous, one read of the settings, no network. */
export function imagesReady() {
  return readyOf(imagesConfig());
}

/** Why an ask cannot be made (the §7 words), or null. The prompt is checked as given and sent as given. */
export function pictureAskProblem({ shape, prompt } = {}) {
  if (!IMAGE_SHAPES.includes(shape)) return 'the shape must be wide, tall or square';
  if (typeof prompt !== 'string' || !prompt.trim()) return 'say what the picture shows';
  if (prompt.length > IMAGES_MAX_PROMPT) return `the description is longer than ${IMAGES_MAX_PROMPT} characters`;
  return null;
}

/** { ext, w, h } from a PNG, JPEG or WebP header, else null (GIF and every other type are refused). */
export function pictureSize(bytes) {
  let buf;
  try { buf = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes); } catch { return null; }
  const mime = sniffMime(buf);
  const ext = PICTURE_EXT.get(mime);
  if (!ext) return null;
  const size = imageSize(buf, mime);
  if (!size || !Number.isInteger(size.width) || !Number.isInteger(size.height) || size.width <= 0 || size.height <= 0) return null;
  return { ext, w: size.width, h: size.height };
}

/** Same origin, where an empty or bad address matches nothing. */
function sameOrigin(a, b) {
  const o = originOf(a);
  return o !== '' && o !== 'null' && o === originOf(b);
}

/** localhost, 127.0.0.0/8 or [::1]: this machine only (never a LAN or *.local host). */
function isLoopback(url) {
  if (!isUpstreamBaseUrl(url)) return false;
  const host = new URL(url.trim()).hostname.toLowerCase();
  return host === 'localhost' || host === '[::1]' || /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(host);
}

/**
 * The stored config with what the person TYPED on the row (unsaved) laid over it. A typed key
 * starting `••` is the masked echo: it means the stored key. The stored key only ever goes to the
 * stored address's origin; another typed origin without a typed key is called keyless. A typed
 * ${VAR} is read from worca's environment only for the picked preset's own origin, a loopback
 * address, or when it IS the saved reference at the saved origin, else `varRefused` and no key: an
 * address the caller chose (typed, or saved without a key) must never receive a server secret.
 * With the credential broker on, a typed ${VAR} is never read.
 */
function endpoint(typed) {
  const stored = imagesConfig();
  const t = typed && typeof typed === 'object' ? typed : {};
  const c = { ...stored };
  if (typeof t.service === 'string' && Object.hasOwn(IMAGE_SERVICES, t.service) && t.service !== stored.service) {
    const preset = IMAGE_SERVICES[t.service];
    c.service = t.service;
    c.baseUrl = preset.baseUrl;
    c.model = preset.model;
  }
  if (typeof t.baseUrl === 'string' && isUpstreamBaseUrl(t.baseUrl)) c.baseUrl = t.baseUrl.trim().replace(/\/+$/, '');
  if (typeof t.model === 'string' && t.model.trim()) c.model = t.model.trim();
  let apiKey = '';
  let varRefused = false;
  if (typeof t.apiKey === 'string' && t.apiKey.trim() && !t.apiKey.startsWith('••')) {
    const typedKey = t.apiKey.trim();
    const mayRead = !brokerEnabled() && ((typedKey === stored.apiKey && sameOrigin(c.baseUrl, stored.baseUrl))
      || sameOrigin(c.baseUrl, IMAGE_SERVICES[c.service].baseUrl) || isLoopback(c.baseUrl));
    if (modelEnvRef(typedKey) && !mayRead) varRefused = true;
    else apiKey = typedKey;
  } else if (stored.apiKey && sameOrigin(c.baseUrl, stored.baseUrl)) apiKey = stored.apiKey;
  const key = resolveProviderSecret(apiKey);
  return { ...c, apiKey, key, unresolved: !!apiKey && !key, varRefused };
}

/** A whole-seconds or HTTP-date Retry-After in ms, or null when there is none to honour. */
function retryAfterMs(value) {
  if (typeof value !== 'string' || !value.trim()) return null;
  const v = value.trim();
  if (/^\d+$/.test(v)) return Number(v) * 1000;
  const at = Date.parse(v);
  return Number.isFinite(at) ? Math.max(0, at - Date.now()) : null;
}

/** Leave a body unread (frees the connection); never throws. */
function drop(r) {
  try { r.body?.cancel().catch(() => {}); } catch { /* a locked or odd body */ }
}

/**
 * A response body as bytes, at most `cap` of them (past it: not a picture). Each read races the
 * signal, and a stop cancels the reader: an injected body is not tied to any signal.
 */
async function readCapped(r, cap, signal) {
  if (!r.body) return Buffer.alloc(0);
  const reader = r.body.getReader();
  let onAbort;
  const stopped = new Promise((_, reject) => {
    onAbort = () => reject(signal.reason);
    if (signal.aborted) onAbort(); else signal.addEventListener('abort', onAbort, { once: true });
  });
  stopped.catch(() => {});
  const parts = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await Promise.race([reader.read(), stopped]);
      if (done) break;
      size += value.byteLength;
      if (size > cap) throw new ImagesError(NOT_A_PICTURE);
      parts.push(value);
    }
  } catch (err) {
    reader.cancel().catch(() => {});
    throw err;
  } finally {
    signal.removeEventListener('abort', onAbort);
  }
  return Buffer.concat(parts);
}

/** An http(s) address, query and all. */
function isHttpUrl(u) {
  try { const p = new URL(u).protocol; return p === 'http:' || p === 'https:'; } catch { return false; }
}

/** One flat colour, 8-bit RGB, filter byte 0 per row. */
function flatPng(w, h, rgb) {
  const row = Buffer.alloc(1 + 3 * w);
  for (let x = 0; x < w; x++) rgb.copy(row, 1 + 3 * x);
  const chunk = (type, data) => {
    const body = Buffer.concat([Buffer.from(type, 'latin1'), data]);
    const out = Buffer.alloc(8 + data.length + 4);
    out.writeUInt32BE(data.length, 0);
    body.copy(out, 4);
    out.writeUInt32BE(crc32(body), 4 + body.length);
    return out;
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;   // bit depth
  ihdr[9] = 2;   // RGB
  return Buffer.concat([PNG_SIGNATURE, chunk('IHDR', ihdr), chunk('IDAT', deflateSync(Buffer.concat(Array(h).fill(row)))), chunk('IEND', Buffer.alloc(0))]);
}

/** Mock mode: no call at all. MOCK_DELAY_MS=<n> waits n ms first, MOCK_REFUSE refuses; else a flat PNG of the shape. */
async function mockPicture({ prompt, shape, signal, c, t0 }) {
  const delay = /\bMOCK_DELAY_MS=(\d+)\b/.exec(prompt);
  const n = delay ? Number(delay[1]) : 0;
  if (n > 0 && n <= MOCK_DELAY_MAX_MS) {
    try { await sleep(n, undefined, { signal }); } catch { throw abortError(); }
  }
  if (/\bMOCK_REFUSE\b/.test(prompt)) throw new ImagesError('the image service refused this description: mock', 502);
  const [w, h] = MOCK_SIZE[shape];
  const rgb = createHash('sha256').update(prompt).digest().subarray(0, 3);
  return { bytes: flatPng(w, h, rgb), ext: 'png', w, h, model: c.model, ms: Math.round(performance.now() - t0), costUsd: c.price ?? 0 };
}

/**
 * Make one picture. Fails only with an ImagesError (a §7 reason) or, when the caller's `signal`
 * stops it, an error named AbortError.
 * @returns {Promise<{ bytes: Buffer, ext: 'png'|'jpg'|'webp', w: number, h: number, model: string, ms: number, costUsd: number }>}
 */
export async function generatePicture({ prompt, shape, fetch, signal, typed, timeoutMs = IMAGES_TIMEOUT_MS, mock } = {}) {
  const t0 = performance.now();
  // (0) A stop before the start: nothing is called.
  if (signal?.aborted) throw abortError();
  // (1) The ask itself.
  const problem = pictureAskProblem({ shape, prompt });
  if (problem) throw new ImagesError(problem, 400);
  // (2) The setup.
  const c = endpoint(typed);
  if (!c.baseUrl || !c.model || c.unresolved || c.varRefused) throw new ImagesError(PICTURES_OFF, 409);
  // (3) Mock mode, mockEnabled's rule (a passed fetch does not turn it off).
  if (mock ?? envFlag('WORCA_MOCK', 'ORCH_MOCK')) return mockPicture({ prompt, shape, signal, c, t0 });
  // (4) The deadline, armed before the first await, on the global timers read now; inside the
  // try, so a signal AbortSignal.any refuses is still a reason and the timer is still cleared.
  const deadline = new AbortController();
  let deadlineFired = false;
  let timer;
  const call = fetch ?? globalThis.fetch;
  try {
    timer = setTimeout(() => { deadlineFired = true; deadline.abort(); }, timeoutMs);
    const joined = signal ? AbortSignal.any([signal, deadline.signal]) : deadline.signal;
    // (5) The ask.
    const preset = IMAGE_SERVICES[c.service];
    const body = { model: c.model, prompt, n: 1 };
    if (preset.sizeMode === 'aspect') body.aspect_ratio = IMAGE_ASPECT[shape];
    else body.size = IMAGE_SIZE[shape];
    Object.assign(body, preset.extra);
    if (preset.responseFormat) body.response_format = preset.responseFormat;
    const headers = { 'content-type': 'application/json' };
    if (c.key) headers.authorization = `Bearer ${c.key}`;
    const post = () => call(`${c.baseUrl}${preset.path}`, { method: 'POST', headers, body: JSON.stringify(body), signal: joined });
    let r = await post();
    // (6) A busy service: once more when it asks for 30 s or less.
    if (r.status === 429 || r.status === 503) {
      const wait = retryAfterMs(r.headers.get('retry-after'));
      if (wait !== null && wait <= RETRY_MAX_MS) {
        drop(r);
        await sleep(wait, undefined, { signal: joined });
        joined.throwIfAborted();
        r = await post();
      }
    }
    // (7) The status.
    if (r.status === 401 || r.status === 403) { drop(r); throw new ImagesError(KEY_REJECTED); }
    if (r.status === 400) {
      const text = (await readCapped(r, JSON_CAP, joined)).toString('utf8');
      let said = '';
      try {
        const j = JSON.parse(text);
        if (j && typeof j === 'object' && j.error && typeof j.error.message === 'string') said = j.error.message.trim();
      } catch { /* not JSON: the body text */ }
      const message = (said || text.trim()).slice(0, 200);
      throw new ImagesError(message ? `the image service refused this description: ${message}` : 'the image service answered 400');
    }
    if (!r.ok) { drop(r); throw new ImagesError(`the image service answered ${r.status}`); }
    // (8) The answer.
    const raw = await readCapped(r, JSON_CAP, joined);
    let j;
    try { j = JSON.parse(raw.toString('utf8')); } catch { throw new ImagesError(NOT_A_PICTURE); }
    const item = j && typeof j === 'object' && Array.isArray(j.data) ? j.data[0] : null;
    if (!item || typeof item !== 'object') throw new ImagesError(NOT_A_PICTURE);
    let bytes;
    if (typeof item.b64_json === 'string') bytes = Buffer.from(item.b64_json, 'base64');
    else if (item.b64_json == null && typeof item.url === 'string' && isHttpUrl(item.url)) {
      joined.throwIfAborted();
      const got = await call(item.url, { headers: { 'user-agent': 'worca' }, signal: joined });
      if (!got.ok) { drop(got); throw new ImagesError(NOT_A_PICTURE); }
      bytes = await readCapped(got, IMAGES_MAX_BYTES + 1, joined);
    } else throw new ImagesError(NOT_A_PICTURE);
    if (bytes.length > IMAGES_MAX_BYTES) throw new ImagesError(NOT_A_PICTURE);
    const size = pictureSize(bytes);
    if (!size) throw new ImagesError(NOT_A_PICTURE);
    // (9) The picture, its time and its dollars.
    const cost = j.usage && typeof j.usage === 'object' ? j.usage.cost : undefined;
    const costUsd = typeof cost === 'number' && Number.isFinite(cost) && cost >= 0 ? cost : c.price ?? 0;
    return { bytes, ext: size.ext, w: size.w, h: size.h, model: c.model, ms: Math.round(performance.now() - t0), costUsd };
  } catch (err) {
    // (10) The one place a throw is classified: the caller's stop, then the deadline, then the reasons.
    if (signal?.aborted) throw abortError();
    if (deadlineFired) throw new ImagesError(`the image service did not answer in ${Math.max(1, Math.round(timeoutMs / 1000))} s`, 504);
    if (err instanceof ImagesError) throw err;
    throw new ImagesError(UNREACHABLE);
  } finally {
    clearTimeout(timer);
  }
}

/** The row's Test picture: what is ON SCREEN (typed) over what is stored. Never throws. */
export async function testImages(typed = {}, fetch) {
  try {
    const c = endpoint(typed);
    if (!c.baseUrl) return { ok: false, message: 'Enter a base URL' };
    if (!c.model) return { ok: false, message: 'Enter a model' };
    if (c.varRefused) return { ok: false, message: VAR_REFUSED };
    if (c.unresolved) return { ok: false, message: VAR_UNSET };
    const r = await generatePicture({ prompt: TEST_PROMPT, shape: 'square', fetch, typed });
    return { ok: true, w: r.w, h: r.h, ms: r.ms, dataUrl: `data:${EXT_MIME[r.ext]};base64,${r.bytes.toString('base64')}` };
  } catch (err) {
    return { ok: false, message: err && err.message ? err.message : String(err) };
  }
}
