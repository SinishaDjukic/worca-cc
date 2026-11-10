// src/core/design/store.mjs
// Design storage (SPEC C-1, C-9): designs, their builds and agents, and each design's library folder. The only module
// that touches the design tables, except the spend ledger (cost-budget.mjs). A design has no spending limit of its own
// (M13): its spend is read from design_cost_ledger, and a delete never touches that ledger, so deleting never lowers
// spend.
import { existsSync, rmSync } from 'node:fs';
import { getDb, prepare, tx } from '../db.mjs';
import { roundUsd } from '../cost-budget.mjs';
import {
  DesignError, DESIGN_KINDS, DESIGN_ID_RE, BUILD_ID_RE, newDesignId, newBuildId, newAgentId, sectionIdProblem,
} from './ids.mjs';
import { designDir, ensureDesignFolders } from './paths.mjs';

/** C-5 `design-build.status`. */
export const BUILD_STATUSES = Object.freeze(['planning', 'building', 'integrating', 'paused', 'done', 'stopped', 'error', 'interrupted']);
/** A build in one of these is still running or can resume: `paused` is open, `interrupted` is not (L1.18). */
export const OPEN_BUILD_STATUSES = Object.freeze(['planning', 'building', 'integrating', 'paused']);
/** C-5 `design-agent.status`. */
export const AGENT_STATUSES = Object.freeze(['starting', 'thinking', 'writing', 'reading', 'waiting', 'retrying', 'done', 'stopped', 'error', 'interrupted']);
/** C-5 `design-section.status`. */
export const SECTION_STATUSES = Object.freeze(['planned', 'writing', 'done', 'failed', 'stopped', 'removed']);
/** `designs.status` is `empty` until a first build, then mirrors its current build (L1.20). */
export const DESIGN_STATUSES = Object.freeze(['empty', ...BUILD_STATUSES]);
export const BUILD_KINDS = Object.freeze(['first', 'change']);
export const AGENT_ROLES = Object.freeze(['lead', 'builder']);
/** An agent in one of these has ended: the status sets `ended_at` when it is unset. */
export const TERMINAL_AGENT_STATUSES = Object.freeze(['done', 'stopped', 'error', 'interrupted']);
export const DEFAULT_TITLE = 'Untitled design';
export const TITLE_MAX = 120;
/** L1.9. */
export const BRIEF_MAX = 4000;
export const JOB_MAX = 24;

const iso = () => new Date().toISOString();
/** Folders on Windows can be held briefly by Defender, so every delete retries. */
const RM_OPTS = Object.freeze({ recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
/** Placeholders for `status IN (…)`, bound with `...OPEN_BUILD_STATUSES`. */
const OPEN_IN = OPEN_BUILD_STATUSES.map(() => '?').join(', ');

/** Each row with its spend: one GROUP BY over the ledger, joined by design id. */
const SELECT_DESIGNS = `SELECT d.*, COALESCE(l.spend, 0) AS spend FROM designs d
  LEFT JOIN (SELECT design_id, SUM(amount_usd) AS spend FROM design_cost_ledger GROUP BY design_id) l
  ON l.design_id = d.id`;

function toDesign(r) {
  if (!r) return null;
  return {
    id: r.id, title: r.title, kind: r.kind, fast: !!r.fast, projectKey: r.project_key ?? null,
    threadId: r.thread_id ?? null, engine: r.engine ?? null, status: r.status, currentBuild: r.current_build ?? null,
    version: Number(r.version), createdBy: r.created_by ?? null, createdAt: r.created_at, updatedAt: r.updated_at,
    costUsd: roundUsd(Number(r.spend) || 0), models: readModels(r.models_json),
  };
}

/** The design's own agents' picks: `{lead?, builder?}`, each `{model, effort?}`. */
export const DESIGN_MODEL_ROLES = Object.freeze(['lead', 'builder']);
const MODEL_ID_MAX = 200;
const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v);

/** A stored models_json as `{lead?, builder?}`; anything unreadable is no pick (`{}`), never a throw. */
function readModels(text) {
  if (typeof text !== 'string' || !text) return {};
  let v;
  try { v = JSON.parse(text); } catch { return {}; }
  if (!isObj(v)) return {};
  const out = {};
  for (const role of DESIGN_MODEL_ROLES) {
    const p = v[role];
    if (isObj(p) && typeof p.model === 'string' && p.model) out[role] = { model: p.model, ...(typeof p.effort === 'string' && p.effort ? { effort: p.effort } : {}) };
  }
  return out;
}

/** `{lead?, builder?}` with each pick `{model, effort?}` (null or absent = no pick), as stored text or null for none.
 *  The shape only: the routes check the model runs on the design's engine. */
function cleanModels(v) {
  if (v == null) return null;
  if (!isObj(v)) throw new DesignError('BAD_REQUEST', 'models must be { lead, builder }');
  const out = {};
  for (const [role, p] of Object.entries(v)) {
    if (!DESIGN_MODEL_ROLES.includes(role)) throw new DesignError('BAD_REQUEST', `models: unknown agent "${role}" (one of ${DESIGN_MODEL_ROLES.join(', ')})`);
    if (p == null) continue;
    if (!isObj(p) || Object.keys(p).some((k) => k !== 'model' && k !== 'effort')) throw new DesignError('BAD_REQUEST', `models.${role} must be { model, effort } or null`);
    const model = typeof p.model === 'string' ? p.model.trim() : '';
    if (!model || model.length > MODEL_ID_MAX) throw new DesignError('BAD_REQUEST', `models.${role}.model must be a model id`);
    if (p.effort != null && typeof p.effort !== 'string') throw new DesignError('BAD_REQUEST', `models.${role}.effort must be text`);
    const effort = typeof p.effort === 'string' ? p.effort.trim() : '';
    out[role] = { model, ...(effort ? { effort } : {}) };
  }
  return Object.keys(out).length ? JSON.stringify(out) : null;
}

/** One line, whitespace collapsed; blank is DEFAULT_TITLE; longer than TITLE_MAX is refused, never truncated. */
function cleanTitle(v) {
  if (v == null) return DEFAULT_TITLE;
  if (typeof v !== 'string') throw new DesignError('BAD_REQUEST', 'title must be text');
  const s = v.replace(/\s+/g, ' ').trim();
  if (!s) return DEFAULT_TITLE;
  if (s.length > TITLE_MAX) throw new DesignError('BAD_REQUEST', `title is longer than ${TITLE_MAX} characters`);
  return s;
}

function cleanKind(v) {
  if (!DESIGN_KINDS.includes(v)) {
    throw new DesignError('BAD_REQUEST', `kind must be one of ${DESIGN_KINDS.join(', ')}`);
  }
  return v;
}

function cleanFast(v) {
  if (v === undefined) return false;
  if (typeof v !== 'boolean') throw new DesignError('BAD_REQUEST', 'fast must be true or false');
  return v;
}

/** An optional reference (project key, chat thread, engine name): trimmed text, or null when absent or blank. */
function cleanRef(v, field) {
  if (v == null) return null;
  if (typeof v !== 'string') throw new DesignError('BAD_REQUEST', `${field} must be text`);
  return v.trim() || null;
}

function cleanStatus(v) {
  if (!DESIGN_STATUSES.includes(v)) {
    throw new DesignError('BAD_REQUEST', `status must be one of ${DESIGN_STATUSES.join(', ')}`);
  }
  return v;
}

function cleanCurrentBuild(v) {
  if (v == null) return null;
  if (typeof v !== 'string' || !BUILD_ID_RE.test(v)) {
    throw new DesignError('BAD_REQUEST', `currentBuild ${JSON.stringify(String(v))} is not a build id`);
  }
  return v;
}

function cleanVersion(v) {
  if (!Number.isInteger(v) || v < 0) throw new DesignError('BAD_REQUEST', 'version must be a whole number from 0');
  return v;
}

/** A design id no row and no folder holds yet, so a failed insert can only ever remove its own folder. */
function freshDesignId() {
  for (let i = 0; i < 5; i += 1) {
    const id = newDesignId();
    if (!existsSync(designDir(id)) && !prepare('SELECT 1 FROM designs WHERE id = ?').get(id)) return id;
  }
  throw new DesignError('IO', 'could not pick a free design id');
}

export function createDesign({ kind, title, fast, projectKey, threadId, engine, models } = {}, { by = null } = {}) {
  const k = cleanKind(kind);
  const m = cleanModels(models);
  const t = cleanTitle(title);
  const f = cleanFast(fast);
  const pk = cleanRef(projectKey, 'projectKey');
  const th = cleanRef(threadId, 'threadId');
  const en = cleanRef(engine, 'engine');
  getDb();
  const id = freshDesignId();
  const ts = iso();
  try {
    ensureDesignFolders(id);
    prepare(`INSERT INTO designs (id, title, kind, fast, project_key, thread_id, engine, status, current_build, version,
        created_by, created_at, updated_at, models_json) VALUES (?, ?, ?, ?, ?, ?, ?, 'empty', NULL, 0, ?, ?, ?, ?)`)
      .run(id, t, k, f ? 1 : 0, pk, th, en, by ?? null, ts, ts, m);
  } catch (err) {
    try { rmSync(designDir(id), RM_OPTS); } catch { /* the original error is the one worth reporting */ }
    throw err;
  }
  return requireDesign(id);
}

export function getDesign(id) {
  if (typeof id !== 'string') return null;
  return toDesign(prepare(`${SELECT_DESIGNS} WHERE d.id = ?`).get(id));
}

export function requireDesign(id) {
  const d = getDesign(id);
  if (!d) throw new DesignError('NOT_FOUND', 'design not found');
  return d;
}

/** Newest first. `visibleTo` keeps that person's designs and unowned ones (shared deployments). */
export function listDesigns({ visibleTo = null } = {}) {
  const where = visibleTo ? ' WHERE (d.created_by IS NULL OR d.created_by = ?)' : '';
  const args = visibleTo ? [visibleTo] : [];
  return prepare(`${SELECT_DESIGNS}${where} ORDER BY d.updated_at DESC, d.id`).all(...args).map(toDesign);
}

/** Patchable fields; anything else in a patch is ignored. None holds a spending limit (M13). */
const PATCH = Object.freeze({
  title: ['title', cleanTitle],
  fast: ['fast', (v) => (cleanFast(v) ? 1 : 0)],
  projectKey: ['project_key', (v) => cleanRef(v, 'projectKey')],
  threadId: ['thread_id', (v) => cleanRef(v, 'threadId')],
  engine: ['engine', (v) => cleanRef(v, 'engine')],
  status: ['status', cleanStatus],
  currentBuild: ['current_build', cleanCurrentBuild],
  version: ['version', cleanVersion],
  models: ['models_json', cleanModels],
});

export function updateDesign(id, patch = {}) {
  const sets = [];
  const vals = [];
  for (const [key, [col, clean]] of Object.entries(PATCH)) {
    if (!Object.hasOwn(patch, key) || patch[key] === undefined) continue;
    sets.push(`${col} = ?`);
    vals.push(clean(patch[key]));
  }
  sets.push('updated_at = ?');
  vals.push(iso());
  if (typeof id === 'string') prepare(`UPDATE designs SET ${sets.join(', ')} WHERE id = ?`).run(...vals, id);
  return requireDesign(id);
}

/**
 * Remove a design's folder, then its rows (agents, builds, design) in one transaction. The folder goes first: when it
 * cannot be removed the rows stay, so a retry works. A link inside the folder is removed, never followed. The cost
 * ledger is never touched. An unknown (or malformed) id returns false. A design with an open build (`paused`
 * included) is refused with `CONFLICT` before the folder is touched (L1.18).
 */
export function deleteDesign(id) {
  if (typeof id !== 'string' || !DESIGN_ID_RE.test(id)) return false;
  if (prepare(`SELECT 1 FROM design_builds WHERE design_id = ? AND status IN (${OPEN_IN})`).get(id, ...OPEN_BUILD_STATUSES)) {
    throw new DesignError('CONFLICT', 'the design has a build that is still running or paused');
  }
  try {
    rmSync(designDir(id), RM_OPTS);
  } catch (err) {
    throw new DesignError('IO', `could not remove the design folder: ${err.message}`);
  }
  return tx(() => {
    prepare('DELETE FROM design_agents WHERE build_id IN (SELECT id FROM design_builds WHERE design_id = ?)').run(id);
    prepare('DELETE FROM design_builds WHERE design_id = ?').run(id);
    return Number(prepare('DELETE FROM designs WHERE id = ?').run(id).changes) > 0;
  });
}

// Builds and agents (C-9 design_builds, design_agents). A build is one round of a design; an agent is one process of a
// build. Every write below runs as one statement or inside one tx() that uses prepare() only, never another store
// function that opens its own tx() (tx() is not re-entrant).

const given = (patch, key) => Object.hasOwn(patch, key) && patch[key] !== undefined;

/** A JSON column read back; a missing or malformed value reads as `fallback`. */
function parseJson(text, fallback) {
  if (text == null) return fallback;
  try { return JSON.parse(text); } catch { return fallback; }
}

function toBuild(r) {
  if (!r) return null;
  const sections = parseJson(r.sections_json, []);
  return {
    id: r.id, designId: r.design_id, round: Number(r.round), kind: r.kind, status: r.status, brief: r.brief,
    fast: !!r.fast, reason: r.reason ?? null, sections: Array.isArray(sections) ? sections : [],
    agentsTotal: Number(r.agents_total), layers: Number(r.layers), costUsd: Number(r.cost_usd),
    startedAt: r.started_at, endedAt: r.ended_at ?? null, createdBy: r.created_by ?? null,
  };
}

function toAgent(r) {
  if (!r) return null;
  const tokens = parseJson(r.tokens, null);
  return {
    id: r.id, buildId: r.build_id, role: r.role, sectionId: r.section_id ?? null, job: r.job, engine: r.engine,
    model: r.model ?? null, effort: r.effort ?? null, sessionId: r.session_id ?? null, status: r.status,
    costUsd: r.cost_usd == null ? null : Number(r.cost_usd), costKnown: !!r.cost_known,
    tokens: tokens !== null && typeof tokens === 'object' && !Array.isArray(tokens) ? tokens : null,
    asks: Number(r.asks), startedAt: r.started_at, endedAt: r.ended_at ?? null, error: r.error ?? null,
  };
}

function cleanOneOf(v, list, field) {
  if (!list.includes(v)) throw new DesignError('BAD_REQUEST', `${field} must be one of ${list.join(', ')}`);
  return v;
}

/** Trimmed; blank or longer than BRIEF_MAX is refused, never truncated (L1.9). */
function cleanBrief(v) {
  if (typeof v !== 'string') throw new DesignError('BAD_REQUEST', 'brief must be text');
  const s = v.trim();
  if (!s) throw new DesignError('BAD_REQUEST', 'brief is empty');
  if (s.length > BRIEF_MAX) throw new DesignError('BAD_REQUEST', `brief is longer than ${BRIEF_MAX} characters`);
  return s;
}

/** An agent's label on the stage: 1 to JOB_MAX characters on one line. */
function cleanJob(v) {
  if (typeof v !== 'string') throw new DesignError('BAD_REQUEST', 'job must be text');
  const s = v.trim();
  if (!s || s.length > JOB_MAX || /[\r\n]/.test(s)) {
    throw new DesignError('BAD_REQUEST', `job must be 1 to ${JOB_MAX} characters on one line`);
  }
  return s;
}

function cleanSectionId(v) {
  if (v == null) return null;
  const problem = sectionIdProblem(v);
  if (problem) throw new DesignError('BAD_REQUEST', problem);
  return v;
}

function cleanFlag(v, field) {
  if (typeof v !== 'boolean') throw new DesignError('BAD_REQUEST', `${field} must be true or false`);
  return v;
}

function cleanCount(v, field) {
  if (!Number.isInteger(v) || v < 0) throw new DesignError('BAD_REQUEST', `${field} must be a whole number from 0`);
  return v;
}

function cleanUsd(v, field) {
  if (typeof v !== 'number' || !Number.isFinite(v) || v < 0) {
    throw new DesignError('BAD_REQUEST', `${field} must be a number from 0`);
  }
  return v;
}

function cleanEndedAt(v) {
  if (v === null) return null;
  if (typeof v !== 'string' || !Number.isFinite(Date.parse(v))) {
    throw new DesignError('BAD_REQUEST', 'endedAt must be a time or null');
  }
  return v;
}

/** `started_at` is NOT NULL: a time, never null (a Continue shifts it forward by the pause, L2.11). */
function cleanStartedAt(v) {
  if (typeof v !== 'string' || !Number.isFinite(Date.parse(v))) {
    throw new DesignError('BAD_REQUEST', 'startedAt must be a time');
  }
  return v;
}

function cleanSections(v) {
  if (!Array.isArray(v) || v.some((s) => s === null || typeof s !== 'object' || Array.isArray(s))) {
    throw new DesignError('BAD_REQUEST', 'sections must be a list of objects');
  }
  return JSON.stringify(v);
}

function cleanTokens(v) {
  if (v === null) return null;
  if (typeof v !== 'object' || Array.isArray(v)) throw new DesignError('BAD_REQUEST', 'tokens must be an object or null');
  return JSON.stringify(v);
}

function cleanText(v, field) {
  if (v === null) return null;
  if (typeof v !== 'string') throw new DesignError('BAD_REQUEST', `${field} must be text or null`);
  return v;
}

/** Columns and cleaners for a patch: each given key becomes one `col = ?`; unknown keys are ignored. */
function patchSets(spec, patch) {
  const sets = [];
  const vals = [];
  for (const [key, [col, clean]] of Object.entries(spec)) {
    if (!given(patch, key)) continue;
    sets.push(`${col} = ?`);
    vals.push(clean(patch[key]));
  }
  return { sets, vals };
}

/** A fresh id for `table`, called inside the caller's tx(): a clash is retried, never overwritten. */
function freshRowId(table, make) {
  for (let i = 0; i < 5; i += 1) {
    const id = make();
    if (!prepare(`SELECT 1 FROM ${table} WHERE id = ?`).get(id)) return id;
  }
  throw new DesignError('IO', `could not pick a free id in ${table}`);
}

/**
 * Start a design's next round. One open build per design (L1.18): `CONFLICT` while its current build is open, and
 * `paused` counts as open. `fast` defaults to the design's; the build keeps that value from the start of the round,
 * while the live choice is `Design.fast` (M7).
 */
export function createBuild({ designId, kind, brief, fast } = {}, { by = null } = {}) {
  const k = cleanOneOf(kind, BUILD_KINDS, 'kind');
  const b = cleanBrief(brief);
  const f = fast === undefined ? undefined : cleanFast(fast);
  const id = tx(() => {
    const d = typeof designId === 'string'
      ? prepare('SELECT fast, current_build FROM designs WHERE id = ?').get(designId) : undefined;
    if (!d) throw new DesignError('NOT_FOUND', 'design not found');
    if (d.current_build && prepare(`SELECT 1 FROM design_builds WHERE id = ? AND status IN (${OPEN_IN})`)
      .get(d.current_build, ...OPEN_BUILD_STATUSES)) {
      throw new DesignError('CONFLICT', 'the design already has a build that is running or paused');
    }
    const round = Number(prepare('SELECT COALESCE(MAX(round), 0) + 1 AS n FROM design_builds WHERE design_id = ?')
      .get(designId).n);
    const buildId = freshRowId('design_builds', newBuildId);
    const ts = iso();
    prepare(`INSERT INTO design_builds (id, design_id, round, kind, status, brief, fast, reason, sections_json,
        agents_total, layers, cost_usd, started_at, ended_at, created_by)
        VALUES (?, ?, ?, ?, 'planning', ?, ?, NULL, '[]', 0, 0, 0, ?, NULL, ?)`)
      .run(buildId, designId, round, k, b, (f ?? !!d.fast) ? 1 : 0, ts, by ?? null);
    prepare("UPDATE designs SET current_build = ?, status = 'planning', updated_at = ? WHERE id = ?").run(buildId, ts, designId);
    return buildId;
  });
  return getBuild(id);
}

export function getBuild(id) {
  if (typeof id !== 'string') return null;
  return toBuild(prepare('SELECT * FROM design_builds WHERE id = ?').get(id));
}

/** The design's highest round, or null before its first build. */
export function latestBuild(designId) {
  if (typeof designId !== 'string') return null;
  return toBuild(prepare('SELECT * FROM design_builds WHERE design_id = ? ORDER BY round DESC LIMIT 1').get(designId));
}

export function listBuilds(designId) {
  if (typeof designId !== 'string') return [];
  return prepare('SELECT * FROM design_builds WHERE design_id = ? ORDER BY round ASC').all(designId).map(toBuild);
}

/** Every open build across designs, for boot recovery. */
export function listOpenBuilds() {
  return prepare(`SELECT * FROM design_builds WHERE status IN (${OPEN_IN}) ORDER BY started_at, id`)
    .all(...OPEN_BUILD_STATUSES).map(toBuild);
}

/** Patchable build fields; anything else in a patch is ignored (L1.33). There is no `fast` key (M7). */
const BUILD_PATCH = Object.freeze({
  status: ['status', (v) => cleanOneOf(v, BUILD_STATUSES, 'status')],
  reason: ['reason', (v) => cleanRef(v, 'reason')],
  sections: ['sections_json', cleanSections],
  agentsTotal: ['agents_total', (v) => cleanCount(v, 'agentsTotal')],
  layers: ['layers', (v) => cleanCount(v, 'layers')],
  costUsd: ['cost_usd', (v) => cleanUsd(v, 'costUsd')],
  startedAt: ['started_at', cleanStartedAt],
  endedAt: ['ended_at', cleanEndedAt],
});

/**
 * A status outside OPEN_BUILD_STATUSES sets `ended_at` when it is unset, unless the patch carries `endedAt`: a given
 * one, null included, is written as is (a resumed build reopens that way). A status on the design's current build also
 * writes `designs.status` (L1.20); on any other build the design is left alone.
 */
export function updateBuild(id, patch = {}) {
  const { sets, vals } = patchSets(BUILD_PATCH, patch);
  const status = given(patch, 'status') ? patch.status : null;
  if (status && !OPEN_BUILD_STATUSES.includes(status) && !given(patch, 'endedAt')) {
    sets.push('ended_at = COALESCE(ended_at, ?)');
    vals.push(iso());
  }
  tx(() => {
    const row = typeof id === 'string' ? prepare('SELECT design_id FROM design_builds WHERE id = ?').get(id) : undefined;
    if (!row) throw new DesignError('NOT_FOUND', 'build not found');
    if (sets.length) prepare(`UPDATE design_builds SET ${sets.join(', ')} WHERE id = ?`).run(...vals, id);
    if (status) {
      prepare('UPDATE designs SET status = ?, updated_at = ? WHERE id = ? AND current_build = ?')
        .run(status, iso(), row.design_id, id);
    }
  });
  return getBuild(id);
}

/** One process of a build; the build's `agentsTotal` counts it in the same tx(). */
export function createAgent({ buildId, role, sectionId, job, engine, model, effort, status } = {}) {
  const r = cleanOneOf(role, AGENT_ROLES, 'role');
  const sec = cleanSectionId(sectionId);
  const j = cleanJob(job);
  const en = cleanRef(engine, 'engine');
  if (!en) throw new DesignError('BAD_REQUEST', 'engine is required');
  const mo = cleanRef(model, 'model');
  const ef = cleanRef(effort, 'effort');
  const st = status == null ? 'starting' : cleanOneOf(status, AGENT_STATUSES, 'status');
  const id = tx(() => {
    if (typeof buildId !== 'string' || !prepare('SELECT 1 FROM design_builds WHERE id = ?').get(buildId)) {
      throw new DesignError('NOT_FOUND', 'build not found');
    }
    const agentId = freshRowId('design_agents', newAgentId);
    prepare(`INSERT INTO design_agents (id, build_id, role, section_id, job, engine, model, effort, session_id, status,
        cost_usd, cost_known, tokens, asks, started_at, ended_at, error)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, NULL, 1, NULL, 0, ?, NULL, NULL)`)
      .run(agentId, buildId, r, sec, j, en, mo, ef, st, iso());
    prepare('UPDATE design_builds SET agents_total = agents_total + 1 WHERE id = ?').run(buildId);
    return agentId;
  });
  return getAgent(id);
}

export function getAgent(id) {
  if (typeof id !== 'string') return null;
  return toAgent(prepare('SELECT * FROM design_agents WHERE id = ?').get(id));
}

/** A build's agents in the order they were created. */
export function listAgents(buildId) {
  if (typeof buildId !== 'string') return [];
  return prepare('SELECT * FROM design_agents WHERE build_id = ? ORDER BY rowid').all(buildId).map(toAgent);
}

/** Patchable agent fields; anything else in a patch is ignored (L1.33). `job` lets a later round reuse the lead row. */
const AGENT_PATCH = Object.freeze({
  job: ['job', cleanJob],
  status: ['status', (v) => cleanOneOf(v, AGENT_STATUSES, 'status')],
  model: ['model', (v) => cleanRef(v, 'model')],
  effort: ['effort', (v) => cleanRef(v, 'effort')],
  sessionId: ['session_id', (v) => cleanRef(v, 'sessionId')],
  costUsd: ['cost_usd', (v) => (v === null ? null : cleanUsd(v, 'costUsd'))],
  costKnown: ['cost_known', (v) => (cleanFlag(v, 'costKnown') ? 1 : 0)],
  tokens: ['tokens', cleanTokens],
  asks: ['asks', (v) => cleanCount(v, 'asks')],
  endedAt: ['ended_at', cleanEndedAt],
  error: ['error', (v) => cleanText(v, 'error')],
});

/** A terminal status sets `ended_at` when it is unset; a given `endedAt`, null included, wins. One statement. */
export function updateAgent(id, patch = {}) {
  const { sets, vals } = patchSets(AGENT_PATCH, patch);
  if (given(patch, 'status') && TERMINAL_AGENT_STATUSES.includes(patch.status) && !given(patch, 'endedAt')) {
    sets.push('ended_at = COALESCE(ended_at, ?)');
    vals.push(iso());
  }
  if (sets.length && typeof id === 'string') {
    prepare(`UPDATE design_agents SET ${sets.join(', ')} WHERE id = ?`).run(...vals, id);
  }
  const agent = getAgent(id);
  if (!agent) throw new DesignError('NOT_FOUND', 'agent not found');
  return agent;
}

/** Every design with an agent whose cost is unknown: its total reads `cost unknown`, never `$0` (P6, C-9). */
export function designsWithUnknownCost() {
  return new Set(prepare(`SELECT DISTINCT b.design_id FROM design_agents a JOIN design_builds b ON a.build_id = b.id
    WHERE a.cost_known = 0`).all().map((r) => r.design_id));
}
