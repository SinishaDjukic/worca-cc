// test/builtin-workflows-no-model-pins.test.mjs — the built-in graphs pin no model: every model a built-in runs on comes
// from a Models page home, else Worca's factory default (src/core/factory-models.mjs). Walks the graph OBJECTS
// (readWorkflow), so a value built through a constant is caught too.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { useTempHome } from './helpers/temp-home.mjs';
import { readWorkflow } from '../src/core/workflows.mjs';
import { RESERVED_WORKFLOW_IDS, SHAPE_REQ_WORKFLOW_IDS, SHAPE_SLICE_REQ_WORKFLOW_IDS, AUTO_WORKFLOW_ID } from '../src/core/graph/builtin-workflows.mjs';

useTempHome(after);

const MODEL_RE = /claude-|\bsonnet\b|\bopus\b|\bhaiku\b/i;
// The one allowed pin, with its reason: Lean's planner research lanes. On a routed node the sub-agent alias is swapped
// for the same endpoint (phases.mjs sameEndpointSubagentDirective) and the tier aliases map to it (model-env.mjs
// withTierModelEnv), so it works on a Copilot-only, signed-out install and stays as it is.
const ALLOW = new Set(['wf_lean_build/n_plan/subagentModel']);

/** Every [path, key, value] under a config, at any depth. */
function* walk(value, path) {
  if (!value || typeof value !== 'object') return;
  for (const [k, v] of Object.entries(value)) {
    yield [`${path}/${k}`, k, v];
    yield* walk(v, `${path}/${k}`);
  }
}

test('no built-in agent config names a model or an effort (Lean\'s planner sub-agent alias excepted)', async () => {
  const ids = [...RESERVED_WORKFLOW_IDS.filter((id) => id !== AUTO_WORKFLOW_ID), ...SHAPE_REQ_WORKFLOW_IDS, ...SHAPE_SLICE_REQ_WORKFLOW_IDS];
  const hits = [];
  let agents = 0;
  for (const id of ids) {
    const wf = await readWorkflow(id);
    assert.ok(wf && Array.isArray(wf.nodes), id);
    for (const n of wf.nodes.filter((x) => x.kind === 'agent')) {
      agents += 1;
      for (const [path, key, v] of walk(n.config, `${id}/${n.id}`)) {
        const at = path.replace(/\/roleReview\/roles\/\d+/, '/roleReview/roles');
        if (ALLOW.has(at)) continue;
        if (key === 'model' || key === 'effort') hits.push(`${path}: a ${key} key`);
        else if (typeof v === 'string' && MODEL_RE.test(v)) hits.push(`${path}: "${v}"`);
      }
    }
  }
  assert.ok(agents > 20, `walked ${agents} agent nodes`);
  assert.deepEqual(hits, [], hits.join('\n'));
  const lean = (await readWorkflow('wf_lean_build')).nodes.find((n) => n.id === 'n_plan');
  assert.equal(lean.config.subagentModel, 'sonnet', 'the allow-entry is still the one pin');
});

test('Shaper names its second opinion instead of pinning it', async () => {
  for (const id of ['wf_shape', 'wf_shape_ux', ...SHAPE_REQ_WORKFLOW_IDS]) {
    const roles = (await readWorkflow(id)).nodes.find((n) => n.id === 'n_roles');
    assert.equal(roles.config.roleReview.secondOpinion, 'product', id);
  }
});
