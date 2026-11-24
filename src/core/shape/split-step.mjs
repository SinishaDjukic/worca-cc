// src/core/shape/split-step.mjs — Shaper small runs B4, the Split step: the Care plan of the challenge, the objection
// normaliser, the prompt blocks, the challenge loop (its deps injected), the no-plan-approval predicate and the approve
// gate. The orchestrator keeps one call per hook; nothing here reads the flag or spawns.
import { OUTLINE_ROUNDS_MAX, RUN_REQUIREMENTS_MAX, splitBlockers, objectionFeedback } from '../../shared/shape/slices.mjs';
import { requirementRoundPlan } from '../../shared/shape/requirements.mjs';
import { CARE_TABLE, CARE_POSITIONS, CARE_DEFAULT } from '../../shared/shape/feature-record.mjs';
import { perspectiveByKey, CHALLENGER_KEY, CHALLENGER_LABEL } from '../../shared/shape/perspectives.mjs';
import { CRITERION_ID_RE } from '../../shared/review/coverage.mjs';
import { mockMarkers } from '../phases.mjs';
import { roleReviewOf } from '../../shared/graph/role-review-step.mjs';

/** D19: person rounds a refused Split stays revisable for (dev's OUTLINE_ROUNDS_MAX still bounds a passing split). */
export const SPLIT_REFUSED_ROUNDS_MAX = 5;
/** D6: the Challenger is the existing devil's-advocate perspective (its key and label live in perspectives.mjs). */
export { CHALLENGER_KEY, CHALLENGER_LABEL };
const FINDINGS_MAX = 20;
const FIX_MAX = 300;
const SEVERITIES = new Set(['critical', 'major', 'minor', 'suggestion']);
const STATUSES = new Set(['open', 'fixed', 'disputed']);

/** D5: how a Care position challenges the split. `rounds` and `roles` are the requirement review's plan (capped at
 *  OUTLINE_ROUNDS_MAX), `challenger` is the CARE_TABLE row, `runSize` the per-run requirement cap (checkSlices applies it). */
export function splitChallengePlan(position, { picked = [], lead = null } = {}) {
  const pos = CARE_POSITIONS.includes(position) ? position : CARE_DEFAULT.position;
  const p = requirementRoundPlan(pos, { picked, lead });
  const text = CARE_TABLE.find((r) => r.key === 'challenger')?.text?.[pos];
  return {
    rounds: Math.min(p.rounds, OUTLINE_ROUNDS_MAX),
    roles: p.roles.filter((k) => k !== CHALLENGER_KEY),
    challenger: typeof text === 'string' && text !== 'off',
    runSize: RUN_REQUIREMENTS_MAX[pos],
  };
}

const labelOf = (key) => (key === CHALLENGER_KEY ? CHALLENGER_LABEL : perspectiveByKey(key)?.label || key);
const str = (v, max) => (typeof v === 'string' ? v.trim().slice(0, max) : '');

/** D7: one challenge round's file, in the role-review finding shape, one entry per running role (silent ones with no
 *  findings). A role outside the running roles is dropped, the Challenger too when Care leaves it off; at most
 *  FINDINGS_MAX findings in the round. `ok: false` (no objections) for an unreadable file. */
export function normalizeChallenge(raw, { roles = [], challenger = false } = {}) {
  const running = [...roles.filter((k) => k !== CHALLENGER_KEY), ...(challenger ? [CHALLENGER_KEY] : [])];
  const ok = !!raw && typeof raw === 'object' && !Array.isArray(raw) && Array.isArray(raw.roles);
  const given = new Map();
  for (const r of ok ? raw.roles : []) if (r && typeof r.key === 'string' && !given.has(r.key)) given.set(r.key, r);
  let left = FINDINGS_MAX;
  const out = running.map((key) => {
    const findings = [];
    for (const f of Array.isArray(given.get(key)?.findings) ? given.get(key).findings : []) {
      if (left <= 0) break;
      if (!f || typeof f !== 'object') continue;
      const fix = str(f.fix, FIX_MAX);
      if (!fix) continue;
      const status = STATUSES.has(f.status) ? f.status : 'open';
      const reason = str(f.reason, FIX_MAX);
      findings.push({
        id: str(f.id, 40) || `${key}-${findings.length + 1}`,
        severity: SEVERITIES.has(f.severity) ? f.severity : 'minor',
        section: 'split', fix, status,
        ...(status === 'disputed' && reason ? { reason } : {}),
        ids: (Array.isArray(f.ids) ? f.ids : []).filter((id) => typeof id === 'string' && CRITERION_ID_RE.test(id)).slice(0, 12),
      });
      left -= 1;
    }
    return { key, label: labelOf(key), findings };
  });
  return { ok, roles: out };
}

/** The open findings of the challenge's last round, each with its role key and label. */
export function openObjections(challenge) {
  const last = challenge?.rounds?.at?.(-1);
  return (last?.roles || []).flatMap((r) => (r.findings || []).filter((f) => f.status === 'open')
    .map((f) => ({ ...f, role: r.key, label: r.label })));
}

/** D8: the brief of one challenge round (the spawn's promptHints). */
export function challengeBlock({ file, out, requirements = null, round, roles = [], challenger = false, prior = [] }) {
  const named = roles.filter((k) => k !== CHALLENGER_KEY).map(labelOf);
  return '## Challenge the split\n\n'
    + `The Planner cut the agreed requirements into runs. Read the outline at: ${file}\n`
    + (requirements ? `The agreed requirements are at: ${requirements}\n` : '')
    + `\nThis is challenge round ${round}. Do not write a plan and do not change the outline. Review the cut as `
    + `${named.join(', ') || 'the run\'s roles'}${challenger ? ` and as the ${CHALLENGER_LABEL}` : ''}, each on its own: `
    + 'is each run one behaviour a reviewer would want as its own pull request, does each requirement sit in the run '
    + 'that can prove it, and is the order right?\n'
    + (challenger ? `\n${CHALLENGER_LABEL}: ${perspectiveByKey(CHALLENGER_KEY)?.roleRule || ''} Here the main decision is the split itself.\n` : '')
    + (prior.length
      ? '\nThe last round raised these objections. Mark each one `fixed` (the outline now addresses it), `disputed` (with a '
        + 'reason) or `open`, keeping its id:\n' + prior.map((p) => `- ${p.id} (${p.label}): ${p.fix}`).join('\n') + '\n'
      : '')
    + `\nWrite your objections as JSON to: ${out}\n`
    + '{"roles": [{"key": "product", "findings": [{"id": "f1", "severity": "major", "fix": "…", "status": "open", '
    + '"reason": "…", "ids": ["R-po-1"]}]}]}\n'
    + `Use these role keys: ${[...roles.filter((k) => k !== CHALLENGER_KEY), ...(challenger ? [CHALLENGER_KEY] : [])].join(', ')}. `
    + 'A role with no objection lists no findings.\n\n'
    + mockMarkers({ MOCK_SPLIT_CHALLENGE: out }) + '\n\n';
}

/** D9: the open objections as the Planner's revise feedback (shared with the card's question). */
export { objectionFeedback };

/**
 * D10: the challenge loop, once per run, before the first Split ask. `challenge` ({ rounds, refining, done }) is the
 * persisted state and is mutated in place; `spawn(r, prior)` returns a normalizeChallenge result; `resume(feedback)`
 * returns `{ flat, result }` (one Planner refine). Each round with open objections gets exactly one refine.
 * @returns {Promise<{flat: boolean, result: any}>} `result` is the last refine's, or null when none ran
 */
export async function runSplitChallenge({ plan, challenge, spawn, resume, persist, audit = async () => {} }) {
  let result = null;
  if (challenge.done) return { flat: false, result };
  if (challenge.refining) {                     // a pause hit an internal refine: re-run it with its feedback
    const res = await resume(challenge.refining);
    challenge.refining = null; await persist();
    result = res.result;
    if (res.flat) return { flat: true, result };
  }
  for (let r = challenge.rounds.length + 1; r <= plan.rounds; r++) {
    const prior = openObjections(challenge);
    const round = await spawn(r, prior);
    if (!round.ok) await audit(`Split challenge round ${r}: no readable objections file, counted as no objections.`);
    challenge.rounds.push({ round: r, roles: round.ok ? round.roles : [] });
    await persist();
    const open = openObjections(challenge);
    if (!open.length) break;
    challenge.refining = objectionFeedback(open); await persist();
    const res = await resume(challenge.refining);
    challenge.refining = null; await persist();
    result = res.result;
    if (res.flat) return { flat: true, result };
  }
  challenge.done = true; await persist();
  return { flat: false, result };
}

/** D1: slice 1 of a marked run whose Split was approved follows the slice-k plan rule (no ask unless held). */
export function skipsPlanAfterSplit({ smallRuns = false, slice = null, outlineDecided = null } = {}) {
  return smallRuns === true && slice?.index === 1 && outlineDecided === 'approve';
}

/** D12: whether the server's outline plus the edits can be approved under `rules`: every failing (rule, id) of a
 *  `waivable: false` row. Edits that do not apply are the validator's error, not this gate's. */
export const splitApprovable = (outline, edits, rules) => splitBlockers(outline, edits, rules);

/** D19: whether the Split asked at `round` stays revisable: dev's OUTLINE_ROUNDS_MAX, or up to SPLIT_REFUSED_ROUNDS_MAX
 *  while a marked run's split fails a non-waivable rule. */
export function splitRevisable(round, outline, rules = {}) {
  if (round < OUTLINE_ROUNDS_MAX) return true;
  return rules.smallRuns === true && round < SPLIT_REFUSED_ROUNDS_MAX && !splitApprovable(outline, [], rules).ok;
}

/** D12 (defence in depth): the approve branch's re-check; the error the Split is asked again with, or null. */
export function splitApproveError(outline, edits, rules = {}) {
  if (rules.smallRuns !== true) return null;
  const gate = splitApprovable(outline, edits || [], rules);
  if (gate.ok) return null;
  return gate.failing.length ? splitRefusedMessage(gate.failing) : gate.error;
}

/** "The split cannot be approved: ownership R-po-2; coverage R-qa-1. Ask for changes." (rules in check order). */
export function splitRefusedMessage(failing) {
  const byRule = new Map();
  for (const f of failing) byRule.set(f.rule, [...(byRule.get(f.rule) || []), f.id]);
  return `The split cannot be approved: ${[...byRule].map(([rule, ids]) => `${rule} ${ids.join(', ')}`).join('; ')}. Ask for changes.`;
}

/** D14: the count of open objections an approve kept, for the decision round (0 when none were kept). */
export const keptObjections = (payload, fields) => (payload?.openObjections === 'kept' ? fields?.challenge?.open || 0 : 0);

/** What the Split ask adds under the marker: Care, run size, the agreed requirements and the challenge. `agreed` and
 *  `examples` are the requirements file's criteria (coverage.mjs), `roleOf(id)` an id's role label. */
export function splitAskFields({ position = null, picked = [], lead = null, agreed = [], examples = new Map(), roleOf = () => null, challenge = null }) {
  const plan = splitChallengePlan(position, { picked, lead });
  return {
    smallRuns: true, care: position || null, runSize: plan.runSize,
    requirements: requirementRows(agreed, { examples, roleOf }),
    challenge: challengeView(challenge, plan),
  };
}

/** The Split ask's `challenge` (D7, D14): per role, its findings across the rounds (a later round's status wins; an
 *  earlier open finding the last round no longer raises is dropped), `rounds` run and `open` (the question's count). */
export function challengeView(challenge, plan) {
  const rounds = Array.isArray(challenge?.rounds) ? challenge.rounds : [];
  const lastOpen = new Set(openObjections(challenge).map((o) => `${o.role}|${o.id}`));
  const roles = new Map();
  for (const r of rounds) {
    for (const role of r.roles || []) {
      const at = roles.get(role.key) || { key: role.key, label: role.label, byId: new Map() };
      for (const f of role.findings || []) at.byId.set(f.id, f);
      roles.set(role.key, at);
    }
  }
  return {
    roles: [...roles.values()].map(({ key, label, byId }) => ({ key, label,
      findings: [...byId.values()].filter((f) => f.status !== 'open' || lastOpen.has(`${key}|${f.id}`)) })),
    challenger: plan?.challenger === true, rounds: rounds.length, open: lastOpen.size,
  };
}

/** The Split ask's `requirements` rows: id, text, example and the role that raised it. */
export function requirementRows(agreed, { examples = new Map(), roleOf = () => null } = {}) {
  return (agreed || []).map((a) => ({ id: a.id, text: a.text, example: examples.get(a.id) || '', role: roleOf(a.id) || '' }));
}

/** D8: the workflow's plan role-review node (the one whose agent and model a challenge round runs on), or null. */
export function planReviewNode(template) {
  return (template?.nodes || []).find((n) => roleReviewOf(n.config)?.target === 'plan') || null;
}

/** A challenge round's file larger than this is not read: it counts as no objections (audited), like an unreadable one. */
export const CHALLENGE_FILE_MAX_BYTES = 256 * 1024;
