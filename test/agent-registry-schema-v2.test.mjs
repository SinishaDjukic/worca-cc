// test/agent-registry-schema-v2.test.mjs
// Schema v2: optional uiPhase/channelDefs/promptHints/version fields, an OPEN
// channel vocabulary (custom ids in produces/consumes survive normalization),
// and collectChannelDefs() as the registry-wide channel definition collection.
// Backward compatible: the 11 shipped sidecars normalize exactly as before.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { readdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadAgentRegistry, collectChannelDefs } from '../src/core/agent-registry.mjs';
import { validateMetaV2 } from '../src/shared/graph/agent-meta.mjs';
import { MOCK_WRITER_ROLES } from '../src/core/claude-runner.mjs';

const AGENTS_DIR = fileURLToPath(new URL('../agents/', import.meta.url));
const rawSidecars = () => readdirSync(AGENTS_DIR).filter((f) => f.endsWith('.meta.json'))
  .map((f) => JSON.parse(readFileSync(join(AGENTS_DIR, f), 'utf8')));

const scratch = [];
function tmp() { const d = mkdtempSync(join(tmpdir(), 'worca-cc-schema-')); scratch.push(d); return d; }
after(() => { for (const d of scratch) rmSync(d, { recursive: true, force: true }); });

function writeMeta(dir, key, fields) {
  writeFileSync(join(dir, `${key}.meta.json`), JSON.stringify({
    key, displayName: key, description: 'd', color: 'amber', icon: '<p/>', agentFile: null,
    runnerType: 'producer', loopSource: false, order: 1, connectsTo: '*',
    consumes: ['userPrompt'], produces: [], optionalConsumes: [], ...fields,
  }));
}
function load(dir) { return loadAgentRegistry(dir, { userAgentsDir: null }); }

test('custom channel ids in produces/consumes survive normalization (open vocabulary)', () => {
  const dir = tmp();
  writeMeta(dir, 'specWriter', { consumes: ['plan'], produces: ['spec'] });
  const m = load(dir).specWriter;
  assert.deepEqual(m.produces, ['spec']);
  assert.deepEqual(m.consumes, ['plan']);
});

test('a malformed channel id is still dropped with a warning', () => {
  const dir = tmp();
  writeMeta(dir, 'bad', { produces: ['ok-channel', 'not a channel!'] });
  const warned = [];
  const orig = console.warn;
  console.warn = (...a) => warned.push(a.join(' '));
  try {
    assert.deepEqual(load(dir).bad.produces, ['ok-channel']);
    assert.ok(warned.some((w) => /not a channel!/.test(w)));
  } finally { console.warn = orig; }
});

test('channelDefs normalize: kind defaults md, filename defaults <id>.<ext>, built-ins rejected, paths sanitized', () => {
  const dir = tmp();
  writeMeta(dir, 'specWriter', {
    produces: ['spec', 'metrics'],
    channelDefs: [
      { id: 'spec', kind: 'json', filename: 'api-spec.json' },
      { id: 'metrics' },                              // kind/filename defaulted
      { id: 'plan', kind: 'md' },                     // built-in: rejected
      { id: 'evil', filename: '../../etc/passwd' },   // path-y filename: defaulted
      { id: 'bad id!' },                              // malformed id: dropped
    ],
  });
  const defs = load(dir).specWriter.channelDefs;
  assert.deepEqual(defs, [
    { id: 'spec', kind: 'json', filename: 'api-spec.json' },
    { id: 'metrics', kind: 'md', filename: 'metrics.md' },
    { id: 'evil', kind: 'md', filename: 'evil.md' },
  ]);
});

test('uiPhase / promptHints / version surface with safe defaults', () => {
  const dir = tmp();
  writeMeta(dir, 'a', { uiPhase: ' spec ', promptHints: 'Always cite file paths.', version: 2 });
  writeMeta(dir, 'b', {});
  const reg = load(dir);
  assert.equal(reg.a.uiPhase, 'spec');
  assert.equal(reg.a.promptHints, 'Always cite file paths.');
  assert.equal(reg.a.version, '2');
  assert.equal(reg.b.uiPhase, null);
  assert.equal(reg.b.promptHints, '');
  assert.equal(reg.b.version, '1');
});

test('collectChannelDefs merges registry-wide; first definition wins on conflict', () => {
  const dir = tmp();
  writeMeta(dir, 'a', { order: 1, channelDefs: [{ id: 'spec', kind: 'json', filename: 's.json' }] });
  writeMeta(dir, 'b', { order: 2, channelDefs: [{ id: 'spec', kind: 'md' }, { id: 'metrics' }] });
  const defs = collectChannelDefs(load(dir));
  assert.deepEqual(defs, {
    spec: { id: 'spec', kind: 'json', filename: 's.json' },
    metrics: { id: 'metrics', kind: 'md', filename: 'metrics.md' },
  });
});

test('all 11 builtins validate as meta v2', () => {
  const raws = rawSidecars();
  assert.equal(raws.length, 11);
  for (const raw of raws) {
    assert.equal(raw.metaVersion, 2, `${raw.key} declares metaVersion 2`);
    assert.deepEqual(validateMetaV2(raw, { mockWriterRoles: MOCK_WRITER_ROLES }).errors, [], raw.key);
    assert.equal(MOCK_WRITER_ROLES.has(raw.mockRole), true, `${raw.key} names a real mock role`);
  }
});

test('the 11 shipped sidecars keep their v1 shape AND gain v2 ports (dual shape)', () => {
  const reg = loadAgentRegistry(undefined, { userAgentsDir: null });
  assert.equal(Object.keys(reg).length, 11);
  for (const m of Object.values(reg)) {
    assert.deepEqual(m.channelDefs, [], `${m.key} has no channelDefs`);
    assert.ok(Array.isArray(m.consumes) && m.consumes.length, `${m.key} keeps consumes`);
    assert.ok(Array.isArray(m.produces), `${m.key} keeps produces`);
    assert.equal(m.metaVersion, 2, `${m.key} merged v2`);
    assert.ok(Array.isArray(m.inputs) && m.inputs.length, `${m.key} has typed inputs`);
    assert.ok(Array.isArray(m.outputs) && m.outputs.length, `${m.key} has typed outputs`);
    assert.equal(typeof m.portSummary, 'string');
    assert.equal(m.inputs.some((p) => p.id === 'await'), false, 'await is synthesized, never declared');
  }
  assert.deepEqual(reg.planner.consumes, ['userPrompt', 'clarify', 'review']);
  assert.deepEqual(reg.planner.produces, ['plan']);
  // Exactly SIX builtins carry prompt hints; the other five stay empty (this
  // replaces the old "promptHints === '' for all 11" pin). `implementer` is one
  // of the six — spec §6's implementer row carries the hint (phases.mjs:836) and
  // P3's parity pins depend on it, so a "fix" that deletes the hint to make a
  // five-item list pass would break P3.
  assert.deepEqual(Object.values(reg).filter((m) => m.promptHints).map((m) => m.key).sort(),
    ['implementer', 'manualTestsChecklist', 'manualWebUiTesting', 'planReviewer', 'refiner', 'workspaceReviewer']);
  assert.deepEqual(reg.implementer.inputs.map((p) => p.id), ['fix', 'task', 'plan'],
    'the single-directive rule renders the FIRST fresh directive in DECLARED order');
  assert.equal(reg.reviewer.workspaceFanOut, undefined, 'the reviewer does not fan out per project');
  assert.equal(reg.workspaceReviewer.workspaceVariantOf, 'reviewer');
  assert.equal(reg.workspaceScanner.placeable, false);
});

// The v2 ports and the v1 channels describe the SAME data flow until P8 deletes
// the channel layer. This table is the mapping; the assertion below is what stops
// one side drifting from the other.
const PORT_CHANNELS = {
  clarify: { inputs: { task: 'userPrompt' }, outputs: { answers: 'clarify' } },
  planner: { inputs: { task: 'userPrompt', answers: 'clarify', revise: 'review' }, outputs: { plan: 'plan' } },
  refiner: { inputs: { plan: 'plan', revise: 'plan' }, outputs: { plan: 'plan', revise: 'plan' } },
  planReviewer: { inputs: { plan: 'plan' }, outputs: { review: 'review' } },
  decomposer: { inputs: { plan: 'plan' }, outputs: { tasks: 'decomposition' } },
  implementer: { inputs: { fix: 'review', task: 'decomposition', plan: 'plan' }, outputs: { done: 'code' } },
  reviewer: { inputs: { plan: 'plan', done: 'code' }, outputs: { review: 'review' } },
  workspaceReviewer: { inputs: { plan: 'plan', done: 'code' }, outputs: { review: 'review' } },
  manualTestsChecklist: { inputs: { plan: 'plan' }, outputs: { checklist: 'checklist' } },
  manualWebUiTesting: { inputs: { checklist: 'checklist' }, outputs: { review: 'review' } },
  workspaceScanner: { inputs: { task: 'userPrompt' }, outputs: { workspace: 'workspace' } },
};
// The only sanctioned asymmetries, each with its reason.
const CHANNEL_DELTA = {
  manualTestsChecklist: { missingIn: ['code'] },   // reads the diff from its cwd, not through a port
  manualWebUiTesting: { missingIn: ['code'] },     // drives the live app, not a port
  implementer: { extraIn: ['decomposition'] },     // the expands port; v1 modeled fan-out outside the channels
};

test('ports <-> channels consistency (dual-shape guard until the v1 kill list)', () => {
  const reg = loadAgentRegistry(undefined, { userAgentsDir: null });
  assert.deepEqual(Object.keys(PORT_CHANNELS).sort(), Object.keys(reg).sort());
  for (const [key, meta] of Object.entries(reg)) {
    const map = PORT_CHANNELS[key];
    const delta = CHANNEL_DELTA[key] || {};
    for (const p of meta.inputs) assert.ok(map.inputs[p.id], `${key}: input "${p.id}" is missing from PORT_CHANNELS`);
    for (const p of meta.outputs) {
      if (p.type === 'void' && !map.outputs[p.id]) continue;    // `pass` is a signal, not a channel
      assert.ok(map.outputs[p.id], `${key}: output "${p.id}" is missing from PORT_CHANNELS`);
    }
    const fromPorts = new Set(meta.inputs.map((p) => map.inputs[p.id]));
    const v1In = new Set(meta.consumes);
    assert.deepEqual([...v1In].filter((c) => !fromPorts.has(c)).sort(), (delta.missingIn || []).sort(), `${key} consumes`);
    assert.deepEqual([...fromPorts].filter((c) => !v1In.has(c)).sort(), (delta.extraIn || []).sort(), `${key} ports->consumes`);
    const outChannels = new Set(meta.outputs.map((p) => map.outputs[p.id]).filter(Boolean));
    if (meta.verdict) outChannels.add('review');   // the verdict JSON IS the v1 review channel
    assert.deepEqual([...outChannels].sort(), [...new Set(meta.produces)].sort(), `${key} produces`);
  }
});

test('normalizeMeta: a v2 sidecar merges, an invalid one is skipped, a v1 one has no ports', () => {
  const dir = tmp();
  writeMeta(dir, 'v1only', {});
  writeMeta(dir, 'ported', { metaVersion: 2, inputs: [{ id: 'plan', type: 'md' }],
    outputs: [{ id: 'notes', type: 'md', filename: 'notes.md' }], mockRole: 'generic-producer' });
  writeMeta(dir, 'broken', { metaVersion: 2, inputs: [{ id: 'await', type: 'md' }], outputs: [] });
  const warned = [];
  const orig = console.warn;
  console.warn = (...a) => warned.push(a.join(' '));
  let reg;
  try { reg = load(dir); } finally { console.warn = orig; }
  assert.equal(reg.v1only.metaVersion, undefined);
  assert.equal(reg.v1only.inputs, undefined, 'a v1 sidecar carries NO ports');
  assert.equal(reg.v1only.version, '1', 'the legacy string version field is not overloaded');
  assert.equal(reg.ported.metaVersion, 2);
  assert.deepEqual(reg.ported.inputs.map((p) => p.id), ['plan']);
  assert.equal(reg.ported.mockRole, 'generic-producer');
  assert.deepEqual(reg.ported.consumes, ['userPrompt'], 'the v1 fields survive the merge');
  assert.equal(reg.broken, undefined, 'an invalid v2 sidecar is skipped whole');
  assert.ok(warned.some((w) => /broken/.test(w) && /reserved/.test(w)), warned.join('\n'));
});
