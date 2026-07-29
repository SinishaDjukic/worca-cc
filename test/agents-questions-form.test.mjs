// test/agents-questions-form.test.mjs
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { useTempHome } from './helpers/temp-home.mjs';
import { createAgent, readAgent } from '../src/core/agent-store.mjs';
import { createAgentGen } from '../src/core/agent-gen.mjs';

useTempHome(after);

test('agent-store roundtrips the questions fields', async () => {
  await createAgent({
    meta: { key: 'qDemo', displayName: 'Q Demo', order: 99, asksQuestions: true, questionsLocked: false, questionsDefault: true },
    markdown: '# Q Demo\nbody\n',
  });
  const { meta } = await readAgent('qDemo');
  assert.equal(meta.asksQuestions, true);
  assert.equal(meta.questionsLocked, false);
  // Coherence: default requires asksQuestions (true here), so it survives.
  assert.equal(meta.questionsDefault, true);
});

test('mock agent-gen drafts carry the questions fields (normalized)', async () => {
  const gen = createAgentGen({ name: 'Docs Writer', purpose: 'write docs', claude: { mock: true } });
  const res = await gen.run();
  assert.equal(res.status, 'done');
  assert.equal(typeof res.draft.meta.asksQuestions, 'boolean');
  assert.equal(typeof res.draft.meta.questionsLocked, 'boolean');
  assert.equal(typeof res.draft.meta.questionsDefault, 'boolean');
});

test('builder prompt schema names the questions fields with guidance', () => {
  const src = readFileSync(fileURLToPath(new URL('../src/core/agent-gen.mjs', import.meta.url)), 'utf8');
  assert.match(src, /"asksQuestions": bool/);
  assert.match(src, /"questionsLocked": bool/);
  assert.match(src, /"questionsDefault": bool/);
  assert.match(src, /questionsLocked=true ONLY if/);
});

test('both agent forms in index.html carry the three questions checkboxes', () => {
  const html = readFileSync(fileURLToPath(new URL('../ui/public/index.html', import.meta.url)), 'utf8');
  for (const cls of ['agent-f-questions"', 'agent-f-questions-locked', 'agent-f-questions-default']) {
    const hits = html.split(cls).length - 1;
    assert.ok(hits >= 2, `${cls} present in both the wizard and the edit pane (found ${hits})`);
  }
});
