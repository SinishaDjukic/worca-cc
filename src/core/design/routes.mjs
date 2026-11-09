// src/core/design/routes.mjs
// /api/design/* (P2, SPEC C-8). One registration call from ui/server.mjs; every route in DESIGN_ROUTES is behind the
// `design` flag (404 while off). A design another person made answers 404 on every route, as Ask does. Builds start
// only through the chat tool (P5), so no route here starts one: these read, edit and delete designs, and stop, answer,
// continue and restore what a build holds. Preview-token (P3) and export (P6) register their own routes.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { mockEnabled } from '../claude-runner.mjs';
import { roundUsd } from '../cost-budget.mjs';
import { requireFlag } from '../flags.mjs';
import { actorOf, isSharedIdentity, resolveIdentity } from '../identity.mjs';
import { listProjects } from '../projects.mjs';
import { DesignRefusal } from './build.mjs';
import { chatSpendUsd, createDesignThread } from './chat-thread.mjs';
import { registerDesignExportRoutes } from './export-routes.mjs';
import { AGENT_ID_RE, BUILD_ID_RE, DESIGN_ID_RE, DesignError } from './ids.mjs';
import { designWorkDir } from './paths.mjs';
import { validatePlan } from './plan.mjs';
import { createDesignBuilds, RESTORE_RUNNING, ROUND_STARTING } from './registry.mjs';
import { resolveDesignModel } from './spawn-options.mjs';
import {
  createDesign, deleteDesign, designsWithUnknownCost, getBuild, getDesign, latestBuild, listAgents, listDesigns,
  updateDesign,
} from './store.mjs';
import { thumbUrl } from './thumb.mjs';

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
 * everyone's, as `listDesigns({visibleTo})` keeps it. The export route (P6) is handed it.
 */
export function designFor(req, res) {
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
 *   versions?: { list: (id: string) => Promise<object[]>|object[],
 *     restore: (id: string, n: number) => Promise<{ version: number, restoredFrom: number }|void> },
 *   postSystemNotice?: (threadId: string, text: string) => unknown,
 *   dropGrants?: (id: string) => unknown, deleteThread?: (threadId: string) => Promise<unknown>,
 *   brokerStartRefusal?: (req: object, modelIds: string[]) => Promise<string|null>,
 *   thumbs?: { ensure: (design: object) => void } } }} [opts] `thumbs` (`createThumbs`) is handed every listed design
 */
export function registerDesignRoutes(app, { broadcast, deps } = {}) {
  const d = deps && typeof deps === 'object' ? deps : {};
  const designBuilds = d.designBuilds ?? createDesignBuilds({ broadcast });
  const gate = requireFlag('design');

  const handlers = {
    [`GET ${P}`]: async (req, res) => {
      const designs = listDesigns({ visibleTo: viewerOf(req) });
      const unknown = designsWithUnknownCost();
      const rows = designs.map((x) => ({
        id: x.id, title: x.title, kind: x.kind, status: x.status, updatedAt: x.updatedAt,
        // A design total is its builds plus its chat (P1 sums the build ledger only); an unknown agent cost makes it
        // `cost unknown`, never `$0` (P6).
        costUsd: roundUsd(x.costUsd + chatSpendUsd(x.threadId)), costKnown: !unknown.has(x.id),
        thumb: thumbUrl(x.id),
      }));
      res.json(rows);
      // Thumbnails are lazy (L6.7): what is missing or stale renders now, and arrives as a `design-thumb` frame. After
      // the answer: an idle render queue starts the first one in this tick.
      for (const x of designs) d.thumbs?.ensure(x);
    },

    [`POST ${P}`]: async (req, res) => {
      const body = req.body || {};
      await checkProject(body.projectKey);
      const design = createDesign(
        { kind: body.kind, title: body.title, fast: body.fast, projectKey: body.projectKey, engine: 'claude' },
        { by: actorOf(req) },
      );
      // The design owns its titled thread from the start (P5): no title call can fire on its first message.
      const thread = createDesignThread({ design, by: actorOf(req) });
      res.status(201).json({ design: updateDesign(design.id, { threadId: thread.id }), threadId: thread.id });
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
      res.json({ design: { ...design, costUsd: roundUsd(design.costUsd + chatSpendUsd(design.threadId)) }, plan: planOf(design), build, sections, versions });
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
      // A restore running, or a chat hand-off staging its round, would recreate work/ with no row once the folder is
      // gone (P5). Checked in the same tick as the delete: a hand-off that comes later finds no design (404).
      if (designBuilds.restoring(design.id)) throw new DesignRefusal(409, RESTORE_RUNNING);
      if (designBuilds.starting(design.id)) throw new DesignRefusal(409, ROUND_STARTING);
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
      if (!VERSION_RE.test(n) || !Number.isSafeInteger(Number(n))) throw new DesignRefusal(400, 'version must be a whole number');
      // `{round}` names the receipt the person went back from (P5 Task 10); a request with no body has none.
      const body = req.body || {};
      if (body.round !== undefined && !(Number.isInteger(body.round) && body.round >= 1)) throw new DesignRefusal(400, 'round must be a whole number');
      // A paused build counts as running here (L2.20), as the store's CONFLICT does.
      if (designBuilds.live().some((b) => b.designId === design.id)) throw new DesignRefusal(409, 'A build is running: stop it first');
      if (!d.versions) throw new DesignRefusal(404, VERSION_GONE);
      let r;
      try {
        // No await since live(): the hold refuses a start, a Continue, a hand-off and another restore until this ends.
        r = await designBuilds.whileRestoring(design.id, () => d.versions.restore(design.id, Number(n)));
      } catch (err) {
        if (err instanceof DesignRefusal) throw err;
        if (err?.status === 404 || (err instanceof DesignError && err.code === 'NOT_FOUND')) throw new DesignRefusal(404, VERSION_GONE);
        // A file system error names server paths: the log keeps it, the browser gets words.
        console.error(`[worca-design] restore of ${design.id} failed: ${messageOf(err)}`);
        throw new DesignRefusal(500, 'The page was not restored: try again');
      }
      // A stub with no result (design-api.test.mjs) still answers `{ok:true}`.
      const restored = r && Number.isInteger(r.version) ? { version: r.version, restoredFrom: r.restoredFrom } : null;
      if (restored) {
        // A notice row, never an AI turn (L30): the chat says what happened, the stage reloads on the frame.
        if (design.threadId) await d.postSystemNotice?.(design.threadId, body.round ? `Back to before round ${body.round}` : 'Back to an earlier version');
        broadcast?.({ type: 'design-restored', designId: design.id, ...restored, ts: Date.now() });
      }
      res.json({ ok: true, ...(restored ?? {}) });
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
  // P6's export route: behind the same gate, outside DESIGN_ROUTES (test/design-export-routes.test.mjs walks its gate).
  // A restore or a hand-off rewrites work/ while the design stays `done`: no export reads it meanwhile.
  const held = (id) => {
    if (designBuilds.restoring?.(id)) return RESTORE_RUNNING;
    return designBuilds.starting?.(id) ? ROUND_STARTING : null;
  };
  registerDesignExportRoutes(app, { flagGate: gate, designFor, listProjects, held });
}
