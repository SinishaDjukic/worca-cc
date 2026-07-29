// test/agent-registry-schema-v2.test.mjs
// Schema v2: optional uiPhase/channelDefs/promptHints/version fields, an OPEN
// channel vocabulary (custom ids in produces/consumes survive normalization),
// and collectChannelDefs() as the registry-wide channel definition collection.
// Backward compatible: the 11 shipped sidecars normalize exactly as before.
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

test('the 11 shipped sidecars are unchanged by v2 (backward compatibility)', () => {
  const reg = loadAgentRegistry(undefined, { userAgentsDir: null });
  assert.equal(Object.keys(reg).length, 11);
  for (const m of Object.values(reg)) {
    assert.deepEqual(m.channelDefs, [], `${m.key} has no channelDefs`);
    assert.equal(m.promptHints, '');
  }
  assert.deepEqual(reg.planner.consumes, ['userPrompt', 'clarify', 'review']);
  assert.deepEqual(reg.planner.produces, ['plan']);
});
