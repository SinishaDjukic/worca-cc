/**
 * WebSocket server for worca-ui pipeline monitoring.
 * Handles client connections, message routing, file watching, and log tailing.
 */
import { WebSocketServer } from 'ws';
import { watch, existsSync } from 'node:fs';
import { join } from 'node:path';
import { isRequest, makeOk, makeError } from '../app/protocol.js';
import { discoverRuns } from './watcher.js';
import { readLastLines, resolveLogPath } from './log-tailer.js';
import { readSettings } from './settings-reader.js';
import { readPreferences, writePreferences } from './preferences.js';

/** @type {ReturnType<typeof setTimeout> | null} */
let REFRESH_TIMER = null;
const REFRESH_DEBOUNCE_MS = 75;

/**
 * Attach a WebSocket server to an existing HTTP server.
 *
 * @param {import('node:http').Server} httpServer
 * @param {{ worcaDir: string, settingsPath: string, prefsPath: string }} config
 */
export function attachWsServer(httpServer, config) {
  const { worcaDir, settingsPath, prefsPath } = config;
  const wss = new WebSocketServer({ server: httpServer, path: '/ws' });

  /** @type {WeakMap<import('ws').WebSocket, { runId: string | null, logStage: string | null }>} */
  const subs = new WeakMap();

  /** @type {Map<string, import('node:fs').FSWatcher>} */
  const logWatchers = new Map();

  function ensureSubs(ws) {
    let s = subs.get(ws);
    if (!s) {
      s = { runId: null, logStage: null };
      subs.set(ws, s);
    }
    return s;
  }

  function broadcast(type, payload) {
    const msg = JSON.stringify({
      id: `evt-${Date.now()}`,
      ok: true,
      type,
      payload
    });
    for (const ws of wss.clients) {
      if (ws.readyState === ws.OPEN) {
        ws.send(msg);
      }
    }
  }

  function broadcastToSubscribers(runId, type, payload) {
    const msg = JSON.stringify({
      id: `evt-${Date.now()}`,
      ok: true,
      type,
      payload
    });
    for (const ws of wss.clients) {
      if (ws.readyState !== ws.OPEN) continue;
      const s = subs.get(ws);
      if (s && s.runId === runId) {
        ws.send(msg);
      }
    }
  }

  function broadcastToLogSubscribers(stage, type, payload) {
    const msg = JSON.stringify({
      id: `evt-${Date.now()}`,
      ok: true,
      type,
      payload
    });
    for (const ws of wss.clients) {
      if (ws.readyState !== ws.OPEN) continue;
      const s = subs.get(ws);
      if (s && (s.logStage === stage || s.logStage === '*')) {
        ws.send(msg);
      }
    }
  }

  // Watch .worca/status.json for changes
  function scheduleRefresh() {
    if (REFRESH_TIMER) clearTimeout(REFRESH_TIMER);
    REFRESH_TIMER = setTimeout(() => {
      REFRESH_TIMER = null;
      try {
        const runs = discoverRuns(worcaDir);
        const active = runs.find(r => r.active);
        if (active) {
          broadcastToSubscribers(active.id, 'run-snapshot', active);
        }
      } catch { /* ignore */ }
    }, REFRESH_DEBOUNCE_MS);
  }

  let statusWatcher = null;
  try {
    if (existsSync(worcaDir)) {
      statusWatcher = watch(worcaDir, { recursive: false }, (_eventType, filename) => {
        if (filename === 'status.json') {
          scheduleRefresh();
        }
      });
    }
  } catch { /* ignore - dir may not exist yet */ }

  // Start watching a log file for a stage
  function watchLogFile(stage) {
    const logPath = resolveLogPath(worcaDir, stage);
    const key = stage || '__orchestrator__';
    if (logWatchers.has(key)) return;
    try {
      if (!existsSync(logPath)) return;
      const watcher = watch(logPath, (eventType) => {
        if (eventType === 'change') {
          try {
            const lines = readLastLines(logPath, 1);
            if (lines.length > 0) {
              broadcastToLogSubscribers(stage, 'log-line', {
                stage: stage || 'orchestrator',
                line: lines[lines.length - 1]
              });
            }
          } catch { /* ignore */ }
        }
      });
      logWatchers.set(key, watcher);
    } catch { /* ignore */ }
  }

  // Heartbeat
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

  wss.on('connection', (ws) => {
    ws.isAlive = true;
    ensureSubs(ws);

    ws.on('pong', () => {
      ws.isAlive = true;
    });

    ws.on('message', (data) => {
      handleMessage(ws, data);
    });

    ws.on('close', () => {
      subs.delete(ws);
    });
  });

  wss.on('close', () => {
    clearInterval(heartbeat);
    if (statusWatcher) statusWatcher.close();
    for (const w of logWatchers.values()) w.close();
    logWatchers.clear();
  });

  async function handleMessage(ws, data) {
    let json;
    try {
      json = JSON.parse(data.toString());
    } catch {
      ws.send(JSON.stringify({
        id: 'unknown', ok: false, type: 'bad-json',
        error: { code: 'bad_json', message: 'Invalid JSON' }
      }));
      return;
    }

    if (!isRequest(json)) {
      ws.send(JSON.stringify({
        id: 'unknown', ok: false, type: 'bad-request',
        error: { code: 'bad_request', message: 'Invalid request envelope' }
      }));
      return;
    }

    const req = json;

    // list-runs
    if (req.type === 'list-runs') {
      const runs = discoverRuns(worcaDir);
      const settings = readSettings(settingsPath);
      ws.send(JSON.stringify(makeOk(req, { runs, settings })));
      return;
    }

    // subscribe-run
    if (req.type === 'subscribe-run') {
      const { runId } = req.payload || {};
      if (typeof runId !== 'string') {
        ws.send(JSON.stringify(makeError(req, 'bad_request', 'payload.runId required')));
        return;
      }
      const s = ensureSubs(ws);
      s.runId = runId;
      // Send current snapshot
      const runs = discoverRuns(worcaDir);
      const run = runs.find(r => r.id === runId);
      if (run) {
        ws.send(JSON.stringify(makeOk(req, run)));
      } else {
        ws.send(JSON.stringify(makeError(req, 'NOT_FOUND', `Run ${runId} not found`)));
      }
      return;
    }

    // unsubscribe-run
    if (req.type === 'unsubscribe-run') {
      const s = ensureSubs(ws);
      s.runId = null;
      ws.send(JSON.stringify(makeOk(req, { unsubscribed: true })));
      return;
    }

    // subscribe-log
    if (req.type === 'subscribe-log') {
      const { stage } = req.payload || {};
      const s = ensureSubs(ws);
      s.logStage = stage || '*';
      // Send last 100 lines as bulk
      const logPath = resolveLogPath(worcaDir, stage || null);
      const lines = readLastLines(logPath, 100);
      ws.send(JSON.stringify(makeOk(req, {
        stage: stage || 'orchestrator',
        lines
      })));
      watchLogFile(stage || null);
      return;
    }

    // unsubscribe-log
    if (req.type === 'unsubscribe-log') {
      const s = ensureSubs(ws);
      s.logStage = null;
      ws.send(JSON.stringify(makeOk(req, { unsubscribed: true })));
      return;
    }

    // get-preferences
    if (req.type === 'get-preferences') {
      const prefs = readPreferences(prefsPath);
      ws.send(JSON.stringify(makeOk(req, prefs)));
      return;
    }

    // set-preferences
    if (req.type === 'set-preferences') {
      const prefs = req.payload || {};
      const current = readPreferences(prefsPath);
      const merged = { ...current, ...prefs };
      writePreferences(merged, prefsPath);
      // Broadcast to all clients
      broadcast('preferences', merged);
      ws.send(JSON.stringify(makeOk(req, merged)));
      return;
    }

    // Unknown type
    ws.send(JSON.stringify(makeError(req, 'unknown_type', `Unknown message type: ${req.type}`)));
  }

  return { wss, broadcast };
}
