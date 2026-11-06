/**
 * Worker-side file fetch, shared by the chat plugins whose platform serves message files only with the bot's own
 * credential (Slack, Telegram, Teams). A file rides the channel protocol as an opaque `ref` (channel-protocol.mjs
 * FILE_REF_RE) that only this worker process can resolve; the host asks for its bytes with a `file` frame and the
 * worker answers from fetchFile(ref, {maxBytes, signal}). A ref names only an entry this worker minted, so the host
 * can never make it download an arbitrary address. Vendored byte-identically (test/chat-lib-drift.test.mjs).
 * @module lib/file-refs
 */

import { randomBytes } from 'node:crypto';
import { sendError } from './send-util.mjs';

/** A bounded, expiring map of ref -> what the worker needs to download that file (its URL, ids). */
export function createFileRefs({ max = 2000, ttlMs = 60 * 60 * 1000, now = Date.now } = {}) {
  const map = new Map();
  return {
    put(entry) {
      const ref = randomBytes(18).toString('base64url');   // 24 characters of [A-Za-z0-9_-]
      map.set(ref, { entry, at: now() });
      while (map.size > max) map.delete(map.keys().next().value);
      return ref;
    },
    get(ref) {
      const v = typeof ref === 'string' ? map.get(ref) : undefined;
      if (!v) return null;
      if (now() - v.at > ttlMs) { map.delete(ref); return null; }
      return v.entry;
    },
    get size() { return map.size; },
  };
}

/** The body as a Buffer, or {tooBig} as soon as it passes `cap` bytes (a declared length is not trusted). */
export async function readCapped(res, cap) {
  const declared = Number(res.headers?.get?.('content-length'));
  if (Number.isFinite(declared) && declared > cap) { releaseBody(res); return { tooBig: true }; }
  const reader = res.body?.getReader?.();
  if (!reader) {
    const buf = Buffer.from(await res.arrayBuffer());
    return buf.length > cap ? { tooBig: true } : { buf };
  }
  const chunks = [];
  let n = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    n += value.byteLength;
    if (n > cap) { await reader.cancel().catch(() => {}); return { tooBig: true }; }
    chunks.push(Buffer.from(value.buffer, value.byteOffset, value.byteLength));
  }
  return { buf: Buffer.concat(chunks, n) };
}

/** Release an unread response body now instead of at GC. */
export function releaseBody(res) {
  try { res?.body?.cancel?.()?.catch?.(() => {}); } catch { /* already consumed */ }
}

/** The refusal for a file over the host's cap: the channel-worker child reports it as `tooBig`. */
export function tooBigError(cap) {
  return Object.assign(sendError('plugin', `file is over the ${cap}-byte limit`), { tooBig: true, permanent: true });
}
