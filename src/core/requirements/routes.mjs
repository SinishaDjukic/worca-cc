// src/core/requirements/routes.mjs
// /api/requirements/* (plans/requirements-design.md §5). One registration call from ui/server.mjs; every
// route in REQUIREMENTS_ROUTES is behind the `requirements` flag (404 while off), and so is the change frame.
import { existsSync, readFileSync } from 'node:fs';
import { requireFlag, flagEnabled } from '../flags.mjs';
import { validateAttachmentUploads } from '../attachment-upload.mjs';
import { attachmentDisposition } from '../download-filename.mjs';
import { costLimitResetPeriod } from '../settings.mjs';
import { gitAvailable, GIT_MISSING } from '../git-available.mjs';
import { actorOf } from '../identity.mjs';
import { listProjects } from '../projects.mjs';
import { workspaceTarget } from '../ask/workflow-deps.mjs';
import { RequirementsError, parseFeatureSeq, SCOPE_TYPES } from './spec.mjs';
import {
  createFeature, requireFeature, listFeatures, listTurns, getContext, setContext, updateFeature, listStarts, latestStart, recentLookCosts,
  getBrief, usableBrief, listBriefs, setBriefSections, deleteBrief, briefUsers, listAttachments,
} from './store.mjs';
import { REQ_ATTACH_LIMITS, REQ_ATT_ID_RE, reqUploadOptions, checkNewFiles } from './attachments.mjs';
import {
  addAttachments, removeAttachment, editSummary, setSend, readAgain, askAttachment, replaceAttachment, ownAttachment, fileView, readEstimates,
  attachmentFile, removeOwnerBodies, stopJobs,
} from './attachment-job.mjs';
import { isStarting, STARTING_MESSAGE } from './starting.mjs';
import { startOrientation, submitAnswers, finishInterview, followUp, retry, isBusy, assertCapacity, interviewModel } from './interview.mjs';
import { listModels } from '../config.mjs';
import { pendingRound } from './round.mjs';
import {
  updateHeader, setSection, releaseSection, addCriterion, editCriterion, removeCriterion, setAssumption, confirmOpenAssumptions, setArchived,
  revertToStart, addToBrief,
} from './edits.mjs';
import { readiness, displayState, changedSince, unaskedRejections, unaskedFiles } from './ready.mjs';
import { startFeature, startView } from './start.mjs';
import { budgetStatus, requirementsWindowedSpendUsd } from '../cost-budget.mjs';
import { renderSpecMarkdown } from './markdown.mjs';
import { saveSpecToCheckout, specFileName } from './save.mjs';
import { assertBriefSection, parseSectionValue, renderBriefMarkdown, briefFileName, briefMatches } from './brief.mjs';
import { makeBrief, isBriefBusy, briefTarget, briefEstimate, briefStaleness } from './brief-job.mjs';

const STATUS = Object.freeze({ BAD_REQUEST: 400, NOT_FOUND: 404, BUSY: 409, CONFLICT: 409, BUDGET: 409, NOT_READY: 409, TOO_LARGE: 413 });
const P = '/api/requirements';

/** Every requirements route, in registration order: the one list registerRequirementsRoutes registers from
 *  and the flag-off test walks, so no route can skip the `requirements` gate unnoticed. */
export const REQUIREMENTS_ROUTES = Object.freeze([
  ['GET', `${P}/context/:scopeType/:scopeKey`], ['PUT', `${P}/context/:scopeType/:scopeKey`],
  // A7 §5: the brief, before the /:seq routes
  ['GET', `${P}/brief/:scopeType/:scopeKey`], ['POST', `${P}/brief/:scopeType/:scopeKey`], ['DELETE', `${P}/brief/:scopeType/:scopeKey`],
  ['GET', `${P}/brief/:scopeType/:scopeKey/markdown`],
  ['PUT', `${P}/brief/:scopeType/:scopeKey/sections/:section`], ['DELETE', `${P}/brief/:scopeType/:scopeKey/sections/:section/edited`],
  // A8 §5: a made brief's documents, before the /:seq routes
  ['POST', `${P}/brief/:scopeType/:scopeKey/documents`],
  ['GET', `${P}/brief/:scopeType/:scopeKey/documents/:attId`], ['PATCH', `${P}/brief/:scopeType/:scopeKey/documents/:attId`],
  ['DELETE', `${P}/brief/:scopeType/:scopeKey/documents/:attId`], ['POST', `${P}/brief/:scopeType/:scopeKey/documents/:attId/replace`],
  ['POST', `${P}/brief/:scopeType/:scopeKey/documents/:attId/ask`], ['POST', `${P}/brief/:scopeType/:scopeKey/documents/:attId/read-again`],
  ['GET', P], ['POST', P],
  ['GET', `${P}/:seq`], ['PATCH', `${P}/:seq`],
  ['POST', `${P}/:seq/answers`], ['POST', `${P}/:seq/finish`], ['POST', `${P}/:seq/retry`], ['POST', `${P}/:seq/look`],
  ['PUT', `${P}/:seq/spec/:section`], ['DELETE', `${P}/:seq/spec/:section/edited`],
  ['POST', `${P}/:seq/criteria`], ['PUT', `${P}/:seq/criteria/:id`], ['DELETE', `${P}/:seq/criteria/:id`],
  ['POST', `${P}/:seq/assumptions`], ['POST', `${P}/:seq/assumptions/:id`], ['POST', `${P}/:seq/follow-up`], ['POST', `${P}/:seq/brief-addition`],
  ['POST', `${P}/:seq/attachments`], ['GET', `${P}/:seq/attachments/:attId`], ['PATCH', `${P}/:seq/attachments/:attId`], ['DELETE', `${P}/:seq/attachments/:attId`],
  ['POST', `${P}/:seq/attachments/:attId/replace`], ['POST', `${P}/:seq/attachments/:attId/ask`], ['POST', `${P}/:seq/attachments/:attId/read-again`],
  ['POST', `${P}/:seq/archive`],
  ['GET', `${P}/:seq/markdown`], ['POST', `${P}/:seq/save`],
  ['POST', `${P}/:seq/start`], ['POST', `${P}/:seq/revert`],
].map(([method, path]) => Object.freeze({ method, path })));

/** The routes whose whole purpose is git (making or refreshing a product brief, Look closer / Look again check out
 *  the code): while git is missing they answer like upstream's GIT_ONLY_ROUTES (ui/server.mjs), 409 GIT_MISSING, but
 *  after the flag's gate, so with the flag off they answer its 404. Creating a feature is not here: without git its
 *  automatic look is skipped (interview.mjs orient). */
export const REQUIREMENTS_GIT_ROUTES = Object.freeze([`POST ${P}/brief/:scopeType/:scopeKey`, `POST ${P}/:seq/look`]);
const needsGit = (_req, res, next) => (gitAvailable() ? next() : res.status(409).json({ error: GIT_MISSING.message, code: GIT_MISSING.code }));

/** The routes whose bodies carry files (A8 D10): ui/server.mjs gives them Ask's JSON window, registered before the global
 *  8 MB parser and behind the flag's gate, so nothing is parsed while the flag is off. POST only. */
export const REQUIREMENTS_UPLOAD_ROUTES = Object.freeze([P, `${P}/:seq/attachments`, `${P}/:seq/attachments/:attId/replace`,
  `${P}/brief/:scopeType/:scopeKey/documents`, `${P}/brief/:scopeType/:scopeKey/documents/:attId/replace`]);
export const REQUIREMENTS_UPLOAD_JSON_LIMIT = Math.ceil(REQ_ATTACH_LIMITS.requestBytes * 4 / 3) + 1024 * 1024;

const briefPathOf = (scopeType, scopeKey) => `${P}/brief/${scopeType}/${encodeURIComponent(scopeKey)}`;

/** The uploads of a body (D7, D10), or BAD_REQUEST / TOO_LARGE with the page's message. */
function uploadsOf(list, opts) {
  const v = validateAttachmentUploads(list, reqUploadOptions(opts));
  if (!v.ok) throw new RequirementsError(v.status === 413 ? 'TOO_LARGE' : 'BAD_REQUEST', v.error);
  return v.files;
}

/** A feature's file routes (D10): editable() (busy, archived), and a start in flight refuses too. */
function featureOwner(seq) {
  const f = requireFeature(seq);
  if (isBusy(seq)) throw new RequirementsError('BUSY', 'Worca is still working on this feature. Try again in a moment.');
  if (f.status === 'archived') throw new RequirementsError('CONFLICT', 'this feature is archived; restore it first');
  if (isStarting(seq)) throw new RequirementsError('BUSY', STARTING_MESSAGE);
  return { type: 'feature', id: f.seq };
}
/** A made brief's documents (D2): allowed while a refresh runs (A7-D6). */
function briefOwner(scopeType, scopeKey) {
  const b = madeBrief(scopeType, scopeKey);
  return { type: 'brief', id: b.id, scopeType, scopeKey: b.scopeKey };
}
const attIdOf = (req) => {
  const id = String(req.params.attId || '');
  if (!REQ_ATT_ID_RE.test(id)) throw new RequirementsError('NOT_FOUND', 'file not found');
  return id;
};
const bool = (v, field) => {
  if (typeof v !== 'boolean') throw new RequirementsError('BAD_REQUEST', `${field} must be true or false`);
  return v;
};

// A file route's failure that is not one of Worca's own refusals (a disk or database error) answers product copy; the
// raw error, which can name a path, goes to the log only (D15).
const FILE_ROUTE_FAILED = 'Worca could not finish that. Try again.';
const STORED_FILE = 'Worca could not open the stored file. Remove it and attach it again.';
const fileRoute = (fn, copy = FILE_ROUTE_FAILED) => async (req, res) => {
  try { await fn(req, res); } catch (err) {
    if (err instanceof RequirementsError) throw err;
    console.error(`requirements: ${req.method} ${req.route ? req.route.path : 'a file route'} failed:`, err && err.message ? err.message : err);
    throw new Error(copy);
  }
};

/** D10: Ask's download headers, except caching: Replace changes a body under the same id. A replace whose new version
 *  could not be stored (STORE_FAILED) is refused by its row, whatever is on disk (a lock can leave the old body there). */
function sendBody(req, res, row) {
  if (row.status === 'failed' && row.error && row.error.code === 'STORE_FAILED') throw new RequirementsError('NOT_FOUND', row.error.message);
  const file = attachmentFile(row);
  if (!existsSync(file)) throw new RequirementsError('NOT_FOUND', 'file not found');
  const etag = `"${row.sha256}"`;
  const fresh = req.headers['if-none-match'] === etag;
  const body = fresh ? null : readFileSync(file);   // before any header: a failed read answers JSON, not a typed body
  res.set({ 'Content-Type': row.kind === 'text' ? 'text/plain; charset=utf-8' : row.mime, 'X-Content-Type-Options': 'nosniff',
    // download-filename.mjs: a lone surrogate never throws, bidi controls cannot spoof the name, an ASCII fallback for old clients
    'Content-Disposition': attachmentDisposition(row.name).replace(/^attachment;/, 'inline;'), 'Cache-Control': 'private, no-cache', ETag: etag });
  return fresh ? res.status(304).end() : res.send(body);
}

/** The change hook every requirements change goes through: a `requirements-changed` frame, only while the
 *  flag is on (read at send time, so turning the flag off silences jobs already running). */
export function requirementsChangeNotifier(broadcast) {
  return (seq) => { if (flagEnabled('requirements')) broadcast({ type: 'requirements-changed', seq: Number(seq) }); };
}

/** The brief change hook (A7 §5 Frames): `{ type: 'requirements-changed', brief: '<scopeType>:<scopeKey>' }`, no
 *  `seq`, only while the flag is on (read at send time, so a brief job still running goes silent with the flag). */
export function requirementsBriefNotifier(broadcast) {
  return (scopeType, scopeKey) => {
    if (flagEnabled('requirements')) broadcast({ type: 'requirements-changed', brief: `${scopeType}:${scopeKey}` });
  };
}

const noSummary = () => null;

/** What the feature page shows of its scope's brief (A7 §5, board 14): its id (a closer look made against another
 *  brief offers no Add), status and age, the sources, the area names and terms the feature mentions, and the
 *  switch; null without a usable brief. */
function featureBrief(f) {
  const b = usableBrief(f.scopeType, f.scopeKey);
  if (!b) return null;
  const m = briefMatches(b.sections, f);
  return { id: b.id, status: b.status, madeAt: b.madeAt, sources: b.sources, matches: m.names, matchesMore: m.more,
    lookAtCode: getContext(f.scopeType, f.scopeKey).lookAtCode };
}

/** A feature's view (A1 §5, A2 §4): the stored feature plus what the page derives nothing of itself:
 *  readiness, the displayed state, the unasked rejections, the starts (newest first; the newest with its
 *  frozen spec, for the version switch) and the changes since the latest start. */
export async function featureView(seq, d = {}) {
  const f = requireFeature(seq);
  const turns = listTurns(seq);
  const last = turns.filter((t) => t.kind !== 'file').at(-1);   // A8: a file's turns never hide the error line
  const busy = isBusy(seq);
  const pending = f.status === 'your_turn' ? pendingRound(turns) : null;
  const files = listAttachments('feature', seq);
  const brief = usableBrief(f.scopeType, f.scopeKey);
  const docs = brief ? listAttachments('brief', brief.id) : [];
  const ready = readiness({ ...f, pending }, { turns, target: await targetFor(f), files });
  const rows = listStarts(seq);
  const runSummary = d.runSummary || noSummary;
  const starts = await Promise.all(rows.map(async (s, i) => ({ ...(await startView(s, runSummary)), ...(i === 0 ? { spec: s.spec } : {}) })));
  // One model resolution per view: "Look closer · about $X" (the same model-scoped estimate as the New feature line, all
  // looks when unresolved) and the privacy note's model (A8 D15)
  let im = null;
  try { im = (await (d.interviewModel || interviewModel)(d)) || null; } catch { im = null; }
  const model = (im && im.model) || null;
  const estimates = readEstimates();   // once per view, not once per file
  return {
    feature: { ...f, busy, pending, lastError: last && last.kind === 'error' ? last.payload.message : null,
      readiness: ready, state: displayState({ ...f, busy }, { ready, starts: rows }), unaskedRejections: unaskedRejections(f.spec, turns),
      starts, changedSinceStart: rows.length ? changedSince(rows[0].spec, f.spec) : [],
      brief: featureBrief(f), lookCostUsd: lookCostUsd(model),
      attachments: files.map((r) => fileView(r, { spec: f.spec, href: `${P}/${seq}/attachments/${r.id}`, estimates })),
      briefDocuments: docs.map((r) => fileView(r, { spec: f.spec, href: `${briefPathOf(f.scopeType, f.scopeKey)}/documents/${r.id}`, doc: true, estimates })),
      unaskedFiles: unaskedFiles(files, turns),
      interview: await interviewInfo(async () => im, d.listModels || listModels),
      resetPeriod: resetPeriod() },
    turns,
  };
}

/** One list row: no spec, orientation or description; the derived state, the Ready count, the pending
 *  round's question count (0 unless it is the person's turn), the open assumptions and the latest start's
 *  run. `targetOf` caches the target per scope for one list call. */
async function summary(f, targetOf, runSummary) {
  const { spec, orientation, description, ...rest } = f;
  const busy = isBusy(f.seq);
  const turns = listTurns(f.seq);
  const pending = f.status === 'your_turn' ? pendingRound(turns) : null;
  const ready = readiness({ ...f, pending }, { turns, target: await targetOf(f), files: listAttachments('feature', f.seq) });
  const latest = latestStart(f.seq);
  return { ...rest, busy, state: displayState({ ...f, busy }, { ready, starts: latest ? [latest] : [] }), ready: ready.passed,
    pendingCount: pending && Array.isArray(pending.questions) ? pending.questions.length : 0,
    openAssumptions: ((spec && spec.assumptions) || []).filter((a) => a.status === 'open').length,
    latestRun: latest ? (await startView(latest, runSummary)).run : null };
}

/** Median of the recent code-look costs, for the New feature page's hint: the looks made on `model` when there
 *  are any, else all recent looks (null when there are none at all). */
function lookCostUsd(model = null) {
  let costs = model ? recentLookCosts(10, { model }) : [];
  if (!costs.length) costs = recentLookCosts(10);
  costs = costs.sort((a, b) => a - b);
  if (!costs.length) return null;
  const m = costs.length >> 1;
  const mid = costs.length % 2 ? costs[m] : (costs[m - 1] + costs[m]) / 2;
  return Math.round(mid * 1e4) / 1e4;
}

/** The interview's model for the New feature line: { model, label, effort, source }, or null when it cannot be told. */
async function interviewInfo(resolve, list) {
  try {
    const im = await resolve();
    if (!im || !im.model) return null;
    const entry = (await list('')).find((m) => m && m.id === im.model);
    return { model: im.model, label: (entry && entry.label) || im.model, effort: im.effort ?? null, source: im.source };
  } catch { return null; }
}

/** Requirements spend in the budget window budgetStatus() uses, the total limit (null: none) and the
 *  window's period ('weekly' | 'monthly'), so the page names the right one. */
function requirementsSpend() {
  const b = budgetStatus();
  return { windowUsd: requirementsWindowedSpendUsd(b.windowStartMs), totalLimitUsd: b.totalLimitUsd ?? null,
    resetPeriod: b.resetPeriod === 'weekly' ? 'weekly' : 'monthly' };
}

/** The budget window's period alone (A8: "for this <month | week>"), the list's `spend.resetPeriod` values. It reads only
 *  the setting, never the spend, so a view never fails on the budget; 'monthly' when the setting cannot be read. */
function resetPeriod() {
  try { return costLimitResetPeriod() === 'weekly' ? 'weekly' : 'monthly'; } catch { return 'monthly'; }
}

const BRIEF_FIELDS = ['id', 'scopeType', 'scopeKey', 'status', 'sections', 'edited', 'sources', 'files', 'seed', 'model',
  'costUsd', 'error', 'madeBy', 'madeAt', 'updatedAt'];
const briefFields = (b) => (b ? Object.fromEntries(BRIEF_FIELDS.map((k) => [k, b[k]])) : null);

/**
 * The brief page's body (A7 §5): `{ brief, target: { name, branch, repositories, leftOut, slow }, notes, estimate, usedBy,
 * staleness }`. `branch` is the default branch the next look reads (a project; a workspace: null), `repositories`
 * how many repositories it reads (0: there is no repository to look at, unless `slow` names some), `leftOut` the
 * workspace members past the checkout cap, `slow` the repositories whose default branch could not be read in
 * time. The target's git probes and the staleness check run side by side, each bounded by STALENESS_TIMEOUT_MS
 * (D9), so a slow repository never holds the page for much longer than that. `known` is a briefTarget already read
 * (makeBrief's), so a create does not probe git twice.
 */
async function briefPage(scopeType, scopeKey, t, d, known = null) {
  const b = getBrief(scopeType, scopeKey);
  const [target, estimate, staleness] = await Promise.all([
    // without git nothing is known about the code: no probe, and never a reason ('branch-gone') that is not true
    known || briefTarget(scopeType, scopeKey, d), briefEstimate(d), b ? (gitAvailable() ? briefStaleness(b, d) : { known: false, reason: 'no-git' }) : null,
  ]);
  const first = scopeType === 'project' ? target.dirs[0] : null;
  const estimates = b && b.madeAt ? readEstimates() : null;
  return {
    brief: briefFields(b),
    target: { name: t.name, branch: (first && first.base && first.base.branch) || null, repositories: target.dirs.length,
      leftOut: target.leftOut || [], slow: target.slow || [] },
    notes: getContext(scopeType, scopeKey), estimate, usedBy: briefUsers(scopeType, scopeKey), staleness,
    // A8 §5: a made brief's documents, the interview model (the privacy note) and the budget's period
    documents: b && b.madeAt ? listAttachments('brief', b.id).map((r) => fileView(r, { href: `${briefPathOf(scopeType, scopeKey)}/documents/${r.id}`,
      doc: true, estimates })) : [],
    interview: await interviewInfo(() => (d.interviewModel || interviewModel)(d), d.listModels || listModels),
    resetPeriod: resetPeriod(),
  };
}

/** The scope's brief once made (the owner edits only a made brief), else CONFLICT. */
function madeBrief(scopeType, scopeKey) {
  const b = usableBrief(scopeType, scopeKey);
  if (!b) throw new RequirementsError('CONFLICT', 'There is no brief yet.');
  return b;
}

async function checkTarget(scopeType, scopeKey) {
  if (!SCOPE_TYPES.includes(scopeType)) throw new RequirementsError('BAD_REQUEST', 'scopeType must be "project" or "workspace"');
  if (typeof scopeKey !== 'string' || !scopeKey.trim()) throw new RequirementsError('BAD_REQUEST', 'scopeKey is required');
  if (scopeType === 'project') {
    const p = (await listProjects()).find((x) => x.key === scopeKey);
    if (!p) throw new RequirementsError('BAD_REQUEST', 'unknown project');
    // A registered project whose folder is gone still passes here (create, context); readiness says so.
    return p.exists
      ? { name: p.name, path: p.path, exists: true, ok: true, label: `Project ${p.name} is registered` }
      : { name: p.name, path: p.path, exists: false, ok: false, hint: `the folder of project ${p.name} is missing` };
  }
  const ws = await workspaceTarget(scopeKey);
  if (!ws) throw new RequirementsError('BAD_REQUEST', 'unknown workspace');
  return { name: ws.name, ok: true, label: `Workspace ${ws.name} exists` };
}

/** The feature's target for readiness: never throws; an unknown target is `{ ok: false, hint }`. */
async function targetFor(f) {
  try { return await checkTarget(f.scopeType, f.scopeKey); } catch {
    return { ok: false, hint: f.scopeType === 'workspace' ? 'the workspace no longer exists' : 'the project is not registered' };
  }
}

/**
 * @param {import('express').Express} app
 * @param {{ broadcast:(frame:object)=>void, deps?:object }} o  deps reach the interview runner (tests)
 */
export function registerRequirementsRoutes(app, { broadcast, deps = {} } = {}) {
  const gate = requireFlag('requirements');
  const onChange = requirementsChangeNotifier(broadcast);
  const onBriefChange = requirementsBriefNotifier(broadcast);
  // The file jobs notify both: a document a round re-queues (queueUnread) repaints the brief page too.
  const d = { ...deps, onChange, onBriefChange };
  const briefDeps = { ...deps, onChange: onBriefChange };   // the brief job's onChange names a scope, not a feature
  const handle = (fn) => async (req, res) => {
    try { await fn(req, res); }
    catch (err) {
      const status = (err && STATUS[err.code]) || 500;
      const data = err instanceof RequirementsError && err.data && typeof err.data === 'object' ? err.data : {};
      res.status(status).json({ ...data, error: err && err.message ? err.message : String(err) });
    }
  };
  const seqOf = (req) => {
    const seq = parseFeatureSeq(req.params.seq);
    if (seq == null) throw new RequirementsError('NOT_FOUND', 'feature not found');
    return seq;
  };
  const by = (req) => actorOf(req);
  const changed = async (res, seq, code = 200) => { onChange(seq); res.status(code).json(await featureView(seq, d)); };
  const scope = (req) => [req.params.scopeType, req.params.scopeKey];
  const briefChanged = async (res, [scopeType, scopeKey], t) => {
    onBriefChange(scopeType, scopeKey);
    res.json(await briefPage(scopeType, scopeKey, t, briefDeps));
  };
  // A file route answers without a frame of its own: the file job sent it.
  const answer = async (res, seq, code = 200) => res.status(code).json(await featureView(seq, d));
  const answerBrief = async (req, res, t, code = 200) => res.status(code).json(await briefPage(...scope(req), t, briefDeps));
  const oneUpload = (b, owner) => {
    const [file] = uploadsOf(Array.isArray(b.attachments) ? b.attachments.slice(0, 1) : b.attachments, { owner });
    if (!file) throw new RequirementsError('BAD_REQUEST', 'send one file in "attachments"');
    return file;
  };

  const handlers = {
    [`GET ${P}/context/:scopeType/:scopeKey`]: async (req, res) => {
      await checkTarget(req.params.scopeType, req.params.scopeKey);
      res.json(getContext(req.params.scopeType, req.params.scopeKey));
    },
    [`PUT ${P}/context/:scopeType/:scopeKey`]: async (req, res) => {
      await checkTarget(req.params.scopeType, req.params.scopeKey);
      const b = req.body || {};
      const ctx = setContext(req.params.scopeType, req.params.scopeKey, { body: b.body, lookAtCode: b.lookAtCode }, { by: by(req) });
      // The switch shows on the brief page, the list's briefs and the feature view's brief: they repaint on the brief frame.
      onBriefChange(req.params.scopeType, req.params.scopeKey);
      res.json(ctx);
    },
    [`GET ${P}/brief/:scopeType/:scopeKey`]: async (req, res) => {
      const t = await checkTarget(...scope(req));
      res.json(await briefPage(...scope(req), t, briefDeps));
    },
    [`POST ${P}/brief/:scopeType/:scopeKey`]: async (req, res) => {
      const t = await checkTarget(...scope(req));
      // The refusals reject before anything is written; the job is not awaited (it never rejects, and it sends
      // the scope's frames itself as it starts and as it settles).
      const { target } = await makeBrief(...scope(req), { by: by(req) }, briefDeps);
      res.status(202).json(await briefPage(...scope(req), t, briefDeps, target));
    },
    [`DELETE ${P}/brief/:scopeType/:scopeKey`]: async (req, res) => {
      const t = await checkTarget(...scope(req));
      if (isBriefBusy(...scope(req))) throw new RequirementsError('BUSY', 'Worca is making this brief. Try again when it is done.');
      const b0 = getBrief(...scope(req));
      const docs = b0 ? listAttachments('brief', b0.id) : [];
      stopJobs(docs.map((x) => x.id));
      deleteBrief(...scope(req));   // A8 D9: its documents' rows go in the same transaction
      removeOwnerBodies(docs);      // then their bodies
      await briefChanged(res, scope(req), t);
    },
    [`GET ${P}/brief/:scopeType/:scopeKey/markdown`]: async (req, res) => {
      const t = await checkTarget(...scope(req));
      const b = usableBrief(...scope(req));
      if (!b) throw new RequirementsError('NOT_FOUND', 'There is no brief yet.');
      const ws = b.scopeType === 'workspace' ? await workspaceTarget(b.scopeKey) : null;
      const projectNames = Object.fromEntries(((ws && ws.members) || []).map((m) => [m.projectKey, m.projectName || m.projectKey]));
      res.type('text/markdown; charset=utf-8');
      if (req.query && req.query.download === '1') res.set('Content-Disposition', `attachment; filename="${briefFileName(t.name)}"`);
      res.send(renderBriefMarkdown(b, { scopeLabel: t.name, projectNames }));
    },
    [`PUT ${P}/brief/:scopeType/:scopeKey/sections/:section`]: async (req, res) => {
      const t = await checkTarget(...scope(req));
      const section = assertBriefSection(req.params.section);
      const b = madeBrief(...scope(req));
      const value = parseSectionValue(section, (req.body || {}).value, b.sections);
      setBriefSections(b.id, { sections: { ...b.sections, [section]: value }, edited: { ...b.edited, [section]: true } }, { by: by(req) });
      await briefChanged(res, scope(req), t);
    },
    [`DELETE ${P}/brief/:scopeType/:scopeKey/sections/:section/edited`]: async (req, res) => {
      const t = await checkTarget(...scope(req));
      const section = assertBriefSection(req.params.section);
      const b = madeBrief(...scope(req));
      if (!(b.edited && b.edited[section])) return res.json(await briefPage(...scope(req), t, briefDeps));   // nothing to release
      const edited = { ...b.edited };
      delete edited[section];
      setBriefSections(b.id, { sections: b.sections, edited }, { by: by(req) });
      await briefChanged(res, scope(req), t);
    },
    [`POST ${P}/brief/:scopeType/:scopeKey/documents`]: fileRoute(async (req, res) => {
      const t = await checkTarget(...scope(req));
      const owner = briefOwner(...scope(req));
      addAttachments(owner, uploadsOf((req.body || {}).attachments, { owner: 'brief' }), { by: by(req) }, d);
      await answerBrief(req, res, t, 202);
    }),
    [`GET ${P}/brief/:scopeType/:scopeKey/documents/:attId`]: fileRoute(async (req, res) => {   // a read: no lock
      await checkTarget(...scope(req));
      sendBody(req, res, ownAttachment(briefOwner(...scope(req)), attIdOf(req)));
    }, STORED_FILE),
    [`PATCH ${P}/brief/:scopeType/:scopeKey/documents/:attId`]: fileRoute(async (req, res) => {
      const t = await checkTarget(...scope(req));
      const owner = briefOwner(...scope(req));
      const id = attIdOf(req);
      const b = req.body || {};
      if (b.sendWithEveryRun !== undefined) bool(b.sendWithEveryRun, 'sendWithEveryRun');
      if (b.summary !== undefined) editSummary(owner, id, b.summary, { by: by(req) }, d);
      if (b.sendWithEveryRun !== undefined) setSend(owner, id, b.sendWithEveryRun, { by: by(req) }, d);
      await answerBrief(req, res, t);
    }),
    [`DELETE ${P}/brief/:scopeType/:scopeKey/documents/:attId`]: fileRoute(async (req, res) => {
      const t = await checkTarget(...scope(req));
      removeAttachment(briefOwner(...scope(req)), attIdOf(req), { by: by(req) }, d);
      await answerBrief(req, res, t);
    }),
    [`POST ${P}/brief/:scopeType/:scopeKey/documents/:attId/replace`]: fileRoute(async (req, res) => {
      const t = await checkTarget(...scope(req));
      const owner = briefOwner(...scope(req));
      const b = req.body || {};
      replaceAttachment(owner, attIdOf(req), oneUpload(b, 'brief'), { keepSummary: b.keepSummary === true, by: by(req) }, d);
      await answerBrief(req, res, t, 202);
    }),
    [`POST ${P}/brief/:scopeType/:scopeKey/documents/:attId/ask`]: fileRoute(async (req, res) => {
      const t = await checkTarget(...scope(req));
      askAttachment(briefOwner(...scope(req)), attIdOf(req), (req.body || {}).question, { by: by(req) }, d);
      await answerBrief(req, res, t, 202);
    }),
    [`POST ${P}/brief/:scopeType/:scopeKey/documents/:attId/read-again`]: fileRoute(async (req, res) => {
      const t = await checkTarget(...scope(req));
      readAgain(briefOwner(...scope(req)), attIdOf(req), { by: by(req) }, d);
      await answerBrief(req, res, t, 202);
    }),
    [`GET ${P}`]: async (req, res) => {
      const q = req.query || {};
      const targets = new Map();
      const targetOf = (f) => {
        const k = `${f.scopeType}:${f.scopeKey}`;
        if (!targets.has(k)) targets.set(k, targetFor(f));
        return targets.get(k);
      };
      const list = listFeatures({ scopeType: q.scopeType || null, scopeKey: q.scopeKey || null, archived: q.archived === '1' });
      const features = await Promise.all(list.map((f) => summary(f, targetOf, d.runSummary || noSummary)));
      const interview = await interviewInfo(() => (d.interviewModel || interviewModel)(d), d.listModels || listModels);
      const briefs = listBriefs().map((b) => ({ ...b, lookAtCode: getContext(b.scopeType, b.scopeKey).lookAtCode }));
      res.json({ features, interview, lookCostUsd: lookCostUsd(interview && interview.model), spend: requirementsSpend(), briefs,
        readEstimates: readEstimates() });   // the New feature line's "about $X a file" (board 15)
    },
    [`POST ${P}`]: fileRoute(async (req, res) => {
      const b = req.body || {};
      await checkTarget(b.scopeType, b.scopeKey);
      // A8 D2: the files are checked before anything is created, then stored and queued before the orientation
      const files = b.attachments === undefined ? [] : checkNewFiles('feature', [], uploadsOf(b.attachments, { owner: 'feature', create: true }));
      assertCapacity();   // before creating: a refused start must not leave a feature stuck at "looking"
      const f = createFeature({ scopeType: b.scopeType, scopeKey: b.scopeKey, title: b.title, description: b.description }, { by: by(req) });
      try {
        if (files.length) addAttachments({ type: 'feature', id: f.seq }, files, { by: by(req) }, d);
      } finally {
        startOrientation(f.seq, { by: by(req) }, d);   // a file that could not be stored never leaves the feature stuck at "looking"
      }
      await changed(res, f.seq, 201);
    }),
    [`GET ${P}/:seq`]: async (req, res) => res.json(await featureView(seqOf(req), d)),
    [`PATCH ${P}/:seq`]: async (req, res) => {
      const seq = seqOf(req);
      const b = req.body || {};
      if (b.scopeType !== undefined || b.scopeKey !== undefined) await checkTarget(b.scopeType, b.scopeKey);
      updateHeader(seq, b, { by: by(req) });
      await changed(res, seq);
    },
    [`POST ${P}/:seq/answers`]: async (req, res) => {
      const seq = seqOf(req);
      submitAnswers(seq, req.body || {}, { by: by(req) }, d);
      await changed(res, seq, 202);
    },
    [`POST ${P}/:seq/finish`]: async (req, res) => {
      const seq = seqOf(req);
      finishInterview(seq, { by: by(req) }, d);
      await changed(res, seq, 202);
    },
    [`POST ${P}/:seq/retry`]: async (req, res) => {
      const seq = seqOf(req);
      retry(seq, { by: by(req) }, d);
      await changed(res, seq, 202);
    },
    [`POST ${P}/:seq/look`]: async (req, res) => {
      const seq = seqOf(req);
      startOrientation(seq, { by: by(req), thenRound: false }, d);
      await changed(res, seq, 202);
    },
    [`PUT ${P}/:seq/spec/:section`]: async (req, res) => {
      const seq = seqOf(req);
      setSection(seq, req.params.section, (req.body || {}).value, { by: by(req) });
      await changed(res, seq);
    },
    [`DELETE ${P}/:seq/spec/:section/edited`]: async (req, res) => {
      const seq = seqOf(req);
      releaseSection(seq, req.params.section, { by: by(req) });
      await changed(res, seq);
    },
    [`POST ${P}/:seq/criteria`]: async (req, res) => {
      const seq = seqOf(req);
      addCriterion(seq, (req.body || {}).text, { by: by(req) });
      await changed(res, seq);
    },
    [`PUT ${P}/:seq/criteria/:id`]: async (req, res) => {
      const seq = seqOf(req);
      editCriterion(seq, req.params.id, (req.body || {}).text, { by: by(req) });
      await changed(res, seq);
    },
    [`DELETE ${P}/:seq/criteria/:id`]: async (req, res) => {
      const seq = seqOf(req);
      removeCriterion(seq, req.params.id, { by: by(req) });
      await changed(res, seq);
    },
    [`POST ${P}/:seq/assumptions`]: async (req, res) => {
      const seq = seqOf(req);
      if ((req.body || {}).confirmOpen !== true) throw new RequirementsError('BAD_REQUEST', 'send { "confirmOpen": true }');
      confirmOpenAssumptions(seq, { by: by(req) });
      await changed(res, seq);
    },
    [`POST ${P}/:seq/follow-up`]: async (req, res) => {
      const seq = seqOf(req);
      followUp(seq, { by: by(req) }, d);
      await changed(res, seq, 202);
    },
    [`POST ${P}/:seq/brief-addition`]: async (req, res) => {
      const seq = seqOf(req);
      const { scopeType, scopeKey } = addToBrief(seq, { by: by(req) });
      onBriefChange(scopeType, scopeKey);
      await changed(res, seq);
    },
    [`POST ${P}/:seq/attachments`]: fileRoute(async (req, res) => {
      const seq = seqOf(req);
      const owner = featureOwner(seq);
      addAttachments(owner, uploadsOf((req.body || {}).attachments, { owner: 'feature' }), { by: by(req) }, d);
      await answer(res, seq, 202);
    }),
    [`GET ${P}/:seq/attachments/:attId`]: fileRoute(async (req, res) => {   // a read: no lock
      const seq = seqOf(req);
      requireFeature(seq);
      sendBody(req, res, ownAttachment({ type: 'feature', id: seq }, attIdOf(req)));
    }, STORED_FILE),
    [`PATCH ${P}/:seq/attachments/:attId`]: fileRoute(async (req, res) => {
      const seq = seqOf(req);
      const owner = featureOwner(seq);
      const id = attIdOf(req);
      const b = req.body || {};
      if (b.sendWithRun !== undefined) bool(b.sendWithRun, 'sendWithRun');
      if (b.summary !== undefined) editSummary(owner, id, b.summary, { by: by(req) }, d);
      if (b.sendWithRun !== undefined) setSend(owner, id, b.sendWithRun, { by: by(req) }, d);
      await answer(res, seq);
    }),
    [`DELETE ${P}/:seq/attachments/:attId`]: fileRoute(async (req, res) => {
      const seq = seqOf(req);
      removeAttachment(featureOwner(seq), attIdOf(req), { by: by(req) }, d);
      await answer(res, seq);
    }),
    [`POST ${P}/:seq/attachments/:attId/replace`]: fileRoute(async (req, res) => {
      const seq = seqOf(req);
      const owner = featureOwner(seq);
      const b = req.body || {};
      replaceAttachment(owner, attIdOf(req), oneUpload(b, 'feature'), { keepSummary: b.keepSummary === true, by: by(req) }, d);
      await answer(res, seq, 202);
    }),
    [`POST ${P}/:seq/attachments/:attId/ask`]: fileRoute(async (req, res) => {
      const seq = seqOf(req);
      askAttachment(featureOwner(seq), attIdOf(req), (req.body || {}).question, { by: by(req) }, d);
      await answer(res, seq, 202);
    }),
    [`POST ${P}/:seq/attachments/:attId/read-again`]: fileRoute(async (req, res) => {
      const seq = seqOf(req);
      readAgain(featureOwner(seq), attIdOf(req), { by: by(req) }, d);
      await answer(res, seq, 202);
    }),
    [`POST ${P}/:seq/assumptions/:id`]: async (req, res) => {
      const seq = seqOf(req);
      setAssumption(seq, req.params.id, (req.body || {}).status, { by: by(req) });
      await changed(res, seq);
    },
    [`POST ${P}/:seq/archive`]: async (req, res) => {
      const seq = seqOf(req);
      setArchived(seq, (req.body || {}).restore !== true, { by: by(req) });
      await changed(res, seq);
    },
    [`GET ${P}/:seq/markdown`]: async (req, res) => {
      const f = requireFeature(seqOf(req));
      const t = await checkTarget(f.scopeType, f.scopeKey).catch(() => ({ name: null }));
      res.type('text/markdown; charset=utf-8');
      if (req.query && req.query.download === '1') res.set('Content-Disposition', `attachment; filename="${specFileName(f)}"`);
      res.send(renderSpecMarkdown(f, { targetName: t.name }));
    },
    [`POST ${P}/:seq/save`]: async (req, res) => {
      const seq = seqOf(req);
      const f = requireFeature(seq);
      if (f.scopeType !== 'project') throw new RequirementsError('CONFLICT', 'a workspace feature has no single repository to save into; use Download .md');
      const t = await checkTarget(f.scopeType, f.scopeKey);
      if (!t.exists) throw new RequirementsError('CONFLICT', "the project's folder is missing");
      const r = await saveSpecToCheckout({ projectDir: t.path, feature: f, markdown: renderSpecMarkdown(f, { targetName: t.name }), overwrite: (req.body || {}).overwrite === true });
      if (!r.ok) return res.status(r.status).json({ error: r.error, ...(r.path ? { path: r.path } : {}) });
      updateFeature(seq, { savedPath: r.path }, { by: by(req) });
      onChange(seq);
      res.json({ path: r.path });
    },
    [`POST ${P}/:seq/start`]: async (req, res) => {
      const seq = seqOf(req);
      const f = requireFeature(seq);
      if (typeof d.startRun !== 'function') throw new Error('starting runs is not available');
      const b = req.body || {};
      const r = await startFeature(seq, { reason: b.reason, workflowId: b.workflowId, sourceBranch: b.sourceBranch },
        { by: by(req) }, { startRun: d.startRun, target: await targetFor(f) });
      onChange(seq);
      res.status(201).json({ runId: r.runId, version: r.version, ...await featureView(seq, d) });
    },
    [`POST ${P}/:seq/revert`]: async (req, res) => {
      const seq = seqOf(req);
      const v = (req.body || {}).version;
      if (!Number.isInteger(v) || v < 1) throw new RequirementsError('BAD_REQUEST', 'version must be a whole number of at least 1');
      revertToStart(seq, v, { by: by(req) });
      await changed(res, seq);
    },
  };

  // The table and the handlers must name the same routes: a route without a table row would skip the
  // flag-off test, a row without a handler would register nothing.
  const keys = REQUIREMENTS_ROUTES.map((r) => `${r.method} ${r.path}`);
  const odd = [...keys.filter((k) => !handlers[k]), ...Object.keys(handlers).filter((k) => !keys.includes(k))];
  if (odd.length) throw new Error(`requirements routes: the table and the handlers differ (${odd.join(', ')})`);
  for (const { method, path } of REQUIREMENTS_ROUTES) {
    const key = `${method} ${path}`;
    app[method.toLowerCase()](path, gate, ...(REQUIREMENTS_GIT_ROUTES.includes(key) ? [needsGit] : []), handle(handlers[key]));
  }
}
