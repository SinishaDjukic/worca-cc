// The Design stage's frame host (SPEC C-6): the sandboxed preview iframe, the gate every message from it passes
// through, the swap to a newer doc that keeps the old frame on screen until the new one is ready, and the lost frame
// (P3: a doc that never says `ready`; R16: a page that navigated away, told by a frame `load` its doc never reported
// as `loaded`). It reaches the DOM, the timers and the token route only through its arguments, and does nothing until
// `load`.

export const FRAME_NS = 'worca-design';
export const READY_TIMEOUT_MS = 6000;
export const NAV_GRACE_MS = 1500;

const VERSION = 1;
// A cached preview token is dropped this long before the server's `expiresAt`.
const TOKEN_MARGIN_MS = 60000;
const MODES = new Set(['build', 'run']);
// SECTION_ID_RE's source (src/core/design/ids.mjs): a browser module cannot reach src/core.
const SECTION_ID_RE = /^[a-z][a-z0-9-]{0,31}$/;
const TAG_RE = /^[a-z][a-z0-9-]{0,31}$/;
// P3's caps (src/core/design/preview/bridge.js): RECT_MAX, MAX_SECTIONS (sectionNodes), MARKS_MAX, PICK_*_MAX,
// ERR_MESSAGE_MAX. An error code is a short kebab word there; the code cap only bounds a forged one.
const RECT_MAX = 2e5;
const SECTIONS_MAX = 40;
const MARKS_MAX = 24;
const PATH_MAX = 512;
const TEXT_MAX = 200;
const HTML_MAX = 2048;
const ERR_MESSAGE_MAX = 300;
const ERR_CODE_MAX = 64;
// A `zoom` wheel step (Task 16) moves at most this far either way.
const ZOOM_DY_MAX = 1000;
// While a frame load waits for its doc's `loaded` report, at most this many messages wait each way.
const HELD_MAX = 256;

const isObject = (v) => typeof v === 'object' && v !== null;
const finite = (v) => typeof v === 'number' && Number.isFinite(v);
const count = (v) => Number.isSafeInteger(v) && v >= 0;
const isSectionId = (v) => typeof v === 'string' && SECTION_ID_RE.test(v);
const tagOf = (v) => (typeof v === 'string' && TAG_RE.test(v) ? v : 'el');

// The first `max` code units of `s`, minus a high surrogate the cut would leave alone at the end (as P3's `cut`).
function cut(s, max) {
  if (s.length <= max) return s;
  const c = s.charCodeAt(max - 1);
  return s.slice(0, c >= 0xd800 && c <= 0xdbff ? max - 1 : max);
}

/** A C-6 rect: four finite numbers within ±RECT_MAX, copied; anything else is null. */
function rectOf(v) {
  if (!Array.isArray(v) || v.length !== 4) return null;
  for (let i = 0; i < 4; i++) if (!finite(v[i]) || Math.abs(v[i]) > RECT_MAX) return null;
  return [v[0], v[1], v[2], v[3]];
}

function readReady(d) {
  if (!MODES.has(d.mode) || !finite(d.vw) || !finite(d.vh) || !finite(d.dpr)) return null;
  return { mode: d.mode, vw: d.vw, vh: d.vh, dpr: d.dpr };
}

function readRects(d) {
  if (![d.scrollX, d.scrollY, d.vw, d.vh, d.docH].every((v) => finite(v)) || !Array.isArray(d.sections)) return null;
  const sections = [];
  for (const s of d.sections.slice(0, SECTIONS_MAX)) {
    const rect = isObject(s) && isSectionId(s.id) ? rectOf(s.rect) : null;
    if (!rect) return null;
    sections.push({ id: s.id, rect });
  }
  return { scrollX: d.scrollX, scrollY: d.scrollY, vw: d.vw, vh: d.vh, docH: d.docH, sections };
}

// P3 always sends a tail; an absent one reads null (the model handles that), a malformed one refuses the message.
// `box` is Task 16's element rect around the tail, kept only when it is there.
function readTail(v) {
  if (v === undefined || v === null) return { tail: null };
  const rect = isObject(v) ? rectOf(v.rect) : null;
  if (!rect) return null;
  if (v.box === undefined) return { tail: { rect, tag: tagOf(v.tag) } };
  const box = rectOf(v.box);
  return box ? { tail: { rect, tag: tagOf(v.tag), box } } : null;
}

function readApplied(d) {
  if (!isSectionId(d.id) || !count(d.rev) || !count(d.added) || !count(d.layers) || !Array.isArray(d.marks)) return null;
  const rect = rectOf(d.rect);
  const tail = readTail(d.tail);
  if (!rect || !tail) return null;
  const marks = [];
  for (const m of d.marks.slice(0, MARKS_MAX)) {
    const r = isObject(m) ? rectOf(m.rect) : null;
    if (!r) return null;
    marks.push({ rect: r, tag: tagOf(m.tag), kind: m.kind === 'media' ? 'media' : 'el' });
  }
  return { id: d.id, rev: d.rev, added: d.added, layers: d.layers, rect, tail: tail.tail, marks, overflow: d.overflow === true };
}

function readPicked(d) {
  const rect = rectOf(d.rect);
  if (!isSectionId(d.id) || !rect || typeof d.path !== 'string' || typeof d.text !== 'string' || typeof d.html !== 'string') return null;
  return { id: d.id, path: cut(d.path, PATH_MAX), tag: tagOf(d.tag), text: cut(d.text, TEXT_MAX), html: cut(d.html, HTML_MAX), rect };
}

function readErr(d) {
  if (typeof d.code !== 'string' || typeof d.message !== 'string') return null;
  return { code: cut(d.code, ERR_CODE_MAX), message: cut(d.message, ERR_MESSAGE_MAX) };
}

function readZoom(d) {
  if (!finite(d.dy) || !finite(d.y)) return null;
  return { dy: Math.max(-ZOOM_DY_MAX, Math.min(ZOOM_DY_MAX, d.dy)), y: d.y };
}

// One reader per C-6 frame-to-parent `t` (plus Task 16's `zoom`, and `loaded`: the doc's own window `load`). A Map,
// so `__proto__` or `constructor` finds nothing.
const READERS = new Map([
  ['ready', readReady],
  ['loaded', (d) => (MODES.has(d.mode) ? { mode: d.mode } : null)],
  ['rects', readRects],
  ['applied', readApplied],
  ['picked', readPicked],
  ['visible', (d) => (isSectionId(d.id) ? { id: d.id } : null)],
  ['err', readErr],
  ['zoom', readZoom],
]);

/**
 * A frame's C-6 message, rebuilt with only its known fields, or null. The envelope must be `worca-design` v1 with
 * this frame's nonce. Rects, ids and counts that fail their rule refuse the whole message; tags that fail become
 * `el`; lists and strings are cut to P3's caps.
 * @param {unknown} data the message event's `data`
 * @param {string} nonce the frame's nonce
 * @returns {{ t: string } & Record<string, unknown> | null}
 */
export function validFrameMessage(data, nonce) {
  if (!isObject(data) || data.ns !== FRAME_NS || data.v !== VERSION) return null;
  if (typeof nonce !== 'string' || nonce === '' || data.n !== nonce) return null;
  const read = typeof data.t === 'string' ? READERS.get(data.t) : undefined;
  const body = read ? read(data) : null;
  return body ? { t: data.t, ...body } : null;
}

/**
 * The stage's preview frame. `load(mode)` mints (or reuses) a token and puts a doc in `mount`: the first one is
 * current at once, a later one waits as the next frame (`.is-next`) until its `ready`, which swaps it in. A doc with
 * no `ready` within READY_TIMEOUT_MS, or one that navigated away and did not come back within NAV_GRACE_MS, fails:
 * the first failure re-mints and reloads once (in the mode last asked for), the second calls `onLost`. A current doc
 * that fails while a newer one waits is left to that one's swap. `loaded` is the host's own: it never reaches
 * `onMessage`. While a frame load waits for its report (browsers often deliver the load first), what `send` posts and
 * what the frame says wait too: the report delivers them in order, and a grace that runs out drops them.
 * @param {{
 *   doc: Document, win: { addEventListener: Function, removeEventListener: Function, setTimeout: Function,
 *     clearTimeout: Function, crypto: Crypto },
 *   mount: Element,
 *   mint: () => Promise<{ base: string, expiresAt: number }> | { base: string, expiresAt: number },
 *   now: () => number,
 *   onMessage: (msg: { t: string } & Record<string, unknown>) => void,
 *   onSwap: (doc: { mode: 'build' | 'run', vw: number, vh: number, dpr: number }) => void,
 *   onLost: (lost: { mode: 'build' | 'run' }) => void,
 * }} deps `now` ages the cached token (the stage passes its own clock)
 * @returns {{ load: (mode: 'build' | 'run', opts?: { fresh?: boolean }) => Promise<void>,
 *   send: (t: string, fields?: object) => boolean, mode: () => string | null, pendingMode: () => string | null,
 *   destroy: () => void }}
 */
export function createFrameHost({ doc, win, mount, mint, now, onMessage, onSwap, onLost }) {
  let current = null;
  let next = null;
  let token = null;
  // The mode of the newest `load`: a retry reloads that one, so a failing doc never replaces a newer one asked for.
  let wanted = null;
  // Bumped by every start and by destroy: a start that finds it moved after its mint was overtaken.
  let gen = 0;
  let destroyed = false;

  const isLive = (slot) => slot !== null && (slot === current || slot === next);

  function stopTimer(slot) {
    if (slot.timer !== null) win.clearTimeout(slot.timer);
    slot.timer = null;
  }

  function removeSlot(slot) {
    if (!slot) return;
    stopTimer(slot);
    slot.frame.remove();
  }

  function newNonce() {
    const bytes = win.crypto.getRandomValues(new Uint8Array(16));
    return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  }

  // The token's base path, cached until a minute before it expires. Only a start that is still the newest keeps a
  // fresh mint, so an overtaken one cannot put back a token that a `fresh` load dropped.
  async function baseFor(started) {
    if (token && now() < token.expiresAt - TOKEN_MARGIN_MS) return token.base;
    token = null;
    const minted = await mint();
    if (!isObject(minted) || typeof minted.base !== 'string' || !finite(minted.expiresAt)) throw new Error('preview token: bad answer');
    if (started === gen && !destroyed) token = { base: minted.base, expiresAt: minted.expiresAt };
    return minted.base;
  }

  async function start(mode, attempt) {
    const started = ++gen;
    let base = null;
    try { base = await baseFor(started); } catch { base = null; }
    if (destroyed || started !== gen) return;
    removeSlot(next);
    next = null;
    if (base === null) {
      token = null;
      if (attempt === 0) return start(mode, 1);
      onLost({ mode });
      return;
    }
    const nonce = newNonce();
    const frame = doc.createElement('iframe');
    frame.className = 'dz-frame';
    frame.setAttribute('sandbox', 'allow-scripts');
    frame.setAttribute('referrerpolicy', 'no-referrer');
    frame.setAttribute('title', 'Design preview');
    if (current) frame.classList.add('is-next');
    frame.setAttribute('src', `${base}/${mode}/#n=${nonce}`);
    // `loads`: the doc's `loaded` reports less the frame's `load` events, its first one too (browsers often deliver
    // that load before the doc's `ready`); below 0, a load is owed its report.
    // `held`: while a load is owed its report, the messages that wait each way (`{toFrame, fromFrame}`), else null.
    const slot = { frame, nonce, mode, try: attempt, loads: 0, ready: false, dead: false, timer: null, held: null };
    frame.addEventListener('load', () => onLoad(slot));
    if (current) next = slot;
    else current = slot;
    slot.timer = win.setTimeout(() => fail(slot), READY_TIMEOUT_MS);
    mount.append(frame);
  }

  // No first `ready` in time, or a navigation's grace ran out. A next slot goes; a dead current one stays until a swap,
  // and while a next slot waits nothing else is loaded: that one swaps in when it is ready, or fails on its own.
  function fail(slot) {
    slot.timer = null;
    slot.held = null;
    if (!isLive(slot)) return;
    token = null;
    if (slot === next) {
      removeSlot(slot);
      next = null;
    } else {
      slot.dead = true;
      if (next) return;
    }
    const mode = wanted ?? slot.mode;
    if (slot.try === 0) void start(mode, 1);
    else onLost({ mode });
  }

  // Each frame load must be the doc's own, which its bridge reports as `loaded`; a load with no report is a page that
  // left (R16), even one that left after its own load: stop believing it, and wait NAV_GRACE_MS for a report that lost
  // the race with this load (out-of-process frames do not order the two). A load before the first `ready` is counted
  // too (it is usually the doc's own, delivered before its `ready`), but only that `ready` acts on it (READY_TIMEOUT_MS
  // covers a doc with no bridge). A load on a dead slot is counted as well, so a report owed for an earlier load cannot
  // pay for it, but it never stretches the grace already running.
  function onLoad(slot) {
    if (!isLive(slot)) return;
    slot.loads -= 1;
    if (!slot.dead && slot.ready && slot.loads < 0) owe(slot);
  }

  // Stop believing the slot until a report pays what is owed: hold what passes either way, and fail after the grace.
  function owe(slot) {
    slot.dead = true;
    slot.held = { toFrame: [], fromFrame: [] };
    stopTimer(slot);
    slot.timer = win.setTimeout(() => fail(slot), NAV_GRACE_MS);
  }

  function post(slot, t, fields) {
    slot.frame.contentWindow.postMessage({ ...fields, ns: FRAME_NS, v: VERSION, n: slot.nonce, t }, '*');
  }

  // The doc's own window `load`: it pays for a frame load, the one before it or the next. Within the grace it brings a
  // dead slot back once nothing is owed; after the grace, or before the first `ready`, it says nothing.
  function onLoaded(slot, msg) {
    if (msg.mode !== slot.mode || !slot.ready || (slot.dead && slot.timer === null)) return;
    slot.loads += 1;
    if (!slot.dead || slot.loads < 0) return;
    slot.dead = false;
    stopTimer(slot);
    // What waited lands in order: the stage's own messages first (they were sent before anything the frame's could
    // set off now), then the frame's.
    const held = slot.held;
    slot.held = null;
    if (!held) return;
    for (const [t, fields] of held.toFrame) post(slot, t, fields);
    for (const m of held.fromFrame) if (isLive(slot) && slot === current && !slot.dead && !destroyed) onMessage(m);
  }

  function onReady(slot, msg) {
    if (msg.mode !== slot.mode) return;
    if (slot.dead) {
      // A self-reload whose `ready` lost the race with its `load` (out-of-process frames do not order the two): the
      // stage still gets the `ready`, and its replies wait for the report, as at a first `ready`. The `ready` brings
      // nothing back: a page that left while a report was owed has a load of its own counted, so only `loaded` reports
      // that pay every load owed do, within the grace still running (review cycle 4). What waited for the old doc is
      // dropped: the reloaded doc gets all it needs from its `ready`. A slot that failed (its grace ran out, or it never
      // said `ready` in time) stays dead.
      if (slot.timer === null) return;
      slot.held = { toFrame: [], fromFrame: [] };
      onMessage(msg);
      return;
    }
    if (!slot.ready) {
      slot.ready = true;
      stopTimer(slot);
      if (slot === next) {
        removeSlot(current);
        current = slot;
        next = null;
        slot.frame.classList.remove('is-next');
      }
      onSwap({ mode: msg.mode, vw: msg.vw, vh: msg.vh, dpr: msg.dpr });
      // A load came before this `ready` with no report yet: the stage still gets the `ready`, and its replies wait
      // for the report.
      if (slot.loads < 0) owe(slot);
    }
    onMessage(msg);
  }

  function onWindowMessage(e) {
    if (e.origin !== 'null' || !e.source) return;
    const slot = [current, next].find((s) => s !== null && s.frame.contentWindow === e.source);
    if (!slot) return;
    const msg = validFrameMessage(e.data, slot.nonce);
    if (!msg) return;
    if (msg.t === 'ready') {
      onReady(slot, msg);
      return;
    }
    if (msg.t === 'loaded') {
      onLoaded(slot, msg);
      return;
    }
    if (slot !== current || !slot.ready) return;
    if (!slot.dead) onMessage(msg);
    else if (slot.held && slot.held.fromFrame.length < HELD_MAX) slot.held.fromFrame.push(msg);
  }

  win.addEventListener('message', onWindowMessage);

  return {
    async load(mode, { fresh = false } = {}) {
      if (!MODES.has(mode)) throw new TypeError(`frame host: no such mode ${String(mode)}`);
      if (destroyed) return;
      if (fresh) token = null;
      wanted = mode;
      await start(mode, 0);
    },
    // The C-6 envelope to the current doc, only once it is ready and while it is believed; while a load waits for its
    // report it waits too (true), and a doc no longer believed gets nothing (false).
    send(t, fields = {}) {
      const slot = current;
      if (!slot || !slot.ready || destroyed) return false;
      if (!slot.dead) {
        post(slot, t, fields);
        return true;
      }
      if (!slot.held || slot.held.toFrame.length >= HELD_MAX) return false;
      slot.held.toFrame.push([t, { ...fields }]);
      return true;
    },
    mode: () => (current ? current.mode : null),
    pendingMode: () => (next ? next.mode : null),
    destroy() {
      destroyed = true;
      gen++;
      win.removeEventListener('message', onWindowMessage);
      removeSlot(next);
      removeSlot(current);
      next = null;
      current = null;
      token = null;
    },
  };
}
