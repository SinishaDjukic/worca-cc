// src/shared/workspace-map/schema.mjs
// The closed vocabularies of the workspace map and the checkers for the three agent-written
// documents (survey, usage, synthesis) plus the stored overrides. A checker never throws and
// never gives up on a document: it REMOVES every invalid item, keeps the valid skeleton, and
// names each removal as "path: message" — so the agent's self-check (check-cli) and the
// downstream script (which keeps going with what is valid) read the same verdicts. The synthesis
// it keeps is REDACTED: it is stored with the map (map_json) and shown in the UI.

import { LIMITS, MAP_VERSION } from './limits.mjs';
import { redactSecrets } from './redact.mjs';

export const KINDS = Object.freeze(['http', 'grpc', 'graphql', 'topic', 'pkg', 'db', 'service', 'other']);
export const KIND_LABELS = Object.freeze({ http: 'REST API', grpc: 'gRPC', graphql: 'GraphQL',
  topic: 'message/queue', pkg: 'build dep', db: 'shared DB', service: 'service call', other: 'other' });
export const DIRS = Object.freeze(['provides', 'consumes']);
export const CONFIDENCE = Object.freeze(['exact', 'verified', 'heuristic', 'inferred']); // strongest first
export const COVERAGE_LEVELS = Object.freeze(['rich', 'partial', 'none']);
export const NEEDS = Object.freeze(['role', 'aliases', 'provides', 'consumes', 'unresolved']);
export const EDGE_STATES = Object.freeze(['auto', 'confirmed', 'rejected', 'manual', 'missing', 'stale']);

const SURVEY_STATUSES = Object.freeze(['investigated', 'failed', 'skipped']);
const USAGE_STATUSES = Object.freeze(['investigated', 'failed']);
const OVERRIDE_STATES = Object.freeze(['confirmed', 'rejected']);
const KEY_MAX = 300;
const TARGET_MAX = 200;
const ALIAS_MAX = 100;
const NOTES_MAX = 2000;
const OVERVIEW_MAX = 1500;
const NOTE_MAX = 400;
const NOTES_COUNT_MAX = 20;
const DISPLAY_MAX = 300;

/** 0 = strongest; unknown → 99 */
export function confidenceRank(c) {
  const i = CONFIDENCE.indexOf(c);
  return i < 0 ? 99 : i;
}

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const isStr = (v) => typeof v === 'string';
const nonEmpty = (v) => isStr(v) && v.trim().length > 0;
const keySet = (keys) => (keys == null ? null : new Set(keys instanceof Set ? keys : Array.isArray(keys) ? keys : []));

/** @returns {string|null} why `file` is not a member-relative POSIX path */
function fileError(file) {
  if (!nonEmpty(file)) return 'file must be a non-empty string';
  if (file.includes('\\')) return 'file must use / separators';
  if (file.startsWith('/') || /^[A-Za-z]:/.test(file) || file.includes('\0')) return 'file must be member-relative';
  if (file.split('/').some((seg) => seg === '..')) return 'file must be member-relative';
  return null;
}

/** file + line + match: the evidence triple every agent-written fact carries (D4). */
function evidenceError(f) {
  const fe = fileError(f.file);
  if (fe) return fe;
  if (!Number.isInteger(f.line) || f.line < 1) return 'line must be an integer >= 1';
  if (!nonEmpty(f.match)) return 'match must be a non-empty string';
  if (f.match.length > LIMITS.MATCH_MAX) return `match must be at most ${LIMITS.MATCH_MAX} chars`;
  if (/[\r\n]/.test(f.match)) return 'match must be a single line';
  return null;
}

function optStrError(f, field, max) {
  if (f[field] === undefined || f[field] === null) return null;
  if (!isStr(f[field])) return `${field} must be a string`;
  if (f[field].length > max) return `${field} must be at most ${max} chars`;
  return null;
}

/** @returns {string|null} error text for one LlmFact ({kind,key,file,line,match,detail?,label?,target?}) or null */
export function checkLlmFact(f) {
  if (!isObj(f)) return 'fact must be an object';
  if (!KINDS.includes(f.kind)) return `kind must be one of ${KINDS.join(', ')}`;
  if (!nonEmpty(f.key)) return 'key must be a non-empty string';
  if (f.key.length > KEY_MAX) return `key must be at most ${KEY_MAX} chars`;
  return evidenceError(f)
    || optStrError(f, 'detail', LIMITS.DETAIL_MAX)
    || optStrError(f, 'label', LIMITS.LABEL_MAX)
    || optStrError(f, 'target', TARGET_MAX);
}

function cleanLlmFact(f) {
  const out = { kind: f.kind, key: f.key.trim(), file: f.file, line: f.line, match: f.match };
  for (const k of ['detail', 'label', 'target']) if (nonEmpty(f[k])) out[k] = f[k].trim();
  return out;
}

/** Walks one array field: keeps the items `check` accepts, reports the rest. */
function keepValid(list, path, errors, check, clean) {
  if (list === undefined || list === null) return [];
  if (!Array.isArray(list)) { errors.push(`${path}: must be an array`); return []; }
  const out = [];
  list.forEach((item, i) => {
    const err = check(item);
    if (err) errors.push(`${path}[${i}]: ${err}`);
    else out.push(clean(item));
  });
  return out;
}

function docErrors(doc, errors) {
  if (!isObj(doc)) { errors.push('doc: must be a JSON object'); return false; }
  if (doc.version !== MAP_VERSION) errors.push(`version: must be ${MAP_VERSION}`);
  return true;
}

function membersOf(doc, errors) {
  if (!isObj(doc.members)) { errors.push('members: must be an object keyed by member key'); return []; }
  // JSON.parse makes '__proto__' an own key; assigning it would re-parent value.members instead.
  return Object.entries(doc.members).filter(([key]) => key !== '__proto__' || !errors.push('members.__proto__: unknown member'));
}

const result = (errors, value) => ({ ok: errors.length === 0, errors, value });

/** A checker message as the scripts persist it (catalog.rejected, map.errors; D21). The agent-written
 *  value a message echoes after "unknown entry" / "unknown member" is dropped — the path already
 *  names the item — and the rest, whose path may still quote an agent-written member key, is
 *  redacted and clipped to 300 chars. The checker CLI keeps printing the full message to the agent. */
export function storedCheckError(message) {
  return redactSecrets(String(message ?? '').replace(/: unknown (entry|member) [\s\S]*$/, ': unknown $1')).slice(0, 300);
}

/** spec §5.4 */
export function checkSurvey(doc, { memberKeys } = {}) {
  const errors = [];
  const value = { version: MAP_VERSION, members: {} };
  if (!docErrors(doc, errors)) return result(errors, value);
  const known = keySet(memberKeys);
  for (const [key, m] of membersOf(doc, errors)) {
    const at = `members.${key}`;
    if (known && !known.has(key)) { errors.push(`${at}: unknown member`); continue; }
    if (!isObj(m)) { errors.push(`${at}: must be an object`); continue; }
    if (!SURVEY_STATUSES.includes(m.status)) { errors.push(`${at}.status: must be one of ${SURVEY_STATUSES.join(', ')}`); continue; }
    const out = { status: m.status, role: null, aliases: [], provides: [], consumes: [], notes: '' };
    if (m.role !== undefined && m.role !== null) {
      if (!isStr(m.role) || m.role.length > LIMITS.ROLE_MAX) errors.push(`${at}.role: must be a string of at most ${LIMITS.ROLE_MAX} chars`);
      else if (m.role.trim()) out.role = m.role.trim();
    }
    out.aliases = keepValid(m.aliases, `${at}.aliases`, errors,
      (a) => (nonEmpty(a) && a.length <= ALIAS_MAX && !/\s/.test(a.trim()) ? null : `alias must be a non-empty word of at most ${ALIAS_MAX} chars`),
      (a) => a.trim());
    out.provides = keepValid(m.provides, `${at}.provides`, errors, checkLlmFact, cleanLlmFact);
    out.consumes = keepValid(m.consumes, `${at}.consumes`, errors, checkLlmFact, cleanLlmFact);
    if (m.notes !== undefined && m.notes !== null) {
      if (!isStr(m.notes) || m.notes.length > NOTES_MAX) errors.push(`${at}.notes: must be a string of at most ${NOTES_MAX} chars`);
      else out.notes = m.notes;
    }
    value.members[key] = out;
  }
  return result(errors, value);
}

/** spec §5.6; entryIds: Set|string[] */
export function checkUsage(doc, { memberKeys, entryIds } = {}) {
  const errors = [];
  const value = { version: MAP_VERSION, members: {} };
  if (!docErrors(doc, errors)) return result(errors, value);
  const known = keySet(memberKeys);
  const entries = keySet(entryIds);
  const entryError = (e) => (!nonEmpty(e) ? 'entry must be a catalog entry id' : entries && !entries.has(e) ? `unknown entry ${e}` : null);
  for (const [key, m] of membersOf(doc, errors)) {
    const at = `members.${key}`;
    if (known && !known.has(key)) { errors.push(`${at}: unknown member`); continue; }
    if (!isObj(m)) { errors.push(`${at}: must be an object`); continue; }
    if (!USAGE_STATUSES.includes(m.status)) { errors.push(`${at}.status: must be one of ${USAGE_STATUSES.join(', ')}`); continue; }
    const uses = keepValid(m.uses, `${at}.uses`, errors,
      (u) => (!isObj(u) ? 'use must be an object' : entryError(u.entry) || evidenceError(u) || optStrError(u, 'detail', LIMITS.DETAIL_MAX)),
      (u) => ({ entry: u.entry, file: u.file, line: u.line, match: u.match, ...(nonEmpty(u.detail) ? { detail: u.detail.trim() } : {}) }));
    const rejected = keepValid(m.rejected, `${at}.rejected`, errors,
      (r) => {
        if (!isObj(r)) return 'rejection must be an object';
        const e = entryError(r.entry) || fileError(r.file);
        if (e) return e;
        if (!Number.isInteger(r.line) || r.line < 1) return 'line must be an integer >= 1';
        if (!nonEmpty(r.reason) || r.reason.length > LIMITS.DETAIL_MAX) return `reason must be a non-empty string of at most ${LIMITS.DETAIL_MAX} chars`;
        return null;
      },
      (r) => ({ entry: r.entry, file: r.file, line: r.line, reason: r.reason.trim() }));
    const other = keepValid(m.other, `${at}.other`, errors,
      (o) => {
        if (!isObj(o)) return 'relation must be an object';
        if (!nonEmpty(o.to)) return 'to must be a member key';
        if (known && !known.has(o.to)) return `unknown member ${o.to}`;
        if (o.to === key) return 'to must be another member';
        return checkLlmFact(o);
      },
      (o) => ({ to: o.to, ...cleanLlmFact(o) }));
    value.members[key] = { status: m.status, uses, rejected, other };
  }
  return result(errors, value);
}

/** `s` cut to at most `n` chars, with no trailing whitespace and no lone high surrogate at its end. */
function cutKept(s, n) {
  let t = s.slice(0, n);
  while (t) {
    const c = t.charCodeAt(t.length - 1);
    if (!(c >= 0xd800 && c <= 0xdbff) && t[t.length - 1].trim()) break;
    t = t.slice(0, -1);
  }
  return t;
}

/** A redaction can GROW a kept value past its limit (`secret: ab` -> `secret: ***`), and the cut can leave text the
 *  redactor reads anew (`token=https://` cut to `token=https:/` -> `token=***`), and one pass redacts one token of a
 *  glued chain (`npm_…npm_…`, at most 50 in 2000 chars): cut, re-redacted and cut again until the CUT is stable — a
 *  re-grown tail (`token=*` -> `token=***` -> `token=*`) is — so a re-check returns the same value. */
function clipKept(s, n) {
  let t = cutKept(s, n);
  for (let i = 0; i < 256; i += 1) {
    const next = cutKept(redactSecrets(t), n);
    if (next === t) return t;
    t = next;
  }
  return t;
}

/** The kept text of an agent-written string; '' when only lone surrogates and spaces were left, which the caller
 *  rejects as empty (a stored '' fails the re-check render runs). */
const kept = (s, n) => clipKept(redactSecrets(s.trim()), n);

/** spec §5.8. The kept overview, roles, notes and order notes are redactSecrets'd (D21: the
 *  synthesis is persisted with the map). */
export function checkSynthesis(doc, { memberKeys } = {}) {
  const errors = [];
  const value = { version: MAP_VERSION, overview: '', roles: {}, coordination: [], orderNotes: '' };
  if (!docErrors(doc, errors)) return result(errors, value);
  const known = keySet(memberKeys);
  const overview = nonEmpty(doc.overview) && doc.overview.length <= OVERVIEW_MAX ? kept(doc.overview, OVERVIEW_MAX) : '';
  if (!overview) errors.push(`overview: must be a non-empty string of at most ${OVERVIEW_MAX} chars`);
  else value.overview = overview;
  if (doc.roles !== undefined && doc.roles !== null) {
    if (!isObj(doc.roles)) errors.push('roles: must be an object keyed by member key');
    else for (const [key, role] of Object.entries(doc.roles)) {
      const r = known && !known.has(key) ? null : nonEmpty(role) && role.length <= LIMITS.ROLE_MAX ? kept(role, LIMITS.ROLE_MAX) : '';
      if (r === null) errors.push(`roles.${key}: unknown member`);
      else if (!r) errors.push(`roles.${key}: must be a non-empty string of at most ${LIMITS.ROLE_MAX} chars`);
      else value.roles[key] = r;
    }
  }
  value.coordination = keepValid(doc.coordination, 'coordination', errors,
    (n) => (nonEmpty(n) && n.length <= NOTE_MAX && kept(n, NOTE_MAX) ? null : `note must be a non-empty string of at most ${NOTE_MAX} chars`),
    (n) => kept(n, NOTE_MAX)).slice(0, NOTES_COUNT_MAX);
  if (Array.isArray(doc.coordination) && doc.coordination.length > NOTES_COUNT_MAX) errors.push(`coordination: at most ${NOTES_COUNT_MAX} notes`);
  if (doc.orderNotes !== undefined && doc.orderNotes !== null) {
    if (!isStr(doc.orderNotes) || doc.orderNotes.length > NOTES_MAX) errors.push(`orderNotes: must be a string of at most ${NOTES_MAX} chars`);
    else value.orderNotes = kept(doc.orderNotes, NOTES_MAX);
  }
  return result(errors, value);
}

/** spec §5.9 as amended by the plan index: every edge override carries a snapshot
 *  {from, to, kind, display} so a confirmed edge a re-scan no longer finds can be shown. Edge
 *  override keys are map edge ids (x_…) only: a manual edge (m_…) carries no state — it is
 *  deleted instead. */
export function checkOverrides(doc) {
  const errors = [];
  const value = { version: MAP_VERSION, edges: {}, manual: [] };
  if (!docErrors(doc, errors)) return result(errors, value);
  const snapshotError = (o) => {
    if (!nonEmpty(o.from) || !nonEmpty(o.to)) return 'from and to must be member keys';
    if (o.from === o.to) return 'from and to must differ';
    if (!KINDS.includes(o.kind)) return `kind must be one of ${KINDS.join(', ')}`;
    if (!isStr(o.display) || o.display.length > DISPLAY_MAX) return `display must be a string of at most ${DISPLAY_MAX} chars`;
    return null;
  };
  if (doc.edges !== undefined && doc.edges !== null) {
    if (!isObj(doc.edges)) errors.push('edges: must be an object keyed by edge id');
    else for (const [id, o] of Object.entries(doc.edges)) {
      const at = `edges.${id}`;
      let err = !/^x_[0-9a-f]{12}$/.test(id) ? 'edge id must be x_ + 12 hex' : !isObj(o) ? 'must be an object' : null;
      if (!err && !OVERRIDE_STATES.includes(o.state)) err = `state must be one of ${OVERRIDE_STATES.join(', ')}`;
      if (!err) err = snapshotError(o) || (isStr(o.at) ? null : 'at must be a timestamp string');
      if (err) errors.push(`${at}: ${err}`);
      else value.edges[id] = { state: o.state, from: o.from, to: o.to, kind: o.kind, display: o.display, at: o.at };
    }
  }
  const seen = new Set();
  value.manual = keepValid(doc.manual, 'manual', errors,
    (m) => {
      if (!isObj(m)) return 'manual edge must be an object';
      if (!isStr(m.id) || !/^m_[0-9a-f]{12}$/.test(m.id)) return 'id must be m_ + 12 hex';
      if (seen.has(m.id)) return `duplicate id ${m.id}`;
      const err = snapshotError(m) || (nonEmpty(m.display) ? null : 'display must not be empty')
        || optStrError(m, 'detail', LIMITS.DETAIL_MAX) || (isStr(m.createdAt) ? null : 'createdAt must be a timestamp string');
      if (!err) seen.add(m.id);
      return err;
    },
    (m) => ({ id: m.id, from: m.from, to: m.to, kind: m.kind, display: m.display, detail: isStr(m.detail) ? m.detail : '', createdAt: m.createdAt }));
  return result(errors, value);
}
