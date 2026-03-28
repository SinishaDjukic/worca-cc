/**
 * WatcherSet — groups all file watchers for a single project.
 * Wraps createStatusWatcher, createLogWatcher, createBeadsWatcher, createEventWatcher
 * into a single lifecycle-managed unit.
 *
 * Supports activity-based tiering:
 * - Full:    all 4 watchers active (75ms debounce)
 * - Polling: status watcher only (5s debounce)
 */

import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { createBeadsWatcher } from './ws-beads-watcher.js';
import { createEventWatcher } from './ws-event-watcher.js';
import { createLogWatcher } from './ws-log-watcher.js';
import { createStatusWatcher } from './ws-status-watcher.js';

export const TIER_FULL = 'full';
export const TIER_POLLING = 'polling';

export class WatcherSet {
  /**
   * @param {string} projectId
   * @param {string} worcaDir
   * @param {{ broadcaster, getSubs, wss, settingsPath, projectRoot, webhookInbox }} deps
   * @param {object} [factoryOverrides] - Optional factory overrides for testing
   */
  constructor(projectId, worcaDir, deps, factoryOverrides = {}) {
    this.projectId = projectId;
    this._worcaDir = worcaDir;
    this._deps = deps;
    this._closed = false;
    this._tier = TIER_POLLING;
    this._factories = {
      createStatusWatcher,
      createLogWatcher,
      createBeadsWatcher,
      createEventWatcher,
      ...factoryOverrides,
    };

    /** @type {ReturnType<typeof createStatusWatcher> | null} */
    this.statusWatcher = null;
    /** @type {ReturnType<typeof createLogWatcher> | null} */
    this.logWatcher = null;
    /** @type {ReturnType<typeof createBeadsWatcher> | null} */
    this.beadsWatcher = null;
    /** @type {ReturnType<typeof createEventWatcher> | null} */
    this.eventWatcher = null;
  }

  get worcaDir() {
    return this._worcaDir;
  }
  get settingsPath() {
    return this._deps.settingsPath;
  }
  get projectRoot() {
    return this._deps.projectRoot;
  }

  /** Get current tier. */
  getTier() {
    return this._tier;
  }

  /**
   * Set tier. Promote to Full creates missing watchers, demote to Polling
   * destroys log/beads/event watchers.
   */
  setTier(tier) {
    if (tier === this._tier || this._closed) return;
    const oldTier = this._tier;
    this._tier = tier;

    if (tier === TIER_FULL && oldTier === TIER_POLLING) {
      // Promote: create log, beads, event watchers
      this._createSecondaryWatchers();
    } else if (tier === TIER_POLLING && oldTier === TIER_FULL) {
      // Demote: destroy log, beads, event watchers
      this._destroySecondaryWatchers();
    }
  }

  /** Create all watchers. Starts in current tier (creates status always, others only if Full). */
  create() {
    this._createStatusWatcher();
    if (this._tier === TIER_FULL) {
      this._createSecondaryWatchers();
    }
  }

  /** Create status watcher (always needed). */
  _createStatusWatcher() {
    const { broadcaster, getSubs, wss, settingsPath } = this._deps;
    const worcaDir = this._worcaDir;

    try {
      this.statusWatcher = this._factories.createStatusWatcher({
        worcaDir,
        settingsPath,
        broadcaster,
        getSubs,
        wss,
        onActiveRunChange: () => {
          if (this.logWatcher) this.logWatcher.clearLogWatchers();
        },
      });
    } catch (err) {
      console.error(
        `[WatcherSet:${this.projectId}] statusWatcher failed:`,
        err.message,
      );
      this.statusWatcher = null;
    }
  }

  /** Create secondary watchers (log, beads, event). */
  _createSecondaryWatchers() {
    const { broadcaster, getSubs, wss } = this._deps;
    const worcaDir = this._worcaDir;

    // Log watcher
    if (!this.logWatcher) {
      try {
        this.logWatcher = this._factories.createLogWatcher({
          broadcaster,
          resolveActiveRunDir: this.statusWatcher
            ? this.statusWatcher.resolveActiveRunDir
            : () => worcaDir,
          worcaDir,
          currentActiveRunId: this.statusWatcher
            ? this.statusWatcher.currentActiveRunId
            : () => null,
        });
      } catch (err) {
        console.error(
          `[WatcherSet:${this.projectId}] logWatcher failed:`,
          err.message,
        );
        this.logWatcher = null;
      }
    }

    // Beads watcher
    if (!this.beadsWatcher) {
      try {
        this.beadsWatcher = this._factories.createBeadsWatcher({
          worcaDir,
          broadcaster,
        });
      } catch (err) {
        console.error(
          `[WatcherSet:${this.projectId}] beadsWatcher failed:`,
          err.message,
        );
        this.beadsWatcher = null;
      }
    }

    // Event watcher
    if (!this.eventWatcher) {
      try {
        const resolveRunDirById = (runId) => {
          const candidates = [
            join(worcaDir, 'runs', runId),
            join(worcaDir, 'results', runId),
          ];
          for (const c of candidates) {
            if (existsSync(c)) return c;
          }
          return join(worcaDir, 'runs', runId);
        };

        this.eventWatcher = this._factories.createEventWatcher({
          broadcaster,
          getSubs,
          wss,
          resolveRunDirById,
        });
      } catch (err) {
        console.error(
          `[WatcherSet:${this.projectId}] eventWatcher failed:`,
          err.message,
        );
        this.eventWatcher = null;
      }
    }
  }

  /** Destroy secondary watchers (keep status). */
  _destroySecondaryWatchers() {
    for (const w of [this.logWatcher, this.beadsWatcher, this.eventWatcher]) {
      try {
        w?.destroy();
      } catch {
        // ignore cleanup errors
      }
    }
    this.logWatcher = null;
    this.beadsWatcher = null;
    this.eventWatcher = null;
  }

  /** Destroy all child watchers. Idempotent. */
  destroy() {
    if (this._closed) return;
    this._closed = true;

    for (const w of [
      this.statusWatcher,
      this.logWatcher,
      this.beadsWatcher,
      this.eventWatcher,
    ]) {
      try {
        w?.destroy();
      } catch {
        // ignore cleanup errors
      }
    }
  }

  /** Check if this WatcherSet is still usable. */
  isAlive() {
    return !this._closed && existsSync(this._worcaDir);
  }

  /** Approximate number of active watcher modules. */
  getWatcherCount() {
    let count = 0;
    if (this.statusWatcher) count++;
    if (this.logWatcher) count++;
    if (this.beadsWatcher) count++;
    if (this.eventWatcher) count++;
    return count;
  }

  /** Delegate to status watcher's scheduleRefresh. */
  scheduleRefresh() {
    this.statusWatcher?.scheduleRefresh();
  }
}
