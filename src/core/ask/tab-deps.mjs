// src/core/ask/tab-deps.mjs
// The tool panel's tab tools (issue 1064 slice 3): the MCP child's half. The tabs, the preview proxy and the headless
// capture live in the worca server (src/core/tab-tools.mjs), so the classic child forwards each call to POST /api/ask/tabs
// (loopback only). The URL rides mcpServers.env (WORCA_ASK_TABS, not secret); the per-turn token rides the claude
// process env (ASK_TABS_TOKEN, buildAskSpawnOptions spawnEnv) and never touches disk. There is no relay-mode path:
// under agent isolation the server hands out no tab bridge (the preview proxy refuses agent callers).
export function defaultTabDeps({ env = process.env, fetchImpl = globalThis.fetch } = {}) {
  let cfg = null;
  try { cfg = JSON.parse(env.WORCA_ASK_TABS || 'null'); } catch { cfg = null; }
  const token = typeof env.ASK_TABS_TOKEN === 'string' ? env.ASK_TABS_TOKEN : '';
  if (!cfg || typeof cfg.url !== 'string' || !/^http:\/\/127\.0\.0\.1:\d+\//.test(cfg.url) || !token) return {};
  const call = (op) => async (input) => {
    const res = await fetchImpl(cfg.url, { method: 'POST',
      headers: { 'content-type': 'application/json', 'x-worca-ask-tabs': token },
      body: JSON.stringify({ op, input }) });
    const j = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(j.error || `worca answered HTTP ${res.status}`);
    return j.result;
  };
  return { tabs: { open: call('open'), screenshot: call('screenshot'), read: call('read') } };
}
