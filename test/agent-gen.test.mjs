// test/agent-gen.test.mjs — mock-driven agent-builder engine (Mode A full draft,
// Mode B metadata-only over pasted markdown, exactly-one terminal event, stop()).
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { useTempHome } from './helpers/temp-home.mjs';
import { checkRows } from './helpers/rows.mjs';
import { createAgentGen, resolveAgentGenModel, _testing } from '../src/core/agent-gen.mjs';

useTempHome(after);

const collect = (gen) => {
  const events = [];
  for (const t of ['agentgen-progress', 'agentgen-done', 'agentgen-error']) {
    gen.on(t, (p) => events.push({ type: t, ...p }));
  }
  return events;
};

test('Mode A (no userMarkdown): mock drafts a normalized v2 meta + ## Ports markdown, one terminal event, NOT saved', async () => {
  const gen = createAgentGen({
    name: 'Docs Writer', purpose: 'write docs', details: 'long details',
    expectedBefore: [{ key: 'planner', displayName: 'Plan', produces: ['plan'], consumes: ['userPrompt'] }],
    expectedAfter: [],
    claude: { mock: true },
  });
  const events = collect(gen);
  const out = await gen.run();
  await checkRows([
    { name: 'Mode A (no userMarkdown): mock drafts BOTH meta + markdown; draft is normalized, NOT saved', run: () => {
      assert.equal(out.status, 'done');
      assert.equal(out.draft.meta.key, 'docsWriter');
      assert.ok(['producer', 'verifier', 'clarifier'].includes(out.draft.meta.runnerType));
      assert.ok(Number.isFinite(out.draft.meta.order), 'normalizeMeta ran (finite order)');
      assert.match(out.draft.markdown, /Docs Writer/);
      const done = events.filter((e) => e.type === 'agentgen-done');
      assert.equal(done.length, 1, 'exactly one terminal event');
      assert.equal(done[0].genId, gen.getState().genId, 'tagged with genId');
      assert.ok(events.some((e) => e.type === 'agentgen-progress'), 'progress emitted');
    } },
    { name: 'the mock generator writes a v2 sidecar with a ## Ports body', run: () => {
      assert.equal(out.status, 'done');
      assert.equal(out.draft.meta.metaVersion, 2);
      assert.deepEqual(out.draft.meta.inputs.map((p) => p.id), ['plan']);
      assert.deepEqual(out.draft.meta.outputs.map((p) => p.id), ['review']);
      assert.equal(out.draft.meta.outputs[0].filename, 'review-{cycle}.md');
      // normalizeMeta returns a FIXED key set that KEEPS the v1 channel fields for
      // the duration of coexistence (P8 deletes them), so `consumes` is present on
      // EVERY normalized meta, v1 or v2 — asserting it is undefined can never pass.
      // What proves the mock went v2 is the port surface.
      assert.equal(out.draft.meta.portSummary, 'Reads plan; produces review.');
      assert.match(out.draft.markdown, /## Ports/);
    } },
  ]);
});

test('Mode B (userMarkdown given): the pasted body is returned VERBATIM; only meta is drafted', async () => {
  const myMd = '# My Agent\n\nhand-written body\n';
  const gen = createAgentGen({
    name: 'My Agent', purpose: '', details: '', expectedBefore: [], expectedAfter: [],
    userMarkdown: myMd, claude: { mock: true },
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

test('generator prompt: v2 meta schema (no channel vocabulary) and typed-port neighbor block', async () => {
  await checkRows([
    { name: 'the meta schema block teaches meta v2 ports, not channels', run: () => {
      const gen = createAgentGen({ name: 'X', purpose: 'p', claude: { mock: true } });
      const block = gen._metaSchemaBlock();
      assert.match(block, /"metaVersion": 2/);
      assert.match(block, /at most 8 ports per side/);
      assert.match(block, /The id "await" is RESERVED/);
      assert.match(block, /"verifier" MUST declare "verdict"/);
      assert.match(block, /"clarifier" MUST declare/);
      assert.doesNotMatch(block, /consumes|optionalConsumes|connectsTo|loopSource/,
        'the channel vocabulary is gone from the generator prompt');
    } },
    { name: 'neighbors are rendered as typed ports, and the body is told to document them', run: () => {
      const gen = createAgentGen({
        name: 'X', purpose: 'p', claude: { mock: true },
        expectedBefore: [{ key: 'planner', displayName: 'Plan', inputs: [{ id: 'task', type: 'md' }], outputs: [{ id: 'plan', type: 'md' }] }],
        expectedAfter: [],
      });
      const block = gen._neighborBlock();
      assert.match(block, /"outputs": \[\s*\{\s*"id": "plan",\s*"type": "md",\s*"when": "always"/);
      assert.doesNotMatch(block, /Channel vocabulary/);
      assert.match(block, /port ids are yours to choose/i);
      assert.match(gen._fullPrompt(), /## Ports/);
      assert.match(gen._fullPrompt(), /never hardcode filenames/);
    } },
  ]);
});

test('a generated meta that breaks a v2 rule fails with the rules named', async () => {
  const gen = createAgentGen({ name: 'Bad Agent', purpose: 'p', claude: { mock: true } });
  const events = collect(gen);
  const { mkdir, writeFile } = await import('node:fs/promises');
  // Replace the ONE seam that talks to claude, so the read-back sees exactly
  // this meta: the gate is the subject, not the LLM. `run()` calls
  // `this._runClaude(...)`, so an OWN property shadows the prototype method.
  gen._runClaude = async () => {
    await mkdir(gen.scratchDir, { recursive: true });
    await writeFile(gen.mdPath, '# Bad Agent\n\nbody\n', 'utf8');
    await writeFile(gen.metaPath, JSON.stringify({
      metaVersion: 2, key: 'badAgent', displayName: 'Bad', runnerType: 'verifier',
      inputs: [], outputs: [],
    }), 'utf8');
  };
  const out = await gen.run();
  assert.equal(out.status, 'error');
  assert.match(out.message, /^the generator produced invalid metadata: /);
  assert.match(out.message, /at least one output port is required/);
  assert.match(out.message, /runnerType "verifier" requires verdict: \{ filename \}/);
  assert.equal(events.filter((e) => e.type === 'agentgen-error').length, 1, 'exactly one terminal event');
  assert.equal(events.filter((e) => e.type === 'agentgen-done').length, 0);
});

test('the one claude call carries the configured model + effort; with none it names no model', async () => {
  const seen = [];
  _testing.setRunClaude(async (opts) => { seen.push(opts); throw new Error('captured'); });
  try {
    await checkRows([
      { name: 'Settings › Agent generation: model and effort reach runClaude', run: async () => {
        const gen = createAgentGen({ name: 'X', purpose: 'p', claude: { model: 'claude-opus-5-5', effort: 'xhigh' } });
        await gen.run();
        assert.equal(seen.at(-1).model, 'claude-opus-5-5');
        assert.equal(seen.at(-1).effort, 'xhigh');
      } },
      { name: 'unset: model and effort stay undefined (the CLI default, as before)', run: async () => {
        await createAgentGen({ name: 'X', purpose: 'p', claude: {} }).run();
        assert.equal(seen.at(-1).model, undefined);
        assert.equal(seen.at(-1).effort, undefined);
      } },
    ]);
  } finally { _testing.reset(); }
});

test('resolveAgentGenModel: the stored pair while the catalog carries it, else the CLI default (stale named)', async () => {
  const MODELS = [{ id: 'claude-opus-5-5', efforts: ['medium', 'high', 'xhigh', 'max'] }, { id: 'claude-haiku-4-5', efforts: ['medium', 'high'] }];
  await checkRows([
    { name: 'resolveAgentGenModel: unset → no model', run: () => {
      assert.deepEqual(resolveAgentGenModel({ model: null, effort: null }, MODELS), { model: null, effort: null, source: 'default', stale: null });
      assert.deepEqual(resolveAgentGenModel(undefined, MODELS), { model: null, effort: null, source: 'default', stale: null });
    } },
    { name: 'resolveAgentGenModel: the stored pair in the catalog\'s casing', run: () => {
      assert.deepEqual(resolveAgentGenModel({ model: 'CLAUDE-OPUS-5-5', effort: 'max' }, MODELS), { model: 'claude-opus-5-5', effort: 'max', source: 'settings', stale: null });
    } },
    { name: 'resolveAgentGenModel: a model gone from the catalog → the CLI default, stale named; an unoffered effort is dropped', run: () => {
      assert.deepEqual(resolveAgentGenModel({ model: 'gone-model', effort: 'high' }, MODELS), { model: null, effort: null, source: 'default', stale: 'gone-model' });
      assert.deepEqual(resolveAgentGenModel({ model: 'claude-haiku-4-5', effort: 'max' }, MODELS), { model: 'claude-haiku-4-5', effort: null, source: 'settings', stale: null });
    } },
  ]);
});
