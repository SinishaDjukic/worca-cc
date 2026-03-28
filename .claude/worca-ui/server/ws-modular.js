/**
 * Modular WebSocket server — facade wiring 7 extracted modules.
 * Drop-in replacement for ws-legacy.js with identical behavior.
 *
 * Supports multi-project mode via WatcherSet map when projects.d/ exists.
 * Supports dynamic project add/remove via fs.watch on projects.d/.
 */

import { existsSync, watch } from 'node:fs';
import { join } from 'node:path';
import { WebSocketServer } from 'ws';
import { readProjects, synthesizeDefaultProject } from './project-registry.js';
import { TIER_FULL, TIER_POLLING, WatcherSet } from './watcher-set.js';
import { createBroadcaster } from './ws-broadcaster.js';
import { createClientManager } from './ws-client-manager.js';
import { createMessageRouter } from './ws-message-router.js';
import { resolveActiveRunDir } from './ws-status-watcher.js';

export { resolveActiveRunDir };

/**
 * Attach a WebSocket server to an existing HTTP server.
 *
 * @param {import('node:http').Server} httpServer
 * @param {{ worcaDir: string, settingsPath: string, prefsPath: string, prefsDir?: string }} config
 */
export function attachWsServer(httpServer, config) {
  const {
    worcaDir,
    settingsPath,
    prefsPath,
    webhookInbox,
    projectRoot,
    prefsDir,
  } = config;
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
    // Multi-project mode — start in Polling tier (promoted on client subscribe)
    for (const proj of projects) {
      const ws = new WatcherSet(
        proj.name,
        proj.worcaDir || join(proj.path, '.worca'),
        {
          broadcaster,
          getSubs: clientManager.getSubs,
          wss,
          settingsPath:
            proj.settingsPath || join(proj.path, '.claude', 'settings.json'),
          projectRoot: proj.path,
          webhookInbox,
        },
      );
      ws.create();
      watcherSets.set(proj.name, ws);
    }
  } else {
    // Single-project mode — start in Full tier (backward compatible)
    const effectiveRoot =
      projectRoot || (worcaDir ? join(worcaDir, '..') : process.cwd());
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
    ws.setTier(TIER_FULL);
    watcherSets.set(synth.name, ws);
  }

  // Default WatcherSet — used by message router (Phase 1a: UI is single-project)
  let defaultWs = watcherSets.values().next().value;

  // 4. Dynamic project watching — watch projects.d/ for add/remove
  let dirWatcher = null;
  let debounceTimer = null;

  if (prefsDir) {
    const projectsDir = join(prefsDir, 'projects.d');
    try {
      if (existsSync(projectsDir)) {
        dirWatcher = watch(projectsDir, { persistent: false }, () => {
          if (debounceTimer) clearTimeout(debounceTimer);
          debounceTimer = setTimeout(() => {
            debounceTimer = null;
            _syncProjects();
          }, 500);
        });
      }
    } catch {
      // fs.watch not supported or dir doesn't exist yet — skip
    }
  }

  function _syncProjects() {
    if (!prefsDir) return;
    const freshProjects = readProjects(prefsDir);
    const freshNames = new Set(freshProjects.map((p) => p.name));
    const currentNames = new Set(watcherSets.keys());

    // Add new projects
    for (const proj of freshProjects) {
      if (!currentNames.has(proj.name)) {
        const ws = new WatcherSet(
          proj.name,
          proj.worcaDir || join(proj.path, '.worca'),
          {
            broadcaster,
            getSubs: clientManager.getSubs,
            wss,
            settingsPath:
              proj.settingsPath || join(proj.path, '.claude', 'settings.json'),
            projectRoot: proj.path,
            webhookInbox,
          },
        );
        ws.create();
        watcherSets.set(proj.name, ws);
      }
    }

    // Remove deleted projects
    for (const name of currentNames) {
      if (!freshNames.has(name)) {
        const wset = watcherSets.get(name);
        if (wset) {
          wset.destroy();
          watcherSets.delete(name);
        }
      }
    }

    // Update default if needed
    if (watcherSets.size > 0) {
      defaultWs = watcherSets.values().next().value;
    }

    // Broadcast projects-updated to all clients
    const projectList = freshProjects.map((p) => ({
      name: p.name,
      path: p.path,
    }));
    broadcaster.broadcast('projects-updated', { projects: projectList });
  }

  // 5. Tier management — promote/demote based on client subscriptions
  clientManager.onClientCountChange((projectId, count) => {
    const wset = watcherSets.get(projectId);
    if (!wset) return;
    if (count > 0 && wset.getTier() === TIER_POLLING) {
      wset.setTier(TIER_FULL);
    } else if (count === 0 && wset.getTier() === TIER_FULL) {
      // Demote after a grace period to avoid flip-flop on page refresh
      setTimeout(() => {
        if (
          clientManager.getProjectClientCount(projectId) === 0 &&
          wset.getTier() === TIER_FULL
        ) {
          wset.setTier(TIER_POLLING);
        }
      }, 5000);
    }
  });

  // 6. Message router — resolves project per-request via watcherSets
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
      ws.send(
        JSON.stringify({
          id: `evt-${Date.now()}`,
          ok: true,
          type: 'hello',
          payload: { protocol: 2, capabilities: ['multi-project'] },
        }),
      );

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
      if (eventsRunId && defaultWs?.eventWatcher) {
        defaultWs.eventWatcher.maybeCloseEventWatcher(eventsRunId);
      }
    });
  });

  wss.on('close', () => {
    clientManager.destroy();
    if (dirWatcher) {
      try {
        dirWatcher.close();
      } catch {
        /* ignore */
      }
      dirWatcher = null;
    }
    if (debounceTimer) {
      clearTimeout(debounceTimer);
      debounceTimer = null;
    }
    for (const ws of watcherSets.values()) {
      ws.destroy();
    }
    watcherSets.clear();
  });

  return { wss, broadcast: broadcaster.broadcast, scheduleRefresh };
}
