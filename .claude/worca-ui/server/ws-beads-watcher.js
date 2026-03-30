/**
 * Beads database watcher — monitors .beads/beads.db for changes.
 * Watches the directory (not just the file) because SQLite WAL mode
 * writes to beads.db-wal first.
 */

import { existsSync, watch } from 'node:fs';
import { join, resolve } from 'node:path';
import { listIssues } from './beads-reader.js';

const BEADS_DEBOUNCE_MS = 200;

/**
 * @param {{ worcaDir: string, broadcaster: { broadcast: Function }, projectId?: string }} deps
 */
export function createBeadsWatcher({ worcaDir, broadcaster, projectId }) {
  const beadsDbPath = resolve(join(worcaDir, '..', '.beads', 'beads.db'));
  const beadsDir = resolve(join(worcaDir, '..', '.beads'));
  let beadsWatcher = null;
  let BEADS_REFRESH_TIMER = null;

  function scheduleBeadsRefresh() {
    if (BEADS_REFRESH_TIMER) clearTimeout(BEADS_REFRESH_TIMER);
    BEADS_REFRESH_TIMER = setTimeout(() => {
      BEADS_REFRESH_TIMER = null;
      try {
        const issues = listIssues(beadsDbPath);
        broadcaster.broadcast('beads-update', {
          issues,
          dbExists: true,
          dbPath: beadsDbPath,
        }, projectId);
      } catch {
        /* ignore */
      }
    }, BEADS_DEBOUNCE_MS);
  }

  if (existsSync(beadsDir)) {
    try {
      beadsWatcher = watch(beadsDir, (_event, filename) => {
        if (filename?.startsWith('beads.db')) scheduleBeadsRefresh();
      });
    } catch {
      /* ignore */
    }
  }

  function getBeadsDbPath() {
    return beadsDbPath;
  }

  function destroy() {
    if (beadsWatcher) beadsWatcher.close();
  }

  return { getBeadsDbPath, destroy };
}
