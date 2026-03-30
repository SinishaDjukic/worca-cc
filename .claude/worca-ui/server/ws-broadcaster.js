/**
 * WebSocket broadcast utilities.
 * Stateless — uses wss.clients and the subs WeakMap from client-manager.
 *
 * Protocol 2 clients receive an extra `project` field in broadcast messages.
 * Protocol 1 clients receive messages identical to pre-multi-project behavior.
 */

/**
 * @param {{ wss: import('ws').WebSocketServer, getSubs: Function }} deps
 */
export function createBroadcaster({ wss, getSubs }) {
  /**
   * Build a message envelope. For protocol 2 clients with a projectId,
   * a `project` field is added to the top-level message.
   */
  function sendToClient(ws, baseMsg) {
    const s = getSubs(ws);
    if (s && s.protocolVersion >= 2 && s.projectId) {
      ws.send(JSON.stringify({ ...baseMsg, project: s.projectId }));
    } else {
      ws.send(JSON.stringify(baseMsg));
    }
  }

  function broadcast(type, payload, projectId) {
    const base = {
      id: `evt-${Date.now()}`,
      ok: true,
      type,
      payload,
    };
    for (const ws of wss.clients) {
      if (ws.readyState !== ws.OPEN) continue;
      if (projectId) {
        const s = getSubs(ws);
        // Skip clients subscribed to a different project.
        // Send to unscoped clients (protocol 1) and matching protocol 2 clients.
        if (s && s.protocolVersion >= 2 && s.projectId && s.projectId !== projectId) continue;
      }
      sendToClient(ws, base);
    }
  }

  function broadcastToSubscribers(runId, type, payload) {
    const base = {
      id: `evt-${Date.now()}`,
      ok: true,
      type,
      payload,
    };
    for (const ws of wss.clients) {
      if (ws.readyState !== ws.OPEN) continue;
      const s = getSubs(ws);
      if (s && s.runId === runId) {
        sendToClient(ws, base);
      }
    }
  }

  function broadcastToLogSubscribers(stage, type, payload, runId) {
    const base = {
      id: `evt-${Date.now()}`,
      ok: true,
      type,
      payload,
    };
    for (const ws of wss.clients) {
      if (ws.readyState !== ws.OPEN) continue;
      const s = getSubs(ws);
      if (s && (s.logStage === stage || s.logStage === '*')) {
        if (runId && s.logRunId && s.logRunId !== runId) continue;
        sendToClient(ws, base);
      }
    }
  }

  function broadcastPipelineEvent(runId, event) {
    const base = {
      id: `evt-${Date.now()}`,
      ok: true,
      type: 'pipeline-event',
      payload: event,
    };
    for (const ws of wss.clients) {
      if (ws.readyState !== ws.OPEN) continue;
      const s = getSubs(ws);
      if (s && s.eventsRunId === runId) {
        sendToClient(ws, base);
      }
    }
  }

  return {
    broadcast,
    broadcastToSubscribers,
    broadcastToLogSubscribers,
    broadcastPipelineEvent,
  };
}
