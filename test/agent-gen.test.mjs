// test/agent-gen.test.mjs — mock-driven agent-builder engine (Mode A full draft,
// Mode B metadata-only over pasted markdown, exactly-one terminal event, stop()).
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { useTempHome } from './helpers/temp-home.mjs';
import { createAgentGen } from '../src/core/agent-gen.mjs';

useTempHome(after);

const collect = (gen) => {
  const events = [];
  for (const t of ['agentgen-progress', 'agentgen-done', 'agentgen-error']) {
    gen.on(t, (p) => events.push({ type: t, ...p }));
  }
  return events;
};

test('Mode A (no userMarkdown): mock drafts BOTH meta + markdown; draft is normalized, NOT saved', async () => {
  const gen = createAgentGen({
    name: 'Docs Writer', purpose: 'write docs', details: 'long details',
    expectedBefore: [{ key: 'planner', displayName: 'Plan', produces: ['plan'], consumes: ['userPrompt'] }],
    expectedAfter: [], channels: ['plan', 'review'],
    claude: { mock: true },
  });
  const events = collect(gen);
  const out = await gen.run();
  assert.equal(out.status, 'done');
  assert.equal(out.draft.meta.key, 'docsWriter');
  assert.ok(['producer', 'verifier', 'clarifier'].includes(out.draft.meta.runnerType));
  assert.ok(Number.isFinite(out.draft.meta.order), 'normalizeMeta ran (finite order)');
  assert.match(out.draft.markdown, /Docs Writer/);
  const done = events.filter((e) => e.type === 'agentgen-done');
  assert.equal(done.length, 1, 'exactly one terminal event');
  assert.equal(done[0].genId, gen.getState().genId, 'tagged with genId');
  assert.ok(events.some((e) => e.type === 'agentgen-progress'), 'progress emitted');
});

test('Mode B (userMarkdown given): the pasted body is returned VERBATIM; only meta is drafted', async () => {
  const myMd = '# My Agent\n\nhand-written body\n';
  const gen = createAgentGen({
    name: 'My Agent', purpose: '', details: '', expectedBefore: [], expectedAfter: [],
    userMarkdown: myMd, channels: ['plan'], claude: { mock: true },
  });
  const out = await gen.run();
  assert.equal(out.status, 'done');
  assert.equal(out.draft.markdown, myMd, 'user markdown untouched');
  assert.equal(out.draft.meta.key, 'myAgent');
});

test('stop() yields a terminal agentgen-error{message:"stopped"} and status stopped', async () => {
  const gen = createAgentGen({ name: 'X', purpose: 'p', claude: { mock: true } });
  const events = collect(gen);
  gen.stop();
  const out = await gen.run();
  assert.equal(out.status, 'stopped');
  assert.equal(events.filter((e) => e.type === 'agentgen-done').length, 0);
  assert.equal(events.filter((e) => e.type === 'agentgen-error').length, 1);
  assert.equal(events.at(-1).message, 'stopped');
});
