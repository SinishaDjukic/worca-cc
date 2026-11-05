// src/shared/graph/role-review-step.mjs — the engine's role-review step: a node whose config.roleReview declares roles
// fans out one independent reviewer slice per running role, merges their findings and hands them to its sink. Any
// workflow may declare it; Shaper declares its perspectives as roles. Pure and browser-safe.
import { PERSPECTIVE_ROLE_CHECKLIST } from '../shape/role-review.mjs';
import { REQUIREMENTS_ROLE_CHECKLIST } from '../shape/requirements.mjs';
import { REQUIREMENTS_COVERAGE_CHECKLIST, COVERAGE_ROLE } from '../review/requirements-coverage.mjs';
import { dispositionsBlock } from '../review/findings.mjs';

const BLOCKING = new Set(['critical', 'major']);
const SEVERITIES = new Set(['critical', 'major', 'minor', 'suggestion']);
const STATUSES = new Set(['met', 'unmet', 'na']);
const oneLine = (v) => String(v ?? '').replace(/\s+/g, ' ').trim();
/** A finding that names an agreed requirement (Shaper requirements s3): a concern for the person, never blocking. */
export const isRequirementConcern = (f) => !!f?.requirement;
const blocks = (f) => BLOCKING.has(f.severity) && !isRequirementConcern(f);

export const ROLE_KEY_RE = /^[a-z]{1,24}$/;   // finding ids are `key-round-n`: letters only keep them parseable
const MAX_ROLES = 12;
const LABEL_MAX = 60;
const SPEC_KEYS = new Set(['roles', 'source', 'target', 'checklist', 'sink']);
const ROLE_KEYS = new Set(['key', 'label', 'model', 'effort']);
const SOURCES = ['declared', 'picked'];

/** The slice task id for one role; the executor prefixes that role's files with it. */
export const roleTaskId = (key) => `role-${key}`;

/** The sink that hands the plan and the merged findings to a refiner (the one sink whose verdict routes the loop). */
export const REFINER_SINK = 'refiner';

/** The sinks a role review may hand its findings to. Each answers them in the findings file's dispositions file. */
export const ROLE_REVIEW_SINKS = Object.freeze([REFINER_SINK, 'implementer']);

/** What each target reviews, as data: the port the findings leave on, the input whose fresh token continues the pass,
 *  the mock role of its slices, its prompt words, the input it reviews (`reviewedPort`, also the output that passes
 *  the reviewed file on) and the findings file's head line. The engine reads this table; it never compares a target. */
export const ROLE_REVIEW_TARGETS = Object.freeze({
  plan: Object.freeze({ findingsPort: 'findings', continuePort: 'revise', mockRole: 'plan-review', noun: 'plan', sectionHint: 'the plan section',
    reviewedPort: 'plan', reviewedHead: 'Plan reviewed', requirementConcerns: true }),
  diff: Object.freeze({ findingsPort: 'review', continuePort: 'done', mockRole: 'code-review', noun: 'diff', sectionHint: 'the file and line',
    reviewedPort: 'plan', reviewedHead: 'Diff reviewed against the plan' }),
  requirements: Object.freeze({ findingsPort: 'findings', continuePort: 'revise', mockRole: 'requirements-review', noun: 'requirements',
    sectionHint: 'the criterion id', reviewedPort: 'requirements', reviewedHead: 'Requirements reviewed' }),
});

/** A spec's target entry; a spec without a known target (a legacy round, an older manifest) reads as the plan. */
export const roleTargetOf = (spec) => (Object.hasOwn(ROLE_REVIEW_TARGETS, String(spec?.target)) ? ROLE_REVIEW_TARGETS[spec.target] : ROLE_REVIEW_TARGETS.plan);

/** What a saved `roleReview: true` means, forever: Shaper's perspectives, picked per run, reviewing the plan for Refine. */
export const LEGACY_ROLE_REVIEW = Object.freeze({ source: 'picked', target: 'plan', checklist: 'perspectives', sink: REFINER_SINK });

/** Checklist providers by the key a spec's `checklist` names. A getter: the provider's module imports this one. */
export const ROLE_CHECKLISTS = Object.freeze({
  get perspectives() { return PERSPECTIVE_ROLE_CHECKLIST; },
  get requirements() { return REQUIREMENTS_ROLE_CHECKLIST; },
  get coverage() { return REQUIREMENTS_COVERAGE_CHECKLIST; },
});

const specOf = (config) => (config === true ? true : (config && typeof config === 'object' ? config.roleReview : undefined));
const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
const quote = (v) => JSON.stringify(typeof v === 'string' ? v.slice(0, 64) : v);

/** Every problem with a node config's roleReview, one message each. [] for none, `true` or a valid spec. */
export function roleReviewIssues(config) {
  const rr = specOf(config);
  if (rr === undefined || rr === true) return [];
  if (!isObj(rr)) return ['roleReview must be true or an object'];
  const out = [];
  for (const k of Object.keys(rr)) if (!SPEC_KEYS.has(k)) out.push(`roleReview.${String(k).slice(0, 32)} is unknown (known: ${[...SPEC_KEYS].join(', ')})`);
  if (!Object.hasOwn(ROLE_REVIEW_TARGETS, String(rr.target))) {
    const known = Object.keys(ROLE_REVIEW_TARGETS).join(' or ');
    out.push(rr.target === undefined ? `roleReview.target is required (${known})` : `roleReview.target ${quote(rr.target)} is not supported yet (${known})`);
  }
  if (!ROLE_REVIEW_SINKS.includes(rr.sink)) {
    const known = ROLE_REVIEW_SINKS.join(' or ');
    out.push(rr.sink === undefined ? `roleReview.sink is required (${known})` : `roleReview.sink ${quote(rr.sink)} is not supported yet (${known})`);
  }
  if (rr.source !== undefined && !SOURCES.includes(rr.source)) out.push(`roleReview.source ${quote(rr.source)} must be declared or picked`);
  if (rr.checklist !== undefined && !Object.hasOwn(ROLE_CHECKLISTS, rr.checklist)) {
    out.push(`roleReview.checklist ${quote(rr.checklist)} is unknown (known: ${Object.keys(ROLE_CHECKLISTS).join(', ')})`);
  }
  if (rr.roles === undefined) {
    if (rr.checklist === undefined) out.push('roleReview.roles is required without a checklist provider');
    return out;
  }
  if (!Array.isArray(rr.roles) || rr.roles.length < 1 || rr.roles.length > MAX_ROLES) {
    out.push(`roleReview.roles must be a list of 1–${MAX_ROLES} roles`);
    return out;
  }
  const seen = new Set();
  rr.roles.forEach((r, i) => {
    const at = `roleReview.roles[${i}]`;
    if (!isObj(r)) { out.push(`${at} must be an object`); return; }
    for (const k of Object.keys(r)) if (!ROLE_KEYS.has(k)) out.push(`${at}.${String(k).slice(0, 32)} is unknown (known: key, label, model, effort)`);
    if (typeof r.key !== 'string' || !ROLE_KEY_RE.test(r.key)) out.push(`${at}.key ${quote(r.key)} must be 1–24 lowercase letters`);
    else if (seen.has(r.key)) out.push(`${at}.key ${quote(r.key)} is declared twice`);
    else seen.add(r.key);
    if (typeof r.label !== 'string' || !r.label.trim() || r.label.length > LABEL_MAX) out.push(`${at}.label must be 1–${LABEL_MAX} characters`);
    for (const k of ['model', 'effort']) if (r[k] !== undefined && typeof r[k] !== 'string') out.push(`${at}.${k} must be a string`);
  });
  if (rr.checklist === 'coverage' && !rr.roles.some((r) => isObj(r) && r.key === COVERAGE_ROLE.key)) {
    out.push(`roleReview.roles needs a role with key "${COVERAGE_ROLE.key}" for the coverage checklist`);
  }
  return out;
}

/** THE predicate: the node's normalized role-review spec (defaults filled, roles materialised), or null for a node
 *  without one or with an invalid one. `true` (saved manifests, paused runs) reads as LEGACY_ROLE_REVIEW. */
export function roleReviewOf(config) {
  const rr = specOf(config);
  if (rr === true) return { ...LEGACY_ROLE_REVIEW, roles: ROLE_CHECKLISTS[LEGACY_ROLE_REVIEW.checklist].roles() };
  if (!isObj(rr) || roleReviewIssues(config).length) return null;
  const provider = rr.checklist ? ROLE_CHECKLISTS[rr.checklist] : null;
  const roles = rr.roles
    ? rr.roles.map((r) => ({ key: r.key, label: r.label.trim(), ...(r.model ? { model: r.model } : {}), ...(r.effort ? { effort: r.effort } : {}) }))
    : provider.roles();
  return { roles, source: rr.source || 'declared', target: rr.target, ...(rr.checklist ? { checklist: rr.checklist } : {}), sink: rr.sink };
}

/** The spec's checklist provider, or null. */
export const roleChecklistOf = (spec) => (spec?.checklist ? ROLE_CHECKLISTS[spec.checklist] || null : null);

/** The roles that run: every declared role, or (source `picked`) the declared roles the run picked, in DECLARED order.
 *  An empty result falls back to the first declared role. */
export function runningRoles(spec, picked) {
  const roles = Array.isArray(spec?.roles) ? spec.roles : [];
  if (spec?.source !== 'picked') return roles;
  const provider = roleChecklistOf(spec);
  const keys = new Set(provider ? provider.normalizePicked(picked) : (Array.isArray(picked) ? picked.map(String) : []));
  const out = roles.filter((r) => keys.has(r.key));
  return out.length ? out : roles.slice(0, 1);
}

/** The roles one round reviews. Round 1: every running role. Round 2+: drop a role whose last review in the same pass
 *  was clean (no critical/major) and whose checklist, and its report on the plan's items, is fully met/na. */
export function rolesForRound(roles, round, lastRound = null) {
  const list = (Array.isArray(roles) ? roles : []).map((r) => ({ key: r.key, label: r.label || r.key }));
  if (round <= 1 || !lastRound) return list.map((r) => ({ ...r, skip: false }));
  const last = new Map((lastRound.roles || []).map((r) => [r.key, r]));
  return list.map((role) => {
    const r = last.get(role.key);
    const clean = !!r && !(r.findings || []).some(blocks)
      && (r.checklist || []).every((c) => c.status === 'met' || c.status === 'na')
      && (r.planChecklist || []).every((c) => (c.status === 'met' && c.evidence) || c.status === 'na');
    return { ...role, skip: clean };
  });
}

/** One reviewer's raw verdict JSON → the stored role record. Ids are `key-round-n` (`ux-1-2`). Every expected
 *  checklist id gets an entry; one the reviewer left out is `unmet`, so it can never earn a round-2 skip. A finding
 *  keeps its `requirement` only when that id is one of `requirementIds` (the run's agreed ids). */
export function roleRecord(role, round, verdict, expectedIds = [], { requirementIds = [] } = {}) {
  const { key, label } = role;
  const issues = Array.isArray(verdict?.issues) ? verdict.issues : [];
  const findings = issues.filter((i) => SEVERITIES.has(i?.severity)).map((i, n) => ({
    id: `${key}-${round}-${n + 1}`,
    severity: i.severity,
    title: oneLine(i.title),
    section: oneLine(i.section || i.location),
    fix: oneLine(i.fix || i.detail),
    status: 'open',
    ...(typeof i.requirement === 'string' && requirementIds.includes(i.requirement) ? { requirement: i.requirement } : {}),
  }));
  const given = new Map((Array.isArray(verdict?.checklist) ? verdict.checklist : [])
    .filter((c) => expectedIds.includes(String(c?.id)))
    .map((c) => [c.id, { id: c.id, status: STATUSES.has(c.status) ? c.status : 'unmet', evidence: oneLine(c.evidence) }]));
  const checklist = expectedIds.map((id) => given.get(id) || { id, status: 'unmet', evidence: 'no verdict given' });
  return { key, label: label || key, skipped: false, findings, checklist };
}

/** The findings file the sink reads: one section per role, in running order, then (given its path) the
 *  `## Dispositions` contract the sink answers in. */
export function findingsMarkdown(round, planPath, roles, { dispositionsPath, target = 'plan' } = {}) {
  const lines = [`# Role reviews — round ${round}`, '', `${roleTargetOf({ target }).reviewedHead}: ${planPath}`, ''];
  for (const r of roles) {
    lines.push(`## ${r.label}${r.skipped ? ' (skipped: clean last round)' : ''}`, '');
    if (!r.findings.length) lines.push('- No findings.');
    for (const f of r.findings) {
      lines.push(isRequirementConcern(f)
        ? `- **${f.id}** [requirement concern ${f.requirement}] ${f.title} — for the person; leave the plan as it is`
        : `- **${f.id}** [${f.severity}] ${f.section ? `${f.section}: ` : ''}${f.title} — fix: ${f.fix}`);
    }
    for (const c of r.checklist.filter((x) => x.status === 'unmet')) lines.push(`- ${c.id}: unmet — ${c.evidence}`);
    lines.push('');
  }
  if (dispositionsPath) lines.push(withoutConcerns(dispositionsBlock(dispositionsPath), roles));
  return lines.join('\n');
}

/** The dispositions block, told to leave the requirement concerns out: it names the ids to answer, never a concern's. */
function withoutConcerns(block, roles) {
  const all = roles.flatMap((r) => r.findings);
  if (!all.some(isRequirementConcern)) return block;
  const ids = all.filter((f) => !isRequirementConcern(f)).map((f) => `\`${f.id}\``);
  const at = block.lastIndexOf('Dispositions file:');
  return `${block.slice(0, at)}The requirement concerns above are for the person: leave them out. ` +
    `${ids.length ? `Answer only ${ids.join(', ')}.` : 'There is no finding to answer.'}\n\n${block.slice(at)}`;
}

/** The non-skipped roles' critical/major findings as verdict issues (`id: title`, the fix as detail, the section as
 *  location): the ONE mapping of findings to issues. */
export function roleBlockingIssues(roles) {
  return (Array.isArray(roles) ? roles : []).filter((r) => !r.skipped).flatMap((r) => r.findings || [])
    .filter(blocks)
    .map((f) => ({ severity: f.severity, title: `${f.id}: ${f.title}`, detail: f.fix, location: f.section }));
}

/** The verdict a role review routes on itself (a port set with blocking/clean outputs): its blocking findings. */
export function roleRoutingVerdict(roles) {
  const issues = roleBlockingIssues(roles);
  const by = (Array.isArray(roles) ? roles : []).filter((r) => !r.skipped && (r.findings || []).some(blocks))
    .map((r) => r.label || r.key);
  return {
    summary: issues.length ? `Role reviews: ${issues.length} blocking finding(s) from ${by.join(', ')}.` : 'Role reviews: no blocking findings.',
    issues,
  };
}

/** The refiner's ROUTED verdict — this round's critical/major reviewer findings plus the refiner's own
 *  minor/suggestion issues. The refiner's own critical/major issues are returned apart (stored, never routed). */
export function refinerVerdict(round, refinerOwn) {
  const own = Array.isArray(refinerOwn?.issues) ? refinerOwn.issues : [];
  const reviewers = roleBlockingIssues(round?.roles);
  return {
    verdict: { summary: refinerOwn?.summary || '', issues: [...reviewers, ...own.filter((i) => !BLOCKING.has(i?.severity))] },
    refinerIssues: own.filter((i) => BLOCKING.has(i?.severity)),
  };
}

/** The brief of a role with no checklist provider (any workflow's own roles; never Shaper's). */
export function genericRoleBrief(role, target = 'plan') {
  const t = roleTargetOf({ target });
  const verb = t === ROLE_REVIEW_TARGETS.plan ? 'rewrite' : 'fix';
  return `## Your role: ${role.label}\n\n` +
    `You review this ${t.noun} as **${role.label}** only. Find what is wrong; do NOT ${verb} it. ` +
    'You do not see the other roles\' reviews.\n\n' +
    `In the review JSON, every issue carries \`severity\`, \`title\`, \`section\` (${t.sectionHint}) and \`fix\` ` +
    '(one concrete change).\n\n';
}
