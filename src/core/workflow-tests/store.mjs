// src/core/workflow-tests/store.mjs
// Workflow tests storage (plans/workflow-tests-part2-plan.md Task 2, schema v85, D26, D31): examples and their files,
// test runs, tries, and the tries a run shows. Every write validates; reads never throw on bad JSON.
import { createHash, randomBytes } from 'node:crypto';
import { getDb, prepare, tx } from '../db.mjs';
import { canon } from '../../shared/graph/diff-graphs.mjs';
import { normaliseCheck, normaliseBasics, DEFAULT_BASICS, PROJECT_KINDS } from '../../shared/workflow-tests/checks.mjs';

export const OTHERWISE = Object.freeze(['pick', 'fail']);
export const TRY_COUNTS = Object.freeze([1, 3, 5]);
export const MAX_TRIES = 10;
export const FILE_MAX_BYTES = 5 * 1024 * 1024;
export const FILES_MAX = 8;
export const PIN_MAX_CHANGES = 5 * 1024 * 1024;
export const SETUP_MAX = 4000;   // actions/model.mjs MAX_CMD: a project's own setup always fits
const PROJECT_KEY_RE = /^[a-z0-9][a-z0-9-]*-[0-9a-f]{8}$/;   // store.mjs PROJECT_KEY_RE, inlined: this module imports no fs code
const SHA_RE = /^[0-9a-f]{40}([0-9a-f]{24})?$/;
export const FINISHED = Object.freeze(['passed', 'failed']);
/** D35: a test's tries use stand-ins for the connectors ('pretend', the default) or the real ones. */
export const CONNECTOR_MODES = Object.freeze(['pretend', 'real']);
const modeOf = (v) => (v === 'real' ? 'real' : 'pretend');
const NAME_MAX = 120;
const REQUEST_MAX = 100_000;
export const ANSWERS_MAX = 50;
const CHECKS_MAX = 20;
const NOTE_MAX = 2000;
const FILE_NAME_RE = /^[^\\/:*?"<>|\u0000-\u001f]{1,120}$/;
/** Device names Windows refuses as a file, with or without an extension (`nul.txt`): a try's extras could not be written. */
const RESERVED_STEM_RE = /^(con|prn|aux|nul|com[0-9]|lpt[0-9])$/i;

export function testError(message, code, extra = {}) { return Object.assign(new Error(message), { code, ...extra }); }
const parse = (text, fallback) => { try { const v = JSON.parse(text); return v ?? fallback; } catch { return fallback; } };
const nowIso = () => new Date().toISOString();

/** 'draft' or a version number, from a route, a query or a body; null when it is neither (D23). */
export function parseUse(v) {
  if (v === 'draft') return 'draft';
  const n = typeof v === 'number' ? v : typeof v === 'string' && /^[1-9]\d{0,8}$/.test(v) ? Number(v) : NaN;
  return Number.isInteger(n) && n > 0 ? n : null;
}
export const useRef = (use) => (use === 'draft' ? 'draft' : String(use));
export const useOf = (ref) => parseUse(ref);

/**
 * The editable fields of an example, checked. Missing fields take their defaults; new checks get an id.
 * @returns {{value: object|null, errors: string[]}}
 */
export function normaliseExample(input = {}, { hasProject = false } = {}) {
  const errors = [];
  const name = typeof input.name === 'string' ? input.name.trim() : '';
  if (!name || name.length > NAME_MAX) errors.push(`the name must be 1 to ${NAME_MAX} characters`);
  const request = typeof input.request === 'string' ? input.request : '';
  if (request.length > REQUEST_MAX) errors.push(`the request is longer than ${REQUEST_MAX} characters`);
  const answers = [];
  const rawAnswers = input.answers === undefined ? [] : input.answers;
  if (!Array.isArray(rawAnswers) || rawAnswers.length > ANSWERS_MAX) errors.push(`at most ${ANSWERS_MAX} questions and answers`);
  else {
    for (const a of rawAnswers) {
      const question = a && typeof a.question === 'string' ? a.question.trim() : '';
      const answer = a && typeof a.answer === 'string' ? a.answer.trim() : '';
      if (!question || question.length > 500 || !answer || answer.length > 2000) {
        errors.push('each question needs an answer: up to 500 characters for the question and 2000 for the answer');
        break;
      }
      answers.push({ question, answer });
    }
  }
  const otherwise = input.otherwise === undefined ? 'pick' : input.otherwise;
  if (!OTHERWISE.includes(otherwise)) errors.push('otherwise must be "pick" or "fail"');
  const { basics, error: basicsError } = normaliseBasics(input.basics);
  if (basicsError) errors.push(basicsError);
  const checks = [];
  const rawChecks = input.checks === undefined ? [] : input.checks;
  if (!Array.isArray(rawChecks) || rawChecks.length > CHECKS_MAX) errors.push(`at most ${CHECKS_MAX} automatic checks`);
  else {
    for (const raw of rawChecks) {
      if (raw && PROJECT_KINDS.includes(raw.kind) && !hasProject) {   // 3a D57: it runs in the copy of the project
        errors.push('the command check needs a project: pick one under Where it starts');
        break;
      }
      const { check, error } = normaliseCheck(raw);
      if (error) { errors.push(error); break; }
      checks.push(check.id ? check : { id: `c_${randomBytes(5).toString('hex')}`, ...check });
    }
  }
  const tries = input.tries === undefined ? 3 : Number(input.tries);
  if (!TRY_COUNTS.includes(tries)) errors.push('tries must be 1, 3 or 5');
  const note = typeof input.note === 'string' && input.note.trim() ? input.note.trim().slice(0, NOTE_MAX) : null;
  if (errors.length) return { value: null, errors };
  return { value: { name, request, answers, otherwise, basics, checks, tries, note }, errors: [] };
}

/** D26: what a try depends on — what Worca gets and how it is judged. Not the name, the note or the number of tries. */
export function exampleFingerprint(ex) {
  const files = (ex.files || []).map((f) => [f.name, f.sha256]).sort((x, y) => (x[0] < y[0] ? -1 : x[0] > y[0] ? 1 : 0));
  const checks = (ex.checks || []).map(({ id: _id, ...c }) => c);
  const body = { r: ex.request, f: files, a: ex.answers, o: ex.otherwise, b: ex.basics, c: checks };
  // 3a D64: a project example also depends on where it starts and how it is set up; an example without one keeps its
  // Part 2 fingerprint byte for byte. The start commit already covers the uncommitted changes.
  if (ex.project) body.p = [ex.project.key, ex.project.startCommit, ex.project.setupCmd || null];
  return createHash('sha256').update(canon(body)).digest('hex').slice(0, 16);
}

const EX_COLS = `id, workflow_id, name, request, answers, otherwise, basics, checks, tries, note, from_pipeline, from_use,
  from_verdict, created_by, created_at, updated_at`;
function filesOf(exampleId) {
  return prepare('SELECT name, size, sha256 FROM wf_test_example_files WHERE example_id = ? ORDER BY name').all(exampleId)
    .map((f) => ({ name: f.name, size: Number(f.size), sha256: f.sha256 }));
}
const PROJECT_COLS = 'project_key, project_name, start_sha, start_ref, start_at, start_commit, changes_sha256, length(changes) AS changes_bytes, setup_cmd';
function projectOf(exampleId) {
  const r = prepare(`SELECT ${PROJECT_COLS} FROM wf_test_example_projects WHERE example_id = ?`).get(Number(exampleId));
  if (!r) return null;
  return { key: r.project_key, name: r.project_name ?? null, startSha: r.start_sha, startRef: r.start_ref ?? null, startAt: r.start_at, startCommit: r.start_commit,
    changesSha256: r.changes_sha256 ?? null, changesBytes: Number(r.changes_bytes || 0), setupCmd: r.setup_cmd ?? null };
}

/** The bytes of an example's uncommitted changes, or null. */
export function readExampleChanges(exampleId) {
  getDb();
  const r = prepare('SELECT changes FROM wf_test_example_projects WHERE example_id = ?').get(Number(exampleId));
  return r && r.changes ? Buffer.from(r.changes) : null;
}

/** A pin as written (service.mjs makes it with project-copy.mjs pinStart): checked, or an error. */
function checkPin(p) {
  if (!p || typeof p !== 'object') throw testError('a project needs a start point', 'BAD_REQUEST');
  if (!PROJECT_KEY_RE.test(String(p.key || ''))) throw testError('pick a project', 'BAD_REQUEST');
  if (!SHA_RE.test(String(p.startSha || '')) || !SHA_RE.test(String(p.startCommit || ''))) throw testError('the start point must be a commit', 'BAD_REQUEST');
  if (p.startRef != null && (typeof p.startRef !== 'string' || !p.startRef || p.startRef.length > 255 || /[\u0000-\u001f\u007f]/.test(p.startRef))) {
    throw testError('the start point names a branch Worca cannot read', 'BAD_REQUEST');
  }
  if (!Number.isFinite(Date.parse(p.startAt))) throw testError('the start point has no date', 'BAD_REQUEST');
  const changes = p.changes == null ? null : Buffer.isBuffer(p.changes) ? p.changes : Buffer.from(p.changes);
  if (changes && changes.length > PIN_MAX_CHANGES) throw testError('your changes that are not committed are larger than 5 MB: commit them first, or leave them out', 'BAD_REQUEST');
  const setup = typeof p.setupCmd === 'string' && p.setupCmd.trim() ? p.setupCmd.trim() : null;
  // The project's name when pinned (shown if it is unregistered later); a name Worca cannot show is simply not kept.
  const name = typeof p.name === 'string' && p.name.trim() && p.name.length <= 200 && !/[\u0000-\u001f\u007f]/.test(p.name) ? p.name.trim() : null;
  if (setup && (setup.length > SETUP_MAX || /[\r\n]/.test(setup))) throw testError(`the setup command must fit on one line of up to ${SETUP_MAX} characters`, 'BAD_REQUEST');
  return { ...p, name, startRef: p.startRef ?? null, changes: changes && changes.length ? changes : null, setupCmd: setup };
}

/** Whether the checked pin `p` is what the example already has (`was`, projectOf's shape): the same project, start commit,
 *  branch, Worca start commit, date, uncommitted changes and setup. The shown name is left out: it is no change to a try. */
function samePin(was, p) {
  if (!was || !p) return !was && !p;
  const changesSha = p.changes ? createHash('sha256').update(p.changes).digest('hex') : null;
  return was.key === p.key && was.startSha === p.startSha && (was.startRef ?? null) === (p.startRef ?? null) && was.startCommit === p.startCommit
    && was.startAt === p.startAt && (was.changesSha256 ?? null) === changesSha && (was.setupCmd ?? null) === (p.setupCmd ?? null);
}

function writePin(exampleId, p) {
  prepare(`INSERT INTO wf_test_example_projects (example_id, project_key, start_sha, start_ref, start_at, start_commit, changes,
      changes_sha256, setup_cmd, updated_at, project_name) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(example_id) DO UPDATE SET project_key = excluded.project_key, start_sha = excluded.start_sha, start_ref = excluded.start_ref,
      start_at = excluded.start_at, start_commit = excluded.start_commit, changes = excluded.changes, changes_sha256 = excluded.changes_sha256,
      setup_cmd = excluded.setup_cmd, updated_at = excluded.updated_at, project_name = excluded.project_name`)
    .run(Number(exampleId), p.key, p.startSha, p.startRef, p.startAt, p.startCommit, p.changes,
      p.changes ? createHash('sha256').update(p.changes).digest('hex') : null, p.setupCmd, nowIso(), p.name);
}

function exampleOf(r) {
  if (!r) return null;
  const ex = {
    id: Number(r.id), workflowId: r.workflow_id, name: r.name, request: r.request,
    answers: parse(r.answers, []), otherwise: r.otherwise,
    basics: normaliseBasics(parse(r.basics, {})).basics || { ...DEFAULT_BASICS },
    checks: parse(r.checks, []), tries: Number(r.tries), note: r.note ?? null,
    from: r.from_pipeline ? { pipelineId: r.from_pipeline, use: r.from_use ? useOf(r.from_use) : null, verdict: r.from_verdict ?? null } : null,
    project: projectOf(Number(r.id)),
    files: filesOf(Number(r.id)), createdBy: r.created_by ?? null, createdAt: r.created_at, updatedAt: r.updated_at,
  };
  return { ...ex, fingerprint: exampleFingerprint(ex) };
}
const invalid = (errors) => testError(errors[0], 'BAD_REQUEST', { errors });

/** @param {{by?: string|null, from?: {pipelineId: string, use: 'draft'|number|null, verdict: 'good'|'not-good'|null}|null, project?: object|null}} [opts] `project` = a pin (checkPin) */
export function createExample(workflowId, input, { by = null, from = null, project = null } = {}) {
  const pinned = project ? checkPin(project) : null;
  const { value, errors } = normaliseExample(input, { hasProject: !!pinned });
  if (!value) throw invalid(errors);
  getDb();
  const at = nowIso();
  const id = tx(() => {
    const info = prepare(`INSERT INTO wf_test_examples (workflow_id, name, request, answers, otherwise, basics, checks, tries, note,
        from_pipeline, from_use, from_verdict, created_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(workflowId, value.name, value.request, JSON.stringify(value.answers), value.otherwise, JSON.stringify(value.basics),
        JSON.stringify(value.checks), value.tries, value.note, from ? from.pipelineId : null,
        from && from.use != null ? useRef(from.use) : null, from ? from.verdict ?? null : null, by, at, at);
    const newId = Number(info.lastInsertRowid);
    if (pinned) writePin(newId, pinned);
    return newId;
  });
  return readExample(workflowId, id);
}

export function readExample(workflowId, id) {
  getDb();
  return exampleOf(prepare(`SELECT ${EX_COLS} FROM wf_test_examples WHERE workflow_id = ? AND id = ?`).get(workflowId, Number(id)));
}

export function listExamples(workflowId) {
  getDb();
  return prepare(`SELECT ${EX_COLS} FROM wf_test_examples WHERE workflow_id = ? ORDER BY id`).all(workflowId).map(exampleOf);
}

function requireExample(workflowId, id) {
  const ex = readExample(workflowId, id);
  if (!ex) throw testError(`no example ${id}`, 'NOT_FOUND');
  return ex;
}

/** Fields left out of `input` keep their value. `project`: undefined keeps the pin, null removes it, a pin replaces it. */
export function updateExample(workflowId, id, input = {}, { project } = {}) {
  const was = requireExample(workflowId, id);
  const pinned = project ? checkPin(project) : null;
  const hasProject = project === undefined ? !!was.project : !!pinned;
  const { value, errors } = normaliseExample({ ...was, ...input }, { hasProject });
  if (!value) throw invalid(errors);
  // Final review: only a save that changes what a try runs from (the project, its start, the changes or the setup) waits for
  // the test; one that carries the same pin (a note-only edit from the editor) saves.
  if (project !== undefined && !samePin(was.project, pinned)) {
    const run = runningTestRun(workflowId);
    if (run && run.exampleIds.includes(was.id)) throw testError('a test is trying this example: stop it first', 'BUSY');
  }
  tx(() => {
    prepare(`UPDATE wf_test_examples SET name = ?, request = ?, answers = ?, otherwise = ?, basics = ?, checks = ?, tries = ?, note = ?,
        updated_at = ? WHERE workflow_id = ? AND id = ?`)
      .run(value.name, value.request, JSON.stringify(value.answers), value.otherwise, JSON.stringify(value.basics),
        JSON.stringify(value.checks), value.tries, value.note, nowIso(), workflowId, was.id);
    if (project === null) prepare('DELETE FROM wf_test_example_projects WHERE example_id = ?').run(was.id);
    else if (pinned) writePin(was.id, pinned);
  });
  return readExample(workflowId, was.id);
}

export function deleteExample(workflowId, id) {
  const ex = requireExample(workflowId, id);
  const run = runningTestRun(workflowId);
  if (run && run.exampleIds.includes(ex.id)) throw testError('a test is trying this example: stop it first', 'BUSY');
  tx(() => {
    prepare('DELETE FROM wf_test_example_files WHERE example_id = ?').run(ex.id);
    prepare('DELETE FROM wf_test_example_projects WHERE example_id = ?').run(ex.id);
    prepare('DELETE FROM wf_test_examples WHERE workflow_id = ? AND id = ?').run(workflowId, ex.id);
  });
  return true;
}

export function putExampleFile(workflowId, id, { name, data } = {}) {
  const ex = requireExample(workflowId, id);
  const clean = typeof name === 'string' ? name.trim() : '';
  // Also refused: a name a try's folder could not hold on Windows (server.mjs writeExtras would drop it silently): a
  // device name, a name ending in a dot, or a case-only twin of another file of this example. Spaces around the name
  // are trimmed (as writeExtras trims them); the exact same name replaces that file.
  const plainName = FILE_NAME_RE.test(clean) && clean !== '.' && clean !== '..' && !/\.$/.test(clean)
    && !RESERVED_STEM_RE.test(clean.split('.')[0].trimEnd())
    && !ex.files.some((f) => f.name !== clean && f.name.toLowerCase() === clean.toLowerCase());
  if (!plainName) throw testError('give the file a plain name, such as notes.md', 'BAD_REQUEST');
  const buf = Buffer.isBuffer(data) ? data : Buffer.from(data || []);
  if (!buf.length) throw testError(`${clean} is empty`, 'BAD_REQUEST');
  if (buf.length > FILE_MAX_BYTES) throw testError(`${clean} is larger than 5 MB`, 'BAD_REQUEST');
  if (!ex.files.some((f) => f.name === clean) && ex.files.length >= FILES_MAX) throw testError(`an example has at most ${FILES_MAX} files`, 'BAD_REQUEST');
  const sha256 = createHash('sha256').update(buf).digest('hex');
  tx(() => {
    prepare(`INSERT INTO wf_test_example_files (example_id, name, data, sha256, size) VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(example_id, name) DO UPDATE SET data = excluded.data, sha256 = excluded.sha256, size = excluded.size`)
      .run(ex.id, clean, buf, sha256, buf.length);
    prepare('UPDATE wf_test_examples SET updated_at = ? WHERE id = ?').run(nowIso(), ex.id);
  });
  return readExample(workflowId, ex.id);
}

export function deleteExampleFile(workflowId, id, name) {
  const ex = requireExample(workflowId, id);
  if (!ex.files.some((f) => f.name === name)) throw testError(`no file ${name}`, 'NOT_FOUND');
  tx(() => {
    prepare('DELETE FROM wf_test_example_files WHERE example_id = ? AND name = ?').run(ex.id, name);
    prepare('UPDATE wf_test_examples SET updated_at = ? WHERE id = ?').run(nowIso(), ex.id);
  });
  return readExample(workflowId, ex.id);
}

/** The bytes a try sends as its extras. */
export function readExampleFiles(exampleId) {
  getDb();
  return prepare('SELECT name, data FROM wf_test_example_files WHERE example_id = ? ORDER BY name').all(Number(exampleId))
    .map((f) => ({ name: f.name, data: Buffer.from(f.data) }));
}

// ── Test runs ───────────────────────────────────────────────────────────────
const RUN_COLS = `id, workflow_id, kind, a_use, b_use, a_fp, b_fp, example_ids, tries, quick, cap_usd, connectors, status, stop_reason,
  stop_detail, started_by, created_at, finished_at`;
function runOf(r) {
  if (!r) return null;
  return {
    id: Number(r.id), workflowId: r.workflow_id, kind: r.kind, a: r.a_use == null ? null : useOf(r.a_use), b: useOf(r.b_use),
    aFp: r.a_fp ?? null, bFp: r.b_fp, exampleIds: parse(r.example_ids, []).map(Number), tries: Number(r.tries),
    quick: parse(r.quick, null), capUsd: r.cap_usd ?? null, connectors: modeOf(r.connectors), status: r.status, stopReason: r.stop_reason ?? null,
    stopDetail: r.stop_detail ?? null, startedBy: r.started_by ?? null, createdAt: r.created_at, finishedAt: r.finished_at ?? null,
  };
}

export function createTestRun({ workflowId, kind = 'compare', a = null, b, aFp = null, bFp, exampleIds, tries, quick = null, capUsd = null,
  connectors = 'pretend', by = null }) {
  getDb();
  const info = prepare(`INSERT INTO wf_test_runs (workflow_id, kind, a_use, b_use, a_fp, b_fp, example_ids, tries, quick, cap_usd,
      connectors, status, started_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'running', ?, ?)`)
    .run(workflowId, kind, a == null ? null : useRef(a), useRef(b), aFp, bFp, JSON.stringify(exampleIds), tries,
      quick ? JSON.stringify(quick) : null, capUsd, modeOf(connectors), by, nowIso());
  return readTestRun(Number(info.lastInsertRowid));
}

export function readTestRun(id) {
  getDb();
  return runOf(prepare(`SELECT ${RUN_COLS} FROM wf_test_runs WHERE id = ?`).get(Number(id)));
}

/** Newest first. */
export function listTestRuns(workflowId, { limit = 20 } = {}) {
  getDb();
  return prepare(`SELECT ${RUN_COLS} FROM wf_test_runs WHERE workflow_id = ? ORDER BY id DESC LIMIT ?`).all(workflowId, limit).map(runOf);
}

export function runningTestRun(workflowId) {
  getDb();
  return runOf(prepare(`SELECT ${RUN_COLS} FROM wf_test_runs WHERE workflow_id = ? AND status = 'running' ORDER BY id DESC LIMIT 1`).get(workflowId));
}

const RUN_PATCH = { status: 'status', stopReason: 'stop_reason', stopDetail: 'stop_detail', quick: 'quick', capUsd: 'cap_usd', finishedAt: 'finished_at' };
export function updateTestRun(id, patch = {}) {
  const sets = []; const vals = [];
  for (const [k, col] of Object.entries(RUN_PATCH)) {
    if (patch[k] === undefined) continue;
    sets.push(`${col} = ?`);
    vals.push(k === 'quick' && patch[k] !== null ? JSON.stringify(patch[k]) : patch[k]);
  }
  if (sets.length) { getDb(); prepare(`UPDATE wf_test_runs SET ${sets.join(', ')} WHERE id = ?`).run(...vals, Number(id)); }
  return readTestRun(id);
}

// ── Tries ───────────────────────────────────────────────────────────────────
const TRY_COLS = `t.id, t.run_id, t.workflow_id, t.example_id, t.use_ref, t.fp, t.example_fp, t.try_no, t.mock, t.connectors, t.status,
  t.run_key, t.pipeline_id, t.verdict, t.cost_usd, t.started_at, t.finished_at, t.start_commit, t.disk_bytes, t.setup, t.changes`;
function tryOf(r) {
  if (!r) return null;
  return {
    id: Number(r.id), runId: Number(r.run_id), workflowId: r.workflow_id, exampleId: Number(r.example_id), use: useOf(r.use_ref),
    fp: r.fp, exampleFp: r.example_fp, tryNo: Number(r.try_no), mock: !!r.mock, connectors: modeOf(r.connectors), status: r.status,
    runKey: r.run_key ?? null, pipelineId: r.pipeline_id ?? null, verdict: parse(r.verdict, null), costUsd: Number(r.cost_usd || 0),
    startedAt: r.started_at ?? null, finishedAt: r.finished_at ?? null,
    startCommit: r.start_commit ?? null, diskBytes: r.disk_bytes == null ? null : Number(r.disk_bytes),
    setup: parse(r.setup, null), changes: parse(r.changes, null), ...(r.side ? { side: r.side } : {}),
  };
}

export function insertTry({ runId, workflowId, exampleId, use, fp, exampleFp, tryNo, mock = false, connectors = 'pretend' }) {
  getDb();
  const info = prepare(`INSERT INTO wf_test_tries (run_id, workflow_id, example_id, use_ref, fp, example_fp, try_no, mock, connectors, status)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'waiting')`)
    .run(Number(runId), workflowId, Number(exampleId), useRef(use), fp, exampleFp, tryNo, mock ? 1 : 0, modeOf(connectors));
  return readTry(Number(info.lastInsertRowid));
}

export function readTry(id) {
  getDb();
  return tryOf(prepare(`SELECT ${TRY_COLS} FROM wf_test_tries t WHERE t.id = ?`).get(Number(id)));
}

const TRY_PATCH = { status: 'status', runKey: 'run_key', pipelineId: 'pipeline_id', verdict: 'verdict', costUsd: 'cost_usd',
  startedAt: 'started_at', finishedAt: 'finished_at', startCommit: 'start_commit', diskBytes: 'disk_bytes', setup: 'setup', changes: 'changes' };
export function updateTry(id, patch = {}) {
  const sets = []; const vals = [];
  for (const [k, col] of Object.entries(TRY_PATCH)) {
    if (patch[k] === undefined) continue;
    sets.push(`${col} = ?`);
    vals.push(['verdict', 'setup', 'changes'].includes(k) && patch[k] !== null ? JSON.stringify(patch[k]) : patch[k]);
  }
  if (sets.length) { getDb(); prepare(`UPDATE wf_test_tries SET ${sets.join(', ')} WHERE id = ?`).run(...vals, Number(id)); }
  return readTry(id);
}

export function linkTry(runId, tryId, side) {
  getDb();
  prepare('INSERT OR IGNORE INTO wf_test_run_tries (run_id, try_id, side) VALUES (?, ?, ?)').run(Number(runId), Number(tryId), side);
}

export function unlinkTry(runId, tryId) {
  getDb();
  prepare('DELETE FROM wf_test_run_tries WHERE run_id = ? AND try_id = ?').run(Number(runId), Number(tryId));
}

/** The tries a run shows: its own and the ones it reused, each with its side ('a' | 'b'). */
export function triesOfRun(runId) {
  getDb();
  return prepare(`SELECT ${TRY_COLS}, l.side AS side FROM wf_test_run_tries l JOIN wf_test_tries t ON t.id = l.try_id
      WHERE l.run_id = ? ORDER BY l.side, t.example_id, t.try_no, t.id`).all(Number(runId)).map(tryOf);
}

/** What a run's own tries cost, stopped ones included (D27). Reused tries cost this run nothing. */
export function spentOfRun(runId) {
  getDb();
  const r = prepare('SELECT COALESCE(SUM(cost_usd), 0) AS s FROM wf_test_tries WHERE run_id = ?').get(Number(runId));
  return Math.round(Number(r.s || 0) * 1e6) / 1e6;
}

/** D60: the newest measured checkout size of an example on this start, in bytes (null = never measured). */
export function lastDiskBytes(exampleId, startCommit) {
  getDb();
  const r = prepare(`SELECT disk_bytes AS b FROM wf_test_tries WHERE example_id = ? AND start_commit = ? AND disk_bytes IS NOT NULL
      ORDER BY id DESC LIMIT 1`).get(Number(exampleId), String(startCommit || ''));
  return r ? Number(r.b) : null;
}

/** D60: how long this example's setup took, on average over its last 5 good setups on this start (null = never ran). */
export function avgSetupMs(exampleId, startCommit) {
  getDb();
  const r = prepare(`SELECT AVG(m) AS a, COUNT(*) AS n FROM (SELECT json_extract(setup, '$.ms') AS m FROM wf_test_tries
      WHERE example_id = ? AND start_commit = ? AND json_valid(setup) AND json_extract(setup, '$.ok') = 1 ORDER BY id DESC LIMIT 5)`)
    .get(Number(exampleId), String(startCommit || ''));
  return r && Number(r.n) > 0 && r.a != null ? Math.round(Number(r.a)) : null;
}

/** D26: finished tries of `use` on one example that a new test may reuse, newest first. The connectors mode is part of the key (D35). */
export function reusableTries({ workflowId, exampleId, use, fp, exampleFp, mock = false, connectors = 'pretend', limit }) {
  getDb();
  return prepare(`SELECT ${TRY_COLS} FROM wf_test_tries t WHERE t.workflow_id = ? AND t.example_id = ? AND t.use_ref = ?
      AND t.fp = ? AND t.example_fp = ? AND t.mock = ? AND t.connectors = ? AND t.status IN ('passed', 'failed')
      ORDER BY t.finished_at DESC, t.id DESC LIMIT ?`)
    .all(workflowId, Number(exampleId), useRef(use), fp, exampleFp, mock ? 1 : 0, modeOf(connectors), Math.max(0, Number(limit) || 0)).map(tryOf);
}

/** The finished tries of `use` on one example in the newest run that showed any (the Tests list's cells). */
export function latestTriesFor({ workflowId, exampleId, use }) {
  getDb();
  const last = prepare(`SELECT MAX(l.run_id) AS r FROM wf_test_run_tries l JOIN wf_test_tries t ON t.id = l.try_id
      WHERE t.workflow_id = ? AND t.example_id = ? AND t.use_ref = ? AND t.status IN ('passed', 'failed')`)
    .get(workflowId, Number(exampleId), useRef(use));
  if (!last || last.r == null) return [];
  return prepare(`SELECT ${TRY_COLS} FROM wf_test_run_tries l JOIN wf_test_tries t ON t.id = l.try_id
      WHERE l.run_id = ? AND t.example_id = ? AND t.use_ref = ? AND t.status IN ('passed', 'failed') ORDER BY t.id`)
    .all(last.r, Number(exampleId), useRef(use)).map(tryOf);
}

/**
 * D27: after a restart nothing drives a running test any more. Its running tries are stopped with what their run spent
 * so far (the cap check of "Finish the rest" counts it), and every try's run loses its resume point: resumeRun refuses a
 * try, so a kept point would only pin a plugin workflow (plugin-workflows.mjs) forever. Called by the server's
 * bootMaintenance, after the stale-run reconcile.
 */
export function recoverInterruptedTestRuns(now = nowIso()) {
  getDb();
  const out = { runs: 0, tries: [] };
  tx(() => {
    out.tries = prepare("SELECT id, pipeline_id FROM wf_test_tries WHERE status = 'running' ORDER BY id").all()
      .map((r) => ({ id: Number(r.id), pipelineId: r.pipeline_id ?? null }));
    prepare(`UPDATE wf_test_tries SET status = 'stopped', finished_at = ?,
        cost_usd = COALESCE((SELECT p.total_cost_usd FROM pipelines p WHERE p.id = wf_test_tries.pipeline_id), cost_usd)
      WHERE status = 'running'`).run(now);
    out.runs = Number(prepare("UPDATE wf_test_runs SET status = 'stopped', stop_reason = 'restart', finished_at = ? WHERE status = 'running'")
      .run(now).changes);
    prepare("UPDATE pipelines SET resume_point = NULL WHERE is_test = 1 AND status IN ('paused', 'interrupted') AND resume_point IS NOT NULL").run();
    // 3a D61: nothing resumes a try, so a paused or interrupted one is stopped; the run-root sweep that follows in
    // bootMaintenance then reclaims its folder (it keeps an interrupted run's root).
    prepare("UPDATE pipelines SET status = 'stopped' WHERE is_test = 1 AND status IN ('paused', 'interrupted')").run();
    // Round 8: a try row that is still created, starting, running or pausing is left alone here: another UI server may share
    // this Worca home and be running it. reconcileStaleRunning (called first at boot) moves a dead owner's row (PID, heartbeat,
    // or an ownerless row past WORCA_STALE_RUN_MS) to interrupted, which the line above then stops.
  });
  return out;
}
