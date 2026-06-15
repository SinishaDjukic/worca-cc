/**
 * Log file watcher — manages real-time log tailing and archived log reading.
 * Owns logWatchers map and logLineCounts tracking.
 */

import { existsSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import {
  fileByteLength,
  listIterationFiles,
  listLogFiles,
  parseLogLine,
  readLastLines,
  readNewLines,
  resolveLogPath,
  splitTimestamps,
} from './log-tailer.js';
import { safeWatch } from './safe-watch.js';

/**
 * @param {{
 *   broadcaster: { broadcastToLogSubscribers: Function },
 *   resolveLatestRunDir: Function,
 *   worcaDir: string,
 *   currentActiveRunId: Function
 * }} deps
 */
export function createLogWatcher({
  broadcaster,
  resolveLatestRunDir,
  worcaDir,
  currentActiveRunId,
}) {
  /** @type {Map<string, import('node:fs').FSWatcher>} */
  const logWatchers = new Map();

  /** Track byte offsets per log file so we only read new content */
  const logByteOffsets = new Map();

  function resolveLogsBaseDir() {
    const runDir = resolveLatestRunDir();
    return runDir === worcaDir ? worcaDir : runDir;
  }

  /**
   * Close all active log watchers and reset tracking state.
   */
  function clearLogWatchers() {
    for (const w of logWatchers.values()) {
      try {
        w.close();
      } catch {
        /* ignore */
      }
    }
    logWatchers.clear();
    logByteOffsets.clear();
  }

  function _watcherKey(runId, stage, iteration, suffix = '') {
    const stagePart = stage || '__orchestrator__';
    const iterPart = iteration != null ? `__iter${iteration}` : '';
    const runPart = runId ? `${runId}__` : '';
    return `${runPart}${stagePart}${iterPart}${suffix}`;
  }

  function watchSingleLogFile(stage, filePath, iteration, options = {}) {
    const explicitRunId = options.runId || null;
    const key = _watcherKey(explicitRunId, stage, iteration);
    if (logWatchers.has(key)) return;
    try {
      if (!existsSync(filePath)) return;
      logByteOffsets.set(key, fileByteLength(filePath));
      const watcherRunId = explicitRunId || currentActiveRunId();
      const watcher = safeWatch(filePath, (eventType) => {
        if (eventType === 'change') {
          try {
            const prevOffset = logByteOffsets.get(key) || 0;
            const { lines: newLines, newOffset } = readNewLines(
              filePath,
              prevOffset,
            );
            if (newLines.length > 0) {
              logByteOffsets.set(key, newOffset);
              for (const raw of newLines) {
                const { ts, stream, text } = parseLogLine(raw);
                broadcaster.broadcastToLogSubscribers(
                  stage,
                  'log-line',
                  {
                    stage: stage || 'orchestrator',
                    iteration: iteration ?? undefined,
                    line: text,
                    // Origin stream ("out"/"err"); legacy/untagged → "out".
                    stream,
                    // New-format lines carry their write-time; legacy lines have
                    // none, so fall back to receive-time (≈ write-time for a
                    // line arriving from a live, actively-running stage).
                    timestamp: ts ?? new Date().toISOString(),
                  },
                  watcherRunId,
                );
              }
            }
          } catch {
            /* ignore */
          }
        }
      });
      logWatchers.set(key, watcher);
    } catch {
      /* ignore */
    }
  }

  function watchStageDir(stage, stageDir, options = {}) {
    const explicitRunId = options.runId || null;
    const dirKey = _watcherKey(explicitRunId, stage, null, '__dir');
    if (logWatchers.has(dirKey)) return;
    try {
      const dirWatcher = safeWatch(stageDir, (_eventType, filename) => {
        if (filename && /^iter-\d+\.log$/.test(filename)) {
          const iterNum = parseInt(filename.match(/\d+/)[0], 10);
          const iterPath = join(stageDir, filename);
          watchSingleLogFile(stage, iterPath, iterNum, options);
        }
      });
      logWatchers.set(dirKey, dirWatcher);
      const logsBase = options.runDir || resolveLogsBaseDir();
      const backfill = listIterationFiles(logsBase, stage);
      for (const { iteration, path } of backfill) {
        watchSingleLogFile(stage, path, iteration, options);
      }
    } catch {
      /* ignore */
    }
  }

  function watchLogFile(stage, options = {}) {
    const logsBase = options.runDir || resolveLogsBaseDir();
    if (!stage) {
      const logPath = resolveLogPath(logsBase, null);
      watchSingleLogFile(null, logPath, null, options);
      return;
    }
    const stageDir = resolveLogPath(logsBase, stage);
    if (existsSync(stageDir) && statSync(stageDir).isDirectory()) {
      const iters = listIterationFiles(logsBase, stage);
      for (const { iteration, path } of iters) {
        watchSingleLogFile(stage, path, iteration, options);
      }
      watchStageDir(stage, stageDir, options);
    } else {
      const logPath = join(logsBase, 'logs', `${stage}.log`);
      if (existsSync(logPath)) {
        watchSingleLogFile(stage, logPath, null, options);
      }
    }
  }

  function watchAllLogFiles(options = {}) {
    const logsBase = options.runDir || resolveLogsBaseDir();
    const logFiles = listLogFiles(logsBase);
    const watchedStages = new Set();
    for (const { stage } of logFiles) {
      if (watchedStages.has(stage)) continue;
      watchedStages.add(stage);
      const actualStage = stage === 'orchestrator' ? null : stage;
      watchLogFile(actualStage, options);
    }
    const logsDir = join(logsBase, 'logs');
    const explicitRunId = options.runId || null;
    const dirKey = explicitRunId
      ? `${explicitRunId}__logs_dir__`
      : '__logs_dir__';
    if (logWatchers.has(dirKey)) return;
    if (!existsSync(logsDir)) return;
    try {
      const dirWatcher = safeWatch(logsDir, (_eventType, filename) => {
        if (!filename) return;
        if (filename.endsWith('.log')) {
          const stage = filename.replace('.log', '');
          const actualStage = stage === 'orchestrator' ? null : stage;
          watchLogFile(actualStage, options);
        } else {
          const stagePath = join(logsDir, filename);
          try {
            if (existsSync(stagePath) && statSync(stagePath).isDirectory()) {
              const iters = listIterationFiles(logsBase, filename);
              for (const { iteration, path } of iters) {
                watchSingleLogFile(filename, path, iteration, options);
              }
              watchStageDir(filename, stagePath, options);
            }
          } catch {
            /* ignore */
          }
        }
      });
      logWatchers.set(dirKey, dirWatcher);
    } catch {
      /* ignore */
    }
  }

  function sendArchivedLogs(ws, archivedLogDir, stage, iteration) {
    try {
      if (stage) {
        const stageDir = join(archivedLogDir, stage);
        if (existsSync(stageDir) && statSync(stageDir).isDirectory()) {
          const files = readdirSync(stageDir)
            .filter((f) => /^iter-\d+\.log$/.test(f))
            .sort(
              (a, b) =>
                parseInt(a.match(/\d+/)[0], 10) -
                parseInt(b.match(/\d+/)[0], 10),
            );
          for (const f of files) {
            const iterNum = parseInt(f.match(/\d+/)[0], 10);
            if (iteration != null && iterNum !== iteration) continue;
            const { lines, timestamps, streams } = splitTimestamps(
              readLastLines(join(stageDir, f), 200),
            );
            if (lines.length > 0) {
              ws.send(
                JSON.stringify({
                  id: `evt-${Date.now()}-iter${iterNum}`,
                  ok: true,
                  type: 'log-bulk',
                  payload: {
                    stage,
                    iteration: iterNum,
                    lines,
                    timestamps,
                    streams,
                  },
                }),
              );
            }
          }
        } else {
          const logPath = join(archivedLogDir, `${stage}.log`);
          const { lines, timestamps, streams } = splitTimestamps(
            readLastLines(logPath, 200),
          );
          if (lines.length > 0) {
            ws.send(
              JSON.stringify({
                id: `evt-${Date.now()}`,
                ok: true,
                type: 'log-bulk',
                payload: { stage, lines, timestamps, streams },
              }),
            );
          }
        }
      } else {
        const entries = readdirSync(archivedLogDir, { withFileTypes: true });
        for (const entry of entries) {
          if (entry.isFile() && entry.name.endsWith('.log')) {
            const s2 = entry.name.replace('.log', '');
            const { lines, timestamps, streams } = splitTimestamps(
              readLastLines(join(archivedLogDir, entry.name), 200),
            );
            if (lines.length > 0) {
              ws.send(
                JSON.stringify({
                  id: `evt-${Date.now()}-${s2}`,
                  ok: true,
                  type: 'log-bulk',
                  payload: { stage: s2, lines, timestamps, streams },
                }),
              );
            }
          } else if (entry.isDirectory()) {
            const stageDir2 = join(archivedLogDir, entry.name);
            const iterFiles = readdirSync(stageDir2)
              .filter((f) => /^iter-\d+\.log$/.test(f))
              .sort(
                (a, b) =>
                  parseInt(a.match(/\d+/)[0], 10) -
                  parseInt(b.match(/\d+/)[0], 10),
              );
            for (const f of iterFiles) {
              const iterNum = parseInt(f.match(/\d+/)[0], 10);
              const { lines, timestamps, streams } = splitTimestamps(
                readLastLines(join(stageDir2, f), 200),
              );
              if (lines.length > 0) {
                ws.send(
                  JSON.stringify({
                    id: `evt-${Date.now()}-${entry.name}-iter${iterNum}`,
                    ok: true,
                    type: 'log-bulk',
                    payload: {
                      stage: entry.name,
                      iteration: iterNum,
                      lines,
                      timestamps,
                      streams,
                    },
                  }),
                );
              }
            }
          }
        }
      }
    } catch {
      /* ignore */
    }
  }

  function destroy() {
    for (const w of logWatchers.values()) {
      try {
        w.close();
      } catch {
        /* ignore */
      }
    }
    logWatchers.clear();
  }

  return {
    clearLogWatchers,
    watchLogFile,
    watchAllLogFiles,
    sendArchivedLogs,
    resolveLogsBaseDir,
    destroy,
  };
}
