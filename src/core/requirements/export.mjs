// src/core/requirements/export.mjs
// Export to a tracker (plans/requirements-a6-design.md): a feature's spec becomes a ticket in the team's tracker through the
// task-source contract's optional export ops (D3), never a tracker's own API. This module knows only "a source that can
// export"; each plugin maps the tool-neutral ticket (ticket.mjs) to its own format. Every call runs here, server-side,
// through callSource (D18): the browser never drives one, and no config value leaves the plugin.
import { randomBytes } from 'node:crypto';
import { callSource as shimCallSource } from '../plugin-shim.mjs';
import { listTaskSources } from '../sources.mjs';
import { readPluginsLock } from '../plugins-lock.mjs';
import { listProfiles } from '../plugin-config.mjs';
import { resolveProfile, listBindingsForScope } from '../source-bindings.mjs';
import { actorLabel } from '../identity.mjs';
import { tx } from '../db.mjs';
import { RequirementsError } from './spec.mjs';
import {
  requireFeature, listTurns, listAttachments, usableBrief, appendTurn, getExportSetup, upsertExportSetup, setExportSetupDoneStatus, getExportLink,
  setPendingExport, saveExportLink, clearPendingExport, deleteExportLink,
} from './store.mjs';
import { mentions } from './attachments.mjs';
import { readiness } from './ready.mjs';
import { pendingRound } from './round.mjs';
import { isBusy } from './interview.mjs';
import { REASON_MAX } from './start.mjs';
import { isStarting, STARTING_MESSAGE, markExporting, unmarkExporting, isExporting } from './starting.mjs';
import { buildTicket, exportChanges, changeSummary, renderExportComment, ticketHash, exportDate, exportTime, exportLabel, normalizeLabels } from './ticket.mjs';

export { isExporting };

/** Every export op's time limit (D14): a create makes up to three tracker calls; exportOptions pages through projects. */
export const EXPORT_TIMEOUT_MS = 60_000;

/** A capability probe's time limit (D3): it runs inside every feature view, so a slow connector must not hold the page. */
export const PROBE_TIMEOUT_MS = 10_000;
/** How long a failed probe stands (D3): meanwhile that connection cannot export. */
export const PROBE_RETRY_MS = 60_000;

/** The shim, or a test's stand-in (d.callSource). */
const callOf = (d) => (d && typeof d.callSource === 'function' ? d.callSource : shimCallSource);
/** Milliseconds now, or a test's clock (d.now() → a Date or a number). */
const msOf = (d) => (d && typeof d.now === 'function' ? Number(d.now()) : Date.now());

// D3: capabilities() answers per plugin, source id and installed version, for the process's life ("yes" and "no" alike).
// A failed probe is remembered for PROBE_RETRY_MS per plugin, source id and profile (the source cannot export meanwhile),
// then asked again. In-flight probes are shared, so several views at once ask once.
const capCache = new Map();
const capFailed = new Map();   // `${plugin}/${sourceId}/${profile}` → when the probe failed
const capInflight = new Map();
// exportOptions' last doneStatus per connection (saveSetup stores it on the setup).
const lastDone = new Map();
/** The last failed create per feature, in memory: { marker, kind }. After a restart nothing is known (the search grace applies). */
const createFailures = new Map();
/** Tests: forget every probe answer, failure, done status and failed create. */
export function _resetExportCaches() { capCache.clear(); capFailed.clear(); capInflight.clear(); lastDone.clear(); createFailures.clear(); }

const versionOf = (plugin) => { try { return String((readPluginsLock()[plugin] || {}).version || ''); } catch { return ''; } };
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
  const key = `${s.plugin}/${s.sourceId}@${versionOf(s.plugin)}`;
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

/** D1, D3: the sources that can export. */
export const exportTrackers = (d = {}) => trackersWith('export', d);

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

// ---- the service: setup, preview, export, Forget the link, the feature's view ----

const MODES = Object.freeze(['create', 'update', 'comment', 'new']);
const ARCHIVED = 'this feature is archived; restore it first';
const WORKING = 'Worca is still working on this feature. Try again in a moment.';
export const ALREADY_EXPORTING = 'Worca is already exporting this feature.';
const STALE = 'The spec changed since the preview. Look at the preview again.';
/** How long a lost create's marker that the tracker's search does not find yet is kept (Jira Cloud's search lags a create
 *  by a few seconds): meanwhile an export answers BUSY instead of making a second ticket. */
export const PENDING_SEARCH_GRACE_MS = 120_000;
/** Failure kinds after which the tracker certainly made no ticket (it refused the request: the token, the rate limit, an op
 *  it does not have). After any other kind (a timeout, a protocol failure, a network failure that may have come after the
 *  request was sent, an error the tracker answered with) the outcome is unknown and the search grace applies. */
const CERTAIN_NO_TICKET = new Set(['auth', 'rate-limit', 'unimplemented']);
const text = (v, max) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
/** A one-line field in the ticket (the Export anyway reason, a file name): its line breaks cannot make Markdown structure. */
const oneLine = (v) => String(v).replace(/\s+/g, ' ').trim();
const connOf = (x) => ({ plugin: x.plugin, sourceId: x.sourceId, profile: x.profile || null });
export const sameConn = (a, b) => !!a && !!b && a.plugin === b.plugin && a.sourceId === b.sourceId && (a.profile || null) === (b.profile || null);
const connKey = (c) => `${c.plugin}/${c.sourceId}/${c.profile || ''}`;
const nowOf = (d) => (d && typeof d.now === 'function' ? d.now() : new Date());
const mintMarker = () => `rexp_${randomBytes(6).toString('hex')}`;
/** A ticket URL from the connector is a link only when it is http(s) (a javascript: or data: URL would be a live link). */
const webUrl = (u) => (typeof u === 'string' && /^\s*https?:\/\//i.test(u) ? u.trim() : null);
const options = (v) => (Array.isArray(v) ? v.filter((x) => x && x.value != null).map((x) => ({ value: String(x.value), label: String(x.label ?? x.value) })) : []);

/** A source's display name ("Jira"), also for a link whose plugin can no longer export. */
function sourceName(conn) {
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

/** One op through the connection, in EXPORT_TIMEOUT_MS; any failure is D11's sentence (TRACKER, 502). An op the connector
 *  no longer has (a cached "yes", then a downgrade) says so instead of "connector does not implement op …". */
async function trackerCall(d, name, conn, op, args) {
  try {
    return await callOf(d)({ plugin: conn.plugin, sourceId: conn.sourceId, profile: conn.profile || undefined, op, args, timeoutMs: EXPORT_TIMEOUT_MS });
  } catch (err) {
    const kind = (err && err.kind) || 'plugin';
    console.error(`requirements: export op ${op} via ${conn.plugin}/${conn.sourceId} failed (${kind}):`, firstLine(err));
    if (kind === 'unimplemented') throw new RequirementsError('TRACKER', `${name || 'The tracker'} cannot export any more.`, { kind: 'unimplemented' });
    throw new RequirementsError('TRACKER', reachSentence(name, { kind, message: err && err.message }), { kind });
  }
}
const goneError = (key, name) => new RequirementsError('CONFLICT', `${key} no longer exists in ${name}.`, { gone: true });
const editedError = (key, name) => new RequirementsError('CONFLICT', `${key} was edited in ${name} since your last export. Updating replaces its description.`,
  { edited: true });
const refusedError = (r) => new RequirementsError('CONFLICT', String((r && r.message) || 'The tracker refused the ticket.'), { refused: true, field: (r && r.field) || null });

/** D4: the names of the files the spec mentions: the feature's files, then its scope brief's documents, each name once. */
export function mentionedFiles(f) {
  const brief = usableBrief(f.scopeType, f.scopeKey);
  const rows = [...listAttachments('feature', f.seq), ...(brief ? listAttachments('brief', brief.id) : [])];
  const out = [];
  for (const r of rows) {
    if (!r || !r.name || out.some((n) => n.toLowerCase() === r.name.toLowerCase())) continue;
    if (mentions(f.spec, r.name).length) out.push(r.name);
  }
  return out;
}

/** The setup dialog's data (§6): no tracker call but the (cached) capability probe. */
export async function exportSetupView(scope, { memberKeys = [] } = {}, d = {}) {
  const trackers = await exportTrackers(d);
  return { setup: getExportSetup(scope.scopeType, scope.scopeKey), trackers, defaultProfile: defaultConnection(scope, trackers, { memberKeys }) };
}

/** The connection a request names, when it is one of a listed tracker's (else BAD_REQUEST); its tracker. */
async function trackerFor(body, d) {
  const conn = { plugin: text(body.plugin, 64), sourceId: text(body.sourceId, 64), profile: text(body.profile, 64) || null };
  const t = (await exportTrackers(d)).find((x) => x.plugin === conn.plugin && x.sourceId === conn.sourceId);
  if (!t || !t.profiles.some((p) => (p.id || null) === conn.profile)) throw new RequirementsError('BAD_REQUEST', 'Choose a connection from the list.');
  return { conn, t };
}

/** The setup's selects (D16), each loaded as the one before it changes. Caches doneStatus per connection and refreshes the
 *  setup's when it is the setup's own connection (D15). */
export async function exportOptions(scope, body = {}, d = {}) {
  const { conn, t } = await trackerFor(body, d);
  const project = text(body.project, 100);
  const issueType = text(body.issueType, 100);
  if (issueType && !project) throw new RequirementsError('BAD_REQUEST', 'project is required');
  const r = (await trackerCall(d, t.name, conn, 'exportOptions', { ...(project ? { project } : {}), ...(issueType ? { issueType } : {}) })) || {};
  const out = {
    projects: options(r.projects),
    ...(project ? { issueTypes: options(r.issueTypes) } : {}),
    ...(project && issueType ? { priorities: options(r.priorities), criteriaFields: options(r.criteriaFields) } : {}),
    doneStatus: typeof r.doneStatus === 'string' && r.doneStatus.trim() ? r.doneStatus.trim() : null,
    ...(r.tooOld === true ? { tooOld: true } : {}),
  };
  lastDone.set(connKey(conn), out.doneStatus);
  const setup = getExportSetup(scope.scopeType, scope.scopeKey);
  if (setup && sameConn(setup, conn) && setup.doneStatus !== out.doneStatus) setExportSetupDoneStatus(scope.scopeType, scope.scopeKey, out.doneStatus);
  return out;
}

/** Save the setup (D2): a listed connection, the tracker project and issue type with their names, labels (normalised, the
 *  fixed label is per export), an optional priority, where the criteria go. Never a config value. */
export async function saveSetup(scope, body = {}, { by = null } = {}, d = {}) {
  const { conn } = await trackerFor(body, d);
  const project = text(body.project, 100);
  const issueType = text(body.issueType, 100);
  if (!project) throw new RequirementsError('BAD_REQUEST', 'project is required');
  if (!issueType) throw new RequirementsError('BAD_REQUEST', 'issueType is required');
  const priority = text(body.priority, 100) || null;
  const c = body.criteria && typeof body.criteria === 'object' ? body.criteria : {};
  const criteria = c.target === 'field' ? { target: 'field', field: text(c.field, 100), name: text(c.name, 200) || text(c.field, 100) } : { target: 'description' };
  if (criteria.target === 'field' && !criteria.field) throw new RequirementsError('BAD_REQUEST', 'criteria.field is required');
  const cur = getExportSetup(scope.scopeType, scope.scopeKey);
  const doneStatus = lastDone.has(connKey(conn)) ? lastDone.get(connKey(conn)) : (cur && sameConn(cur, conn) ? cur.doneStatus : null);
  return upsertExportSetup({ ...scope, ...conn, trackerProject: project, trackerProjectName: text(body.projectName, 200) || project, issueType,
    issueTypeName: text(body.issueTypeName, 200) || issueType, labels: normalizeLabels(Array.isArray(body.labels) ? body.labels : ['worca']),
    priority, priorityName: priority ? (text(body.priorityName, 200) || priority) : null, criteria, doneStatus }, { by });
}

/** Everything a preview and an export share (D5–D8): the mode against the link, the setup, readiness with a reason, the
 *  connection, and the ticket or comment with its hash. No tracker call. */
function planExport(f, body = {}, { target = { ok: false }, now = new Date() } = {}) {
  const mode = body.mode;
  if (!MODES.includes(mode)) throw new RequirementsError('BAD_REQUEST', 'mode must be create, update, comment or new');
  const row = getExportLink(f.seq);
  const link = row && row.key ? row : null;
  if (mode === 'create' && link) throw new RequirementsError('CONFLICT', 'This feature has a ticket already. Export it again instead.');
  if (mode !== 'create' && !link) throw new RequirementsError('CONFLICT', 'This feature has no ticket yet.');
  const setup = getExportSetup(f.scopeType, f.scopeKey);
  if ((mode === 'create' || mode === 'new') && !setup) throw new RequirementsError('CONFLICT', 'Set up the export first.');
  const turns = listTurns(f.seq);
  const pending = f.status === 'your_turn' ? pendingRound(turns) : null;
  const r = readiness({ ...f, pending }, { turns, target, files: listAttachments('feature', f.seq) });
  const failing = r.checks.filter((c) => !c.ok).map((c) => c.key);
  const why = typeof body.reason === 'string' ? oneLine(body.reason) : '';
  if (failing.length) {
    if (!why) throw new RequirementsError('NOT_READY', 'This feature is not Ready. Give a reason to export it anyway.', { failing });
    if (why.length > REASON_MAX) throw new RequirementsError('BAD_REQUEST', `the reason must be at most ${REASON_MAX} characters`);
  }
  const reason = failing.length ? why : null;
  const conn = connOf(mode === 'update' || mode === 'comment' ? link : setup);
  const name = sourceName(conn);
  if (mode === 'comment') {
    // a ticket linked from another connection or project has no spec copy: a comment would list the whole spec as added
    if (!link.spec) throw new RequirementsError('CONFLICT', `Update ${link.key} once to give Worca a starting point for comments.`);
    const changes = exportChanges(link.spec, f.spec);
    if (!changes.length) throw new RequirementsError('CONFLICT', 'Nothing changed since the last export.');
    const comment = renderExportComment(f, changes, { since: exportDate(link.exportedAt, { year: false }), reason,
      after: sinceImport(link) ? 'import' : 'export' });
    // the hash covers the connection too: a setup moved to another site between preview and send is a stale preview
    return { mode, link, setup, conn, name, reason, changes, comment, ticket: null, sent: null, fields: null,
      previewHash: ticketHash({ mode, conn: connKey(conn), key: link.key, comment }) };
  }
  // update: the fields last sent (D7), except that a setup on the link's connection and tracker project gives the criteria,
  // the issue type and the priority, so Change the export setup can fix a refused update; create and new: the setup's. The
  // preview may change issue type, labels, priority (D6).
  const fromSetup = setup ? { projectName: setup.trackerProjectName, issueType: setup.issueType, issueTypeName: setup.issueTypeName, labels: setup.labels,
    priority: setup.priority, priorityName: setup.priorityName, criteria: setup.criteria } : {};
  // A6.1 D11: an imported ticket keeps its own issue type and priority, so a Bug stays a Bug
  const setupRules = mode === 'update' && link.origin !== 'import' && setup && sameConn(setup, link) && setup.trackerProject === link.trackerProject;
  const base = mode === 'update'
    ? { ...fromSetup, ...(link.fields || {}), project: link.trackerProject,
      ...(setupRules ? { issueType: setup.issueType, issueTypeName: setup.issueTypeName, priority: setup.priority, priorityName: setup.priorityName,
        criteria: setup.criteria } : {}) }
    : { ...fromSetup, project: setup.trackerProject };
  const issueType = text(body.issueType, 100) || base.issueType;
  const issueTypeName = text(body.issueType, 100) ? (text(body.issueTypeName, 200) || issueType) : (base.issueTypeName || issueType);
  const priority = body.priority === undefined ? (base.priority || null) : (text(body.priority, 100) || null);
  const priorityName = !priority ? null : body.priority === undefined ? (base.priorityName || priority) : (text(body.priorityName, 200) || priority);
  // a link with no fields last sent (linked from another site) takes the setup's defaults, but never a criteria field id
  // from the setup's other connection: its criteria stay in the description
  const foreign = mode === 'update' && !link.fields && !sameConn(setup, link);
  const criteria = !foreign && base.criteria && base.criteria.target === 'field' && base.criteria.field ? base.criteria : { target: 'description' };
  const ticket = buildTicket(f, { project: base.project, issueType, labels: Array.isArray(body.labels) ? body.labels : (base.labels || []), priority, criteria,
    reason, exportedOn: exportDate(now.toISOString()), mentionedFiles: mentionedFiles(f).map(oneLine), ownKey: mode === 'update' ? link.key : null });
  const fixed = exportLabel(f);
  const sent = { projectName: base.projectName || base.project, issueType, issueTypeName, labels: ticket.labels.filter((l) => l !== fixed), priority,
    priorityName, criteria };
  const fields = {
    conn, connection: connectionLabel(conn), project: { value: base.project, label: sent.projectName }, issueType: { value: issueType, label: issueTypeName },
    labels: ticket.labels, fixedLabel: fixed, priority: priority ? { value: priority, label: priorityName } : null,
    criteria: criteria.target === 'field' ? { target: 'field', name: criteria.name || criteria.field, items: ticket.criteria.items } : { target: 'description' },
    summary: f.title,
  };
  return { mode, link, setup, conn, name, reason, changes: link ? exportChanges(link.spec, f.spec) : [], comment: null, ticket, sent, fields,
    previewHash: ticketHash({ mode, conn: connKey(conn), key: link ? link.key : null, ticket }) };
}

/** The plan an export sends: the preview's, which its hash names. The ticket's export date is the preview's, today's or,
 *  for a preview made before midnight and sent after it, yesterday's; anything else is a stale preview. */
function sentPlan(f, body, { target, now }) {
  const plan = planExport(f, body, { target, now });
  const hash = typeof body.previewHash === 'string' ? body.previewHash : null;
  if (hash && hash === plan.previewHash) return plan;
  if (hash && plan.ticket) {
    const eve = new Date(now.getTime());
    eve.setDate(eve.getDate() - 1);
    const before = planExport(f, body, { target, now: eve });
    if (hash === before.previewHash) return before;
  }
  throw new RequirementsError('CONFLICT', STALE, { stale: true });
}

/** A6.1 D11: an imported link that no export has touched since. */
const sinceImport = (l) => !!l && l.origin === 'import' && !!l.createdAt && l.exportedAt === l.createdAt;
const linkDates = (l) => ({ key: l.key, madeOn: exportDate(l.createdAt, { year: false }), lastOn: exportDate(l.exportedAt, { year: false }),
  origin: l.origin || 'export', importedOn: l.origin === 'import' ? exportDate(l.createdAt, { year: false }) : null, sinceImport: sinceImport(l) });

/** POST …/export/preview (D6, D7, D9): the ticket or the comment exactly as it would be sent, its hash, what changed, and
 *  for a ticket the tracker's answer on it (edited, gone). No lock. */
export async function previewExport(seq, body = {}, { target } = {}, d = {}) {
  const f = requireFeature(seq);
  if (f.status === 'archived') throw new RequirementsError('CONFLICT', ARCHIVED);
  const plan = planExport(f, body, { target, now: nowOf(d) });
  let state = { edited: false, gone: false };
  if (plan.mode === 'update' || plan.mode === 'comment') {
    const s = await trackerCall(d, plan.name, plan.conn, 'ticketState', { key: plan.link.key });
    state = s && s.exists === false ? { edited: false, gone: true }
      : { gone: false, edited: !!(s && s.fingerprint && plan.link.fingerprint && s.fingerprint !== plan.link.fingerprint) };
  }
  return { mode: plan.mode, tracker: plan.name, key: plan.link ? plan.link.key : null, ticket: plan.ticket, comment: plan.comment,
    previewHash: plan.previewHash, changes: changeSummary(plan.changes), fields: plan.fields, link: plan.link ? linkDates(plan.link) : null, ...state };
}

/**
 * POST …/export (D6, D7, D9–D14). One export per feature at a time, taken before the first await; refused while a round or
 * look runs, while a start is in flight, and on an archived feature. The ticket or comment is rebuilt and must match the
 * preview's hash. A pending marker from an earlier create is looked for first: a ticket with the label, the marker and this
 * feature's footer is linked (an `export` turn `linked`) and the export goes on as an update of it. A create records its
 * marker before the call; any thrown failure keeps it (a lost answer), a refusal clears it. Nothing else is written on a
 * failure; a success writes the link and the turn in one transaction.
 */
export async function runExport(seq, body = {}, { by = null, target } = {}, d = {}) {
  const f = requireFeature(seq);
  if (f.status === 'archived') throw new RequirementsError('CONFLICT', ARCHIVED);
  if (isExporting(f.seq)) throw new RequirementsError('BUSY', ALREADY_EXPORTING);
  if (isBusy(f.seq)) throw new RequirementsError('BUSY', WORKING);
  if (isStarting(f.seq)) throw new RequirementsError('BUSY', STARTING_MESSAGE);
  markExporting(f.seq);
  try {
    const now = nowOf(d);
    const plan = sentPlan(f, body, { target, now });
    const label = exportLabel(f);
    const at = now.toISOString();
    const turn = (action, key, url) => appendTurn(f.seq, { kind: 'export',
      payload: { action, tracker: plan.name, key, url: url || null, at, ...(plan.reason ? { reason: plan.reason } : {}) } }, { by });
    let link = plan.link;
    let mode = plan.mode;
    let found = false;
    const row = getExportLink(f.seq);
    if (row && row.pendingMarker) {
      // D10: a first export's row holds its own connection; a pending new ticket was made through the setup's. (Accepted gap:
      // a New ticket whose answer was lost, then a setup changed to another connection, is looked for through the new one;
      // no match there means the marker goes and a ticket is made.)
      const where = row.key && plan.setup ? { conn: connOf(plan.setup), project: plan.setup.trackerProject } : { conn: connOf(row), project: row.trackerProject };
      const hit = await trackerCall(d, plan.name, where.conn, 'findTicket', { project: where.project, label, marker: row.pendingMarker });
      if (hit && typeof hit.key === 'string' && hit.key && hit.marker === row.pendingMarker && Array.isArray(hit.labels) && hit.labels.includes(label)
        && String(hit.lastLine || '').startsWith(`From Worca ${f.id} ·`)) {
        const madeAt = row.pendingAt || at;
        // The found ticket is linked, but nothing is sent to it unless the preview named it: a first export's lost ticket
        // made through another connection or tracker project than the setup's (the setup changed since), or a lost New
        // ticket found while the preview was an update of, or a comment on, the old ticket, is a stale preview.
        const elsewhere = !row.key && !(plan.setup && sameConn(plan.setup, row) && plan.setup.trackerProject === row.trackerProject);
        const notPreviewed = elsewhere || ((mode === 'update' || mode === 'comment') && hit.key !== plan.link.key);
        tx(() => {
          saveExportLink(f.seq, { ...where.conn, trackerProject: where.project, key: hit.key, url: webUrl(hit.url), createdAt: madeAt, exportedAt: madeAt,
            spec: row.key ? row.spec : null, fields: row.key ? row.fields : (elsewhere ? null : plan.sent), fingerprint: hit.fingerprint || null }, { by });
          turn('linked', hit.key, webUrl(hit.url));
        });
        if (notPreviewed) throw new RequirementsError('CONFLICT', STALE, { stale: true, linked: hit.key });
        link = getExportLink(f.seq);
        found = true;
        if (mode === 'create' || mode === 'new') mode = 'update';
      } else {
        // Nothing found yet while the marker is young: the tracker's search may lag the create, so the marker stays and
        // nothing is made; past the grace, a ticket that fails the checks, or a create this process saw the tracker refuse
        // (a CERTAIN_NO_TICKET kind for this very marker) is a definite no
        const age = now.getTime() - Date.parse(row.pendingAt || '');
        const failure = createFailures.get(f.seq);
        const certain = !!failure && failure.marker === row.pendingMarker && CERTAIN_NO_TICKET.has(failure.kind);
        if (!(hit && hit.key) && !certain && age >= 0 && age < PENDING_SEARCH_GRACE_MS) {
          throw new RequirementsError('BUSY', `Worca is still checking whether ${plan.name} made the ticket. Try again in a moment.`);
        }
        clearPendingExport(f.seq);
      }
    }
    if (mode === 'create' || mode === 'new') {
      const conn = connOf(plan.setup);
      const marker = mintMarker();
      setPendingExport(f.seq, { ...conn, trackerProject: plan.setup.trackerProject, marker }, { by });
      createFailures.delete(f.seq);
      let r;
      try {
        r = await trackerCall(d, plan.name, conn, 'createTicket', { ticket: { ...plan.ticket, marker } });   // a throw keeps the marker
      } catch (err) {
        createFailures.set(f.seq, { marker, kind: (err && err.data && err.data.kind) || 'plugin' });
        throw err;
      }
      if (r && r.refused) { clearPendingExport(f.seq); throw refusedError(r.refused); }
      if (!r || typeof r.key !== 'string' || !r.key) {
        createFailures.set(f.seq, { marker, kind: 'protocol' });
        throw new RequirementsError('TRACKER', reachSentence(plan.name, { message: 'it did not name the ticket it made' }), { kind: 'protocol' });
      }
      const action = mode === 'new' ? 'new' : 'created';
      tx(() => {
        saveExportLink(f.seq, { ...conn, trackerProject: plan.setup.trackerProject, key: r.key, url: webUrl(r.url), createdAt: at, exportedAt: at,
          spec: f.spec, fields: plan.sent, fingerprint: r.fingerprint || null }, { by });
        turn(action, r.key, webUrl(r.url));
      });
      return { action, key: r.key, url: webUrl(r.url) };
    }
    const conn = connOf(link);
    if (mode === 'update') {
      if (!found && body.force !== true) {
        const s = await trackerCall(d, plan.name, conn, 'ticketState', { key: link.key });
        if (s && s.exists === false) throw goneError(link.key, plan.name);
        if (s && s.fingerprint && link.fingerprint && s.fingerprint !== link.fingerprint) throw editedError(link.key, plan.name);
      }
      const r = await trackerCall(d, plan.name, conn, 'updateTicket', { key: link.key, ticket: plan.ticket });
      if (r && r.gone) throw goneError(link.key, plan.name);
      if (r && r.refused) throw refusedError(r.refused);
      const url = webUrl(r && r.url) || webUrl(link.url);
      tx(() => {
        // the description changed: a missing read-back (null) skips the edited check once, never compares with the old text
        saveExportLink(f.seq, { ...link, url, exportedAt: at, spec: f.spec, fields: plan.sent, fingerprint: (r && r.fingerprint) || null }, { by });
        turn('updated', link.key, url);
      });
      return { action: 'updated', key: link.key, url };
    }
    // A comment has no duplicate guard (design accepted): a comment whose answer was lost (a timeout), then Try again, can
    // post the same comment twice. Comments carry no marker and cannot be found again the way a created ticket is.
    const r = await trackerCall(d, plan.name, conn, 'commentTicket', { key: link.key, body: plan.comment });
    if (r && r.gone) throw goneError(link.key, plan.name);
    tx(() => {
      saveExportLink(f.seq, { ...link, exportedAt: at, spec: f.spec }, { by });   // a comment leaves the fingerprint as it was (D9)
      turn('commented', link.key, link.url);
    });
    return { action: 'commented', key: link.key, url: link.url };
  } finally {
    unmarkExporting(f.seq);
  }
}

/** Forget the link (D12): the link row goes (key, URL, spec copy, fingerprint, pending marker), an `export` turn `forgot`;
 *  nothing is sent. A run already started keeps reporting to the ticket its pipeline row names. */
export function forgetLink(seq, { by = null } = {}) {
  const f = requireFeature(seq);
  if (isExporting(f.seq)) throw new RequirementsError('BUSY', ALREADY_EXPORTING);
  const row = getExportLink(f.seq);
  if (!row || !row.key) throw new RequirementsError('CONFLICT', 'This feature has no ticket yet.');
  tx(() => {
    deleteExportLink(f.seq);
    appendTurn(f.seq, { kind: 'export', payload: { action: 'forgot', tracker: sourceName(connOf(row)), key: row.key, url: row.url || null,
      at: new Date().toISOString() } }, { by });
  });
}

/** D1: what the menu names: the setup's tracker, else the scope's bound tracker, else the only one; several and none
 *  bound: a tracker without a name; none: null ("Connect a tracker…"). */
function viewTracker(f, setup, trackers) {
  if (!trackers.length) return null;
  const of = (c) => trackers.find((t) => t.plugin === c.plugin && t.sourceId === c.sourceId);
  if (setup && of(setup)) return { name: of(setup).name };
  const bound = bindingsOf(f).map(of).find(Boolean);
  if (bound) return { name: bound.name };
  return { name: trackers.length === 1 ? trackers[0].name : null };
}

/** The feature view's `export` (§6). Never throws: a failure is "no tracker". */
export async function exportView(f, turns = [], d = {}) {
  try {
    const trackers = await exportTrackers(d);
    const setup = getExportSetup(f.scopeType, f.scopeKey);
    const row = getExportLink(f.seq);
    const link = row && row.key ? row : null;
    const tracker = viewTracker(f, setup, trackers);
    return {
      tracker, canExport: !!tracker && f.status !== 'archived',
      hasSetup: !!setup && trackers.some((t) => t.plugin === setup.plugin && t.sourceId === setup.sourceId),
      link: link ? { key: link.key, url: webUrl(link.url), createdAt: link.createdAt, exportedAt: link.exportedAt, ...linkDates(link), tracker: sourceName(connOf(link)) } : null,
      exporting: isExporting(f.seq),
      // Report back moves the ticket only to the status its own connection names (D15)
      doneStatus: link && setup && sameConn(setup, link) ? setup.doneStatus || null : null,
      history: (turns || []).filter((t) => t && t.kind === 'export' && t.payload).map((t) => ({ action: t.payload.action, tracker: t.payload.tracker || null,
        key: t.payload.key || null, url: webUrl(t.payload.url), reason: t.payload.reason || null,
        linked: t.payload.action === 'imported' ? t.payload.linked !== false : null, linkedTo: t.payload.linkedTo || null,   // A6.1: the import's entry
        when: exportTime(t.payload.at || t.at),
        by: actorLabel(t.by) || null }))   // 'local' (a single-user install) names nobody, as board 28
        .reverse(),
    };
  } catch (err) {
    console.error(`requirements: the export view of feature ${f && f.seq} failed:`, err && err.message ? err.message : err);
    return { tracker: null, canExport: false, hasSetup: false, link: null, exporting: false, doneStatus: null, history: [] };
  }
}
