/**
 * Status file watcher — monitors status.json and active_run for changes.
 * Owns refresh scheduling, lastPipelineStatus tracking, and the status/activeRun FSWatchers.
 */

import { existsSync, readFileSync, watch } from 'node:fs';
import { join } from 'node:path';
import { readSettings } from './settings-reader.js';
import { discoverRunsAsync } from './watcher.js';

const REFRESH_DEBOUNCE_MS = 75;

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
    } catch {
      /* ignore */
    }
  }
  return worcaDir; // legacy fallback
}

/**
 * @param {{
 *   worcaDir: string,
 *   settingsPath: string,
 *   broadcaster: { broadcast: Function, broadcastToSubscribers: Function },
 *   getSubs: Function,
 *   wss: import('ws').WebSocketServer,
 *   onActiveRunChange?: () => void,
 *   projectId?: string
 * }} deps
 */
export function createStatusWatcher({
  worcaDir,
  settingsPath,
  broadcaster,
  getSubs,
  wss,
  onActiveRunChange,
  projectId,
}) {
  let REFRESH_TIMER = null;
  const lastPipelineStatus = new Map();
  let statusWatcher = null;
  let watchedRunDir = null;
  let activeRunWatcher = null;
  let runsDirWatcher = null;

  function currentActiveRunId() {
    if (!watchedRunDir) return null;
    return watchedRunDir.split('/').pop() || null;
  }

  function _resolveActiveRunDir() {
    return resolveActiveRunDir(worcaDir);
  }

  function scheduleRefresh() {
    if (REFRESH_TIMER) clearTimeout(REFRESH_TIMER);
    REFRESH_TIMER = setTimeout(async () => {
      REFRESH_TIMER = null;
      let settings = {};
      try {
        settings = readSettings(settingsPath);
      } catch {
        /* ignore */
      }
      try {
        const runs = await discoverRunsAsync(worcaDir);
        const subscribedIds = new Set();
        for (const ws of wss.clients) {
          const s = getSubs(ws);
          if (s?.runId) subscribedIds.add(s.runId);
        }
        // Evict stale entries from lastPipelineStatus (fix #18)
        const activeRunIds = new Set(runs.map((r) => r.id));
        for (const id of lastPipelineStatus.keys()) {
          if (!activeRunIds.has(id)) lastPipelineStatus.delete(id);
        }

        for (const run of runs) {
          if (subscribedIds.has(run.id)) {
            broadcaster.broadcastToSubscribers(run.id, 'run-snapshot', run);
          }
          const currStatus = run.pipeline_status;
          if (currStatus !== undefined) {
            const prevStatus = lastPipelineStatus.get(run.id);
            if (prevStatus !== undefined && prevStatus !== currStatus) {
              if (currStatus === 'paused') {
                broadcaster.broadcastToSubscribers(run.id, 'pipeline-paused', {
                  runId: run.id,
                  pipeline_status: currStatus,
                });
              } else if (
                currStatus === 'running' &&
                (prevStatus === 'paused' || prevStatus === 'resuming')
              ) {
                broadcaster.broadcastToSubscribers(run.id, 'pipeline-resumed', {
                  runId: run.id,
                  pipeline_status: currStatus,
                });
              }
            }
            lastPipelineStatus.set(run.id, currStatus);
          }
        }
        broadcaster.broadcast('runs-list', { runs, settings }, projectId);
      } catch {
        /* ignore */
      }
    }, REFRESH_DEBOUNCE_MS);
  }

  function setupStatusWatcher() {
    if (statusWatcher) {
      statusWatcher.close();
      statusWatcher = null;
    }
    const runDir = _resolveActiveRunDir();
    if (watchedRunDir !== null && runDir !== watchedRunDir) {
      if (onActiveRunChange) onActiveRunChange();
    }
    watchedRunDir = runDir;

    function tryWatch() {
      if (statusWatcher) return;
      try {
        const statusFile = join(runDir, 'status.json');
        if (existsSync(statusFile)) {
          // Watch the file directly — on macOS, kqueue directory watchers
          // don't fire for in-place content modifications of existing files.
          // Watching the file itself ensures we detect status.json writes.
          //
          // IMPORTANT: On macOS kqueue, atomic writes (write-to-temp +
          // rename-over) replace the inode.  After one 'rename' event the
          // watcher goes dead because it tracked the old inode.  We
          // re-establish the watcher on the new file after a short delay.
          statusWatcher = watch(statusFile, (eventType) => {
            scheduleRefresh();
            if (eventType === 'rename') {
              // File replaced (atomic write) — re-watch the new inode
              try { statusWatcher.close(); } catch { /* ignore */ }
              statusWatcher = null;
              setTimeout(() => tryWatch(), 50);
            }
          });
        } else if (existsSync(runDir)) {
          // status.json doesn't exist yet — watch the directory for its creation,
          // then switch to watching the file once it appears.
          statusWatcher = watch(
            runDir,
            { recursive: false },
            (_eventType, filename) => {
              if (!filename || filename === 'status.json') {
                const statusPath = join(runDir, 'status.json');
                if (existsSync(statusPath)) {
                  // status.json appeared — switch to file-level watch
                  statusWatcher.close();
                  statusWatcher = null;
                  tryWatch();
                }
                scheduleRefresh();
              }
            },
          );
        } else {
          setTimeout(() => {
            if (_resolveActiveRunDir() === runDir) tryWatch();
          }, 500);
        }
      } catch {
        /* ignore */
      }
    }

    tryWatch();
  }

  // Initialize status watcher
  setupStatusWatcher();

  // Watch worcaDir for active_run pointer changes
  try {
    if (existsSync(worcaDir)) {
      activeRunWatcher = watch(
        worcaDir,
        { recursive: false },
        (_eventType, filename) => {
          if (
            !filename ||
            filename === 'active_run' ||
            filename === 'status.json'
          ) {
            const newRunDir = _resolveActiveRunDir();
            if (newRunDir !== watchedRunDir) {
              setupStatusWatcher();
            }
            scheduleRefresh();
          }
        },
      );
    }
  } catch {
    /* ignore */
  }

  // Watch .worca/runs/ for status changes in ANY run (concurrent pipelines)
  const runsDir = join(worcaDir, 'runs');
  try {
    if (existsSync(runsDir)) {
      runsDirWatcher = watch(
        runsDir,
        { recursive: true },
        (_eventType, filename) => {
          if (!filename || filename.endsWith('status.json')) {
            scheduleRefresh();
          }
        },
      );
    }
  } catch {
    /* ignore */
  }

  function getWatchedRunDir() {
    return watchedRunDir;
  }

  function destroy() {
    if (statusWatcher) statusWatcher.close();
    if (activeRunWatcher) activeRunWatcher.close();
    if (runsDirWatcher) runsDirWatcher.close();
  }

  return {
    scheduleRefresh,
    currentActiveRunId,
    resolveActiveRunDir: _resolveActiveRunDir,
    getWatchedRunDir,
    lastPipelineStatus,
    destroy,
  };
}
