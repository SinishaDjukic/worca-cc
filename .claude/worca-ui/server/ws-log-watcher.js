/**
 * Log file watcher — manages real-time log tailing and archived log reading.
 * Owns logWatchers map and logLineCounts tracking.
 */

import { existsSync, readdirSync, statSync, watch } from 'node:fs';
import { join } from 'node:path';
import {
  fileByteLength,
  listIterationFiles,
  listLogFiles,
  readLastLines,
  readNewLines,
  resolveIterationLogPath,
  resolveLogPath,
} from './log-tailer.js';

/**
 * @param {{
 *   broadcaster: { broadcastToLogSubscribers: Function },
 *   resolveActiveRunDir: Function,
 *   worcaDir: string,
 *   currentActiveRunId: Function
 * }} deps
 */
export function createLogWatcher({
  broadcaster,
  resolveActiveRunDir,
  worcaDir,
  currentActiveRunId,
}) {
  /** @type {Map<string, import('node:fs').FSWatcher>} */
  const logWatchers = new Map();

  /** Track byte offsets per log file so we only read new content */
  const logByteOffsets = new Map();

  function resolveLogsBaseDir() {
    const runDir = resolveActiveRunDir();
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

  function watchSingleLogFile(stage, filePath, iteration) {
    const key =
      iteration != null
        ? `${stage}__iter${iteration}`
        : stage || '__orchestrator__';
    if (logWatchers.has(key)) return;
    try {
      if (!existsSync(filePath)) return;
      logByteOffsets.set(key, fileByteLength(filePath));
      const watcherRunId = currentActiveRunId();
      const watcher = watch(filePath, (eventType) => {
        if (eventType === 'change') {
          try {
            const prevOffset = logByteOffsets.get(key) || 0;
            const { lines: newLines, newOffset } = readNewLines(filePath, prevOffset);
            if (newLines.length > 0) {
              logByteOffsets.set(key, newOffset);
              for (const line of newLines) {
                broadcaster.broadcastToLogSubscribers(
                  stage,
                  'log-line',
                  {
                    stage: stage || 'orchestrator',
                    iteration: iteration ?? undefined,
                    line,
                    timestamp: new Date().toISOString(),
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

  function watchStageDir(stage, stageDir) {
    const dirKey = `${stage}__dir`;
    if (logWatchers.has(dirKey)) return;
    try {
      const dirWatcher = watch(stageDir, (_eventType, filename) => {
        if (filename && /^iter-\d+\.log$/.test(filename)) {
          const iterNum = parseInt(filename.match(/\d+/)[0], 10);
          const iterPath = join(stageDir, filename);
          watchSingleLogFile(stage, iterPath, iterNum);
        }
      });
      logWatchers.set(dirKey, dirWatcher);
      const logsBase = resolveLogsBaseDir();
      const backfill = listIterationFiles(logsBase, stage);
      for (const { iteration, path } of backfill) {
        watchSingleLogFile(stage, path, iteration);
      }
    } catch {
      /* ignore */
    }
  }

  function watchLogFile(stage) {
    const logsBase = resolveLogsBaseDir();
    if (!stage) {
      const logPath = resolveLogPath(logsBase, null);
      watchSingleLogFile(null, logPath, null);
      return;
    }
    const stageDir = resolveLogPath(logsBase, stage);
    if (existsSync(stageDir) && statSync(stageDir).isDirectory()) {
      const iters = listIterationFiles(logsBase, stage);
      for (const { iteration, path } of iters) {
        watchSingleLogFile(stage, path, iteration);
      }
      watchStageDir(stage, stageDir);
    } else {
      const logPath = join(logsBase, 'logs', `${stage}.log`);
      if (existsSync(logPath)) {
        watchSingleLogFile(stage, logPath, null);
      }
    }
  }

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
    const logsDir = join(logsBase, 'logs');
    const dirKey = '__logs_dir__';
    if (logWatchers.has(dirKey)) return;
    if (!existsSync(logsDir)) return;
    try {
      const dirWatcher = watch(logsDir, (_eventType, filename) => {
        if (!filename) return;
        if (filename.endsWith('.log')) {
          const stage = filename.replace('.log', '');
          const actualStage = stage === 'orchestrator' ? null : stage;
          watchLogFile(actualStage);
        } else {
          const stagePath = join(logsDir, filename);
          try {
            if (existsSync(stagePath) && statSync(stagePath).isDirectory()) {
              const iters = listIterationFiles(logsBase, filename);
              for (const { iteration, path } of iters) {
                watchSingleLogFile(filename, path, iteration);
              }
              watchStageDir(filename, stagePath);
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
            const lines = readLastLines(join(stageDir, f), 200);
            if (lines.length > 0) {
              ws.send(
                JSON.stringify({
                  id: `evt-${Date.now()}-iter${iterNum}`,
                  ok: true,
                  type: 'log-bulk',
                  payload: { stage, iteration: iterNum, lines },
                }),
              );
            }
          }
        } else {
          const logPath = join(archivedLogDir, `${stage}.log`);
          const lines = readLastLines(logPath, 200);
          if (lines.length > 0) {
            ws.send(
              JSON.stringify({
                id: `evt-${Date.now()}`,
                ok: true,
                type: 'log-bulk',
                payload: { stage, lines },
              }),
            );
          }
        }
      } else {
        const entries = readdirSync(archivedLogDir, { withFileTypes: true });
        for (const entry of entries) {
          if (entry.isFile() && entry.name.endsWith('.log')) {
            const s2 = entry.name.replace('.log', '');
            const lines = readLastLines(join(archivedLogDir, entry.name), 200);
            if (lines.length > 0) {
              ws.send(
                JSON.stringify({
                  id: `evt-${Date.now()}-${s2}`,
                  ok: true,
                  type: 'log-bulk',
                  payload: { stage: s2, lines },
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
              const lines = readLastLines(join(stageDir2, f), 200);
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
