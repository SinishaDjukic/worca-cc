// src/core/extension-actions.mjs — the browser extension's "which running worca Action serves this page?" (D7, D8).
// Pure (test/extension-actions-match.test.mjs). Read-only; returns at most ONE match with only what the sidebar needs.
const LOOPBACK = new Set(['localhost', '127.0.0.1', '[::1]']);

/** An http(s) page origin, normalized ("http://localhost:5173"), or null. */
export function pageOrigin(raw) {
  if (typeof raw !== 'string' || !raw || raw.length > 2048) return null;
  let u;
  try { u = new URL(raw); } catch { return null; }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
  return u.origin;
}

/** Comparable key: scheme + host (loopback names fold together) + effective port. */
function originKey(origin) {
  const u = new URL(origin);
  const host = LOOPBACK.has(u.hostname) ? 'loopback' : u.hostname.toLowerCase();
  const port = u.port || (u.protocol === 'https:' ? '443' : '80');
  return `${u.protocol}//${host}:${port}`;
}

/** Origins an instance answers on: its url's, plus http://localhost:<p> for every bound port. */
export function instanceOrigins(s) {
  const out = [];
  const o = pageOrigin(s && s.url);
  if (o) out.push(o);
  for (const p of Object.values((s && s.ports) || {})) if (Number.isInteger(p) && p > 0 && p < 65536) out.push(`http://localhost:${p}`);
  return out;
}

/**
 * @param {string} origin       pageOrigin() output
 * @param {object[]} running    ActionRegistry#running() snapshots
 * @param {(runId:string) => ({title?:string|null, projectKey?:string|null, workspaceId?:string|null}|null)} runInfo
 * → { url, projectKey, workspaceId, runId, runTitle } | null — the first ready/running instance wins (registry order).
 */
export function matchRunningAction(origin, running, runInfo) {
  if (!origin) return null;
  const want = originKey(origin);
  const live = (Array.isArray(running) ? running : []).filter((s) => s && (s.status === 'ready' || s.status === 'running'));
  for (const s of live) {
    if (!instanceOrigins(s).some((o) => originKey(o) === want)) continue;
    const info = runInfo(s.runId) || {};
    return {
      url: pageOrigin(s.url) || origin,
      projectKey: info.workspaceId ? null : (info.projectKey || null),
      workspaceId: info.workspaceId || null,
      runId: String(s.runId),
      runTitle: info.title || null,
    };
  }
  return null;
}
