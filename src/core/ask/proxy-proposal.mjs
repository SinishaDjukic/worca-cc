// propose_network_proxy_change / propose_corporate_proxy_on: validate and build the confirm card. Never writes;
// proxy-deps.mjs applyProxyChange does, behind the card's Apply. A proxy password never passes through here (no
// field takes one; an upstream with user:pass is refused by settings.mjs).
// eslint-disable-next-line no-control-regex
const BREAKS_RE = /[\x00-\x1f\x7f-\x9f\u2028\u2029]/g;
const clip = (v, n) => String(v ?? '').replace(BREAKS_RE, ' ').slice(0, n);
const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v);

export const PROXY_CHANGE_FIELDS = Object.freeze(['upstream', 'auth', 'noProxy', 'timeouts', 'fixedPort']);
const SECRET_KEYS = ['password', 'user', 'domain', 'login', 'credentials', 'ntHash', 'hash'];
export const PROXY_LIVE_NOTE = 'New connections use it now.';
export const PROXY_OFF_TEXT = 'The corporate proxy is off. Offer propose_corporate_proxy_on, a card the user applies, or point to Settings › Runs › Network proxy.';
const LOGIN_TEXT = 'A proxy login never goes through the chat: the user logs in on Settings › Runs › Network proxy (Log in) or with `worca proxy login`.';

const LABELS = { enabled: 'Network proxy', upstream: 'Proxy', auth: 'Login', noProxy: 'Hosts that go direct', fixedPort: 'Local proxy port',
  'timeouts.connectMs': 'Connect timeout', 'timeouts.authMs': 'Login timeout', 'timeouts.idleMs': 'Idle timeout' };
const AUTH_WORDS = { auto: 'NTLMv2', ntlm: 'NTLMv2', none: 'no login', basic: 'Basic, cleartext', digest: 'Digest' };
const DEFAULTS = { upstream: 'none (HTTPS_PROXY / HTTP_PROXY at start, if set)', auth: 'default (NTLMv2 with a saved login, else none)',
  noProxy: 'default (NO_PROXY at start, if set)', fixedPort: 'any free port',
  'timeouts.connectMs': 'default (30 s)', 'timeouts.authMs': 'default (15 s)', 'timeouts.idleMs': 'default (600 s)' };
const hostPort = (u) => String(u).replace(/^http:\/\//, '');
const show = (field, v) => {
  if (field === 'enabled') return v === true ? 'On' : 'Off';
  if (v === undefined || v === null || v === '') return DEFAULTS[field];
  if (field === 'upstream') return hostPort(v);
  if (field === 'auth') return AUTH_WORDS[v] || String(v);
  if (field === 'noProxy') return Array.isArray(v) ? v.join(', ') : String(v);
  if (field.startsWith('timeouts.')) return `${v} ms`;
  return String(v);
};
const flat = (np = {}) => ({ enabled: np.enabled, upstream: np.upstream, auth: np.auth, noProxy: np.noProxy, fixedPort: np.fixedPort,
  'timeouts.connectMs': np.timeouts?.connectMs, 'timeouts.authMs': np.timeouts?.authMs, 'timeouts.idleMs': np.timeouts?.idleMs });
const same = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

/**
 * @param {{ current: () => object, preview: (patch: object) => object }} r
 *   preview: settings.mjs previewNetworkProxy (assert + merge, the PUT /api/proxy/settings code); it throws the field error.
 *   Works with the proxy off too: the values are saved, and used once it is turned on.
 */
export function createProxyChangeValidator({ current, preview }) {
  return async function validateProxyChange(input = {}) {
    const inp = isObj(input) ? input : {};
    if (SECRET_KEYS.some((k) => k in inp)) return { ok: false, errors: [LOGIN_TEXT] };
    const unknown = Object.keys(inp).filter((k) => !PROXY_CHANGE_FIELDS.includes(k) && k !== 'note');
    if (unknown.length) return { ok: false, errors: [`unknown field${unknown.length > 1 ? 's' : ''}: ${unknown.join(', ')}`] };
    const patch = {};
    for (const k of PROXY_CHANGE_FIELDS) if (inp[k] !== undefined) patch[k] = inp[k];
    if (!Object.keys(patch).length) return { ok: false, errors: ['nothing to change: give upstream, auth, noProxy, timeouts and/or fixedPort (null unsets one)'] };
    const before = current();
    let after;
    try { after = preview(patch); } catch (err) { return { ok: false, errors: [clip(err && err.message ? err.message : err, 300)] }; }
    const b = flat(before); const a = flat(after);
    const changes = Object.keys(LABELS).filter((f) => !same(b[f], a[f]))
      .map((f) => ({ field: f, label: LABELS[f], before: show(f, b[f]), after: show(f, a[f]) }));
    if (!changes.length) return { ok: false, errors: ['these are the stored proxy settings already — nothing would change'] };
    const note = clip(typeof inp.note === 'string' ? inp.note.trim() : '', 200);
    return { ok: true, card: { type: 'proxy', kind: 'settings', patch, changes,
      summary: clip(changes.map((c) => `${c.label}: ${c.after}`).join('; '), 300),
      upstreamChanged: !same(before.upstream, after.upstream), restartNote: PROXY_LIVE_NOTE, note } };
  };
}

/** propose_corporate_proxy_on: the card that sets networkProxy.enabled: true. @param {{ enabledNow: () => boolean }} r */
export function createProxyFlagValidator({ enabledNow }) {
  return async function validateProxyFlagOn(input = {}) {
    if (enabledNow()) return { ok: false, errors: ['the corporate proxy (networkProxy.enabled) is already on; call get_network_proxy'] };
    const note = clip(isObj(input) && typeof input.note === 'string' ? input.note.trim() : '', 200);
    return { ok: true, card: { type: 'proxy', kind: 'enable', patch: { enabled: true },
      changes: [{ field: 'enabled', label: LABELS.enabled, before: 'Off', after: 'On' }],
      summary: `${LABELS.enabled}: On`, restartNote: PROXY_LIVE_NOTE, note } };
  };
}

const eventText = (s, n) => clip(s, n).replace(/"/g, "'").replace(/\[(\/?)worca context\]/gi, '($1worca context)');
export function proxyEventPrompt({ cardId, state, card = {}, result = null }) {
  const summary = eventText(card.summary, 160);
  if (state === 'declined') return `[worca event] proxy card ${cardId} declined; "${summary}"`;
  if (state === 'failed') return `[worca event] proxy card ${cardId} failed: ${eventText(result?.error || 'unknown error', 200)}; "${summary}"`;
  return `[worca event] proxy card ${cardId} applied; "${summary}"${result?.detail ? `; ${eventText(result.detail, 300)}` : ''}`;
}
export function proxyNoticeText({ state, card = {}, result = null }) {
  const s = clip(card.summary, 120);
  if (state === 'declined') return `Declined — ${s}`;
  if (state === 'failed') return `Could not apply — ${s}: ${clip(result?.error || 'unknown error', 200)}`;
  return `Applied — ${s}${result?.detail ? ` · ${clip(result.detail, 200)}` : ''}`;
}
