// test/helpers/engines.mjs
// One test body, one engine (the v1 arm died with the v1 engine). The v1-shaped
// stub-runner ABI ({status, issues, review, summary}) the suites are written in
// is still adapted to the v2 executor ABI ({outputs, verdict, summary}), so the
// suites themselves did not have to be rewritten.
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
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

/** The ONE engine, still in the shape a suite loops over: the dual-engine
 *  parametrization collapsed with the v1 engine, and keeping the array keeps
 *  every consumer's `for (const engine of ENGINES)` body byte-identical. */
export const ENGINES = [
  {
    id: 'graph',
    workflowId: 'wf_default',
    create: (opts) => createGraphOrchestrator({
      ...opts,
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
