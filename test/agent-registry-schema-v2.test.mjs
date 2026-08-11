// test/agent-registry-schema-v2.test.mjs
// Sidecar meta v2 at the registry level: a sidecar's typed PORTS are the whole
// artifact vocabulary. There is no channel layer left to derive — a custom port id
// is simply a custom port, carrying its own type and filename.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadAgentRegistry } from '../src/core/agent-registry.mjs';

const scratch = [];
function tmp() { const d = mkdtempSync(join(tmpdir(), 'worca-cc-schema-')); scratch.push(d); return d; }
after(() => { for (const d of scratch) rmSync(d, { recursive: true, force: true }); });

function writeMeta(dir, key, fields) {
  writeFileSync(join(dir, `${key}.meta.json`), JSON.stringify({
    metaVersion: 2,
    key, displayName: key, description: 'd', color: 'amber', icon: '<p/>', agentFile: null,
    runnerType: 'producer', order: 1,
    inputs: [{ id: 'task', type: 'md' }],
    outputs: [{ id: 'plan', type: 'md', filename: '{base}.md' }],
    ...fields,
  }));
}
function load(dir) { return loadAgentRegistry(dir, { userAgentsDir: null }); }

/** Run `fn` with console.warn captured; returns the joined warning lines. */
function capturingWarnings(fn) {
  const warned = [];
  const orig = console.warn;
  console.warn = (...a) => warned.push(a.join(' '));
  try { fn(); } finally { console.warn = orig; }
  return warned;
}

test('custom port ids survive verbatim (open vocabulary, no built-in list to pass)', () => {
  const dir = tmp();
  writeMeta(dir, 'specWriter', {
    inputs: [{ id: 'plan', type: 'md' }],
    outputs: [{ id: 'spec', type: 'md', filename: 'spec.md' }],
  });
  const m = load(dir).specWriter;
  assert.deepEqual(m.outputs.map((p) => p.id), ['spec']);
  assert.deepEqual(m.inputs.map((p) => p.id), ['plan']);
  assert.equal(m.outputs[0].filename, 'spec.md');
});

test('a malformed port id fails validation: the sidecar is skipped with a warning naming it', () => {
  const dir = tmp();
  writeMeta(dir, 'bad', { outputs: [{ id: 'not a channel!', type: 'md', filename: 'x.md' }] });
  const warned = capturingWarnings(() => {
    assert.deepEqual(Object.keys(load(dir)), []);
  });
  assert.ok(warned.some((w) => /not a channel!/.test(w)), warned.join('; '));
});

test('every output keeps its own type + filename; a void output carries no artifact', () => {
  const dir = tmp();
  writeMeta(dir, 'specWriter', {
    verdict: { filename: 'v.json' },
    outputs: [
      { id: 'spec', type: 'json', filename: 'api-spec.json' },
      { id: 'metrics', type: 'md', filename: 'metrics.md' },
      { id: 'plan', type: 'md', filename: '{base}.md' },
      { id: 'pass', type: 'void', when: 'clean' },         // void: no artifact
    ],
  });
  const outs = load(dir).specWriter.outputs;
  assert.deepEqual(outs.map((p) => [p.id, p.type, p.filename]), [
    ['spec', 'json', 'api-spec.json'],
    ['metrics', 'md', 'metrics.md'],
    ['plan', 'md', '{base}.md'],
    ['pass', 'void', undefined],
  ]);
});

test('promptHints surfaces; version is gone; no v1 phase is stamped', () => {
  const dir = tmp();
  writeMeta(dir, 'implementer', { promptHints: 'Always cite file paths.', sideEffect: 'code', outputs: [{ id: 'done', type: 'void' }] });
  writeMeta(dir, 'b', {});
  const reg = load(dir);
  assert.equal(reg.implementer.promptHints, 'Always cite file paths.');
  assert.equal(reg.b.promptHints, '');
  assert.ok(!Object.hasOwn(reg.implementer, 'uiPhase'), 'no key->phase map survives');
  assert.ok(!Object.hasOwn(reg.b, 'version'), 'the free-form version field is replaced by metaVersion');
  assert.equal(reg.b.metaVersion, 2);
});

test('the shipped agents/ dir loads clean — no skip warning, no coercion', () => {
  // Superseded the TEMPORARY "every sidecar is skipped" placeholder: the 11
  // builtins are meta v2 now. What they CONTAIN is the drift guard's job
  // (test/agents-sidecars-v2.test.mjs); this pins that they load SILENTLY.
  let reg;
  const warned = capturingWarnings(() => { reg = loadAgentRegistry(undefined, { userAgentsDir: null, includePlugins: false }); });
  assert.deepEqual(warned, [], 'a shipped sidecar must not warn at load');
  assert.equal(Object.keys(reg).length, 11);
});
