// test/stillhet-workflow-draft.test.mjs — a Workflows draft (the prototype's tuples) back into dev's template on Save
// (Stillhet slice 7 D6, D7, D9, D15).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SEED_TEMPLATES } from '../src/core/graph/seed-templates.mjs';
import { loadAgentRegistry } from '../src/core/agent-registry.mjs';
import { validateGraph } from '../src/shared/graph/validate.mjs';
import { portsFnFor } from '../src/shared/graph/ports.mjs';
import { workflowOf } from '../ui/public/stillhet/live/workflow-map.mjs';
import { templateOfDraft, sameBase, withFrontmatter, draftOf, BRANCHES } from '../ui/public/stillhet/live/workflow-draft.mjs';

const agents = loadAgentRegistry(undefined, { userAgentsDir: null, includePlugins: false });
const portsFn = portsFnFor(agents);
// task → Plan → Build → Review → end, Review sends fixes back to Build
const mine = () => ({
  id: 'wf_mine', name: 'Mine', version: 2, domain: 'coding', origin: null, createdAt: '2026-11-01T00:00:00.000Z',
  nodes: [{ id: 'n_task', kind: 'task', x: 0, y: 0, config: {} },
    { id: 'n_plan', kind: 'agent', key: 'planner', x: 300, y: 0, config: {} },
    { id: 'n_impl', kind: 'agent', key: 'implementer', x: 600, y: 0, config: {} },
    { id: 'n_review', kind: 'agent', key: 'reviewer', x: 900, y: 0, config: {} },
    { id: 'n_end', kind: 'end', x: 1200, y: 0, config: {} }],
  wires: [{ id: 'w1', from: { node: 'n_task', port: 'task' }, to: { node: 'n_plan', port: 'task' } },
    { id: 'w2', from: { node: 'n_plan', port: 'plan' }, to: { node: 'n_impl', port: 'plan' } },
    { id: 'w3', from: { node: 'n_impl', port: 'done' }, to: { node: 'n_review', port: 'done' } },
    { id: 'w4', from: { node: 'n_plan', port: 'plan' }, to: { node: 'n_review', port: 'plan' } },
    { id: 'w5', from: { node: 'n_review', port: 'review' }, to: { node: 'n_impl', port: 'fix' }, config: { maxCycles: 3 } },
    { id: 'w6', from: { node: 'n_review', port: 'pass' }, to: { node: 'n_end', port: 'result' } }],
});
const base = (tpl = mine()) => workflowOf(tpl, { agentsByKey: agents });
const nodeOf = (tpl, id) => tpl.nodes.find((n) => n.id === id);

test('the fixture is a valid graph', () => {
  assert.deepEqual(validateGraph(mine(), portsFn).errors, []);
});

test('model, effort, loop rounds and a rename land in the template', () => {
  const b = base(), d = draftOf(b);
  d.title = 'Mine 2'; d.steps[0][2] = 'Sonnet 5.5'; d.steps[0][3] = 'high'; d.steps[1][0] = 'Make it'; d.loops[0][2] = 5;
  const r = templateOfDraft(b, d, { portsFn });
  assert.equal(r.ok, true, r.reason);
  assert.equal(r.tpl.name, 'Mine 2'); assert.equal(r.tpl.id, 'wf_mine');
  assert.deepEqual(nodeOf(r.tpl, 'n_plan').config, { model: 'claude-sonnet-5-5', effort: 'high' });
  assert.equal(nodeOf(r.tpl, 'n_impl').config.label, 'Make it');
  assert.deepEqual(r.tpl.wires.find((w) => w.id === 'w5').config, { maxCycles: 5 });
  assert.deepEqual(workflowOf({ ...r.tpl }, { agentsByKey: agents }).steps.map((s) => s[0]).slice(0, 2), [agents.planner.displayName, 'Make it']);
});

test('an unchanged draft gives back the same nodes and wires', () => {
  const b = base(), r = templateOfDraft(b, draftOf(b), { portsFn });
  assert.equal(r.ok, true);
  assert.equal(sameBase(r.tpl, b.tpl), true);
});

test('a step added after another is wired in between', () => {
  const t = mine();   // a two-step chain: task → Clarify → Plan → end
  t.nodes = [t.nodes[0], { id: 'n_clar', kind: 'agent', key: 'clarify', x: 300, y: 0, config: {} }, { id: 'n_plan', kind: 'agent', key: 'planner', x: 600, y: 0, config: {} }, t.nodes[4]];
  t.wires = [{ id: 'w1', from: { node: 'n_task', port: 'task' }, to: { node: 'n_plan', port: 'task' } }, { id: 'w2', from: { node: 'n_task', port: 'task' }, to: { node: 'n_clar', port: 'task' } },
    { id: 'w3', from: { node: 'n_clar', port: 'answers' }, to: { node: 'n_plan', port: 'answers' } }, { id: 'w4', from: { node: 'n_plan', port: 'plan' }, to: { node: 'n_end', port: 'result' } }];
  assert.deepEqual(validateGraph(t, portsFn).errors, []);
  const b = base(t), d = draftOf(b);
  d.steps.splice(2, 0, [agents.refiner.displayName, 'refiner', 'Opus 5.5', 'high', 3, 0.15]);
  const r = templateOfDraft(b, d, { portsFn });
  assert.equal(r.ok, true, r.reason);
  const added = r.tpl.nodes.find((n) => n.key === 'refiner');
  assert.ok(added && added.id.startsWith('n_'));
  assert.deepEqual(added.config, { model: 'claude-opus-5-5', effort: 'high' });
  const pairs = r.tpl.wires.map((w) => `${w.from.node}.${w.from.port}>${w.to.node}.${w.to.port}`);
  assert.ok(pairs.includes(`n_plan.plan>${added.id}.plan`), pairs.join(' '));
  assert.ok(pairs.includes(`${added.id}.plan>n_end.result`), pairs.join(' '));
  assert.ok(!pairs.includes('n_plan.plan>n_end.result'));
});

// task → Clarify → Plan → Refine → end: one chain (Plan feeds only Refine), Refine sends its plan back to itself
const chainTpl = () => ({
  id: 'wf_chain', name: 'Chain', version: 2, domain: 'coding', origin: null, createdAt: '2026-11-01T00:00:00.000Z',
  nodes: [{ id: 'n_task', kind: 'task', x: 0, y: 0, config: {} }, { id: 'n_clar', kind: 'agent', key: 'clarify', x: 300, y: 0, config: {} },
    { id: 'n_plan', kind: 'agent', key: 'planner', x: 600, y: 0, config: {} }, { id: 'n_ref', kind: 'agent', key: 'refiner', x: 900, y: 0, config: {} }, { id: 'n_end', kind: 'end', x: 1200, y: 0, config: {} }],
  wires: [{ id: 'w1', from: { node: 'n_task', port: 'task' }, to: { node: 'n_clar', port: 'task' } }, { id: 'w2', from: { node: 'n_task', port: 'task' }, to: { node: 'n_plan', port: 'task' } },
    { id: 'w3', from: { node: 'n_clar', port: 'answers' }, to: { node: 'n_plan', port: 'answers' } }, { id: 'w4', from: { node: 'n_plan', port: 'plan' }, to: { node: 'n_ref', port: 'plan' } },
    { id: 'w5', from: { node: 'n_ref', port: 'revise' }, to: { node: 'n_ref', port: 'revise' }, config: { maxCycles: 2 } }, { id: 'w6', from: { node: 'n_ref', port: 'plan' }, to: { node: 'n_end', port: 'result' } }],
});

test('a removed step: its predecessor is wired to its successor', () => {
  const t = chainTpl();
  assert.deepEqual(validateGraph(t, portsFn).errors, []);
  const b = base(t), d = draftOf(b);
  assert.equal(b.chain, true);
  d.steps.splice(2, 1); d.loops = [];   // Refine goes, and its loop with it
  const r = templateOfDraft(b, d, { portsFn });
  assert.equal(r.ok, true, r.reason);
  assert.ok(!r.tpl.nodes.some((n) => n.id === 'n_ref'));
  assert.ok(r.tpl.wires.some((w) => w.from.node === 'n_plan' && w.from.port === 'plan' && w.to.node === 'n_end'));
});

test('structural edits on a branching workflow (chain:false) are refused with the D7 reason; model changes pass', () => {
  const full = SEED_TEMPLATES.find((x) => x.id === 'wf_full'), b = base(structuredClone(full));
  assert.equal(b.chain, false);
  const d = draftOf(b); d.steps.splice(1, 1);
  assert.deepEqual(templateOfDraft(b, d, { portsFn }), { ok: false, reason: BRANCHES });
  assert.equal(BRANCHES, 'its steps branch; change it in a chat');
  const d2 = draftOf(b); d2.steps[1][2] = 'Haiku 5.5';
  assert.equal(templateOfDraft(b, d2, { portsFn }).ok, true);
});

test('an invalid graph is refused with validateGraph\'s first message', () => {
  const b = base(chainTpl()), d = draftOf(b);
  d.steps.splice(0, 1);   // Clarify gone: the task's words would go into Plan's answers (md into json)
  const r = templateOfDraft(b, d, { portsFn });
  assert.equal(r.ok, false);
  assert.match(r.reason, /md.*json|json.*md/);
});

test('sameBase is false after a server-side wire change', () => {
  const a = mine(), b = mine();
  assert.equal(sameBase(a, b), true);
  b.wires[4].config.maxCycles = 2;
  assert.equal(sameBase(a, b), false);
  assert.equal(sameBase(a, { ...mine(), name: 'Other' }), false);
  assert.equal(sameBase(a, { ...mine(), updatedAt: 'x' }), true, 'only name, nodes and wires count');
});

test('withFrontmatter sets model: and effort: and keeps every other byte', () => {
  const md = '---\nname: sec\ndescription: Checks it.\nmodel: inherit\ntools: Read\n---\n\nBody line\n';
  assert.equal(withFrontmatter(md, { model: 'claude-opus-5-5', effort: 'high' }), '---\nname: sec\ndescription: Checks it.\nmodel: claude-opus-5-5\ntools: Read\neffort: high\n---\n\nBody line\n');
  assert.equal(withFrontmatter(md, {}), md);
  assert.equal(withFrontmatter('Just a body\n', { model: 'm' }), '---\nmodel: m\n---\nJust a body\n');
  const crlf = '---\r\nname: a\r\n---\r\nB\r\n';
  assert.equal(withFrontmatter(crlf, { effort: 'low' }), '---\r\nname: a\r\neffort: low\r\n---\r\nB\r\n');
});

test('a step added after a reload never reuses a saved node id', async () => {
  const { newStepId } = await import('../ui/public/stillhet/live/workflow-draft.mjs');
  const t = mine(); t.nodes.push({ id: 'n_new1', kind: 'agent', key: 'reviewer', x: 1200, y: 0, config: {} });   // saved before the reload
  const x = workflowOf(t, { agentsByKey: agents });
  const id = newStepId(x, draftOf(x).steps);
  assert.equal(id, 'n_new2');
  const d = draftOf(x); d.steps.push(['Security', 'reviewer', '', '', 0, 0, undefined, undefined, undefined, id]);
  assert.equal(newStepId(x, d.steps), 'n_new3', 'and never one the draft already took');
  assert.equal(newStepId({ ...x, tpl: mine(), draft: { base: t } }, []), 'n_new2', 'the draft\'s base counts too');
});
