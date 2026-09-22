// test/plugin-inventory-ask-forms.test.mjs
// Consent (spec §10): before anything is installed, the inventory says which
// agents ask through FORMS and which file types those forms may display from
// the run folder. Derived from the sidecar's data schemas alone — no plugin
// code runs, and no instance data exists at this point.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { useTempHome } from './helpers/temp-home.mjs';
import { buildInstallInventory } from '../src/core/plugin-store.mjs';

useTempHome(after);

const scratch = [];
function mkDir(files) {
  const dir = mkdtempSync(join(tmpdir(), 'worca-cc-askinv-'));
  scratch.push(dir);
  for (const [rel, text] of Object.entries(files)) {
    const abs = join(dir, ...rel.split('/'));
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, text);
  }
  return dir;
}
after(() => { for (const d of scratch) rmSync(d, { recursive: true, force: true, maxRetries: 3 }); });

const PICK_ONE = {
  version: 1, title: 'Pick one',
  data: { type: 'object', required: ['summary'], properties: { summary: { type: 'string', maxLength: 200 } } },
  answer: { type: 'object', required: ['verdict'], properties: { verdict: { type: 'string', enum: ['yes', 'no'] } } },
  layout: [{ widget: 'markdown', bind: 'data.summary' }, { widget: 'select', field: 'verdict', label: 'Verdict' }],
  example: { summary: 'Something happened.' },
};
const REVIEW_MOCKUPS = {
  version: 1, title: 'Review mockups',
  data: { type: 'object', required: ['images'], properties: {
    images: { type: 'array', maxItems: 12, items: { type: 'object', required: ['id', 'file'], properties: {
      id: { type: 'string' },
      file: { type: 'file', accept: ['image/*', 'application/pdf'] } } } } } },
  answer: { type: 'object', required: ['picked'], properties: {
    picked: { type: 'string', enumFrom: 'data.images[].id' } } },
  layout: [{ widget: 'gallery', bind: 'data.images', field: 'picked' }],
  example: { images: [{ id: 'a', file: 'mockups/a.png' }] },
};

const sidecar = (key, ask) => JSON.stringify({
  metaVersion: 2, key, displayName: key, agentFile: `${key}.md`, runnerType: 'producer',
  inputs: [{ id: 'task', type: 'md' }], outputs: [{ id: 'notes', type: 'md', filename: 'notes.md' }],
  ...(ask ? { ask } : {}),
});

test('an agent with forms carries the ids and the file types it may display', () => {
  const dir = mkDir({
    'worca-cc-plugin.json': JSON.stringify({ name: 'p', engines: { 'worca-cc-api': '>=4 <5' } }),
    'agents/asker.meta.json': sidecar('asker', { forms: { 'review-mockups': REVIEW_MOCKUPS, 'pick-one': PICK_ONE } }),
    // `tools: Read` — the frontmatter reader takes `a, b`; a YAML flow list `[Read]`
    // reads back as the literal string "[Read]" (test/plugin-store.test.mjs uses the same form).
    'agents/asker.md': '---\ntools: Read\n---\n# asker\n',
  });
  const [agent] = buildInstallInventory(dir).agents;
  assert.equal(agent.key, 'asker');
  assert.deepEqual(agent.tools, ['Read'], 'the existing consent fact is untouched');
  assert.deepEqual(agent.forms, ['pick-one', 'review-mockups'], 'sorted, so the consent card is stable');
  assert.deepEqual(agent.fileTypes, ['application/pdf', 'image/*'], 'union of every form, deduped and sorted');
});

test('an agent with no forms carries empty arrays, never undefined', () => {
  const dir = mkDir({
    'worca-cc-plugin.json': JSON.stringify({ name: 'p' }),
    'agents/plain.meta.json': sidecar('plain', null),
    'agents/plain.md': '# plain\n',
  });
  const [agent] = buildInstallInventory(dir).agents;
  assert.deepEqual(agent.forms, []);
  assert.deepEqual(agent.fileTypes, []);
});

test('a form that fails gate 1 is NOT promised to the reviewer', () => {
  const broken = { ...PICK_ONE, layout: [{ widget: 'grid', bind: 'data.summary' }] };
  const dir = mkDir({
    'worca-cc-plugin.json': JSON.stringify({ name: 'p', engines: { 'worca-cc-api': '>=4 <5' } }),
    'agents/half.meta.json': sidecar('half', { forms: { 'pick-one': PICK_ONE, 'broken-one': broken } }),
    'agents/half.md': '# half\n',
  });
  const [agent] = buildInstallInventory(dir).agents;
  assert.deepEqual(agent.forms, ['pick-one'], 'the host would drop the broken one at load, so consent must not list it');
});

test('an unreadable sidecar degrades to no forms rather than throwing', () => {
  const dir = mkDir({
    'worca-cc-plugin.json': JSON.stringify({ name: 'p' }),
    'agents/bad.meta.json': '{ not json',
    'agents/bad.md': '# bad\n',
  });
  const [agent] = buildInstallInventory(dir).agents;
  assert.equal(agent.key, 'bad');
  assert.deepEqual(agent.forms, []);
  assert.deepEqual(agent.fileTypes, []);
});

test('forms on a plugin that negotiates BELOW API 4 are not promised: the host strips them at load', () => {
  const files = {
    'agents/asker.meta.json': sidecar('asker', { forms: { 'review-mockups': REVIEW_MOCKUPS } }),
    'agents/asker.md': '# asker\n',
  };
  const at = (manifest) => buildInstallInventory(mkDir({ ...files, 'worca-cc-plugin.json': manifest })).agents[0];
  const old = at(JSON.stringify({ name: 'p', engines: { 'worca-cc-api': '>=3 <4' } }));
  assert.deepEqual(old.forms, [], 'agent-registry strips the block below API 4, so consent must not list it');
  assert.deepEqual(old.fileTypes, [], 'and must not claim a file type the host will never display');
  assert.deepEqual(at(JSON.stringify({ name: 'p', engines: { 'worca-cc-api': '>=3 <5' } })).forms, ['review-mockups'],
    'a range that admits 4 negotiates 4');
  assert.deepEqual(at('{ not json').forms, [], 'an unreadable manifest fails CLOSED, as the registry layer does');
});
