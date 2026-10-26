// src/core/requirements/export.mjs
// Export to a tracker (plans/requirements-a6-design.md): a feature's spec becomes a ticket in the team's tracker through the
// task-source contract's optional export ops (D3), never a tracker's own API. This module knows only "a source that can
// export"; each plugin maps the tool-neutral ticket (ticket.mjs) to its own format. Every call runs here, server-side,
// through callSource (D18): the browser never drives one, and no config value leaves the plugin.
import { callSource as shimCallSource } from '../plugin-shim.mjs';
import { listTaskSources } from '../sources.mjs';
import { readPluginsLock } from '../plugins-lock.mjs';
import { resolveProfile, listBindingsForScope } from '../source-bindings.mjs';

/** Every export op's time limit (D14): a create makes up to three tracker calls; exportOptions pages through projects. */
export const EXPORT_TIMEOUT_MS = 60_000;

/** A capability probe's time limit (D3): it runs inside every feature view, so a slow connector must not hold the page. */
export const PROBE_TIMEOUT_MS = 10_000;
/** How long a failed probe stands (D3, user decision 2026-10-26): meanwhile that connection cannot export. */
export const PROBE_RETRY_MS = 60_000;

/** The shim, or a test's stand-in (d.callSource). */
const callOf = (d) => (d && typeof d.callSource === 'function' ? d.callSource : shimCallSource);
/** Milliseconds now, or a test's clock (d.now() → a Date or a number). */
const msOf = (d) => (d && typeof d.now === 'function' ? Number(d.now()) : Date.now());

// D3: capabilities() answers per plugin, source id and installed version, for the process's life ("yes" and "no" alike).
// A failed probe is remembered for PROBE_RETRY_MS per plugin, source id and profile (the source cannot export meanwhile),
// then asked again (user decision 2026-10-26). In-flight probes are shared, so several views at once ask once.
const capCache = new Map();
const capFailed = new Map();   // `${plugin}/${sourceId}/${profile}` → when the probe failed
const capInflight = new Map();
// exportOptions' last doneStatus per connection (Task 5's saveSetup stores it on the setup).
const lastDone = new Map();
/** Tests: forget every probe answer, failure and done status. */
export function _resetExportCaches() { capCache.clear(); capFailed.clear(); capInflight.clear(); lastDone.clear(); }

const versionOf = (plugin) => { try { return String((readPluginsLock()[plugin] || {}).version || ''); } catch { return ''; } };
/** A source's connections: a multi-profile source's profiles; a single-profile source is its one configuration. */
const connectionsOf = (s) => (s.multiProfile === true ? (s.profiles || []) : [{ id: null, label: s.displayName }]);

async function probe(s, first, d) {
  try {
    const caps = await callOf(d)({ plugin: s.plugin, sourceId: s.sourceId, op: 'capabilities', args: { inputs: {} },
      profile: first.id || undefined, timeoutMs: PROBE_TIMEOUT_MS });
    return { keep: true, ok: !!(caps && caps.export === true) };
  } catch (err) {
    // A connector without the op cannot export (kept); any other failure stands for PROBE_RETRY_MS (D3)
    return { keep: (err && err.kind) === 'unimplemented', ok: false };
  }
}

async function canExport(s, first, d) {
  const key = `${s.plugin}/${s.sourceId}@${versionOf(s.plugin)}`;
  if (capCache.has(key)) return capCache.get(key);
  const failKey = `${s.plugin}/${s.sourceId}/${first.id || ''}`;
  if (capFailed.has(failKey) && msOf(d) - capFailed.get(failKey) < PROBE_RETRY_MS) return false;
  if (!capInflight.has(key)) {
    capInflight.set(key, probe(s, first, d).then((r) => {
      if (r.keep) { capCache.set(key, r.ok); capFailed.delete(failKey); } else capFailed.set(failKey, msOf(d));
      return r.ok;
    }).finally(() => capInflight.delete(key)));
  }
  return capInflight.get(key);
}

/** The sources that can export (D1, D3): enabled plugin task sources with a connection (a multi-profile source needs a
 *  profile; it is probed with its first, since it refuses a call without one) whose capabilities() say export: true, in
 *  listTaskSources' order. All sources are probed at once, so one slow connector costs a view at most PROBE_TIMEOUT_MS.
 *  Never throws. */
export async function exportTrackers(d = {}) {
  let sources = [];
  try { sources = listTaskSources().filter((s) => s.type === 'plugin'); } catch { return []; }
  const found = await Promise.all(sources.map(async (s) => {
    const conns = connectionsOf(s);
    if (!conns.length || !(await canExport(s, conns[0], d))) return null;
    return { plugin: s.plugin, sourceId: s.sourceId, name: s.displayName, multiProfile: s.multiProfile === true,
      profiles: conns.map((p) => ({ id: p.id || null, label: String(p.label || p.id || s.displayName) })) };
  }));
  return found.filter(Boolean);
}

const bindingsOf = (scope) => { try { return listBindingsForScope(scope.scopeType, scope.scopeKey); } catch { return []; } };

/** D2: where a new setup's Connection starts: the scope's profile from resolveProfile (a bound tracker first), else the
 *  first tracker's first connection; null without a tracker. */
export function defaultConnection(scope, trackers, { memberKeys = [] } = {}) {
  if (!trackers || !trackers.length) return null;
  const bound = new Set(bindingsOf(scope).map((b) => `${b.plugin}/${b.sourceId}`));
  const isBound = (t) => bound.has(`${t.plugin}/${t.sourceId}`);
  const order = [...trackers.filter(isBound), ...trackers.filter((t) => !isBound(t))];
  for (const t of order) {
    if (!t.multiProfile) continue;
    const r = resolveProfile({ scopeType: scope.scopeType, scopeKey: scope.scopeKey, plugin: t.plugin, sourceId: t.sourceId, memberKeys,
      available: t.profiles.map((p) => p.id) });
    if (r.profile) return { plugin: t.plugin, sourceId: t.sourceId, profile: r.profile };
  }
  const t = order[0];
  return { plugin: t.plugin, sourceId: t.sourceId, profile: t.profiles[0].id || null };
}

/** D11: why a tracker could not be reached, in product words. */
export function reachReason(err) {
  const kind = err && err.kind;
  if (kind === 'auth') return 'the API token was refused';
  if (kind === 'timeout') return 'it did not answer within a minute';
  return String((err && err.message) || 'it did not answer').trim().replace(/\.+$/, '');
}
export const reachSentence = (name, err) => `Worca could not reach ${name || 'the tracker'}: ${reachReason(err)}.`;
