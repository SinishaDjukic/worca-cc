// src/core/requirements/routes.mjs
// /api/requirements/* (plans/requirements-design.md §5). One registration call from ui/server.mjs; every
// route in REQUIREMENTS_ROUTES is behind the `requirements` flag (404 while off), and so is the change frame.
import { requireFlag, flagEnabled } from '../flags.mjs';
import { actorOf } from '../identity.mjs';
import { listProjects } from '../projects.mjs';
import { workspaceTarget } from '../ask/workflow-deps.mjs';
import { RequirementsError, parseFeatureSeq, SCOPE_TYPES } from './spec.mjs';
import { createFeature, requireFeature, listFeatures, listTurns, getContext, setContext, updateFeature } from './store.mjs';
import { startOrientation, submitAnswers, finishInterview, retry, isBusy } from './interview.mjs';
import { pendingRound } from './round.mjs';
import {
  updateHeader, setSection, releaseSection, addCriterion, editCriterion, removeCriterion, setAssumption, setArchived,
} from './edits.mjs';
import { renderSpecMarkdown } from './markdown.mjs';
import { saveSpecToCheckout, specFileName } from './save.mjs';

const STATUS = Object.freeze({ BAD_REQUEST: 400, NOT_FOUND: 404, BUSY: 409, CONFLICT: 409, BUDGET: 409 });
const P = '/api/requirements';

/** Every requirements route, in registration order: the one list registerRequirementsRoutes registers from
 *  and the flag-off test walks, so no route can skip the `requirements` gate unnoticed. */
export const REQUIREMENTS_ROUTES = Object.freeze([
  ['GET', `${P}/context/:scopeType/:scopeKey`], ['PUT', `${P}/context/:scopeType/:scopeKey`],
  ['GET', P], ['POST', P],
  ['GET', `${P}/:seq`], ['PATCH', `${P}/:seq`],
  ['POST', `${P}/:seq/answers`], ['POST', `${P}/:seq/finish`], ['POST', `${P}/:seq/retry`], ['POST', `${P}/:seq/look`],
  ['PUT', `${P}/:seq/spec/:section`], ['DELETE', `${P}/:seq/spec/:section/edited`],
  ['POST', `${P}/:seq/criteria`], ['PUT', `${P}/:seq/criteria/:id`], ['DELETE', `${P}/:seq/criteria/:id`],
  ['POST', `${P}/:seq/assumptions/:id`], ['POST', `${P}/:seq/archive`],
  ['GET', `${P}/:seq/markdown`], ['POST', `${P}/:seq/save`],
].map(([method, path]) => Object.freeze({ method, path })));

/** The change hook every requirements change goes through: a `requirements-changed` frame, only while the
 *  flag is on (read at send time, so turning the flag off silences jobs already running). */
export function requirementsChangeNotifier(broadcast) {
  return (seq) => { if (flagEnabled('requirements')) broadcast({ type: 'requirements-changed', seq: Number(seq) }); };
}

export function featureView(seq) {
  const f = requireFeature(seq);
  const turns = listTurns(seq);
  const last = turns.at(-1);
  return {
    feature: { ...f, busy: isBusy(seq), pending: f.status === 'your_turn' ? pendingRound(turns) : null,
      lastError: last && last.kind === 'error' ? last.payload.message : null },
    turns,
  };
}

const summary = ({ spec, orientation, description, ...rest }) => ({ ...rest, busy: isBusy(rest.seq) });

async function checkTarget(scopeType, scopeKey) {
  if (!SCOPE_TYPES.includes(scopeType) || typeof scopeKey !== 'string') throw new RequirementsError('BAD_REQUEST', 'scopeType must be "project" or "workspace"');
  if (scopeType === 'project') {
    const p = (await listProjects()).find((x) => x.key === scopeKey);
    if (!p) throw new RequirementsError('BAD_REQUEST', 'unknown project');
    return { name: p.name, path: p.path, exists: p.exists };
  }
  const ws = await workspaceTarget(scopeKey);
  if (!ws) throw new RequirementsError('BAD_REQUEST', 'unknown workspace');
  return { name: ws.name };
}

/**
 * @param {import('express').Express} app
 * @param {{ broadcast:(frame:object)=>void, deps?:object }} o  deps reach the interview runner (tests)
 */
export function registerRequirementsRoutes(app, { broadcast, deps = {} } = {}) {
  const gate = requireFlag('requirements');
  const onChange = requirementsChangeNotifier(broadcast);
  const d = { ...deps, onChange };
  const handle = (fn) => async (req, res) => {
    try { await fn(req, res); }
    catch (err) {
      const status = (err && STATUS[err.code]) || 500;
      res.status(status).json({ error: err && err.message ? err.message : String(err) });
    }
  };
  const seqOf = (req) => {
    const seq = parseFeatureSeq(req.params.seq);
    if (seq == null) throw new RequirementsError('NOT_FOUND', 'feature not found');
    return seq;
  };
  const by = (req) => actorOf(req);
  const changed = (res, seq, code = 200) => { onChange(seq); res.status(code).json(featureView(seq)); };

  const handlers = {
    [`GET ${P}/context/:scopeType/:scopeKey`]: async (req, res) => {
      await checkTarget(req.params.scopeType, req.params.scopeKey);
      res.json(getContext(req.params.scopeType, req.params.scopeKey));
    },
    [`PUT ${P}/context/:scopeType/:scopeKey`]: async (req, res) => {
      await checkTarget(req.params.scopeType, req.params.scopeKey);
      const b = req.body || {};
      res.json(setContext(req.params.scopeType, req.params.scopeKey, { body: b.body, lookAtCode: b.lookAtCode }, { by: by(req) }));
    },
    [`GET ${P}`]: async (req, res) => {
      const q = req.query || {};
      res.json({ features: listFeatures({ scopeType: q.scopeType || null, scopeKey: q.scopeKey || null, archived: q.archived === '1' }).map(summary) });
    },
    [`POST ${P}`]: async (req, res) => {
      const b = req.body || {};
      await checkTarget(b.scopeType, b.scopeKey);
      const f = createFeature({ scopeType: b.scopeType, scopeKey: b.scopeKey, title: b.title, description: b.description }, { by: by(req) });
      startOrientation(f.seq, { by: by(req) }, d);
      changed(res, f.seq, 201);
    },
    [`GET ${P}/:seq`]: async (req, res) => res.json(featureView(seqOf(req))),
    [`PATCH ${P}/:seq`]: async (req, res) => {
      const seq = seqOf(req);
      const b = req.body || {};
      if (b.scopeType !== undefined || b.scopeKey !== undefined) await checkTarget(b.scopeType, b.scopeKey);
      updateHeader(seq, b, { by: by(req) });
      changed(res, seq);
    },
    [`POST ${P}/:seq/answers`]: async (req, res) => {
      const seq = seqOf(req);
      submitAnswers(seq, req.body || {}, { by: by(req) }, d);
      changed(res, seq, 202);
    },
    [`POST ${P}/:seq/finish`]: async (req, res) => {
      const seq = seqOf(req);
      finishInterview(seq, { by: by(req) }, d);
      changed(res, seq, 202);
    },
    [`POST ${P}/:seq/retry`]: async (req, res) => {
      const seq = seqOf(req);
      retry(seq, { by: by(req) }, d);
      changed(res, seq, 202);
    },
    [`POST ${P}/:seq/look`]: async (req, res) => {
      const seq = seqOf(req);
      startOrientation(seq, { by: by(req), thenRound: false }, d);
      changed(res, seq, 202);
    },
    [`PUT ${P}/:seq/spec/:section`]: async (req, res) => {
      const seq = seqOf(req);
      setSection(seq, req.params.section, (req.body || {}).value, { by: by(req) });
      changed(res, seq);
    },
    [`DELETE ${P}/:seq/spec/:section/edited`]: async (req, res) => {
      const seq = seqOf(req);
      releaseSection(seq, req.params.section, { by: by(req) });
      changed(res, seq);
    },
    [`POST ${P}/:seq/criteria`]: async (req, res) => {
      const seq = seqOf(req);
      addCriterion(seq, (req.body || {}).text, { by: by(req) });
      changed(res, seq);
    },
    [`PUT ${P}/:seq/criteria/:id`]: async (req, res) => {
      const seq = seqOf(req);
      editCriterion(seq, req.params.id, (req.body || {}).text, { by: by(req) });
      changed(res, seq);
    },
    [`DELETE ${P}/:seq/criteria/:id`]: async (req, res) => {
      const seq = seqOf(req);
      removeCriterion(seq, req.params.id, { by: by(req) });
      changed(res, seq);
    },
    [`POST ${P}/:seq/assumptions/:id`]: async (req, res) => {
      const seq = seqOf(req);
      setAssumption(seq, req.params.id, (req.body || {}).status, { by: by(req) });
      changed(res, seq);
    },
    [`POST ${P}/:seq/archive`]: async (req, res) => {
      const seq = seqOf(req);
      setArchived(seq, (req.body || {}).restore !== true, { by: by(req) });
      changed(res, seq);
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
  };

  // The table and the handlers must name the same routes: a route without a table row would skip the
  // flag-off test, a row without a handler would register nothing.
  const keys = REQUIREMENTS_ROUTES.map((r) => `${r.method} ${r.path}`);
  const odd = [...keys.filter((k) => !handlers[k]), ...Object.keys(handlers).filter((k) => !keys.includes(k))];
  if (odd.length) throw new Error(`requirements routes: the table and the handlers differ (${odd.join(', ')})`);
  for (const { method, path } of REQUIREMENTS_ROUTES) app[method.toLowerCase()](path, gate, handle(handlers[`${method} ${path}`]));
}
