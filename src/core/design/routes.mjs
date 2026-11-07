// src/core/design/routes.mjs
// /api/design/* (P2, SPEC C-8). One registration call from ui/server.mjs; every route in DESIGN_ROUTES is behind the
// `design` flag (404 while off). A design another person made answers 404 on every route, as Ask does. Builds start
// only through the chat tool (P5), so no route here starts one: these read, edit and delete designs, and stop, answer,
// continue and restore what a build holds. Preview-token (P3) and export (P6) register their own routes.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { mockEnabled } from '../claude-runner.mjs';
import { requireFlag } from '../flags.mjs';
import { actorOf, isSharedIdentity, resolveIdentity } from '../identity.mjs';
import { listProjects } from '../projects.mjs';
import { DesignRefusal } from './build.mjs';
import { AGENT_ID_RE, BUILD_ID_RE, DESIGN_ID_RE, DesignError } from './ids.mjs';
import { designWorkDir } from './paths.mjs';
import { validatePlan } from './plan.mjs';
import { createDesignBuilds } from './registry.mjs';
import { resolveDesignModel } from './spawn-options.mjs';
import {
  createDesign, deleteDesign, getBuild, getDesign, latestBuild, listAgents, listDesigns, updateDesign,
} from './store.mjs';

const P = '/api/design';
const ONE = `${P}/:id`;
const BUILD = `${ONE}/builds/:bid`;

/** Every Design route, in registration order: the one list registerDesignRoutes registers from and the flag-off test
 *  walks, so no route can skip the `design` gate unnoticed. */
export const DESIGN_ROUTES = Object.freeze([
  ['GET', P], ['POST', P],
  ['GET', ONE], ['PATCH', ONE], ['DELETE', ONE],
  ['POST', `${BUILD}/stop`], ['POST', `${BUILD}/agents/:aid/stop`], ['POST', `${BUILD}/answer`], ['POST', `${BUILD}/continue`],
  ['POST', `${ONE}/versions/:n/restore`],
].map(([method, path]) => Object.freeze({ method, path })));

/** The store's codes as HTTP statuses; any other `DesignError` (`IO`, `BAD_SHELL`) is a 500. */
const STORE_STATUS = Object.freeze({ BAD_REQUEST: 400, NOT_FOUND: 404, CONFLICT: 409 });
const VERSION_RE = /^[1-9]\d*$/;
const VERSION_GONE = 'That version is no longer kept';
const ROLES = Object.freeze(['lead', 'builder']);

const messageOf = (err) => (err && typeof err.message === 'string' ? err.message : String(err));

/** A thrown error as `{status, body}`: its own HTTP status first (a `DesignRefusal` keeps its `code`), then the
 *  store's codes, and anything else a 500. */
function errorReply(err) {
  const error = messageOf(err);
  if (err && Number.isInteger(err.status) && err.status >= 400 && err.status <= 599) {
    const code = typeof err.code === 'string' && err.code ? err.code : null;
    return { status: err.status, body: { error, ...(code ? { code } : {}) } };
  }
  if (err instanceof DesignError && STORE_STATUS[err.code]) return { status: STORE_STATUS[err.code], body: { error } };
  return { status: 500, body: { error } };
}

const handle = (fn) => async (req, res) => {
  try {
    await fn(req, res);
  } catch (err) {
    const { status, body } = errorReply(err);
    res.status(status).json(body);
  }
};

/** Who is looking: a name only on a shared sign-in; a local install's viewer is null and sees everything. */
function viewerOf(req) {
  const who = resolveIdentity(req);
  return isSharedIdentity(who.source) ? who.name : null;
}

/**
 * The design `req.params.id` names when this viewer may see it, else null after answering 404 itself: a bad id, an
 * unknown design and another person's design read the same (`askThreadVisible`, server.mjs). A design with no maker is
 * everyone's, as `listDesigns({visibleTo})` keeps it.
 */
function designFor(req, res) {
  const id = req.params.id;
  const design = typeof id === 'string' && DESIGN_ID_RE.test(id) ? getDesign(id) : null;
  const viewer = viewerOf(req);
  if (!design || (viewer && design.createdBy && design.createdBy !== viewer)) {
    res.status(404).json({ error: 'design not found' });
    return null;
  }
  return design;
}

/** The build row `bid` of `design`, else a 404: a bad id, an unknown build and another design's build alike. */
function buildOf(design, bid) {
  const row = typeof bid === 'string' && BUILD_ID_RE.test(bid) ? getBuild(bid) : null;
  if (!row || row.designId !== design.id) throw new DesignRefusal(404, 'build not found');
  return row;
}

/** A `projectKey` must name a known project (the store keeps any text), checked before anything is written. Absent,
 *  null or blank clears it. */
async function checkProject(key) {
  if (key === undefined || key === null) return;
  if (typeof key !== 'string') throw new DesignRefusal(400, 'projectKey must be text');
  const k = key.trim();
  if (!k) return;
  if (!(await listProjects()).some((p) => p.key === k)) throw new DesignRefusal(400, `There is no project ${JSON.stringify(k)}`);
}

/** The only keys a PATCH may change, type-checked: `updateDesign` also takes `status, currentBuild, version, engine,
 *  threadId`, so nothing else of the body reaches it. The store still checks the values (a title over 120 is 400). */
function patchOf(body) {
  const patch = {};
  if (body.title !== undefined) {
    if (body.title !== null && typeof body.title !== 'string') throw new DesignRefusal(400, 'title must be text');
    patch.title = body.title;
  }
  if (body.fast !== undefined) {
    if (typeof body.fast !== 'boolean') throw new DesignRefusal(400, 'fast must be true or false');
    patch.fast = body.fast;
  }
  if (body.projectKey !== undefined) patch.projectKey = body.projectKey;
  return patch;
}

/** The design's plan on disk when valid, else null. */
function planOf(design) {
  let text;
  try { text = readFileSync(join(designWorkDir(design.id), 'plan.json'), 'utf8'); } catch { return null; }
  const check = validatePlan(text, { kind: design.kind });
  return check.ok ? check.plan : null;
}

/** A section record as it leaves the engine: `todo` and `unbuiltAdd` dropped (L2.35). */
function recordOut(s) {
  const out = { ...s };
  delete out.todo;
  delete out.unbuiltAdd;
  return out;
}

/**
 * Registers every route of DESIGN_ROUTES on `app`, each behind the `design` flag.
 * @param {import('express').Express} app
 * @param {{ broadcast?: (frame: object) => void, deps?: { designBuilds?: object,
 *   versions?: { list: (id: string) => Promise<object[]>|object[], restore: (id: string, n: number) => Promise<unknown> },
 *   dropGrants?: (id: string) => unknown, deleteThread?: (threadId: string) => Promise<unknown>,
 *   brokerStartRefusal?: (req: object, modelIds: string[]) => Promise<string|null> } }} [opts]
 */
export function registerDesignRoutes(app, { broadcast, deps } = {}) {
  const d = deps && typeof deps === 'object' ? deps : {};
  const designBuilds = d.designBuilds ?? createDesignBuilds({ broadcast });
  const gate = requireFlag('design');

  const handlers = {
    [`GET ${P}`]: async (req, res) => {
      res.json(listDesigns({ visibleTo: viewerOf(req) }).map((x) => ({
        id: x.id, title: x.title, kind: x.kind, status: x.status, updatedAt: x.updatedAt, costUsd: x.costUsd, thumb: null,
      })));
    },

    [`POST ${P}`]: async (req, res) => {
      const body = req.body || {};
      await checkProject(body.projectKey);
      const design = createDesign(
        { kind: body.kind, title: body.title, fast: body.fast, projectKey: body.projectKey, engine: 'claude' },
        { by: actorOf(req) },
      );
      res.status(201).json({ design, threadId: null });
    },

    [`GET ${ONE}`]: async (req, res) => {
      const design = designFor(req, res);
      if (!design) return;
      const row = latestBuild(design.id);
      let build = null;
      let sections = [];
      if (row) {
        const { sections: records, ...rest } = row;
        sections = records.map(recordOut);
        build = { ...rest, costKnown: listAgents(row.id).every((a) => a.costKnown !== false) };
      }
      const versions = (await d.versions?.list(design.id)) ?? [];
      res.json({ design, plan: planOf(design), build, sections, versions });
    },

    [`PATCH ${ONE}`]: async (req, res) => {
      const design = designFor(req, res);
      if (!design) return;
      const body = req.body || {};
      const patch = patchOf(body);
      await checkProject(patch.projectKey);
      const row = updateDesign(design.id, patch);
      // M7: the next spawn's cap follows; nothing running is killed, and nothing else reaches the build.
      if ('fast' in patch) designBuilds.get(row.currentBuild)?.setFast(patch.fast);
      res.json(row);
    },

    [`DELETE ${ONE}`]: async (req, res) => {
      const design = designFor(req, res);
      if (!design) return;
      deleteDesign(design.id);
      await d.dropGrants?.(design.id);
      if (design.threadId) await d.deleteThread?.(design.threadId);
      res.json({ ok: true });
    },

    [`POST ${BUILD}/stop`]: async (req, res) => {
      const design = designFor(req, res);
      if (!design) return;
      const row = buildOf(design, req.params.bid);
      // A running build is signalled and this answers at once; a paused one is closed first (L2.34).
      await designBuilds.stopBuild(row.id);
      res.json({ ok: true });
    },

    [`POST ${BUILD}/agents/:aid/stop`]: async (req, res) => {
      const design = designFor(req, res);
      if (!design) return;
      const row = buildOf(design, req.params.bid);
      const aid = req.params.aid;
      if (!AGENT_ID_RE.test(aid) || !listAgents(row.id).some((a) => a.id === aid)) throw new DesignRefusal(404, 'agent not found');
      // A paused build's waiting agent ends with the whole build's Stop.
      const build = designBuilds.get(row.id);
      if (!build) throw new DesignRefusal(409, 'The build is not running');
      build.stopAgent(aid);
      res.json({ ok: true });
    },

    [`POST ${BUILD}/answer`]: async (req, res) => {
      const design = designFor(req, res);
      if (!design) return;
      const row = buildOf(design, req.params.bid);
      const body = req.body || {};
      if (typeof body.askId !== 'string' || !Array.isArray(body.answers)) {
        throw new DesignRefusal(422, 'An answer needs an askId and a list of answers');
      }
      // L2.25: a build that is not running (paused, or paused by a drain) holds no open question.
      const build = designBuilds.get(row.id);
      if (!build) throw new DesignRefusal(409, 'This question is no longer open');
      build.answer(body.askId, body.answers);
      res.json({ ok: true });
    },

    [`POST ${BUILD}/continue`]: async (req, res) => {
      const design = designFor(req, res);
      if (!design) return;
      const body = req.body || {};
      const { sections } = body;
      if (sections !== undefined && (!Array.isArray(sections) || sections.some((s) => typeof s !== 'string'))) {
        throw new DesignRefusal(422, 'sections must be a list of section ids');
      }
      const row = buildOf(design, req.params.bid);
      if (!mockEnabled({})) {
        const engine = design.engine ?? 'claude';
        const models = [...new Set(ROLES.map((role) => resolveDesignModel(role, { engine }).model).filter(Boolean))];
        const refusal = await d.brokerStartRefusal?.(req, models);
        if (refusal) throw new DesignRefusal(409, refusal, 'credential-missing');
      }
      designBuilds.continueBuild({ designId: design.id, buildId: row.id, sections, by: actorOf(req) });
      res.status(202).json({ ok: true });
    },

    [`POST ${ONE}/versions/:n/restore`]: async (req, res) => {
      const design = designFor(req, res);
      if (!design) return;
      const n = req.params.n;
      if (!VERSION_RE.test(n)) throw new DesignRefusal(400, 'version must be a whole number');
      // A paused build counts as running here (L2.20), as the store's CONFLICT does.
      if (designBuilds.live().some((b) => b.designId === design.id)) throw new DesignRefusal(409, 'A build is running: stop it first');
      if (!d.versions) throw new DesignRefusal(404, VERSION_GONE);
      try {
        await d.versions.restore(design.id, Number(n));
      } catch (err) {
        if (err?.status === 404 || (err instanceof DesignError && err.code === 'NOT_FOUND')) throw new DesignRefusal(404, VERSION_GONE);
        throw err;
      }
      res.json({ ok: true });
    },
  };

  // The table and the handlers must name the same routes: a route without a table row would skip the flag-off test,
  // a row without a handler would register nothing.
  const keys = DESIGN_ROUTES.map((r) => `${r.method} ${r.path}`);
  const odd = [...keys.filter((k) => !handlers[k]), ...Object.keys(handlers).filter((k) => !keys.includes(k))];
  if (odd.length) throw new Error(`design routes: the table and the handlers differ (${odd.join(', ')})`);
  for (const { method, path } of DESIGN_ROUTES) {
    app[method.toLowerCase()](path, gate, handle(handlers[`${method} ${path}`]));
  }
}
