// The mock's graph: dev's own renderer (ui/public/graph/view.mjs, the one the chat's workflow proposals draw with), on a
// workflow of the mock (Security-first review). Bundled to graph-mock.js for the file:// mock:
//   npx esbuild plans/rail/mocks/wave-3/graph-mock.mjs --bundle --format=iife --outfile=plans/rail/mocks/wave-3/graph-mock.js
import { mountStaticGraph } from '../../../../ui/public/graph/view.mjs';
import { buildGraphManifest, manifestPortsFn, manifestTemplate } from '../../../../src/shared/graph/manifest.mjs';
import { manifestAgents } from '../../../../ui/public/graph/run-decor.mjs';

const md = (id, extra = {}) => ({ id, type: 'md', ...extra });
const AGENTS = {
  planner: { key: 'planner', displayName: 'Planner', color: 'violet', inputs: [md('task', { required: true })], outputs: [md('plan', { when: 'always' })] },
  implementer: { key: 'implementer', displayName: 'Implementation', color: 'blue', inputs: [md('plan', { required: true }), md('findings', { required: false, loop: true })], outputs: [md('change', { when: 'always' })] },
  security: { key: 'security', displayName: 'Security review', color: 'amber', verdict: { filename: 's.json' }, inputs: [md('change', { required: true })], outputs: [md('findings', { when: 'blocking' }), md('clean', { when: 'clean' })] },
  reviewer: { key: 'reviewer', displayName: 'Review', color: 'green', verdict: { filename: 'r.json' }, inputs: [md('clean', { required: true })], outputs: [md('pass', { type: 'md', when: 'clean' })] },
};
const TPL = { id: 'wf_sec', name: 'Security-first review', version: 2, domain: 'coding',
  nodes: [{ id: 'n_task', kind: 'task', x: 40, y: 80, config: {} },
    { id: 'n_plan', kind: 'agent', key: 'planner', x: 300, y: 80, config: { model: 'claude-opus-5-5', effort: 'high' } },
    { id: 'n_build', kind: 'agent', key: 'implementer', x: 560, y: 80, config: { model: 'claude-sonnet-5-5', effort: 'high' } },
    { id: 'n_sec', kind: 'agent', key: 'security', x: 820, y: 80, config: { model: 'claude-opus-5-5', effort: 'high' } },
    { id: 'n_rev', kind: 'agent', key: 'reviewer', x: 1080, y: 80, config: { model: 'claude-opus-5-5', effort: 'medium' } },
    { id: 'n_end', kind: 'end', x: 1340, y: 80, config: {} }],
  wires: [{ id: 'w1', from: { node: 'n_task', port: 'task' }, to: { node: 'n_plan', port: 'task' } },
    { id: 'w2', from: { node: 'n_plan', port: 'plan' }, to: { node: 'n_build', port: 'plan' } },
    { id: 'w3', from: { node: 'n_build', port: 'change' }, to: { node: 'n_sec', port: 'change' } },
    { id: 'w4', from: { node: 'n_sec', port: 'findings' }, to: { node: 'n_build', port: 'findings' }, config: { maxCycles: 2 } },
    { id: 'w5', from: { node: 'n_sec', port: 'clean' }, to: { node: 'n_rev', port: 'clean' } },
    { id: 'w6', from: { node: 'n_rev', port: 'pass' }, to: { node: 'n_end', port: 'result' } }] };

window.mockGraph = (host, { width = 680, layout = 'auto' } = {}) => {
  const m = buildGraphManifest(TPL, AGENTS);
  return mountStaticGraph(host, manifestTemplate(m), { doc: document, portsFn: manifestPortsFn(m), agents: manifestAgents(m), width, layout });
};
