/**
 * MultiWatcher — watches .worca/multi/pipelines.d/ for a project,
 * tracking parallel pipeline instances and their status changes.
 *
 * Each pipeline in pipelines.d/{run_id}.json is monitored. On status
 * changes, broadcasts 'pipeline-status-changed' events. Optionally
 * creates per-worktree WatcherSets for log/status streaming.
 */

import { existsSync, watch } from 'node:fs';
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { TIER_FULL, TIER_POLLING, WatcherSet } from './watcher-set.js';

export class MultiWatcher {
  /**
   * @param {string} projectId — parent project name
   * @param {string} worcaDir — parent project's .worca/ directory
   * @param {{ broadcaster, getSubs, wss, settingsPath, projectRoot, webhookInbox }} deps
   */
  constructor(projectId, worcaDir, deps) {
    this.projectId = projectId;
    this.worcaDir = worcaDir;
    this._deps = deps;
    this._dirWatcher = null;
    this._debounceTimer = null;
    this._closed = false;

    /** @type {Map<string, { entry: object, watcherSet: WatcherSet|null }>} */
    this.pipelines = new Map();
  }

  /** Start watching pipelines.d/ directory. */
  start() {
    this._syncPipelines(); // Initial scan

    const pipelinesDir = join(this.worcaDir, 'multi', 'pipelines.d');
    if (existsSync(pipelinesDir)) {
      try {
        this._dirWatcher = watch(pipelinesDir, { persistent: false }, () => {
          if (this._closed) return;
          if (this._debounceTimer) clearTimeout(this._debounceTimer);
          this._debounceTimer = setTimeout(() => {
            this._debounceTimer = null;
            if (!this._closed) this._syncPipelines();
          }, 300);
        });
      } catch {
        // fs.watch not supported or dir doesn't exist — skip
      }
    }
  }

  /** Scan pipelines.d/, diff against current map, broadcast changes. */
  async _syncPipelines() {
    const pipelinesDir = join(this.worcaDir, 'multi', 'pipelines.d');
    const freshEntries = new Map();

    try {
      const files = await readdir(pipelinesDir);
      const readPromises = files
        .filter((f) => f.endsWith('.json'))
        .map(async (fname) => {
          try {
            const entry = JSON.parse(await readFile(join(pipelinesDir, fname), 'utf8'));
            return entry.run_id ? [entry.run_id, entry] : null;
          } catch { return null; }
        });
      for (const result of await Promise.all(readPromises)) {
        if (result) freshEntries.set(result[0], result[1]);
      }
    } catch {
      // directory doesn't exist or unreadable — freshEntries stays empty
    }

    // Add new pipelines or update changed ones
    for (const [runId, entry] of freshEntries) {
      const existing = this.pipelines.get(runId);
      if (!existing) {
        this._addPipeline(runId, entry);
      } else if (
        existing.entry.status !== entry.status ||
        existing.entry.stage !== entry.stage
      ) {
        // Destroy WatcherSet when pipeline transitions out of running
        if (existing.entry.status === 'running' && entry.status !== 'running' && existing.watcherSet) {
          try { existing.watcherSet.destroy(); } catch { /* ignore */ }
          existing.watcherSet = null;
        }
        existing.entry = entry;
        this._broadcastPipelineStatus(runId, entry);
      }
    }

    // Remove deleted pipelines
    for (const runId of [...this.pipelines.keys()]) {
      if (!freshEntries.has(runId)) {
        this._removePipeline(runId);
      }
    }
  }

  /** Register a new pipeline and broadcast its status. */
  _addPipeline(runId, entry) {
    let watcherSet = null;

    // Create a WatcherSet for running worktree pipelines
    if (entry.worktree_path && entry.status === 'running') {
      const worktreeWorcaDir = join(entry.worktree_path, '.worca');
      if (existsSync(worktreeWorcaDir)) {
        try {
          const pipelineProjectId = `${this.projectId}::${runId}`;
          watcherSet = new WatcherSet(
            pipelineProjectId,
            worktreeWorcaDir,
            {
              ...this._deps,
              settingsPath: join(
                entry.worktree_path,
                '.claude',
                'settings.json',
              ),
              projectRoot: entry.worktree_path,
            },
            // Skip creating a nested MultiWatcher in pipeline WatcherSets
            { _skipMultiWatcher: true },
          );
          watcherSet.create();
          // Start in POLLING tier — promoted when user subscribes
        } catch (err) {
          console.error(
            `[MultiWatcher:${this.projectId}] Failed to create WatcherSet for pipeline ${runId}:`,
            err.message,
          );
          watcherSet = null;
        }
      }
    }

    this.pipelines.set(runId, { entry, watcherSet });
    this._broadcastPipelineStatus(runId, entry);
  }

  /** Destroy a pipeline's WatcherSet and broadcast removal. */
  _removePipeline(runId) {
    const pipeline = this.pipelines.get(runId);
    if (pipeline?.watcherSet) {
      try {
        pipeline.watcherSet.destroy();
      } catch {
        // ignore cleanup errors
      }
    }
    this.pipelines.delete(runId);
    this._deps.broadcaster.broadcast('pipeline-status-changed', {
      project: this.projectId,
      runId,
      status: 'removed',
    });
  }

  /** Broadcast a pipeline status change event. */
  _broadcastPipelineStatus(runId, entry) {
    this._deps.broadcaster.broadcast('pipeline-status-changed', {
      project: this.projectId,
      runId,
      status: entry.status,
      stage: entry.stage || null,
      title: entry.title || null,
      worktree_path: entry.worktree_path || null,
      started_at: entry.started_at || null,
      pid: entry.pid || null,
    });
  }

  /** List current pipeline entries (for list-pipelines WS request). */
  listPipelines() {
    return Array.from(this.pipelines.values()).map((p) => p.entry);
  }

  /** Get WatcherSet for a specific pipeline (for log/status streaming). */
  getPipelineWatcherSet(runId) {
    return this.pipelines.get(runId)?.watcherSet || null;
  }

  /** Promote a pipeline's watcher to FULL tier (on user subscribe). */
  promotePipeline(runId) {
    const ws = this.pipelines.get(runId)?.watcherSet;
    if (ws && ws.getTier() === TIER_POLLING) ws.setTier(TIER_FULL);
  }

  /** Demote a pipeline's watcher back to POLLING tier (on user unsubscribe). */
  demotePipeline(runId) {
    const ws = this.pipelines.get(runId)?.watcherSet;
    if (ws && ws.getTier() === TIER_FULL) ws.setTier(TIER_POLLING);
  }

  /** Destroy all pipeline watchers and close directory watcher. Idempotent. */
  destroy() {
    if (this._closed) return;
    this._closed = true;
    if (this._dirWatcher) {
      try {
        this._dirWatcher.close();
      } catch {
        // ignore
      }
      this._dirWatcher = null;
    }
    if (this._debounceTimer) {
      clearTimeout(this._debounceTimer);
      this._debounceTimer = null;
    }
    for (const { watcherSet } of this.pipelines.values()) {
      if (watcherSet) {
        try {
          watcherSet.destroy();
        } catch {
          // ignore cleanup errors
        }
      }
    }
    this.pipelines.clear();
  }
}
