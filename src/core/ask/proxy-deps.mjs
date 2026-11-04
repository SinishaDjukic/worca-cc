// The corporate proxy's chat bundle (docs/network-proxy.md "From Chat"): the ONE module that reads the stored
// networkProxy on the tools' behalf (tools.mjs imports nothing). The live state — connector, local URL, the passed
// tests, the one-test lock — lives in the worca server (src/core/proxy-host.mjs), so the classic MCP child
// reaches it through the per-turn proxy bridge (POST /api/ask/proxy, loopback only): the URL rides mcpServers.env
// (WORCA_ASK_PROXY), the token the spawn env (ASK_PROXY_TOKEN), never disk. Relay mode passes in-process deps instead
// (ui/server.mjs askAgentRelay), where Test is refused: relay mode is agent isolation.
import { networkProxySettings, previewNetworkProxy, networkProxyEnabled } from '../settings.mjs';
import { createProxyChangeValidator, createProxyFlagValidator, PROXY_LIVE_NOTE } from './proxy-proposal.mjs';

const enabledNow = () => networkProxyEnabled();
export const validateProxyChange = createProxyChangeValidator({ current: networkProxySettings, preview: previewNetworkProxy });
export const validateProxyFlagOn = createProxyFlagValidator({ enabledNow });

/** Behind the card's Apply. Re-validates, tests an upstream nobody tested yet, then saves through the live path (D9, D10).
 *  kind 'flag' is a card proposed before the upgrade: it applies as 'enable'. */
export async function applyProxyChange(card, io = {}) {
  const invalid = (r) => Object.assign(new Error((r && r.errors ? r.errors : ['invalid proposal']).join('; ')), { code: 'INVALID' });
  if (typeof io.saveSettings !== 'function') throw new Error('proxy settings: no proxy host in this process');
  let patch;
  if (card.kind === 'enable' || card.kind === 'flag') {
    // Already on (another tab, Settings) is not a failure.
    if ((io.enabledNow ?? enabledNow)()) return { ok: true, detail: 'The corporate proxy was already on.' };
    patch = { enabled: true };
  } else if (card.kind === 'settings') {
    const r = await (io.validateChange ?? validateProxyChange)({ ...(card.patch || {}) });
    if (!r.ok) throw invalid(r);
    patch = r.card.patch;
  } else throw new Error(`unknown proxy change kind "${card.kind}"`);
  let saved = await io.saveSettings(patch);
  if (saved && saved.refused && typeof io.test === 'function') {
    const t = await io.test(patch);
    if (!(t && t.status === 200 && t.body.ok)) throw Object.assign(new Error('the proxy test did not pass; nothing was saved'), { code: 'UNTESTED' });
    saved = await io.saveSettings(patch);
  }
  if (saved && saved.refused) throw Object.assign(new Error(saved.refused.body.error), { code: saved.refused.body.code });
  const pending = (saved && saved.pending) || [];
  return { ok: true, detail: `Saved. ${PROXY_LIVE_NOTE}${pending.includes('fixedPort') ? ' The local proxy port applies at the next start.' : ''}` };
}

export function defaultProxyDeps({ env = process.env, fetchImpl = globalThis.fetch } = {}) {
  let cfg = null;
  try { cfg = JSON.parse(env.WORCA_ASK_PROXY || 'null'); } catch { cfg = null; }
  const token = typeof env.ASK_PROXY_TOKEN === 'string' ? env.ASK_PROXY_TOKEN : '';
  const bridged = !!(cfg && typeof cfg.url === 'string' && /^http:\/\/127\.0\.0\.1:\d+\//.test(cfg.url) && token);
  const call = (op) => async () => {
    const res = await fetchImpl(cfg.url, { method: 'POST', headers: { 'content-type': 'application/json', 'x-worca-ask-proxy': token }, body: JSON.stringify({ op }) });
    const j = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(j.error || `worca answered HTTP ${res.status}`);
    return j.result;
  };
  return { proxy: {
    status: bridged ? call('status') : null,
    test: bridged ? call('test') : null,
    testOff: null,
    validateChange: validateProxyChange,
    validateFlagOn: validateProxyFlagOn,
  } };
}
