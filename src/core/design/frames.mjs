// src/core/design/frames.mjs
// The frame emitter (P2 Task 8): stamps every Design WebSocket frame with the C-5 common fields
// `{type, designId, buildId, seq, ts}` and holds `design-agent` (per agent) and `design-build` to at most 2 Hz.
// Frames go to `emit` and nowhere else: this module has no store and no buffer, so a `design-delta` is never kept (M1).
// Imports only node:crypto.

import { createHash } from 'node:crypto';

/** `design-file.text` rides along up to this many UTF-8 bytes (256 KiB); past it the client re-fetches (C-5). */
export const DESIGN_FILE_TEXT_MAX = 262144;

const COMMON_FIELDS = new Set(['type', 'designId', 'buildId', 'seq', 'ts']);
/** A terminal status cancels what is pending for its key and goes now, so the throttle never drops it (M10). */
const TERMINAL_AGENT = new Set(['done', 'stopped', 'error', 'interrupted']);
const TERMINAL_BUILD = new Set(['paused', 'done', 'stopped', 'error', 'interrupted']);

/**
 * One emitter per build. `seq` rises by one per frame from `seqStart`; a rehydrated build passes `Date.now()` so its
 * frames sort above the earlier emitter's (L2.21). The throttle key is `agent:<id>` or `build`: the first frame of a
 * window goes now, later ones collapse into one trailing frame carrying the newest fields, sent when the window ends.
 * @param {{ designId: string, buildId: string, emit: (frame: object) => void, seqStart?: number, now?: () => number,
 *   setTimer?: (fn: () => void, ms: number) => unknown, clearTimer?: (handle: unknown) => void, throttleMs?: number }} opts
 */
export function createFrameEmitter({ designId, buildId, emit, seqStart = 0, now = Date.now,
  setTimer = setTimeout, clearTimer = clearTimeout, throttleMs = 500 }) {
  let seq = seqStart;
  /** key -> { last: ts of the key's last frame, pending: null|{type, fields}, timer, token } */
  const windows = new Map();

  function stamp(type, fields) {
    const frame = { type, designId, buildId, seq: ++seq, ts: now() };
    for (const [k, v] of Object.entries(fields ?? {})) if (!COMMON_FIELDS.has(k)) frame[k] = v;
    emit(frame);
  }

  function cancel(w) {
    if (w.timer != null) clearTimer(w.timer);
    w.timer = null; w.token = null; w.pending = null;
  }

  /** The trailing edge. A timer whose window was cancelled or re-armed since sends nothing, even if it still fires. */
  function trailing(w, token) {
    if (w.token !== token) return;
    const p = w.pending;
    w.timer = null; w.token = null; w.pending = null;
    if (!p) return;
    w.last = now();
    // No caller is on the stack here, so a throwing consumer must not become an uncaught exception.
    try { stamp(p.type, p.fields); } catch (err) {
      console.error(`[design] ${p.type} frame for ${designId}/${buildId} not sent: ${err && err.message ? err.message : err}`);
    }
  }

  function throttled(key, type, fields, terminal) {
    const t = now();
    let w = windows.get(key);
    if (!w) { w = { last: null, pending: null, timer: null, token: null }; windows.set(key, w); }
    if (terminal) { cancel(w); w.last = t; stamp(type, fields); return; }
    if (w.timer == null && (w.last == null || t - w.last >= throttleMs)) { w.last = t; stamp(type, fields); return; }
    w.pending = { type, fields };
    if (w.timer != null) return;
    const token = {};
    w.token = token;
    w.timer = setTimer(() => trailing(w, token), Math.max(0, throttleMs - (t - w.last)));
  }

  function build(fields) {
    throttled('build', 'design-build', fields, TERMINAL_BUILD.has(fields?.status));
  }

  function agent(agentId, fields) {
    // agentId first on the wire, and the argument wins over a stray `fields.agentId`.
    throttled(`agent:${agentId}`, 'design-agent', Object.assign({ agentId }, fields, { agentId }), TERMINAL_AGENT.has(fields?.status));
  }

  return {
    /** Any frame type. `design-build` and `design-agent` still go through their throttle. */
    send(type, fields) {
      if (type === 'design-build') return build(fields);
      if (type === 'design-agent') return agent(fields?.agentId, fields);
      stamp(type, fields);
    },
    build,
    agent,
    /** `sha256` and `bytes` are of the UTF-8 text; `text` is left out past `DESIGN_FILE_TEXT_MAX`. */
    file({ path, sectionId, part, rev, text }) {
      const bytes = Buffer.byteLength(text, 'utf8');
      const fields = { path, sectionId, part, rev, sha256: createHash('sha256').update(text, 'utf8').digest('hex'), bytes };
      if (bytes <= DESIGN_FILE_TEXT_MAX) fields.text = text;
      stamp('design-file', fields);
    },
    /** Unthrottled: the draft store already batches splices (120 ms or 4 KiB per file). */
    delta({ agentId, path, sectionId, part, rev, splice }) {
      stamp('design-delta', { agentId, path, sectionId, part, rev, splice });
    },
    /** Sends every pending trailing frame now. */
    flush() {
      for (const w of windows.values()) {
        const p = w.pending;
        cancel(w);
        if (p) { w.last = now(); stamp(p.type, p.fields); }
      }
    },
    lastSeq() { return seq; },
  };
}
