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

// The USD an upstream itself reported for a tag's calls (OpenRouter's
// usage.cost). Kept apart from the call counters: a priced call is the
// exception, and the run harness prefers this figure over the CLI's $0.
const costs = new Map();   // tag -> { costUsd, calls }

/** Book the cost one upstream call reported. Ignores anything but a finite, non-negative number. */
export function recordBridgeCost({ tag, costUsd }) {
  const n = Number(costUsd);
  if (costUsd == null || !Number.isFinite(n) || n < 0) return;
  const k = tag || '';
  let c = costs.get(k);
  if (!c) {
    if (costs.size >= MAX_TAGS) costs.delete(costs.keys().next().value);
    c = { costUsd: 0, calls: 0 };
    costs.set(k, c);
  }
  // Rounded to 1e-9 USD: summing float fractions of a cent would otherwise drift.
  c.costUsd = Math.round((c.costUsd + n) * 1e9) / 1e9;
  c.calls += 1;
}

/** The upstream-reported cost for a tag: {costUsd, calls}, or null when no call reported one. */
export function bridgeCostFor(tag) {
  const c = costs.get(tag || '');
  return c ? { ...c } : null;
}

/** Forget a tag's counters and cost (a finished run). */
export function forgetBridgeTag(tag) { calls.delete(tag || ''); costs.delete(tag || ''); }

/** Test hook. */
export function _resetBridgeTelemetry() { calls.clear(); costs.clear(); }
