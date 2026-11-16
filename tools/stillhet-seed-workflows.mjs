#!/usr/bin/env node
// tools/stillhet-seed-workflows.mjs — real records for Stillhet's Workflows in the live kind (slice 7 D21): every state the
// place draws, made through dev's own routes (POST /api/workflows, /api/workflows/import-json, /api/agents, /api/scripts),
// and two finished mock runs written to the store so the usage figures read real rows. It feeds the one Expert walk at the
// end of the slice; the pixel compare stays demo against demo. Pinned by test/stillhet-seed-workflows.test.mjs.
import { fileURLToPath } from 'node:url';
import { SEED_TEMPLATES } from '../src/core/graph/seed-templates.mjs';

/** What is seeded: [key, what it shows, the dev route that reads it back]. */
export const SEEDED_WORKFLOWS = Object.freeze([
  Object.freeze({ key: 'own', what: 'an own workflow, one chain', id: 'wf_security-first-review', read: '/api/workflows/wf_security-first-review' }),
  Object.freeze({ key: 'imported', what: 'an imported workflow (the own one exported, then imported as a file)', id: 'wf_release-checklist', read: '/api/workflows/wf_release-checklist' }),
  Object.freeze({ key: 'branching', what: 'a branching workflow (an OR card: its steps branch)', id: 'wf_branching-review', read: '/api/workflows/wf_branching-review' }),
  Object.freeze({ key: 'loop', what: 'a workflow with a loop (Refine sends its plan back to itself)', id: 'wf_plan-with-a-loop', read: '/api/workflows/wf_plan-with-a-loop' }),
  Object.freeze({ key: 'used', what: 'a workflow used by two mock runs, one merged', id: 'wf_security-first-review', read: '/api/workflow-usage' }),
  Object.freeze({ key: 'agent', what: 'an own agent (its model and effort in its .md)', id: 'securityCheck', read: '/api/agents/securityCheck' }),
  Object.freeze({ key: 'script', what: 'an own script with 2 saved cases', id: 'diffGate', read: '/api/scripts/diffGate' }),
]);

const node = (id, kind, key, x, config = {}) => ({ id, kind, ...(key ? { key } : {}), x, y: 60, config });
const wire = (id, a, ap, b, bp, config) => ({ id, from: { node: a, port: ap }, to: { node: b, port: bp }, ...(config ? { config } : {}) });
// task → Clarify → Plan → end
const OWN = { version: 2, name: 'Security-first review', domain: 'coding',
  nodes: [node('n_task', 'task', null, 60), node('n_clar', 'agent', 'clarify', 360), node('n_plan', 'agent', 'planner', 660, { model: 'claude-opus-5-5', effort: 'high' }), node('n_end', 'end', null, 960)],
  wires: [wire('w1', 'n_task', 'task', 'n_clar', 'task'), wire('w2', 'n_task', 'task', 'n_plan', 'task'), wire('w3', 'n_clar', 'answers', 'n_plan', 'answers'), wire('w4', 'n_plan', 'plan', 'n_end', 'result')] };
// task → Plan → Refine (back to itself, twice at most) → end
const LOOP = { version: 2, name: 'Plan with a loop', domain: 'coding',
  nodes: [node('n_task', 'task', null, 60), node('n_plan', 'agent', 'planner', 360), node('n_ref', 'agent', 'refiner', 660), node('n_end', 'end', null, 960)],
  wires: [wire('w1', 'n_task', 'task', 'n_plan', 'task'), wire('w2', 'n_plan', 'plan', 'n_ref', 'plan'), wire('w3', 'n_ref', 'revise', 'n_ref', 'revise', { maxCycles: 2 }), wire('w4', 'n_ref', 'plan', 'n_end', 'result')] };
const FULL = SEED_TEMPLATES.find((t) => t.id === 'wf_full');
const BRANCHING = { version: 2, name: 'Branching review', domain: 'coding', nodes: structuredClone(FULL.nodes), wires: structuredClone(FULL.wires) };
const AGENT_MD = '---\nname: securityCheck\ndescription: Looks for trouble in the change: injection, secrets, unsafe input.\nmodel: claude-opus-5-5\neffort: high\n---\n\nYou check the change for security problems and block it when you find one.\n';
const AGENT_META = { metaVersion: 2, key: 'securityCheck', displayName: 'Security check', description: 'Looks for trouble in the change.', color: 'amber', runnerType: 'verifier', order: 60,
  verdict: { filename: 'security-check-cycle{cycle}.json' }, inputs: [{ id: 'plan', type: 'md' }, { id: 'done', type: 'void', required: false }],
  outputs: [{ id: 'review', type: 'md', when: 'blocking', filename: 'security-check-cycle{cycle}.md' }, { id: 'pass', type: 'void', when: 'clean' }] };
const SCRIPT_META = { metaVersion: 2, key: 'diffGate', displayName: 'Diff gate', description: 'Blocks the review when the diff touches more files than allowed', runtime: 'node',
  inputs: [], outputs: [{ id: 'log', type: 'md', when: 'always', filename: 'diff-gate-{cycle}.md' }] };
const SCRIPT_SRC = 'export default async function () {\n  return { summary: "the diff is small enough" };\n}\n';
const CASES = [{ id: 'small', name: 'A small diff', expect: { verdict: 'clean' } }, { id: 'tiny', name: 'A one-file diff', expect: { verdict: 'clean' } }];

/**
 * Seeds every record of SEEDED_WORKFLOWS through dev's routes at `base`; `db` (src/core/db.mjs getDb()) writes the two mock
 * runs the usage figures read. Throws on the first refused request, naming it.
 * @returns {Promise<{workflows: string[], agent: string, script: string, runs: string[]}>}
 */
export async function seedWorkflows({ base, db = null }) {
  const call = async (method, p, body) => {
    const r = await fetch(`${base}${p}`, { method, headers: { 'content-type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}) });
    const data = await r.json().catch(() => null);
    if (!r.ok) throw new Error(`${method} ${p}: HTTP ${r.status} ${JSON.stringify(data)}`);
    return data;
  };
  const own = (await call('POST', '/api/workflows', OWN)).workflow;
  const file = await (await fetch(`${base}/api/workflows/${own.id}/json`)).json();
  const imported = (await call('POST', '/api/workflows/import-json', { workflow: file, name: 'Release checklist' })).workflow;
  const branching = (await call('POST', '/api/workflows', BRANCHING)).workflow;
  const loop = (await call('POST', '/api/workflows', LOOP)).workflow;
  await call('POST', '/api/agents', { meta: AGENT_META, markdown: AGENT_MD });
  await call('POST', '/api/scripts', { meta: SCRIPT_META, source: SCRIPT_SRC });
  await call('PUT', `/api/scripts/${SCRIPT_META.key}/cases`, { cases: CASES });
  const runs = [];
  if (db) {
    const at = '2026-11-14T09:00:00.000Z', stepper = JSON.stringify({ template: { id: own.id, name: own.name } });
    for (const [id, pr] of [['seed-wf-run-1', 'MERGED'], ['seed-wf-run-2', 'OPEN']]) {
      db.prepare(`INSERT OR REPLACE INTO pipelines (id, project_key, target, title, status, phase, cycle, started_at, updated_at, stepper, pr_url, pr_state, total_cost_usd)
        VALUES (?, 'seed', 'project', ?, 'done', 'done', 1, ?, ?, ?, ?, ?, 0.7)`).run(id, `A mock run of ${own.name}`, at, at, stepper, `https://github.com/acme/web/pull/${runs.length + 1}`, pr);
      db.prepare(`INSERT OR REPLACE INTO pipeline_steps (pipeline_id, key, node_id, phase, step_index, cycle, status, active_ms, cost_usd)
        VALUES (?, '0:n_plan', 'n_plan', 'plan', 0, 1, 'done', 180000, 0.4)`).run(id);
      runs.push(id);
    }
  }
  return { workflows: [own.id, imported.id, branching.id, loop.id], agent: AGENT_META.key, script: SCRIPT_META.key, runs };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const base = process.argv[2] || 'http://127.0.0.1:4931';
  seedWorkflows({ base }).then((r) => console.log(`stillhet: seeded ${JSON.stringify(r)} (the usage rows need the in-process db)`)).catch((e) => { console.error(e.message); process.exit(1); });
}
