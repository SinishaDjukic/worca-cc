// src/core/requirements/import.mjs
// Start a feature from a tracker ticket (plans/requirements-a61-design.md): the sources that can import, where the picker starts,
// the projects and the search, the preview (D5–D9) and the create (D10–D12, below). The Requirements code knows only "a source that
// can import" (D2): every call runs here, server-side, through callSource with the connection's profile (D15). Nothing is written to
// the tracker. A failure is A6's reach sentence (design U1: Import and Export read alike); the log keeps its first line only.
import { callSource as shimCallSource } from '../plugin-shim.mjs';
import { RequirementsError } from './spec.mjs';
import { getExportSetup, linkByTicket } from './store.mjs';
import { trackersWith, defaultConnection, connectionLabel, sameConn, reachSentence, firstLine } from './export.mjs';
import { exportDate } from './ticket.mjs';
import { IMPORT_LIMITS, processTicket, pickDefaults } from './ticket-import.mjs';

/** D17: importOptions, searchTickets and importTicket (which may page through comments). */
export const IMPORT_TIMEOUT_MS = 60_000;

const callOf = (d) => (d && typeof d.callSource === 'function' ? d.callSource : shimCallSource);
const text = (v, max) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const oneLine = (v) => String(v ?? '').replace(/\s+/g, ' ').trim();
const httpUrl = (u) => (/^https?:\/\//i.test(String(u || '')) ? String(u) : null);
const KEY_RE = /^[A-Z][A-Z0-9_]*-\d+$/i;

/** D2: the sources that can import (A6's probe, its `import` answer). */
export const importSources = (d = {}) => trackersWith('import', d);

/** One import op through the connection, in IMPORT_TIMEOUT_MS. Any failure is A6's sentence (D16, U1: reachSentence turns a
 *  message that is not product copy into a fixed phrase); the log keeps the first line only (M3: never a plugin's stderr). */
async function trackerCall(d, name, conn, op, args) {
  try {
    return await callOf(d)({ plugin: conn.plugin, sourceId: conn.sourceId, profile: conn.profile || undefined, op, args, timeoutMs: IMPORT_TIMEOUT_MS });
  } catch (err) {
    const kind = (err && err.kind) || 'plugin';
    console.error(`requirements: import op ${op} via ${conn.plugin}/${conn.sourceId} failed (${kind}):`, firstLine(err));
    if (kind === 'unimplemented') throw new RequirementsError('TRACKER', `${name || 'The tracker'} cannot import any more.`, { kind: 'unimplemented' });
    throw new RequirementsError('TRACKER', reachSentence(name, { kind, message: err && err.message }), { kind });
  }
}

/** The connection a request names when it is one of an importing source's (else BAD_REQUEST), and that source. */
export async function sourceFor(body, d) {
  const conn = { plugin: text(body.plugin, 64), sourceId: text(body.sourceId, 64), profile: text(body.profile, 64) || null };
  const t = (await importSources(d)).find((x) => x.plugin === conn.plugin && x.sourceId === conn.sourceId);
  if (!t || !t.profiles.some((p) => (p.id || null) === conn.profile)) throw new RequirementsError('BAD_REQUEST', 'Choose a connection from the list.');
  return { conn, t };
}

/** D3: where the picker starts: the export setup's connection and tracker project when that connection can import, else A6's
 *  default connection and All projects. */
export function importDefaults(scope, sources, { memberKeys = [] } = {}) {
  if (!sources.length) return { defaultConnection: null, defaultProject: null };
  const setup = getExportSetup(scope.scopeType, scope.scopeKey);
  const usable = !!setup && sources.some((s) => s.plugin === setup.plugin && s.sourceId === setup.sourceId
    && s.profiles.some((p) => (p.id || null) === (setup.profile || null)));
  if (usable) return { defaultConnection: { plugin: setup.plugin, sourceId: setup.sourceId, profile: setup.profile || null }, defaultProject: setup.trackerProject || null };
  return { defaultConnection: defaultConnection(scope, sources, { memberKeys }), defaultProject: null };
}

/** GET …/import/:scopeType/:scopeKey (§6): no tracker call but the cached probes. */
export async function importView(scope, { memberKeys = [] } = {}, d = {}) {
  const sources = await importSources(d);
  return { sources: sources.map((s) => ({ plugin: s.plugin, sourceId: s.sourceId, name: s.name, profiles: s.profiles })),
    ...importDefaults(scope, sources, { memberKeys }) };
}

const options = (v) => (Array.isArray(v) ? v.filter((x) => x && x.value != null).map((x) => ({ value: String(x.value), label: String(x.label ?? x.value) })) : []);

/** POST …/options (D3): the connection's projects. */
export async function importOptions(scope, body = {}, d = {}) {
  const { conn, t } = await sourceFor(body, d);
  const r = (await trackerCall(d, t.name, conn, 'importOptions', {})) || {};
  return { projects: options(r.projects) };
}

/** POST …/search (D4, D12): a page of tickets through the connection, each with the feature of this install it is linked to. */
export async function searchTickets(scope, body = {}, d = {}) {
  const { conn, t } = await sourceFor(body, d);
  const project = text(body.project, 100);
  const search = text(body.search, 200);
  const cursor = text(body.cursor, 500);
  const r = (await trackerCall(d, t.name, conn, 'searchTickets', { ...(project ? { project } : {}), ...(search ? { search } : {}), ...(cursor ? { cursor } : {}) })) || {};
  const tickets = (Array.isArray(r.tickets) ? r.tickets : []).filter((x) => x && typeof x.key === 'string' && KEY_RE.test(x.key))
    .slice(0, IMPORT_LIMITS.page).map((x) => {
      const linked = linkByTicket({ ...conn, key: x.key });
      return { key: x.key.toUpperCase(), title: oneLine(x.title).slice(0, 200) || x.key.toUpperCase(), url: httpUrl(x.url), type: x.type ? oneLine(x.type) : null,
        status: x.status ? oneLine(x.status) : null, updatedOn: exportDate(x.updatedAt, { year: false }) || null,
        linkedTo: linked ? { id: linked.id, title: linked.title } : null };
    });
  return { tickets, ...(typeof r.cursor === 'string' && r.cursor ? { cursor: r.cursor } : {}) };
}

export function keyOf(v) {
  const k = text(v, 64);
  if (!KEY_RE.test(k)) throw new RequirementsError('BAD_REQUEST', 'key must be a ticket key such as SHOP-124');
  return k.toUpperCase();
}
const formOf = (v) => ({ count: Math.max(0, Math.floor(Number(v && v.count) || 0)), bytes: Math.max(0, Number(v && v.bytes) || 0) });

/** importTicket through the connection, with the export setup's criteria field when that setup is on the same connection (D7).
 *  A ticket the connection cannot see is NOT_FOUND with `gone` (D16). */
export async function readTicket(d, t, conn, key, scope) {
  const setup = getExportSetup(scope.scopeType, scope.scopeKey);
  const field = setup && sameConn(setup, conn) && setup.criteria && setup.criteria.target === 'field' ? setup.criteria.field : null;
  const r = await trackerCall(d, t.name, conn, 'importTicket', { key, ...(field ? { criteriaField: field } : {}) });
  if (!r || r.gone === true) throw new RequirementsError('NOT_FOUND', `${key} was not found in ${t.name}, or this connection cannot see it.`, { gone: true });
  if (typeof r.key !== 'string' || !KEY_RE.test(r.key)) {
    console.error(`requirements: importTicket for ${key} answered without a ticket key`);
    throw new RequirementsError('TRACKER', reachSentence(t.name, { kind: 'protocol' }), { kind: 'protocol' });
  }
  return { ...r, key: r.key.toUpperCase(), url: httpUrl(r.url) };
}

/** POST …/preview (D5–D9, D12): what the new feature would take, with the default ticks; nothing is stored or sent. */
export async function previewImport(scope, body = {}, d = {}) {
  const { conn, t } = await sourceFor(body, d);
  const key = keyOf(body.key);
  const p = pickDefaults(processTicket(await readTicket(d, t, conn, key, scope), { tracker: t.name }), formOf(body.formFiles));
  const linked = linkByTicket({ ...conn, key: p.key });
  const { fingerprint: _fp, ...shown } = p;
  return { ...shown, descriptionFile: p.descriptionFile ? { name: p.descriptionFile.name, bytes: p.descriptionFile.bytes } : null,
    connection: connectionLabel(conn), linkedTo: linked ? { id: linked.id, title: linked.title } : null };
}
