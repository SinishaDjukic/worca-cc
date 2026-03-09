/**
 * WebSocket server for worca-ui pipeline monitoring.
 * Handles client connections, message routing, file watching, and log tailing.
 */
import { WebSocketServer } from 'ws';
import { watch, existsSync, readFileSync, unlinkSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { spawn, execFileSync } from 'node:child_process';
import { isRequest, makeOk, makeError } from '../app/protocol.js';
import { discoverRuns } from './watcher.js';
import { readLastLines, resolveLogPath, resolveIterationLogPath, countLines, readLinesFrom, listLogFiles, listIterationFiles } from './log-tailer.js';
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

  // Track line counts per log file so we only send new lines
  const logLineCounts = new Map();

  // Start watching a single log file
  function watchSingleLogFile(stage, filePath, iteration) {
    const key = iteration != null ? `${stage}__iter${iteration}` : (stage || '__orchestrator__');
    if (logWatchers.has(key)) return;
    try {
      if (!existsSync(filePath)) return;
      logLineCounts.set(key, countLines(filePath));
      const watcher = watch(filePath, (eventType) => {
        if (eventType === 'change') {
          try {
            const prevCount = logLineCounts.get(key) || 0;
            const newLines = readLinesFrom(filePath, prevCount);
            if (newLines.length > 0) {
              logLineCounts.set(key, prevCount + newLines.length);
              for (const line of newLines) {
                broadcastToLogSubscribers(stage, 'log-line', {
                  stage: stage || 'orchestrator',
                  iteration: iteration ?? undefined,
                  line,
                });
              }
            }
          } catch { /* ignore */ }
        }
      });
      logWatchers.set(key, watcher);
    } catch { /* ignore */ }
  }

  // Start watching log files for a stage (handles both nested iteration dirs and flat files)
  function watchLogFile(stage) {
    if (!stage) {
      // Orchestrator — single flat file
      const logPath = resolveLogPath(worcaDir, null);
      watchSingleLogFile(null, logPath, null);
      return;
    }
    // Check if nested iteration directory exists
    const stageDir = resolveLogPath(worcaDir, stage);
    if (existsSync(stageDir) && statSync(stageDir).isDirectory()) {
      // Watch each iteration file
      const iters = listIterationFiles(worcaDir, stage);
      for (const { iteration, path } of iters) {
        watchSingleLogFile(stage, path, iteration);
      }
      // Watch the stage directory for new iteration files
      const dirKey = `${stage}__dir`;
      if (!logWatchers.has(dirKey)) {
        try {
          const dirWatcher = watch(stageDir, (eventType, filename) => {
            if (filename && /^iter-\d+\.log$/.test(filename)) {
              const iterNum = parseInt(filename.match(/\d+/)[0]);
              const iterPath = join(stageDir, filename);
              watchSingleLogFile(stage, iterPath, iterNum);
            }
          });
          logWatchers.set(dirKey, dirWatcher);
        } catch { /* ignore */ }
      }
    } else {
      // Legacy flat file fallback
      const logPath = join(worcaDir, 'logs', `${stage}.log`);
      watchSingleLogFile(stage, logPath, null);
    }
  }

  // Watch all existing log files and the logs directory for new ones
  function watchAllLogFiles() {
    const logFiles = listLogFiles(worcaDir);
    const watchedStages = new Set();
    for (const { stage } of logFiles) {
      if (watchedStages.has(stage)) continue;
      watchedStages.add(stage);
      const actualStage = stage === 'orchestrator' ? null : stage;
      watchLogFile(actualStage);
    }
    // Watch logs directory for newly created files and directories
    const logsDir = join(worcaDir, 'logs');
    const dirKey = '__logs_dir__';
    if (logWatchers.has(dirKey)) return;
    if (!existsSync(logsDir)) return;
    try {
      const dirWatcher = watch(logsDir, (_eventType, filename) => {
        if (!filename) return;
        if (filename.endsWith('.log')) {
          // Legacy flat file
          const stage = filename.replace('.log', '');
          const actualStage = stage === 'orchestrator' ? null : stage;
          watchLogFile(actualStage);
        } else {
          // Could be a new stage directory — try watching it
          const stagePath = join(logsDir, filename);
          if (existsSync(stagePath) && statSync(stagePath).isDirectory()) {
            watchLogFile(filename);
          }
        }
      });
      logWatchers.set(dirKey, dirWatcher);
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

  function _sendArchivedLogs(ws, archivedLogDir, stage, iteration) {
    try {
      if (stage) {
        // Check nested dir first
        const stageDir = join(archivedLogDir, stage);
        if (existsSync(stageDir) && statSync(stageDir).isDirectory()) {
          const files = readdirSync(stageDir)
            .filter(f => /^iter-\d+\.log$/.test(f))
            .sort((a, b) => parseInt(a.match(/\d+/)[0]) - parseInt(b.match(/\d+/)[0]));
          for (const f of files) {
            const iterNum = parseInt(f.match(/\d+/)[0]);
            if (iteration != null && iterNum !== iteration) continue;
            const lines = readLastLines(join(stageDir, f), 200);
            if (lines.length > 0) {
              ws.send(JSON.stringify({
                id: `evt-${Date.now()}-iter${iterNum}`, ok: true, type: 'log-bulk',
                payload: { stage, iteration: iterNum, lines },
              }));
            }
          }
        } else {
          // Legacy flat file
          const logPath = join(archivedLogDir, `${stage}.log`);
          const lines = readLastLines(logPath, 200);
          if (lines.length > 0) {
            ws.send(JSON.stringify({
              id: `evt-${Date.now()}`, ok: true, type: 'log-bulk',
              payload: { stage, lines },
            }));
          }
        }
      } else {
        // All stages — scan for both nested dirs and flat files
        const entries = readdirSync(archivedLogDir, { withFileTypes: true });
        for (const entry of entries) {
          if (entry.isFile() && entry.name.endsWith('.log')) {
            const s2 = entry.name.replace('.log', '');
            const lines = readLastLines(join(archivedLogDir, entry.name), 200);
            if (lines.length > 0) {
              ws.send(JSON.stringify({
                id: `evt-${Date.now()}-${s2}`, ok: true, type: 'log-bulk',
                payload: { stage: s2, lines },
              }));
            }
          } else if (entry.isDirectory()) {
            const stageDir2 = join(archivedLogDir, entry.name);
            const iterFiles = readdirSync(stageDir2)
              .filter(f => /^iter-\d+\.log$/.test(f))
              .sort((a, b) => parseInt(a.match(/\d+/)[0]) - parseInt(b.match(/\d+/)[0]));
            for (const f of iterFiles) {
              const iterNum = parseInt(f.match(/\d+/)[0]);
              const lines = readLastLines(join(stageDir2, f), 200);
              if (lines.length > 0) {
                ws.send(JSON.stringify({
                  id: `evt-${Date.now()}-${entry.name}-iter${iterNum}`, ok: true, type: 'log-bulk',
                  payload: { stage: entry.name, iteration: iterNum, lines },
                }));
              }
            }
          }
        }
      }
    } catch { /* ignore */ }
  }

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
      const { stage, runId, iteration } = req.payload || {};
      const s = ensureSubs(ws);
      s.logStage = stage || '*';
      // Acknowledge the subscription
      ws.send(JSON.stringify(makeOk(req, { subscribed: true })));

      // Check if this is an archived run (logs in .worca/results/{runId}/)
      const archivedLogDir = runId ? join(worcaDir, 'results', runId) : null;
      const isArchived = archivedLogDir && existsSync(archivedLogDir);

      if (isArchived) {
        // Static archived logs — send bulk, no file watching
        _sendArchivedLogs(ws, archivedLogDir, stage, iteration);
      } else {
        // Live run — with file watching
        if (stage) {
          if (iteration != null) {
            // Specific iteration
            const logPath = resolveIterationLogPath(worcaDir, stage, iteration);
            const lines = readLastLines(logPath, 200);
            if (lines.length > 0) {
              ws.send(JSON.stringify({
                id: `evt-${Date.now()}`, ok: true, type: 'log-bulk',
                payload: { stage, iteration, lines },
              }));
            }
          } else {
            // All iterations for this stage
            const stageDir = resolveLogPath(worcaDir, stage);
            if (existsSync(stageDir) && statSync(stageDir).isDirectory()) {
              const iters = listIterationFiles(worcaDir, stage);
              for (const { iteration: iterNum, path } of iters) {
                const lines = readLastLines(path, 200);
                if (lines.length > 0) {
                  ws.send(JSON.stringify({
                    id: `evt-${Date.now()}-iter${iterNum}`, ok: true, type: 'log-bulk',
                    payload: { stage, iteration: iterNum, lines },
                  }));
                }
              }
            } else {
              // Legacy flat file fallback
              const logPath = join(worcaDir, 'logs', `${stage}.log`);
              const lines = readLastLines(logPath, 200);
              if (lines.length > 0) {
                ws.send(JSON.stringify({
                  id: `evt-${Date.now()}`, ok: true, type: 'log-bulk',
                  payload: { stage, lines },
                }));
              }
            }
          }
          watchLogFile(stage);
        } else {
          const logFiles = listLogFiles(worcaDir);
          for (const { stage: s2, iteration: iterNum, path } of logFiles) {
            const lines = readLastLines(path, 200);
            if (lines.length > 0) {
              ws.send(JSON.stringify({
                id: `evt-${Date.now()}-${s2}-${iterNum || 0}`, ok: true, type: 'log-bulk',
                payload: { stage: s2, iteration: iterNum ?? undefined, lines },
              }));
            }
          }
          watchAllLogFiles();
        }
      }
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

    // stop-run: send SIGTERM to the running pipeline
    if (req.type === 'stop-run') {
      let pid = null;
      const pidPath = join(worcaDir, 'pipeline.pid');

      // Try PID file first
      if (existsSync(pidPath)) {
        try {
          pid = parseInt(readFileSync(pidPath, 'utf8').trim(), 10);
          process.kill(pid, 0); // verify alive
        } catch {
          try { unlinkSync(pidPath); } catch {}
          pid = null;
        }
      }

      // Fallback: find pipeline process by command line
      if (!pid) {
        try {
          const out = execFileSync('pgrep', ['-f', 'run_pipeline\\.py'], { encoding: 'utf8', timeout: 3000 });
          const pids = out.trim().split('\n').map(s => parseInt(s, 10)).filter(n => n > 0);
          if (pids.length > 0) pid = pids[0];
        } catch { /* no matching process */ }
      }

      if (!pid) {
        ws.send(JSON.stringify(makeError(req, 'not_running', 'No running pipeline found')));
        return;
      }

      try {
        process.kill(pid, 'SIGTERM');
        ws.send(JSON.stringify(makeOk(req, { stopped: true, pid })));
      } catch (e) {
        try { unlinkSync(pidPath); } catch {}
        ws.send(JSON.stringify(makeError(req, 'not_running', `Failed to stop pipeline: ${e.message}`)));
      }
      return;
    }

    // resume-run: spawn a new pipeline process with --resume
    if (req.type === 'resume-run') {
      const pidPath = join(worcaDir, 'pipeline.pid');
      // Check not already running
      if (existsSync(pidPath)) {
        try {
          const pid = parseInt(readFileSync(pidPath, 'utf8').trim(), 10);
          process.kill(pid, 0); // throws if dead
          ws.send(JSON.stringify(makeError(req, 'already_running', `Pipeline already running (PID ${pid})`)));
          return;
        } catch {
          // Stale PID, safe to proceed
          try { unlinkSync(pidPath); } catch {}
        }
      }
      const statusPath = join(worcaDir, 'status.json');
      if (!existsSync(statusPath)) {
        ws.send(JSON.stringify(makeError(req, 'no_status', 'No status.json found to resume')));
        return;
      }
      const env = { ...process.env };
      delete env.CLAUDECODE;
      const child = spawn('python', ['.claude/scripts/run_pipeline.py', '--resume'], {
        detached: true,
        stdio: 'ignore',
        cwd: process.cwd(),
        env,
      });
      child.unref();
      ws.send(JSON.stringify(makeOk(req, { resumed: true, pid: child.pid })));
      return;
    }

    // Unknown type
    ws.send(JSON.stringify(makeError(req, 'unknown_type', `Unknown message type: ${req.type}`)));
  }

  return { wss, broadcast };
}
