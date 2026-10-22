// src/core/requirements/routes.mjs
// /api/requirements/* (plans/requirements-design.md §5). One registration call from ui/server.mjs; every
// route in REQUIREMENTS_ROUTES is behind the `requirements` flag (404 while off), and so is the change frame.
import { requireFlag, flagEnabled } from '../flags.mjs';
import { actorOf } from '../identity.mjs';
import { listProjects } from '../projects.mjs';
import { workspaceTarget } from '../ask/workflow-deps.mjs';
import { RequirementsError, parseFeatureSeq, SCOPE_TYPES } from './spec.mjs';
import {
  createFeature, requireFeature, listFeatures, listTurns, getContext, setContext, updateFeature, listStarts, latestStart, recentLookCosts,
  getBrief, usableBrief, listBriefs, setBriefSections, deleteBrief, briefUsers,
} from './store.mjs';
import { startOrientation, submitAnswers, finishInterview, followUp, retry, isBusy, assertCapacity } from './interview.mjs';
import { pendingRound } from './round.mjs';
import {
  updateHeader, setSection, releaseSection, addCriterion, editCriterion, removeCriterion, setAssumption, confirmOpenAssumptions, setArchived,
  revertToStart, addToBrief,
} from './edits.mjs';
import { readiness, displayState, changedSince, unaskedRejections } from './ready.mjs';
import { startFeature, startView } from './start.mjs';
import { budgetStatus, requirementsWindowedSpendUsd } from '../cost-budget.mjs';
import { renderSpecMarkdown } from './markdown.mjs';
import { saveSpecToCheckout, specFileName } from './save.mjs';
import { assertBriefSection, parseSectionValue, renderBriefMarkdown, briefFileName, briefMatches } from './brief.mjs';
import { makeBrief, isBriefBusy, briefTarget, briefEstimate, briefStaleness } from './brief-job.mjs';

const STATUS = Object.freeze({ BAD_REQUEST: 400, NOT_FOUND: 404, BUSY: 409, CONFLICT: 409, BUDGET: 409, NOT_READY: 409 });
const P = '/api/requirements';

/** Every requirements route, in registration order: the one list registerRequirementsRoutes registers from
 *  and the flag-off test walks, so no route can skip the `requirements` gate unnoticed. */
export const REQUIREMENTS_ROUTES = Object.freeze([
  ['GET', `${P}/context/:scopeType/:scopeKey`], ['PUT', `${P}/context/:scopeType/:scopeKey`],
  // A7 §5: the brief, before the /:seq routes
  ['GET', `${P}/brief/:scopeType/:scopeKey`], ['POST', `${P}/brief/:scopeType/:scopeKey`], ['DELETE', `${P}/brief/:scopeType/:scopeKey`],
  ['GET', `${P}/brief/:scopeType/:scopeKey/markdown`],
  ['PUT', `${P}/brief/:scopeType/:scopeKey/sections/:section`], ['DELETE', `${P}/brief/:scopeType/:scopeKey/sections/:section/edited`],
  ['GET', P], ['POST', P],
  ['GET', `${P}/:seq`], ['PATCH', `${P}/:seq`],
  ['POST', `${P}/:seq/answers`], ['POST', `${P}/:seq/finish`], ['POST', `${P}/:seq/retry`], ['POST', `${P}/:seq/look`],
  ['PUT', `${P}/:seq/spec/:section`], ['DELETE', `${P}/:seq/spec/:section/edited`],
  ['POST', `${P}/:seq/criteria`], ['PUT', `${P}/:seq/criteria/:id`], ['DELETE', `${P}/:seq/criteria/:id`],
  ['POST', `${P}/:seq/assumptions`], ['POST', `${P}/:seq/assumptions/:id`], ['POST', `${P}/:seq/follow-up`], ['POST', `${P}/:seq/brief-addition`],
  ['POST', `${P}/:seq/archive`],
  ['GET', `${P}/:seq/markdown`], ['POST', `${P}/:seq/save`],
  ['POST', `${P}/:seq/start`], ['POST', `${P}/:seq/revert`],
].map(([method, path]) => Object.freeze({ method, path })));

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

/** What the feature page shows of its scope's brief (A7 §5, board 14): its status and age, the sources, the
 *  area names and terms the feature mentions, and the switch; null without a usable brief. */
function featureBrief(f) {
  const b = usableBrief(f.scopeType, f.scopeKey);
  if (!b) return null;
  const m = briefMatches(b.sections, f);
  return { status: b.status, madeAt: b.madeAt, sources: b.sources, matches: m.names, matchesMore: m.more,
    lookAtCode: getContext(f.scopeType, f.scopeKey).lookAtCode };
}

/** A feature's view (A1 §5, A2 §4): the stored feature plus what the page derives nothing of itself:
 *  readiness, the displayed state, the unasked rejections, the starts (newest first; the newest with its
 *  frozen spec, for the version switch) and the changes since the latest start. */
export async function featureView(seq, d = {}) {
  const f = requireFeature(seq);
  const turns = listTurns(seq);
  const last = turns.at(-1);
  const busy = isBusy(seq);
  const pending = f.status === 'your_turn' ? pendingRound(turns) : null;
  const ready = readiness({ ...f, pending }, { turns, target: await targetFor(f) });
  const rows = listStarts(seq);
  const runSummary = d.runSummary || noSummary;
  const starts = await Promise.all(rows.map(async (s, i) => ({ ...(await startView(s, runSummary)), ...(i === 0 ? { spec: s.spec } : {}) })));
  return {
    feature: { ...f, busy, pending, lastError: last && last.kind === 'error' ? last.payload.message : null,
      readiness: ready, state: displayState({ ...f, busy }, { ready, starts: rows }), unaskedRejections: unaskedRejections(f.spec, turns),
      starts, changedSinceStart: rows.length ? changedSince(rows[0].spec, f.spec) : [],
      brief: featureBrief(f), lookCostUsd: lookCostUsd() },
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
  const ready = readiness({ ...f, pending }, { turns, target: await targetOf(f) });
  const latest = latestStart(f.seq);
  return { ...rest, busy, state: displayState({ ...f, busy }, { ready, starts: latest ? [latest] : [] }), ready: ready.passed,
    pendingCount: pending && Array.isArray(pending.questions) ? pending.questions.length : 0,
    openAssumptions: ((spec && spec.assumptions) || []).filter((a) => a.status === 'open').length,
    latestRun: latest ? (await startView(latest, runSummary)).run : null };
}

/** Median of the recent code-look costs, for the New feature page's hint (null when there are none). */
function lookCostUsd() {
  const costs = recentLookCosts(10).sort((a, b) => a - b);
  if (!costs.length) return null;
  const m = costs.length >> 1;
  const mid = costs.length % 2 ? costs[m] : (costs[m - 1] + costs[m]) / 2;
  return Math.round(mid * 1e4) / 1e4;
}

/** Requirements spend in the budget window budgetStatus() uses, the total limit (null: none) and the
 *  window's period ('weekly' | 'monthly'), so the page names the right one. */
function requirementsSpend() {
  const b = budgetStatus();
  return { windowUsd: requirementsWindowedSpendUsd(b.windowStartMs), totalLimitUsd: b.totalLimitUsd ?? null,
    resetPeriod: b.resetPeriod === 'weekly' ? 'weekly' : 'monthly' };
}

const BRIEF_FIELDS = ['id', 'scopeType', 'scopeKey', 'status', 'sections', 'edited', 'sources', 'files', 'seed', 'model',
  'costUsd', 'error', 'madeBy', 'madeAt', 'updatedAt'];
const briefFields = (b) => (b ? Object.fromEntries(BRIEF_FIELDS.map((k) => [k, b[k]])) : null);

/**
 * The brief page's body (A7 §5): `{ brief, target: { name, branch, leftOut, slow }, notes, estimate, usedBy,
 * staleness }`. `branch` is the default branch the next look reads (a project; a workspace: null), `leftOut` the
 * workspace members past the checkout cap, `slow` the repositories whose default branch could not be read in
 * time. The target's git probes and the staleness check run side by side, each bounded by STALENESS_TIMEOUT_MS
 * (D9), so a slow repository never holds the page for much longer than that. `known` is a briefTarget already read
 * (makeBrief's), so a create does not probe git twice.
 */
async function briefPage(scopeType, scopeKey, t, d, known = null) {
  const b = getBrief(scopeType, scopeKey);
  const [target, estimate, staleness] = await Promise.all([
    known || briefTarget(scopeType, scopeKey, d), briefEstimate(d), b ? briefStaleness(b, d) : null,
  ]);
  const first = scopeType === 'project' ? target.dirs[0] : null;
  return {
    brief: briefFields(b),
    target: { name: t.name, branch: (first && first.base && first.base.branch) || null, leftOut: target.leftOut || [], slow: target.slow || [] },
    notes: getContext(scopeType, scopeKey), estimate, usedBy: briefUsers(scopeType, scopeKey), staleness,
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
  const d = { ...deps, onChange };
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
      deleteBrief(...scope(req));
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
      const briefs = listBriefs().map((b) => ({ ...b, lookAtCode: getContext(b.scopeType, b.scopeKey).lookAtCode }));
      res.json({ features, lookCostUsd: lookCostUsd(), spend: requirementsSpend(), briefs });
    },
    [`POST ${P}`]: async (req, res) => {
      const b = req.body || {};
      await checkTarget(b.scopeType, b.scopeKey);
      assertCapacity();   // before creating: a refused start must not leave a feature stuck at "looking"
      const f = createFeature({ scopeType: b.scopeType, scopeKey: b.scopeKey, title: b.title, description: b.description }, { by: by(req) });
      startOrientation(f.seq, { by: by(req) }, d);
      await changed(res, f.seq, 201);
    },
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
  for (const { method, path } of REQUIREMENTS_ROUTES) app[method.toLowerCase()](path, gate, handle(handlers[`${method} ${path}`]));
}
