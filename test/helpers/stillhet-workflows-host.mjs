// test/helpers/stillhet-workflows-host.mjs — Stillhet's Workflows in the live kind (slice 7): dev's workflow, agent and
// script answers as a fake API (WF_LISTS), and a jsdom app host over it that records every request and stubs
// RailGraph.mount to record the workflow it is given.
import { SEED_TEMPLATES } from '../../src/core/graph/seed-templates.mjs';
import { GRAPH_DEFAULT_WORKFLOW } from '../../src/core/workflows.mjs';
import { loadAgentRegistry } from '../../src/core/agent-registry.mjs';
import { liveHost, LISTS, settle, go, clone, posts, toastText, saidText, closeHosts } from './stillhet-chat-live-host.mjs';
export { settle, go, clone, posts, toastText, saidText, closeHosts };

const REG = loadAgentRegistry(undefined, { userAgentsDir: null, includePlugins: false });
const USED = ['clarify', 'planner', 'refiner', 'decomposer', 'implementer', 'reviewer', 'manualTestsChecklist', 'manualWebUiTesting'];
// an own agent (origin user): its pickers and switches are drawn
export const SEC = { ...clone(REG.reviewer), key: 'sec', displayName: 'Security check', origin: 'user', asksQuestions: false, fanOut: false, frontmatter: { name: 'sec', model: 'claude-opus-5-5', effort: 'high' } };
export const SEC_MD = '---\nname: sec\ndescription: Looks for trouble.\nmodel: claude-opus-5-5\neffort: high\n---\n\nYou check the change for security problems.\n';
// task → Clarify → Plan → Refine → end, Refine sends its plan back to itself: one chain, own
const MINE = {
  id: 'wf_mine', name: 'Mine', version: 2, domain: 'coding', origin: null, createdAt: '2026-11-01T00:00:00.000Z', updatedAt: '2026-11-01T00:00:00.000Z', archivedAt: null,
  nodes: [{ id: 'n_task', kind: 'task', x: 60, y: 60, config: {} }, { id: 'n_clar', kind: 'agent', key: 'clarify', x: 360, y: 60, config: {} },
    { id: 'n_plan', kind: 'agent', key: 'planner', x: 660, y: 60, config: { model: 'claude-opus-5-5', effort: 'high' } }, { id: 'n_ref', kind: 'agent', key: 'refiner', x: 960, y: 60, config: {} },
    { id: 'n_end', kind: 'end', x: 1260, y: 60, config: {} }],
  wires: [{ id: 'w1', from: { node: 'n_task', port: 'task' }, to: { node: 'n_clar', port: 'task' } }, { id: 'w2', from: { node: 'n_task', port: 'task' }, to: { node: 'n_plan', port: 'task' } },
    { id: 'w3', from: { node: 'n_clar', port: 'answers' }, to: { node: 'n_plan', port: 'answers' } }, { id: 'w4', from: { node: 'n_plan', port: 'plan' }, to: { node: 'n_ref', port: 'plan' } },
    { id: 'w5', from: { node: 'n_ref', port: 'revise' }, to: { node: 'n_ref', port: 'revise' }, config: { maxCycles: 2 } }, { id: 'w6', from: { node: 'n_ref', port: 'plan' }, to: { node: 'n_end', port: 'result' } }],
};
const FULL = { ...clone(SEED_TEMPLATES.find((t) => t.id === 'wf_full')), origin: null, updatedAt: '2026-07-29T19:39:27.650Z', archivedAt: null };
export const wfTemplate = (id) => clone({ wf_mine: MINE, wf_full: FULL, wf_default: GRAPH_DEFAULT_WORKFLOW }[id]);
export const DIFF_GATE = { key: 'diffGate', displayName: 'Diff gate', origin: 'user', domain: 'coding', runtime: 'node', description: 'Blocks the review when the diff touches more files than allowed.', params: [{ id: 'max', type: 'number', label: 'Most files', default: 40 }], timeoutMs: 600000, caseCount: 2 };

// dev's GET answers, by URL
export const WF_LISTS = Object.freeze({
  '/api/workflows': { workflows: [wfTemplate('wf_default'), wfTemplate('wf_mine'), wfTemplate('wf_full')] },
  '/api/agents': { agents: [...USED.map((k) => clone(REG[k])), SEC], mockWriterRoles: [] },
  '/api/scripts': { scripts: [DIFF_GATE] },
  '/api/workflow-usage': { usage: { wf_full: { tasks: 2, merged: 50, running: 0, nodes: { n_plan: { costUsd: 0.3, minutes: 3 } } } } },
  '/api/chat-home/pins': { pins: ['wf_shape'] },
});

/** The live app host with the Workflows answers; `read`/`write` as liveHost's. Returns liveHost's answer plus `mounts`. */
export async function workflowsHost({ hash = '#workflows', read = () => null, write = () => [200, { ok: true }], lists = WF_LISTS, beforeScripts = () => {} } = {}) {
  const mounts = [];
  // GET /api/workflows/:id (Save's re-read, D9) answers the row from the list unless the test answers it
  const one = (u) => { const m = /^\/api\/workflows\/([^/?]+)$/.exec(u), t = m && (lists['/api/workflows']?.workflows || []).find((w) => w.id === decodeURIComponent(m[1])); return t ? [200, clone(t)] : null; };
  const h = await liveHost({ hash: '#chat', lists: { ...LISTS, ...clone(lists) }, read: async (u) => (await read(u)) || one(u), write, beforeScripts: (win) => { win.structuredClone ||= structuredClone; beforeScripts(win); } });   // jsdom has none; the page copies drafts with it
  // graph.js (the bundled renderer) is not among the host's scripts: the stub records what the page asks it to draw
  h.w.RailGraph = { ...(h.w.RailGraph || {}), mount: (host, wf, o) => { mounts.push({ wf, o }); return { g: null, view: null, fit: 1 }; }, align: (g) => g, build: () => ({}) };
  await go(h.w, hash, 200);
  await settle(200);
  return { ...h, mounts };
}
