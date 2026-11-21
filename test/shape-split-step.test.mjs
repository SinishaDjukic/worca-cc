import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  splitChallengePlan, normalizeChallenge, challengeBlock, objectionFeedback, runSplitChallenge,
  skipsPlanAfterSplit, splitApprovable, openObjections, SPLIT_REFUSED_ROUNDS_MAX,
} from '../src/core/shape/split-step.mjs';
import { OUTLINE_ROUNDS_MAX } from '../src/shared/shape/slices.mjs';
import { perspectiveByKey } from '../src/shared/shape/perspectives.mjs';

const PICKED = ['product', 'architect', 'qa'];

test('splitChallengePlan: rounds 1/1/3, challenger false/true/true, runSize 3/3/2; unknown is balanced', () => {
  const at = (p) => splitChallengePlan(p, { picked: PICKED, lead: 'security' });
  assert.deepEqual([at('lean'), at('balanced'), at('thorough')].map((p) => [p.rounds, p.challenger, p.runSize]),
    [[1, false, 3], [1, true, 3], [3, true, 2]]);
  assert.deepEqual(at('bogus'), at('balanced'));
  assert.deepEqual(at('lean').roles, ['security', 'product']);
  assert.deepEqual(at('thorough').roles, PICKED);
  assert.ok(at('thorough').rounds <= OUTLINE_ROUNDS_MAX);
  assert.deepEqual(splitChallengePlan('balanced', { picked: ['product', 'devil'] }).roles, ['product'], 'the devil is the Challenger, never a role');
  assert.equal(SPLIT_REFUSED_ROUNDS_MAX, 5);
});

const finding = (o = {}) => ({ severity: 'major', fix: 'Merge runs 1 and 2', status: 'open', ids: ['R-po-1'], ...o });

test('normalizeChallenge: labels, shape, devil only with the Challenger, unknown roles dropped, at most 20, fix capped', () => {
  const raw = { roles: [
    { key: 'product', findings: [finding({ id: 'x1' }), finding({ severity: 'bogus', status: 'weird', fix: 'y'.repeat(400) })] },
    { key: 'devil', findings: [finding()] },
    { key: 'ux', findings: [finding()] },
  ] };
  const on = normalizeChallenge(raw, { roles: ['product', 'qa'], challenger: true });
  assert.equal(on.ok, true);
  assert.deepEqual(on.roles.map((r) => [r.key, r.label, r.findings.length]),
    [['product', 'Product', 2], ['qa', perspectiveByKey('qa').label, 0], ['devil', 'Challenger', 1]]);
  const [a, b] = on.roles[0].findings;
  assert.deepEqual(a, { id: 'x1', severity: 'major', section: 'split', fix: 'Merge runs 1 and 2', status: 'open', ids: ['R-po-1'] });
  assert.equal(b.severity, 'minor');
  assert.equal(b.status, 'open');
  assert.equal(b.fix.length, 300);
  assert.ok(b.id);
  const off = normalizeChallenge(raw, { roles: ['product'], challenger: false });
  assert.deepEqual(off.roles.map((r) => r.key), ['product']);
  const many = { roles: [{ key: 'product', findings: Array.from({ length: 30 }, () => finding()) }] };
  assert.equal(normalizeChallenge(many, { roles: ['product'], challenger: false }).roles[0].findings.length, 20);
  const disputed = normalizeChallenge({ roles: [{ key: 'qa', findings: [finding({ status: 'disputed', reason: 'it is fine' })] }] }, { roles: ['qa'] });
  assert.equal(disputed.roles[0].findings[0].reason, 'it is fine');
  assert.equal(normalizeChallenge(null, { roles: ['qa'] }).ok, false);
  assert.deepEqual(normalizeChallenge(null, { roles: ['qa'] }).roles.map((r) => r.findings.length), [0]);
});

test('challengeBlock names the roles, the Challenger rule, the files and the prior findings; objectionFeedback is one line each', () => {
  const prior = [{ id: 'f1', role: 'product', label: 'Product', fix: 'Merge runs 1 and 2', ids: ['R-po-1'] }];
  const b = challengeBlock({ file: '/p/slices.json', out: '/p/split-challenge-2.json', requirements: '/p/req.md', round: 2,
    roles: ['product', 'qa'], challenger: true, prior });
  for (const s of ['/p/slices.json', '/p/split-challenge-2.json', '/p/req.md', 'Product', 'Challenger', perspectiveByKey('devil').roleRule,
    'f1', 'fixed', 'disputed', 'MOCK_SPLIT_CHALLENGE: /p/split-challenge-2.json']) assert.ok(b.includes(s), s);
  const lean = challengeBlock({ file: 'f', out: 'o', round: 1, roles: ['product'], challenger: false, prior: [] });
  assert.ok(!lean.includes(perspectiveByKey('devil').roleRule));
  assert.ok(!lean.includes('Challenger'));
  const fb = objectionFeedback([...prior, { id: 'f2', label: 'Challenger', fix: 'Too many runs', ids: [] }]);
  assert.equal(fb.split('\n').filter((l) => l.startsWith('- ')).length, 2);
  assert.match(fb, /- Product \(R-po-1\): Merge runs 1 and 2/);
});

/** Fake deps: every spawn returns one open objection unless `quiet` says otherwise. */
function fakes({ quiet = () => false, flatAt = 0, plan, challenge = { rounds: [], refining: null, done: false } } = {}) {
  const calls = [];
  const deps = {
    plan, challenge,
    spawn: async (r, prior) => {
      calls.push(`spawn${r}`);
      if (quiet(r)) return { ok: true, roles: [{ key: 'product', label: 'Product', findings: [] }] };
      return { ok: true, roles: [{ key: 'product', label: 'Product', findings: [{ id: `f${r}`, severity: 'major', section: 'split', fix: `fix ${r}`, status: 'open', ids: [] }] }], prior };
    },
    resume: async (fb) => { calls.push('resume'); return { flat: calls.filter((c) => c === 'resume').length === flatAt, result: { fb } }; },
    persist: async () => { calls.push('persist'); },
    audit: async () => {},
  };
  return { deps, calls, order: () => calls.filter((c) => c !== 'persist') };
}

test('runSplitChallenge: objections every round: one refine after each, per Care', async () => {
  for (const [pos, want] of [['lean', ['spawn1', 'resume']], ['balanced', ['spawn1', 'resume']],
    ['thorough', ['spawn1', 'resume', 'spawn2', 'resume', 'spawn3', 'resume']]]) {
    const f = fakes({ plan: splitChallengePlan(pos, { picked: PICKED }) });
    const out = await runSplitChallenge(f.deps);
    assert.deepEqual(f.order(), want, pos);
    assert.equal(f.deps.challenge.done, true);
    assert.equal(f.deps.challenge.refining, null);
    assert.equal(f.deps.challenge.rounds.length, want.filter((c) => c.startsWith('spawn')).length);
    assert.equal(out.flat, false);
  }
});

test('runSplitChallenge: stops after a quiet spawn, on a flat resume; resumes at round 2; re-runs a persisted refine first', async () => {
  const quiet = fakes({ quiet: (r) => r === 2, plan: splitChallengePlan('thorough', { picked: PICKED }) });
  await runSplitChallenge(quiet.deps);
  assert.deepEqual(quiet.order(), ['spawn1', 'resume', 'spawn2']);
  assert.equal(quiet.deps.challenge.done, true);

  const flat = fakes({ flatAt: 1, plan: splitChallengePlan('thorough', { picked: PICKED }) });
  assert.equal((await runSplitChallenge(flat.deps)).flat, true);
  assert.deepEqual(flat.order(), ['spawn1', 'resume']);

  const r1 = { round: 1, roles: [{ key: 'product', label: 'Product', findings: [] }] };
  const later = fakes({ plan: splitChallengePlan('thorough', { picked: PICKED }), challenge: { rounds: [r1], refining: null, done: false } });
  await runSplitChallenge(later.deps);
  assert.deepEqual(later.order(), ['spawn2', 'resume', 'spawn3', 'resume']);

  const paused = fakes({ plan: splitChallengePlan('thorough', { picked: PICKED }), challenge: { rounds: [r1], refining: '- Product: fix 1', done: false } });
  await runSplitChallenge(paused.deps);
  assert.deepEqual(paused.order(), ['resume', 'spawn2', 'resume', 'spawn3', 'resume']);

  const done = fakes({ plan: splitChallengePlan('thorough', { picked: PICKED }), challenge: { rounds: [r1], refining: null, done: true } });
  await runSplitChallenge(done.deps);
  assert.deepEqual(done.order(), []);
});

test('runSplitChallenge: the next round gets the open findings of the last; an unreadable round is no objection', async () => {
  const f = fakes({ plan: splitChallengePlan('thorough', { picked: PICKED }) });
  const priors = [];
  const spawn = f.deps.spawn;
  f.deps.spawn = async (r, prior) => { priors.push(prior.map((p) => p.id)); return spawn(r, prior); };
  await runSplitChallenge(f.deps);
  assert.deepEqual(priors, [[], ['f1'], ['f2']]);
  const audits = [];
  const bad = fakes({ plan: splitChallengePlan('balanced', { picked: PICKED }) });
  bad.deps.spawn = async () => ({ ok: false, roles: [] });
  bad.deps.audit = async (t) => { audits.push(t); };
  await runSplitChallenge(bad.deps);
  assert.equal(bad.deps.challenge.rounds.length, 1);
  assert.equal(audits.length, 1);
  assert.deepEqual(openObjections(bad.deps.challenge), []);
});

test('openObjections: the last round\'s open findings, labelled', () => {
  const c = { rounds: [
    { round: 1, roles: [{ key: 'qa', label: 'QA', findings: [finding({ id: 'a' })] }] },
    { round: 2, roles: [{ key: 'qa', label: 'QA', findings: [finding({ id: 'b' }), finding({ id: 'c', status: 'fixed' })] }] },
  ] };
  assert.deepEqual(openObjections(c).map((o) => [o.id, o.role, o.label]), [['b', 'qa', 'QA']]);
  assert.deepEqual(openObjections(null), []);
});

test('skipsPlanAfterSplit: only a marked run\'s slice 1 after an approved Split', () => {
  assert.equal(skipsPlanAfterSplit({ smallRuns: true, slice: { index: 1 }, outlineDecided: 'approve' }), true);
  assert.equal(skipsPlanAfterSplit({ smallRuns: false, slice: { index: 1 }, outlineDecided: 'approve' }), false);
  assert.equal(skipsPlanAfterSplit({ smallRuns: true, slice: { index: 1 }, outlineDecided: 'flat' }), false);
  assert.equal(skipsPlanAfterSplit({ smallRuns: true, slice: null, outlineDecided: null }), false);
  assert.equal(skipsPlanAfterSplit({ smallRuns: true, slice: { index: 2 }, outlineDecided: null }), false);
});

const sl = (id, requirements, o = {}) => ({ id, title: `Run ${id}`, goal: 'g', inScope: [], outOfScope: [], acceptance: ['GET /x returns 200'],
  dependsOn: [], estimate: 'medium', requirements, ...o });
const AGREED = ['R-po-1', 'R-po-2', 'R-qa-1', 'R-sec-1'].map((id) => ({ id, text: id }));

test('splitApprovable: every failing (rule, id) of a non-waivable row; dev rules always approvable', () => {
  const ok = { why: 'w', slices: [sl('s1', ['R-po-1', 'R-po-2']), sl('s2', ['R-qa-1'])], agreed: AGREED, leftOut: [],
    confirmed: [{ id: 'R-sec-1', role: 'Security' }] };
  const rules = { smallRuns: true, care: 'balanced' };
  assert.deepEqual(splitApprovable(ok, [], rules), { ok: true, failing: [] });
  const bad = { ...ok, slices: [sl('s1', ['R-po-1', 'R-po-2']), sl('s2', ['R-po-2'])], confirmed: [{ id: 'R-sec-1', role: 'Legal' }] };
  assert.deepEqual(splitApprovable(bad, [], rules).failing.map((f) => [f.rule, f.id]),
    [['ownership', 'R-po-2'], ['coverage', 'R-qa-1'], ['confirmRole', 'R-sec-1']]);
  assert.equal(splitApprovable(bad, [{ op: 'confirm', id: 'R-sec-1', role: 'Security' }], rules).failing.length, 2);
  assert.deepEqual(splitApprovable(ok, [{ op: 'remove', id: 's2' }], rules).failing.map((f) => [f.rule, f.id]), [['coverage', 'R-qa-1']]);
  assert.equal(splitApprovable(bad, [], {}).ok, true);
});

test('fit-1-2: the orchestrator\'s one-line Split hooks (splitRevisable, splitApproveError, keptObjections, splitAskFields)', async () => {
  const { splitRevisable, splitApproveError, keptObjections, splitAskFields } = await import('../src/core/shape/split-step.mjs');
  const ok = { why: 'w', slices: [sl('s1', ['R-po-1', 'R-po-2']), sl('s2', ['R-qa-1'])], agreed: AGREED, leftOut: [],
    confirmed: [{ id: 'R-sec-1', role: 'Security' }] };
  const bad = { ...ok, confirmed: [{ id: 'R-sec-1', role: 'Legal' }] };
  const rules = { smallRuns: true, care: 'balanced' };
  // D19: dev's bound for a passing split and for dev rules; a refused marked split stays revisable up to round 4
  assert.deepEqual([1, 2, 3].map((r) => splitRevisable(r, ok, rules)), [true, true, false]);
  assert.deepEqual([3, 4, 5].map((r) => splitRevisable(r, bad, rules)), [true, true, false]);
  assert.equal(splitRevisable(3, bad, {}), false);
  // D12: the approve branch's re-check
  assert.equal(splitApproveError(ok, [], rules), null);
  assert.equal(splitApproveError(bad, [], {}), null, 'dev rules never refuse');
  assert.equal(splitApproveError(bad, [], rules), 'The split cannot be approved: confirmRole R-sec-1. Ask for changes.');
  assert.equal(splitApproveError(bad, [{ op: 'confirm', id: 'R-sec-1', role: 'Security' }], rules), null);
  assert.match(splitApproveError(ok, [{ op: 'merge', id: 'nope' }], rules), /nope/);
  // D14: the kept count only for a kept approve
  const fields = { challenge: { open: 2 } };
  assert.equal(keptObjections({ decision: 'approve', openObjections: 'kept' }, fields), 2);
  assert.equal(keptObjections({ decision: 'approve' }, fields), 0);
  assert.equal(keptObjections({ decision: 'approve', openObjections: 'kept' }, null), 0);
  // the ask's fields: Care, run size, rows with example and role, the challenge view
  const f = splitAskFields({ position: 'thorough', picked: PICKED, agreed: [{ id: 'R-po-1', text: 'One' }],
    examples: new Map([['R-po-1', 'ex']]), roleOf: () => 'Product', challenge: null });
  assert.deepEqual(f, { smallRuns: true, care: 'thorough', runSize: 2,
    requirements: [{ id: 'R-po-1', text: 'One', example: 'ex', role: 'Product' }],
    challenge: { roles: [], challenger: true, rounds: 0, open: 0 } });
});

test('challengeView: findings across rounds, later status wins, stale open dropped; requirementRows', async () => {
  const { challengeView, requirementRows } = await import('../src/core/shape/split-step.mjs');
  const c = { rounds: [
    { round: 1, roles: [{ key: 'qa', label: 'QA', findings: [finding({ id: 'a' }), finding({ id: 'b' })] }] },
    { round: 2, roles: [{ key: 'qa', label: 'QA', findings: [finding({ id: 'a', status: 'fixed' }), finding({ id: 'c' })] },
      { key: 'devil', label: 'Challenger', findings: [] }] },
  ] };
  const v = challengeView(c, { challenger: true });
  assert.deepEqual(v.roles.map((r) => [r.key, r.findings.map((f) => `${f.id}:${f.status}`)]), [['qa', ['a:fixed', 'c:open']], ['devil', []]]);
  assert.deepEqual([v.rounds, v.open, v.challenger], [2, 1, true]);
  assert.deepEqual(challengeView(null, null), { roles: [], challenger: false, rounds: 0, open: 0 });
  assert.deepEqual(requirementRows([{ id: 'R-po-1', text: 't' }], { examples: new Map([['R-po-1', 'e']]), roleOf: () => 'Product' }),
    [{ id: 'R-po-1', text: 't', example: 'e', role: 'Product' }]);
});

test('planReviewNode: the plan role-review node, or null', async () => {
  const { planReviewNode } = await import('../src/core/shape/split-step.mjs');
  const { GRAPH_SHAPE_REQ_WORKFLOW } = await import('../src/core/graph/builtin-workflows.mjs');
  assert.equal(planReviewNode(GRAPH_SHAPE_REQ_WORKFLOW).id, 'n_roles');
  assert.equal(planReviewNode({ nodes: [{ id: 'x', config: {} }] }), null);
  assert.equal(planReviewNode(null), null);
});
