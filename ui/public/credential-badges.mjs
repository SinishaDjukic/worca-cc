// ui/public/credential-badges.mjs
// "Your key / No key" badges on model pickers (credential broker, docs/credential-broker.md).
// One cache of GET /api/credentials — which slot each catalog model spends from, and the
// signed-in person's key state per slot — that every picker asks for a model's badge.
// Nothing here without a broker: credentialBadge() returns null and no picker changes.

let data = null;
let pending = null;
const listeners = new Set();

/** Replace the cached payload (app.js after a fetch; tests directly). */
export function setCredentialData(d) {
  data = d && d.enabled ? d : null;
  for (const fn of listeners) { try { fn(); } catch { /* a listener must not break the rest */ } }
}

/** Repaint hook: called whenever the cached payload changes. */
export function onCredentialsChange(fn) { listeners.add(fn); return () => listeners.delete(fn); }

/** Fetch /api/credentials once at a time; never throws (no broker or no answer = no badges). */
export function loadCredentials(fetchImpl = globalThis.fetch) {
  if (pending) return pending;
  pending = (async () => {
    try {
      const r = await fetchImpl('/api/credentials');
      setCredentialData(r.ok ? await r.json() : null);
    } catch { setCredentialData(null); } finally { pending = null; }
    return data;
  })();
  return pending;
}

/** The key page URL, when the broker has one. */
export function keyPageUrl() { return data?.keyPage || null; }

/**
 * The badge for one model, or null (no broker, unknown model, nobody signed in).
 * @returns {{text:string, tone:'green'|'blue'|'red', title:string, missing:boolean}|null}
 */
export function credentialBadge(modelId, d = data) {
  if (!d || !d.enabled || !d.models) return null;
  const m = d.models[modelId];
  if (!m) return null;
  if (m.keyless) return { text: 'local', tone: 'blue', title: 'A local model: no key needed.', missing: false };
  if (m.error) return { text: 'no route', tone: 'red', title: m.error, missing: true };
  if (d.mode === 'multi' && !d.person) return null;
  const s = (d.slots || []).find((x) => x.id === m.slot);
  const label = s?.label || m.slot;
  const where = d.keyPage ? ' on the key page' : ' to the credential broker';
  switch (s?.state) {
    case 'set': return { text: 'your key', tone: 'green', title: `Runs with your ${label}.`, missing: false };
    case 'operator': return { text: 'team key', tone: 'blue', title: `Runs with the team's ${label}.`, missing: false };
    case 'keyless': return { text: 'local', tone: 'blue', title: 'No key needed.', missing: false };
    case 'invalid': return { text: 'key rejected', tone: 'red', title: `The provider rejected your ${label}: replace it${where}.`, missing: true };
    default: return { text: 'no key', tone: 'red', title: `Add your ${label}${where} to use this model.`, missing: true };
  }
}

/** A short suffix for a plain <option> label (a select can't hold a styled badge). */
export function credentialSuffix(modelId, d = data) {
  const b = credentialBadge(modelId, d);
  return b && b.missing ? ` · ${b.text}` : '';
}
