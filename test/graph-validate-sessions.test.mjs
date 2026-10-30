// test/graph-validate-sessions.test.mjs — V25–V30 and the V17 sessions branch on the real seeds.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateGraph, SESSION_ISSUE_CODES } from '../src/shared/graph/validate.mjs';
import { removeNode } from '../src/shared/graph/template.mjs';
import { pruneSessions, sessionsOf } from '../src/shared/graph/sessions.mjs';
import { SEED_TEMPLATES } from '../src/core/graph/seed-templates.mjs';
import { GRAPH_SHAPE_WORKFLOW } from '../src/core/graph/builtin-workflows.mjs';
import { realPortsFn } from './helpers/graph-ports.mjs';
import { checkRows } from './helpers/rows.mjs';

const portsFn = realPortsFn();
const S = 's_aaaaaaaa';
const seed = (id) => structuredClone(SEED_TEMPLATES.find((s) => s.id === id));
const join = (t, ids, v = S) => { for (const id of ids) t.nodes.find((n) => n.id === id).config.session = v; return t; };
const issues = (t) => { const r = validateGraph(t, portsFn); return [...r.errors, ...r.warnings].filter((i) => SESSION_ISSUE_CODES.includes(i.code) || i.sessionId); };

test('a legal session adds no issue; session is not an unknown config key; the codes are exported', () => {
  assert.deepEqual([...SESSION_ISSUE_CODES], ['V25', 'V26', 'V27', 'V28', 'V29', 'V30']);
  const r = validateGraph(join(seed('wf_quick-fix'), ['n_impl', 'n_review']), portsFn);
  assert.deepEqual(r.errors, []);
  assert.deepEqual(r.warnings, []);
});

test('every rule fires with its pinned message, nodeId and sessionId', async () => {
  await checkRows([
    { name: 'V25 bad id', run: () => {
      assert.deepEqual(issues(join(seed('wf_quick-fix'), ['n_impl'], 7)),
        [{ code: 'V25', message: "node 'n_impl' config.session must be an id like 's_k3f9a2b1' (got 7)", nodeId: 'n_impl', sessionId: null }]);
    } },
    { name: 'correction 22: config.session null is absent (a chat op\'s remove) — no issue at all', run: () => {
      const r = validateGraph(join(seed('wf_quick-fix'), ['n_impl', 'n_review'], null), portsFn);
      assert.deepEqual(r.errors, []);
      assert.deepEqual(r.warnings, []);
    } },
    { name: 'V25 script card (E), card-level', run: () => {
      const t = seed('wf_quick-fix');
      t.nodes.push({ id: 'n_tests', kind: 'script', key: 'shell', x: 1500, y: 198, config: { session: S } });
      assert.deepEqual(issues(t),
        [{ code: 'V25', message: `script node 'n_tests' cannot join session '${S}' — only agent steps can run in a session`, nodeId: 'n_tests', sessionId: null }]);
    } },
    { name: 'V25 flow card (E), card-level, no V17 on top', run: () => {
      assert.deepEqual(issues(join(seed('wf_provided-plan'), ['n_or'])),
        [{ code: 'V25', message: `or node 'n_or' cannot join session '${S}' — flow cards ride along, they are never members`, nodeId: 'n_or', sessionId: null }]);
      assert.equal(validateGraph(join(seed('wf_provided-plan'), ['n_or']), portsFn).warnings.some((w) => w.code === 'V17'), false);
    } },
    { name: 'V26 one step (W)', run: () => {
      assert.deepEqual(issues(join(seed('wf_quick-fix'), ['n_impl'])),
        [{ code: 'V26', message: `session '${S}' has one step ('n_impl') — it runs as its own session`, nodeId: 'n_impl', sessionId: S }]);
    } },
    { name: 'V26 at exactly 4 steps is legal (a session holds 2 to 4)', run: () => {
      const r = validateGraph(join(seed('wf_no-clarify'), ['n_refine', 'n_decompose', 'n_impl', 'n_review']), portsFn);
      assert.deepEqual(r.errors, []);
      assert.deepEqual([...r.errors, ...r.warnings].filter((i) => i.code === 'V26'), []);
    } },
    { name: 'V29 skips a one-step session (V26 speaks for it), even on a ×N member', run: () => {
      assert.deepEqual(issues(join(seed('wf_no-clarify'), ['n_impl'])),
        [{ code: 'V26', message: `session '${S}' has one step ('n_impl') — it runs as its own session`, nodeId: 'n_impl', sessionId: S }]);
    } },
    { name: 'V27 between (E)', run: () => {
      const r = validateGraph(join(seed('wf_no-clarify'), ['n_refine', 'n_impl']), portsFn);
      assert.deepEqual(r.errors.filter((e) => e.code === 'V27'), [{ code: 'V27', nodeId: 'n_refine', sessionId: S,
        message: `session '${S}' is not consecutive — 'n_decompose' runs between 'n_refine' and 'n_impl' but is outside the session` }]);
    } },
    { name: 'V29 ×N member (W)', run: () => {
      const w = validateGraph(join(seed('wf_no-clarify'), ['n_decompose', 'n_impl', 'n_review']), portsFn).warnings.filter((x) => x.code === 'V29');
      assert.deepEqual(w, [{ code: 'V29', nodeId: 'n_impl', sessionId: S, message: `node 'n_impl' fans out ×N in session '${S}' — its tasks run outside the session; fix rounds run inside` }]);
    } },
    { name: 'V29 role-review member (W): Shaper [roles, refine]', run: () => {
      const r = validateGraph(join(structuredClone(GRAPH_SHAPE_WORKFLOW), ['n_roles', 'n_refine']), portsFn);
      assert.deepEqual(r.errors, []);
      assert.deepEqual(r.warnings, [{ code: 'V29', nodeId: 'n_roles', sessionId: S, message: `node 'n_roles' fans out ×N in session '${S}' — its tasks run outside the session; fix rounds run inside` }]);
    } },
    { name: 'V28 does NOT fire on wf_provided-plan [impl, review] (loop through a flow card)', run: () => {
      assert.deepEqual(issues(join(seed('wf_provided-plan'), ['n_impl', 'n_review'])).filter((i) => i.code === 'V28'), []);
    } },
    { name: 'V28 does NOT fire when no member reaches the outside source of a crossing loop', run: () => {
      // Implementation's fix input (loop:true, so its wire is in L) now comes from an outside planner the Task card
      // feeds: w5 crosses into the session, but no member runs before that planner, so the session never waits on it.
      const t = join(seed('wf_quick-fix'), ['n_impl', 'n_review']);
      t.nodes.push({ id: 'n_fixer', kind: 'agent', key: 'planner', x: 700, y: 400, config: {} });
      t.wires.push({ id: 'w7', from: { node: 'n_task', port: 'task' }, to: { node: 'n_fixer', port: 'task' } });
      const w5 = t.wires.find((w) => w.id === 'w5');
      w5.from = { node: 'n_fixer', port: 'plan' };
      delete w5.config;
      assert.deepEqual(sessionsOf(t, portsFn)[0].crossingLoops, ['w5'], 'precondition: w5 is a crossing loop from an outside agent');
      const r = validateGraph(t, portsFn);
      assert.deepEqual(r.errors, []);
      assert.deepEqual(r.warnings, []);
    } },
    { name: 'V28 never throws: a malformed wire sharing a crossing loop\'s id is V5/V6, not a TypeError', run: () => {
      // sessionsOf keeps only well-formed wires, so crossingLoops names the real w9; a lookup in the RAW wires would
      // find this { id: 'w9' } first.
      const t = join(seed('wf_provided-plan'), ['n_impl', 'n_review']);
      t.wires.unshift({ id: 'w9' });
      assert.deepEqual(sessionsOf(t, portsFn)[0].crossingLoops, ['w9', 'w14'], 'precondition: w9 is a crossing loop');
      const r = validateGraph(t, portsFn);
      assert.deepEqual(r.errors.map((e) => e.code), ['V5', 'V5', 'V6'], 'the same errors as without the session');
      assert.deepEqual(r.warnings.filter((w) => w.code === 'V28'), []);
    } },
    { name: 'V30 bad mode (E) and V17 unknown setting (W)', run: () => {
      const t = join(seed('wf_quick-fix'), ['n_impl', 'n_review']);
      t.sessions = { [S]: { mode: 'auto', color: 'red' } };
      const r = validateGraph(t, portsFn);
      assert.deepEqual(r.errors.find((e) => e.code === 'V30'), { code: 'V30', nodeId: 'n_impl', sessionId: S, message: `session '${S}' mode must be 'subagents' or 'shared' (got "auto")` });
      assert.deepEqual(r.warnings.find((e) => e.code === 'V17' && e.sessionId), { code: 'V17', nodeId: 'n_impl', sessionId: S, message: `session '${S}' has unknown setting 'color' — preserved and ignored` });
    } },
    { name: 'V30 label and main-agent settings (E); null is the default', run: () => {
      const t = join(seed('wf_quick-fix'), ['n_impl', 'n_review']);
      t.sessions = { [S]: { label: 'x'.repeat(61), hostModel: ' ', hostEffort: null } };
      assert.deepEqual(validateGraph(t, portsFn).errors.filter((e) => e.code === 'V30').map((e) => e.message), [
        `session '${S}' label must be 1 to 60 characters with no control characters`,
        `session '${S}' hostModel must be a non-empty string`,
      ]);
    } },
    { name: 'V30 an empty label and a label with a control character (E)', run: () => {
      for (const label of ['', 'a\u2028b', 'a\nb']) {
        const t = join(seed('wf_quick-fix'), ['n_impl', 'n_review']);
        t.sessions = { [S]: { label } };
        assert.deepEqual(issues(t), [{ code: 'V30', nodeId: 'n_impl', sessionId: S,
          message: `session '${S}' label must be 1 to 60 characters with no control characters` }], JSON.stringify(label));
      }
    } },
    { name: 'V30 hostEffort gets the same check as hostModel (E)', run: () => {
      const t = join(seed('wf_quick-fix'), ['n_impl', 'n_review']);
      t.sessions = { [S]: { hostModel: 'claude-haiku-4-5', hostEffort: ' ' } };
      assert.deepEqual(issues(t), [{ code: 'V30', nodeId: 'n_impl', sessionId: S, message: `session '${S}' hostEffort must be a non-empty string` }]);
    } },
    { name: 'V30 a non-string main-agent setting (E)', run: () => {
      const t = join(seed('wf_quick-fix'), ['n_impl', 'n_review']);
      t.sessions = { [S]: { hostModel: 7 } };
      assert.deepEqual(issues(t), [{ code: 'V30', nodeId: 'n_impl', sessionId: S, message: `session '${S}' hostModel must be a non-empty string` }]);
    } },
    { name: 'V30 every setting null is the default — no issue', run: () => {
      const t = join(seed('wf_quick-fix'), ['n_impl', 'n_review']);
      t.sessions = { [S]: { label: null, mode: null, hostModel: null, hostEffort: null } };
      const r = validateGraph(t, portsFn);
      assert.deepEqual(r.errors, []);
      assert.deepEqual(r.warnings, []);
    } },
    { name: 'correction 28: a whitespace-only label is no V30 (it reads as the default)', run: () => {
      const t = join(seed('wf_quick-fix'), ['n_impl', 'n_review']);
      t.sessions = { [S]: { label: '   ' } };
      assert.deepEqual(issues(t), []);
    } },
  ]);
});

test('V28 fires on a loop through an outside agent', () => {
  // [impl, review] in one session; the review loop now runs through an outside reviewer whose blocking output feeds
  // Implementation's fix input. A clean graph: no error, w12 a real loop wire.
  const t = join(seed('wf_quick-fix'), ['n_impl', 'n_review']);
  t.nodes.push({ id: 'n_fixer', kind: 'agent', key: 'reviewer', x: 1100, y: 400, config: {} });
  t.wires.find((w) => w.id === 'w5').to = { node: 'n_fixer', port: 'plan' };        // review.review → fixer.plan
  t.wires.push({ id: 'w12', from: { node: 'n_fixer', port: 'review' }, to: { node: 'n_impl', port: 'fix' }, config: { maxCycles: 3 } });
  t.wires.push({ id: 'w13', from: { node: 'n_impl', port: 'done' }, to: { node: 'n_fixer', port: 'done' } });
  const r = validateGraph(t, portsFn);
  assert.deepEqual(r.errors, []);
  assert.deepEqual(r.warnings.filter((x) => x.code === 'V28'),
    [{ code: 'V28', nodeId: 'n_impl', sessionId: S, message: `loop wire 'w12' runs 'n_fixer' outside session '${S}' — the session waits for it` }]);
});

test('REVIEW FOCUS 4 — deleting the middle member leaves a V27 "not wired together" error, never a silent split', () => {
  const t = pruneSessions(removeNode(join(seed('wf_no-clarify'), ['n_decompose', 'n_impl', 'n_review']), 'n_impl'));
  const r = validateGraph(t, portsFn);
  assert.deepEqual(r.errors.filter((e) => e.code === 'V27').map((e) => e.message),
    [`session '${S}' is not consecutive — 'n_decompose' and 'n_review' are not wired together inside it`]);
});

test('a 5-member session is V26 (E)', () => {
  const t = join(seed('wf_no-clarify'), ['n_plan', 'n_refine', 'n_decompose', 'n_impl', 'n_review']);
  assert.deepEqual(validateGraph(t, portsFn).errors.filter((e) => e.code === 'V26'),
    [{ code: 'V26', nodeId: 'n_plan', sessionId: S, message: `session '${S}' has 5 steps — a session holds 2 to 4` }]);
});
