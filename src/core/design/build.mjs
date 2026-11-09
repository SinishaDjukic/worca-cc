// src/core/design/build.mjs
// One Design round (P2): `DesignBuild` spawns every agent of the round through `runClaude`, one AbortController per
// process, and turns what they do into C-5 frames (`'frame'` events) and P1 rows. The lead writes the shared files and
// plan.json; a valid plan becomes the round's section records, `.crew.json` and a `design-plan` frame. Then exactly one
// builder per section (M5), in plan order under the build cap (M6), never beside the lead; then the lead's integrate
// pass with at most one rework cycle; then `dist` and the version snapshot. `run()` never rejects: it resolves the
// round's end state `{status, reason}`, reasons per Contract issue 5. Nothing is recorded for playback (M1): frames go
// to listeners only. Every `startedAt`/`endedAt` the build writes is an ISO string. Design has no spending limit of its
// own (M13): the round pauses with `total-limit` at worca's total limit or per-run cap, as runs do. A round that
// ended short of `done` comes back with `DesignBuild.rehydrate` (from the P1 rows and the disk, after a pause or a
// restart alike, L2.6) and `continue({sections})`, which re-enters only the stages and sections still owed. A change
// round (`kind: 'change'`, SPEC §4, C-3) runs on the same engine: named sections alone, or a lead whose round.json
// `applyRound` applies; each section it selects carries a `todo` in the build row only (L2.35, L2.37).

import { EventEmitter } from 'node:events';
import { existsSync, mkdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { bridgeCostFor, forgetBridgeTag } from '../bridge/telemetry.mjs';
import { runClaude } from '../claude-runner.mjs';
import { budgetStatus, recordDesignCostDelta } from '../cost-budget.mjs';
import { teamRunDiscover } from '../git-free/team-repo.mjs';
import { writeJsonAtomic } from '../json-atomic.mjs';
import { checkTeamTotalGate } from '../policy/gate.mjs';
import { listProjects } from '../projects.mjs';
import { classifyError } from '../recoverable-error.mjs';
import { createAgentStream } from './agent-stream.mjs';
import { assembleDesign, lintDesign } from './assemble.mjs';
import { createAgentMeter, isListPriced, processBudgetUsd, readDesignCaps } from './cost.mjs';
import { classifyDraftPath, countLayers, createDraftStore } from './draft.mjs';
import { createFrameEmitter } from './frames.mjs';
import { boundedParser, scanShellSlots } from './html-scan.mjs';
import { isBoardKind } from './kinds.mjs';
import { stageDesignKit } from './kit.mjs';
import { asksDir, crewFile, designWorkDir, ensureDesignFolders, kitDir, sectionDir } from './paths.mjs';
import { validateIntegration, validatePlan, validateRound } from './plan.mjs';
import {
  answersPrompt, builderChangePrompt, builderPrompt, continuePrompt, integratePrompt, leadChangePrompt, leadPlanPrompt,
  noMoreQuestionsPrompt, pinsBlock, planFixPrompt, reworkPrompt, roundFixPrompt,
} from './prompts.mjs';
import { ASK_ROUNDS, newAskId, readAskFile, removeAskFile, validateAnswers } from './questions.mjs';
import { closeBuildRow } from './recover.mjs';
import { createSemaphore } from './semaphore.mjs';
import { designDenyRules, designMaxBuilders, designSpawnOptions, resolveDesignModel } from './spawn-options.mjs';
import {
  OPEN_BUILD_STATUSES, createAgent, createBuild, getBuild, getDesign, latestBuild, listAgents, requireDesign, updateAgent,
  updateBuild,
} from './store.mjs';

/** A `--resume` whose session the CLI no longer has (the text of session-host.mjs `VANISHED_RE`, copied to keep this
 *  module off the session host). */
const LOST_SESSION_RE = /No conversation found/i;
/** Error classes that hit every agent alike: the whole build pauses (L2.7). */
const HALT_CLASSES = new Set(['usage_limit', 'auth', 'quota', 'model']);
/** Transient error classes: that agent resumes once after `retryDelayMs` (L2.7). */
const RETRY_CLASSES = new Set(['rate_limit', 'network']);
const TERMINAL_AGENT = new Set(['done', 'stopped', 'error', 'interrupted']);
/** Build statuses a Continue picks up; `done` too, but only with reason `partial`. */
const CONTINUABLE = new Set(['paused', 'interrupted', 'stopped', 'error']);
/** Section statuses a Continue with no `sections` field selects again. */
const UNFINISHED = new Set(['writing', 'stopped', 'failed', 'planned']);
const ERROR_MAX = 300;

/** A refused request: `status` is the HTTP status a route answers with (M10). */
export class DesignRefusal extends Error {
  constructor(status, message, code) {
    super(message);
    this.name = 'DesignRefusal';
    this.status = status;
    if (code !== undefined) this.code = code;
  }
}

const iso = (ms) => new Date(ms).toISOString();
const messageOf = (err) => (err && typeof err.message === 'string' ? err.message : String(err));

/** The CLI's running total of the session `r` (an agent row) resumes next (M3): the `sessionUsd` the engine keeps in the
 *  row's `tokens`, else the row's cost (no process has ended yet). A lost session's `--resume` ends on a $0 result, so
 *  once it is replaced the kept figure is the fresh session's alone. */
function sessionUsdOf(r) {
  const kept = r.tokens?.sessionUsd;
  return Number.isFinite(kept) ? kept : (r.costUsd ?? 0);
}

/** At most `ERROR_MAX` characters, never half a surrogate pair. */
function capError(text) {
  const t = String(text).trim();
  if (t.length <= ERROR_MAX) return t;
  const c = t.charCodeAt(ERROR_MAX - 1);
  return t.slice(0, c >= 0xd800 && c <= 0xdbff ? ERROR_MAX - 1 : ERROR_MAX);
}

/** The section record of a plan section (C-5 `design-plan.sections`, `snapshot().sections`). `estHeight` only when the
 *  plan has it (a web page), `band` only when given, `duration` only on a video: frames copy keys as they are, so an
 *  absent field must be an absent key. */
function sectionRecord(s) {
  const rec = {
    id: s.id, job: s.job, status: 'planned', ...(s.estHeight !== undefined ? { estHeight: s.estHeight } : {}),
    parts: [...s.parts], agentId: null, summary: '',
  };
  if (s.band !== undefined) rec.band = s.band;
  if (s.duration !== undefined) rec.duration = s.duration;
  return rec;
}

/** A copy of a section record, so a frame or a snapshot never shares the live object. A change round's `todo` and an
 *  add's `unbuiltAdd` live in the build row only and never leave the engine (L2.35). */
function copySection(s) {
  const out = { ...s, parts: [...s.parts] };
  delete out.todo;
  delete out.unbuiltAdd;
  return out;
}

/** The files a section's builder writes, by part (C-2). */
const SECTION_FILES = Object.freeze(['index.html', 'style.css', 'script.js']);
const SECTIONS_MARKER = 'worca:sections';

/** True when `shell` holds a `<!--worca:sections-->` comment as the parser reads it, found as assemble.mjs's
 *  `shellMap` finds it, never by a text search: the same characters inside a script or an attribute are no marker. */
function hasSectionsMarker(shell) {
  const raw = `<!--${SECTIONS_MARKER}-->`;
  let found = false;
  const { parser, read } = boundedParser(shell, {
    oncomment(data) {
      const end = parser.endIndex + 1;
      if (data === SECTIONS_MARKER && shell.startsWith(raw, end - raw.length)) found = true;
    },
  });
  read();
  return found;
}

/** The `ok` slots of `shell`, scanned now: every edit re-scans, since an insert or a cut moves the later offsets. */
const okSlots = (shell) => scanShellSlots(shell).filter((s) => s.ok);

/** `shell` with a slot for the added section `id` (M5): right after `anchor`'s slot, a sibling in the same parent;
 *  with none, the shell is left alone when it has the sections marker (the assembler places the section there in
 *  plan order), else the slot goes right after the last slot, since a strict assembly refuses a section with neither.
 *  An `id` that already has a slot (the lead placed it) is left alone: a second one would be lint's duplicate. */
function placeSlot(shell, id, anchor, marker) {
  const slots = okSlots(shell);
  if (slots.some((s) => s.id === id)) return shell;
  const own = anchor === null ? undefined : slots.find((s) => s.id === anchor);
  const at = own ? own.end : (!marker && slots.length ? slots.at(-1).end : -1);
  return at < 0 ? shell : `${shell.slice(0, at)}<div data-worca-slot="${id}"></div>${shell.slice(at)}`;
}

/** `shell` without any slot of the removed section `id`, so lint never reports `shell-slot-unknown`. */
function cutSlots(shell, id) {
  let out = shell;
  for (let slot = okSlots(out).find((s) => s.id === id); slot; slot = okSlots(out).find((s) => s.id === id)) {
    out = out.slice(0, slot.start) + out.slice(slot.end);
  }
  return out;
}

/**
 * A valid, normalized round applied to the plan and the shell (Contract issue 1: the one owner of applying
 * round.json). Pure. `touch` changes nothing here: its brief is this round's text only. Each `add` goes right after
 * its `after` (after any add this round already placed there, so two adds naming one `after` keep round order, in the
 * plan and the shell), or at the end without one; it keeps its `band` and drops `after`. Adds go before removes, so a
 * shell whose only slot belongs to a removed section still anchors the add. Each `remove` drops the section and its
 * slots. Shell edits go through `scanShellSlots`, re-scanned for each edit.
 * @param {{ plan: object, round: { touch: object[], add: object[], remove: string[] }, shellHtml: string }} opts
 * @returns {{ plan: object, shellHtml: string, removed: string[] }}
 */
export function applyRound({ plan, round, shellHtml }) {
  const sections = plan.sections.map((s) => ({ ...s, parts: [...s.parts] }));
  let shell = String(shellHtml ?? '');
  const marker = hasSectionsMarker(shell);
  /** Anchor id -> the last add this round placed right after it: the next add naming that anchor follows it. */
  const tail = new Map();
  for (const { after, ...add } of round.add) {
    let anchor = after ?? null;
    while (anchor !== null && tail.has(anchor)) anchor = tail.get(anchor);
    const i = anchor === null ? -1 : sections.findIndex((s) => s.id === anchor);
    sections.splice(i < 0 ? sections.length : i + 1, 0, { ...add, parts: [...add.parts] });
    if (anchor !== null) tail.set(anchor, add.id);
    shell = placeSlot(shell, add.id, anchor, marker);
  }
  const removed = [...round.remove];
  for (const id of removed) shell = cutSlots(shell, id);
  const gone = new Set(removed);
  return { plan: { ...plan, sections: sections.filter((s) => !gone.has(s.id)) }, shellHtml: shell, removed };
}

/**
 * What a change round starts from, read before its row exists: the plan on disk (`validatePlan`), the named
 * `sections` (plan section ids), whether a lead runs (by default when no section is named; a round with no section
 * named always has one) and the pins block (`pinsBlock`, not persisted). 422 when there is no valid plan, a name is
 * not a plan section, or the pins are refused.
 * @throws {DesignRefusal}
 */
function changeStart(design, { sections, pins, needsLead }) {
  let text = null;
  try { text = readFileSync(join(designWorkDir(design.id), 'plan.json'), 'utf8'); } catch { /* no plan yet */ }
  const check = text === null ? null : validatePlan(text, { kind: design.kind });
  if (!check?.ok) throw new DesignRefusal(422, 'A change round needs a valid plan');
  const ids = check.plan.sections.map((s) => s.id);
  const named = sections == null ? [] : sections;
  if (!Array.isArray(named) || named.some((id) => typeof id !== 'string' || !ids.includes(id))) {
    throw new DesignRefusal(422, 'sections must list sections of the plan');
  }
  let pinBlock;
  try { pinBlock = pinsBlock(pins, { planIds: ids }); } catch (err) { throw new DesignRefusal(422, messageOf(err)); }
  const lead = needsLead === undefined ? !named.length : Boolean(needsLead) || !named.length;
  return { plan: check.plan, named: [...new Set(named)], needsLead: lead, pinBlock };
}

/** A change round's section records: one per plan section, keeping its status, summary and agentId from the previous
 *  round's row, and its `unbuiltAdd` while that add still has no builder, never its `todo` (a todo belongs to one
 *  round, L2.37). A lead-less round's named sections are `planned` with `todo:{stage:'change'}`. */
function carriedRecords(plan, prevRecords, { named, needsLead }) {
  const prev = new Map((Array.isArray(prevRecords) ? prevRecords : []).map((r) => [r?.id, r]));
  const selected = new Set(needsLead ? [] : named);
  return plan.sections.map((s) => {
    const rec = sectionRecord(s);
    const old = prev.get(s.id);
    if (old) Object.assign(rec, { status: old.status, summary: old.summary ?? '', agentId: old.agentId ?? null });
    if (old?.unbuiltAdd === true) rec.unbuiltAdd = true;
    if (selected.has(s.id)) Object.assign(rec, { status: 'planned', todo: { stage: 'change' } });
    return rec;
  });
}

/**
 * A round's start, either kind, before its row: the folder of every `unbuiltAdd` in the latest round's `records`
 * goes. Such an add's round ended before its builder started (a drain, a limit, a Stop, a restart), so its folder can
 * hold only what a removed section of the same id left there (`_tidyRound`), and dist would assemble those files as
 * the add's content. A first build's records never carry the mark, so this is the last round that knows it. A folder
 * that cannot be cleared refuses the round (409) with the folder named; nothing was written yet.
 * @throws {DesignRefusal}
 */
function clearUnbuiltAdds(designId, records) {
  for (const rec of Array.isArray(records) ? records : []) {
    if (rec?.unbuiltAdd !== true) continue;
    try {
      rmSync(sectionDir(designId, rec.id), { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
    } catch (err) {
      throw new DesignRefusal(409, `sections/${rec.id} still holds the files of a removed section and could not be cleared `
        + `(${messageOf(err)}): close the program using that folder, then start the round again`);
    }
  }
}

/** The registered project's folder for a design's `projectKey`, matched by key (Contract issue 9), else null. */
async function projectDirFor(key) {
  if (!key) return null;
  return (await listProjects()).find((p) => p.key === key)?.path ?? null;
}

function realDir(dir) {
  try { return realpathSync(dir); } catch { return undefined; }
}

/** The injectable dependencies; a key given as `undefined` keeps its default, and unknown keys pass through. */
function withDefaults(deps = {}) {
  const out = {
    runClaude,
    now: Date.now,
    staggerMs: 250,
    retryDelayMs: 5000,
    maxBuildersFor: (fast) => designMaxBuilders({ fast, hosted: false }),
    acquireGlobal: async () => {},
    releaseGlobal: () => {},
    snapshotVersion: async () => {},
    onLiveChange: () => {},
    budgetStatus,
    teamTotalGate: checkTeamTotalGate,
    readCaps: readDesignCaps,
    isListPriced,
    stageKit: stageDesignKit,
    mock: undefined,
  };
  for (const [k, v] of Object.entries(deps || {})) if (v !== undefined) out[k] = v;
  return out;
}

export class DesignBuild extends EventEmitter {
  /**
   * A new round of `design` (a row or an id): `createBuild` assigns `round` and makes it the design's current build.
   * `instruction` is an alias of `brief`. A change round reads the plan on disk and the previous round's section
   * records through `latestBuild` before `createBuild` makes it the latest, then writes them to its own row (which
   * `createBuild` leaves empty) with every `todo` dropped, and `.crew.json` follows. Either kind, before the row, the
   * folder of each add the latest round left with no build goes (`clearUnbuiltAdds`). Its draft store runs with
   * `landFirst`. Emits nothing, so a listener attached right after misses no frame. Throws the store's `DesignError`,
   * and a `DesignRefusal` before any row: 409 for an add's folder that cannot be cleared, and for a change round 422
   * (`changeStart`). A throw once the row exists closes it `error`, `engine-error` first (M6): no build would hold it,
   * and an open row refuses every later Start.
   * @param {{ design: object|string, kind?: 'first'|'change', brief?: string, instruction?: string, sections?: unknown,
   *   pins?: unknown, needsLead?: boolean, by?: string|null, deps?: object }} opts
   */
  static create({ design, kind = 'first', brief, instruction, sections, pins, needsLead, by, deps } = {}) {
    const d = requireDesign(typeof design === 'string' ? design : design?.id);
    const text = brief ?? instruction;
    const start = kind === 'change' ? changeStart(d, { sections, pins, needsLead }) : null;
    const prev = latestBuild(d.id);
    clearUnbuiltAdds(d.id, prev?.sections);
    const created = createBuild({ designId: d.id, kind, brief: text, fast: d.fast }, { by });
    try {
      if (!start) return new DesignBuild({ design: d, row: created, deps: withDefaults(deps) });
      const records = carriedRecords(start.plan, prev?.sections, start);
      const row = updateBuild(created.id, { sections: records });
      const b = new DesignBuild({ design: d, row, deps: withDefaults(deps), start, landFirst: true });
      b._plan = start.plan;
      b._planRev = 1;
      b._sections = records;
      b._seedLayers();
      b._writeCrew();
      return b;
    } catch (err) {
      try {
        updateBuild(created.id, { status: 'error', reason: 'engine-error' });
      } catch (e) {
        console.error(`[design] build ${created.id}: row not closed after a failed start: ${messageOf(e)}`);
      }
      throw err;
    }
  }

  /**
   * The build `buildId` rebuilt from its rows and the disk, for a Continue or a Stop after a pause or a restart alike
   * (L2.6); null only for an unknown build. Build fast comes from the design row (M7). `seq` and every path's `rev`
   * restart from `Date.now()`, and each path's first frame is a `design-file` base (L2.21). The instance starts
   * settled: `pauseForDrain` answers false, `stop` closes a `paused` build (L2.34) and `run()` drives nothing.
   * Emits nothing, so a listener attached right after misses no frame.
   * @param {{ buildId: string, deps?: object }} opts
   * @returns {DesignBuild|null}
   */
  static rehydrate({ buildId, deps } = {}) {
    const row = getBuild(buildId);
    if (!row) return null;
    const b = new DesignBuild({
      design: requireDesign(row.designId), row, deps: withDefaults(deps), landFirst: true, seqStart: Date.now(), revBase: Date.now(),
    });
    b._restore();
    return b;
  }

  /** @private Use `DesignBuild.create`. */
  constructor({ design, row, deps, start = {}, landFirst = false, seqStart = 0, revBase = 0 }) {
    super();
    this._deps = deps;
    this._design = design;
    this._row = row;
    /** A change round's start (`changeStart`): `{plan, named, needsLead, pinBlock}`; empty on a rehydrate, since
     *  none of it is persisted (a Continue resumes sessions that already hold it). */
    this._start = start;
    this._status = row.status;
    this._reason = row.reason ?? null;
    this._workDir = designWorkDir(design.id);
    this._realWorkDir = undefined;
    this._projectDir = null;
    this._denyRules = [];
    /** Every agent of the round, in creation order. */
    this._agents = [];
    /** Agents whose process runs now. */
    this._running = new Set();
    this._lastLive = 0;
    this._plan = null;
    this._planRev = 0;
    this._sections = [];
    /** Section `index.html` path -> its layer count, from the latest `design-file`. */
    this._layers = new Map();
    this._costUsd = Number(row.costUsd) || 0;
    /** worca's per-run cap for this round (Settings or the team), read at the start of each drive; null: none (M13). */
    this._cap = null;
    /** The first halt's end state `{status, reason}`; the drive settles on it. */
    this._end = null;
    this._settled = false;
    this._endedMs = null;
    /** Aborts every queue and slot wait of this build. */
    this._haltCtl = new AbortController();
    /** The build slots: builders on stage at once (M6), a waiting one included (L2.28). Sized by the design's Build
     *  fast, then by `setFast` (M7). */
    this._slots = createSemaphore(deps.maxBuildersFor(Boolean(design.fast)));
    this._nextSpawnAt = 0;
    this._runP = null;
    this._frames = createFrameEmitter({
      designId: design.id, buildId: row.id, seqStart, now: () => this._deps.now(), emit: (f) => this._send(f),
    });
    this._drafts = createDraftStore({
      readDisk: (rel) => this._readWork(rel),
      landFirst,
      revBase,
      onSplice: ({ agentId, path, rev, splice }) => {
        const c = classifyDraftPath(path);
        if (c) this._frames.delta({ agentId, path, sectionId: c.sectionId, part: c.part, rev, splice });
      },
      onLand: ({ path, rev, text }) => this._fileFrame(path, text, rev),
    });
  }

  get id() { return this._row.id; }
  get designId() { return this._row.designId; }
  get round() { return this._row.round; }
  get kind() { return this._row.kind; }
  get status() { return this._status; }
  get reason() { return this._reason; }
  get createdBy() { return this._row.createdBy; }
  get title() { return this._design.title; }
  /** Agents waiting on an answer. */
  get waitingCount() { return this._agents.filter((a) => a.status === 'waiting').length; }
  /** Processes running now. */
  get runningCount() { return this._running.size; }

  /** Runs the round once; later calls return the same promise. Never rejects: a throw ends `error`, `engine-error`. */
  run() {
    if (!this._runP) this._runP = this._guarded(() => this._drive({ fresh: true }));
    return this._runP;
  }

  /** Halts the round: every queue wait, every running process and every parked waiter is aborted. Idempotent, and the
   *  first end state wins. Resolves with the drive's end state. On a settled `paused` build, this instance or a
   *  rehydrated one, it closes the build (L2.34): the end state `stopped`, its waiting agents stopped and the terminal
   *  frame, so Stop then Delete works; a close the store cannot write ends `error`, `engine-error` (`_settleSafely`),
   *  never a throw. On a terminal build it has no effect. */
  stop(reason = 'user') {
    if (this._settled) {
      if (this._status === 'paused') this._settleSafely('stopped', reason);
      return Promise.resolve({ status: this._status, reason: this._reason });
    }
    this._halt('stopped', reason);
    return this._runP ?? Promise.resolve({ status: this._status, reason: this._reason });
  }

  /**
   * Picks a round up again (M8, L2.11): allowed while it is the design's current build and has settled `paused`,
   * `interrupted`, `stopped` or `error`, or `done` with reason `partial`. `sections` names plan sections that are not
   * `done`, and only those are retried; without it every `writing`, `stopped`, `failed` and `planned` section is. An
   * agent whose question file exists always re-enters and asks again under a fresh `askId`, whatever `sections` says
   * (U3: it is written `waiting`, no process runs). The lead stage re-enters on its own row while no plan is held
   * (L2.1), or in a change round while its round is unapplied, and the build then reads `planning`; integrate runs
   * when integration.json is missing. With nothing else to do, integration is owed only then and only before the round
   * finished: a `done` round (reason `partial`) reached its finish, so its integrate pass ran though L2.10 lets a pass
   * write no file, and that Continue is a 409 (L2.38), never a second pass and version. In a change round only sections with a `todo` count, for `sections` and for
   * the default selection alike (L2.37). `startedAt` moves forward by the pause, so `elapsedMs`
   * leaves it out. No limit of its own (M13): the drive reads worca's caps again, and a cap still reached pauses the
   * round with `total-limit` before any spawn. A second call on the same instance drives again.
   * @param {{ sections?: string[] }} [opts]
   * @returns {Promise<{ status: string, reason: string|null }>} the drive's end state; never rejects
   * @throws {DesignRefusal} synchronously: 409 while it runs, for a build that is not the design's current one, for an
   *   end state Continue does not pick up, and when nothing is left to do; 422 for a bad `sections`; 403 at worca's
   *   total cost limit
   */
  continue({ sections } = {}) {
    if (!this._settled) throw new DesignRefusal(409, 'This build is running');
    if (getDesign(this.designId)?.currentBuild !== this.id) throw new DesignRefusal(409, 'A newer round of this design exists');
    if (!CONTINUABLE.has(this._status) && !(this._status === 'done' && this._reason === 'partial')) {
      throw new DesignRefusal(409, 'This build has nothing left to continue');
    }
    const asking = this._plan
      ? this._agents.filter((a) => a.role === 'builder' && this._sections.some((s) => s.id === a.sectionId) && readAskFile(this.designId, a.id))
      : [];
    const ids = this._selection(sections);
    for (const a of asking) ids.add(a.sectionId);
    const integrated = this._status === 'done';
    const integrateDue = Boolean(this._plan) && this._agents.some((a) => a.role === 'lead') && !integrated && !existsSync(this._integrationFile());
    const leadDue = this._leadStageDue();
    if (this._plan && !ids.size && !integrateDue && !leadDue) throw new DesignRefusal(409, 'Nothing to continue');
    if (this._deps.budgetStatus().blocked) throw new DesignRefusal(403, 'total cost limit reached');

    const now = this._deps.now();
    const row = getBuild(this.id) ?? this._row;
    // L2.11: active time only. A row paused without endedAt (paused is open, so the store never set it) shifts by 0.
    const startedAt = iso(now - ((Date.parse(row.endedAt) || now) - Date.parse(row.startedAt)));
    for (const s of this._sections) if (ids.has(s.id)) s.status = 'planned';
    const status = leadDue ? 'planning' : 'building';
    this._row = updateBuild(this.id, { status, reason: null, startedAt, endedAt: null, sections: this._sections });
    this._status = status;
    this._reason = null;
    this._settled = false;
    this._end = null;
    this._endedMs = null;
    this._haltCtl = new AbortController();
    for (const a of this._agents) {
      a.stopKind = null;
      a.stopCtl = new AbortController();
      a.waiter = null;
      a.lostOnce = false;
      a.retried = false;
    }
    this._writeCrew();
    this._emitBuild();
    this._frames.flush();
    for (const s of this._sections) if (ids.has(s.id)) this._sectionFrame(s);
    this._runP = this._guarded(() => this._drive({ selection: this._plan ? ids : null }));
    return this._runP;
  }

  /** The ids a Continue retries: `sections` checked (422 unless a non-empty list of plan sections not `done`, and in
   *  a change round each with a `todo`), else every unfinished one (in a change round, of those with a `todo`). */
  _selection(sections) {
    if (sections === undefined) {
      return new Set(this._sections.filter((s) => UNFINISHED.has(s.status) && this._inRound(s)).map((s) => s.id));
    }
    const bad = () => new DesignRefusal(422, 'sections must list sections of the plan that are not done');
    if (!Array.isArray(sections) || !sections.length) throw bad();
    for (const id of sections) {
      const s = typeof id === 'string' ? this._sections.find((x) => x.id === id) : undefined;
      if (!s || s.status === 'done' || !this._inRound(s)) throw bad();
    }
    return new Set(sections);
  }

  /** Whether this round owns section record `s`: every section of a first build; in a change round only those it
   *  selected, which carry a `todo` (L2.37). */
  _inRound(s) { return this.kind !== 'change' || Boolean(s.todo); }

  /**
   * Whether a drive starts with a lead stage: the plan stage while no plan is held; in a change round, on `run()`
   * (`fresh`) when the round needs a lead, and later only while its round is unapplied: a lead row not `done` whose
   * `job` is not `Integrate` (the lead goes `done` once the round's files are written, and integrate persists
   * `Integrate`). Re-running an applied round would re-add and re-remove ids, which `validateRound` refuses.
   */
  _leadStageDue(fresh = false) {
    if (this.kind !== 'change') return !this._plan;
    if (fresh) return this._start.needsLead === true;
    const lead = this._agents.find((a) => a.role === 'lead');
    return Boolean(lead) && lead.status !== 'done' && lead.job !== 'Integrate';
  }

  /**
   * The person stopped one agent: only its own process, wait or waiter is aborted. A builder's section then ends
   * `stopped` and the round goes on (L2.22). The lead while it plans stops the round; the lead while it integrates
   * only skips integration, and the round still finishes. False for an id this round does not have; true with no
   * effect for an agent that already ended, or once the round has settled.
   */
  stopAgent(id) {
    const agent = this._agents.find((a) => a.id === id);
    if (!agent) return false;
    if (this._settled || agent.stopKind || TERMINAL_AGENT.has(agent.status)) return true;
    agent.stopKind = 'stopped';
    if (agent.role === 'lead' && this._status !== 'integrating') {
      void this.stop('user');
      return true;
    }
    agent.stopCtl?.abort();
    agent.controller?.abort();
    this._wake(agent, null);
    return true;
  }

  /**
   * The person's answers to the question an agent waits on (C-8 `answer`). 409 unless `askId` names a question that
   * waits now: an unknown or stale id, a second answer, a build halted or paused (L2.25; a Continue asks again under a
   * fresh id). 422 unless `answers` answers every question once with one of its option values; the question then
   * stays open. On success the agent leaves `waiting` at once and its loop resumes the session with the answers.
   * @param {string} askId
   * @param {{ id: string, value: string }[]} answers
   * @throws {DesignRefusal}
   */
  answer(askId, answers) {
    const agent = this._agents.find((a) => a.ask && a.ask.askId === askId);
    if (!agent || !agent.waiter) throw new DesignRefusal(409, 'This question is no longer open');
    const check = validateAnswers(agent.ask.questions, answers);
    if (!check.ok) throw new DesignRefusal(422, check.error);
    agent.ask = null;
    this._setAgentStatus(agent, 'starting');
    this._wake(agent, answers.map(({ id, value }) => ({ id, value })));
  }

  /** The server is stopping: the round pauses with reason `drain`, as `orch.pauseForDrain()` does for a run. True
   *  only for the call that paused it; false once a halt is under way (its own end state stands) or settled. */
  pauseForDrain() {
    if (this._settled || this._end) return false;
    this._halt('paused', 'drain');
    return true;
  }

  /** Build fast changed (M7): the cap for the next spawn. No running agent is touched, no plan changes, no frame is
   *  sent; persisting the setting is the route's job. */
  setFast(fast) {
    this._slots.resize(this._deps.maxBuildersFor(Boolean(fast)));
  }

  /**
   * The C-5 `design-snapshot` a late joiner starts from (M1: nothing is replayed). The drafts are taken first, which
   * sends any pending text as deltas, and `seq` is read after: a client drops every frame at or below `seq`, so no
   * text arrives twice. No drafts once the build has settled. `questions` holds every question an agent waits on now,
   * in agent order; none once settled, since `askId` lives in memory (a paused build's Continue asks again).
   */
  snapshot() {
    const drafts = this._settled ? [] : this._drafts.snapshot();
    return {
      type: 'design-snapshot',
      designId: this.designId,
      buildId: this.id,
      seq: this._frames.lastSeq(),
      ts: this._deps.now(),
      build: this._buildFields(),
      plan: { planRev: this._planRev, canvas: this._plan ? { ...this._plan.canvas } : null, sections: this._sections.map(copySection) },
      agents: this._agents.map((a) => this._agentFields(a)),
      sections: this._sections.map(copySection),
      questions: this._agents.filter((a) => a.ask).map((a) => this._questionFields(a)),
      drafts,
    };
  }

  async _guarded(drive) {
    try {
      await drive();
    } catch (err) {
      console.error(`[design] build ${this.id} failed: ${messageOf(err)}`);
      this._abortAll();
      if (!this._settled) this._settleSafely('error', 'engine-error');
    }
    return { status: this._status, reason: this._reason };
  }

  /**
   * `_settle`, never a throw. When it throws (a store error), the build ends `error`, `engine-error` in memory, and its
   * row too, closed the way boot recovery closes one (M6): its live agents and `writing` sections `stopped`. Else the
   * registry would drop a settled build whose row stays open, and that row would refuse every Start, Continue and
   * Delete until the next restart.
   */
  _settleSafely(status, reason) {
    try {
      this._settle(status, reason);
      return;
    } catch (err) {
      console.error(`[design] build ${this.id}: end state not saved: ${messageOf(err)}`);
    }
    this._status = 'error';
    this._reason = 'engine-error';
    this._settled = true;
    try {
      const row = getBuild(this.id);
      if (row && OPEN_BUILD_STATUSES.includes(row.status)) closeBuildRow(row, { status: 'error', reason: 'engine-error', agentStatus: 'stopped' });
    } catch (err) {
      console.error(`[design] build ${this.id}: row not closed: ${messageOf(err)}`);
    }
  }

  /**
   * Walks the round's stages, each one only when it is still owed, so a later drive can re-enter it: the lead unless
   * a valid plan is held; the builders over every `planned` section; the verdict on the sections; the integrate pass
   * unless integration.json exists, with its one rework cycle and a second verdict; then the finish. A halt settles
   * on its own end state after any stage. `fresh` is `run()`'s first drive: a stale `integration.json` from an
   * earlier round is removed. `selection` (a Continue's section ids) limits the builder stage; the verdicts still
   * judge every section. A halt or a throw from the integrate pass through its rework cycle removes integration.json,
   * so a Continue integrates again rather than losing the `rework` list. worca's per-run cap is read once, here, and a
   * deck's or a video's kit is staged on every drive.
   * A change round sends `design-plan` right after its first `design-build` (carried statuses, the selection
   * `planned`); its lead stage is the `change` stage (`_leadStageDue`), a stale round.json goes at `run()`, and its
   * builder stage and verdicts take only the sections with a `todo`. A lead stage that applied a round lifts the
   * selection: the round's own sections are all owed.
   */
  async _drive({ fresh = false, selection = null } = {}) {
    this._emitBuild();
    if (fresh && this.kind === 'change') this._planFrame();
    ensureDesignFolders(this.designId);
    // L7.12: a deck or a video inlines its runtime from work/.kit/, so every drive stages it, a Continue too: a round
    // whose staging threw, or one paused before P7, has no kit, and its end would fail every time (a web page keeps
    // P5's chat staging alone). A throw is the round's `engine-error` through `_guarded`.
    if (isBoardKind(this._design.kind)) await this._deps.stageKit({ kind: this._design.kind, workDir: designWorkDir(this.designId) });
    if (fresh) {
      this._dropIntegration();
      if (this.kind === 'change') this._dropRound();
    }
    this._realWorkDir = realDir(this._workDir);
    this._projectDir = await projectDirFor(this._design.projectKey);
    this._denyRules = await designDenyRules({ projectDir: this._projectDir });
    const caps = await this._deps.readCaps({ projectDir: this._projectDir });
    this._cap = Number.isFinite(caps?.perRunCapUsd) ? caps.perRunCapUsd : null;
    let pick = selection;
    if (this._leadStageDue(fresh)) {
      const failed = this.kind === 'change' ? await this._leadChange() : await this._leadPass();
      if (this._end) return this._settleHalt();
      if (failed) return this._settle('error', failed);
      pick = null;
    }
    this._setStatus('building');
    const queued = this._sections.filter((s) => s.status === 'planned' && (!pick || pick.has(s.id)) && this._inRound(s));
    await this._runBuilders(queued.map((section) => ({ section, prompt: null })));
    if (this._end) return this._settleHalt();
    const open = this._afterBuilders();
    if (open) return this._settle('paused', open);
    if (!existsSync(this._integrationFile())) {
      let rework;
      try {
        rework = await this._integrate();
        if (this._end) { this._dropIntegration(); return this._settleHalt(); }
        if (rework.length) {
          this._setStatus('building');
          await this._runBuilders(rework);
          if (this._end) { this._dropIntegration(); return this._settleHalt(); }
        }
      } catch (err) {
        this._dropIntegration();
        throw err;
      }
      if (rework.length) {
        const again = this._afterBuilders();
        if (again) return this._settle('paused', again);
      }
    }
    return this._finish();
  }

  _dropIntegration() { rmSync(this._integrationFile(), { force: true, maxRetries: 10, retryDelay: 100 }); }

  _roundFile() { return join(this._workDir, 'round.json'); }

  _dropRound() { rmSync(this._roundFile(), { force: true, maxRetries: 10, retryDelay: 100 }); }

  /**
   * A lead stage on the round's one lead row (L2.1): a Continue re-enters on the same row and session (`waiting` on
   * its question file), never a second lead; otherwise the row is created before the first spawn. `read` checks the
   * file the stage writes; an invalid one gets one resume with its errors (`fixPrompt`).
   * @returns {Promise<{ failed: 'lead-failed' }|{ agent: object, check: { ok: boolean, errors: string[] } }>}
   */
  async _leadStage({ stage, firstPrompt, read, fixPrompt }) {
    let agent = this._agents.find((a) => a.role === 'lead');
    let prompt;
    if (agent) {
      this._reopenAgent(agent, agent.job, this._readAsk(agent) ? 'waiting' : 'starting');
      agent.firstPrompt = firstPrompt(agent);
      prompt = agent.sessionId ? continuePrompt({ role: 'lead' }) : agent.firstPrompt;
    } else {
      const { model, effort } = resolveDesignModel('lead');
      agent = this._newAgent({ role: 'lead', sectionId: null, job: 'Lead', model, effort, cwd: this._workDir });
      agent.firstPrompt = firstPrompt(agent);
      prompt = agent.firstPrompt;
    }
    let outcome = await this._runAgentLoop(agent, prompt, { stage });
    let check = outcome === 'done' ? read() : null;
    if (check && !check.ok) {
      outcome = await this._runAgentLoop(agent, fixPrompt({ errors: check.errors }), { stage });
      check = outcome === 'done' ? read() : null;
    }
    if (outcome !== 'done') {
      if (outcome === 'failed') this._endAgent(agent, 'error');
      return { failed: 'lead-failed' };
    }
    return { agent, check };
  }

  /** The lead ends `error` with `message`; the round fails `plan-invalid`. */
  _leadInvalid(agent, message) {
    agent.error = capError(message);
    this._endAgent(agent, 'error');
    return 'plan-invalid';
  }

  /** The lead writes the shared files and plan.json; an invalid plan gets one resume with its errors.
   *  @returns {Promise<null|'lead-failed'|'plan-invalid'>} null once a valid plan is held */
  async _leadPass() {
    const r = await this._leadStage({
      stage: 'plan', firstPrompt: (a) => this._leadPlanPrompt(a), read: () => this._readPlan(), fixPrompt: planFixPrompt,
    });
    if (r.failed) return r.failed;
    if (!r.check.ok) return this._leadInvalid(r.agent, `plan.json is not valid: ${r.check.errors.join('; ')}`);
    this._takePlan(r.check.plan);
    this._endAgent(r.agent, 'done');
    return null;
  }

  /** A change round's lead (stage `change`, C-3): round.json, checked by `validateRound` against the plan held, one
   *  resume with its errors, then applied (`_applyRound`). The lead row goes `done` only once the round's files are
   *  written, so a later drive re-enters this stage only while the round is unapplied (L2.37).
   *  @returns {Promise<null|'lead-failed'|'plan-invalid'>} null once the round is applied */
  async _leadChange() {
    const r = await this._leadStage({
      stage: 'change', firstPrompt: (a) => this._leadChangePrompt(a), read: () => this._readRound(), fixPrompt: roundFixPrompt,
    });
    if (r.failed) return r.failed;
    if (!r.check.ok) return this._leadInvalid(r.agent, `round.json is not valid: ${r.check.errors.join('; ')}`);
    const errors = this._applyRound(r.check.round);
    if (errors) return this._leadInvalid(r.agent, `the plan after round.json is not valid: ${errors.join('; ')}`);
    this._endAgent(r.agent, 'done');
    return null;
  }

  _readRound() {
    let text;
    try { text = readFileSync(this._roundFile(), 'utf8'); } catch { return { ok: false, errors: ['round.json was not written'], round: null }; }
    return validateRound(text, { plan: this._plan });
  }

  /**
   * Applies a valid round: `applyRound` over the plan held and shell.html, given the NORMALIZED round (a web add
   * without `estHeight` gets 240), and the result must pass `validatePlan` before anything is written; else the
   * plan's errors come back and nothing changed. Then plan.json and shell.html, the records (a touch `planned` with
   * `todo:{stage:'change',brief}`, an add `planned` with `todo:{stage:'first'}` and `unbuiltAdd`, every other section
   * as it was, a removed one gone), `design-section` `removed` per removed section and `design-plan` at planRev 2.
   * Last, and only best-effort (M5), round.json and each removed section's folder go: a Windows program holding one
   * makes the remove throw, and the round is already applied by then, so a throw would leave it half done for every
   * Continue. A leftover round.json is never read again: the lead row goes `done` next. A leftover folder is named by
   * no plan until a later round adds a section of the same id. That add keeps `unbuiltAdd` in its record, carried from
   * round to round, until its builder row exists, and the folder goes before that: in the adding round before its
   * first build (`_clearAdded`), in any later change round before that round's row (`clearUnbuiltAdds`). So its files
   * never land as a base, pass as the new section's build or reach dist.
   * @returns {string[]|null} null once applied
   */
  _applyRound(round) {
    const shell = this._readWork('shell.html');
    const out = applyRound({ plan: this._plan, round, shellHtml: shell ?? '' });
    const check = validatePlan(out.plan, { kind: this._design.kind });
    if (!check.ok) return check.errors;
    writeJsonAtomic(this._planFile(), check.plan);
    if (typeof shell === 'string' && out.shellHtml !== shell) writeFileSync(join(this._workDir, 'shell.html'), out.shellHtml);
    const before = new Map(this._sections.map((s) => [s.id, s]));
    const touched = new Map(round.touch.map((t) => [t.id, t.brief]));
    this._plan = check.plan;
    this._planRev = 2;
    this._sections = check.plan.sections.map((s) => {
      const rec = before.get(s.id);
      if (!rec) return { ...sectionRecord(s), todo: { stage: 'first' }, unbuiltAdd: true };
      if (touched.has(s.id)) Object.assign(rec, { status: 'planned', todo: { stage: 'change', brief: touched.get(s.id) } });
      return rec;
    });
    for (const id of out.removed) this._layers.delete(`sections/${id}/index.html`);
    updateBuild(this.id, { sections: this._sections });
    this._writeCrew();
    for (const id of out.removed) {
      const rec = before.get(id);
      this._frames.send('design-section', { sectionId: id, status: 'removed', agentId: rec?.agentId ?? null, summary: rec?.summary ?? '' });
    }
    this._planFrame();
    this._emitBuild();
    this._tidyRound(out.removed);
    return null;
  }

  /** An applied round's leftovers, each removed on its own and logged when it cannot be (`_applyRound`, M5). */
  _tidyRound(removed) {
    const tidy = (what, fn) => {
      try { fn(); } catch (err) { console.error(`[design] build ${this.id}: ${what} not removed: ${messageOf(err)}`); }
    };
    tidy('round.json', () => this._dropRound());
    for (const id of removed) {
      tidy(`the folder of removed section ${id}`, () => rmSync(sectionDir(this.designId, id), { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }));
    }
  }

  _planFile() { return join(this._workDir, 'plan.json'); }

  _kitContract() {
    const contract = join(kitDir(this.designId), 'CONTRACT.md');
    return existsSync(contract) ? contract : null;
  }

  _questionFile(agent) { return join(asksDir(this.designId), `${agent.id}.json`); }

  /** The plan stage's first prompt for the lead `agent`, from the build's brief. */
  _leadPlanPrompt(agent) {
    return leadPlanPrompt({
      brief: this._row.brief,
      kind: this._design.kind,
      fast: this._row.fast,
      projectDir: this._projectDir,
      kitContract: this._kitContract(),
      questionFile: this._questionFile(agent),
      planFile: this._planFile(),
    });
  }

  /** A rehydrated lead's first prompt: the change round's for a `change` build, else the plan stage's. */
  _leadFirstPrompt(agent) {
    if (this.kind !== 'change') return this._leadPlanPrompt(agent);
    return this._leadChangePrompt(agent);
  }

  /** The change stage's first prompt for the lead `agent`: the round's instruction (the build's brief), the named
   *  sections and the pins block (neither persisted: empty after a rehydrate). */
  _leadChangePrompt(agent) {
    return leadChangePrompt({
      instruction: this._row.brief,
      kind: this._design.kind,
      sections: this._start.named,
      kitContract: this._kitContract(),
      questionFile: this._questionFile(agent),
      roundFile: this._roundFile(),
      pinBlock: this._start.pinBlock,
    });
  }

  /** A builder's first prompt, from its plan section; null while no plan is held. A section whose `todo` is a
   *  `change` gets the change round's prompt (Read then Edit, its `todo.brief`, the pins when it was named), so a
   *  rehydrate rebuilds it from the row (L2.35); any other the first-build prompt. */
  _builderFirstPrompt(agent) {
    const section = this._plan?.sections.find((s) => s.id === agent.sectionId) ?? this._sections.find((s) => s.id === agent.sectionId);
    if (!this._plan || !section) return null;
    const todo = this._sections.find((s) => s.id === agent.sectionId)?.todo;
    if (todo?.stage === 'change') {
      return builderChangePrompt({
        section,
        instruction: this._row.brief,
        brief: todo.brief,
        notes: this._plan.notes,
        sectionDir: agent.cwd,
        questionFile: this._questionFile(agent),
        pinBlock: this._start.named?.includes(section.id) ? this._start.pinBlock : '',
        kind: this._design.kind,
        plan: this._plan,
      });
    }
    return builderPrompt({
      section,
      notes: this._plan.notes,
      sectionDir: agent.cwd,
      tokensCss: join(this._workDir, 'tokens.css'),
      globalCss: join(this._workDir, 'global.css'),
      crewJson: crewFile(this.designId),
      questionFile: this._questionFile(agent),
      kitContract: this._kitContract(),
      kind: this._design.kind,
      plan: this._plan,
    });
  }

  /**
   * `rehydrate`'s second half: the round's state from its rows and the disk. The disk plan is kept only when the
   * row has section records; otherwise the lead stage runs again on the existing lead row. Each agent gets the full
   * `_newAgent` shape, its meter seeded with the row's cost (`priorUsd`) and with its current session's running total
   * (`sessionUsd`, M3: less than the cost once a lost session was replaced), its known flag kept beside the meter.
   */
  _restore() {
    this._settled = true;
    const ended = Date.parse(this._row.endedAt);
    this._endedMs = Number.isFinite(ended) ? ended : null;
    this._runP = Promise.resolve({ status: this._status, reason: this._reason });
    const records = Array.isArray(this._row.sections) ? this._row.sections : [];
    const check = records.length ? this._readPlan() : null;
    if (check?.ok) {
      this._plan = check.plan;
      this._sections = records.map((s) => ({ ...s, parts: Array.isArray(s.parts) ? [...s.parts] : [] }));
    }
    const rows = listAgents(this.id);
    const lead = rows.find((r) => r.role === 'lead');
    const applied = this.kind === 'change' && lead && (lead.status === 'done' || lead.job === 'Integrate');
    this._planRev = this._plan ? (applied ? 2 : 1) : 0;
    this._seedLayers();
    for (const r of rows) {
      const isLead = r.role === 'lead';
      const agent = {
        id: r.id, role: r.role, sectionId: r.sectionId, job: r.job, model: r.model, effort: r.effort,
        cwd: isLead ? this._workDir : sectionDir(this.designId, r.sectionId), status: r.status,
        sessionId: r.sessionId, sessionModel: null, tool: null, error: r.error, asks: r.asks, ask: null, noMoreQuestions: false,
        firstPrompt: null, summary: isLead ? '' : (this._sections.find((s) => s.id === r.sectionId)?.summary ?? ''), extraUsd: 0,
        seedUsd: r.costUsd, knownBefore: r.costKnown !== false,
        stopKind: null, stopCtl: new AbortController(), waiter: null, lostOnce: false, retried: false, controller: null,
        // `row.costUsd` is null until a first booking; a destructuring default would not replace it.
        meter: createAgentMeter({ model: r.model, engine: 'claude', priorUsd: r.costUsd ?? 0, sessionUsd: sessionUsdOf(r) }),
      };
      agent.firstPrompt = isLead ? this._leadFirstPrompt(agent) : this._builderFirstPrompt(agent);
      this._agents.push(agent);
    }
  }

  /** `_layers` from each section's index.html on disk (L2.13): a round that starts over sections already built. An
   *  add with no build yet (`unbuiltAdd`) counts none: what its folder holds is a removed section's. */
  _seedLayers() {
    for (const s of this._sections) {
      if (s.unbuiltAdd === true) continue;
      const path = `sections/${s.id}/index.html`;
      const html = this._readWork(path);
      if (typeof html === 'string') this._layers.set(path, countLayers(html));
    }
  }

  _readPlan() {
    let text;
    try { text = readFileSync(this._planFile(), 'utf8'); } catch { return { ok: false, errors: ['plan.json was not written'], plan: null }; }
    return validatePlan(text, { kind: this._design.kind });
  }

  /** A valid plan: every section `planned`, persisted, listed in `.crew.json` and sent as `design-plan`. */
  _takePlan(plan) {
    this._plan = plan;
    this._planRev = 1;
    this._sections = plan.sections.map(sectionRecord);
    updateBuild(this.id, { sections: this._sections });
    this._writeCrew();
    this._planFrame();
    this._emitBuild();
  }

  /** `design-plan` for the plan held: its `canvas` and copies of the section records, never a `todo`. */
  _planFrame() {
    this._frames.send('design-plan', {
      planRev: this._planRev,
      canvas: { ...this._plan.canvas },
      sections: this._sections.map(copySection),
    });
  }

  /** `.crew.json` as `[{id, status, summary}]`. A failed write (EPERM or EBUSY on Windows while a builder reads it)
   *  is logged; the next section change writes it again. */
  _writeCrew() {
    try {
      writeJsonAtomic(crewFile(this.designId), this._sections.map(({ id, status, summary }) => ({ id, status, summary })));
    } catch (err) {
      console.error(`[design] .crew.json of ${this.designId} not written: ${messageOf(err)}`);
    }
  }

  /**
   * A builder stage over `items` (`{section, prompt}` in plan order; `prompt` null for a section's first build): one
   * loop per section, started in plan order so the build slots serve them in that order, and every loop awaited. A
   * loop that throws aborts the others; the first throw then ends the drive. In a change round the folder of each
   * add with no builder yet is cleared first (`_clearAdded`), and a section whose folder cannot be cleared does not
   * build; then every other selected section's base lands (`_landBases`).
   */
  async _runBuilders(items) {
    if (this.kind === 'change') {
      items = items.filter((item) => this._clearAdded(item.section));
      this._landBases(items.map((item) => item.section));
    }
    const builder = resolveDesignModel('builder');
    const loops = items.map((item) => this._runSection(item, builder).catch((err) => { this._abortAll(); throw err; }));
    const failure = (await Promise.allSettled(loops)).find((r) => r.status === 'rejected');
    if (failure) throw failure.reason;
  }

  /**
   * An add before its first build (`unbuiltAdd`: no builder row yet, whichever round added it): an earlier round that
   * removed a section of the same id may have left its folder (`_tidyRound`), and those files would land as this
   * section's base and pass as its build. The folder goes, and its old index.html stops counting layers. One that
   * cannot go fails the section, logged, with no agent row, so a Continue clears it again. A section whose builder row
   * exists is never cleared, `unbuiltAdd` or not (a crash between that row and the record write keeps the mark): the
   * row's folder was cleared before it was made, and its process may have written there. True when the section may
   * build.
   */
  _clearAdded(section) {
    if (section.unbuiltAdd !== true || this._agents.some((a) => a.role === 'builder' && a.sectionId === section.id)) return true;
    this._layers.delete(`sections/${section.id}/index.html`);
    try {
      rmSync(sectionDir(this.designId, section.id), { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
    } catch (err) {
      console.error(`[design] build ${this.id}: added section ${section.id} not built: its folder holds a removed section's files and could not be cleared: ${messageOf(err)}`);
      this._setSection(section, 'failed');
      return false;
    }
    return true;
  }

  /** A change round's builder stage, before any spawn: the existing files of every section in `sections` land as
   *  `design-file`s with text, so a client that reset its drafts for this build holds each base before the first
   *  deleting splice, and a section queued behind the cap shows its old content, not an empty slot (Contract issue 22). */
  _landBases(sections) {
    for (const s of sections) {
      for (const file of SECTION_FILES) {
        const path = `sections/${s.id}/${file}`;
        const text = this._readWork(path);
        if (typeof text === 'string') this._fileFrame(path, text, this._drafts.landed(path, text));
      }
    }
  }

  /**
   * One section's loop. It takes a build slot and holds it to its end, waits included (L2.28). A section's first
   * build then takes the global slot and the stagger, and only then gets its folder and its agent row: a queued
   * section stays `planned` and `agentsTotal` counts real agents. A section that has its agent (a rework) reuses that
   * agent, its row, its session and its cwd (M5, L2.1, R11).
   */
  async _runSection({ section, prompt }, builder) {
    const signal = this._haltCtl.signal;
    try {
      await this._slots.acquire({ signal });
    } catch (err) {
      if (signal.aborted) return;
      throw err;
    }
    try {
      let agent = this._agents.find((a) => a.role === 'builder' && a.sectionId === section.id);
      let slotHeld = false;
      if (agent) {
        if (signal.aborted) return;
        // A question file means no process runs until the answer (U3): the agent re-enters `waiting`.
        this._reopenAgent(agent, agent.job, this._readAsk(agent) ? 'waiting' : 'starting');
        section.agentId = agent.id;
        // Its builder row exists (`_clearAdded`): a mark a crash left behind goes with this record write.
        delete section.unbuiltAdd;
        this._setSection(section, 'writing');
        // A rehydrate found no plan for it: the lead's new plan gives it its first prompt (a lost session's restart).
        agent.firstPrompt ??= this._builderFirstPrompt(agent);
        // A Continue: the session resumes; an agent that never got one starts on its first prompt.
        if (prompt == null) prompt = agent.sessionId ? continuePrompt({ role: 'builder' }) : agent.firstPrompt;
      } else {
        if (!(await this._globalSlot())) return;
        // A halt that landed while this loop resumed from the slot (M7): no row for a process that never starts.
        if (signal.aborted) { this._releaseGlobal(); return; }
        try {
          agent = this._newBuilder(section, builder);
          section.agentId = agent.id;
          // Its builder row exists: from here on the folder holds that builder's work, never cleared (`_clearAdded`,
          // `clearUnbuiltAdds`).
          delete section.unbuiltAdd;
          this._setSection(section, 'writing');
        } catch (err) {
          this._releaseGlobal();
          throw err;
        }
        slotHeld = true;
      }
      // A change round's section runs as its `todo` says: a touch `change`, an add `first`.
      const stage = section.todo?.stage ?? 'first';
      const outcome = await this._runAgentLoop(agent, prompt ?? agent.firstPrompt, { stage, slotHeld });
      this._judgeSection(section, agent, outcome);
    } finally {
      this._slots.release();
    }
  }

  /** A section's builder: its folder first (M10), then its row, then its first prompt, every path absolute. */
  _newBuilder(section, { model, effort }) {
    const cwd = sectionDir(this.designId, section.id);
    mkdirSync(cwd, { recursive: true });
    const agent = this._newAgent({ role: 'builder', sectionId: section.id, job: section.job, model, effort, cwd });
    agent.firstPrompt = this._builderFirstPrompt(agent);
    return agent;
  }

  /** A section's verdict from its loop: `done` needs a non-empty index.html; an agent the person stopped ends
   *  `stopped` with its section now, so the rest of the round already sees it; a halted loop leaves the section
   *  `writing`, and the settle decides; anything else is `failed`. */
  _judgeSection(section, agent, outcome) {
    if (outcome === 'done') {
      const html = this._readWork(`sections/${section.id}/index.html`);
      if (typeof html === 'string' && html.trim()) {
        this._endAgent(agent, 'done');
        this._setSection(section, 'done', { summary: agent.summary || section.summary });
        return;
      }
      agent.error = `sections/${section.id}/index.html was not written`;
    } else if (outcome === 'stopped') {
      this._endAgent(agent, 'stopped');
      this._setSection(section, 'stopped');
      return;
    } else if (outcome !== 'failed') return;
    this._endAgent(agent, 'error');
    this._setSection(section, 'failed');
  }

  /** A section's new status: `.crew.json`, the build row's records, a `design-section` frame and fresh stats. */
  _setSection(section, status, { summary } = {}) {
    section.status = status;
    if (summary !== undefined) section.summary = summary;
    this._writeCrew();
    updateBuild(this.id, { sections: this._sections });
    this._sectionFrame(section);
    this._emitBuild();
  }

  _sectionFrame(s) {
    this._frames.send('design-section', { sectionId: s.id, status: s.status, agentId: s.agentId, summary: s.summary });
  }

  /** After a builder stage (M8), over every section of the round, not only a Continue's selection (in a change round,
   *  every section with a `todo`, whichever drive ran it, so a carried section never holds it): a failed section
   *  pauses the round as `failed`, a section still `planned` or `writing` (an open question a subset left) as
   *  `unfinished` (L2.24). A section the person stopped does not hold the round (L2.22).
   *  @returns {null|'failed'|'unfinished'} */
  _afterBuilders() {
    const judged = this._sections.filter((s) => this._inRound(s));
    if (judged.some((s) => s.status === 'failed')) return 'failed';
    if (judged.some((s) => s.status === 'planned' || s.status === 'writing')) return 'unfinished';
    return null;
  }

  _integrationFile() { return join(this._workDir, 'integration.json'); }

  /**
   * The lead's integrate pass, on its own row and session: `lintDesign` with no AI, its findings in the prompt, then
   * the `rework` of integration.json, never its `done` (M10). A pass that failed or that the person stopped, or a file
   * that is missing or invalid, sends nothing back (L2.10). A lost session starts the lead fresh on the same
   * integrate prompt.
   * @returns {Promise<{ section: object, prompt: string }[]>} the `done` sections to rework, in plan order
   */
  async _integrate() {
    const lead = this._agents.find((a) => a.role === 'lead');
    if (!lead) return [];
    this._setStatus('integrating');
    const { findings } = lintDesign({ workDir: this._workDir, plan: this._plan });
    const prompt = integratePrompt({ findings, integrationFile: this._integrationFile() });
    // A question file means no process runs until the answer (U3): the lead re-enters `waiting`.
    this._reopenAgent(lead, 'Integrate', this._readAsk(lead) ? 'waiting' : 'starting');
    const outcome = await this._runAgentLoop(lead, prompt, { stage: 'integrate', restart: prompt });
    if (outcome === 'failed') this._endAgent(lead, 'error');
    else if (outcome === 'stopped') this._endAgent(lead, 'stopped');
    if (outcome !== 'done') return [];
    this._endAgent(lead, 'done');
    return this._reworkItems();
  }

  _reworkItems() {
    let text;
    try { text = readFileSync(this._integrationFile(), 'utf8'); } catch { return []; }
    const { ok, errors, integration } = validateIntegration(text, { plan: this._plan });
    if (!ok) {
      console.error(`[design] build ${this.id}: integration.json ignored: ${errors.join('; ')}`);
      return [];
    }
    const why = new Map(integration.rework.map((r) => [r.id, r.why]));
    let touched = false;
    const items = this._sections.filter((s) => why.has(s.id) && s.status === 'done').map((section) => {
      const note = why.get(section.id);
      // A change round's section with no agent this round: a new builder with the change prompt, `brief` the why, so
      // it is judged and rehydrates like a touch (L2.37). A bare rework prompt would reach a session with no section.
      if (this.kind === 'change' && !this._agents.some((a) => a.role === 'builder' && a.sectionId === section.id)) {
        section.todo = { stage: 'change', brief: note };
        touched = true;
        return { section, prompt: null };
      }
      return { section, prompt: reworkPrompt({ why: note }) };
    });
    if (touched) updateBuild(this.id, { sections: this._sections });
    return items;
  }

  /** The done path, in this order (M10): `dist`, the version snapshot, then the end state with the terminal frame
   *  last. A shell the assembler refuses ends `error`, `assemble-failed`; a failed snapshot is only logged. */
  async _finish() {
    try {
      assembleDesign({ workDir: this._workDir, plan: this._plan, mode: 'dist' });
    } catch (err) {
      console.error(`[design] build ${this.id}: assembly failed: ${messageOf(err)}`);
      return this._settle('error', 'assemble-failed');
    }
    try {
      await this._deps.snapshotVersion({ designId: this.designId });
    } catch (err) {
      console.error(`[design] build ${this.id}: version snapshot failed: ${messageOf(err)}`);
    }
    return this._settle('done', this._sections.every((s) => s.status === 'done') ? null : 'partial');
  }

  /**
   * One agent's session, process after process, until it is done, failed or halted (L2.7, L2.9, L2.31). A lost
   * session starts fresh once from `restart` (default `agent.firstPrompt`); a transient error resumes once. A process
   * that ends with a valid ask file asks the person: while the agent has rounds left (`ASK_ROUNDS`) it waits for the
   * answer and the session resumes with it (L2.8); past them it gets one "no more questions" resume, and asking again
   * fails it, the file removed (L2.9). The file goes, and `asks` moves, only once a process shows it received that
   * prompt (M1, `_spawnOnce`'s `onReceive`): a halt, a refused spawn or an error before that keeps the question, and an
   * answered agent goes back to `waiting`, so a paused settle keeps it (L2.29) and a Continue asks again; a transient
   * error retries the same prompt. A lost session takes its question with it: the fresh session starts over. A
   * transient error's retry resumes with the continue prompt only when the failed process reported a session; else it
   * sends its own prompt again. An ask file already there when the loop starts (a Continue) is asked
   * before any spawn. `slotHeld`: the caller already holds the global slot for the first process
   * (a builder's first build takes it before its folder and row exist). Every wait between two processes, the wait on
   * an answer included, also ends when the person stops this agent (`stopAgent`).
   * @returns {Promise<'done'|'failed'|'halted'|string>} `agent.stopKind` when the person stopped the agent
   */
  async _runAgentLoop(agent, firstPrompt, { stage, slotHeld = false, restart = null }) {
    let prompt = firstPrompt;
    let held = slotHeld;
    let ask = this._readAsk(agent);
    /** The question `prompt` answers ('answered') or closes ('last'), its file still on disk until a process shows it
     *  received the prompt; null once taken. */
    let taken = null;
    /** No process received the answer: the agent waits on its question again. */
    const keepQuestion = () => {
      if (taken === 'answered' && !agent.stopKind) this._setAgentStatus(agent, 'waiting');
      return agent.stopKind ?? 'halted';
    };
    for (;;) {
      if (ask) {
        if (agent.asks < ASK_ROUNDS[agent.role]) {
          const answers = await this._waitAnswer(agent, ask.questions);
          if (answers === null) return agent.stopKind ?? 'halted';
          prompt = answersPrompt({ questions: ask.questions, answers });
          taken = 'answered';
        } else if (agent.noMoreQuestions) {
          removeAskFile(this.designId, agent.id);
          agent.error = 'Asked again after its last question round';
          return 'failed';
        } else {
          prompt = noMoreQuestionsPrompt();
          taken = 'last';
        }
        ask = null;
      }
      if (!held && !(await this._globalSlot(agent))) return keepQuestion();
      held = false;
      const pending = taken;
      const onReceive = pending ? () => { this._takeQuestion(agent, pending); taken = null; } : null;
      const outcome = await this._spawnOnce(agent, prompt, stage, onReceive);
      if (outcome.aborted) return keepQuestion();
      if (outcome.subtype === 'error_max_budget_usd') { this._halt('paused', 'total-limit'); return keepQuestion(); }
      if (outcome.err) {
        const message = messageOf(outcome.err);
        if (LOST_SESSION_RE.test(message) && !agent.lostOnce) {
          agent.lostOnce = true;
          // The session that asked is gone, and its question with it: the fresh session starts over.
          if (taken) { this._takeQuestion(agent, taken); taken = null; }
          this._setSession(agent, null);
          prompt = restart ?? agent.firstPrompt;
          continue;
        }
        const c = classifyError(outcome.err);
        if (HALT_CLASSES.has(c)) { this._halt('paused', c); return keepQuestion(); }
        if (RETRY_CLASSES.has(c) && !agent.retried) {
          agent.retried = true;
          this._setAgentStatus(agent, 'retrying');
          if (!(await this._sleep(this._deps.retryDelayMs, this._waitSignal(agent)))) return keepQuestion();
          // A process that reported a session resumes it. One that never did received nothing: the same prompt goes
          // again (the brief, or the answers it never got), on whatever session the agent resumes.
          if (outcome.session) prompt = continuePrompt({ role: agent.role });
          continue;
        }
        agent.error = capError(message);
        return 'failed';
      }
      ask = this._readAsk(agent);
      if (!ask) return 'done';
    }
  }

  /** The question a process received the answers to (`taken` 'answered') or was told it has no more of ('last'): its
   *  file removed, and the agent's question rounds moved on (L2.8, L2.9). */
  _takeQuestion(agent, taken) {
    removeAskFile(this.designId, agent.id);
    if (taken === 'last') {
      agent.noMoreQuestions = true;
      return;
    }
    agent.asks += 1;
    updateAgent(agent.id, { asks: agent.asks });
  }

  /** `agent`'s ask file, or null. An invalid one is removed and ignored, so the agent is judged by its output. */
  _readAsk(agent) {
    const ask = readAskFile(this.designId, agent.id);
    if (!ask || ask.invalid === undefined) return ask;
    console.error(`[design] build ${this.id}: question file of ${agent.id} ignored: ${ask.invalid}`);
    removeAskFile(this.designId, agent.id);
    return null;
  }

  /**
   * Asks the person `questions` for `agent`, then parks it until `answer` wakes it. No slot is released here: the
   * global slot went at the process's exit, and a builder keeps its build slot through the wait (L2.28). The agent
   * turns `waiting` and one `design-question` goes out under a fresh `askId`; nothing is sent once the build is
   * halted or the agent stopped. Resolves the answers, or null on a halt or a stop, which leaves the agent `waiting`
   * for the settle to judge (a `paused` settle keeps it so, L2.29).
   * @returns {Promise<{ id: string, value: string }[]|null>}
   */
  async _waitAnswer(agent, questions) {
    if (this._waitClosed(agent)) return null;
    // Parked before the frame, so a listener that answers inside it finds the waiter.
    const wait = this._park(agent);
    agent.ask = { askId: newAskId(), questions };
    this._setAgentStatus(agent, 'waiting');
    this._frames.send('design-question', this._questionFields(agent));
    try {
      return await wait;
    } finally {
      agent.ask = null;
    }
  }

  /** C-5 `design-question` fields of the question `agent` waits on; a copy, so no frame shares the live question. */
  _questionFields(agent) {
    return {
      agentId: agent.id,
      askId: agent.ask.askId,
      job: agent.job,
      heading: `${agent.job} needs a decision`,
      questions: structuredClone(agent.ask.questions),
    };
  }

  /** The global (machine) slot, then the stagger, both under the halt signal and, for an `agent`, its stop signal,
   *  then worca's spend limits (`_spendOpen`), the one gate before every spawn. False when halted or stopped, or when
   *  a limit is reached, which pauses the round with `total-limit`; the slot is then not held. On true the slot is
   *  held until `_spawnOnce` releases it. A builder's first build calls this before its row exists, so a refused
   *  spawn leaves no row. */
  async _globalSlot(agent = null) {
    const signal = this._waitSignal(agent);
    if (signal.aborted) return false;
    try {
      await this._deps.acquireGlobal({ signal });
    } catch (err) {
      if (signal.aborted) return false;
      throw err;
    }
    if (signal.aborted) { this._releaseGlobal(); return false; }
    const t = performance.now();
    const wait = this._nextSpawnAt - t;
    this._nextSpawnAt = Math.max(t, this._nextSpawnAt) + this._deps.staggerMs;
    if (wait > 0 && !(await this._sleep(wait, signal))) { this._releaseGlobal(); return false; }
    let open;
    try {
      open = await this._spendOpen();
    } catch (err) {
      this._releaseGlobal();
      throw err;
    }
    if (signal.aborted) { this._releaseGlobal(); return false; }
    if (!open) {
      this._releaseGlobal();
      this._halt('paused', 'total-limit');
      return false;
    }
    return true;
  }

  /**
   * worca's spend limits before a spawn, as `_checkCostLimits` gates every step of a run (M13, L2.27, L2.33): the
   * local total limit (`budgetStatus`), a team-bound total cap (`checkTeamTotalGate`, which passes a `warn` cap and an
   * acknowledged window, as at a run's entry; asked with the discovery `readDesignCaps` uses, never its default
   * `'if-missing'`), then the per-run cap against the round's spend. False once any is reached.
   */
  async _spendOpen() {
    if (this._deps.budgetStatus().blocked) return false;
    const projectDir = this._projectDir;
    const gate = await this._deps.teamTotalGate({ projectDir }, { discover: projectDir ? teamRunDiscover(null, projectDir) : false });
    if (gate?.blocked) return false;
    return !this._capReached();
  }

  /** True once the round's spend, live estimates included, has reached worca's per-run cap. */
  _capReached() {
    return this._cap != null && this._spent() >= this._cap;
  }

  /** The round's spend: every booking (bridged ones included) plus each running process's live estimate. */
  _spent() {
    let live = 0;
    for (const a of this._running) {
      const est = a.meter.snapshot().estimatedUsd;
      if (Number.isFinite(est)) live += est;
    }
    return this._costUsd + live;
  }

  /** What ends a wait of `agent`: the build's halt, or the person stopping that agent. */
  _waitSignal(agent) {
    const halt = this._haltCtl.signal;
    return agent?.stopCtl ? AbortSignal.any([halt, agent.stopCtl.signal]) : halt;
  }

  _releaseGlobal() {
    try { this._deps.releaseGlobal(); } catch (err) { console.error(`[design] global slot release failed: ${messageOf(err)}`); }
  }

  /** Resolves true after `ms`, false at once or as soon as `signal` (default: the build's halt) aborts. */
  _sleep(ms, signal = this._haltCtl.signal) {
    if (signal.aborted) return Promise.resolve(false);
    if (!(ms > 0)) return Promise.resolve(true);
    return new Promise((resolve) => {
      const onAbort = () => { clearTimeout(timer); resolve(false); };
      const timer = setTimeout(() => { signal.removeEventListener('abort', onAbort); resolve(true); }, ms);
      signal.addEventListener('abort', onAbort, { once: true });
    });
  }

  /**
   * One process of `agent`. At every exit: the stream lands the disk, a process killed before its `result` books its
   * priced usage, a bridged upstream's figure is booked (`_bookUpstream`), and the global slot is released. A throw
   * while building the options is `err` too. Every main-thread `usage` runs `_afterCost`, so a live estimate past the
   * per-run cap halts the round before any `result` (a hung process sends none). `--max-budget-usd` is the per-run
   * cap's remainder plus the session's own total (L2.2), only under a per-run cap and only for a list-priced model.
   * A halt or a stop that landed after the slot's last check, while the caller resumed, starts no process (M7): this
   * runs in the same tick as `_running.add`, and from there `_abortAll` reaches the process's own controller.
   * `onReceive` runs once, when the process shows it received `prompt`: its main thread's first `session` or
   * `message_start`, before the abort (the question it answers, M1). Calling `runClaude` is no receipt: the CLI can
   * be killed while it starts, and the broker path awaits the network first. A throw from `onReceive` stops the
   * process and is thrown here once the exit is booked: a store that cannot take the question ends the round.
   * @returns {Promise<{ aborted: boolean, subtype: string|null, err: unknown, session: boolean }>} `aborted`: the
   *   signal fired before any result; an abort after the result keeps the result's outcome (L2.31). `session`: this
   *   process reported a main-thread session, so a retry can resume it.
   */
  async _spawnOnce(agent, prompt, stage, onReceive = null) {
    const bookedBefore = agent.meter.snapshot().costUsd ?? 0;
    const controller = new AbortController();
    agent.controller = controller;
    this._running.add(agent);
    this._liveChanged();
    let session = false;
    let received = false;
    let receiveErr = null;
    const receive = () => {
      if (received || controller.signal.aborted) return;
      received = true;
      try {
        onReceive?.();
      } catch (e) {
        receiveErr = e;
        controller.abort();
      }
    };
    const stream = createAgentStream({
      agentId: agent.id,
      role: agent.role,
      sectionId: agent.sectionId,
      cwd: agent.cwd,
      workDir: this._workDir,
      realWorkDir: this._realWorkDir,
      drafts: this._drafts,
      meter: agent.meter,
      readDisk: (rel) => this._readWork(rel),
      on: {
        status: (s) => this._setAgentStatus(agent, s),
        tool: (t) => { agent.tool = t; this._emitAgent(agent); },
        file: (path, text, rev) => this._fileFrame(path, text, rev),
        usage: () => this._afterCost(agent),
        book: (usd) => this._book(agent, usd),
        session: (id) => { session = true; this._setSession(agent, id); },
      },
    });
    let err = null;
    try {
      if (this._waitSignal(agent).aborted) controller.abort();
      else await this._deps.runClaude(this._processOptions(agent, prompt, stage, controller.signal, stream, receive));
    } catch (e) {
      err = e;
    } finally {
      try {
        stream.finish();
        if (!stream.sawResult()) this._book(agent, agent.meter.settleCut());
        this._bookUpstream(agent, (agent.meter.snapshot().costUsd ?? 0) - bookedBefore);
      } finally {
        // A booking that throws still frees the slot and the running count.
        agent.controller = null;
        this._running.delete(agent);
        this._releaseGlobal();
        this._liveChanged();
      }
    }
    const m = this._costOf(agent);
    updateAgent(agent.id, { costUsd: m.costUsd, costKnown: m.costKnown, tokens: this._rowTokens(agent, m) });
    if (receiveErr) throw receiveErr;
    const line = stream.summary();
    if (line) agent.summary = line;
    const subtype = stream.resultSubtype();
    if (controller.signal.aborted && !stream.sawResult()) return { aborted: true, subtype, err: null, session };
    // The abort landed after the result (a halt that result's own booking raised, a stop a moment too late): the
    // outcome is the result's, whatever its subtype, so a builder that finished is judged by its output (L2.31).
    if (controller.signal.aborted && err?.name === 'AbortError') err = null;
    return { aborted: false, subtype, err, session };
  }

  /** The runClaude options of one process of `agent` (C-3), its `--max-budget-usd` read now (L2.2, M13). `receive`
   *  hears every main-thread `session` and `message_start` (`usage` phase `start`), before the stream does. */
  _processOptions(agent, prompt, stage, signal, stream, receive = null) {
    const maxBudgetUsd = processBudgetUsd({
      remainingUsd: this._cap == null ? null : this._cap - this._spent(),
      sessionTotalUsd: agent.meter.sessionTotalUsd(),
      listPriced: this._deps.isListPriced(agent.model),
    });
    const opts = designSpawnOptions({
      role: agent.role,
      stage,
      engine: 'claude',
      kind: this._design.kind,
      agentId: agent.id,
      buildId: this.id,
      designId: this.designId,
      sectionId: agent.sectionId,
      projectDir: this._projectDir,
      prompt,
      model: agent.model,
      effort: agent.effort,
      resumeSessionId: agent.sessionId,
      maxBudgetUsd,
      denyRules: this._denyRules,
      signal,
      onEvent: (evt) => {
        if (receive && evt?.parentId == null && (evt?.type === 'session' || (evt?.type === 'usage' && evt.phase === 'start'))) receive();
        if (evt?.type === 'session' && evt.init === true && evt.parentId == null && typeof evt.model === 'string' && evt.model) {
          agent.sessionModel = evt.model;
        }
        stream.onEvent(evt);
      },
      mock: this._deps.mock,
    });
    return opts;
  }

  /** Books what the meter booked for one result or one cut, or (`upstream`) what a bridge's upstream reported beyond
   *  it, which the meter never saw and so goes to `agent.extraUsd`. Above $0: one ledger row, the agent row's cost and
   *  the build row's total, together, so no row lags the ledger and a rehydrate after a host kill seeds the right
   *  figure. Then `_afterCost`. */
  _book(agent, usd, { upstream = false } = {}) {
    if (usd > 0) {
      if (upstream) agent.extraUsd += usd;
      this._costUsd += usd;
      recordDesignCostDelta({
        designId: this.designId, buildId: this.id, agentId: agent.id, amountUsd: usd,
        model: agent.model ?? agent.sessionModel ?? null, tsMs: this._deps.now(),
      });
      const m = this._costOf(agent);
      updateAgent(agent.id, { costUsd: m.costUsd, costKnown: m.costKnown, tokens: this._rowTokens(agent, m) });
      updateBuild(this.id, { costUsd: this._costUsd });
    }
    this._afterCost(agent);
  }

  /**
   * A bridged model's process exit: the CLI prices an id it does not know at $0, so the bridge's figure for this
   * agent's tag (`modelEnv` tags its calls with the agent id) is booked where it exceeds what this process booked
   * (`bookedHere`), and the tag is forgotten at every exit, so the next process of the session starts from zero
   * (run-harness.mjs books the upstream figure the same way). The tag goes before the booking, so a booking that
   * throws never books it twice.
   */
  _bookUpstream(agent, bookedHere) {
    const up = bridgeCostFor(agent.id);
    forgetBridgeTag(agent.id);
    if (!up) return;
    const extra = Number(up.costUsd) - (Number.isFinite(bookedHere) ? bookedHere : 0);
    if (extra > 0) this._book(agent, extra, { upstream: true });
  }

  /** After a booking or a live usage: the agent's and the build's fresh figures, then the per-run cap: the round's
   *  spend at or past it pauses the round with `total-limit` (M13). */
  _afterCost(agent) {
    this._emitAgent(agent);
    this._emitBuild();
    if (this._capReached()) this._halt('paused', 'total-limit');
  }

  /** `agent`'s meter snapshot, with what was booked beside the meter (`extraUsd`) added to `costUsd`. A rehydrated
   *  agent keeps its row's figures where the meter has no seed: a booked $0 (`seedUsd`; the meter counts a seed as
   *  booked only above 0) and an unknown cost (`knownBefore`). */
  _costOf(agent) {
    const m = agent.meter.snapshot();
    let costUsd = m.costUsd ?? agent.seedUsd ?? null;
    if (agent.extraUsd > 0) costUsd = (costUsd ?? 0) + agent.extraUsd;
    const costKnown = m.costKnown && agent.knownBefore !== false;
    return costUsd === m.costUsd && costKnown === m.costKnown ? m : { ...m, costUsd, costKnown };
  }

  /** The agent row's `tokens`: the meter's counts, and the running total of the session the next `--resume`
   *  continues (`sessionUsd`, which a rehydrate seeds the meter with, M3). Written with every cost, so a row never
   *  pairs a new cost with an old total. */
  _rowTokens(agent, m = this._costOf(agent)) {
    return { ...m.tokens, sessionUsd: agent.meter.sessionTotalUsd() };
  }

  _setSession(agent, id) {
    const next = id || null;
    if (next === agent.sessionId) return;
    agent.sessionId = next;
    updateAgent(agent.id, { sessionId: next });
  }

  _newAgent({ role, sectionId, job, model, effort, cwd }) {
    const row = createAgent({ buildId: this.id, role, sectionId, job, engine: 'claude', model, effort });
    const agent = {
      id: row.id, role, sectionId, job, model, effort, cwd, status: row.status,
      sessionId: null, sessionModel: null, tool: null, error: null, asks: 0, ask: null, noMoreQuestions: false,
      firstPrompt: null, summary: '', extraUsd: 0,
      /** A rehydrated agent's row figures the meter takes no seed for (`_costOf`). */
      seedUsd: null, knownBefore: true,
      stopKind: null, stopCtl: new AbortController(), waiter: null, lostOnce: false, retried: false, controller: null,
      meter: createAgentMeter({ model, engine: 'claude' }),
    };
    this._agents.push(agent);
    this._emitAgent(agent);
    return agent;
  }

  /** An agent's row back in play for another pass of its session (L2.1): `starting` (or `waiting`, for an agent that
   *  re-enters on its question file), as `job`, no error, open. */
  _reopenAgent(agent, job, status = 'starting') {
    const prev = agent.status;
    agent.job = job;
    agent.status = status;
    agent.error = null;
    agent.tool = null;
    updateAgent(agent.id, { job, status, error: null, endedAt: null });
    this._emitAgent(agent);
    this._waitingChanged(prev, status);
  }

  _setAgentStatus(agent, status) {
    if (!status || agent.status === status) return;
    const prev = agent.status;
    agent.status = status;
    updateAgent(agent.id, { status });
    this._emitAgent(agent);
    this._waitingChanged(prev, status);
  }

  /** A terminal status for `agent`, with its cost and `error`, written and sent. */
  _endAgent(agent, status) {
    const prev = agent.status;
    agent.status = status;
    agent.tool = null;
    const m = this._costOf(agent);
    updateAgent(agent.id, {
      status, error: agent.error, costUsd: m.costUsd, costKnown: m.costKnown, tokens: this._rowTokens(agent, m),
      endedAt: iso(this._deps.now()),
    });
    this._emitAgent(agent);
    this._waitingChanged(prev, status);
  }

  /** Entering or leaving `waiting` moves `design-build.waiting`: the agent's frame and that one go out at once, past
   *  the 2 Hz hold, so the count is current and the agent's status reaches the client before its question. */
  _waitingChanged(prev, next) {
    if ((prev === 'waiting') === (next === 'waiting')) return;
    this._emitBuild();
    this._frames.flush();
  }

  _agentFields(agent) {
    const m = this._costOf(agent);
    return {
      agentId: agent.id,
      role: agent.role,
      job: agent.job,
      sectionId: agent.sectionId,
      status: agent.status,
      engine: 'claude',
      model: agent.model ?? agent.sessionModel ?? null,
      tool: agent.tool ? { ...agent.tool } : null,
      tokens: m.tokens,
      costUsd: m.costUsd,
      estimatedUsd: m.estimatedUsd,
      costKnown: m.costKnown,
      error: agent.error,
    };
  }

  _emitAgent(agent) { this._frames.agent(agent.id, this._agentFields(agent)); }

  _stats() {
    let estimatedUsd = 0;
    let costKnown = true;
    for (const a of this._agents) {
      const m = this._costOf(a);
      if (Number.isFinite(m.estimatedUsd)) estimatedUsd += m.estimatedUsd;
      if (!m.costKnown) costKnown = false;
    }
    const started = Date.parse(this._row.startedAt);
    const now = this._endedMs ?? this._deps.now();
    return {
      agentsNow: this._running.size,
      agentsTotal: this._agents.length,
      sectionsDone: this._sections.filter((s) => s.status === 'done').length,
      sectionsPlanned: this._sections.length,
      failed: this._sections.filter((s) => s.status === 'failed').length,
      layers: this._layerCount(),
      costUsd: this._costUsd,
      estimatedUsd,
      costKnown,
      elapsedMs: Number.isFinite(started) ? Math.max(0, now - started) : 0,
    };
  }

  _layerCount() {
    let n = 0;
    for (const v of this._layers.values()) n += v;
    return n;
  }

  /** The `design-build` fields without the common ones; `snapshot().build` is the same set. */
  _buildFields() {
    return { status: this._status, round: this.round, kind: this.kind, reason: this._reason, waiting: this.waitingCount, stats: this._stats() };
  }

  _emitBuild() { this._frames.build(this._buildFields()); }

  /** A new stage of the round, in memory and on the row. What the throttle still holds goes out first, so a stage
   *  is never folded into the next one: every status reaches the client. */
  _setStatus(status) {
    if (this._status === status) return;
    this._status = status;
    updateBuild(this.id, { status });
    this._frames.flush();
    this._emitBuild();
  }

  /** A landed file as `design-file`; a path no stage draws, or one the store did not land, sends nothing. */
  _fileFrame(path, text, rev) {
    const c = classifyDraftPath(path);
    if (!c || rev == null) return;
    const t = typeof text === 'string' ? text : '';
    if (c.sectionId && c.part === 'html') this._layers.set(path, countLayers(t));
    this._frames.file({ path, sectionId: c.sectionId, part: c.part, rev, text: t });
  }

  _readWork(rel) {
    try { return readFileSync(join(this._workDir, rel), 'utf8'); } catch { return null; }
  }

  /** A listener that throws never breaks the build. */
  _send(frame) {
    try { this.emit('frame', frame); } catch (err) {
      console.error(`[design] ${frame.type} listener of ${this.id} failed: ${messageOf(err)}`);
    }
  }

  _liveChanged() {
    const n = this._running.size;
    if (n === this._lastLive) return;
    this._lastLive = n;
    try { this._deps.onLiveChange(); } catch (err) { console.error(`[design] onLiveChange failed: ${messageOf(err)}`); }
  }

  /** Records the first end state and aborts every queue wait, every running process and every parked waiter. No
   *  effect once settled. */
  _halt(status, reason) {
    if (this._settled) return;
    if (!this._end) this._end = { status, reason };
    this._abortAll();
  }

  _abortAll() {
    this._haltCtl.abort();
    for (const a of this._running) a.controller?.abort();
    for (const a of this._agents) this._wake(a, null);
  }

  /**
   * Parks `agent` until `_wake(agent, value)` and resolves that value: what a question waits on, so the answer wakes
   * it and the build never holds a process meanwhile. A halt, a stop or `stopAgent` wakes it with `null`; a park once
   * the build is halted or the agent stopped resolves `null` at once, since nothing would wake it: a stop that lands
   * before the loop parks (after a result, L2.31) would otherwise hang the build. One waiter per agent: only its own
   * loop parks.
   * @returns {Promise<unknown>}
   */
  _park(agent) {
    if (this._waitClosed(agent)) return Promise.resolve(null);
    return new Promise((resolve) => { agent.waiter = resolve; });
  }

  /** True once nothing would wake a park of `agent`: the build halted, or the agent stopped. */
  _waitClosed(agent) {
    return this._haltCtl.signal.aborted || Boolean(agent.stopKind) || Boolean(agent.stopCtl?.signal.aborted);
  }

  /** Resolves `agent`'s parked waiter with `value`. False when nothing was parked: a waiter wakes once. */
  _wake(agent, value) {
    const resolve = agent.waiter;
    if (!resolve) return false;
    agent.waiter = null;
    resolve(value);
    return true;
  }

  /** Settles on the end state the first halt recorded. */
  _settleHalt() { return this._settle(this._end.status, this._end.reason); }

  /**
   * Writes the round's end state, then sends the terminal `design-build` frame last. `endedAt` is always in the
   * patch, `paused` included (an open status, which the store leaves alone). An agent still open ends `stopped`, and
   * so does a section still `writing`; a queued section stays `planned`. Under a `paused` settle a waiting agent
   * stays `waiting`, its section `writing` and its ask file kept (M12, L2.29): a Continue asks again.
   */
  _settle(status, reason) {
    const endedMs = this._deps.now();
    const kept = new Set();
    for (const a of this._agents) {
      if (TERMINAL_AGENT.has(a.status)) continue;
      if (status === 'paused' && a.status === 'waiting') {
        if (a.sectionId) kept.add(a.sectionId);
        continue;
      }
      this._endAgent(a, 'stopped');
    }
    const cut = this._sections.filter((s) => s.status === 'writing' && !kept.has(s.id));
    for (const s of cut) { s.status = 'stopped'; this._sectionFrame(s); }
    if (cut.length) this._writeCrew();
    this._drafts.flush();
    updateBuild(this.id, {
      status, reason, sections: this._sections, costUsd: this._costUsd, layers: this._layerCount(), endedAt: iso(endedMs),
    });
    this._status = status;
    this._reason = reason;
    this._endedMs = endedMs;
    this._settled = true;
    this._frames.flush();
    this._emitBuild();
  }
}
