// test/workflow-fingerprint.test.mjs — a version's identity: graph shape + the content of the agents/scripts it uses.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { graphShape, workflowFingerprint } from '../src/core/workflow-fingerprint.mjs';
import { workflowParts } from '../src/core/workflow-parts.mjs';

const dirs = [];
after(() => Promise.all(dirs.map((d) => rm(d, { recursive: true, force: true }))));
const graph = () => ({
  nodes: [{ id: 'b', kind: 'agent', key: 'drafter', x: 5, y: 5, config: { model: 'opus' } },
    { id: 'a', kind: 'script', key: 'word-count', x: 0, y: 0, config: {} }],
  wires: [{ id: 'w', from: { node: 'a', port: 'out' }, to: { node: 'b', port: 'in' }, config: { maxCycles: 2 } }],
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

test('C1: the fingerprint sees a loop budget in the stored wire.config; config {} and missing are the same', () => {
  const base = workflowFingerprint(graph(), []);
  const seven = graph(); seven.wires[0].config = { maxCycles: 7 };
  assert.notEqual(workflowFingerprint(seven, []), base, 'a loop budget edit is a change');
  const clean = graph(); clean.wires[0].config = { maxCycles: 2, onExhausted: 'clean' };
  assert.notEqual(workflowFingerprint(clean, []), base, 'onExhausted is a change');
  const legacy = graph(); legacy.wires[0] = { id: 'w', from: legacy.wires[0].from, to: legacy.wires[0].to, maxCycles: 2 };
  assert.equal(workflowFingerprint(legacy, []), base, 'a top-level maxCycles reads the same as config.maxCycles');
  const empty = graph(); empty.nodes[1].config = undefined; empty.wires[0].config = { maxCycles: 2, onExhausted: null };
  assert.equal(workflowFingerprint(empty, []), base, 'config missing, {} and null-valued keys are the same');
  assert.deepEqual(graphShape(seven).wires[0].config, { maxCycles: 7 });
});

test('I1: a part hash is portable — moving the agent file or changing display fields keeps it; behaviour fields change it', async () => {
  const root = await mkdtemp(join(tmpdir(), 'wf-parts-move-')); dirs.push(root);
  const a = join(root, 'install-a', 'agents'); const b = join(root, 'elsewhere', 'b', 'agents');
  await mkdir(a, { recursive: true }); await mkdir(b, { recursive: true });
  const text = '---\nname: drafter\ntools: Read\n---\nWrite the brief.';
  await writeFile(join(a, 'drafter.md'), text); await writeFile(join(b, 'drafter.md'), text);
  const meta = (dir, over = {}) => ({
    key: 'drafter', origin: 'builtin', agentFile: 'drafter.md', agentPath: join(dir, 'drafter.md'),
    displayName: 'Drafter', description: 'Writes', color: 'blue', icon: '<path/>', order: 3, domain: 'coding', metaVersion: 2,
    portSummary: 'Reads task', runnerType: 'producer', fanOut: false, asksQuestions: false,
    inputs: [{ id: 'task', type: 'md', required: true }], outputs: [{ id: 'brief', type: 'md', when: 'always' }],
    frontmatter: { name: 'drafter', tools: ['Read'] }, ...over,
  });
  const script = (dir, over = {}) => ({
    key: 'word-count', origin: 'builtin', runtime: 'node', file: 'word-count.mjs', command: null, timeoutMs: 1000, params: [],
    scriptPath: join(dir, 'word-count.mjs'), scriptsDir: dir, commandResolved: `node ${join(dir, 'word-count.mjs')}`,
    displayName: 'Word count', color: 'green', icon: '<path/>', order: 1, ...over,
  });
  const src = async () => 'console.log(1)';
  const hashes = async (reg, scr) => (await workflowParts(graph(), { registry: { drafter: reg }, scripts: { 'word-count': scr }, scriptSource: src })).map((p) => p.hash);
  const here = await hashes(meta(a), script(a));
  assert.deepEqual(await hashes(meta(b), script(b)), here, 'another install path: same hashes');
  assert.deepEqual(await hashes(meta(b, { displayName: 'Draft', description: 'x', color: 'red', icon: '', order: 9, domain: 'general', portSummary: '' }),
    script(b, { displayName: 'Count', color: 'red', order: 7 })), here, 'display-only fields: same hashes');
  const ports = await hashes(meta(a, { outputs: [{ id: 'brief', type: 'json', when: 'always' }] }), script(a));
  assert.notEqual(ports[0], here[0], 'a port change is a change');
  const timeout = await hashes(meta(a), script(a, { timeoutMs: 5 }));
  assert.notEqual(timeout[1], here[1], 'a script setting is a change');
  await writeFile(join(b, 'drafter.md'), `${text} Name a goal.`);
  assert.notEqual((await hashes(meta(b), script(b)))[0], here[0], 'the agent text is a change');
});
