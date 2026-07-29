// src/core/run-log.mjs
import { appendFile } from 'node:fs/promises';
import { join } from 'node:path';

/** Per-run live-log file (NDJSON) — dir-relative artifact, mirrors prompt.md. */
export const RUN_LOG_FILE = 'live-log.ndjson';
/** Artifact kind indexed in the `artifacts` table. */
export const RUN_LOG_KIND = 'live-log';

/**
 * Buffered, serialized NDJSON writer for a run's live `log` event stream.
 *
 * - Lines are buffered in memory and flushed on a timer (flushMs) or once the
 *   buffer reaches maxBuffer — NEVER one append per line.
 * - Appends are serialized through a single FIFO promise chain, so two flushes
 *   can never interleave or reorder bytes (race-safe).
 * - UNCAPPED: the full stream is persisted (no MAX_LOG_LINES equivalent).
 * - Best-effort: a failed append never rejects into the run (mirrors recordArtifact).
 *
 * Lifecycle: push() from construction (pre-bind lines are retained in the buffer);
 * bind(dir) once the pipeline dir exists; close() at run end (flushes + stops timer).
 */
export function createRunLogWriter({ flushMs = 1000, maxBuffer = 256 } = {}) {
  let buf = [];
  let file = null;
  let timer = null;
  let chain = Promise.resolve(); // serializes appendFile calls (FIFO)
  let closed = false;

  function flush() {
    if (!file || buf.length === 0) return chain; // pre-bind: keep buffering
    const batch = buf;
    buf = [];
    const text = batch.map((e) => JSON.stringify(e)).join('\n') + '\n';
    chain = chain.then(() => appendFile(file, text, 'utf8')).catch(() => {});
    return chain;
  }

  return {
    /** Point the writer at <dir>/live-log.ndjson and start the flush timer. Idempotent. */
    bind(dir) {
      if (file || !dir) return;
      file = join(dir, RUN_LOG_FILE);
      timer = setInterval(() => { flush(); }, flushMs);
      if (timer && typeof timer.unref === 'function') timer.unref(); // never hold the CLI open
    },
    /** Queue one log event. No-op after close. Eager-flushes at maxBuffer. */
    push(evt) {
      if (closed || !evt) return;
      buf.push(evt);
      if (buf.length >= maxBuffer) flush();
    },
    /** Stop the timer, flush everything still buffered, and await all queued appends. */
    async close() {
      if (closed) return;
      closed = true;
      if (timer) { clearInterval(timer); timer = null; }
      flush();
      await chain;
    },
    /** @internal test hook */
    _pending() { return buf.length; },
  };
}
