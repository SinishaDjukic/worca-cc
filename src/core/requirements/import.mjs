// src/core/requirements/import.mjs
// Start a feature from a tracker ticket (plans/requirements-a61-design.md): the sources that can import, where the picker starts,
// the projects and the search, the preview (D5–D9) and the create (D10–D12, below). The Requirements code knows only "a source that
// can import" (D2): every call runs here, server-side, through callSource with the connection's profile (D15). Nothing is written to
// the tracker. A failure is A6's reach sentence (design U1: Import and Export read alike); the log keeps its first line only.
import { createHash } from 'node:crypto';
import { callSource as shimCallSource } from '../plugin-shim.mjs';
import { tx } from '../db.mjs';
import { redactAskText } from '../ask/redact.mjs';
import { RequirementsError, LIMITS, clip } from './spec.mjs';
import { getExportSetup, linkByTicket, createFeature, saveExportLink, appendTurn, listAttachments } from './store.mjs';
import { trackersWith, defaultConnection, connectionLabel, sameConn, reachSentence, firstLine } from './export.mjs';
import { exportDate } from './ticket.mjs';
import { IMPORT_LIMITS, processTicket, pickDefaults, commentsFileName, commentsMarkdown } from './ticket-import.mjs';
import { REQ_ATTACH_LIMITS, checkNewFiles, displayName } from './attachments.mjs';
import { addAttachments } from './attachment-job.mjs';
import { insertDownloadRow, queueDownloads } from './attachment-fetch.mjs';

/** D17: importOptions, searchTickets and importTicket (which may page through comments). */
export const IMPORT_TIMEOUT_MS = 60_000;

const callOf = (d) => (d && typeof d.callSource === 'function' ? d.callSource : shimCallSource);
const text = (v, max) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
/** The longest search cursor taken back from the page; a longer one from the tracker is not offered (final review M3). */
const CURSOR_MAX = 500;
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
  const cursor = text(body.cursor, CURSOR_MAX);
  const r = (await trackerCall(d, t.name, conn, 'searchTickets', { ...(project ? { project } : {}), ...(search ? { search } : {}), ...(cursor ? { cursor } : {}) })) || {};
  const tickets = (Array.isArray(r.tickets) ? r.tickets : []).filter((x) => x && typeof x.key === 'string' && KEY_RE.test(x.key))
    .slice(0, IMPORT_LIMITS.page).map((x) => {
      const linked = linkByTicket({ ...conn, key: x.key });
      return { key: x.key.toUpperCase(), title: oneLine(x.title).slice(0, 200) || x.key.toUpperCase(), url: httpUrl(x.url), type: x.type ? oneLine(x.type) : null,
        status: x.status ? oneLine(x.status) : null, updatedOn: exportDate(x.updatedAt, { year: false }) || null,
        linkedTo: linked ? { id: linked.id, title: linked.title } : null };
    });
  // A cursor the next search would clip is dropped, so Show more hides instead of failing (M3)
  return { tickets, ...(typeof r.cursor === 'string' && r.cursor && r.cursor.length <= CURSOR_MAX ? { cursor: r.cursor } : {}) };
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

// ---- the create (D10–D12): the ticket read again, then the feature at once; downloads run afterwards ----

/** A generated text file (the comments, the long description): A8's text rules hold for it as for an upload (plan review S9):
 *  no NUL (it would be inlined into a prompt) and well-formed UTF-8 (a lone surrogate from the tracker becomes U+FFFD). */
const textFile = (name, body) => {
  const text = String(body).replace(/\u0000/g, '').toWellFormed();
  const data = Buffer.from(text, 'utf8');
  return { name, kind: 'text', mime: 'text/markdown', data, text, bytes: data.length, sha256: createHash('sha256').update(data).digest('hex') };
};
const ids = (v) => [...new Set((Array.isArray(v) ? v : []).map((x) => String(x)).slice(0, 200))];

/** D10: the second read. The form's title, description and criteria are the product owner's; the comments and attachments are taken
 *  by id from this fresh read (one no longer there is named in notOnTicket). A8's caps for the New feature form count the form's own
 *  files, the generated ones and the downloads (D9, on the tracker's sizes). Writes nothing. The read keeps the newest 50 comments
 *  (D8), so a comment the product owner picked that newer comments pushed out between the preview and Start is reported as "no
 *  longer on SHOP-124" too (rare; accepted, plan review Minor 6). */
export async function prepareImport(scope, ft, { diskFiles = [] } = {}, d = {}) {
  if (!ft || typeof ft !== 'object' || Array.isArray(ft)) throw new RequirementsError('BAD_REQUEST', 'fromTicket must be an object');
  const { conn, t } = await sourceFor(ft, d);
  const key = keyOf(ft.key);
  const raw = await readTicket(d, t, conn, key, scope);
  const p = processTicket(raw, { tracker: t.name });
  const wantComments = ids(ft.comments);
  const wantFiles = ids(ft.attachments);
  const comments = p.comments.filter((c) => wantComments.includes(c.id));
  const downloads = p.attachments.filter((a) => wantFiles.includes(a.id) && !a.refused);
  const notOnTicket = { key: p.key, comments: wantComments.filter((id) => !p.comments.some((c) => c.id === id)),
    attachments: wantFiles.filter((id) => !downloads.some((a) => a.id === id)).map((id) => ({ id, reason: (p.attachments.find((a) => a.id === id) || {}).refused || null })) };
  const generated = [
    ...(comments.length ? [textFile(commentsFileName(p.key), commentsMarkdown(p.key, comments))] : []),
    ...(ft.descriptionFile === true && p.descriptionFile ? [textFile(p.descriptionFile.name, p.descriptionFile.text)] : []),
  ];
  checkNewFiles('feature', [], [...generated, ...diskFiles]);   // A8: names, duplicates, 10 files
  const all = [...generated, ...diskFiles, ...downloads];
  if (all.length > REQ_ATTACH_LIMITS.files) {
    throw new RequirementsError('BAD_REQUEST', `${displayName(all[REQ_ATTACH_LIMITS.files].name)} was not added: a feature takes up to ${REQ_ATTACH_LIMITS.files} files.`);
  }
  let total = 0;
  for (const x of all) {
    total += Number(x.bytes) || 0;
    if (total > REQ_ATTACH_LIMITS.requestBytes) {
      throw new RequirementsError('BAD_REQUEST', `${displayName(x.name)} was not added: a new feature's files can be up to 100 MB in all; add more on the feature page.`);
    }
  }
  // redacted before clipped (the constraint; final review M4): a secret cut at the limit would no longer match the redactor
  const criteria = (Array.isArray(ft.criteria) ? ft.criteria : []).slice(0, LIMITS.items)
    .map((x) => ({ text: clip(typeof x === 'string' ? redactAskText(x) : x, LIMITS.item), source: p.key }));
  return { conn, tracker: t.name, key: p.key, url: p.url, meta: p.meta || {}, fingerprint: p.fingerprint, criteriaField: p.criteria.from === 'field' ? p.criteria.field : null,
    criteria, comments: comments.length, generated, diskFiles, downloads, notOnTicket };
}

/** D11: the link's fields, from the ticket: its own issue type and priority (an Update keeps them), the label, where criteria are. */
const importFields = (plan) => ({
  projectName: plan.meta.projectName || plan.meta.project || null, issueType: plan.meta.type ? plan.meta.type.id : null,
  issueTypeName: plan.meta.type ? plan.meta.type.name : null, priority: plan.meta.priority ? plan.meta.priority.id : null,
  priorityName: plan.meta.priority ? plan.meta.priority.name : null, labels: ['worca'],
  criteria: plan.criteriaField ? { target: 'field', field: plan.criteriaField.id, name: plan.criteriaField.name } : { target: 'description' },
});

/** D10–D12: the feature, its criteria, A6's link (unless another feature follows the ticket) and the `imported` turn in one transaction;
 *  then the generated files (read at once), the downloading rows and their queue, then the form's own files. Nothing awaits a download.
 *  A file that cannot be stored never undoes the feature (A8): its name goes to filesNotStored. Accepted (plan review Minor 5): the
 *  turn's `comments` count (D14's "its comments are in …") is written with the feature, before the comments file is stored, so in the
 *  rare case that file lands in filesNotStored the thread line still names it and the round's <attachments> simply lacks it. */
export function createImported(scope, { title, description } = {}, plan, { by = null } = {}, d = {}) {
  const linked = linkByTicket({ ...plan.conn, key: plan.key });   // D12: one ticket follows one feature
  const at = new Date().toISOString();
  const f = tx(() => {
    const made = createFeature({ ...scope, title, description, criteria: plan.criteria }, { by });
    if (!linked) {
      saveExportLink(made.seq, { ...plan.conn, trackerProject: plan.meta.project || plan.key.split('-')[0], key: plan.key, url: plan.url, createdAt: at,
        exportedAt: at, spec: made.spec, fields: importFields(plan), fingerprint: plan.fingerprint, origin: 'import' }, { by });
    }
    appendTurn(made.seq, { kind: 'export', payload: { action: 'imported', tracker: plan.tracker, key: plan.key, url: plan.url, at, linked: !linked,
      ...(linked ? { linkedTo: linked.id } : {}), criteria: made.spec.criteria.map((c) => c.id), comments: plan.comments,
      files: plan.downloads.map((a) => a.name) } }, { by });
    return made;
  });
  const owner = { type: 'feature', id: f.seq };
  const from = { tracker: plan.tracker, key: plan.key };
  const filesNotStored = [];
  const lost = (names, err) => {
    console.error(`requirements: storing the files of new feature ${f.seq} failed:`, err && err.message ? err.message : err);
    const have = new Set(listAttachments('feature', f.seq).map((r) => r.name));
    filesNotStored.push(...names.filter((n) => !have.has(n)));
  };
  const store = (files, opts) => {
    if (!files.length) return;
    try { addAttachments(owner, files, { by, ...opts }, d); } catch (err) { lost(files.map((x) => x.name), err); }
  };
  store(plan.generated, { from });   // the comments (and description) file first, as board 35 lists them
  let rows = [];
  try {
    rows = tx(() => plan.downloads.map((a) => insertDownloadRow(owner, { conn: plan.conn, tracker: plan.tracker, key: plan.key, id: a.id, name: a.name,
      bytes: a.bytes, from }, { by })));
  } catch (err) { lost(plan.downloads.map((a) => a.name), err); }
  queueDownloads(owner, rows.map((r) => r.id), { by }, d);
  store(plan.diskFiles, {});
  return { seq: f.seq, filesNotStored, notOnTicket: plan.notOnTicket };
}
