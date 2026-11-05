// ui/public/answerer.mjs — the signed-in person's answerer profile (GET/PUT /api/answerer): one cached promise per
// page, so no card fetches it twice and none reads it before it loads. There is no synchronous getter on purpose.

let cached = null;

/** The profile, `{ lead }`; `{ lead: null }` on any failure. One request per page, whoever asks first. */
export function loadAnswerer(fetchFn = (...a) => fetch(...a)) {
  cached ||= Promise.resolve()
    .then(() => fetchFn('/api/answerer'))
    .then((r) => (r && r.ok ? r.json() : null))
    .then((b) => ({ lead: typeof b?.lead === 'string' ? b.lead : null }))
    .catch(() => ({ lead: null }));
  return cached;
}

/** Save the lead; the cached profile follows a saved value. Resolves `{ lead }`, rejects with the server's message. */
export async function saveAnswerer(lead, fetchFn = (...a) => fetch(...a)) {
  const r = await fetchFn('/api/answerer', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ lead }) });
  const b = await r.json().catch(() => null);
  if (!r.ok) throw new Error(b?.error?.message || `HTTP ${r.status}`);
  cached = Promise.resolve({ lead: b?.lead ?? null });
  return cached;
}

/** Tests: forget the cached profile. */
export function _resetAnswerer() { cached = null; }
