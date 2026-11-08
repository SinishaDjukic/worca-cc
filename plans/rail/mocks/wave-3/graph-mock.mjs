// The mock's graph: dev's own renderer (ui/public/graph/view.mjs, the one the chat's workflow proposals draw with), on a
// workflow of the mock (Security-first review). Bundled to graph-mock.js for the file:// mock:
//   npx esbuild plans/rail/mocks/wave-3/graph-mock.mjs --bundle --format=iife --outfile=plans/rail/mocks/wave-3/graph-mock.js
import { createGraphView } from '../../../../ui/public/graph/view.mjs';
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
  nodes: [{ id: 'n_task', kind: 'task', x: 40, y: 40, config: {} },
    { id: 'n_plan', kind: 'agent', key: 'planner', x: 320, y: 40, config: { model: 'claude-opus-5-5', effort: 'high' } },
    { id: 'n_build', kind: 'agent', key: 'implementer', x: 600, y: 40, config: { model: 'claude-sonnet-5-5', effort: 'high' } },
    { id: 'n_sec', kind: 'agent', key: 'security', x: 600, y: 280, config: { model: 'claude-opus-5-5', effort: 'high' } },
    { id: 'n_rev', kind: 'agent', key: 'reviewer', x: 880, y: 280, config: { model: 'claude-opus-5-5', effort: 'medium' } },
    { id: 'n_end', kind: 'end', x: 1160, y: 280, config: {} }],
  wires: [{ id: 'w1', from: { node: 'n_task', port: 'task' }, to: { node: 'n_plan', port: 'task' } },
    { id: 'w2', from: { node: 'n_plan', port: 'plan' }, to: { node: 'n_build', port: 'plan' } },
    { id: 'w3', from: { node: 'n_build', port: 'change' }, to: { node: 'n_sec', port: 'change' } },
    { id: 'w4', from: { node: 'n_sec', port: 'findings' }, to: { node: 'n_build', port: 'findings' }, config: { maxCycles: 2 } },
    { id: 'w5', from: { node: 'n_sec', port: 'clean' }, to: { node: 'n_rev', port: 'clean' } },
    { id: 'w6', from: { node: 'n_rev', port: 'pass' }, to: { node: 'n_end', port: 'result' } }] };

// plain words: each step's name, what it does, its model and effort in words (the skin's layer, not the engine's)
const DOES = { planner: 'Reads the task and the code; writes the plan', implementer: 'Changes the code to the plan; runs the tests', security: 'Looks for injection, secrets, unsafe input', reviewer: 'Reads the change against the plan' };
const MODELS = { 'claude-opus-5-5': 'Opus 5.5', 'claude-sonnet-5-5': 'Sonnet 5.5' };
window.mockGraph = (host, { width = 680, mode = 'static', select = '' } = {}) => {
  const m = buildGraphManifest(TPL, AGENTS), agents = manifestAgents(m);
  for (const k of Object.keys(agents)) agents[k].description = DOES[k] || '';
  const view = createGraphView(host, { doc: document, mode, portsFn: manifestPortsFn(m), agents, describe: true, modelLabel: (id) => MODELS[id] || id });
  view.render(manifestTemplate(m), {});
  const b = view.bounds(24); if (b) { host.style.width = `${width}px`; host.style.height = `${Math.ceil(b.h * Math.min(1, width / b.w)) + 8}px`; }
  view.fitToWidth(width);
  if (select) host.querySelector(`[data-node-id="${select}"]`)?.classList.add('is-picked');
  return view;
};
