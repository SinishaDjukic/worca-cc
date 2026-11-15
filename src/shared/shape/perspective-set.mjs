// src/shared/shape/perspective-set.mjs — the run's chosen perspective set (flag proposedPerspectives): which
// reviewer roles run and how many Clarify questions are kept. The set is read once at start; resolveGraph applies it
// to its private copy of the template (applyPerspectiveSet), so the manifest carries the result and a resume never
// re-applies it. Pure and browser-safe.
import { perspectiveByKey, normalizePerspectives } from './perspectives.mjs';
import {
  roleReviewOf, roleChecklistOf, optInRolesOf, LEGACY_ROLE_REVIEW, MAX_ROLES, ROLE_KEY_RE,
} from '../graph/role-review-step.mjs';
import { COVERAGE_ROLE } from '../review/requirements-coverage.mjs';

/** The agent key whose nodes become the code review of the chosen set. */
export const REVIEWER_KEY = 'reviewer';
/** At most this many Clarify questions on a run with a set (one per chosen perspective). */
export const CLARIFY_TOTAL = 3;

const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
const roleOfKey = (key) => ({ key, label: perspectiveByKey(key).label });

/** (a) A `picked` plan role review gains the provider's opt-in roles the set names (declared roles materialised). */
function withOptIns(cfg, spec, chosen) {
  const optIns = optInRolesOf(roleChecklistOf(spec)).filter((r) => chosen.includes(r.key));
  const raw = cfg.roleReview === true ? { ...LEGACY_ROLE_REVIEW } : { ...cfg.roleReview };
  const declared = Array.isArray(raw.roles) ? raw.roles.map((r) => ({ ...r })) : spec.roles.map((r) => ({ ...r }));
  const add = optIns.filter((r) => !declared.some((d) => d.key === r.key)).slice(0, Math.max(0, MAX_ROLES - declared.length));
  if (!add.length) return null;
  return { ...cfg, roleReview: { ...raw, roles: [...declared, ...add.map((r) => ({ key: r.key, label: r.label }))] } };
}

/** (b) The reviewer's code review becomes one role per chosen key (plus Requirements on a coverage spec). */
function asCodeRoles(cfg, chosen) {
  const raw = isObj(cfg.roleReview) ? cfg.roleReview : {};
  const old = new Map((Array.isArray(raw.roles) ? raw.roles : []).filter(isObj).map((r) => [r.key, r]));
  const tune = (key) => {
    const o = old.get(key) || {};
    return { ...(typeof o.model === 'string' ? { model: o.model } : {}), ...(typeof o.effort === 'string' ? { effort: o.effort } : {}) };
  };
  const roles = chosen.map((key) => ({ ...roleOfKey(key), ...tune(key) }));
  if (raw.checklist === 'coverage') roles.push({ ...COVERAGE_ROLE, ...tune(COVERAGE_ROLE.key) });
  const spec = { ...raw, roles, source: 'declared', target: 'diff', sink: 'implementer' };
  if (spec.secondOpinion !== undefined && !roles.some((r) => r.key === spec.secondOpinion)) delete spec.secondOpinion;
  return { ...cfg, roleReview: spec };
}

/**
 * The template's role specs for a chosen set. Takes template nodes `{ id, kind, key, config }` and the run's chosen
 * keys; returns a Map node id → new config, for changed agent nodes only (empty for no set). Never mutates its input.
 * @param {Array<{id:string, kind:string, key?:string, config?:object}>} nodes
 * @param {string[]|null} chosen
 * @returns {Map<string, object>}
 */
export function applyPerspectiveSet(nodes, chosen) {
  const out = new Map();
  if (!Array.isArray(chosen)) return out;
  const keys = chosen.filter((k) => typeof k === 'string' && ROLE_KEY_RE.test(k) && perspectiveByKey(k));
  for (const node of Array.isArray(nodes) ? nodes : []) {
    if (!node || node.kind !== 'agent') continue;
    const cfg = isObj(node.config) ? node.config : {};
    const spec = roleReviewOf(cfg);
    if (spec?.source === 'picked') {
      const next = withOptIns(cfg, spec, keys);
      if (next) out.set(node.id, next);
      continue;
    }
    if (node.key !== REVIEWER_KEY || !keys.length) continue;
    if (cfg.roleReview !== undefined && !(isObj(cfg.roleReview) && cfg.roleReview.target === 'diff')) continue;
    out.set(node.id, asCodeRoles(cfg, keys));
  }
  return out;
}

/** The code review role keys of a resolved graph's node configs, in node then role order (the run's audit line). */
export function codeReviewRoleKeys(configs) {
  return (Array.isArray(configs) ? configs : []).map((c) => roleReviewOf(c))
    .filter((spec) => spec && spec.target === 'diff').flatMap((spec) => spec.roles.map((r) => r.key));
}

const validSet = (chosen) => {
  if (!Array.isArray(chosen)) return null;
  const n = normalizePerspectives(chosen, { compliance: true });
  return n.ok ? n.perspectives : null;
};

/** The Clarify prompt's block for a run with a set: '' for an invalid list. */
export function clarifyPerspectivesBlock(chosen) {
  const keys = validSet(chosen);
  if (!keys) return '';
  return '## Perspectives for your questions\n\n' +
    `This task is reviewed from these perspectives: ${keys.map((k) => `${perspectiveByKey(k).label} (${k})`).join(', ')}.\n\n` +
    `Ask at most one question per perspective and at most ${CLARIFY_TOTAL} in total. Start each question's \`id\` with ` +
    'its perspective key and a dash, for example `security-retention`.\n\n';
}

/**
 * Clarify's questions kept for a set: the first per perspective (the `id` before its first `-`; a key not chosen reads
 * as Product), in the agent's order, then the first `total`. Pure.
 * @returns {{questions:object[], dropped:object[]}}
 */
export function capClarifyByPerspective(questions, chosen, { total = CLARIFY_TOTAL } = {}) {
  const list = Array.isArray(questions) ? questions : [];
  const set = new Set(Array.isArray(chosen) ? chosen : []);
  const seen = new Set();
  const kept = [];
  const dropped = [];
  for (const question of list) {
    const prefix = String(question?.id ?? '').split('-')[0];
    const key = set.has(prefix) ? prefix : 'product';
    if (seen.has(key) || kept.length >= total) { dropped.push(question); continue; }
    seen.add(key);
    kept.push(question);
  }
  return { questions: kept, dropped };
}
