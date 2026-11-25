// src/core/shape/prototype-design.mjs — Shaper small runs C1: the bridge from the Prototype step to Design. One `web`
// design per feature, its rounds started through the chat's shared hand-off (D6) on the server's single registry (D5,
// D7), the wait for a round's end, the frozen confirmed copy (D13) and a run's own copy of it (D14).
import { chmodSync, cpSync, existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, realpathSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { basename, dirname, join, relative } from 'node:path';
import { resolvePipelineId } from '../artifacts.mjs';
import { BRIEF_MAX, createDesign, getBuild, getDesign, TITLE_MAX } from '../design/store.mjs';
import { distDir } from '../design/paths.mjs';
import { designBuildsInstance } from '../design/registry.mjs';
import { startHeldRound } from '../design/chat-actions.mjs';
import { stageDesignKit } from '../design/kit.mjs';

export const CONFIRMED_DIR = 'prototype-confirmed';
export const RUN_DIR = 'prototype';
export const MANIFEST = 'prototype.json';
const PREFIX = 'Prototype · ';

export class PrototypeError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'PrototypeError';
    this.code = code;
  }
}

/** D7: the injected registry first, then the server's own; null when neither is reachable. */
export const registryOf = (deps = {}) => deps.designBuilds || designBuildsInstance() || null;

/** D5: the design's title, "Prototype · " plus the feature title, within the Design title cap. */
export const prototypeDesignTitle = (title) => `${PREFIX}${String(title || 'Feature').replace(/\s+/g, ' ').trim()}`.slice(0, TITLE_MAX);

/** D5: a `web` design for the run's project, made by the run's requester, on the run's models. @returns {string} the id */
export function createPrototypeDesign({ projectKey = null, title, by = null, models = null, engine = 'claude' } = {}) {
  const pair = models && typeof models.model === 'string' && models.model
    ? { model: models.model, ...(typeof models.effort === 'string' && models.effort ? { effort: models.effort } : {}) } : null;
  const d = createDesign({ kind: 'web', title: prototypeDesignTitle(title), fast: false, projectKey, engine,
    ...(pair ? { models: { lead: pair, builder: pair } } : {}) }, { by });
  return d.id;
}

/** D5: the lead's brief: one plan section per screen, the screen's name as its job and the requirement ids it shows in
 *  brackets at the start of its brief (a job holds at most 24 characters), then the screen requirements with their
 *  examples. `fail` adds the mock's failing-lead token (WORCA_MOCK_PROTO_FAIL). Within the Design brief cap. */
export function prototypeBrief({ title, requirements = [], examples = new Map(), fail = false }) {
  const lines = requirements.map((r) => `- ${r.id} ${r.text}${examples.get(r.id) ? `\n  Example: ${examples.get(r.id)}` : ''}`);
  const text = `Build a clickable prototype of the screens of this feature: ${String(title || 'Feature').trim()}.\n`
    + 'Plan one section per screen. Give each section the screen\'s name as its job (at most 24 characters), and start its '
    + 'brief with the ids of the requirements it shows, in brackets, for example "[R-ux-1, R-ux-2] The template editor …".\n'
    + 'Show real labels and sample content, not lorem ipsum. Every requirement below is shown on at least one screen.\n\n'
    + `Screen requirements:\n${lines.join('\n')}\n`
    + (fail ? '\nMOCK_FAIL_LEAD\n' : '');
  return text.length <= BRIEF_MAX ? text : text.slice(0, BRIEF_MAX);
}

/** One round: a first build (`brief`) or a change round (`instruction`, with `sections` and `needsLead`).
 *  @returns {Promise<{buildId: string, round: number} | {refused: string, status?: number}>} the refusal's words are
 *  refusalNotice's */
export async function startPrototypeBuild({ designId, brief, instruction, sections, needsLead, by = null, deps = {} }) {
  const designBuilds = registryOf(deps);
  const design = getDesign(designId);
  if (!designBuilds || !design) return { refused: 'Design builds are not available.' };
  const change = typeof instruction === 'string' && instruction.trim().length > 0;
  const opts = change
    ? { designId, instruction, ...(Array.isArray(sections) ? { sections } : {}), ...(needsLead !== undefined ? { needsLead } : {}), by }
    : { designId, brief, by };
  const held = await startHeldRound({ designBuilds, stageKit: deps.stageKit || stageDesignKit, design, what: change ? 'change' : 'build', opts });
  if (!held.ok) return { refused: held.notice, ...(held.status ? { status: held.status } : {}) };
  return { buildId: held.started.buildId, round: held.started.round };
}

/** Waits for the build to settle (or reads its row when it is no longer held), and closes a paused one so the next
 *  round can start. @returns {Promise<{status: string, reason: string|null, sections: Array<{id, job, brief, status}>,
 *  costUsd: number, version: number|null}>} status `missing` for an unknown build */
export async function awaitBuild(buildId, deps = {}) {
  const reg = registryOf(deps);
  if (reg) await reg.whenSettled(buildId);
  let row = getBuild(buildId);
  if (row?.status === 'paused' && reg) {
    await reg.stopBuild(buildId);
    const closed = getBuild(buildId);
    row = closed ? { ...closed, status: 'paused', reason: closed.reason || 'paused' } : row;
  }
  if (!row) return { status: 'missing', reason: null, sections: [], costUsd: 0, version: null };
  const sections = (Array.isArray(row.sections) ? row.sections : [])
    .filter((s) => s && s.status !== 'removed')
    .map((s) => ({ id: s.id, job: s.job || s.id, brief: typeof s.brief === 'string' ? s.brief : '', status: s.status }));
  return { status: row.status, reason: row.reason ?? null, sections, costUsd: Number(row.costUsd) || 0,
    version: getDesign(row.designId)?.version ?? null };
}

/** The tree's digest: every regular file's path and bytes, in path order; null when the tree holds anything else (a
 *  link, a device), so a swapped-in link is never followed. */
export function treeDigest(dir) {
  const h = createHash('sha256');
  const walk = (d) => {
    for (const n of readdirSync(d).sort()) {
      const p = join(d, n);
      const st = lstatSync(p);
      if (st.isDirectory()) { if (!walk(p)) return false; continue; }
      if (!st.isFile()) return false;
      h.update(`${relative(dir, p)}\0`).update(createHash('sha256').update(readFileSync(p)).digest('hex')).update('\n');
    }
    return true;
  };
  try { return walk(dir) ? h.digest('hex') : null; } catch { return null; }
}

/** Copies `src` into a fresh sibling of `dir`, then renames it into place: a crash never leaves half a copy. */
function copyInto(src, dir, { dereference }) {
  const tmp = join(dirname(dir), `.${basename(dir)}-${process.pid}-${Date.now()}`);
  rmSync(tmp, { recursive: true, force: true });
  try {
    cpSync(src, tmp, { recursive: true, dereference, filter: (from) => { try { const st = lstatSync(from); return st.isDirectory() || st.isFile() || dereference; } catch { return false; } } });
    return tmp;
  } catch (err) { rmSync(tmp, { recursive: true, force: true }); throw err; }
}
const swapIn = (tmp, dir) => { rmSync(dir, { recursive: true, force: true }); renameSync(tmp, dir); };

/** D13: freezes the design's current `dist/` into the planning run's `prototype-confirmed/` with its manifest, closed to
 *  Worca (0700); never read by agents and never changed by a later Design round. `{stale: version}` when the design moved
 *  past the version the person saw; PrototypeError `no-dist` when there is nothing built to freeze, `no-freeze` when the
 *  copy failed. `digest` is the frozen tree's, kept in the run's record (not in the folder) for the staging check. */
export function freezePrototype({ designId, shownVersion, screens = [], pipelineDir, now = () => new Date() }) {
  const d = getDesign(designId);
  const version = d?.version ?? null;
  if (version !== shownVersion) return { stale: version };
  const src = distDir(designId);
  if (!existsSync(join(src, 'index.html'))) throw new PrototypeError('no-dist', 'The prototype has no built page to confirm.');
  const dir = join(pipelineDir, CONFIRMED_DIR);
  let digest;
  try {
    mkdirSync(pipelineDir, { recursive: true });
    const tmp = copyInto(src, dir, { dereference: true });
    writeFileSync(join(tmp, MANIFEST), JSON.stringify({ designId, version, screens, confirmedAt: now().toISOString() }, null, 2) + '\n', 'utf8');
    digest = treeDigest(tmp);
    if (!digest) { rmSync(tmp, { recursive: true, force: true }); throw new Error('the built page holds something that is not a file'); }
    chmodSync(tmp, 0o700);
    swapIn(tmp, dir);
  } catch (err) {
    throw new PrototypeError('no-freeze', `The prototype could not be frozen: ${err.message}`);
  }
  return { dir, version, digest };
}

/** The frozen folder, when it is still the one the record names: a real folder (no link) named `prototype-confirmed`
 *  directly inside the origin run's folder, owned by this user, whose tree matches the recorded digest. */
function frozenDir(ref, originPipelineId) {
  if (!ref || typeof ref.dir !== 'string' || typeof ref.digest !== 'string' || basename(ref.dir) !== CONFIRMED_DIR) return null;
  try {
    const st = lstatSync(ref.dir);
    if (!st.isDirectory() || st.isSymbolicLink()) return null;
    if (typeof process.getuid === 'function' && st.uid !== process.getuid()) return null;
    const parent = dirname(ref.dir);
    if (realpathSync(ref.dir) !== join(realpathSync(parent), CONFIRMED_DIR)) return null;
    if (originPipelineId && resolvePipelineId(parent) !== String(originPipelineId).toLowerCase()) return null;
    if (!existsSync(join(ref.dir, MANIFEST)) || treeDigest(ref.dir) !== ref.digest) return null;
    return ref.dir;
  } catch { return null; }
}

/** D14: a run's own copy of the confirmed prototype, at `<pipelineDir>/prototype`; null when the frozen folder is gone,
 *  moved, changed since the confirm, or cannot be copied. */
export function stagePrototypeForRun({ ref, pipelineDir, originPipelineId = null }) {
  const src = frozenDir(ref, originPipelineId);
  if (!src) return null;
  const dir = join(pipelineDir, RUN_DIR);
  try {
    mkdirSync(pipelineDir, { recursive: true });
    const tmp = copyInto(src, dir, { dereference: false });
    if (treeDigest(tmp) !== ref.digest) { rmSync(tmp, { recursive: true, force: true }); return null; }
    chmodSync(tmp, 0o755);
    swapIn(tmp, dir);
    return dir;
  } catch { return null; }
}
