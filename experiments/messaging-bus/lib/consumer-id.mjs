// experiments/messaging-bus/lib/consumer-id.mjs
// The consumer identity of one agent (plan §3.4): `<prefix>:<sessionId>:<agentKey>`, case kept,
// and its own address with lowercased topic segments. Pure: the lowercase-collision check needs
// state, so it lives in the bus (claimAgentKey) and runs inside readRenderAck.
import { validateSegmentId } from './envelope.mjs';

const PREFIX_RE = /^[A-Za-z0-9._-]{1,200}$/;

export function consumerFromPayload(payload, prefix) {
  const bad = (message) => ({ ok: false, code: 'BUS_BAD_CONSUMER', message });
  if (typeof prefix !== 'string' || !PREFIX_RE.test(prefix)) return bad('bad consumer prefix');
  if (payload === null || typeof payload !== 'object') return bad('payload must be an object');
  const sessionId = payload.session_id;
  if (!validateSegmentId(sessionId)) return bad('session_id missing or not [A-Za-z0-9_-]{1,64}');
  let agentKey = 'main';
  if (payload.agent_id !== undefined && payload.agent_id !== null) {
    if (!validateSegmentId(payload.agent_id)) return bad('agent_id not [A-Za-z0-9_-]{1,64}');
    if (payload.agent_id.toLowerCase() === 'main') return bad('agent_id "main" is reserved');
    agentKey = payload.agent_id;
  }
  const sessionKey = sessionId.toLowerCase();
  const topicKey = agentKey.toLowerCase();
  const ownTopic = agentKey === 'main' ? `agent.${sessionKey}.inbox` : `agent.${sessionKey}.sub.${topicKey}`;
  return { ok: true, consumer: `${prefix}:${sessionId}:${agentKey}`, sessionId, agentKey, sessionKey, topicKey, ownTopic };
}
