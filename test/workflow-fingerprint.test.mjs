// test/workflow-fingerprint.test.mjs — a version's identity: graph shape + the content of the agents/scripts it uses.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { graphShape, workflowFingerprint } from '../src/core/workflow-fingerprint.mjs';
import { workflowParts } from '../src/core/workflow-parts.mjs';

const dirs = [];
after(() => Promise.all(dirs.map((d) => rm(d, { recursive: true, force: true }))));
const graph = () => ({
  nodes: [{ id: 'b', kind: 'agent', key: 'drafter', x: 5, y: 5, config: { model: 'opus' } },
    { id: 'a', kind: 'script', key: 'word-count', x: 0, y: 0, config: {} }],
  wires: [{ id: 'w', from: { node: 'a', port: 'out' }, to: { node: 'b', port: 'in' }, maxCycles: 2 }],
  canvas: { zoom: 1 },
});

test('graphShape ignores layout and canvas and sorts by id', () => {
  const s = graphShape(graph());
  assert.deepEqual(s.nodes.map((n) => n.id), ['a', 'b']);
  assert.equal('x' in s.nodes[0] || 'canvas' in s, false);
});

test('the fingerprint changes with config and parts, not with layout', () => {
  const base = workflowFingerprint(graph(), []);
  assert.match(base, /^[0-9a-f]{16}$/);
  const moved = graph(); moved.nodes[0].x = 400; moved.canvas = { zoom: 2 };
  assert.equal(workflowFingerprint(moved, []), base);
  const tuned = graph(); tuned.nodes[0].config.model = 'sonnet';
  assert.notEqual(workflowFingerprint(tuned, []), base);
  assert.notEqual(workflowFingerprint(graph(), [{ kind: 'agent', key: 'drafter', origin: 'user', hash: '1' }]), base);
});

test('workflowParts hashes each agent file and script source once; an edit changes the hash', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'wf-parts-')); dirs.push(dir);
  const md = join(dir, 'drafter.md');
  await writeFile(md, 'Write the brief.');
  const registry = { drafter: { key: 'drafter', origin: 'user', agentPath: md } };
  const scripts = { 'word-count': { key: 'word-count', origin: 'builtin' } };
  const g2 = graph(); g2.nodes.push({ id: 'c', kind: 'agent', key: 'drafter', config: {} });
  const one = await workflowParts(g2, { registry, scripts, scriptSource: async () => 'echo 1' });
  assert.deepEqual(one.map((p) => `${p.kind}:${p.key}:${p.origin}`), ['agent:drafter:user', 'script:word-count:builtin']);
  await writeFile(md, 'Write the brief. Name a measurable goal.');
  const two = await workflowParts(g2, { registry, scripts, scriptSource: async () => 'echo 1' });
  assert.notEqual(two[0].hash, one[0].hash);
  assert.equal(two[1].hash, one[1].hash);
});
