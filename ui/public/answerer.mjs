// ui/public/answerer.mjs — the signed-in person's answerer profile (GET/PUT /api/answerer): one cached promise per
// page, so no card fetches it twice and none reads it before it loads. There is no synchronous getter on purpose.

import { perspectiveByKey } from '../../src/shared/shape/perspectives.mjs';
import { ANSWERER_LEAD_KEYS } from '../../src/shared/answerer.mjs';
import { CONFIRM_ROLES, roleOfPerspective } from '../../src/shared/shape/feature-record.mjs';

let cached = null;
/** How long a card waits for the profile before it words the decisions for no known lead. */
export const ANSWERER_TIMEOUT_MS = 5000;
let timeoutMs = ANSWERER_TIMEOUT_MS;

/** The word a lead goes by on the cards (the perspective list says Architect and "DevOps and infrastructure"): its
 *  CONFIRM_ROLES label, through the one perspective-to-role mapping. */
export const LEAD_LABELS = Object.freeze(Object.fromEntries(ANSWERER_LEAD_KEYS.map((k) => [k, CONFIRM_ROLES.find((r) => r.key === roleOfPerspective(k)).label])));
/** One label for a perspective key, on every card: `LEAD_LABELS`, else the perspective's own label, else the key. */
export const leadLabel = (key) => (Object.hasOwn(LEAD_LABELS, key) && LEAD_LABELS[key]) || (perspectiveByKey(key) || {}).label || String(key);

/** The profile, `{ lead }`; `{ lead: null }` on any failure or after `ANSWERER_TIMEOUT_MS`. One request per page,
 *  whoever asks first; a failure or a timeout is not kept, so the next call asks again. */
export function loadAnswerer(fetchFn = (...a) => fetch(...a)) {
  if (cached) return cached;
  let timer = null;
  const timedOut = new Promise((resolve) => { timer = setTimeout(() => resolve(null), timeoutMs); });
  const fetched = Promise.resolve()
    .then(() => fetchFn('/api/answerer'))
    .then((r) => { if (!r || !r.ok) throw new Error('no profile'); return r.json(); })
    .then((b) => ({ lead: typeof b?.lead === 'string' ? b.lead : null }))
    .catch(() => null)
    .finally(() => clearTimeout(timer));
  const load = Promise.race([fetched, timedOut]).then((p) => {
    if (p) return p;
    if (cached === load) cached = null;
    return { lead: null };
  });
  cached = load;
  return load;
}

/** Save the lead; the cached profile follows a saved value. Resolves `{ lead }`, rejects with the server's message. */
export async function saveAnswerer(lead, fetchFn = (...a) => fetch(...a)) {
  const r = await fetchFn('/api/answerer', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ lead }) });
  const b = await r.json().catch(() => null);
  if (!r.ok) throw new Error(b?.error?.message || `HTTP ${r.status}`);
  cached = Promise.resolve({ lead: b?.lead ?? null });
  return cached;
}

/** Tests: forget the cached profile; `timeoutMs` shortens the wait (none = the default). */
export function _resetAnswerer({ timeoutMs: ms } = {}) { cached = null; timeoutMs = ms ?? ANSWERER_TIMEOUT_MS; }
