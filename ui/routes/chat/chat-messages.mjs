// ui/routes/chat/chat-messages.mjs — feature "chat" (docs/chat-home.md, "Messages between chats"): the cross-chat
// message bridge's loopback route. The classic MCP child (src/core/ask/chat-message-deps.mjs) posts send_to_chat here
// with its turn's token; the calling chat is the token's thread, never a body field. Not an AGENT_OPEN_ROUTES route:
// under agent isolation the relay passes in-process deps and no bridge is minted.
import { CHAT_MESSAGE_CODES } from '../../../src/core/ask/chat-messages.mjs';
import { isInContainer } from '../../../src/core/remote-access.mjs';
import { askChatMessageBridges, chatMessenger } from '../../server.mjs';

export function register(app) {

app.post('/api/ask/chat-messages', async (req, res) => {
  if (!isInContainer(req)) return res.status(403).json({ error: 'chat messages: loopback callers only' });
  const threadId = askChatMessageBridges.get(String(req.headers['x-worca-ask-message'] || ''));
  if (!threadId) return res.status(403).json({ error: 'chat messages: unknown or finished turn' });
  // Re-checked on every call: turning the setting off mid-turn stops sends at once.
  if (!chatMessenger.enabled()) {
    return res.status(403).json({ error: 'Messages between chats are turned off in Settings → Chat.', code: 'CHAT_MESSAGES_OFF' });
  }
  try {
    const result = await chatMessenger.send(threadId, req.body && req.body.input);
    if (result && result.ok) return res.json({ result });
    return res.status(CHAT_MESSAGE_CODES[result?.code] || 400).json({ error: result?.error || 'refused', code: result?.code || 'CHAT_MESSAGE_BAD_INPUT' });
  } catch (err) {
    return res.status(500).json({ error: `chat messages: ${err && err.message ? err.message : String(err)}` });
  }
});

}
