// src/shared/shape/role-review.mjs — role reviews (spec §3): one planReviewer per picked perspective.
// Pure and browser-safe: the orchestrator, the executor's prompt and (slice 4) the Plan step card import it.
import { perspectiveByKey, normalizePerspectives, FIT_KEY } from './perspectives.mjs';
import { extractChecklist } from './checklist.mjs';

export const ROLE_REVIEW_MAX_ROUNDS = 2;
const BLOCKING = new Set(['critical', 'major']);
const SEVERITIES = new Set(['critical', 'major', 'minor', 'suggestion']);
const STATUSES = new Set(['met', 'unmet', 'na']);
const oneLine = (v) => String(v ?? '').replace(/\s+/g, ' ').trim();

/** The slice task id for one role; the executor prefixes that role's files with it. */
export const roleTaskId = (key) => `role-${key}`;

/** This role's checklist items in the plan, `[{ id, perspective, text }]`. */
export const roleItems = (key, planMarkdown) => extractChecklist(planMarkdown || '').filter((i) => i.perspective === key);

/** The roles one round reviews. Round 1: every picked perspective. Round 2+: drop a role whose last review in the
 *  same pass was clean (no critical/major) and whose checklist is fully met/na (spec §3 "Cost"). */
export function rolesForRound(perspectives, round, lastRound = null) {
  const n = normalizePerspectives(perspectives);
  const keys = n.ok ? n.perspectives : ['product'];
  if (round <= 1 || !lastRound) return keys.map((key) => ({ key, skip: false }));
  const last = new Map((lastRound.roles || []).map((r) => [r.key, r]));
  return keys.map((key) => {
    const r = last.get(key);
    const clean = !!r && !(r.findings || []).some((f) => BLOCKING.has(f.severity))
      && (r.checklist || []).every((c) => c.status === 'met' || c.status === 'na');
    return { key, skip: clean };
  });
}

/** The role brief for one reviewer prompt: this role only (spec §3 "Each reviewer gets"). */
export function roleBriefBlock(key, planMarkdown) {
  const p = perspectiveByKey(key);
  if (!p) return '';
  const items = roleItems(key, planMarkdown);
  const rule = p.checklist
    ? `Your checklist prefix is \`R-${p.checklist}\` (${p.checklistHint}).`
    : 'Your role has no checklist: judge "Problem and goal" and "Out of scope".';
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

/** One reviewer's raw verdict JSON → the stored role record. Ids are `role-round-n` (`ux-1-2`). Every expected
 *  checklist id gets an entry; one the reviewer left out is `unmet`, so it can never earn a round-2 skip. */
export function roleRecord(key, round, verdict, expectedIds = []) {
  const issues = Array.isArray(verdict?.issues) ? verdict.issues : [];
  const findings = issues.filter((i) => SEVERITIES.has(i?.severity)).map((i, n) => ({
    id: `${key}-${round}-${n + 1}`,
    severity: i.severity,
    title: oneLine(i.title),
    section: oneLine(i.section || i.location),
    fix: oneLine(i.fix || i.detail),
    status: 'open',
  }));
  const given = new Map((Array.isArray(verdict?.checklist) ? verdict.checklist : [])
    .filter((c) => expectedIds.includes(String(c?.id)))
    .map((c) => [c.id, { id: c.id, status: STATUSES.has(c.status) ? c.status : 'unmet', evidence: oneLine(c.evidence) }]));
  const checklist = expectedIds.map((id) => given.get(id) || { id, status: 'unmet', evidence: 'no verdict given' });
  return { key, label: perspectiveByKey(key)?.label || key, skipped: false, findings, checklist };
}

/** The findings file the refiner reads: one section per role, in perspective order. */
export function findingsMarkdown(round, planPath, roles) {
  const lines = [`# Role reviews — round ${round}`, '', `Plan reviewed: ${planPath}`, ''];
  for (const r of roles) {
    lines.push(`## ${r.label}${r.skipped ? ' (skipped: clean last round)' : ''}`, '');
    if (!r.findings.length) lines.push('- No findings.');
    for (const f of r.findings) lines.push(`- **${f.id}** [${f.severity}] ${f.section ? `${f.section}: ` : ''}${f.title} — fix: ${f.fix}`);
    for (const c of r.checklist.filter((x) => x.status === 'unmet')) lines.push(`- ${c.id}: unmet — ${c.evidence}`);
    lines.push('');
  }
  return lines.join('\n');
}

/** Spec §3 "Loop": the refiner's ROUTED verdict — this round's critical/major reviewer findings plus the refiner's own
 *  minor/suggestion issues. The refiner's own critical/major issues are returned apart (stored, never routed). */
export function refinerVerdict(round, refinerOwn) {
  const own = Array.isArray(refinerOwn?.issues) ? refinerOwn.issues : [];
  const reviewers = (round?.roles || []).filter((r) => !r.skipped).flatMap((r) => r.findings)
    .filter((f) => BLOCKING.has(f.severity))
    .map((f) => ({ severity: f.severity, title: `${f.id}: ${f.title}`, detail: f.fix, location: f.section }));
  return {
    verdict: { summary: refinerOwn?.summary || '', issues: [...reviewers, ...own.filter((i) => !BLOCKING.has(i?.severity))] },
    refinerIssues: own.filter((i) => BLOCKING.has(i?.severity)),
  };
}

/** Mark the round's findings fixed/open from the refiner's `addressed` list (mutates and returns the round). */
export function applyAddressed(round, addressed, planVersion) {
  const done = new Set(Array.isArray(addressed) ? addressed.map(String) : []);
  for (const r of round.roles) {
    if (r.skipped) continue;
    for (const f of r.findings) {
      if (done.has(f.id)) { f.status = 'fixed'; f.fixedIn = planVersion; } else f.status = 'open';
    }
  }
  return round;
}

/** Open critical/major findings after the last round (slice 4's "Approve with N open issues"). */
export function openBlocking(roleReviews) {
  const last = roleReviews?.rounds?.at(-1);
  return last ? last.roles.flatMap((r) => r.findings).filter((f) => f.status === 'open' && BLOCKING.has(f.severity)).length : 0;
}

const SEV_ORDER = ['critical', 'major', 'minor', 'suggestion'];

/** The rounds of the latest pass (an "Ask for changes" opens a new pass): what the Plan step card describes. */
export function currentPass(roleReviews) {
  const rounds = Array.isArray(roleReviews?.rounds) ? roleReviews.rounds : [];
  if (!rounds.length) return null;
  const pass = rounds.at(-1).pass;
  return { rounds: rounds.filter((r) => r.pass === pass) };
}

function countText(findings) {
  if (!findings.length) return 'no findings';
  const part = (open) => {
    const n = SEV_ORDER.map((s) => [s, findings.filter((f) => f.severity === s && (f.status === 'open') === open).length])
      .filter(([, k]) => k);
    return n.length ? `${n.map(([s, k]) => `${k} ${s}`).join(', ')} ${open ? 'open' : 'fixed'}` : '';
  };
  return [part(true), part(false)].filter(Boolean).join(' · ');
}

/** Slice 4: one entry per role of the last round: its earlier fixed findings plus its last record, once each by id. */
export function roleSummaries(roleReviews) {
  const rounds = currentPass(roleReviews)?.rounds || [];
  const last = rounds.at(-1);
  if (!last) return [];
  return last.roles.map((rec) => {
    const seen = new Set();
    const findings = [];
    const add = (f) => { if (f && !seen.has(f.id)) { seen.add(f.id); findings.push(f); } };
    for (const r of rounds.slice(0, -1)) {
      for (const f of r.roles.find((x) => x.key === rec.key)?.findings || []) if (f.status === 'fixed') add(f);
    }
    for (const f of rec.findings || []) add(f);
    findings.sort((a, b) => SEV_ORDER.indexOf(a.severity) - SEV_ORDER.indexOf(b.severity));
    const open = findings.filter((f) => f.status === 'open' && BLOCKING.has(f.severity)).length;
    return { key: rec.key, label: rec.label, findings, open, text: `${rec.label} · ${countText(findings)}` };
  });
}

/** "Reviewed by 5 roles · 1 open" — the card's folded line; '' without a review. */
export function reviewedLine(roleReviews) {
  const n = currentPass(roleReviews)?.rounds.at(-1)?.roles.length || 0;
  if (!n) return '';
  const open = openBlocking(roleReviews);
  return `Reviewed by ${n} role${n === 1 ? '' : 's'}${open ? ` · ${open} open` : ''}`;
}

const TERMINAL = new Set(['done', 'error', 'stopped', 'paused']);
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
 * `stage` is runProgress's stage; outside 'plan' the Plan step card owns the per-role rows, so this returns null.
 * @returns {{rows:Array<{key:string,label:string,state:string,live:boolean}>, refine:string}|null}
 */
export function liveRoleRows(run, { stage = null } = {}) {
  const r = run || {};
  const fact = r.progressFacts && r.progressFacts.roleReview;
  if (!fact || !fact.nodeId || stage !== 'plan' || ['done', 'error', 'stopped'].includes(String(r.status || ''))) return null;
  const steps = Array.isArray(r.steps) ? r.steps : [];
  const ended = (exec) => steps.some((s) => s && s.executionId === exec && TERMINAL.has(s.status));
  const active = (Array.isArray(r.active) ? r.active : []).filter((a) => a && a.nodeId && !ended(a.executionId));
  const roleExec = (active.find((a) => a.nodeId === fact.nodeId) || {}).executionId || null;
  const rounds = Array.isArray(r.roleReviews && r.roleReviews.rounds) ? r.roleReviews.rounds : [];
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
      return { rows: [], refine: `Refine · fixing ${n} finding${n === 1 ? '' : 's'} from ${joinLabels([...new Set(openBy)])}` };
    }
    return { rows: record.roles.map((x) => ({ key: x.key, label: x.label || label(x.key),
      state: x.skipped ? 'skipped: nothing open' : worstText(x.findings), live: false })), refine: '' };
  }
  // This round's role rows only: a slice row's parentExecutionId is the active role node's execution.
  const mineRows = steps.filter((s) => s && s.parentExecutionId === roleExec && /^role-[\w-]+$/.test(String(s.taskId || '')));
  const mine = (key) => mineRows.findLast((s) => s.taskId === roleTaskId(key)) || null;
  const prev = rounds.filter((x) => x.round < fact.round).at(-1) || null;
  const picked = r.shaping && Array.isArray(r.shaping.perspectives) ? r.shaping.perspectives : null;
  const keys = picked
    ? rolesForRound(picked, Number(fact.round) || 1, prev)
    : [...new Set(mineRows.map((s) => String(s.taskId).slice('role-'.length)))].map((key) => ({ key, skip: false }));
  const rows = keys.map(({ key, skip }) => {
    if (skip) return { key, label: label(key), state: 'skipped: nothing open', live: false };
    const s = mine(key);
    if (!s || !TERMINAL.has(s.status)) return { key, label: label(key), state: 'reviewing', live: !!s };
    return { key, label: label(key), state: 'reviewed', live: false };
  });
  return rows.length ? { rows, refine: '' } : null;
}
