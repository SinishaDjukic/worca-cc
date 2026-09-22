// test/plugin-validate-ask-forms.test.mjs
// `worca plugin validate` over a plugin that ships agent ask forms (spec §10):
// every shipped form goes through the SAME gate 1 the registry and the agent
// store apply. A bad form is a WARNING (the host already degrades to generic
// questions) and an ERROR under --strict, which is the author's gate. A plugin
// that declares forms without negotiating API 4 is warned about by name.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { validatePluginDir, ASK_NEEDS_API_4 } from '../src/core/plugin-manifest.mjs';

const scratch = [];
function mkPluginDir(files) {
  const dir = mkdtempSync(join(tmpdir(), 'worca-cc-askval-'));
  scratch.push(dir);
  for (const [rel, text] of Object.entries(files)) {
    const abs = join(dir, ...rel.split('/'));
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, text);
  }
  return dir;
}
process.on('exit', () => { for (const d of scratch) rmSync(d, { recursive: true, force: true, maxRetries: 3 }); });

const errs = (v) => v.problems.filter((p) => p.level === 'error').map((p) => p.message);
const warns = (v) => v.problems.filter((p) => p.level === 'warn').map((p) => p.message);

const GOOD_FORM = {
  version: 1,
  title: 'Pick one',
  data: { type: 'object', required: ['summary'], properties: { summary: { type: 'string', maxLength: 200 } } },
  answer: { type: 'object', required: ['verdict'], properties: { verdict: { type: 'string', enum: ['yes', 'no'] } } },
  layout: [
    { widget: 'markdown', bind: 'data.summary' },
    { widget: 'select', field: 'verdict', label: 'Verdict' },
  ],
  example: { summary: 'Something happened.' },
};

function sidecar(key, ask) {
  return JSON.stringify({
    metaVersion: 2, key, displayName: key, agentFile: `${key}.md`, runnerType: 'producer',
    inputs: [{ id: 'task', type: 'md' }],
    outputs: [{ id: 'notes', type: 'md', filename: 'notes.md' }],
    ...(ask ? { ask } : {}),
  });
}
function plugin(ask, { range = '>=4 <5' } = {}) {
  return mkPluginDir({
    'worca-cc-plugin.json': JSON.stringify({ name: 'p', engines: { 'worca-cc-api': range } }),
    'agents/helper.meta.json': sidecar('helper', ask),
    'agents/helper.md': '# helper\n',
  });
}

test('a valid form on an API-4 plugin validates clean, strict included', () => {
  const dir = plugin({ forms: { 'pick-one': GOOD_FORM } });
  const v = validatePluginDir(dir, { strict: true });
  assert.deepEqual(errs(v), []);
  assert.deepEqual(warns(v), []);
  assert.equal(v.ok, true);
});

test('a form that fails gate 1 is a WARNING, and an ERROR under --strict', () => {
  const bad = { ...GOOD_FORM, layout: [{ widget: 'grid', bind: 'data.summary' }, { widget: 'select', field: 'verdict', label: 'Verdict' }] };
  const dir = plugin({ forms: { 'pick-one': bad } });

  const lax = validatePluginDir(dir);
  assert.deepEqual(errs(lax), [], 'a bad form never blocks an install — the host degrades to generic questions');
  assert.ok(warns(lax).includes(
    'agents/helper.meta.json: ask.forms."pick-one" layout#1: "grid" is not in the catalog and has no usable fallback'),
    warns(lax).join('\n'));
  assert.equal(lax.ok, true);

  const strict = validatePluginDir(dir, { strict: true });
  assert.ok(errs(strict).some((e) => e.includes('ask.forms."pick-one"') && e.includes('grid')), errs(strict).join('\n'));
  assert.equal(strict.ok, false);
});

test('a bad form id is reported against that id, with P1\u2019s own sentence', () => {
  const dir = plugin({ forms: { 'Not An Id': GOOD_FORM } });
  const v = validatePluginDir(dir);
  assert.ok(warns(v).includes(
    'agents/helper.meta.json: ask.forms."Not An Id": form id "Not An Id" must match /^[a-z][a-z0-9-]{0,47}$/'),
    warns(v).join('\n'));
  assert.deepEqual(errs(v), []);
});

test('a whole-block refusal is ONE line against `ask`, with no per-form noise', () => {
  const dir = plugin({ notForms: {} });
  const v = validatePluginDir(dir);
  assert.deepEqual(warns(v), ['agents/helper.meta.json: ask: "ask" is { forms: { <id>: <form> } }']);
});

test('every failed rule is reported, not just the first', () => {
  // Verified against the executed gate 1: this def yields THREE errors —
  // layout#1 unknown-widget, layout#2 unknown-field, answer.verdict unreachable.
  const bad = {
    ...GOOD_FORM,
    layout: [{ widget: 'grid', bind: 'data.summary' }, { widget: 'select', field: 'nosuch', label: 'X' }],
  };
  const dir = plugin({ forms: { 'pick-one': bad } });
  const lines = warns(validatePluginDir(dir)).filter((w) => w.includes('ask.forms."pick-one"'));
  assert.equal(lines.length, 3, lines.join('\n'));
  assert.ok(lines.some((w) => w.includes('layout#2: "nosuch" is not an answer property')), lines.join('\n'));
  assert.ok(lines.some((w) => w.includes('answer.verdict: required field "verdict" has no input in the layout')), lines.join('\n'));
});

test('forms without API 4: one warning naming the API, never promoted by --strict', () => {
  const dir = plugin({ forms: { 'pick-one': GOOD_FORM } }, { range: '>=3 <4' });
  for (const strict of [false, true]) {
    const v = validatePluginDir(dir, { strict });
    assert.ok(warns(v).includes(`agents/helper.meta.json: ${ASK_NEEDS_API_4}`), warns(v).join('\n'));
    assert.deepEqual(errs(v), [], 'declaring an older API is a choice, not a defect');
  }
});

test('an agent with no ask block is untouched, and a non-object ask is ONE line', () => {
  assert.deepEqual(validatePluginDir(plugin(null), { strict: true }).problems, []);
  // Level is deliberately NOT pinned here: if P2's meta gate also rejects a
  // non-object `ask`, that is an error there and a warning here \u2014 what matters
  // is that the author gets exactly ONE line naming `ask`, never a cascade.
  const v = validatePluginDir(plugin('yes please'));
  const lines = v.problems.map((p) => p.message).filter((m) => m.includes('helper.meta.json') && m.includes('ask'));
  assert.equal(lines.length, 1, v.problems.map((p) => `${p.level}: ${p.message}`).join('\n'));
});

test('an EMPTY forms map below API 4 is silent: it loads as "no forms" and the host ignores nothing', () => {
  const v = validatePluginDir(plugin({ forms: {} }, { range: '>=3 <4' }), { strict: true });
  assert.deepEqual(v.problems, []);
});
