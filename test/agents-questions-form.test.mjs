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
    meta: {
      metaVersion: 2, key: 'qDemo', displayName: 'Q Demo', order: 99, runnerType: 'producer',
      inputs: [{ id: 'task', type: 'md' }],
      outputs: [{ id: 'plan', type: 'md', filename: '{base}.md' }],
      asksQuestions: true, questionsLocked: false, questionsDefault: true,
    },
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
  // meta v2 enumerates the three flags on one line instead of ": bool" per field.
  assert.match(src, /"asksQuestions"/);
  assert.match(src, /"questionsLocked"/);
  assert.match(src, /"questionsDefault"/);
  assert.match(src, /questionsLocked=true ONLY if/);
});

// The v2 port editor is BUILT, not authored: port rows are dynamic, so both
// hosts (the Agents card pane and the wizard's review step) are empty
// `.agent-form` divs that agentFormRender fills. The guarantee this test used
// to make of the markup is therefore made of the renderer instead — and it
// still covers BOTH hosts, because there is now only one renderer.
test('both agent form hosts exist, and the renderer emits the three questions checkboxes', () => {
  const html = readFileSync(fileURLToPath(new URL('../ui/public/index.html', import.meta.url)), 'utf8');
  const hosts = html.split('class="agent-form"').length - 1;
  assert.equal(hosts, 2, 'one form host in the edit pane, one in the wizard review step');

  const appJs = readFileSync(fileURLToPath(new URL('../ui/public/app.js', import.meta.url)), 'utf8');
  for (const cls of ['agent-f-questions', 'agent-f-questions-locked', 'agent-f-questions-default']) {
    assert.match(appJs, new RegExp(`fmCheck\\('${cls}'`), `${cls} is rendered by agentFormFill`);
  }
  // The v1 channel vocabulary must not come back through the renderer either.
  for (const dead of ['agent-f-consumes', 'agent-f-produces', 'agent-f-connects', 'agent-f-loopsource']) {
    assert.ok(!appJs.includes(dead), `${dead} died with meta v2`);
    assert.ok(!html.includes(dead), `${dead} is gone from index.html`);
  }
});
