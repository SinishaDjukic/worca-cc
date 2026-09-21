// test/helpers/graph-run.mjs
// Run a whole v2 graph offline: the real scheduler + the real executor, wired by the
// same ctx shape P4's GraphOrchestrator._execute will build (minus the ledger, the DB
// and the harness). Everything spawns through the offline mock (`claudeOpts.mock`).
import { join } from 'node:path';
import { createScheduler } from '../../src/core/graph/scheduler.mjs';
import {
  runExecution, allocateOutputs, allocateVerdict, expandsOutputPort,
  readDecomposition, publishable,
} from '../../src/core/graph/executor.mjs';
import { scriptNodeCtx } from '../../src/shared/graph/script-meta.mjs';

/**
 * @param {object} o
 * @param {object} o.template   a v2 template
 * @param {Function} o.portsFn  node -> ports
 * @param {Record<string,object>} o.registry  agent key -> normalized meta
 * @param {Record<string,object>} [o.scripts] script key -> normalized script meta
 * @param {(ask:object) => any} [o.answer]    answers clarify asks and gates
 * @returns {Promise<{result:string, state:object, events:object[], execSeq:string[], calls:object[]}>}
 */
export async function runGraphOffline({
  template, portsFn, registry = {}, scripts = {}, projectDir, pipelineDir,
  answer = (a) => (a.kind === 'gate' ? 'continue' : { answers: [] }),
  taskText = '# Task\n\nBUILD IT\n', maxParallel = 4, maxParallelScripts = 2,
}) {
  const events = [];
  const calls = [];
  let planVersion = 0;
  const keyCount = new Map();
  for (const n of template.nodes || []) {
    if (n.kind === 'agent' || n.kind === 'script') keyCount.set(n.key, (keyCount.get(n.key) || 0) + 1);
  }

  const execute = async (args) => {
    const node = args.node;
    const meta = (node.kind === 'script' ? scripts[node.key] : registry[node.key]) || {};
    const ports = portsFn(node) || {};          // for an agent this spreads the meta (ports.verdict rides along)
    const runCtx = {
      pipelineDir, projectDir, baseName: 'feature', datePrefix: '01-01-26',
      workspaceKey: null, duplicateKey: (keyCount.get(node.key) || 0) > 1,
      slice: args.slice?.id ?? null,
      planVersion: () => { planVersion += 1; return planVersion; },
    };
    const outputs = allocateOutputs({ node, ports, executionId: args.executionId, ordinal: args.ordinal, runCtx });
    const verdict = allocateVerdict({ node, ports, ordinal: args.ordinal, runCtx });
    calls.push({ nodeId: node.id, kind: node.kind, key: node.key ?? null, composite: args.composite ?? null, ordinal: args.ordinal });

    // The three composite arms the adapter owns (the scheduler drives them).
    if (args.composite === 'expand') {
      const doc = await readDecomposition(args.bindings[args.expandsPort]?.path);
      return {
        phases: doc.phases.map((ph) => ({
          ordinal: ph.ordinal,
          tasks: ph.tasks.map((t) => ({ ...t, path: join(pipelineDir, t.file) })),
        })),
      };
    }
    if (args.composite === 'phase') return {};
    if (args.composite === 'finish') return { outputs: publishable(ports, outputs) };

    const ctx = {
      node: {
        ...node,
        fanOut: !!meta.fanOut,
        agentPrompt: `You are ${meta.displayName || node.key || node.kind}.`,
        tools: [],
        promptHints: meta.promptHints,
      },
      nodeId: node.id, executionId: args.executionId, ordinal: args.ordinal, cycle: args.ordinal,
      bindings: args.bindings, trigger: args.trigger, signal: args.signal, slice: args.slice ?? null,
      template, portsFn, ports, meta, outputs, verdict,
      expandsPort: expandsOutputPort(template, portsFn, node.id),
      runCtx, taskArtifact: { text: taskText },
      projectDir, pipelineDir, taskPrompt: 'BUILD IT', toolInstruction: 'TOOLS',
      extras: [], workspace: null, agentPrompts: {}, checkpointRef: 'abc1234',
      claudeOpts: { mock: true },
      ask: async (a) => answer(a),
      // A script card's contract, the way _execCtx builds it (D12: cwd = projectDir).
      script: node.kind === 'script'
        ? (({ runtime, file, command, params, paramsPort, timeoutMs, mock }) => ({ meta, runtime, file, command, params, paramsPort, timeoutMs, mock }))(scriptNodeCtx(node, meta))
        : undefined,
      onEvent: (e) => events.push({ name: 'agent', nodeId: node.id, event: e }),
    };
    return runExecution(ctx);
  };

  const scheduler = createScheduler({
    template, portsFn, execute, maxParallel, maxParallelScripts,
    onEvent: (name, payload) => events.push({ name, ...payload }),
    onAsk: async (a) => answer(a),
  });
  const result = await scheduler.run();
  return {
    result,
    state: scheduler.getState(),
    events,
    calls,
    execSeq: events.filter((e) => e.name === 'exec' && e.status === 'start').map((e) => `${e.nodeId} c${e.ordinal}`),
  };
}
