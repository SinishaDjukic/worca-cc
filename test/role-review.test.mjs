import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { rolesForRound, roleBriefBlock, houseBriefBlock, roleItems, openBlocking,
  currentPass, roleSummaries, reviewedLine, liveRoleRows, worstText, countsText, attachRoleReviews }
  from '../src/shared/shape/role-review.mjs';
import { findingsMarkdown, refinerVerdict, roleRecord } from '../src/shared/graph/role-review-step.mjs';
import { applyDispositions } from '../src/shared/review/findings.mjs';
import { perspectiveByKey } from '../src/shared/shape/perspectives.mjs';

/** One reviewer's record by perspective key, through the engine's roleRecord. */
const rec = (key, round, verdict, ids) => roleRecord({ key, label: perspectiveByKey(key)?.label || key }, round, verdict, ids);

// A recorded Shaper plan (real data): the 18 Oct "Shaper as chat cards" plan v2, copied verbatim.
const PLAN = readFileSync(new URL('./fixtures/role-review/recorded-plan.md', import.meta.url), 'utf8');

test('roleBriefBlock: the UX brief carries every R-ux item and no other role\'s', () => {
  const ux = roleBriefBlock('ux', PLAN);
  assert.match(ux, /## Your role: UX/);
  for (let n = 1; n <= 8; n += 1) assert.match(ux, new RegExp(`\`R-ux-${n}\``));
  assert.doesNotMatch(ux, /R-qa-|R-arch-|## Your role: QA/);
  assert.match(roleBriefBlock('product', PLAN), /judge "Problem and goal" and "Out of scope"/);
});

test('roleRecord: a checklist id the reviewer left out is unmet', () => {
  const r = rec('qa', 1, { issues: [], checklist: [{ id: 'R-qa-1', status: 'met' }, { id: 'R-ux-1', status: 'met' }] },
    ['R-qa-1', 'R-qa-2']);
  assert.deepEqual(r.checklist.map((c) => [c.id, c.status]), [['R-qa-1', 'met'], ['R-qa-2', 'unmet']]);
});

test('rolesForRound: round 2 skips a clean, fully met role and keeps a blocked one', () => {
  const last = { roles: [
    rec('qa', 1, { issues: [], checklist: [{ id: 'R-qa-1', status: 'met' }] }, ['R-qa-1']),
    rec('ux', 1, { issues: [{ severity: 'major', title: 't', fix: 'f' }] }, []),
  ] };
  assert.deepEqual(rolesForRound(['qa', 'ux'], 2, last),
    [{ key: 'product', skip: false }, { key: 'qa', skip: true }, { key: 'ux', skip: false }]);
});

test('refinerVerdict: a critical reviewer finding blocks; minors and the refiner\'s own majors do not route', () => {
  const r = { roles: [rec('ux', 1, { issues: [{ severity: 'critical', title: 'x', fix: 'y' }] })] };
  assert.equal(refinerVerdict(r, { issues: [] }).verdict.issues[0].severity, 'critical');
  const m = { roles: [rec('ux', 1, { issues: [{ severity: 'minor', title: 'x', fix: 'y' }] })] };
  const out = refinerVerdict(m, { issues: [{ severity: 'major', title: 'own' }, { severity: 'minor', title: 'nit' }] });
  assert.deepEqual(out.verdict.issues.map((i) => i.severity), ['minor']);
  assert.equal(out.refinerIssues.length, 1);
});

test('applyDispositions with only `addressed`: fixed findings carry the version, the rest stay open', () => {
  const round = { roles: [rec('ux', 1, { issues: [
    { severity: 'major', title: 'a', fix: 'b' }, { severity: 'major', title: 'c', fix: 'd' }] })] };
  applyDispositions(round, { addressed: ['ux-1-1'] }, 2);
  assert.deepEqual(round.roles[0].findings.map((f) => [f.status, f.fixedIn]), [['fixed', 2], ['open', undefined]]);
  assert.equal(openBlocking({ rounds: [round] }), 1);
});

test('findingsMarkdown: one section per role, ids and unmet items listed', () => {
  const md = findingsMarkdown(1, '/p/plan.md', [rec('ux', 1, { issues: [{ severity: 'major', title: 't', fix: 'f' }] },
    roleItems('ux', PLAN).map((i) => i.id))]);
  assert.match(md, /^## UX$/m);
  assert.match(md, /\*\*ux-1-1\*\* \[major\]/);
  assert.match(md, /R-ux-1: unmet/);
});

const FIT_PLAN = readFileSync(new URL('./fixtures/fit-review/check-row-duplicate-plan.md', import.meta.url), 'utf8');

test('roleBriefBlock(fit) names the five rules and lists the plan\'s R-fit items', () => {
  const b = roleBriefBlock('fit', FIT_PLAN);
  assert.match(b, /## Your role: Project fit/);
  for (let i = 1; i <= 5; i++) assert.match(b, new RegExp(`\`R-fit-${i}\``));
  assert.doesNotMatch(b, /`R-qa-|`R-arch-/);
});

test('houseBriefBlock: the brief for fit only, a plain line when there is none', () => {
  const brief = '# House brief\n\n## Components\n- ui/public/shape/check-row.mjs — rows\n';
  assert.match(houseBriefBlock('fit', brief), /## Project fit: the house brief[\s\S]*# House brief[\s\S]*check-row\.mjs/);
  for (const k of ['product', 'ux', 'qa', 'architect', 'security']) assert.equal(houseBriefBlock(k, brief), '', k);
  assert.match(houseBriefBlock('fit', ''), /no house brief yet/);
  assert.doesNotMatch(houseBriefBlock('fit', ''), /# House brief/);
});

const RUN = JSON.parse(readFileSync(new URL('./fixtures/role-review/recorded-run.json', import.meta.url), 'utf8'));
const RR = RUN.plan.roleReviews;

test('recorded-run fixture: ids, statuses and round-2 skips are what slice 1 stores', () => {
  for (const round of RR.rounds) {
    for (const role of round.roles.filter((r) => !r.skipped)) {
      const raw = { issues: role.findings.map((f) => ({ severity: f.severity, title: f.title, section: f.section, fix: f.fix })) };
      const record = rec(role.key, round.round, raw, role.checklist.map((c) => c.id));
      const fixed = role.findings.filter((f) => f.status === 'fixed');
      applyDispositions({ roles: [record] }, { addressed: fixed.map((f) => f.id) }, fixed[0]?.fixedIn);
      assert.deepEqual(record.findings.map((f) => [f.id, f.status]), role.findings.map((f) => [f.id, f.status]), role.key);
    }
  }
  const skips = rolesForRound(RUN.plan.perspectives, 2, RR.rounds[0]).map((r) => [r.key, r.skip]);
  assert.deepEqual(skips, RR.rounds[1].roles.map((r) => [r.key, r.skipped]));
});

test('roleSummaries: one entry per role, earlier fixes kept, a superseded open finding dropped, ids once', () => {
  const s = roleSummaries(RR);
  assert.deepEqual(s.map((r) => [r.text, r.open]), [
    ['Product · no findings', 0], ['Architect · 1 fixed', 0], ['QA · 2 fixed', 0],
    ['UX · 1 fixed', 0], ['Project fit · 1 open', 1]]);
  assert.deepEqual(s.map((r) => r.counts.raised), [0, 1, 2, 1, 1], 'the counts are over exactly the listed findings');
  const ids = s.flatMap((r) => r.findings.map((f) => f.id));
  assert.equal(new Set(ids).size, ids.length);
  assert.ok(!ids.includes('fit-1-1'));
  assert.equal(s.reduce((n, r) => n + r.open, 0), openBlocking(RR));
});

test('roleSummaries: a disputed finding is not counted as fixed, and an earlier round\'s dispute is kept', () => {
  const f = (id, status, extra = {}) => ({ id, severity: 'major', title: id, section: 'Rollout', fix: id, status, ...extra });
  const rr = { rounds: [
    { pass: 1, round: 1, plan: 'p', roles: [{ key: 'security', label: 'Security', skipped: false, checklist: [],
      findings: [f('security-1-1', 'disputed', { reason: 'out of scope' }), f('security-1-2', 'open')] }] },
    { pass: 1, round: 2, plan: 'p', roles: [{ key: 'security', label: 'Security', skipped: false, checklist: [],
      findings: [f('security-2-1', 'fixed'), f('security-2-2', 'open')] }] },
  ] };
  const [row] = roleSummaries(rr);
  assert.equal(row.text, 'Security · 1 fixed · 1 disputed · 1 open');
  assert.deepEqual(row.counts, { raised: 3, fixed: 1, disputed: 1, open: 1 });
  assert.deepEqual(row.findings.map((x) => x.id), ['security-1-1', 'security-2-1', 'security-2-2'], 'the superseded open one is dropped');
  assert.equal(row.open, 1, 'a disputed finding is not open');
  assert.equal(openBlocking(rr), 1);
  assert.equal(countsText({ raised: 0, fixed: 0, disputed: 0, open: 0 }), 'no findings');
  assert.equal(countsText({ raised: 4, fixed: 2, disputed: 1, open: 1 }), '2 fixed · 1 disputed · 1 open');
  assert.equal(countsText({ raised: 2, fixed: 0, disputed: 2, open: 0 }), '2 disputed');
});

test('reviewedLine and currentPass: the last pass only; empty without rounds', () => {
  assert.equal(reviewedLine(RR), 'Reviewed by 5 roles · 1 open');
  const next = { rounds: [...RR.rounds, { pass: 2, round: 1, plan: 'p', roles: [RR.rounds[1].roles[1]] }] };
  assert.equal(currentPass(next).rounds.length, 1);
  assert.equal(reviewedLine(next), 'Reviewed by 1 role');
  assert.equal(reviewedLine(null), '');
  assert.equal(currentPass({ rounds: [] }), null);
  assert.deepEqual(roleSummaries({ rounds: [] }), []);
});

// Spec §4a "who is challenging, live" (review A12): ledger rows as the scheduler writes them (status 'start' while in
// flight), the role node's active shell execution, the round's record once it lands.
const slice = (round, key, status) => ({ executionId: `roles:${round}:role-${key}`, parentExecutionId: `roles:${round}`, taskId: `role-${key}`, status });
const liveRun = ({ round = 1, steps = [], active = [{ nodeId: 'roles', executionId: `roles:${round}` }], rounds = [], perspectives = ['architect', 'ux'], status = 'running' } = {}) => ({
  status, steps, active, progressFacts: { roleReview: { nodeId: 'roles', round } }, roleReviews: { rounds }, shaping: { perspectives },
});
const rows = (out) => out.rows.map((x) => [x.key, x.state, x.live]);

test('liveRoleRows: reviewing / reviewed while the round runs, round 2 reads its own rows and skips a clean role', () => {
  const r1 = liveRun({ steps: [slice(1, 'product', 'start'), slice(1, 'architect', 'done')] });
  assert.deepEqual(rows(liveRoleRows(r1, { stage: 'plan' })),
    [['product', 'reviewing', true], ['architect', 'reviewed', false], ['ux', 'reviewing', false]]);
  assert.equal(liveRoleRows(r1, { stage: 'plan' }).rows[0].label, 'Product');
  const rec1 = { pass: 1, round: 1, roles: [
    rec('product', 1, { issues: [{ severity: 'major', title: 't', fix: 'f' }] }, []),
    rec('architect', 1, { issues: [], checklist: [] }, []),
    rec('ux', 1, { issues: [{ severity: 'critical', title: 't', fix: 'f' }] }, []),
  ] };
  const r2 = liveRun({ round: 2, rounds: [rec1], steps: [slice(1, 'product', 'done'), slice(1, 'ux', 'done'), slice(1, 'architect', 'done'),
    slice(2, 'product', 'done'), slice(2, 'ux', 'start')] });
  assert.deepEqual(rows(liveRoleRows(r2, { stage: 'plan' })),
    [['product', 'reviewed', false], ['architect', 'skipped: nothing open', false], ['ux', 'reviewing', true]]);
});

test('liveRoleRows: the landed record\'s states, the Refine line, and null outside a live Plan stage', () => {
  const landedRound = { pass: 1, round: 1, roles: [
    rec('ux', 1, { issues: [{ severity: 'major', title: 'a', fix: 'f' }, { severity: 'critical', title: 'b', fix: 'f' }] }, []),
    rec('architect', 1, { issues: [{ severity: 'major', title: 'c', fix: 'f' }, { severity: 'minor', title: 'd', fix: 'f' }] }, []),
    rec('product', 1, { issues: [] }, []),
    { key: 'qa', label: 'QA', skipped: true, findings: [{ severity: 'major', status: 'open' }], checklist: [] },
  ] };
  const landed = liveRun({ rounds: [landedRound], active: [] });
  assert.deepEqual(rows(liveRoleRows(landed, { stage: 'plan' })),
    [['ux', '1 critical', false], ['architect', '1 major', false], ['product', 'no findings', false], ['qa', 'skipped: nothing open', false]]);
  const refining = liveRun({ rounds: [landedRound], active: [{ nodeId: 'refine', executionId: 'refine:1' }] });
  assert.deepEqual(liveRoleRows(refining, { stage: 'plan' }), { rows: [], refine: 'Fixing 3 findings from UX and Architect' });
  const one = { pass: 1, round: 1, roles: [rec('qa', 1, { issues: [{ severity: 'major', title: 'a', fix: 'f' }] }, [])] };
  assert.equal(liveRoleRows(liveRun({ rounds: [one], active: [{ nodeId: 'refine', executionId: 'refine:1' }] }), { stage: 'plan' }).refine,
    'Fixing 1 finding from QA');
  assert.equal(liveRoleRows({ ...landed, status: 'done' }, { stage: 'plan' }), null, 'a finished run');
  assert.equal(liveRoleRows(landed, { stage: 'build' }), null, 'the Plan step card owns the rows after Plan');
  assert.equal(liveRoleRows(landed, { stage: null }), null, 'nodes progress mode');
  assert.equal(liveRoleRows(landed), null);
  assert.equal(liveRoleRows({ status: 'running' }, { stage: 'plan' }), null, 'no role review fact');
  assert.equal(worstText([]), 'no findings');
  assert.equal(worstText([{ severity: 'minor' }, { severity: 'minor' }]), '2 minor');
});

// #990 slice 4: plan rounds and Shaper's code rounds (n_review, target diff) share state.roleReviews.rounds.
const codeRec = (key, label, issues) => ({ ...rec(key, 1, { issues }, []), label });
const CODE_ROUND = { pass: 1, round: 1, node: 'n_review', target: 'diff', plan: 'p', roles: [
  codeRec('correctness', 'Correctness', [{ severity: 'major', title: 'race', fix: 'lock' }]),
  codeRec('security', 'Security', []),
  codeRec('fit', 'Project fit', [{ severity: 'minor', title: 'n', fix: 'f' }]),
] };

test('currentPass and its readers: the plan pass by default, the diff pass by node; a round without a target reads as plan', () => {
  const legacy = RR.rounds.map(({ node, target, ...r }) => r);
  const mixed = { rounds: [...legacy, CODE_ROUND] };
  assert.deepEqual(currentPass(mixed), currentPass(RR), 'the code round never joins the plan pass');
  assert.deepEqual(currentPass(mixed, { target: 'plan' }), currentPass(RR));
  assert.deepEqual(currentPass(mixed, { node: 'n_review' }), { rounds: [CODE_ROUND] });
  assert.deepEqual(currentPass(mixed, { target: 'diff' }), { rounds: [CODE_ROUND] });
  assert.equal(reviewedLine(mixed), reviewedLine(RR));
  assert.equal(reviewedLine(mixed, { node: 'n_review' }), 'Reviewed by 3 roles · 1 open');
  assert.equal(openBlocking(mixed), openBlocking(RR));
  assert.equal(openBlocking(mixed, { node: 'n_review' }), 1);
  assert.deepEqual(roleSummaries(mixed, { node: 'n_review' }).map((r) => r.text), ['Correctness · 1 open', 'Security · no findings', 'Project fit · 1 open']);
  const named = { rounds: [{ ...RR.rounds[0], node: 'n_roles', target: 'plan' }, CODE_ROUND] };
  assert.equal(currentPass(named, { node: 'n_roles' }).rounds.length, 1);
  assert.equal(currentPass(named).rounds[0].node, 'n_roles');
});

test('liveRoleRows at the review stage lists the code roles, never a plan role', () => {
  const planRound = { pass: 1, round: 1, node: 'n_roles', target: 'plan', roles: [rec('architect', 1, { issues: [] }, []), rec('ux', 1, { issues: [] }, [])] };
  const codeSlice = (key, title, status) => ({ executionId: `n_review:1:role-${key}`, parentExecutionId: 'n_review:1', taskId: `role-${key}`, title, status });
  const reviewing = { status: 'running', shaping: { perspectives: ['architect', 'ux'] },
    progressFacts: { roleReview: { nodeId: 'n_review', round: 1 } }, roleReviews: { rounds: [planRound] },
    active: [{ nodeId: 'n_review', executionId: 'n_review:1' }],
    steps: [codeSlice('correctness', 'Correctness', 'done'), codeSlice('security', 'Security', 'start'), codeSlice('fit', 'Project fit', 'start')] };
  const live = liveRoleRows(reviewing, { stage: 'review' });
  assert.deepEqual(live.rows.map((x) => [x.label, x.state]), [['Correctness', 'reviewed'], ['Security', 'reviewing'], ['Project fit', 'reviewing']]);
  const landed = { ...reviewing, active: [], roleReviews: { rounds: [planRound, CODE_ROUND] } };
  assert.deepEqual(rows(liveRoleRows(landed, { stage: 'review' })),
    [['correctness', '1 major', false], ['security', 'no findings', false], ['fit', '1 minor', false]]);
  assert.deepEqual(liveRoleRows(landed, { stage: 'review' }).rows.map((x) => x.label), ['Correctness', 'Security', 'Project fit']);
  const fixing = { ...landed, active: [{ nodeId: 'n_impl', executionId: 'n_impl:2' }] };
  assert.deepEqual(liveRoleRows(fixing, { stage: 'review' }), { rows: [], refine: 'Fixing 1 finding from Correctness' });
  const round2 = { ...reviewing, progressFacts: { roleReview: { nodeId: 'n_review', round: 2 } }, roleReviews: { rounds: [planRound, CODE_ROUND] },
    active: [{ nodeId: 'n_review', executionId: 'n_review:2' }],
    steps: [{ ...codeSlice('correctness', 'Correctness', 'start'), executionId: 'n_review:2:role-correctness', parentExecutionId: 'n_review:2' }] };
  assert.deepEqual(liveRoleRows(round2, { stage: 'review' }).rows.map((x) => [x.label, x.state]),
    [['Correctness', 'reviewing'], ['Security', 'skipped: nothing open'], ['Project fit', 'skipped: nothing open']]);
  assert.equal(liveRoleRows(landed, { stage: 'build' }), null);
  assert.equal(liveRoleRows({ ...landed, status: 'done' }, { stage: 'review' }), null);
  // A plan-stage fact still reads only the plan node's rounds.
  const atPlan = { ...landed, progressFacts: { roleReview: { nodeId: 'n_roles', round: 1 } } };
  assert.deepEqual(liveRoleRows(atPlan, { stage: 'plan' }).rows.map((x) => x.key), ['architect', 'ux']);
});

test('attachRoleReviews: a plan ask gets the plan pass, a gate its node\'s pass; an outline, a bare gate and other asks get nothing', () => {
  const mixed = { rounds: [...RR.rounds, CODE_ROUND] };
  assert.deepEqual(attachRoleReviews({ kind: 'plan', plan: { round: 1 } }, mixed).plan.roleReviews, currentPass(RR));
  assert.deepEqual(attachRoleReviews({ kind: 'gate', nodeId: 'n_review' }, mixed).roleReviews, { rounds: [CODE_ROUND] });
  for (const q of [{ kind: 'plan', plan: { outline: {} } }, { kind: 'gate', nodeId: 'n_impl' }, { kind: 'gate' }, { kind: 'clarify' }]) {
    const before = JSON.stringify(q);
    assert.equal(JSON.stringify(attachRoleReviews(q, mixed)), before, before);
  }
  const ev = { kind: 'gate', nodeId: 'n_review' };
  assert.equal(attachRoleReviews(ev, undefined), ev, 'in place; no state, no change');
  assert.equal('roleReviews' in ev, false);
});
