// test/graph-scheduler-approve.test.mjs
// The node approval stop (`config.approve`): an armed agent node holds the approved output port's token until a
// person answers — before any wire, so nothing downstream starts. It mirrors the loop-gate holds (asked via onAsk,
// serialised in the snapshot, re-asked by reattach). The scheduler stays pure: custom agent keys, hand-built ports.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createScheduler } from '../src/core/graph/scheduler.mjs';
import { flowPorts, ROLE_REVIEW_PORTS } from '../src/shared/graph/ports.mjs';
import { AWAIT_PORT } from '../src/shared/graph/constants.mjs';

const BLOCKING = (title = 'boom') => ({ issues: [{ severity: 'critical', title }] });
const CLEAN = { issues: [{ severity: 'minor', title: 'nit' }] };
const tick = () => new Promise((r) => setTimeout(r, 0));
const until = async (fn) => { for (let i = 0; i < 200 && !fn(); i += 1) await tick(); assert.ok(fn(), 'condition never became true'); };

const AGENTS = {
  planner: {
    inputs: [{ id: 'task', type: 'md', required: true }, { id: 'revise', type: 'md', required: false, loop: true }],
    outputs: [{ id: 'plan', type: 'md', when: 'always' }],
  },
  reviewer: {
    inputs: [{ id: 'plan', type: 'md', required: true }],
    outputs: [{ id: 'plan', type: 'md', when: 'clean' }],
  },
  polisher: {
    inputs: [{ id: 'plan', type: 'md', required: true }, { id: 'revise', type: 'md', required: false, loop: true }],
    outputs: [{ id: 'plan', type: 'md', when: 'clean' }, { id: 'revise', type: 'md', when: 'blocking' }],
    verdict: { filename: 'refine-cycle{cycle}.json' },
  },
  tightener: {
    inputs: [{ id: 'plan', type: 'md', required: true }, { id: 'findings', type: 'md', required: false }],
    outputs: [{ id: 'plan', type: 'md', when: 'clean' }, { id: 'revise', type: 'md', when: 'blocking' }],
    verdict: { filename: 'tight-cycle{cycle}.json' },
  },
  implementer: {
    inputs: [{ id: 'plan', type: 'md', required: true }],
    outputs: [{ id: 'done', type: 'void', when: 'always' }],
  },
};

const ownPorts = (node) => (node.config?.roleReview === true ? ROLE_REVIEW_PORTS : AGENTS[node.key]);
const portsFn = (node) => (node.kind === 'agent'
  ? {
    inputs: [...(ownPorts(node)?.inputs || []).map((p) => ({ ...p })), { ...AWAIT_PORT }],
    outputs: (ownPorts(node)?.outputs || []).map((p) => ({ ...p })),
    verdict: AGENTS[node.key]?.verdict,
  }
  : flowPorts(node));

const N = (id, kind, key, config = {}) => ({ id, kind, key, x: 0, y: 0, config });
const W = (id, from, to, config) => ({
  id,
  from: { node: from.split('.')[0], port: from.split('.')[1] },
  to: { node: to.split('.')[0], port: to.split('.')[1] },
  ...(config ? { config } : null),
});
const TPL = (nodes, wires) => ({ id: 'wf_t', name: 'T', version: 2, domain: 'coding', nodes, wires });
const APPROVE = { approve: { kind: 'plan', port: 'plan' } };

/** n_task -> P -> R(approve plan) -> I -> End. */
const approveTpl = (rKey = 'reviewer', extraWires = [], rConfig = APPROVE) => TPL(
  [N('n_task', 'task'), N('n_p', 'agent', 'planner'), N('n_r', 'agent', rKey, rConfig),
    N('n_i', 'agent', 'implementer'), N('n_end', 'end')],
  [W('w1', 'n_task.task', 'n_p.task'), W('w2', 'n_p.plan', 'n_r.plan'), W('w3', 'n_r.plan', 'n_i.plan'),
    W('w4', 'n_i.done', 'n_end.result'), ...extraWires],
);

function harness({ template, script = {}, onAsk, approvalStops = true }) {
  const snapshots = []; const calls = []; const asks = [];
  const execute = (args) => {
    calls.push({ nodeId: args.node.id, ordinal: args.ordinal, bindings: args.bindings, trigger: args.trigger, composite: args.composite });
    const fn = script[args.node.id];
    return Promise.resolve(typeof fn === 'function' ? fn(args) : {});
  };
  const scheduler = createScheduler({
    template, portsFn, execute, approvalStops,
    onSnapshot: (s) => snapshots.push(s),
    onAsk: async (a) => { asks.push(a); return onAsk ? onAsk(a) : []; },
  });
  return {
    scheduler, snapshots, calls, asks,
    callsFor: (id) => calls.filter((c) => c.nodeId === id),
    last: () => snapshots[snapshots.length - 1],
  };
}

/** A deferred onAsk for `plan` asks: each resolves only when the test answers. Gates answer 'continue'. */
function deferredAsk() {
  const queue = [];
  const onAsk = (a) => (a.kind === 'gate' ? 'continue' : new Promise((resolve) => { queue.push({ q: a, resolve }); }));
  return { onAsk, queue };
}

const PLAN = { outputs: { plan: { path: '/p/plan.md' } } };
const rScript = { n_p: () => PLAN, n_r: () => ({ outputs: { plan: { path: '/p/r.md' } } }) };

test('0 not armed: the approve config is inert — no plan ask, I runs, snapshot has no approvals', { timeout: 5000 }, async () => {
  const h = harness({ template: approveTpl(), script: rScript, approvalStops: false });
  assert.equal(await h.scheduler.run(), 'done');
  assert.equal(h.asks.filter((a) => a.kind === 'plan').length, 0);
  assert.equal(h.callsFor('n_i').length, 1);
  assert.equal('approvals' in h.last(), false);
  assert.equal('approvalRounds' in h.last(), false);
});

test('1 holds before downstream: the ask carries the plan, I has not run, the snapshot carries the stop', { timeout: 5000 }, async () => {
  const d = deferredAsk();
  const h = harness({ template: approveTpl(), script: rScript, onAsk: d.onAsk });
  const run = h.scheduler.run();
  await until(() => d.queue.length === 1);
  await tick();
  const q = d.queue[0].q;
  assert.equal(q.kind, 'plan');
  assert.equal(q.id, 'plan-n_r-1');
  assert.equal(q.nodeId, 'n_r');
  assert.deepEqual(q.plan, { port: 'plan', file: '/p/r.md', round: 1, revisable: true });
  assert.equal(h.callsFor('n_i').length, 0, 'nothing downstream starts');
  assert.equal(h.last().approvals.length, 1);
  assert.deepEqual(h.last().approvalRounds, { n_r: 1 });
  h.scheduler.abort();
  await run;
});

test('2 approve continues: I runs with the held path and the run finishes', { timeout: 5000 }, async () => {
  const d = deferredAsk();
  const h = harness({ template: approveTpl(), script: rScript, onAsk: d.onAsk });
  const run = h.scheduler.run();
  await until(() => d.queue.length === 1);
  d.queue[0].resolve({ decision: 'approve' });
  assert.equal(await run, 'done');
  assert.equal(h.callsFor('n_i').length, 1);
  assert.equal(h.callsFor('n_i')[0].bindings.plan.path, '/p/r.md');
  assert.equal(h.scheduler.getState().endReached, true);
});

test('3 revise: the planner re-runs with the feedback, R re-runs, the stop is raised again as round 2', { timeout: 5000 }, async () => {
  const d = deferredAsk();
  const h = harness({ template: approveTpl(), script: rScript, onAsk: d.onAsk });
  const run = h.scheduler.run();
  await until(() => d.queue.length === 1);
  d.queue[0].resolve({ decision: 'revise', path: '/fb.md' });
  await until(() => d.queue.length === 2);
  assert.equal(h.callsFor('n_p').length, 2);
  const p2 = h.callsFor('n_p')[1];
  assert.deepEqual(p2.trigger.freshPorts, ['revise']);
  assert.equal(p2.bindings.revise.path, '/fb.md');
  assert.equal(h.callsFor('n_r').length, 2);
  assert.equal(d.queue[1].q.id, 'plan-n_r-2');
  assert.equal(d.queue[1].q.plan.round, 2);
  assert.equal(h.callsFor('n_i').length, 0);
  d.queue[1].resolve('approve');
  assert.equal(await run, 'done');
  assert.equal(h.callsFor('n_i').length, 1);
});

test('4 stop: any non-approve, non-revise answer ends the run and I never runs', { timeout: 5000 }, async () => {
  for (const answer of [{ decision: 'stop' }, []]) {
    const h = harness({ template: approveTpl(), script: rScript, onAsk: () => answer });
    assert.equal(await h.scheduler.run(), 'error');
    assert.equal(h.callsFor('n_i').length, 0);
  }
});

test('5 resume while held: reattach re-asks the same id; approving finishes the run', { timeout: 5000 }, async () => {
  const d = deferredAsk();
  const h = harness({ template: approveTpl(), script: rScript, onAsk: d.onAsk });
  const run = h.scheduler.run();
  await until(() => d.queue.length === 1);
  h.scheduler.pause();
  assert.equal(await run, 'paused');
  const snapshot = h.last();
  assert.equal(snapshot.approvals.length, 1);

  const d2 = deferredAsk();
  const h2 = harness({ template: approveTpl(), script: rScript, onAsk: d2.onAsk });
  h2.scheduler.reattach(snapshot);
  const run2 = h2.scheduler.run();
  await until(() => d2.queue.length === 1);
  assert.equal(d2.queue[0].q.id, 'plan-n_r-1');
  d2.queue[0].resolve('approve');
  assert.equal(await run2, 'done');
  assert.equal(h2.callsFor('n_i').length, 1);
  assert.equal(h2.callsFor('n_i')[0].bindings.plan.path, '/p/r.md');
});

const SELF = (maxCycles) => [W('w5', 'n_r.revise', 'n_r.revise', { maxCycles })];

test('6 the forceClean path is held too: a gate "continue" force-fires plan into the stop, not into I', { timeout: 5000 }, async () => {
  const d = deferredAsk();
  const h = harness({
    template: approveTpl('polisher', SELF(1)),
    script: { n_p: () => PLAN, n_r: () => ({ verdict: BLOCKING(), outputs: { revise: { path: '/p/rev.md' } } }) },
    onAsk: d.onAsk,
  });
  const run = h.scheduler.run();
  await until(() => d.queue.length === 1);
  await tick();
  assert.equal(d.queue[0].q.kind, 'plan');
  assert.equal(d.queue[0].q.plan.file, '/p/rev.md', 'the forced token is the one held');
  assert.equal(h.callsFor('n_i').length, 0);
  d.queue[0].resolve('approve');
  assert.equal(await run, 'done');
  assert.equal(h.callsFor('n_i').length, 1);
});

test('7 no approve, no change: a graph without approve snapshots without the approval keys', { timeout: 5000 }, async () => {
  const tpl = TPL(
    [N('n_task', 'task'), N('n_pol', 'agent', 'polisher'), N('n_end', 'end')],
    [W('w1', 'n_task.task', 'n_pol.plan'), W('w2', 'n_pol.revise', 'n_pol.revise', { maxCycles: 2 }),
      W('w3', 'n_pol.plan', 'n_end.result')],
  );
  const h = harness({
    template: tpl,
    script: { n_pol: (a) => ({ verdict: BLOCKING(), outputs: { revise: { path: `/p/rev${a.ordinal}.md` } } }) },
    onAsk: (a) => (a.kind === 'gate' ? 'continue' : []),
  });
  assert.equal(await h.scheduler.run(), 'done');
  for (const s of h.snapshots) {
    assert.equal('approvals' in s, false);
    assert.equal('approvalRounds' in s, false);
  }
});

test('8 revise clears the stale loop rewrite: R re-runs on the new plan with no revise binding', { timeout: 5000 }, async () => {
  const d = deferredAsk();
  const h = harness({
    template: approveTpl('polisher', SELF(3)),
    script: {
      n_p: () => PLAN,
      // Blocks on the first execution only: its own rewrite is latched on R.revise, the 2nd run is clean and held.
      n_r: (a) => (a.ordinal === 1
        ? { verdict: BLOCKING(), outputs: { revise: { path: '/p/own-rev.md' } } }
        : { verdict: CLEAN, outputs: { plan: { path: `/p/r${a.ordinal}.md` } } }),
    },
    onAsk: d.onAsk,
  });
  const run = h.scheduler.run();
  await until(() => d.queue.length === 1);
  assert.equal(h.callsFor('n_r').length, 2);
  assert.equal(h.callsFor('n_r')[1].bindings.revise.path, '/p/own-rev.md');
  d.queue[0].resolve({ decision: 'revise', path: '/fb.md' });
  await until(() => d.queue.length === 2);
  assert.equal(h.callsFor('n_p').length, 2);
  const r3 = h.callsFor('n_r')[2];
  assert.ok(r3.bindings.plan, 'the planner\'s new plan is bound');
  assert.equal(r3.bindings.revise, undefined, 'the stale own-rewrite is gone');
  assert.deepEqual(r3.trigger.freshPorts, ['plan']);
  assert.equal(d.queue[1].q.id, 'plan-n_r-2');
  d.queue[1].resolve('approve');
  assert.equal(await run, 'done');
});

test('10 revise resets the loop budget: the round-2 rewrite is delivered, not held at a gate', { timeout: 5000 }, async () => {
  let deliveriesAtRound2 = null;
  const h = harness({
    template: approveTpl('polisher', SELF(2)),
    script: {
      n_p: () => PLAN,
      // Blocks once per shaping round: round 1 spends the self-loop's single allowance, round 2 needs it back.
      n_r: (a) => ([1, 3].includes(a.ordinal)
        ? { verdict: BLOCKING(), outputs: { revise: { path: `/p/rev${a.ordinal}.md` } } }
        : { verdict: CLEAN, outputs: { plan: { path: `/p/r${a.ordinal}.md` } } }),
    },
    onAsk: (a) => {
      if (a.kind === 'gate') return 'continue';
      if (a.plan.round === 1) return { decision: 'revise', path: '/fb.md' };
      deliveriesAtRound2 = h.scheduler.getState().wireDeliveries.w5;
      return 'approve';
    },
  });
  assert.equal(await h.scheduler.run(), 'done');
  assert.equal(h.asks.filter((a) => a.kind === 'gate').length, 0, 'no gate: the revise gave the budget back');
  assert.equal(h.callsFor('n_r').length, 4);
  assert.equal(h.callsFor('n_r')[3].bindings.revise.path, '/p/rev3.md');
  assert.equal(deliveriesAtRound2, 1);
});

test('11 holds survive the reset: a later hold on the same wire gets a fresh ask id', { timeout: 5000 }, async () => {
  const h = harness({
    template: approveTpl('polisher', SELF(2)),
    script: {
      n_p: () => PLAN,
      n_r: (a) => ([1, 2, 4, 5].includes(a.ordinal)
        ? { verdict: BLOCKING(), outputs: { revise: { path: `/p/rev${a.ordinal}.md` } } }
        : { verdict: CLEAN, outputs: { plan: { path: `/p/r${a.ordinal}.md` } } }),
    },
    // R3 is clean, so the second hold needs a second revise (round 2) before R4/R5 spend the reset budget.
    onAsk: (a) => {
      if (a.kind === 'gate') return 'continue';
      return a.plan.round < 3 ? { decision: 'revise', path: `/fb${a.plan.round}.md` } : 'approve';
    },
  });
  assert.equal(await h.scheduler.run(), 'done');
  assert.deepEqual(h.asks.filter((a) => a.kind === 'gate').map((a) => a.id), ['gate-w5-2', 'gate-w5-2-h2']);
});

test('9 the revise target skips the synthesized await input', { timeout: 5000 }, async () => {
  const tpl = TPL(
    [N('n_task', 'task'), N('n_p', 'agent', 'planner'), N('n_r', 'agent', 'reviewer', APPROVE),
      N('n_i', 'agent', 'implementer'), N('n_end', 'end')],
    [W('w1', 'n_task.task', 'n_p.task'), W('w2', 'n_task.task', 'n_r.plan'), W('w3', 'n_p.plan', 'n_r.await'),
      W('w4', 'n_r.plan', 'n_i.plan'), W('w5', 'n_i.done', 'n_end.result')],
  );
  const d = deferredAsk();
  const h = harness({ template: tpl, script: rScript, onAsk: d.onAsk });
  const run = h.scheduler.run();
  await until(() => d.queue.length === 1);
  assert.equal(d.queue[0].q.plan.revisable, false);
  h.scheduler.abort();
  await run;
});

test('12 role reviews: a revise answer goes to the Planner through the role node, clears its latched revise and refills its loop', { timeout: 5000 }, async () => {
  const tpl = TPL(
    [N('n_task', 'task'), N('n_p', 'agent', 'planner'), N('n_roles', 'agent', 'reviewer', { roleReview: true }),
      N('n_ref', 'agent', 'tightener', { ...APPROVE, awaitAll: true }), N('n_i', 'agent', 'implementer'), N('n_end', 'end')],
    [W('w1', 'n_task.task', 'n_p.task'), W('w4', 'n_p.plan', 'n_roles.plan'), W('w17', 'n_roles.plan', 'n_ref.plan'),
      W('w18', 'n_roles.findings', 'n_ref.findings'),
      W('w5', 'n_ref.revise', 'n_roles.revise', { maxCycles: 2, onExhausted: 'clean' }),
      W('w3', 'n_ref.plan', 'n_i.plan'), W('w9', 'n_i.done', 'n_end.result')],
  );
  const roles = (a) => {
    if (a.composite === 'expand') return { phases: [] };
    return { outputs: { findings: { path: `/p/f${a.ordinal}.md` }, plan: { path: (a.bindings.revise || a.bindings.plan).path } } };
  };
  let atRound2 = null;
  const h = harness({
    template: tpl,
    script: {
      n_p: () => PLAN,
      n_roles: roles,
      // Blocks once per pass: pass 1 spends the loop's single allowance, pass 2 needs it back.
      n_ref: (a) => ([1, 3].includes(a.ordinal)
        ? { verdict: BLOCKING(), outputs: { revise: { path: `/p/rev${a.ordinal}.md` } } }
        : { verdict: CLEAN, outputs: { plan: { path: `/p/r${a.ordinal}.md` } } }),
    },
    onAsk: (a) => {
      if (a.kind === 'gate') return 'continue';
      if (a.plan.round === 1) {
        assert.equal(a.plan.revisable, true, 'the stop can be revised through the role node');
        return { decision: 'revise', path: '/fb.md' };
      }
      atRound2 = { deliveries: h.scheduler.getState().wireDeliveries.w5 };
      return 'approve';
    },
  });
  assert.equal(await h.scheduler.run(), 'done');
  const p = h.callsFor('n_p');
  assert.equal(p.length, 2);
  assert.equal(p[1].bindings.revise.path, '/fb.md', 'the feedback lands on the Planner\'s revise');
  const expands = h.callsFor('n_roles').filter((c) => c.composite === 'expand');
  assert.equal(expands.length, 4, 'two rounds in each pass');
  assert.equal(expands[2].bindings.revise, undefined, 'the latched pass-1 rewrite is gone');
  assert.deepEqual(expands[2].trigger.freshPorts, ['plan']);
  assert.ok(h.callsFor('n_roles').every((c) => c.bindings.revise?.path !== '/fb.md'), 'the role node never gets the feedback');
  assert.equal(expands[3].bindings.revise.path, '/p/rev3.md', 'the budget came back: the pass-2 rewrite is delivered');
  assert.deepEqual(atRound2, { deliveries: 1 });
});
