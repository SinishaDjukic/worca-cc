// test/agent-registry-schema-v2.test.mjs
// The registry-wide channel view under sidecar meta v2. Channels are no longer
// authored: they are DERIVED from the sidecar's typed ports by the v1-compat
// shim, so the open channel vocabulary now means "a custom port id stays a
// custom channel", and channelDefs follow each non-void output's type +
// filename. collectChannelDefs() still merges them registry-wide.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadAgentRegistry, collectChannelDefs } from '../src/core/agent-registry.mjs';

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

test('custom port ids stay custom channels in the derived v1 view (open vocabulary)', () => {
  const dir = tmp();
  writeMeta(dir, 'specWriter', {
    inputs: [{ id: 'plan', type: 'md' }],
    outputs: [{ id: 'spec', type: 'md', filename: 'spec.md' }],
  });
  const m = load(dir).specWriter;
  assert.deepEqual(m.produces, ['spec']);
  assert.deepEqual(m.consumes, ['plan']);
});

test('a malformed port id fails validation: the sidecar is skipped with a warning naming it', () => {
  const dir = tmp();
  writeMeta(dir, 'bad', { outputs: [{ id: 'not a channel!', type: 'md', filename: 'x.md' }] });
  const warned = capturingWarnings(() => {
    assert.deepEqual(Object.keys(load(dir)), []);
  });
  assert.ok(warned.some((w) => /not a channel!/.test(w)), warned.join('; '));
});

test('channelDefs derive from the non-void outputs; built-in channels are never redefined', () => {
  const dir = tmp();
  writeMeta(dir, 'specWriter', {
    verdict: { filename: 'v.json' },
    outputs: [
      { id: 'spec', type: 'json', filename: 'api-spec.json' },
      { id: 'metrics', type: 'md', filename: 'metrics.md' },
      { id: 'plan', type: 'md', filename: '{base}.md' },  // built-in channel: no def needed
      { id: 'pass', type: 'void', when: 'clean' },         // void: no artifact, no def
    ],
  });
  assert.deepEqual(load(dir).specWriter.channelDefs, [
    { id: 'spec', kind: 'json', filename: 'api-spec.json' },
    { id: 'metrics', kind: 'md', filename: 'metrics.md' },
  ]);
});

test('promptHints surfaces; uiPhase is derived from the built-in key map; version is gone', () => {
  const dir = tmp();
  writeMeta(dir, 'implementer', { promptHints: 'Always cite file paths.', sideEffect: 'code', outputs: [{ id: 'done', type: 'void' }] });
  writeMeta(dir, 'b', {});
  const reg = load(dir);
  assert.equal(reg.implementer.promptHints, 'Always cite file paths.');
  assert.equal(reg.implementer.uiPhase, 'implement');
  assert.equal(reg.b.promptHints, '');
  assert.equal(reg.b.uiPhase, null, 'a custom key has no v1 stepper phase');
  assert.ok(!Object.hasOwn(reg.b, 'version'), 'the free-form version field is replaced by metaVersion');
  assert.equal(reg.b.metaVersion, 2);
});

test('collectChannelDefs merges registry-wide; first definition wins on conflict', () => {
  const dir = tmp();
  writeMeta(dir, 'a', { order: 1, outputs: [{ id: 'spec', type: 'json', filename: 's.json' }] });
  writeMeta(dir, 'b', {
    order: 2,
    outputs: [{ id: 'spec', type: 'md', filename: 'spec.md' }, { id: 'metrics', type: 'md', filename: 'metrics.md' }],
  });
  const warned = capturingWarnings(() => {
    assert.deepEqual(collectChannelDefs(load(dir)), {
      spec: { id: 'spec', kind: 'json', filename: 's.json' },
      metrics: { id: 'metrics', kind: 'md', filename: 'metrics.md' },
    });
  });
  assert.ok(warned.some((w) => /spec/.test(w) && /first definition wins/.test(w)), warned.join('; '));
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
