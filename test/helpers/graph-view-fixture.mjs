// test/helpers/graph-view-fixture.mjs
// THE fixture every v2 canvas suite shares (view, composer editor). It lives in
// test/helpers/, NOT in a *.test.mjs file: node:test registers a test on module
// evaluation, so importing a test file for its fixtures re-runs that whole file.
//
// Two details are load-bearing:
//   · `verdict` — V13 rejects a `when:'blocking'` output on a node whose meta
//     carries no verdict, so without it the fixture is permanently invalid and
//     the Save button can never enable in any test.
//   · `review` is `md`, not `json` — the loop wire review→fix would trip V8.
import { JSDOM } from 'jsdom';

/** The proto fixture: Task(60,143) → Agent(400,80, 2 in / 2 out / await) → End(760,143). */
export function fixture() {
  return {
    id: 'wf_t', name: 'T', version: 2, domain: 'coding',
    nodes: [
      { id: 'n_task', kind: 'task', x: 60, y: 143, config: {} },
      { id: 'n_agent', kind: 'agent', key: 'planner', x: 400, y: 80, config: {} },
      { id: 'n_end', kind: 'end', x: 760, y: 143, config: {} },
    ],
    wires: [
      { id: 'w1', from: { node: 'n_task', port: 'task' }, to: { node: 'n_agent', port: 'task' } },
      { id: 'w2', from: { node: 'n_agent', port: 'plan' }, to: { node: 'n_end', port: 'result' } },
    ],
  };
}

/** fixture() + a second agent and the LOOP wire w4 (maxCycles 2 ⇒ it owns a badge
 *  host, which is what makes it the only legal target for setWireBadge). */
export function loopFixture() {
  const tpl = fixture();
  tpl.nodes.push({ id: 'n_rev', kind: 'agent', key: 'planner', x: 400, y: 400, config: {} });
  tpl.wires.push({ id: 'w3', from: { node: 'n_agent', port: 'plan' }, to: { node: 'n_rev', port: 'task' } });
  tpl.wires.push({ id: 'w4', from: { node: 'n_rev', port: 'review' }, to: { node: 'n_agent', port: 'fix' }, config: { maxCycles: 2 } });
  return tpl;
}

const BASE = {
  task: { inputs: [], outputs: [{ id: 'task', type: 'md', when: 'always' }] },
  agent: {
    inputs: [{ id: 'task', type: 'md', required: true }, { id: 'fix', type: 'md', required: false, loop: true }],
    outputs: [{ id: 'plan', type: 'md', when: 'always' }, { id: 'review', type: 'md', when: 'blocking' }],
  },
  end: { inputs: [{ id: 'result', type: 'any', required: true }], outputs: [] },
  and: { inputs: [], outputs: [{ id: 'out', type: 'void', when: 'always' }] },
};

/** Mirrors the engine's portsFn: agents gain the synthesized `await` input LAST
 *  and a `verdict` (V13's gate for conditional outputs — see the header note). */
export function portsFn(node) {
  const base = BASE[node.kind] || { inputs: [], outputs: [] };
  const inputs = base.inputs.map((p) => ({ ...p }));
  if (node.kind === 'and' || node.kind === 'or' || node.kind === 'combine') {
    const n = Number.isInteger(node.config?.arity) ? node.config.arity : 2;
    for (let i = 1; i <= n; i += 1) inputs.push({ id: `in${i}`, type: 'any', required: true });
  }
  const out = { inputs, outputs: base.outputs.map((p) => ({ ...p })), known: true, ported: true };
  if (node.kind === 'agent') {
    inputs.push({ id: 'await', type: 'any', required: false, synthetic: true });
    out.verdict = { filename: 'review-cycle{cycle}.json' };
  }
  return out;
}

export function boot() {
  const dom = new JSDOM('<!doctype html><body><div id="host"></div></body>', { url: 'http://localhost:4317/' });
  const q = [];
  const raf = (fn) => { q.push(fn); return q.length; };
  const flush = () => { const list = q.splice(0, q.length); for (const fn of list) fn(); return list.length; };
  return { dom, win: dom.window, doc: dom.window.document, host: dom.window.document.getElementById('host'), raf, flush, q };
}

export const AGENTS = { planner: { key: 'planner', displayName: 'Plan', color: 'violet', icon: '<path d="M4 4h8"/>', origin: 'builtin' } };
