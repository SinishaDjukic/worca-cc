// src/core/billing.mjs
// Who pays for a spawn (plans/credential-broker-design.html §5.5): the person
// whose action caused it. The server sets the acting person once per request
// (ui/server.mjs) and around a run's own loop (run-harness.mjs); every claude spawn
// started inside that async context is billed to them, without threading a
// parameter through every call site. An explicit `billTo` on a spawn still wins.
import { AsyncLocalStorage } from 'node:async_hooks';

const als = new AsyncLocalStorage();

/** A usable bill-to: a lower-cased email, 'local', or null. */
export function normalizeBillTo(v) {
  const s = typeof v === 'string' ? v.trim().toLowerCase() : '';
  if (!s) return null;
  if (s === 'local') return 'local';
  return /^[^\s@<>]{1,200}@[^\s@<>]{1,200}$/.test(s) ? s : null;
}

/**
 * Run `fn` with `billTo` as the acting person (an unusable value leaves the context unset).
 * `owner` is whose work it is — whose agent user (agent-pool.mjs) its processes run as.
 * It defaults to the payer; a resumed run pays as the resumer but keeps its starter's
 * agent user, where Claude Code keeps the run's sessions.
 */
export function withBillTo(billTo, fn, { owner } = {}) {
  const b = normalizeBillTo(billTo);
  return als.run({ billTo: b, owner: owner === undefined ? b : normalizeBillTo(owner) }, fn);
}

/** Enter `billTo` for the rest of the current synchronous execution and its async continuations (Express middleware). */
export function enterBillTo(billTo) {
  const b = normalizeBillTo(billTo);
  als.enterWith({ billTo: b, owner: b });
}

/** The acting person in this async context, or null. */
export function currentBillTo() {
  return als.getStore()?.billTo ?? null;
}

/** Whose work this async context is (see withBillTo), or null. */
export function currentOwner() {
  const s = als.getStore();
  return s ? (s.owner ?? s.billTo ?? null) : null;
}

/**
 * The person a spawn is billed to: an explicit value, else the async context,
 * else WORCA_BROKER_SYSTEM_BILL_TO, else null (the caller refuses in multi mode).
 */
export function resolveBillTo(explicit, env = process.env) {
  return normalizeBillTo(explicit) || currentBillTo() || normalizeBillTo(env.WORCA_BROKER_SYSTEM_BILL_TO) || null;
}
