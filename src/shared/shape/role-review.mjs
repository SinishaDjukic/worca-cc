// src/shared/shape/role-review.mjs — role reviews (spec §3): one planReviewer per picked perspective.
// Pure and browser-safe: the orchestrator, the executor's prompt and (slice 4) the Plan step card import it.
import { PERSPECTIVES, DEFAULT_PERSPECTIVES, perspectiveByKey, normalizePerspectives, FIT_KEY } from './perspectives.mjs';
import { extractChecklist } from './checklist.mjs';
import { rolesForRound as engineRolesForRound, roleRecord as engineRoleRecord, roleTaskId } from '../graph/role-review-step.mjs';
import { roleCounts } from '../review/findings.mjs';

// The generic round logic lives in the engine step (src/shared/graph/role-review-step.mjs); re-exported here for the
// current importers.
export { findingsMarkdown, refinerVerdict, applyAddressed, roleTaskId } from '../graph/role-review-step.mjs';

export const ROLE_REVIEW_MAX_ROUNDS = 2;
const BLOCKING = new Set(['critical', 'major']);
const oneLine = (v) => String(v ?? '').replace(/\s+/g, ' ').trim();

const asRole = (key) => ({ key, label: perspectiveByKey(key)?.label || key });


/** This role's checklist items in the plan, `[{ id, perspective, text }]`. */
export const roleItems = (key, planMarkdown) => extractChecklist(planMarkdown || '').filter((i) => i.perspective === key);

/** The roles one round reviews, by perspective key (the engine's rolesForRound over Shaper's picked perspectives).
 *  Round 1: every picked perspective. Round 2+: drop a clean, fully met role (spec §3 "Cost"). */
export function rolesForRound(perspectives, round, lastRound = null) {
  const n = normalizePerspectives(perspectives);
  const keys = n.ok ? n.perspectives : ['product'];
  return engineRolesForRound(keys.map(asRole), round, lastRound).map(({ key, skip }) => ({ key, skip }));
}

/** The role brief for one reviewer prompt: this role only (spec §3 "Each reviewer gets"). */
export function roleBriefBlock(key, planMarkdown) {
  const p = perspectiveByKey(key);
  if (!p) return '';
  const items = roleItems(key, planMarkdown);
  const rule = p.roleRule || (p.checklist
    ? `Your checklist prefix is \`R-${p.checklist}\` (${p.checklistHint}).`
    : 'Your role has no checklist: judge "Problem and goal" and "Out of scope".');
  return `## Your role: ${p.label}\n\n` +
    `You review this plan as **${p.label}** only. ${p.help} ${rule}\n\n` +
    (p.rules
      ? 'Judge the plan by these rules:\n\n' + p.rules.map((r, i) => `- \`R-${p.checklist}-${i + 1}\` ${r}`).join('\n') + '\n\n'
      : '') +
    'Find what is wrong; do NOT rewrite the plan. You do not see the other roles\' reviews.\n\n' +
    (items.length
      ? 'Give a verdict on each of these plan items:\n\n' + items.map((i) => `- \`${i.id}\`: ${oneLine(i.text)}`).join('\n') + '\n\n'
      : '') +
    'In the review JSON, every issue carries `severity`, `title`, `section` (the plan section) and `fix` ' +
    '(one concrete change). Add `"checklist": [{ "id": "R-…", "status": "met" | "unmet" | "na", "evidence": "…" }]`, ' +
    'one entry per item above.\n\n';
}

/** The house brief for the Project fit reviewer ONLY (slice 3): '' for every other role, so no other prompt changes. */
export function houseBriefBlock(key, brief) {
  if (key !== FIT_KEY) return '';
  const text = String(brief || '').trim();
  return '## Project fit: the house brief\n\n' + (text
    ? 'Judge every `R-fit` item against this brief. When the plan adds a part the brief already lists, name that ' +
      'existing repo path in the finding\'s `title` and `fix`.\n\n' + text + '\n\n'
    : 'This project has no house brief yet: judge the `R-fit` items against the codebase alone.\n\n');
}

/** One reviewer's raw verdict JSON → the stored role record, by perspective key (the engine's roleRecord). */
export function roleRecord(key, round, verdict, expectedIds = []) {
  return engineRoleRecord(asRole(key), round, verdict, expectedIds);
}

/** Shaper's checklist provider for the engine's role-review step (`checklist: 'perspectives'`): the perspectives as
 *  roles, the run's picked list normalised, each role's R-items, its brief and the house brief for Project fit. */
export const PERSPECTIVE_ROLE_CHECKLIST = Object.freeze({
  roles: () => PERSPECTIVES.map(({ key, label }) => ({ key, label })),
  normalizePicked(raw) {
    if (raw === null || raw === undefined) return [...DEFAULT_PERSPECTIVES];
    const n = normalizePerspectives(raw);
    return n.ok ? n.perspectives : ['product'];
  },
  items: (key, planText) => roleItems(key, planText).map((i) => i.id),
  brief: (key, planText, { houseBrief } = {}) => roleBriefBlock(key, planText) + houseBriefBlock(key, houseBrief),
  wantsHouseBrief: (key) => key === FIT_KEY,
});

/** Open critical/major findings after the last round (slice 4's "Approve with N open issues"). `scope` as currentPass. */
export function openBlocking(roleReviews, scope = {}) {
  const last = currentPass(roleReviews, scope)?.rounds.at(-1);
  return last ? last.roles.flatMap((r) => r.findings).filter((f) => f.status === 'open' && BLOCKING.has(f.severity)).length : 0;
}

const SEV_ORDER = ['critical', 'major', 'minor', 'suggestion'];

/** The rounds of the latest pass (an "Ask for changes" opens a new pass): what the Plan step card describes. Plan rounds
 *  and code rounds share the list: `node` keeps one node's rounds, else `target` (default the plan) keeps that target's;
 *  a round saved before rounds named their target is a plan round. */
export function currentPass(roleReviews, { target = 'plan', node } = {}) {
  const all = Array.isArray(roleReviews?.rounds) ? roleReviews.rounds : [];
  const rounds = all.filter((r) => (node !== undefined ? r.node === node : (r.target ?? 'plan') === target));
  if (!rounds.length) return null;
  const pass = rounds.at(-1).pass;
  return { rounds: rounds.filter((r) => r.pass === pass) };
}

/** A run question with the role reviews its step card reads, attached in place: a plan ask (not an outline) gets the
 *  current plan pass on `plan.roleReviews` (D1), a gate gets its node's current pass on `roleReviews` (D8). */
export function attachRoleReviews(event, roleReviews) {
  if (event?.kind === 'plan' && event.plan && !event.plan.outline) {
    const rr = currentPass(roleReviews);
    if (rr) event.plan = { ...event.plan, roleReviews: rr };
  } else if (event?.kind === 'gate' && event.nodeId) {
    const rr = currentPass(roleReviews, { node: event.nodeId });
    if (rr) event.roleReviews = rr;
  }
  return event;
}

/** "2 fixed · 1 disputed · 1 open", zero parts left out; "no findings" when nothing was raised (D10). */
export function countsText(counts) {
  if (!counts?.raised) return 'no findings';
  return ['fixed', 'disputed', 'open'].filter((k) => counts[k]).map((k) => `${counts[k]} ${k}`).join(' · ');
}

/** Slice 4: one entry per role of the last round: its earlier fixed and disputed findings plus its last record, once
 *  each by id. `counts` are over exactly those findings (what the row's Show lists). */
export function roleSummaries(roleReviews, scope = {}) {
  const rounds = currentPass(roleReviews, scope)?.rounds || [];
  const last = rounds.at(-1);
  if (!last) return [];
  return last.roles.map((rec) => {
    const seen = new Set();
    const findings = [];
    const add = (f) => { if (f && !seen.has(f.id)) { seen.add(f.id); findings.push(f); } };
    for (const r of rounds.slice(0, -1)) {
      for (const f of r.roles.find((x) => x.key === rec.key)?.findings || []) if (f.status === 'fixed' || f.status === 'disputed') add(f);
    }
    for (const f of rec.findings || []) add(f);
    findings.sort((a, b) => SEV_ORDER.indexOf(a.severity) - SEV_ORDER.indexOf(b.severity));
    const open = findings.filter((f) => f.status === 'open' && BLOCKING.has(f.severity)).length;
    const counts = roleCounts({ findings });
    return { key: rec.key, label: rec.label, findings, open, counts, text: `${rec.label} · ${countsText(counts)}` };
  });
}

/** "Reviewed by 5 roles · 1 open" — the card's folded line; '' without a review. */
export function reviewedLine(roleReviews, scope = {}) {
  const n = currentPass(roleReviews, scope)?.rounds.at(-1)?.roles.length || 0;
  if (!n) return '';
  const open = openBlocking(roleReviews, scope);
  return `Reviewed by ${n} role${n === 1 ? '' : 's'}${open ? ` · ${open} open` : ''}`;
}

const TERMINAL = new Set(['done', 'error', 'stopped', 'paused']);
/** The run-progress stages whose role reviews show live rows: Plan (the plan roles) and Review (the code roles). */
export const LIVE_ROLE_STAGES = Object.freeze(['plan', 'review']);
const joinLabels = (xs) => (xs.length < 2 ? xs.join('') : `${xs.slice(0, -1).join(', ')} and ${xs.at(-1)}`);

/** "no findings" or the worst severity with its count ("1 major"), spec §4a live rows. */
export function worstText(findings) {
  const list = Array.isArray(findings) ? findings : [];
  if (!list.length) return 'no findings';
  const worst = SEV_ORDER.find((s) => list.some((f) => f.severity === s));
  return worst ? `${list.filter((f) => f.severity === worst).length} ${worst}` : 'no findings';
}

/**
 * Spec §4a "who is challenging, live": rows while a role-review round runs, its record's rows until Plan ends, or the
 * Refine line while blocking findings are being fixed. Reads only existing state: progressFacts.roleReview
 * {nodeId, round}, the ledger (steps), active [{nodeId, executionId}], roleReviews.rounds, shaping.perspectives.
 * `stage` is runProgress's stage: rows at the stages in LIVE_ROLE_STAGES, null elsewhere. Only the fact's node's rounds
 * count (a round saved before rounds named their node is a plan round); the run's picked perspectives are the Plan's roles.
 * @returns {{rows:Array<{key:string,label:string,state:string,live:boolean}>, refine:string}|null}
 */
export function liveRoleRows(run, { stage = null } = {}) {
  const r = run || {};
  const fact = r.progressFacts && r.progressFacts.roleReview;
  if (!fact || !fact.nodeId || !LIVE_ROLE_STAGES.includes(stage) || ['done', 'error', 'stopped'].includes(String(r.status || ''))) return null;
  const steps = Array.isArray(r.steps) ? r.steps : [];
  const ended = (exec) => steps.some((s) => s && s.executionId === exec && TERMINAL.has(s.status));
  const active = (Array.isArray(r.active) ? r.active : []).filter((a) => a && a.nodeId && !ended(a.executionId));
  const roleExec = (active.find((a) => a.nodeId === fact.nodeId) || {}).executionId || null;
  const rounds = (Array.isArray(r.roleReviews && r.roleReviews.rounds) ? r.roleReviews.rounds : [])
    .filter((x) => (x.node === undefined ? stage === 'plan' : x.node === fact.nodeId));
  const lastRec = rounds.at(-1) || null;
  const record = lastRec && lastRec.round === fact.round ? lastRec : null;
  const label = (key) => (perspectiveByKey(key) && perspectiveByKey(key).label) || key;
  if (!roleExec) {
    if (!record) return null;
    // A skipped role carries the previous round's findings, so the Refine count reads only the roles reviewed now.
    const openBy = record.roles.filter((x) => !x.skipped).flatMap((x) => (x.findings || [])
      .filter((f) => f.status === 'open' && BLOCKING.has(f.severity)).map(() => x.label || label(x.key)));
    if (openBy.length && active.length > 0) {
      const n = openBy.length;
      return { rows: [], refine: `Fixing ${n} finding${n === 1 ? '' : 's'} from ${joinLabels([...new Set(openBy)])}` };
    }
    return { rows: record.roles.map((x) => ({ key: x.key, label: x.label || label(x.key),
      state: x.skipped ? 'skipped: nothing open' : worstText(x.findings), live: false })), refine: '' };
  }
  // This round's role rows only: a slice row's parentExecutionId is the active role node's execution.
  const mineRows = steps.filter((s) => s && s.parentExecutionId === roleExec && /^role-[\w-]+$/.test(String(s.taskId || '')));
  const mine = (key) => mineRows.findLast((s) => s.taskId === roleTaskId(key)) || null;
  const prev = rounds.filter((x) => x.round < fact.round).at(-1) || null;
  const picked = stage === 'plan' && r.shaping && Array.isArray(r.shaping.perspectives) ? r.shaping.perspectives : null;
  const keys = picked
    ? rolesForRound(picked, Number(fact.round) || 1, prev)
    : prev
      ? engineRolesForRound(prev.roles, Number(fact.round) || 1, prev).map(({ key, skip }) => ({ key, skip }))
      : [...new Set(mineRows.map((s) => String(s.taskId).slice('role-'.length)))].map((key) => ({ key, skip: false }));
  // A slice row is titled by its role's label; a skipped role's comes from its last record.
  const named = (key) => (mine(key) && mine(key).title) || ((prev && prev.roles.find((x) => x.key === key)) || {}).label || label(key);
  const rows = keys.map(({ key, skip }) => {
    if (skip) return { key, label: named(key), state: 'skipped: nothing open', live: false };
    const s = mine(key);
    if (!s || !TERMINAL.has(s.status)) return { key, label: named(key), state: 'reviewing', live: !!s };
    return { key, label: named(key), state: 'reviewed', live: false };
  });
  return rows.length ? { rows, refine: '' } : null;
}
