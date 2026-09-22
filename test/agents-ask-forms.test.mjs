// test/agents-ask-forms.test.mjs
// Every BUILT-IN agent's ask forms must pass gate 1, and their D10 auto answer
// must pass gate 3 — the guarantee that `--yes` can never produce an invalid
// answer. Written as a sweep, not as one pin: it guards every future built-in
// form the same way. Plus the reference form's own shape (spec §10).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { loadAgentRegistry, DEFAULT_AGENTS_DIR } from '../src/core/agent-registry.mjs';
import { validateFormDef, normalizeAskBlock } from '../src/shared/forms/form-def.mjs';
import { autoAnswer, collectAnswer } from '../src/shared/forms/answer.mjs';
import { resolveAnswerSchema } from '../src/shared/forms/schema.mjs';

const registry = loadAgentRegistry(DEFAULT_AGENTS_DIR, { userAgentsDir: null, includePlugins: false });
const withForms = Object.values(registry).filter((m) => m.ask && m.ask.forms);

test('every built-in form passes gate 1', () => {
  const bad = [];
  for (const meta of withForms) {
    for (const [id, def] of Object.entries(meta.ask.forms)) {
      for (const e of validateFormDef(def, { id }).errors) {
        bad.push(`${meta.key}/${id}${e.path ? ` ${e.path}` : ''}: ${e.message}`);
      }
    }
  }
  assert.deepEqual(bad, []);
});

test('every built-in form’s AUTO answer passes gate 3 (D10)', () => {
  const bad = [];
  for (const meta of withForms) {
    for (const [id, def] of Object.entries(meta.ask.forms)) {
      const values = autoAnswer(def, def.example);
      const { errors } = collectAnswer(def, resolveAnswerSchema(def.answer, def.example), values);
      for (const e of errors) bad.push(`${meta.key}/${id} ${e.path}: ${e.message}`);
    }
  }
  assert.deepEqual(bad, [], 'auto mode must never be able to produce an invalid answer');
});

test('no built-in sidecar declares an ask block the normalizer would drop', () => {
  const bad = [];
  for (const f of readdirSync(DEFAULT_AGENTS_DIR).filter((n) => n.endsWith('.meta.json'))) {
    const raw = JSON.parse(readFileSync(join(DEFAULT_AGENTS_DIR, f), 'utf8'));
    if (raw.ask === undefined) continue;
    for (const d of normalizeAskBlock(raw.ask).dropped) bad.push(`agents/${f}: "${d.id}" ${d.reason}`);
  }
  assert.deepEqual(bad, []);
});

test('the reviewer ships review-findings, and it survives the registry normalizer', () => {
  const def = registry.reviewer.ask.forms['review-findings'];
  assert.ok(def, 'meta.ask must be in normalizeMeta’s fixed key set, or it is silently dropped');
  assert.equal(def.version, 1);
  assert.equal(def.title, 'Confirm these findings');
  // The whole point of the form: a per-item verdict over a LIST, which the
  // legacy `≤8 × single choice` shape cannot express.
  const item = def.layout.find((i) => i.widget === 'review-list');
  assert.ok(item, 'a review-list is what beats generic questions here');
  assert.equal(item.bind, 'data.findings');
  assert.equal(item.field, 'findings');
  assert.deepEqual(def.answer.properties.findings.items.properties.verdict.enum, ['keep', 'waive']);
  assert.equal(def.answer.properties.findings.items.properties.verdict.default, 'keep');
  assert.deepEqual(def.answer.required, ['findings']);
});

test('the reviewer’s auto answer KEEPS every finding', () => {
  const def = registry.reviewer.ask.forms['review-findings'];
  const values = autoAnswer(def, def.example);
  assert.equal(values.findings.length, def.example.findings.length);
  for (const f of values.findings) assert.equal(f.verdict, 'keep');
  assert.equal(values.notes, undefined, 'an optional free-text field is absent in auto, not empty');
});

test('the prompt tells the reviewer when and how to use the form', () => {
  const md = readFileSync(join(DEFAULT_AGENTS_DIR, 'worca-cc-code-reviewer.md'), 'utf8');
  assert.match(md, /review-findings/);
  assert.match(md, /"form"\s*:\s*"review-findings"/, 'the exact payload shape, not a paraphrase');
  assert.match(md, /waive/i);
  assert.doesNotMatch(md, /worca-cc /, 'user-facing prose says "worca"');
});
