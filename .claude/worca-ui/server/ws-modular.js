/**
 * Modular WebSocket server — facade wiring 7 extracted modules.
 * Drop-in replacement for ws-legacy.js with identical behavior.
 *
 * Supports multi-project mode via WatcherSet map when projects.d/ exists.
 */

import { join } from 'node:path';
import { WebSocketServer } from 'ws';
import { readProjects, synthesizeDefaultProject } from './project-registry.js';
import { WatcherSet } from './watcher-set.js';
import { createClientManager } from './ws-client-manager.js';
import { createBroadcaster } from './ws-broadcaster.js';
import { resolveActiveRunDir } from './ws-status-watcher.js';
import { createMessageRouter } from './ws-message-router.js';

export { resolveActiveRunDir };

/**
 * Attach a WebSocket server to an existing HTTP server.
 *
 * @param {import('node:http').Server} httpServer
 * @param {{ worcaDir: string, settingsPath: string, prefsPath: string, prefsDir?: string }} config
 */
export function attachWsServer(httpServer, config) {
  const { worcaDir, settingsPath, prefsPath, webhookInbox, projectRoot, prefsDir } =
    config;
  const wss = new WebSocketServer({ server: httpServer, path: '/ws' });

  // 1. Client manager — owns subs WeakMap and heartbeat
  const clientManager = createClientManager({ wss });

  // 2. Broadcaster — stateless, uses wss.clients + subs
  const broadcaster = createBroadcaster({
    wss,
    getSubs: clientManager.getSubs,
  });

  // 3. Create WatcherSet(s) — one per project
  /** @type {Map<string, WatcherSet>} */
  const watcherSets = new Map();

  const projects = prefsDir ? readProjects(prefsDir) : [];
  if (projects.length > 0) {
    // Multi-project mode
    for (const proj of projects) {
      const ws = new WatcherSet(proj.name, proj.worcaDir || join(proj.path, '.worca'), {
        broadcaster,
        getSubs: clientManager.getSubs,
        wss,
        settingsPath: proj.settingsPath || join(proj.path, '.claude', 'settings.json'),
        projectRoot: proj.path,
        webhookInbox,
      });
      ws.create();
      watcherSets.set(proj.name, ws);
    }
  } else {
    // Single-project mode — synthesize from construction-time config
    const effectiveRoot = projectRoot || (worcaDir ? join(worcaDir, '..') : process.cwd());
    const synth = synthesizeDefaultProject(effectiveRoot);
    const ws = new WatcherSet(synth.name, worcaDir, {
      broadcaster,
      getSubs: clientManager.getSubs,
      wss,
      settingsPath,
      projectRoot,
      webhookInbox,
    });
    ws.create();
    watcherSets.set(synth.name, ws);
  }

  // Default WatcherSet — used by message router (Phase 1a: UI is single-project)
  const defaultWs = watcherSets.values().next().value;

  // 4. Message router — resolves project per-request via watcherSets
  const messageRouter = createMessageRouter({
    watcherSets,
    defaultWs,
    prefsPath,
    webhookInbox,
    clientManager,
    broadcaster,
  });

  /**
   * Scoped scheduleRefresh: with projectName refreshes one, without refreshes all.
   */
  function scheduleRefresh(projectName) {
    if (projectName) {
      const ws = watcherSets.get(projectName);
      if (ws) ws.scheduleRefresh();
    } else {
      for (const ws of watcherSets.values()) {
        ws.scheduleRefresh();
      }
    }
  }

  // Connection lifecycle
  wss.on('connection', (ws) => {
    ws.isAlive = true;
    clientManager.ensureSubs(ws);

    // Send hello handshake when multi-project is configured.
    // Protocol 2 clients reply with hello-ack; protocol 1 clients ignore it.
    if (prefsDir) {
      ws.send(JSON.stringify({
        id: `evt-${Date.now()}`,
        ok: true,
        type: 'hello',
        payload: { protocol: 2, capabilities: ['multi-project'] },
      }));

      // Timeout: if no hello-ack in 2s, client stays at protocol 1 (legacy)
      const helloTimeout = setTimeout(() => {
        // No-op: client stays at protocol 1 by default
      }, 2000);
      ws._helloTimeout = helloTimeout;
    }

    ws.on('pong', () => {
      ws.isAlive = true;
    });

    ws.on('message', (data) => {
      messageRouter.handleMessage(ws, data);
    });

    ws.on('close', () => {
      const s = clientManager.getSubs(ws);
      const eventsRunId = s?.eventsRunId;
      clientManager.deleteSubs(ws);
      if (eventsRunId && defaultWs.eventWatcher) {
        defaultWs.eventWatcher.maybeCloseEventWatcher(eventsRunId);
      }
    });
  });

  wss.on('close', () => {
    clientManager.destroy();
    for (const ws of watcherSets.values()) {
      ws.destroy();
    }
    watcherSets.clear();
  });

  return { wss, broadcast: broadcaster.broadcast, scheduleRefresh };
}
