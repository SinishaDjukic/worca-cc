// src/core/requirements/trackers.mjs
// The tracker connections Requirements talks to (plans/requirements-a6-design.md D1–D3, D11; plans/requirements-a61-design.md D2,
// D15, D16): which plugin task sources say they can export or import (one cached capabilities() probe), where a scope's
// Connection starts, how a connection is named, and the product sentence for a tracker that could not be reached. Export
// (export.mjs) and import (import.mjs) both use these; neither owns them. The log keeps a failure's first line only (firstLine).
import { callSource as shimCallSource } from '../plugin-shim.mjs';
import { listTaskSources } from '../sources.mjs';
import { readPluginsLock } from '../plugins-lock.mjs';
import { listProfiles, configStamp } from '../plugin-config.mjs';
import { resolveProfile, listBindingsForScope } from '../source-bindings.mjs';

/** A capability probe's time limit (D3): it runs inside every feature view, so a slow connector must not hold the page. */
export const PROBE_TIMEOUT_MS = 10_000;
/** How long a failed probe stands (D3): meanwhile that connection cannot export. */
export const PROBE_RETRY_MS = 60_000;

/** The shim, or a test's stand-in (d.callSource). */
const callOf = (d) => (d && typeof d.callSource === 'function' ? d.callSource : shimCallSource);
/** Milliseconds now, or a test's clock (d.now() → a Date or a number). */
const msOf = (d) => (d && typeof d.now === 'function' ? Number(d.now()) : Date.now());

// D3: capabilities() answers per plugin, source id and what is installed (installOf), for the process's life ("yes" and
// "no" alike); an update, a link or a re-link changes installOf, so the source is asked again.
// A failed probe is remembered for PROBE_RETRY_MS per plugin, source id and profile (the source cannot export meanwhile),
// then asked again. In-flight probes are shared, so several views at once ask once.
const capCache = new Map();
const capFailed = new Map();   // `${plugin}/${sourceId}/${profile}` → when the probe failed
const capInflight = new Map();
/** Tests (through export.mjs's _resetExportCaches): forget every probe answer and failure. */
export function _resetTrackerCaches() { capCache.clear(); capFailed.clear(); capInflight.clear(); listCache.clear(); }

/** How long a connection's project list stands: it pages through every project of the tracker (seconds on a big Jira). */
export const LIST_TTL_MS = 10 * 60_000;
const listCache = new Map();   // `${plugin}/${sourceId}/${profile}@${installOf}#${configStamp}` → { at, p } (p: the list, or the call in flight)
/**
 * A connection's list from `load()`, kept for LIST_TTL_MS and shared by callers at the same moment. The key holds what is installed
 * for the plugin and a stamp of its saved profiles, configuration and secrets, so an update, a link, or a change to the connection
 * (another site, another token) asks the tracker again. A failure is not kept. `kind` separates lists of one connection.
 */
export function keptList(conn, kind, load, d = {}) {
  const key = `${kind}:${conn.plugin}/${conn.sourceId}/${conn.profile || ''}@${installOf(conn.plugin)}#${stampOf(conn.plugin)}`;
  const now = msOf(d);
  const hit = listCache.get(key);
  if (hit && now - hit.at < LIST_TTL_MS) return hit.p;
  const entry = { at: now, p: null };
  entry.p = load();
  listCache.set(key, entry);
  entry.p.catch(() => { if (listCache.get(key) === entry) listCache.delete(key); });
  return entry.p;
}
const stampOf = (plugin) => { try { return configStamp(plugin); } catch { return ''; } };

/** What is installed for a plugin, from its lock entry: the version alone misses an update to a new commit (pinnedSha) and
 *  a link (linked; the lock keeps no linked path, but every link writes a new installedAt), since neither need change it. */
const installOf = (plugin) => {
  try {
    const e = readPluginsLock()[plugin] || {};
    return JSON.stringify([e.version ?? '', e.pinnedSha ?? '', e.linked === true, e.installedAt ?? '']);
  } catch { return ''; }
};
/** A source's connections: a multi-profile source's profiles; a single-profile source is its one configuration. */
const connectionsOf = (s) => (s.multiProfile === true ? (s.profiles || []) : [{ id: null, label: s.displayName }]);

const NO_CAPS = Object.freeze({ export: false, import: false });

async function probe(s, first, d) {
  try {
    const caps = await callOf(d)({ plugin: s.plugin, sourceId: s.sourceId, op: 'capabilities', args: { inputs: {} },
      profile: first.id || undefined, timeoutMs: PROBE_TIMEOUT_MS });
    // A6 D3 and A6.1 D2: one answer says both; only `true` counts
    return { keep: true, caps: { export: !!(caps && caps.export === true), import: !!(caps && caps.import === true) } };
  } catch (err) {
    // A connector without the op can do neither (kept); any other failure stands for PROBE_RETRY_MS (D3)
    return { keep: (err && err.kind) === 'unimplemented', caps: NO_CAPS };
  }
}

async function capsOf(s, first, d) {
  const key = `${s.plugin}/${s.sourceId}@${installOf(s.plugin)}`;
  if (capCache.has(key)) return capCache.get(key);
  const failKey = `${s.plugin}/${s.sourceId}/${first.id || ''}`;
  if (capFailed.has(failKey) && msOf(d) - capFailed.get(failKey) < PROBE_RETRY_MS) return NO_CAPS;
  if (!capInflight.has(key)) {
    capInflight.set(key, probe(s, first, d).then((r) => {
      if (r.keep) { capCache.set(key, r.caps); capFailed.delete(failKey); } else capFailed.set(failKey, msOf(d));
      return r.caps;
    }).finally(() => capInflight.delete(key)));
  }
  return capInflight.get(key);
}

/** The sources whose capabilities() say `cap` ('export' for A6, 'import' for A6.1): enabled plugin task sources with a
 *  connection (a multi-profile source needs a profile; it is probed with its first, since it refuses a call without one), in
 *  listTaskSources' order. All sources are probed at once, so one slow connector costs a view at most PROBE_TIMEOUT_MS.
 *  Never throws. */
export async function trackersWith(cap, d = {}) {
  let sources = [];
  try { sources = listTaskSources().filter((s) => s.type === 'plugin'); } catch { return []; }
  const found = await Promise.all(sources.map(async (s) => {
    const conns = connectionsOf(s);
    if (!conns.length || !(await capsOf(s, conns[0], d))[cap]) return null;
    return { plugin: s.plugin, sourceId: s.sourceId, name: s.displayName, multiProfile: s.multiProfile === true,
      profiles: conns.map((p) => ({ id: p.id || null, label: String(p.label || p.id || s.displayName) })) };
  }));
  return found.filter(Boolean);
}

export const bindingsOf = (scope) => { try { return listBindingsForScope(scope.scopeType, scope.scopeKey); } catch { return []; } };

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

/** Kinds whose message is the connector's own sentence ("Jira unreachable: fetch failed.", "Jira refused the request: …"). */
const SENTENCE_KINDS = new Set(['network', 'rate-limit', 'plugin']);
/** Not product copy: more than one line, a stack frame, a path or URL scheme of a file, the shim's own words, a JS error. */
const NOT_COPY = /[\r\n]|\bat\s+\S+\s+\(|\b(?:file|node):|[A-Za-z]:\\|(?:^|[\s'"(=])\/[\w.-]+\/|^plugin "|^\w*Error\b|^Cannot read propert|is not (?:a function|defined)/;
const isSentence = (m) => typeof m === 'string' && !!m.trim() && m.length <= 300 && !NOT_COPY.test(m);

/** D11: why a tracker could not be reached, in product words. A message that is not product copy (a connector that crashed,
 *  an answer the shim could not read, a kind the host does not know) becomes a fixed phrase; trackerCall logs the first line of the raw text. */
export function reachReason(err, name) {
  const kind = err && err.kind;
  const message = err && err.message;
  const plugin = name ? `the ${name} plugin` : "the tracker's plugin";
  if (kind === 'auth') return 'the API token was refused';
  if (kind === 'timeout') return 'it did not answer within a minute';
  if (kind === 'protocol') return `${plugin} gave an answer Worca could not read`;
  if (kind && !(SENTENCE_KINDS.has(kind) && isSentence(message))) return `${plugin} stopped unexpectedly`;
  return String(message || 'it did not answer').trim().replace(/\.+$/, '');
}
export const reachSentence = (name, err) => `Worca could not reach ${name || 'the tracker'}: ${reachReason(err, name)}.`;

/** The same connection: plugin, source id and profile. */
export const sameConn = (a, b) => !!a && !!b && a.plugin === b.plugin && a.sourceId === b.sourceId && (a.profile || null) === (b.profile || null);

/** A source's display name ("Jira"), also for a link whose plugin can no longer export. */
export function sourceName(conn) {
  try {
    const s = listTaskSources().find((x) => x.type === 'plugin' && x.plugin === conn.plugin && x.sourceId === conn.sourceId);
    return (s && s.displayName) || conn.plugin;
  } catch { return conn.plugin; }
}
/** The connection as the setup's select names it: the profile's label, else the source's name. */
export function connectionLabel(conn) {
  if (!conn.profile) return sourceName(conn);
  try { return (listProfiles(conn.plugin).find((p) => p.id === conn.profile) || {}).label || conn.profile; } catch { return conn.profile; }
}

/** What the server log may keep of a failure: its first line, at most 200 characters — never a plugin's whole stdout/stderr,
 *  which can carry config or environment fragments (A6's final review; A6.1 uses it for every import and download log line). */
export const firstLine = (err) => String((err && err.message) || err).split(/\r?\n/)[0].slice(0, 200);
