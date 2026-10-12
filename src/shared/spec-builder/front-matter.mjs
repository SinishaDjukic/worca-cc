// src/shared/spec-builder/front-matter.mjs
// The `worca:` front-matter block of a Spec Builder spec (plans/spec-builder — §3.1, D6). Shared by the
// wizard (browser), the propose_spec validator and the Auto classifier guard. Browser-safe: NOT a YAML
// parser — it reads this one fixed schema (2-space keys under `worca:`, scalars, `[a, b]`, `{ k: v }`).
import { ROLES, ROLE_KEYS, roleByKey } from './roles.mjs';

export const SPEC_KINDS = Object.freeze(['feature', 'fix', 'refactor', 'infra', 'docs']);
export const SPEC_SIZES = Object.freeze(['small', 'medium', 'large']);
export const SPEC_SIGNALS = Object.freeze(['risky']);
export const SPEC_LEVELS = Object.freeze(['simple', 'advanced', 'expert', 'all']);
export const SPEC_FLAG_STAGES = Object.freeze(['experimental', 'beta']);
export const GENERATED_BY = 'spec-builder@2';
export const SPEC_MODES = Object.freeze(['draft', 'reshape']);
/** The §3.4 shape check ids, in display order. Here (not in shape.mjs) so the validator can check waivers
 *  without an import cycle (shape.mjs imports this module). */
export const SHAPE_IDS = Object.freeze(['sections', 'testable', 'decisions', 'paths', 'tests', 'placeholders', 'checklists', 'grounded']);
export const UNWAIVABLE_SHAPE_IDS = Object.freeze(['checklists']);
export const WAIVER_REASON_MAX = 200;
export const IDEA_MAX_CHARS = 32_000;
const FLAG_KEY_RE = /^[a-z][a-zA-Z0-9]{2,40}$/;            // = src/shared/flags/registry.mjs FLAG_KEY_RE
const GENERATED_RE = /^spec-builder@\d+$/;
const WAIVER_RE = /^\{\s*id\s*:\s*([a-z]+)\s*,\s*reason\s*:\s*("(?:[^"\\]|\\.)*")\s*\}$/;
const FENCE_RE = /^﻿?---[ \t]*\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/;

const unquote = (s) => {
  const v = String(s).trim();
  return v.length >= 2 && /^(["']).*\1$/.test(v) ? v.slice(1, -1) : v;
};
const stripComment = (v) => { const i = v.search(/\s#/); return (i >= 0 ? v.slice(0, i) : v).trim(); };

function parseValue(raw) {
  const v = stripComment(raw);
  if (v.startsWith('[') && v.endsWith(']')) return v.slice(1, -1).split(',').map(unquote).filter(Boolean);
  if (v.startsWith('{') && v.endsWith('}')) {
    const o = {};
    for (const part of v.slice(1, -1).split(',')) {
      const m = /^\s*([A-Za-z][\w-]*)\s*:\s*(.*)$/.exec(part);
      if (m) o[m[1]] = unquote(m[2]);
    }
    return o;
  }
  return unquote(v);
}

/** The raw `worca:` map of a fenced block, or null when there is no fence or no `worca:` key. */
function readBlock(inner) {
  const lines = inner.split(/\r?\n/);
  const at = lines.findIndex((l) => /^worca:[ \t]*(?:#.*)?$/.test(l));
  if (at < 0) return null;
  const out = {};
  let listKey = null;
  for (const line of lines.slice(at + 1)) {
    if (!/^[ \t]+\S/.test(line)) { if (line.trim()) break; continue; }   // the next top-level key ends the block
    const item = /^[ \t]+-[ \t]+(.*)$/.exec(line);
    if (item && listKey) { out[listKey].push(item[1].trim()); continue; }
    const m = /^[ \t]+([A-Za-z][\w-]*)[ \t]*:[ \t]*(.*)$/.exec(line);
    if (!m || Object.hasOwn(out, m[1])) { listKey = null; continue; }
    if (m[1] === 'shapeWaived' && stripComment(m[2]) === '') { out[m[1]] = []; listKey = m[1]; }   // only this key is a block list: an empty `levels:` stays ''
    else { out[m[1]] = parseValue(m[2]); listKey = null; }
  }
  return out;
}

function parseWaiver(v) {
  if (v && typeof v === 'object' && !Array.isArray(v)) return v;     // an object fm (tests, the pane)
  const m = WAIVER_RE.exec(String(v || '').trim());
  if (!m) return null;
  try { return { id: m[1], reason: JSON.parse(m[2]) }; } catch { return null; }
}

const list = (v) => (Array.isArray(v) ? v : v == null || v === '' ? [] : [v]).map((x) => String(x).trim()).filter(Boolean);

/** Validate a front-matter OBJECT. Unknown keys are dropped; bad values are errors. */
export function validateWorcaFrontMatter(raw) {
  const src = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  const errors = [];
  const fm = {};
  if (SPEC_KINDS.includes(src.kind)) fm.kind = src.kind; else errors.push(`worca.kind must be one of ${SPEC_KINDS.join(', ')}`);
  if (SPEC_SIZES.includes(src.size)) fm.size = src.size; else errors.push(`worca.size must be one of ${SPEC_SIZES.join(', ')}`);
  const signals = list(src.signals);
  for (const s of signals) if (!SPEC_SIGNALS.includes(s)) errors.push(`worca.signals has an unknown value: ${s}`);
  if (signals.length) fm.signals = [...new Set(signals)];
  const roles = list(src.roles);
  for (const r of roles) if (!ROLE_KEYS.includes(r)) errors.push(`worca.roles has an unknown role: ${r}`);
  if (!roles.includes('product')) errors.push('worca.roles must include product');
  fm.roles = ROLE_KEYS.filter((k) => roles.includes(k));
  if (src.flag != null && src.flag !== '') {
    const f = src.flag && typeof src.flag === 'object' ? src.flag : {};
    if (FLAG_KEY_RE.test(f.key || '') && SPEC_FLAG_STAGES.includes(f.stage)) fm.flag = { key: f.key, stage: f.stage };
    else errors.push('worca.flag must be { key: camelCase, stage: experimental | beta }');
  }
  if (src.levels != null && src.levels !== '') {
    if (SPEC_LEVELS.includes(src.levels)) fm.levels = src.levels; else errors.push(`worca.levels must be one of ${SPEC_LEVELS.join(', ')}`);
  }
  if (src.generatedBy != null && src.generatedBy !== '') {
    if (GENERATED_RE.test(String(src.generatedBy))) fm.generatedBy = String(src.generatedBy); else errors.push('worca.generatedBy must look like spec-builder@2');
  }
  if (src.mode != null && src.mode !== '') {
    if (SPEC_MODES.includes(src.mode)) fm.mode = src.mode; else errors.push(`worca.mode must be one of ${SPEC_MODES.join(', ')}`);
  }
  if (src.shapeWaived != null && src.shapeWaived !== '') {
    const raw = Array.isArray(src.shapeWaived) ? src.shapeWaived : [src.shapeWaived];
    const waived = [];
    for (const w of raw.map(parseWaiver)) {
      const reason = clip(w?.reason, WAIVER_REASON_MAX);
      if (!w || !SHAPE_IDS.includes(w.id) || !reason) { errors.push('worca.shapeWaived items must be { id: <shape check>, reason: "<one line>" }'); continue; }
      if (UNWAIVABLE_SHAPE_IDS.includes(w.id)) { errors.push(`worca.shapeWaived: the ${w.id} check can't be waived`); continue; }
      if (!waived.some((x) => x.id === w.id)) waived.push({ id: w.id, reason });
    }
    if (waived.length) fm.shapeWaived = waived;
  }
  return errors.length ? { ok: false, errors } : { ok: true, fm };
}

/**
 * @returns {null | {ok:true, fm:object, body:string} | {ok:false, errors:string[], body:string}}
 *   null when the Markdown has no leading fence or the fence has no `worca:` key (D6: such specs are unaffected).
 */
export function parseWorcaFrontMatter(md) {
  if (typeof md !== 'string') return null;
  const m = FENCE_RE.exec(md);
  if (!m) return null;
  const block = readBlock(m[1]);
  if (!block) return null;
  const body = md.slice(m[0].length);
  const v = validateWorcaFrontMatter(block);
  return v.ok ? { ok: true, fm: v.fm, body } : { ok: false, errors: v.errors, body };
}

/** Deterministic key order — the inverse of parseWorcaFrontMatter for a validated fm. */
export function renderWorcaFrontMatter(fm) {
  const lines = ['---', 'worca:', `  kind: ${fm.kind}`, `  size: ${fm.size}`];
  if (fm.signals?.length) lines.push(`  signals: [${fm.signals.join(', ')}]`);
  lines.push(`  roles: [${fm.roles.join(', ')}]`);
  if (fm.flag) lines.push(`  flag: { key: ${fm.flag.key}, stage: ${fm.flag.stage} }`);
  if (fm.levels) lines.push(`  levels: ${fm.levels}`);
  if (fm.generatedBy) lines.push(`  generatedBy: ${fm.generatedBy}`);
  if (fm.mode) lines.push(`  mode: ${fm.mode}`);
  if (fm.shapeWaived?.length) {
    lines.push('  shapeWaived:');
    for (const w of fm.shapeWaived) lines.push(`    - { id: ${w.id}, reason: ${JSON.stringify(w.reason)} }`);
  }
  lines.push('---', '');
  return lines.join('\n');
}

const clip = (v, n) => String(v ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, n);

/** The wizard's answers, cleaned (server and browser both call this; the server never trusts the browser's). */
export function normalizeAnswers(raw) {
  const a = raw && typeof raw === 'object' ? raw : {};
  const flag = a.flag && typeof a.flag === 'object' && a.flag.key ? { key: clip(a.flag.key, 41), stage: clip(a.flag.stage, 20) || 'beta' } : null;
  return {
    idea: String(a.idea ?? '').replace(/\r\n?/g, '\n').replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, ' ').trim().slice(0, IDEA_MAX_CHARS),
    mode: SPEC_MODES.includes(a.mode) ? a.mode : 'draft',
    kind: SPEC_KINDS.includes(a.kind) ? a.kind : 'feature',
    roles: ROLE_KEYS.filter((k) => k === 'product' || list(a.roles).includes(k)),
    size: SPEC_SIZES.includes(a.size) ? a.size : 'medium',
    flag,
  };
}

/** Front-matter for normalized answers: Security's `risky` comes from roles.mjs (D5). */
export function frontMatterFromAnswers(a) {
  const signals = [...new Set(a.roles.flatMap((k) => roleByKey(k)?.effect.signals || []))];
  return {
    kind: a.kind, size: a.size,
    ...(signals.length ? { signals } : {}),
    roles: [...a.roles],
    ...(a.flag ? { flag: { ...a.flag } } : {}),
    generatedBy: GENERATED_BY,
    mode: a.mode,
  };
}

/** The spec with `{ id, reason }` added to (or replacing the same id in) worca.shapeWaived (V18). A spec without a
 *  valid worca: block comes back unchanged. */
export function withWaiver(markdown, id, reason) {
  const p = parseWorcaFrontMatter(markdown);
  if (!p || !p.ok || UNWAIVABLE_SHAPE_IDS.includes(id) || !SHAPE_IDS.includes(id)) return markdown;
  const r = clip(reason, WAIVER_REASON_MAX);
  if (!r) return markdown;
  const fm = { ...p.fm, shapeWaived: [...(p.fm.shapeWaived || []).filter((w) => w.id !== id), { id, reason: r }] };
  return renderWorcaFrontMatter(fm) + p.body;
}

export { ROLES };
