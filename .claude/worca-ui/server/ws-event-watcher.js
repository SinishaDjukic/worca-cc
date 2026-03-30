/**
 * Pipeline event file watcher — manages events.jsonl subscriptions.
 * Owns the eventWatchers map and event reading/filtering logic.
 */

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { watchEvents } from './watcher.js';

/**
 * Convert a glob pattern (with * and **) to a RegExp for matching event type strings.
 * - `*`  matches any sequence of non-dot characters
 * - `**` matches any sequence of characters (including dots)
 *
 * @param {string} pattern
 * @param {string} str
 * @returns {boolean}
 */
export function matchesGlob(pattern, str) {
  const regexStr = pattern
    .split('**')
    .map((part) =>
      part
        .split('*')
        .map((s) => s.replace(/[.+^${}()|[\]\\]/g, '\\$&'))
        .join('[^.]*'),
    )
    .join('.*');
  return new RegExp(`^${regexStr}$`).test(str);
}

/**
 * @param {{
 *   broadcaster: { broadcastPipelineEvent: Function },
 *   getSubs: Function,
 *   wss: import('ws').WebSocketServer,
 *   resolveRunDirById: Function
 * }} deps
 */
export function createEventWatcher({
  broadcaster,
  getSubs,
  wss,
  resolveRunDirById,
}) {
  /** @type {Map<string, { close: () => void }>} */
  const eventWatchers = new Map();

  function readEventsFromFile(
    runId,
    { since_event_id, event_types, limit = 100 } = {},
  ) {
    const eventsPath = join(resolveRunDirById(runId), 'events.jsonl');
    if (!existsSync(eventsPath)) return [];
    try {
      const content = readFileSync(eventsPath, 'utf8');
      let events = [];
      for (const line of content.split('\n')) {
        if (!line.trim()) continue;
        try {
          events.push(JSON.parse(line));
        } catch {
          /* skip malformed */
        }
      }
      if (since_event_id) {
        const idx = events.findIndex((e) => e.event_id === since_event_id);
        if (idx >= 0) events = events.slice(idx + 1);
      }
      if (event_types && event_types.length > 0) {
        events = events.filter((e) =>
          event_types.some((p) => matchesGlob(p, e.event_type)),
        );
      }
      return events.slice(0, limit);
    } catch {
      return [];
    }
  }

  function subscribeEvents(runId) {
    if (!eventWatchers.has(runId)) {
      const runDir = resolveRunDirById(runId);
      const w = watchEvents(runDir, (event) =>
        broadcaster.broadcastPipelineEvent(runId, event),
      );
      eventWatchers.set(runId, w);
    }
  }

  function maybeCloseEventWatcher(runId) {
    for (const ws of wss.clients) {
      const s = getSubs(ws);
      if (s?.eventsRunId === runId) return; // still in use
    }
    const w = eventWatchers.get(runId);
    if (w) {
      try {
        w.close();
      } catch {
        /* ignore */
      }
      eventWatchers.delete(runId);
    }
  }

  function destroy() {
    for (const w of eventWatchers.values()) {
      try {
        w.close();
      } catch {
        /* ignore */
      }
    }
    eventWatchers.clear();
  }

  return {
    readEventsFromFile,
    subscribeEvents,
    maybeCloseEventWatcher,
    destroy,
  };
}
