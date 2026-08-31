// test/agent-registry-schema-v2.test.mjs
// Schema v2: the optional promptHints field and the typed input/output ports —
// the ONLY wiring vocabulary a sidecar has since the v1 kill list. An un-ported
// sidecar still loads (it just carries no ports, and resolveGraph refuses it).
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { readdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadAgentRegistry } from '../src/core/agent-registry.mjs';
import { validateMetaV2, DEFAULT_ORDER } from '../src/shared/graph/agent-meta.mjs';
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

test('promptHints surfaces with a safe default; the v1 uiPhase/version fields do not surface at all', () => {
  const dir = tmp();
  writeMeta(dir, 'a', { uiPhase: ' spec ', promptHints: 'Always cite file paths.', version: 2 });
  writeMeta(dir, 'b', {});
  const reg = load(dir);
  assert.equal(reg.a.promptHints, 'Always cite file paths.');
  assert.equal(reg.b.promptHints, '');
  for (const k of ['uiPhase', 'version', 'channelDefs', 'consumes', 'produces', 'connectsTo', 'loopSource']) {
    assert.equal(k in reg.a, false, `the v1 field "${k}" must not survive normalizeMeta`);
  }
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

test('the 11 shipped sidecars are pure meta v2 — typed ports and nothing v1', () => {
  const reg = loadAgentRegistry(undefined, { userAgentsDir: null });
  assert.equal(Object.keys(reg).length, 11);
  for (const m of Object.values(reg)) {
    for (const k of ['consumes', 'optionalConsumes', 'produces', 'connectsTo', 'loopSource', 'uiPhase', 'channelDefs']) {
      assert.equal(k in m, false, `${m.key} still carries the v1 field "${k}"`);
    }
    assert.equal(m.metaVersion, 2, `${m.key} merged v2`);
    assert.ok(Array.isArray(m.inputs) && m.inputs.length, `${m.key} has typed inputs`);
    assert.ok(Array.isArray(m.outputs) && m.outputs.length, `${m.key} has typed outputs`);
    assert.equal(typeof m.portSummary, 'string');
    assert.equal(m.inputs.some((p) => p.id === 'await'), false, 'await is synthesized, never declared');
  }
  // Exactly NINE builtins carry prompt hints; clarify and workspaceScanner stay
  // empty (clarify's v1 sentences are the executor's clarifier base instruction,
  // the scanner has no v2 prompt). P3's prompt-parity suite pins every one of these
  // hints byte-for-byte against dev phases.mjs — a "fix" that deletes a hint to
  // shorten this list breaks test/graph-prompt-parity.test.mjs.
  assert.deepEqual(Object.values(reg).filter((m) => m.promptHints).map((m) => m.key).sort(),
    ['decomposer', 'implementer', 'manualTestsChecklist', 'manualWebUiTesting', 'planReviewer',
      'planner', 'refiner', 'reviewer', 'workspaceReviewer']);
  assert.deepEqual(reg.implementer.inputs.map((p) => p.id), ['fix', 'task', 'plan'],
    'the single-directive rule renders the FIRST fresh directive in DECLARED order');
  assert.equal(reg.reviewer.workspaceFanOut, undefined, 'the reviewer does not fan out per project');
  assert.equal(reg.workspaceReviewer.workspaceVariantOf, 'reviewer');
  assert.equal(reg.workspaceScanner.placeable, false);
});

test('normalizeMeta: a v2 sidecar merges, an invalid one is skipped, an un-ported one has no ports', () => {
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
  assert.equal(reg.v1only.inputs, undefined, 'an un-ported sidecar carries NO ports');
  assert.equal(reg.ported.metaVersion, 2);
  assert.deepEqual(reg.ported.inputs.map((p) => p.id), ['plan']);
  assert.equal(reg.ported.mockRole, 'generic-producer');
  assert.equal('consumes' in reg.ported, false, 'the v1 fields are no longer derived');
  assert.equal(reg.broken, undefined, 'an invalid v2 sidecar is skipped whole');
  assert.ok(warned.some((w) => /broken/.test(w) && /reserved/.test(w)), warned.join('\n'));
});

test('a v2 sidecar with no `order` is backfilled to DEFAULT_ORDER, not silently dropped', () => {
  const dir = tmp();
  writeMeta(dir, 'noOrder', {
    metaVersion: 2, order: undefined, mockRole: 'generic-producer',
    inputs: [{ id: 'task', type: 'md' }],
    outputs: [{ id: 'out', type: 'md', filename: '{base}.md', store: 'project' }],
  });
  // The plugin validator certifies this exact sidecar (zero errors) …
  const raw = JSON.parse(readFileSync(join(dir, 'noOrder.meta.json'), 'utf8'));
  assert.equal('order' in raw, false, 'the fixture really omits order');
  assert.deepEqual(validateMetaV2(raw, { mockWriterRoles: MOCK_WRITER_ROLES }).errors, []);
  const warned = [];
  const orig = console.warn;
  console.warn = (...a) => warned.push(a.join(' '));
  let reg;
  try { reg = load(dir); } finally { console.warn = orig; }
  // … so the loader must agree with it instead of dropping the agent, which made
  // every node referencing it fail V4 with "unknown agent".
  assert.ok(reg.noOrder, `the agent must reach the registry; warnings: ${warned.join('\n')}`);
  assert.equal(reg.noOrder.order, DEFAULT_ORDER);
  assert.equal(DEFAULT_ORDER, 999, 'the two normalizers share one default');
  assert.equal(reg.noOrder.metaVersion, 2);
});

test('a sidecar whose `order` is present but non-numeric is still skipped — and says so', () => {
  const dir = tmp();
  writeMeta(dir, 'badOrder', { order: 'soon' });
  const warned = [];
  const orig = console.warn;
  console.warn = (...a) => warned.push(a.join(' '));
  let reg;
  try { reg = load(dir); } finally { console.warn = orig; }
  assert.equal(reg.badOrder, undefined, 'a malformed order still fails safe to a skip');
  assert.ok(warned.some((w) => /badOrder/.test(w) && /order/.test(w)),
    `the skip must be loud like the key branch; got: ${JSON.stringify(warned)}`);
});
