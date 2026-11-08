// src/core/ask/chat-message-deps.mjs — the classic MCP child's cross-chat message bundle (send_to_chat). tools.mjs
// imports nothing, so the bridge lives here, modelled on proxy-deps.mjs: the per-turn URL rides mcpServers.env
// (WORCA_ASK_MESSAGES, loopback only), the token the spawn env (ASK_MESSAGE_TOKEN), never disk. The server works out the
// calling chat from the token alone. Relay mode passes in-process deps instead (ui/server.mjs askChatMessageExtraDeps).

const LOOPBACK_RE = /^http:\/\/127\.0\.0\.1:\d+\//;

/** {chatMessages:{send}} when this turn's env names the bridge, else {} (send_to_chat is then not listed). */
export function defaultChatMessageDeps({ env = process.env, fetchImpl = globalThis.fetch } = {}) {
  let cfg = null;
  try { cfg = JSON.parse(env.WORCA_ASK_MESSAGES || 'null'); } catch { cfg = null; }
  const token = typeof env.ASK_MESSAGE_TOKEN === 'string' ? env.ASK_MESSAGE_TOKEN : '';
  if (!cfg || typeof cfg.url !== 'string' || !LOOPBACK_RE.test(cfg.url) || !token) return {};
  const send = async (input) => {
    const res = await fetchImpl(cfg.url, { method: 'POST', headers: { 'content-type': 'application/json', 'x-worca-ask-message': token }, body: JSON.stringify({ input }) });
    const j = await res.json().catch(() => ({}));
    if (!res.ok) return { ok: false, code: typeof j.code === 'string' ? j.code : 'CHAT_MESSAGE_ERROR', error: j.error || `worca answered HTTP ${res.status}` };
    return j.result;
  };
  return { chatMessages: { send } };
}
