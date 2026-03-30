/**
 * WebSocket client subscription and heartbeat management.
 * Owns the subs WeakMap that tracks per-client subscriptions.
 * Tracks per-project client counts for activity-based tiering.
 */

/**
 * @param {{ wss: import('ws').WebSocketServer }} deps
 */
export function createClientManager({ wss }) {
  /** @type {WeakMap<import('ws').WebSocket, { runId: string | null, logStage: string | null, logRunId: string | null, eventsRunId: string | null, protocolVersion: number, projectId: string | null }>} */
  const subs = new WeakMap();

  /** @type {Map<string, number>} per-project connected client count */
  const projectClientCounts = new Map();

  /** @type {Set<(projectId: string, count: number) => void>} */
  const clientCountHandlers = new Set();

  function ensureSubs(ws) {
    let s = subs.get(ws);
    if (!s) {
      s = {
        runId: null,
        logStage: null,
        logRunId: null,
        eventsRunId: null,
        protocolVersion: 1,
        projectId: null,
      };
      subs.set(ws, s);
    }
    return s;
  }

  function getSubs(ws) {
    return subs.get(ws);
  }

  function deleteSubs(ws) {
    const s = subs.get(ws);
    if (s?.projectId) {
      _decrementProject(s.projectId);
    }
    subs.delete(ws);
  }

  function setProtocol(ws, version, projectId) {
    const s = ensureSubs(ws);
    const oldProjectId = s.projectId;
    s.protocolVersion = version;
    s.projectId = projectId ?? null;

    // Update project client counts
    if (oldProjectId && oldProjectId !== projectId) {
      _decrementProject(oldProjectId);
    }
    if (projectId && projectId !== oldProjectId) {
      _incrementProject(projectId);
    }
  }

  function _incrementProject(projectId) {
    const current = projectClientCounts.get(projectId) || 0;
    const newCount = current + 1;
    projectClientCounts.set(projectId, newCount);
    _notifyCountChange(projectId, newCount);
  }

  function _decrementProject(projectId) {
    const current = projectClientCounts.get(projectId) || 0;
    const newCount = Math.max(0, current - 1);
    if (newCount === 0) {
      projectClientCounts.delete(projectId);
    } else {
      projectClientCounts.set(projectId, newCount);
    }
    _notifyCountChange(projectId, newCount);
  }

  function _notifyCountChange(projectId, count) {
    for (const fn of clientCountHandlers) {
      try {
        fn(projectId, count);
      } catch {
        /* ignore */
      }
    }
  }

  function getProjectClientCount(projectId) {
    return projectClientCounts.get(projectId) || 0;
  }

  function onClientCountChange(handler) {
    clientCountHandlers.add(handler);
    return () => {
      clientCountHandlers.delete(handler);
    };
  }

  // Heartbeat — ping all clients every 30s, terminate unresponsive ones
  const heartbeat = setInterval(() => {
    for (const ws of wss.clients) {
      if (ws.isAlive === false) {
        ws.terminate();
        continue;
      }
      ws.isAlive = false;
      ws.ping();
    }
  }, 30000);
  heartbeat.unref?.();

  function destroy() {
    clearInterval(heartbeat);
    clientCountHandlers.clear();
  }

  return {
    ensureSubs,
    getSubs,
    deleteSubs,
    setProtocol,
    getProjectClientCount,
    onClientCountChange,
    destroy,
  };
}
