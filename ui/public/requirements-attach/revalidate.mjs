// Refresh attached-item statuses from the server so the composer sees archived,
// missing or wrong-scope features before a send. Triggers are the host's job.

const RESOLVE_URL = '/api/requirements/attach/resolve';

// The newest check per store: a slower, older response (another scope) must not overwrite a newer one's statuses.
const newest = new WeakMap();

const isOn = (flagOn) => (typeof flagOn === 'function' ? flagOn() : flagOn !== false);

function summarize(items) {
  return new Map(items.map((i) => [i.seq, JSON.stringify(i)]));
}

function changedBetween(before, after) {
  const prev = summarize(before);
  return after.some((i) => prev.get(i.seq) !== JSON.stringify(i));
}

/**
 * revalidate(store, fetchJson, scope, flagOn = true) -> Promise<{ok, changed}>
 *  - flag off: every item becomes 'unavailable' locally, no network call.
 *  - flag on: POST seqs (+ scope when given), apply returned statuses by seq.
 *  - any failure, or an answer a newer check has overtaken, resolves {ok:false, changed:false}; the store is left untouched.
 */
export async function revalidate(store, fetchJson, scope, flagOn = true) {
  const before = store.get().items;
  if (before.length === 0) return { ok: true, changed: false };

  if (!isOn(flagOn)) {
    newest.set(store, (newest.get(store) ?? 0) + 1);   // an older flag-on response must not overwrite 'unavailable'
    store.setStatuses(Object.fromEntries(before.map((i) => [i.seq, 'unavailable'])));
    return { ok: true, changed: changedBetween(before, store.get().items) };
  }

  const mine = (newest.get(store) ?? 0) + 1;
  newest.set(store, mine);
  const payload = { seqs: before.map((i) => i.seq) };
  if (scope?.scopeType) payload.scopeType = scope.scopeType;
  if (scope?.scopeKey) payload.scopeKey = scope.scopeKey;

  let res;
  try {
    res = await fetchJson(RESOLVE_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    });
  } catch {
    return { ok: false, changed: false };
  }
  if (newest.get(store) !== mine) return { ok: false, changed: false };
  if (!res || typeof res !== 'object' || !Array.isArray(res.items)) {
    return { ok: false, changed: false };
  }

  const patch = {};
  for (const it of res.items) {
    if (it && Number.isInteger(it.seq) && typeof it.status === 'string') {
      const { seq, ...rest } = it;
      patch[seq] = rest;
    }
  }
  store.setStatuses(patch);
  return { ok: true, changed: changedBetween(before, store.get().items) };
}
