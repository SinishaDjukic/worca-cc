// src/core/exec-env/box-image.mjs
// The box image (`worca container build`, docs/environment-spec.md "Building the box image"): one local image for
// every project the box serves, built FROM the operator's base (WORCA_BASE_IMAGE in the container .env) plus the
// union of the projects' environment specs. This module is pure apart from the record, the .env helpers and the spec lookup at the end:
// the union, the Dockerfile, the image tag, the current/stale verdict and the check of the finished image.
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, renameSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { normalizeEnvSpec } from './env-spec.mjs';
import { renderSpecLayers } from './spec-dockerfile.mjs';
import { MIN_NODE, cmpVersions } from '../preflight-node.mjs';
import { readProjectExecEnv } from '../config.mjs';

export const BOX_IMAGE_REPO = 'worca-box';
export const DEFAULT_BASE_REPO = 'ghcr.io/worca-org/worca';
export const RECORD_FILE = '.worca-box-image.json';
export const BUILD_DIR = 'box-image';
/** The label every Worca image carries (docker/Dockerfile); an image without it is not Worca or derived from it. */
export const CLAUDE_CODE_LABEL = 'dev.worca.claude-code.version';
export const SPEC_LABEL = 'dev.worca.box-image.spec';
// An image reference as a FROM line takes it: registry/path:tag@digest, nothing that could end the line.
const IMAGE_REF = /^[A-Za-z0-9][A-Za-z0-9._/:@-]{0,254}$/;
const SPEC_HASH = /^sha256:[0-9a-f]{64}$/;

export class BoxImageError extends Error {
  constructor(message) { super(message); this.name = 'BoxImageError'; this.code = 'BOX_IMAGE'; }
}

/** `ref` when it can stand in a FROM line; throws otherwise. */
export function checkImageRef(ref, what = 'image') {
  if (typeof ref !== 'string' || !IMAGE_REF.test(ref) || ref.includes('..') || ref.includes('//')) {
    throw new BoxImageError(`${what} ${JSON.stringify(ref)} is not an image reference`);
  }
  return ref;
}

/** What the build starts from: WORCA_BASE_IMAGE from the container .env, else the image of WORCA_TAG.
 *  `envFile(key)` reads the container .env only: the base is the operator's choice, never a repository's. */
export function boxBaseImage(envFile) {
  const set = String(envFile('WORCA_BASE_IMAGE') || '').trim();
  if (set) return checkImageRef(set, 'WORCA_BASE_IMAGE');
  const tag = String(envFile('WORCA_TAG') || '').trim() || 'latest';
  return checkImageRef(`${DEFAULT_BASE_REPO}:${tag}`, 'WORCA_TAG');
}

/**
 * One spec for the box from several projects' specs: every tool once, every apt package once.
 * @param {{key:string, name?:string, spec:object}[]} entries  the projects, each with its stored spec
 * @returns {object} normalizeEnvSpec output (sorted, with its hash)
 * @throws {BoxImageError} when two projects pin different versions of one tool (names both and the tool)
 */
export function unionSpecs(entries) {
  if (!entries.length) throw new BoxImageError('no project to build for');
  const tools = new Map();   // name -> { version, who }
  const apt = new Set();
  for (const { key, name, spec } of entries) {
    const who = name ? `${name} (${key})` : key;
    for (const t of spec?.tools ?? []) {
      const seen = tools.get(t.name);
      if (seen && seen.version !== t.version) {
        throw new BoxImageError(`tool ${t.name}: project ${seen.who} pins ${seen.version}, project ${who} pins ${t.version}. One box image serves both: align the versions, or build for one of them with --project`);
      }
      if (!seen) tools.set(t.name, { version: t.version, who });
    }
    for (const p of spec?.apt ?? []) apt.add(p);
  }
  try {
    return normalizeEnvSpec({ tools: [...tools].map(([n, { version }]) => ({ name: n, version })), apt: [...apt] });
  } catch (err) { throw new BoxImageError(`the projects' specs together: ${err.message}`); }
}

/** A project key as it may stand in the image's ENV line (keys are slugs; anything else is left out). */
const PROJECT_KEY = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
/** `projects` ([{key, specHash}]) as the box image's WORCA_BOX_IMAGE_PROJECTS value: Worca inside the box compares it
 *  with the projects' specs now (security-posture.mjs boxImageInside), without the host's build record. */
export function boxImageProjectsValue(projects = []) {
  return projects.filter((p) => PROJECT_KEY.test(String(p?.key)) && SPEC_HASH.test(String(p?.specHash))).map((p) => `${p.key}=${p.specHash}`).join(',');
}

/** The box image's Dockerfile: FROM the base, the spec's layers as root, back to the worca user. `projects` (the specs it
 *  is built for, [{key, specHash}]) goes into an ENV line, so Worca in the box can tell when a spec changed since. */
export function renderBoxDockerfile({ base, spec, projects = [] }) {
  checkImageRef(base, 'base image');
  if (!SPEC_HASH.test(String(spec?.hash))) throw new BoxImageError('the spec has no hash');
  const forProjects = boxImageProjectsValue(projects);
  return [
    '# Worca box image, written by `worca container build` (docs/environment-spec.md). Rebuild instead of editing.',
    `FROM ${base}`,
    'USER root',
    ...renderSpecLayers(spec),
    'USER worca',
    `LABEL ${SPEC_LABEL}="${spec.hash}"`,
    ...(forProjects ? [`ENV WORCA_BOX_IMAGE_PROJECTS="${forProjects}"`] : []),
    '',
  ].join('\n');
}

/** `worca-box:<12 hex>` from the Dockerfile and the base's image id: the same inputs give the same name, and a
 *  newer base (a pull of the same tag) gives a new one, so a failed rebuild never replaces the image in use. */
export function boxImageTag(dockerfile, baseId = '') {
  return `${BOX_IMAGE_REPO}:${createHash('sha256').update(`${dockerfile}\n${baseId}`).digest('hex').slice(0, 12)}`;
}

// ── The check of a finished image ────────────────────────────────────────────
/** Runs in the built image (`sh -c`, no network): one `name=version line` per tool Worca needs. */
export const PROBE_SCRIPT = 'for c in node git claude worca; do v=$("$c" --version 2>/dev/null | head -n 1); printf \'%s=%s\\n\' "$c" "$v"; done';
const VERSION_IN = /(\d+\.\d+\.\d+(?:-[0-9A-Za-z.]+)?)/;

/** PROBE_SCRIPT's output as { node, git, claude, worca }: each a version string, or null when absent. */
export function parseBoxProbe(text) {
  const out = { node: null, git: null, claude: null, worca: null };
  for (const line of String(text ?? '').split(/\r?\n/)) {
    const m = /^(node|git|claude|worca)=(.*)$/.exec(line.trim());
    if (!m) continue;
    const v = VERSION_IN.exec(m[2]);
    out[m[1]] = v ? v[1] : null;
  }
  return out;
}

/** `docker image inspect --format '{{json .Config.Labels}}'` output as an object ({} for null or junk). */
export function parseLabels(text) {
  try { const v = JSON.parse(String(text ?? '').trim() || 'null'); return v && typeof v === 'object' && !Array.isArray(v) ? v : {}; } catch { return {}; }
}

/**
 * What the built image lacks for Worca, one line each; [] when it has everything.
 * @param {{node,git,claude,worca}} probe  parseBoxProbe output
 * @param {{labels: object, base: string, minNode?: string}} ctx
 */
export function checkBoxProbe(probe, { labels, base, minNode = MIN_NODE }) {
  const problems = [];
  const pin = labels?.[CLAUDE_CODE_LABEL];
  if (!pin) {
    problems.push(`the base ${base} is not a Worca image or one built FROM it (it has no ${CLAUDE_CODE_LABEL} label)`);
  }
  if (!probe.node) problems.push('node is missing from the image');
  else if (cmpVersions(probe.node, minNode) < 0) problems.push(`node ${probe.node} runs in the image, but Worca needs ${minNode} or newer (does a spec tool pin an older node?)`);
  if (!probe.git) problems.push('git is missing from the image');
  if (!probe.claude) problems.push('Claude Code (claude) is missing from the image');
  else if (pin && probe.claude !== pin) problems.push(`Claude Code ${probe.claude} runs in the image, but the base pins ${pin} (does a spec tool replace it?)`);
  if (!probe.worca) problems.push('worca is missing from the image');
  return problems;
}

// ── Current or stale ─────────────────────────────────────────────────────────
/**
 * Whether the image in use still matches what it was built from. Nothing rebuilds by itself: a stale image is
 * still used, with a warning.
 * @param {object} p
 * @param {object|null} p.record     the build record, or null
 * @param {string} p.envImage        WORCA_IMAGE in the container .env ('' when unset)
 * @param {string} p.base            the base a build would start from now
 * @param {(key:string)=>string|null} p.specHashOf  a project's current spec hash, null without a spec
 * @param {string|null} [p.baseId]   the base's local image id now, when known
 * @param {{key:string,name?:string}[]} [p.withSpec]  every project that has a spec now (for the notes)
 * @returns {{state:'none'|'current'|'stale'|'detached', image:string|null, reasons:string[], notes:string[]}}
 */
export function boxImageState({ record, envImage, base, specHashOf, baseId = null, withSpec = [] }) {
  if (!envImage) return { state: 'none', image: null, reasons: [], notes: record ? [`${record.image} was built, but .env does not name it: the box runs ${base}`] : [] };
  if (!record || record.image !== envImage) {
    return { state: 'detached', image: envImage, reasons: [`.env names ${envImage}, which worca container build did not record here`], notes: [] };
  }
  const reasons = [];
  for (const p of record.projects ?? []) {
    let now = null;
    try { now = specHashOf(p.key); } catch { now = null; }
    const who = p.name ? `${p.name} (${p.key})` : p.key;
    if (!now) reasons.push(`project ${who} no longer has an environment spec`);
    else if (now !== p.specHash) reasons.push(`project ${who} changed its environment spec`);
  }
  if (record.base !== base) reasons.push(`the base is now ${base} (built from ${record.base})`);
  else if (baseId && record.baseId && baseId !== record.baseId) reasons.push(`a newer ${base} is here (pulled since the build)`);
  const inImage = new Set((record.projects ?? []).map((p) => p.key));
  const notes = withSpec.filter((p) => !inImage.has(p.key)).map((p) => `project ${p.name ? `${p.name} (${p.key})` : p.key} has a spec that is not in the image`);
  return { state: reasons.length ? 'stale' : 'current', image: envImage, reasons, notes };
}

/** A project's spec hash now, null without a spec. */
export function currentSpecHash(key) { return readProjectExecEnv(key).spec?.hash ?? null; }

/**
 * For `worca container up`, `run`, `login` and `shell`: whether to add compose.image.yml (WORCA_IMAGE set in .env)
 * and the warning to print when that image is stale. Cheap: no runtime call.
 * @returns {{overlay: boolean, notice: string}}
 */
export function boxImageForCompose({ dir, envFile, specHashOf = currentSpecHash }) {
  const envImage = String(envFile('WORCA_IMAGE') || '').trim();
  if (!envImage) return { overlay: false, notice: '' };
  let base;
  try { base = boxBaseImage(envFile); } catch { base = String(envFile('WORCA_BASE_IMAGE') || ''); }
  const st = boxImageState({ record: readBoxImageRecord(dir), envImage, base, specHashOf });
  if (st.state === 'stale') return { overlay: true, notice: `the box image ${envImage} is stale: ${st.reasons.join('; ')}. It is still used. Rebuild: worca container build` };
  if (st.state === 'detached') return { overlay: true, notice: `the box runs ${envImage} (WORCA_IMAGE in .env), which worca container build did not record` };
  return { overlay: true, notice: '' };
}

// ── The record and the .env line ─────────────────────────────────────────────
export function readBoxImageRecord(dir) {
  try { const v = JSON.parse(readFileSync(join(dir, RECORD_FILE), 'utf8')); return v && typeof v === 'object' && typeof v.image === 'string' ? v : null; } catch { return null; }
}
export function writeBoxImageRecord(dir, record) {
  const file = join(dir, RECORD_FILE);
  writeFileSync(`${file}.tmp`, JSON.stringify(record, null, 2) + '\n');
  renameSync(`${file}.tmp`, file);
}

/** .env with `key` set to `value`, or removed when value is null. A live line is replaced (later duplicates
 *  dropped); else the line goes under a commented-out example of the key, else at the end. Other lines stay as they
 *  are. The value is written bare: callers pass image references only (checkImageRef). */
export function setDotenvLine(body, key, value) {
  const live = new RegExp(`^\\s*(?:export\\s+)?${key}\\s*=`);
  const example = new RegExp(`^\\s*#\\s*${key}\\s*=`);
  const line = value === null ? null : `${key}=${value}`;
  const out = [];
  let placed = false;
  for (const l of String(body ?? '').split('\n')) {
    if (!live.test(l)) { out.push(l); continue; }
    if (line && !placed) { out.push(line); placed = true; }
  }
  if (line && !placed) {
    const i = out.findIndex((l) => example.test(l));
    if (i >= 0) out.splice(i + 1, 0, line);
    else if (out.at(-1) === '') out.splice(out.length - 1, 0, line);
    else out.push(line, '');
  }
  return out.join('\n');
}
export function writeEnvValue(dir, key, value) {
  const file = join(dir, '.env');
  const body = existsSync(file) ? readFileSync(file, 'utf8') : '';
  writeFileSync(file, setDotenvLine(body, key, value), { mode: 0o600 });
}
