/**
 * WebSocket server for worca-ui pipeline monitoring.
 * Handles client connections, message routing, file watching, and log tailing.
 */
import { WebSocketServer } from 'ws';
import { watch, existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { stopPipeline as pmStopPipeline, startPipeline as pmStartPipeline, pausePipeline as pmPausePipeline, reconcileStatus } from './process-manager.js';
import { isRequest, makeOk, makeError } from '../app/protocol.js';
import { discoverRuns, watchEvents } from './watcher.js';
import { listIssues, listIssuesByLabel, listUnlinkedIssues, listDistinctRunLabels, countIssuesByRunLabel, getIssue, dbExists as beadsDbExists } from './beads-reader.js';
import { readLastLines, resolveLogPath, resolveIterationLogPath, countLines, readLinesFrom, listLogFiles, listIterationFiles } from './log-tailer.js';
import { readSettings } from './settings-reader.js';
import { readPreferences, writePreferences } from './preferences.js';

/**
 * Resolve the active run directory for a given worca base dir.
 * Returns `<worcaDir>/runs/<runId>` as long as runId is non-empty,
 * without gating on the existence of status.json.
 *
 * @param {string} worcaDir
 * @returns {string}
 */
export function resolveActiveRunDir(worcaDir) {
  const activeRunPath = join(worcaDir, 'active_run');
  if (existsSync(activeRunPath)) {
    try {
      const runId = readFileSync(activeRunPath, 'utf8').trim();
      if (runId) return join(worcaDir, 'runs', runId);
    } catch { /* ignore */ }
  }
  return worcaDir; // legacy fallback
}

// Internal alias used by the closure inside attachWsServer
const _resolveActiveRunDir = resolveActiveRunDir;

const REFRESH_DEBOUNCE_MS = 75;

/**
 * Convert a glob pattern (with * and **) to a RegExp for matching event type strings.
 * - `*`  matches any sequence of non-dot characters
 * - `**` matches any sequence of characters (including dots)
 *
 * @param {string} pattern
 * @param {string} str
 * @returns {boolean}
 */
function matchesGlob(pattern, str) {
  const regexStr = pattern
    .split('**')
    .map(part =>
      part.split('*').map(s => s.replace(/[.+^${}()|[\]\\]/g, '\\$&')).join('[^.]*')
    )
    .join('.*');
  return new RegExp(`^${regexStr}$`).test(str);
}

/**
 * Attach a WebSocket server to an existing HTTP server.
 *
 * @param {import('node:http').Server} httpServer
 * @param {{ worcaDir: string, settingsPath: string, prefsPath: string }} config
 */
export function attachWsServer(httpServer, config) {
  const { worcaDir, settingsPath, prefsPath, webhookInbox } = config;
  const wss = new WebSocketServer({ server: httpServer, path: '/ws' });

  /** @type {WeakMap<import('ws').WebSocket, { runId: string | null, logStage: string | null, eventsRunId: string | null }>} */
  const subs = new WeakMap();

  /** Per-instance debounce timer — not module-level so multiple attachWsServer calls don't interfere */
  let REFRESH_TIMER = null;

  /** Track last known pipeline_status per run ID to detect changes */
  const lastPipelineStatus = new Map();

  /** @type {Map<string, import('node:fs').FSWatcher>} */
  const logWatchers = new Map();

  /** @type {Map<string, { close: () => void }>} */
  const eventWatchers = new Map();

  function ensureSubs(ws) {
    let s = subs.get(ws);
    if (!s) {
      s = { runId: null, logStage: null, eventsRunId: null };
      subs.set(ws, s);
    }
    return s;
  }

  /**
   * Resolve the filesystem directory for a given run ID.
   * Checks runs/ first, then results/ (archived), then defaults to runs/.
   */
  function resolveRunDirById(runId) {
    const candidates = [
      join(worcaDir, 'runs', runId),
      join(worcaDir, 'results', runId),
    ];
    for (const c of candidates) {
      if (existsSync(c)) return c;
    }
    return join(worcaDir, 'runs', runId); // default for not-yet-created
  }

  /**
   * Broadcast a pipeline-event to all clients subscribed to the given run.
   */
  function broadcastPipelineEvent(runId, event) {
    const msg = JSON.stringify({
      id: `evt-${Date.now()}`,
      ok: true,
      type: 'pipeline-event',
      payload: event,
    });
    for (const ws of wss.clients) {
      if (ws.readyState !== ws.OPEN) continue;
      const s = subs.get(ws);
      if (s && s.eventsRunId === runId) {
        ws.send(msg);
      }
    }
  }

  /**
   * Close the event watcher for a run if no clients are subscribed.
   */
  function maybeCloseEventWatcher(runId) {
    for (const ws of wss.clients) {
      const s = subs.get(ws);
      if (s?.eventsRunId === runId) return; // still in use
    }
    const w = eventWatchers.get(runId);
    if (w) { try { w.close(); } catch { /* ignore */ } eventWatchers.delete(runId); }
  }

  /**
   * Read and filter events from a run's events.jsonl file.
   */
  function readEventsFromFile(runId, { since_event_id, event_types, limit = 100 } = {}) {
    const eventsPath = join(resolveRunDirById(runId), 'events.jsonl');
    if (!existsSync(eventsPath)) return [];
    try {
      const content = readFileSync(eventsPath, 'utf8');
      let events = [];
      for (const line of content.split('\n')) {
        if (!line.trim()) continue;
        try { events.push(JSON.parse(line)); } catch { /* skip malformed */ }
      }
      if (since_event_id) {
        const idx = events.findIndex(e => e.event_id === since_event_id);
        if (idx >= 0) events = events.slice(idx + 1);
      }
      if (event_types && event_types.length > 0) {
        events = events.filter(e => event_types.some(p => matchesGlob(p, e.event_type)));
      }
      return events.slice(0, limit);
    } catch { return []; }
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

  // Watch status.json for changes (both per-run and legacy)
  function scheduleRefresh() {
    if (REFRESH_TIMER) clearTimeout(REFRESH_TIMER);
    REFRESH_TIMER = setTimeout(() => {
      REFRESH_TIMER = null;
      let settings = {};
      try { settings = readSettings(settingsPath); } catch { /* ignore */ }
      try {
        const runs = discoverRuns(worcaDir);
        // Broadcast run-snapshot to all subscribed runs (not just active)
        const subscribedIds = new Set();
        for (const ws of wss.clients) {
          const s = subs.get(ws);
          if (s?.runId) subscribedIds.add(s.runId);
        }
        for (const run of runs) {
          if (subscribedIds.has(run.id)) {
            broadcastToSubscribers(run.id, 'run-snapshot', run);
          }
          // Detect pipeline_status changes and broadcast lifecycle events
          const currStatus = run.pipeline_status;
          if (currStatus !== undefined) {
            const prevStatus = lastPipelineStatus.get(run.id);
            if (prevStatus !== undefined && prevStatus !== currStatus) {
              if (currStatus === 'paused') {
                broadcastToSubscribers(run.id, 'pipeline-paused', { runId: run.id, pipeline_status: currStatus });
              } else if (currStatus === 'running' && (prevStatus === 'paused' || prevStatus === 'resuming')) {
                broadcastToSubscribers(run.id, 'pipeline-resumed', { runId: run.id, pipeline_status: currStatus });
              }
            }
            lastPipelineStatus.set(run.id, currStatus);
          }
        }
        // Broadcast updated runs list so list views auto-update
        broadcast('runs-list', { runs, settings });
      } catch { /* ignore */ }
    }, REFRESH_DEBOUNCE_MS);
  }

  // Resolve the active run's base directory (for logs and status watching)
  function resolveActiveRunDir() {
    return _resolveActiveRunDir(worcaDir);
  }

  let statusWatcher = null;
  let watchedRunDir = null;

  function setupStatusWatcher() {
    if (statusWatcher) { statusWatcher.close(); statusWatcher = null; }
    const runDir = resolveActiveRunDir();
    // When the active run changes, close stale log watchers so fresh ones
    // are created for the new run's files (fixes logWatchers.has() guard).
    if (watchedRunDir !== null && runDir !== watchedRunDir) {
      clearLogWatchers();
    }
    watchedRunDir = runDir;

    function tryWatch() {
      if (statusWatcher) return; // already established
      try {
        if (existsSync(runDir)) {
          statusWatcher = watch(runDir, { recursive: false }, (_eventType, filename) => {
            if (!filename || filename === 'status.json') {
              scheduleRefresh();
            }
          });
        } else {
          // Run directory not created yet — retry after a short delay.
          // Self-cancels if the active run has changed by then.
          setTimeout(() => {
            if (resolveActiveRunDir() === runDir) tryWatch();
          }, 500);
        }
      } catch { /* ignore */ }
    }

    tryWatch();
  }
  setupStatusWatcher();

  // Also watch the worca dir for active_run pointer changes
  let activeRunWatcher = null;
  try {
    if (existsSync(worcaDir)) {
      activeRunWatcher = watch(worcaDir, { recursive: false }, (_eventType, filename) => {
        if (!filename || filename === 'active_run' || filename === 'status.json') {
          // Re-setup status watcher if active run changed
          const newRunDir = resolveActiveRunDir();
          if (newRunDir !== watchedRunDir) {
            setupStatusWatcher();
          }
          scheduleRefresh();
        }
      });
    }
  } catch { /* ignore */ }

  // Track line counts per log file so we only send new lines
  const logLineCounts = new Map();

  /**
   * Close all active log watchers and reset tracking state.
   * Must be called when watchedRunDir changes so stale watcher keys
   * from the previous run don't prevent new watchers from being created.
   */
  function clearLogWatchers() {
    for (const w of logWatchers.values()) {
      try { w.close(); } catch { /* ignore */ }
    }
    logWatchers.clear();
    logLineCounts.clear();
  }

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
                  timestamp: new Date().toISOString(),
                });
              }
            }
          } catch { /* ignore */ }
        }
      });
      logWatchers.set(key, watcher);
    } catch { /* ignore */ }
  }

  // Set up a directory watcher for a stage directory (watches for new iteration files)
  function watchStageDir(stage, stageDir) {
    const dirKey = `${stage}__dir`;
    if (logWatchers.has(dirKey)) return;
    try {
      const dirWatcher = watch(stageDir, (eventType, filename) => {
        if (filename && /^iter-\d+\.log$/.test(filename)) {
          const iterNum = parseInt(filename.match(/\d+/)[0]);
          const iterPath = join(stageDir, filename);
          watchSingleLogFile(stage, iterPath, iterNum);
        }
      });
      logWatchers.set(dirKey, dirWatcher);
      // Backfill files created in the race window between directory creation
      // and watcher establishment. The watchSingleLogFile guard
      // (logWatchers.has(key)) will naturally deduplicate.
      const logsBase = resolveLogsBaseDir();
      const backfill = listIterationFiles(logsBase, stage);
      for (const { iteration, path } of backfill) {
        watchSingleLogFile(stage, path, iteration);
      }
    } catch { /* ignore */ }
  }

  // Resolve the logs base dir for the active run
  function resolveLogsBaseDir() {
    const runDir = resolveActiveRunDir();
    return runDir === worcaDir ? worcaDir : runDir;
  }

  // Start watching log files for a stage (handles both nested iteration dirs and flat files)
  function watchLogFile(stage) {
    const logsBase = resolveLogsBaseDir();
    if (!stage) {
      // Orchestrator — single flat file
      const logPath = resolveLogPath(logsBase, null);
      watchSingleLogFile(null, logPath, null);
      return;
    }
    // Check if nested iteration directory exists
    const stageDir = resolveLogPath(logsBase, stage);
    if (existsSync(stageDir) && statSync(stageDir).isDirectory()) {
      // Watch each existing iteration file
      const iters = listIterationFiles(logsBase, stage);
      for (const { iteration, path } of iters) {
        watchSingleLogFile(stage, path, iteration);
      }
      // Watch the stage directory for new iteration files
      watchStageDir(stage, stageDir);
    } else {
      // Directory doesn't exist yet — legacy flat file fallback
      const logPath = join(logsBase, 'logs', `${stage}.log`);
      if (existsSync(logPath)) {
        watchSingleLogFile(stage, logPath, null);
      }
      // Don't give up — the logs dir watcher will pick up new stage dirs
    }
  }

  // Watch all existing log files and the logs directory for new ones
  function watchAllLogFiles() {
    const logsBase = resolveLogsBaseDir();
    const logFiles = listLogFiles(logsBase);
    const watchedStages = new Set();
    for (const { stage } of logFiles) {
      if (watchedStages.has(stage)) continue;
      watchedStages.add(stage);
      const actualStage = stage === 'orchestrator' ? null : stage;
      watchLogFile(actualStage);
    }
    // Watch logs directory for newly created files and directories
    const logsDir = join(logsBase, 'logs');
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
          // New stage directory — set up watchers for it
          const stagePath = join(logsDir, filename);
          try {
            if (existsSync(stagePath) && statSync(stagePath).isDirectory()) {
              // Watch existing iteration files
              const iters = listIterationFiles(logsBase, filename);
              for (const { iteration, path } of iters) {
                watchSingleLogFile(filename, path, iteration);
              }
              // Watch for new iteration files
              watchStageDir(filename, stagePath);
            }
          } catch { /* ignore */ }
        }
      });
      logWatchers.set(dirKey, dirWatcher);
    } catch { /* ignore */ }
  }

  // Beads database watcher — watch the directory, not just beads.db,
  // because SQLite WAL mode writes to beads.db-wal first.
  const beadsDbPath = resolve(join(worcaDir, '..', '.beads', 'beads.db'));
  const beadsDir = resolve(join(worcaDir, '..', '.beads'));
  let beadsWatcher = null;
  let BEADS_REFRESH_TIMER = null;
  const BEADS_DEBOUNCE_MS = 200;

  function scheduleBeadsRefresh() {
    if (BEADS_REFRESH_TIMER) clearTimeout(BEADS_REFRESH_TIMER);
    BEADS_REFRESH_TIMER = setTimeout(() => {
      BEADS_REFRESH_TIMER = null;
      try {
        const issues = listIssues(beadsDbPath);
        broadcast('beads-update', { issues, dbExists: true, dbPath: beadsDbPath });
      } catch { /* ignore */ }
    }, BEADS_DEBOUNCE_MS);
  }

  if (existsSync(beadsDir)) {
    try {
      beadsWatcher = watch(beadsDir, (_event, filename) => {
        if (filename && filename.startsWith('beads.db')) scheduleBeadsRefresh();
      });
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
      const s = subs.get(ws);
      const eventsRunId = s?.eventsRunId;
      subs.delete(ws);
      if (eventsRunId) maybeCloseEventWatcher(eventsRunId);
    });
  });

  wss.on('close', () => {
    clearInterval(heartbeat);
    if (statusWatcher) statusWatcher.close();
    if (activeRunWatcher) activeRunWatcher.close();
    if (beadsWatcher) beadsWatcher.close();
    for (const w of logWatchers.values()) w.close();
    logWatchers.clear();
    for (const w of eventWatchers.values()) { try { w.close(); } catch { /* ignore */ } }
    eventWatchers.clear();
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

  // Legacy fallback prefixes — only used when status.json lacks a stored prompt
  const STAGE_PROMPT_PREFIX = {
    plan: 'Create a detailed implementation plan for the following work request. Write the plan to the designated plan file.\n\nWork request: ',
    coordinate: 'Decompose the following work request into Beads tasks with dependencies. Do NOT implement anything — only create tasks using `bd create`.\n\nWork request: ',
    implement: 'Implement the code changes described in the work request. Follow the plan and complete the tasks assigned to you.\n\nWork request: ',
    test: 'Review and test the implementation for the following work request. Run tests and report results. Do NOT modify code.\n\nWork request: ',
    review: 'Review the code changes for the following work request. Check for correctness, style, and adherence to the plan. Do NOT modify code.\n\nWork request: ',
    pr: 'Create a pull request for the following work request. Summarize the changes and ensure the commit history is clean.\n\nWork request: ',
  };

  function _buildStagePrompt(stage, rawPrompt) {
    const prefix = STAGE_PROMPT_PREFIX[stage];
    return prefix ? prefix + rawPrompt : rawPrompt;
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

    // get-agent-prompt
    if (req.type === 'get-agent-prompt') {
      const { runId, stage } = req.payload || {};
      if (!runId || !stage) {
        ws.send(JSON.stringify(makeError(req, 'bad_request', 'payload.runId and payload.stage required')));
        return;
      }
      // Find the run to get agent name and work request prompt
      const runs = discoverRuns(worcaDir);
      const run = runs.find(r => r.id === runId);
      if (!run) {
        ws.send(JSON.stringify(makeError(req, 'NOT_FOUND', `Run ${runId} not found`)));
        return;
      }
      const agentName = run.stages?.[stage]?.agent || stage;

      // Build per-iteration prompts from iteration records
      const iterations = run.stages?.[stage]?.iterations || [];
      const iterationPrompts = iterations.map((iter, idx) => {
        const prompt = iter.prompt || null;
        return { iteration: iter.number ?? idx, prompt };
      });

      // Stage-level prompt as fallback (for stages with no per-iteration data)
      const storedPrompt = run.stages?.[stage]?.prompt;
      let fallbackPrompt;
      let promptSource;
      if (storedPrompt) {
        fallbackPrompt = storedPrompt;
        promptSource = 'actual';
      } else {
        const rawPrompt = run.work_request?.description || run.work_request?.title || '';
        fallbackPrompt = _buildStagePrompt(stage, rawPrompt);
        promptSource = 'reconstructed';
      }

      // If no iteration has a stored prompt, use the fallback for all
      const hasIterationPrompts = iterationPrompts.some(ip => ip.prompt != null);
      if (!hasIterationPrompts) {
        for (const ip of iterationPrompts) {
          ip.prompt = fallbackPrompt;
        }
      }

      // Try to read rendered agent .md from run dir, then results dir
      let agentInstructions = null;
      const candidates = [
        join(worcaDir, 'runs', run.run_id || runId, 'agents', `${agentName}.md`),
        join(worcaDir, 'results', run.run_id || runId, 'agents', `${agentName}.md`),
      ];
      for (const p of candidates) {
        if (existsSync(p)) {
          try { agentInstructions = readFileSync(p, 'utf8'); } catch { /* ignore */ }
          break;
        }
      }
      ws.send(JSON.stringify(makeOk(req, {
        agentInstructions,
        userPrompt: fallbackPrompt, // backward compat
        iterationPrompts,
        promptSource,
        agent: agentName,
      })));
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
      // Send current snapshot and seed lastPipelineStatus for change detection
      const runs = discoverRuns(worcaDir);
      const run = runs.find(r => r.id === runId);
      if (run) {
        if (run.pipeline_status !== undefined && !lastPipelineStatus.has(runId)) {
          lastPipelineStatus.set(runId, run.pipeline_status);
        }
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
        const logsBase = resolveLogsBaseDir();
        if (stage) {
          if (iteration != null) {
            // Specific iteration
            const logPath = resolveIterationLogPath(logsBase, stage, iteration);
            const lines = readLastLines(logPath, 200);
            if (lines.length > 0) {
              ws.send(JSON.stringify({
                id: `evt-${Date.now()}`, ok: true, type: 'log-bulk',
                payload: { stage, iteration, lines },
              }));
            }
          } else {
            // All iterations for this stage
            const stageDir = resolveLogPath(logsBase, stage);
            if (existsSync(stageDir) && statSync(stageDir).isDirectory()) {
              const iters = listIterationFiles(logsBase, stage);
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
              const logPath = join(logsBase, 'logs', `${stage}.log`);
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
          const logFiles = listLogFiles(logsBase);
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

    // pause-run: write control.json to pause the pipeline at next iteration boundary
    if (req.type === 'pause-run') {
      const { runId } = req.payload || {};
      if (typeof runId !== 'string') {
        ws.send(JSON.stringify(makeError(req, 'bad_request', 'payload.runId required')));
        return;
      }
      try {
        const result = pmPausePipeline(worcaDir, runId);
        ws.send(JSON.stringify(makeOk(req, result)));
      } catch (e) {
        ws.send(JSON.stringify(makeError(req, e.code || 'error', e.message)));
      }
      return;
    }

    // stop-run: send SIGTERM to the running pipeline, then confirm death
    if (req.type === 'stop-run') {
      try {
        const result = pmStopPipeline(worcaDir);
        ws.send(JSON.stringify(makeOk(req, result)));
        // Poll until process is confirmed dead, then force a refresh
        let checks = 0;
        const maxChecks = 20;
        const pollInterval = setInterval(() => {
          checks++;
          let alive = false;
          try { process.kill(result.pid, 0); alive = true; } catch { /* dead */ }
          if (!alive || checks >= maxChecks) {
            clearInterval(pollInterval);
            reconcileStatus(worcaDir);
            scheduleRefresh();
          }
        }, 500);
        pollInterval.unref?.();
      } catch (e) {
        scheduleRefresh();
        ws.send(JSON.stringify(makeError(req, e.code || 'not_running', e.message)));
      }
      return;
    }

    // resume-run: spawn a new pipeline process with --resume
    if (req.type === 'resume-run') {
      const { runId } = req.payload || {};
      try {
        const result = await pmStartPipeline(worcaDir, { resume: true, runId });
        ws.send(JSON.stringify(makeOk(req, { resumed: true, pid: result.pid })));
      } catch (e) {
        ws.send(JSON.stringify(makeError(req, e.code || 'error', e.message)));
      }
      return;
    }

    // list-beads-issues
    if (req.type === 'list-beads-issues') {
      if (!beadsDbExists(beadsDbPath)) {
        ws.send(JSON.stringify(makeOk(req, { issues: [], dbExists: false, dbPath: beadsDbPath })));
        return;
      }
      const issues = listIssues(beadsDbPath);
      ws.send(JSON.stringify(makeOk(req, { issues, dbExists: true, dbPath: beadsDbPath })));
      return;
    }

    // list-beads-unlinked
    if (req.type === 'list-beads-unlinked') {
      if (!beadsDbExists(beadsDbPath)) {
        ws.send(JSON.stringify(makeOk(req, { issues: [], dbExists: false })));
        return;
      }
      const issues = listUnlinkedIssues(beadsDbPath);
      ws.send(JSON.stringify(makeOk(req, { issues, dbExists: true })));
      return;
    }

    // list-beads-refs
    if (req.type === 'list-beads-refs') {
      if (!beadsDbExists(beadsDbPath)) {
        ws.send(JSON.stringify(makeOk(req, { refs: [] })));
        return;
      }
      const refs = listDistinctRunLabels(beadsDbPath);
      ws.send(JSON.stringify(makeOk(req, { refs })));
      return;
    }

    // list-beads-counts
    if (req.type === 'list-beads-counts') {
      if (!beadsDbExists(beadsDbPath)) {
        ws.send(JSON.stringify(makeOk(req, { counts: {} })));
        return;
      }
      const counts = countIssuesByRunLabel(beadsDbPath);
      ws.send(JSON.stringify(makeOk(req, { counts })));
      return;
    }

    // list-beads-by-run
    if (req.type === 'list-beads-by-run') {
      const { runId } = req.payload || {};
      if (!runId) {
        ws.send(JSON.stringify(makeError(req, 'bad_request', 'payload.runId required')));
        return;
      }
      if (!beadsDbExists(beadsDbPath)) {
        ws.send(JSON.stringify(makeOk(req, { issues: [], runId })));
        return;
      }
      const issues = listIssuesByLabel(beadsDbPath, 'run:' + runId);
      ws.send(JSON.stringify(makeOk(req, { issues, runId })));
      return;
    }

    // start-beads-issue
    if (req.type === 'start-beads-issue') {
      const { issueId } = req.payload || {};
      if (!Number.isInteger(issueId) || issueId <= 0) {
        ws.send(JSON.stringify(makeError(req, 'bad_request', 'payload.issueId (positive integer) required')));
        return;
      }
      const issue = getIssue(beadsDbPath, issueId);
      if (!issue) {
        ws.send(JSON.stringify(makeError(req, 'not_found', `Issue ${issueId} not found`)));
        return;
      }
      if (issue.status !== 'open') {
        ws.send(JSON.stringify(makeError(req, 'not_ready', `Issue ${issueId} is not open (status: ${issue.status})`)));
        return;
      }
      if (issue.blocked_by.length > 0) {
        ws.send(JSON.stringify(makeError(req, 'blocked', `Issue ${issueId} is blocked by: ${issue.blocked_by.join(', ')}`)));
        return;
      }
      try {
        const prompt = `[Beads #${issue.id}] ${issue.title}\n\n${(issue.body || '').trim()}`.trim();
        const result = await pmStartPipeline(worcaDir, { inputType: 'prompt', inputValue: prompt, msize: 1, mloops: 1 });
        broadcast('run-started', { pid: result.pid });
        ws.send(JSON.stringify(makeOk(req, { pid: result.pid, issueId })));
      } catch (e) {
        ws.send(JSON.stringify(makeError(req, 'start_failed', e.message)));
      }
      return;
    }

    // get-events
    if (req.type === 'get-events') {
      const { runId, since_event_id, event_types, limit } = req.payload || {};
      if (typeof runId !== 'string') {
        ws.send(JSON.stringify(makeError(req, 'bad_request', 'payload.runId required')));
        return;
      }
      const events = readEventsFromFile(runId, { since_event_id, event_types, limit });
      ws.send(JSON.stringify(makeOk(req, { events })));
      return;
    }

    // subscribe-events
    if (req.type === 'subscribe-events') {
      const { runId } = req.payload || {};
      if (typeof runId !== 'string') {
        ws.send(JSON.stringify(makeError(req, 'bad_request', 'payload.runId required')));
        return;
      }
      const s = ensureSubs(ws);
      s.eventsRunId = runId;
      if (!eventWatchers.has(runId)) {
        const runDir = resolveRunDirById(runId);
        const w = watchEvents(runDir, (event) => broadcastPipelineEvent(runId, event));
        eventWatchers.set(runId, w);
      }
      ws.send(JSON.stringify(makeOk(req, { subscribed: true })));
      return;
    }

    // unsubscribe-events
    if (req.type === 'unsubscribe-events') {
      const s = ensureSubs(ws);
      const prevRunId = s.eventsRunId;
      s.eventsRunId = null;
      if (prevRunId) maybeCloseEventWatcher(prevRunId);
      ws.send(JSON.stringify(makeOk(req, { unsubscribed: true })));
      return;
    }

    // get-webhook-inbox
    if (req.type === 'get-webhook-inbox') {
      if (!webhookInbox) {
        ws.send(JSON.stringify(makeOk(req, { events: [], controlAction: 'continue' })));
        return;
      }
      ws.send(JSON.stringify(makeOk(req, { events: webhookInbox.list(), controlAction: webhookInbox.getControlAction() })));
      return;
    }

    // set-webhook-control
    if (req.type === 'set-webhook-control') {
      const { action } = req.payload || {};
      if (!webhookInbox || !['continue', 'pause', 'abort'].includes(action)) {
        ws.send(JSON.stringify(makeError(req, 'bad_request', 'action must be "continue", "pause", or "abort"')));
        return;
      }
      webhookInbox.setControlAction(action);
      broadcast('webhook-control-changed', { action });
      ws.send(JSON.stringify(makeOk(req, { action })));
      return;
    }

    // clear-webhook-inbox
    if (req.type === 'clear-webhook-inbox') {
      if (webhookInbox) webhookInbox.clear();
      broadcast('webhook-inbox-cleared', {});
      ws.send(JSON.stringify(makeOk(req, { cleared: true })));
      return;
    }

    // Unknown type
    ws.send(JSON.stringify(makeError(req, 'unknown_type', `Unknown message type: ${req.type}`)));
  }

  return { wss, broadcast, scheduleRefresh };
}
