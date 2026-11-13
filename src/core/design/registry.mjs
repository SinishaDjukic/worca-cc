// src/core/design/registry.mjs
// The Design build registry (P2, C-10): `createDesignBuilds` holds every build running on this server, and nothing
// else, in memory (L2.6). It is never part of the `runs` Map. `start` answers once a round is accepted (M10), every
// refusal an Error with a numeric `status`. Every agent of every build shares one machine-wide slot queue (P8: the caps
// of limits.mjs, 24 agents unless the operator says otherwise), and on a shared server one person runs one build.
// Stop and Continue on a settled build rehydrate it from its P1 rows. `live()` lists every open build, paused ones
// included (L2.20). A late joiner of a build that is not running gets a snapshot rebuilt from the rows, with the same
// keys at every level as a live one. `frameOwner` names whose a design frame is, for `broadcast`'s viewer filter.

import { claimRunDir, shareFailureReason } from '../agent-pool.mjs';
import { withBillTo } from '../billing.mjs';
import { budgetStatus } from '../cost-budget.mjs';
import { DesignBuild, DesignRefusal } from './build.mjs';
import { designBuildModels } from './chat-thread.mjs';
import { designEngineFor, designEngineGate } from './engines.mjs';
import { DesignError } from './ids.mjs';
import { readConfined } from './assemble.mjs';
import { designCaps } from './limits.mjs';
import { closeToWorca, designDir, designWorkDir, distDir, madeKeptDir, versionsDir } from './paths.mjs';
import { validatePlan } from './plan.mjs';
import { pinsBlock } from './prompts.mjs';
import { createSemaphore } from './semaphore.mjs';
import { closeBuildRow } from './recover.mjs';
import { OPEN_BUILD_STATUSES, getBuild, getDesign, listAgents, listOpenBuilds, updateDesign } from './store.mjs';

/** Design owners `frameOwner` keeps; past this the cache is cleared whole, as `ASK_OWNER_CACHE` is. */
const OWNER_CACHE_MAX = 5000;
const DRAINING = 'worca is stopping: start this again once it is back';
/** The refusal while a restore rewrites the design's work/ (P5 Task 10): a start, a Continue, a hand-off, a restore. */
export const RESTORE_RUNNING = 'A restore is running: try again in a moment';
/** A restore's, a Continue's and a Delete's refusal while a chat hand-off stages its round into work/ (P5 Task 7). */
export const ROUND_STARTING = 'A round is starting: try again in a moment';
/** The design's own build is open, paused included: `start` and a hand-off (P5 maps it to its chat notice). */
const OPEN_BUILD = 'This design already has a build open: continue or stop it first';
/** A person (shared sign-in) with a build running on this server: `start` and Continue (P8, code `person-busy`). */
const PERSON_BUSY = 'You already have a build running: stop it or wait for it.';

const noop = () => {};
const messageOf = (err) => (err && typeof err.message === 'string' ? err.message : String(err));
const isText = (v) => typeof v === 'string' && v.trim() !== '';

/** Whether `viewer` may see what `createdBy` made: a local install's viewer is null and sees everything, and a design
 *  with no maker is everyone's (`askThreadVisible`, server.mjs). */
const visible = (createdBy, viewer) => viewer == null || !createdBy || createdBy === viewer;

/** Every throw while creating or rehydrating a build, as a refusal with a numeric `status` (M10): a status already
 *  set passes through, the store's codes map to 409, 404 and 422, and anything else (`IO`, SQLite) is a 500. */
function refusalOf(err) {
  if (err instanceof DesignRefusal || (err instanceof Error && Number.isInteger(err.status))) return err;
  if (err instanceof DesignError) {
    if (err.code === 'CONFLICT') return new DesignRefusal(409, 'A build is already running');
    if (err.code === 'NOT_FOUND') return new DesignRefusal(404, err.message);
    if (err.code === 'BAD_REQUEST') return new DesignRefusal(422, err.message);
  }
  const out = new DesignRefusal(500, messageOf(err));
  out.cause = err;
  return out;
}

/** The 409 for `design`'s current build when it is open, paused included, else null. */
function openBuildRefusal(design) {
  const current = design?.currentBuild ? getBuild(design.currentBuild) : null;
  return current && OPEN_BUILD_STATUSES.includes(current.status) ? new DesignRefusal(409, OPEN_BUILD) : null;
}

/** The engine gate (P8) for a build of `design` on `engine`, `allowed` the consent: a refusal is a 409 carrying the
 *  gate's code. The design's own model picks are gated with it. Synchronous: `start` holds no `await` before
 *  `DesignBuild.create`. */
function gateEngine(design, engine, allowed) {
  const r = designEngineGate({ engine, allowed, design, models: designBuildModels({ ...design, engine }) });
  if (!r.ok) throw new DesignRefusal(409, r.error, r.code);
}

/** The design's plan on disk when valid, else null. work/ is agent-writable, so it is read through `readConfined`:
 *  a link (another design's plan, worca's own files) or a FIFO planted as plan.json reads as none, never blocking. */
function planOnDisk(design) {
  const text = readConfined(designWorkDir(design.id), 'plan.json');
  if (text === null) return null;
  const check = validatePlan(text, { kind: design.kind });
  return check.ok ? check.plan : null;
}

/** An agent row's token counts as they leave the engine: `sessionUsd`, the engine's own figure for a rehydrate (M3),
 *  dropped, so a row-built snapshot carries the keys of a live one. */
function tokenCounts(tokens) {
  if (!tokens) return tokens;
  const counts = { ...tokens };
  delete counts.sessionUsd;
  return counts;
}

/** A section record as it leaves the engine: a copy, `todo`, `unbuiltAdd` and `regrow` dropped (L2.35). */
function recordCopy(s) {
  const out = { ...s, parts: Array.isArray(s.parts) ? [...s.parts] : [] };
  delete out.todo;
  delete out.unbuiltAdd;
  delete out.regrow;
  return out;
}

/**
 * The `design-snapshot` of a build that is not running, from its rows (L2.6), with the keys of `DesignBuild.snapshot()`
 * at every level. Nothing runs, so `agentsNow` is 0, and no draft, question or estimate is held. The plan is held as a
 * rehydrate holds it: only with section records in the row and a valid plan.json on disk; `planRev` is then 2 for a
 * change round whose lead applied its round (lead row `done`, or `job` `Integrate`), else 1.
 */
function rowSnapshot(row, design) {
  const records = (Array.isArray(row.sections) ? row.sections : []).map(recordCopy);
  const agents = listAgents(row.id);
  const plan = records.length ? planOnDisk(design) : null;
  const lead = agents.find((a) => a.role === 'lead');
  const applied = row.kind === 'change' && Boolean(lead) && (lead.status === 'done' || lead.job === 'Integrate');
  const started = Date.parse(row.startedAt);
  const ended = Date.parse(row.endedAt);
  const end = Number.isFinite(ended) ? ended : Date.now();
  return {
    type: 'design-snapshot',
    designId: row.designId,
    buildId: row.id,
    seq: 0,
    ts: Date.now(),
    build: {
      status: row.status,
      round: row.round,
      kind: row.kind,
      reason: row.reason,
      waiting: agents.filter((a) => a.status === 'waiting').length,
      stats: {
        agentsNow: 0,
        agentsTotal: row.agentsTotal,
        sectionsDone: records.filter((s) => s.status === 'done').length,
        sectionsPlanned: records.length,
        failed: records.filter((s) => s.status === 'failed').length,
        layers: row.layers,
        costUsd: row.costUsd,
        estimatedUsd: 0,
        costKnown: agents.every((a) => a.costKnown),
        elapsedMs: Number.isFinite(started) ? Math.max(0, end - started) : 0,
      },
    },
    plan: { planRev: plan ? (applied ? 2 : 1) : 0, canvas: plan ? { ...plan.canvas } : null, sections: records.map(recordCopy) },
    agents: agents.map((a) => ({
      agentId: a.id,
      role: a.role,
      job: a.job,
      sectionId: a.sectionId,
      status: a.status,
      engine: a.engine,
      model: a.model ?? null,
      tool: null,
      tokens: tokenCounts(a.tokens),
      costUsd: a.costUsd,
      estimatedUsd: null,
      costKnown: a.costKnown,
      error: a.error,
    })),
    sections: records,
    questions: [],
    drafts: [],
    sound: null,
  };
}

class DesignBuilds {
  /** Calls none of its hooks: the server passes `() => DRAIN.on` before `DRAIN` is declared. */
  constructor({ broadcast, caps, personOf, draining, onLiveChange, globalCap, deps, claimDir }) {
    this._broadcast = typeof broadcast === 'function' ? broadcast : noop;
    /** `{fast, calm, global}` (limits.mjs designCaps): the builder caps and the start-time agent cap. */
    this._caps = caps;
    /** The person `by` names on a shared server, else null: only a person is held to one build. */
    this._personOf = personOf;
    this._draining = typeof draining === 'function' ? draining : () => false;
    this._onLiveChange = typeof onLiveChange === 'function' ? onLiveChange : noop;
    this._deps = deps && typeof deps === 'object' ? deps : {};
    /** Gives one folder to an owner's agent (agent-pool.mjs claimRunDir): `claim` calls it. */
    this._claimDir = typeof claimDir === 'function' ? claimDir : claimRunDir;
    /** Every agent process of every build takes one of these (M6's machine cap): waiters go in the order they asked. */
    this._global = createSemaphore(globalCap);
    /** buildId -> { build, person, done }: builds running now, dropped once settled; `person` is `personOf(by)`. */
    this._builds = new Map();
    /** designId -> createdBy | null | false (no such design), for `frameOwner`. */
    this._owners = new Map();
    /** designIds whose restore is running (whileRestoring). */
    this._restoring = new Set();
    /** designId -> { count, tail }: hand-offs queued or staging a round (whileStarting), and the last one's settle. */
    this._starting = new Map();
  }

  /** Whether a restore of `designId` is running. */
  restoring(designId) {
    return this._restoring.has(designId);
  }

  /** Whether a chat hand-off of `designId` is queued or staging a round (whileStarting). */
  starting(designId) {
    return this._starting.has(designId);
  }

  /**
   * Runs `fn`, a restore of `designId`'s work/, with the design held: `start`, `continueBuild`, a hand-off and another
   * restore answer 409 RESTORE_RUNNING until it settles, a throw included. Refused 409 while a hand-off stages a round.
   * The check and the hold are synchronous, so the caller's own checks just before stay atomic with them.
   * @template T
   * @param {string} designId
   * @param {() => Promise<T>} fn
   * @returns {Promise<T>}
   * @throws {DesignRefusal}
   */
  async whileRestoring(designId, fn) {
    if (this._restoring.has(designId)) throw new DesignRefusal(409, RESTORE_RUNNING);
    if (this._starting.has(designId)) throw new DesignRefusal(409, ROUND_STARTING);
    this._restoring.add(designId);
    try {
      return await fn();
    } finally {
      this._restoring.delete(designId);
    }
  }

  /**
   * Runs `fn`, a chat hand-off staging its round into `designId`'s work/ and calling `start`, with the design held
   * against a restore, a Continue and a Delete (409 ROUND_STARTING) from this call until it settles. Refused 409
   * RESTORE_RUNNING while a restore runs. Hand-offs of one design run one at a time, in call order, and each is
   * refused before `fn` runs, in `start`'s order: 503 while draining, 404 once the design is gone (a Delete that
   * landed before the hold: staging would recreate its folder with no row), and `start`'s open-build 409 while the
   * design's build is open, paused included. So the second of two meets the first's build before it stages anything,
   * and nothing is staged under a running build or for a deleted design. `start`'s other refusals (P8: the engine
   * gate, `person-busy`, `agents-full`; the cost limit, pins) come after `fn` has staged: the kit and uploads it
   * copied stay in work/, where the next round stages them again.
   * @template T
   * @param {string} designId
   * @param {() => Promise<T>} fn
   * @returns {Promise<T>}
   * @throws {DesignRefusal}
   */
  async whileStarting(designId, fn) {
    if (this._restoring.has(designId)) throw new DesignRefusal(409, RESTORE_RUNNING);
    const before = this._starting.get(designId);
    let settle;
    const tail = new Promise((res) => { settle = res; });
    this._starting.set(designId, { count: (before?.count ?? 0) + 1, tail });
    try {
      if (before) await before.tail;
      if (this._draining()) throw new DesignRefusal(503, DRAINING);
      const design = getDesign(designId);
      if (!design) throw new DesignRefusal(404, 'design not found');
      const open = openBuildRefusal(design);
      if (open) throw open;
      return await fn();
    } finally {
      settle();
      const now = this._starting.get(designId);
      if (now.count > 1) this._starting.set(designId, { count: now.count - 1, tail: now.tail }); else this._starting.delete(designId);
    }
  }

  /**
   * Gives `designId`'s folders to `owner`'s agent (P8, L8.13, L8.28): the design folder 2750 (its agent reads and
   * traverses, and can never rename `work/`, `versions/`, `dist/`, `made/` or `thumb.png`), then `work/` 2770, which
   * also makes the design folder sticky. Both in the owner's own group, or the shared agent group when there is no pool
   * (`sharedFallback`, which claimRunDir honours only then). Both claims are no-ops without agent isolation.
   * Then `dist/`, `versions/` and `made/` are closed to worca (0700, `closeToWorca`, on every install): restore and
   * assembly copy through the first two, `made/` holds the made pictures' kept copies (SPEC D10a), so no agent may
   * plant a link there, and none reads them. Called at creation, at every start and Continue, and at every Design chat
   * turn.
   * @param {string} designId
   * @param {{ owner?: string|null }} [opts]
   * @throws {DesignRefusal} 500 with the failure's code only: the error's own message can carry server paths
   */
  claim(designId, { owner } = {}) {
    try {
      this._claimDir(designDir(designId), { owner, mode: 0o2750, sharedFallback: true });
      this._claimDir(designWorkDir(designId), { owner, sharedFallback: true });
      closeToWorca(distDir(designId));
      closeToWorca(versionsDir(designId));
      closeToWorca(madeKeptDir(designId));
    } catch (err) {
      throw new DesignRefusal(500, `Could not prepare this design's folder (${shareFailureReason(err)})`);
    }
  }

  /**
   * Starts a round: a first build from `brief`, or a change round when `instruction` is given (`brief` is then
   * ignored). Resolves `{buildId, round, kind}` once accepted, never when the round ends (M10). Refusals, in order:
   * draining 503; no design 404; the engine gate 409 (P8: `engine-gated` for an engine no person allowed,
   * `engine-refused` for one no consent lifts); no brief and no instruction 422; this design's
   * current build open, paused included, 409; a restore of the design running 409 (P5); a person with a build running
   * here 409 `person-busy` and the server at its agent cap 409 `agents-full` (P8, `refuseBusy`); pins `pinsBlock`
   * refuses 422; worca's total cost limit 403; a design folder its owner's agent cannot be given 500 (`claim`, before
   * the engine is stored or the build created); then the change round's own checks (a valid plan, known sections, 422),
   * the folder of an add the last round left unbuilt that cannot be cleared (409, either kind) and the store's, each
   * with its status. A design's stored engine is its consent (L8.2), and no argument here can grant one: a design with
   * no stored engine resolves it from the settings, meets the gate unconsented, and stores it once every refusal has
   * passed, right before the build is created.
   * @param {{ designId: string, brief?: string, instruction?: string, sections?: string[], pins?: object[],
   *   needsLead?: boolean, by?: string|null }} opts
   * @returns {Promise<{ buildId: string, round: number, kind: 'first'|'change' }>}
   */
  async start({ designId, brief, instruction, sections, pins, needsLead, by } = {}) {
    if (this._draining()) throw new DesignRefusal(503, DRAINING);
    let design = getDesign(designId);
    if (!design) throw new DesignRefusal(404, 'design not found');
    const { engine, stored } = designEngineFor(design);
    gateEngine(design, engine, stored);
    const change = isText(instruction);
    if (!change && !isText(brief)) throw new DesignRefusal(422, 'A brief is required');
    const open = openBuildRefusal(design);
    if (open) throw open;
    if (this._restoring.has(designId)) throw new DesignRefusal(409, RESTORE_RUNNING);
    this._refuseBusy(by);
    if (Array.isArray(pins) && pins.length) {
      try {
        pinsBlock(pins, { planIds: planOnDisk(design)?.sections.map((s) => s.id) ?? [] });
      } catch (err) {
        throw new DesignRefusal(422, messageOf(err));
      }
    }
    if ((this._deps.budgetStatus ?? budgetStatus)().blocked) throw new DesignRefusal(403, 'total cost limit reached');
    this.claim(designId, { owner: design.createdBy ?? by });
    let build;
    try {
      if (!stored) design = updateDesign(designId, { engine });
      build = change
        ? DesignBuild.create({ design, kind: 'change', brief: instruction, sections, pins, needsLead, by, deps: this._buildDeps() })
        : DesignBuild.create({ design, kind: 'first', brief, by, deps: this._buildDeps() });
    } catch (err) {
      throw refusalOf(err);
    }
    this._wire(build);
    this._track(build, this._personOf(by), withBillTo(by, () => build.run(), { owner: design.createdBy ?? by }));
    return { buildId: build.id, round: build.round, kind: build.kind };
  }

  /** The Build fast caps of this server, as `GET /api/design/limits` serves them: `fast` on, `calm` off. */
  limits() {
    return { fast: this._caps.fast, calm: this._caps.calm };
  }

  /** The running build `buildId`, or null: builds that are not running hold no memory (L2.6). */
  get(buildId) {
    return this._builds.get(buildId)?.build ?? null;
  }

  /**
   * Every open build, paused included (L2.20), that `viewer` may see: the design's maker decides, never who started
   * the build. `waiting` comes from the running build, else from its agent rows (a paused build keeps them, L2.29).
   * @returns {{ designId: string, buildId: string, title: string, status: string, waiting: number }[]}
   */
  live({ viewer } = {}) {
    const out = [];
    for (const row of listOpenBuilds()) {
      const design = getDesign(row.designId);
      if (!visible(design?.createdBy, viewer)) continue;
      const held = this._builds.get(row.id)?.build;
      out.push({
        designId: row.designId,
        buildId: row.id,
        title: design?.title ?? '',
        status: row.status,
        waiting: held ? held.waitingCount : listAgents(row.id).filter((a) => a.status === 'waiting').length,
      });
    }
    return out;
  }

  /** Agent processes running now, every build together: what keeps the machine awake. A waiting agent has none. */
  liveAgentCount() {
    let n = 0;
    for (const { build } of this._builds.values()) n += build.runningCount;
    return n;
  }

  /** Pauses every running build with reason `drain`; how many this call paused. Idempotent: the drain loop calls it
   *  every 200 ms, and a build already halting is not counted again. */
  pauseAll() {
    let n = 0;
    for (const { build } of this._builds.values()) if (build.pauseForDrain()) n += 1;
    return n;
  }

  /** Whether any build is still in memory: the drain loop waits on it. */
  busy() {
    return this._builds.size > 0;
  }

  /**
   * Stop. A running build is signalled and this resolves at once. A paused one is rehydrated and closed (L2.34), and
   * this resolves once it settled: terminal frame sent, nothing left in memory. Any other open row holds no build here
   * (a store throw cut its build short, M6): it is closed `stopped`, `user`, as boot recovery closes one, so Delete and
   * Start work again. A finished build is left as it is.
   * @returns {Promise<void>}
   */
  async stopBuild(buildId) {
    const held = this._builds.get(buildId);
    if (held) {
      void held.build.stop('user');
      return;
    }
    const row = getBuild(buildId);
    if (row?.status !== 'paused') {
      if (!row || !OPEN_BUILD_STATUSES.includes(row.status)) return;
      try {
        closeBuildRow(row, { status: 'stopped', reason: 'user', agentStatus: 'stopped' });
      } catch (err) {
        throw refusalOf(err);
      }
      this._liveChanged();
      return;
    }
    let build;
    try {
      build = DesignBuild.rehydrate({ buildId, deps: this._buildDeps() });
    } catch (err) {
      throw refusalOf(err);
    }
    if (!build) return;
    this._wire(build);
    await this._track(build, null, build.stop('user')).done;
  }

  /**
   * Continue (M8): the build `buildId` of `designId`, rehydrated from its rows (L2.6) and driven again, billed to
   * `by`. 503 while draining, 404 for an unknown build or one of another design, 409 while a restore of the design
   * runs or a chat hand-off stages a round into it (P5), or while it runs here; the engine gate 409 with consent given
   * (P8, L8.31: the broker, a bridged model that is not ready, an engine now refused), before any rehydrate; `start`'s
   * `person-busy` and `agents-full` 409s (P8, `refuseBusy`); the design's folders claimed for its owner's agent (`claim`,
   * 500), also before it; then `DesignBuild.continue`'s own refusals, synchronously. A refused Continue leaves nothing
   * in memory.
   * @returns {{ buildId: string }}
   * @throws {DesignRefusal}
   */
  continueBuild({ designId, buildId, sections, by } = {}) {
    if (this._draining()) throw new DesignRefusal(503, DRAINING);
    const row = getBuild(buildId);
    if (!row || row.designId !== designId) throw new DesignRefusal(404, 'build not found');
    if (this._restoring.has(designId)) throw new DesignRefusal(409, RESTORE_RUNNING);
    if (this._starting.has(designId)) throw new DesignRefusal(409, ROUND_STARTING);
    if (this._builds.has(buildId)) throw new DesignRefusal(409, 'This build is running');
    const current = getDesign(designId);
    gateEngine(current, designEngineFor(current).engine, true);
    this._refuseBusy(by);
    const owner = getDesign(designId)?.createdBy ?? by;
    this.claim(designId, { owner });
    let build;
    let drive;
    try {
      build = DesignBuild.rehydrate({ buildId, deps: this._buildDeps() });
      if (!build) throw new DesignRefusal(404, 'build not found');
      this._wire(build);
      drive = withBillTo(by, () => build.continue({ sections }), { owner });
    } catch (err) {
      throw refusalOf(err);
    }
    this._track(build, this._personOf(by), drive);
    return { buildId };
  }

  /**
   * The `design-snapshot` a late joiner of `buildId` starts from, or null: unknown, hidden from `viewer`, or any read
   * error (the socket handler calls it, so it never throws). A running build answers its own; any other is rebuilt
   * from its rows.
   */
  snapshotFor(buildId, { viewer } = {}) {
    try {
      const held = this._builds.get(buildId)?.build;
      const row = held ? null : getBuild(buildId);
      const design = getDesign(held ? held.designId : row?.designId);
      if (!design || !visible(design.createdBy, viewer)) return null;
      return held ? held.snapshot() : rowSnapshot(row, design);
    } catch {
      return null;
    }
  }

  /** Whose a frame is: `undefined` for anything but a `design-*` frame with a string `designId` (`design-restored`
   *  included); `false` for a design that does not exist, or one that cannot be read; `null` for an ownerless one;
   *  else its maker. `broadcast` calls it for every frame and sends a `false` one to no viewer (L8.21). Cached like
   *  `ASK_OWNER_CACHE`, a missing design included; a read that throws is not cached, as `askFrameComposer`. */
  frameOwner(frame) {
    try {
      if (!frame || typeof frame.type !== 'string' || !frame.type.startsWith('design-')) return undefined;
      const id = frame.designId;
      if (typeof id !== 'string') return undefined;
      if (this._owners.has(id)) return this._owners.get(id);
      const design = getDesign(id);
      const owner = design ? design.createdBy || null : false;
      if (this._owners.size > OWNER_CACHE_MAX) this._owners.clear();
      this._owners.set(id, owner);
      return owner;
    } catch {
      return false;
    }
  }

  /** Resolves once no build is left in memory, builds started meanwhile included. */
  async settled() {
    while (this._builds.size) await Promise.all([...this._builds.values()].map((e) => e.done));
  }

  /**
   * A new round's refusals past its own design's checks, in this order, before any folder is claimed: 409
   * `person-busy` while the person `by` names (`personOf`) has a build running here, then 409 `agents-full` while the
   * server runs `caps.global` agents (L8.14: a running build's next agent waits for a slot instead).
   * @throws {DesignRefusal}
   */
  _refuseBusy(by) {
    const person = this._personOf(by);
    if (person && [...this._builds.values()].some((e) => e.person === person)) throw new DesignRefusal(409, PERSON_BUSY, 'person-busy');
    const cap = this._caps.global;
    if (this.liveAgentCount() >= cap) {
      throw new DesignRefusal(409, `worca is running ${cap} agents, its limit: try again when one ends.`, 'agents-full');
    }
  }

  /** The deps every build of this registry gets, `start`'s and a rehydrate's alike: the caller's first, then the
   *  builder caps of this server and the shared machine slots; `onLiveChange` is always the registry's. */
  _buildDeps() {
    const out = { ...this._deps };
    const own = {
      maxBuildersFor: (fast) => (fast ? this._caps.fast : this._caps.calm),
      acquireGlobal: ({ signal } = {}) => this._global.acquire({ signal }),
      releaseGlobal: () => this._global.release(),
    };
    for (const [k, v] of Object.entries(own)) if (out[k] === undefined) out[k] = v;
    out.onLiveChange = () => this._liveChanged();
    return out;
  }

  _wire(build) {
    build.on('frame', (frame) => this._broadcast(frame));
  }

  /** Holds `build` until `drive` settles, then drops it and reports the change. */
  _track(build, person, drive) {
    const entry = { build, person: person ?? null, done: null };
    this._builds.set(build.id, entry);
    entry.done = Promise.resolve(drive).then(noop, noop).then(() => {
      if (this._builds.get(build.id) === entry) this._builds.delete(build.id);
      this._liveChanged();
    });
    return entry;
  }

  _liveChanged() {
    try { this._onLiveChange(); } catch (err) { console.error(`[design] onLiveChange failed: ${messageOf(err)}`); }
  }
}

/**
 * The server's Design build registry. `caps` (limits.mjs designCaps) sets the builder caps and the start-time agent
 * cap; `globalCap`, the machine slots every agent takes, follows `caps.global` unless given. `personOf(by)` names the
 * person a build counts against, or null for none (a local install: the server passes a shared sign-in's rule).
 * @param {{ broadcast: (frame: object) => void, caps?: { fast: number, calm: number, global: number },
 *   personOf?: (by: string|null|undefined) => string|null, draining?: () => boolean,
 *   onLiveChange?: () => void, globalCap?: number, deps?: object,
 *   claimDir?: (dir: string, opts: { owner: string|null, mode?: number, sharedFallback: boolean }) => void }} opts
 * @returns {DesignBuilds}
 */
export function createDesignBuilds({
  broadcast, caps = designCaps(), personOf = (by) => (by && by !== 'local' ? by : null), draining = () => false,
  onLiveChange = () => {}, globalCap = caps.global, deps = {}, claimDir = claimRunDir,
} = {}) {
  return new DesignBuilds({ broadcast, caps, personOf, draining, onLiveChange, globalCap, deps, claimDir });
}
