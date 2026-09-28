// test/agent-ask-forms-meta.test.mjs
// Spec §3: the sidecar `ask` block rides the EXISTING builtin > user > plugin
// layering and onDrop diagnostics. normalizeAgentMeta returns a FIXED key set, so
// `ask` has to be added in BOTH twins (src/shared/graph/agent-meta.mjs and
// src/core/agent-registry.mjs) or it is silently dropped on the next save.
// Gate 1 itself is P1's; here we pin the WIRING: survive, drop, report, round-trip.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { normalizeAgentMeta, validateMetaV2 } from '../src/shared/graph/agent-meta.mjs';
import { loadAgentRegistry } from '../src/core/agent-registry.mjs';
import { createAgent, updateAgent, readAgent } from '../src/core/agent-store.mjs';
import { useTempHome } from './helpers/temp-home.mjs';

useTempHome(after);   // the store writes under <WORCA_HOME>/agents

const scratch = [];
function tmp(prefix) { const d = mkdtempSync(join(tmpdir(), prefix)); scratch.push(d); return d; }
after(() => { for (const d of scratch) rmSync(d, { recursive: true, force: true, maxRetries: 3 }); });

/** A form that passes gate 1: schemas inside the dialect, every field reachable,
 *  a mandatory `example` that validates against `data`. */
const GOOD_FORM = {
  version: 1,
  title: 'Review mockups',
  data: { type: 'object', required: ['summary'], properties: { summary: { type: 'string', maxLength: 8000 } } },
  answer: { type: 'object', required: ['verdict'],
    properties: { verdict: { type: 'string', enum: ['approve', 'changes'], default: 'approve' } } },
  layout: [
    { widget: 'markdown', bind: 'data.summary' },
    { widget: 'select', field: 'verdict', label: 'Verdict' },
  ],
  example: { summary: 'Two directions.' },
};

/** Fails gate 1: `widget: 'hologram'` is in no catalog and carries no fallback. */
const BAD_FORM = { ...GOOD_FORM, layout: [{ widget: 'hologram', field: 'verdict' }] };

const BASE = {
  key: 'mockReviewer', metaVersion: 2, displayName: 'Mock Reviewer', runnerType: 'producer',
  order: 99, inputs: [{ id: 'task', type: 'md' }],
  outputs: [{ id: 'notes', type: 'md', filename: 'notes.md' }],
};

test('a sidecar with NO ask block is byte-identical: no `ask` key at all', () => {
  const { meta, errors } = normalizeAgentMeta({ ...BASE });
  assert.deepEqual(errors, []);
  assert.equal('ask' in meta, false, 'an absent block must not become an empty one (the store diffs meta against the sidecar)');
});

test('a good form survives into meta.ask.forms', () => {
  const { meta, errors } = normalizeAgentMeta({ ...BASE, ask: { forms: { 'review-mockups': GOOD_FORM } } });
  assert.deepEqual(errors, []);
  assert.deepEqual(Object.keys(meta.ask.forms), ['review-mockups']);
  assert.equal(meta.ask.forms['review-mockups'].title, 'Review mockups');
});

test('a bad form is DROPPED, reported through onDropForm, and is never an error', () => {
  const dropped = [];
  const { meta, errors } = normalizeAgentMeta(
    { ...BASE, ask: { forms: { good: GOOD_FORM, bad: BAD_FORM } } },
    { onDropForm: (d) => dropped.push(d), warn: () => {} },
  );
  assert.deepEqual(errors, [], 'a failing form must not make the AGENT invalid (spec §5 gate 1)');
  assert.deepEqual(Object.keys(meta.ask.forms), ['good'], 'the surviving form stays usable');
  assert.equal(dropped.length, 1);
  assert.equal(dropped[0].formId, 'bad');
  assert.match(dropped[0].message, /^BAD_ASK_FORM: mockReviewer\/bad: .+/);
  assert.doesNotMatch(dropped[0].message, /\.$/, 'the reason is one line with no trailing period');
  assert.deepEqual(validateMetaV2({ ...BASE, ask: { forms: { bad: BAD_FORM } } }, { warn: () => {} }).errors, []);
});

test('every form dropped => NO ask key (an empty forms map is not a declaration)', () => {
  const { meta } = normalizeAgentMeta({ ...BASE, ask: { forms: { bad: BAD_FORM } } }, { warn: () => {} });
  assert.equal('ask' in meta, false);
});

test('WHOLE-BLOCK refusals carry P1\'s own reason strings, reported under id "*"', () => {
  const dropped = [];
  const collect = { onDropForm: (d) => dropped.push(d), warn: () => {} };
  normalizeAgentMeta({ ...BASE, ask: 'nope' }, collect);
  assert.equal(dropped[0].formId, '*');
  assert.equal(dropped[0].reason, '"ask" is { forms: { <id>: <form> } }');
  assert.equal(dropped[0].message, 'BAD_ASK_FORM: mockReviewer/*: "ask" is { forms: { <id>: <form> } }');
  dropped.length = 0;
  const huge = { ...GOOD_FORM, title: 'x'.repeat(70000) };
  normalizeAgentMeta({ ...BASE, ask: { forms: { huge } } }, collect);
  assert.equal(dropped[0].reason, '"ask" is larger than 65536 bytes');
  dropped.length = 0;
  const many = {};
  for (let i = 0; i < 10; i++) many[`form-${i}`] = GOOD_FORM;
  const { meta } = normalizeAgentMeta({ ...BASE, ask: { forms: many } }, collect);
  assert.equal(Object.keys(meta.ask.forms).length, 8, 'the first 8 survive');
  assert.deepEqual(dropped.map((d) => d.reason), ['more than 8 forms', 'more than 8 forms']);
  for (const d of dropped) assert.doesNotMatch(d.reason, /\.$/, 'one line, no trailing period');
});

test('`surface` rides through untouched — P2 stores it, P3/P4 branch on it (E19)', () => {
  const webOnly = { ...GOOD_FORM, surface: 'web' };
  const { meta, errors } = normalizeAgentMeta({ ...BASE, ask: { forms: { 'review-mockups': webOnly } } });
  assert.deepEqual(errors, []);
  assert.equal(meta.ask.forms['review-mockups'].surface, 'web');
  const plain = normalizeAgentMeta({ ...BASE, ask: { forms: { 'review-mockups': GOOD_FORM } } }).meta;
  assert.equal(plain.ask.forms['review-mockups'].surface, undefined,
    'the DEFAULT is applied at ask time (prepareFormAsk), not baked into the sidecar');
});

/** Write one agent layer entry: <key>.md + <key>.meta.json, the shape every write path uses. */
function writeAgent(dir, key, extra = {}) {
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, `${key}.md`), `# ${key}\n\nYou are the ${key} agent.\n`);
  writeFileSync(join(dir, `${key}.meta.json`), JSON.stringify({ ...BASE, key, agentFile: `${key}.md`, ...extra }, null, 2));
}

test('the REGISTRY keeps ask in its fixed key set and reports a drop through onDrop', () => {
  const builtin = tmp('worca-cc-askforms-');
  writeAgent(builtin, 'formAgent', { ask: { forms: { good: GOOD_FORM, bad: BAD_FORM } } });
  writeAgent(builtin, 'plainAgent', {});
  const drops = [];
  const warn = console.warn;
  console.warn = () => {};
  let reg;
  try {
    reg = loadAgentRegistry(builtin, { userAgentsDir: null, includePlugins: false, onDrop: (d) => drops.push(d) });
  } finally { console.warn = warn; }
  assert.deepEqual(Object.keys(reg.formAgent.ask.forms), ['good'], 'normalizeMeta must carry `ask` through its fixed key set');
  assert.equal('ask' in reg.plainAgent, false);
  const hit = drops.find((d) => /BAD_ASK_FORM/.test(d.reason));
  assert.ok(hit, `expected a BAD_ASK_FORM drop, got ${JSON.stringify(drops)}`);
  assert.equal(hit.origin, 'builtin');
  assert.equal(hit.file, 'formAgent.meta.json');
  assert.match(hit.reason, /^BAD_ASK_FORM: formAgent\/bad: /);
  assert.ok(reg.formAgent, 'the agent itself stays in the registry — it is usable with generic questions');
});

test('the user-agent STORE keeps `ask` on create and CLEARS it on a v2 update that omits it', async () => {
  const markdown = '# Form agent\n\nYou ask with forms.\n';
  const warn = console.warn;
  console.warn = () => {};
  try {
    const created = await createAgent({ meta: { ...BASE, key: 'storeFormAgent', ask: { forms: { good: GOOD_FORM } } }, markdown });
    assert.deepEqual(Object.keys(created.meta.ask.forms), ['good'], 'normalizeMeta carries the block into the sidecar');
    const { meta: read } = await readAgent('storeFormAgent');
    assert.deepEqual(Object.keys(read.ask.forms), ['good'], 'the sidecar on disk carries the block');
    const updated = await updateAgent('storeFormAgent', { meta: { ...BASE, key: 'storeFormAgent' } });
    assert.equal('ask' in updated.meta, false, 'a full v2 save that omits the block clears it (V2_CLEARABLE)');
  } finally { console.warn = warn; }
});
