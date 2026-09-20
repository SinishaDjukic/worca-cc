// src/core/bridge/telemetry.mjs
// What the bridge did, for the run surfaces (model-bridge-design.md §7.2,
// §8.6): a per-tag counter of premium-request-INITIATING calls (a user turn,
// as opposed to a tool-result continuation the upstream bills as part of the
// same request) and an event stream the harness can subscribe to. The tag is
// the run's execution id, threaded through resolveModelEnv → the bridge URL.

import { EventEmitter } from 'node:events';

/** Emits 'call' {tag, catalogId, provider, api, initiator} and 'failure'
 *  {tag, catalogId, status, message}. (Not 'error': an EventEmitter throws on
 *  an unlistened 'error' event, and telemetry must never fail a request.) */
export const bridgeEvents = new EventEmitter();
bridgeEvents.setMaxListeners(50);

const calls = new Map();   // tag -> { initiated, continued, errors }
const MAX_TAGS = 5000;

function slot(tag) {
  const k = tag || '';
  let s = calls.get(k);
  if (!s) {
    if (calls.size >= MAX_TAGS) calls.delete(calls.keys().next().value);
    s = { initiated: 0, continued: 0, errors: 0 };
    calls.set(k, s);
  }
  return s;
}

/** Book one upstream call. `initiator` is 'user' | 'agent' (§7.1). */
export function recordBridgeCall({ tag, catalogId, provider, api, initiator }) {
  const s = slot(tag);
  if (initiator === 'agent') s.continued += 1; else s.initiated += 1;
  bridgeEvents.emit('call', { tag: tag || '', catalogId, provider, api, initiator });
}

/** Book one failed upstream call. */
export function recordBridgeError({ tag, catalogId, provider, status, message }) {
  slot(tag).errors += 1;
  bridgeEvents.emit('failure', { tag: tag || '', catalogId, provider, status, message });
}

/** Counters for a tag: {initiated, continued, errors}; zeros when unseen. */
export function bridgeCallsFor(tag) {
  const s = calls.get(tag || '');
  return s ? { ...s } : { initiated: 0, continued: 0, errors: 0 };
}

/** Forget a tag's counters (a finished run). */
export function forgetBridgeTag(tag) { calls.delete(tag || ''); }

/** Test hook. */
export function _resetBridgeTelemetry() { calls.clear(); }
