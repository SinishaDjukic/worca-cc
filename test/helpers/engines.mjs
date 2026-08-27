// test/helpers/engines.mjs
// One test body, two engines. The v1 stub-runner ABI ({status, issues, review,
// summary}) is adapted to the v2 executor ABI ({outputs, verdict, summary}) so a
// suite's runners do not have to be written twice.
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { createOrchestrator } from '../../src/core/orchestrator.mjs';
import { createGraphOrchestrator } from '../../src/core/graph/orchestrator.mjs';

/** Wrap a v1-shaped stub so the graph executor contract is satisfied: every
 *  declared non-void output gets a real file at its ALLOCATED path (downstream
 *  nodes bind paths, not values) and the verdict rides `verdict`. A stub that
 *  already returns `outputs` is passed through untouched, and a stub that hangs
 *  or rejects still hangs or rejects — the pause/stop suites depend on that. */
export function adaptRunner(fn) {
  return async (ctx) => {
    const r = await fn(ctx);
    if (r && r.outputs) return r;
    const outputs = {};
    for (const p of ctx.ports?.outputs || []) {
      const path = ctx.outputs?.[p.id]?.path ?? null;
      if (path && p.type !== 'void') {
        await mkdir(dirname(path), { recursive: true });
        await writeFile(path, p.type === 'json' ? '{"ok":true}\n' : `# ${p.id}\n`, 'utf8');
      }
      outputs[p.id] = { path, type: p.type };
    }
    const verdict = r?.review
      ?? (r?.status === 'blocked'
        ? { issues: (r.issues || [{ severity: 'major' }]), summary: r.summary || '' }
        : (ctx.verdict ? { issues: [], summary: '' } : null));
    return { outputs, verdict, summary: r?.summary || '' };
  };
}

/** The two engines, in the shape a suite loops over. */
export const ENGINES = [
  {
    id: 'v1',
    workflowId: 'wf_default',
    create: (opts) => createOrchestrator(opts),
    /** Spy on the per-node ctx builder: v1's _nodeCtx(node, pos). */
    spyCtx: (orch, seen) => {
      const orig = orch._nodeCtx.bind(orch);
      orch._nodeCtx = (node, pos) => { const ctx = orig(node, pos); seen.push({ key: node.key, claudeOpts: ctx.claudeOpts || {} }); return ctx; };
    },
    /** The engine's resume-point shape (test/orchestrator-pause pins it). */
    expectResumePoint: (rp, { sessionId }) => {
      assert.equal(rp.version, 1);
      assert.equal(rp.kind, 'node');
      assert.ok(Array.isArray(rp.plan?.steps) && rp.plan.steps.length > 0, 'frozen plan stored');
      assert.ok(rp.bus && typeof rp.bus === 'object', 'bus snapshot stored');
      assert.ok(rp.nodes.some((n) => n.sessionId === sessionId), 'interrupted node session recorded');
    },
  },
  {
    id: 'graph',
    workflowId: 'wf_default_v2',
    create: (opts) => createGraphOrchestrator({
      ...opts,
      workflowId: opts.workflowId && opts.workflowId !== 'wf_default' ? opts.workflowId : 'wf_default_v2',
      runners: Object.fromEntries(Object.entries(opts.runners || {}).map(([k, fn]) => [k, adaptRunner(fn)])),
    }),
    /** Spy on the per-execution ctx builder: the graph engine's _execCtx(node, nc, args). */
    spyCtx: (orch, seen) => {
      const orig = orch._execCtx.bind(orch);
      orch._execCtx = (node, nc, args) => { const ctx = orig(node, nc, args); seen.push({ key: nc.key, claudeOpts: ctx.claudeOpts || {} }); return ctx; };
    },
    expectResumePoint: (rp, { sessionId }) => {
      assert.equal(rp.version, 2);
      assert.equal(rp.manifest?.version, 2, 'frozen manifest stored');
      assert.ok(rp.snapshot && Array.isArray(rp.snapshot.execs), 'scheduler snapshot stored');
      assert.ok(rp.nodes.some((n) => n.sessionId === sessionId && !n.completed), 'interrupted execution session recorded');
    },
  },
];
