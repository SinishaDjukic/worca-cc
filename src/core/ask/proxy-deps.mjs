// The corporate proxy's chat bundle (docs/network-proxy.md "From Chat"): the ONE module that reads the flag and the
// stored networkProxy on the tools' behalf (tools.mjs imports nothing). The live state — connector, local URL, D14's
// since-boot marker, the one-test lock — lives in the worca server (src/core/proxy-host.mjs), so the classic MCP child
// reaches it through the per-turn proxy bridge (POST /api/ask/proxy, loopback only): the URL rides mcpServers.env
// (WORCA_ASK_PROXY), the token the spawn env (ASK_PROXY_TOKEN), never disk. Relay mode passes in-process deps instead
// (ui/server.mjs askAgentRelay), where Test is refused: relay mode is agent isolation.
import { flagEnabled, checkFlags, setFlags } from '../flags.mjs';
import { networkProxySettings, previewNetworkProxy } from '../settings.mjs';
import { createProxyChangeValidator, createProxyFlagValidator } from './proxy-proposal.mjs';

const flagOn = () => flagEnabled('corporateProxy');
export const validateProxyChange = createProxyChangeValidator({ flagOn, current: networkProxySettings, preview: previewNetworkProxy });
export const validateProxyFlagOn = createProxyFlagValidator({ flagOn, checkFlags });

/** Behind the card's Apply (ui/server.mjs cards route). Re-validates against the settings as they are now. */
export async function applyProxyChange(card, io = {}) {
  const invalid = (r) => Object.assign(new Error((r && r.errors ? r.errors : ['invalid proposal']).join('; ')), { code: 'INVALID' });
  if (card.kind === 'flag') {
    // Already on (another tab, Settings › Labs) is not a failure.
    if ((io.flagOn ?? flagOn)()) return { ok: true, detail: 'The corporate proxy was already on. Restart Worca if it is not running yet.' };
    const r = await (io.validateFlagOn ?? validateProxyFlagOn)({});
    if (!r.ok) throw invalid(r);
    await (io.setFlags ?? setFlags)({ corporateProxy: true });
    return { ok: true, detail: 'Corporate proxy is on. Restart Worca to start the local proxy.' };
  }
  if (card.kind === 'settings') {
    const r = await (io.validateChange ?? validateProxyChange)({ ...(card.patch || {}) });
    if (!r.ok) throw invalid(r);
    if (typeof io.saveSettings !== 'function') throw new Error('proxy settings: no proxy host in this process');
    await io.saveSettings(r.card.patch);
    return { ok: true, detail: 'Saved. Restart Worca to apply.' };
  }
  throw new Error(`unknown proxy change kind "${card.kind}"`);
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
    flagOn,
    status: bridged ? call('status') : null,
    test: bridged ? call('test') : null,
    testOff: null,
    validateChange: validateProxyChange,
    validateFlagOn: validateProxyFlagOn,
  } };
}
