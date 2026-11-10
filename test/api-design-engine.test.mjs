// test/api-design-engine.test.mjs
// Design P8 Task 2: `POST /api/design` resolves and gates the engine before the design exists, and stores it. Consent
// comes only from a person naming the engine (L8.25): a settings change cannot move a design, a design-start chat tool
// cannot carry it, and a design with no stored engine meets the gate again at start (L8.2).

import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { bootDesignChat } from './helpers/design-chat-boot.mjs';

const { call, mod, homeDir } = await bootDesignChat(after);
const post = (body) => call('POST', '/api/design', body);
const count = async () => (await call('GET', '/api/design')).body.length;

test('a gated engine is refused until a person allows it; the choice is stored', async () => {
  const before = await count();
  const gated = await post({ kind: 'web', engine: 'codex' });
  assert.equal(gated.status, 409);
  assert.deepEqual([gated.body.code, gated.body.overridable, gated.body.engine, gated.body.label], ['engine-gated', true, 'codex', 'OpenAI Codex']);
  assert.ok(gated.body.reasons.length > 0);
  assert.equal(gated.body.error, gated.body.reasons[0]);
  assert.deepEqual(gated.body.notes, []);
  assert.deepEqual(Object.keys(gated.body).sort(), ['code', 'engine', 'error', 'label', 'notes', 'overridable', 'reasons']);
  assert.equal(await count(), before, 'a refused POST makes no design');
  const allowed = await post({ kind: 'web', engine: 'codex', allowUnguarded: true });
  assert.equal(allowed.status, 201);
  assert.equal(allowed.body.design.engine, 'codex');
  const copilot = await post({ kind: 'web', engine: 'copilot' });
  assert.equal(copilot.body.reasons.length, 2, 'cost, then the deny rules Design hands every build');
  assert.match(copilot.body.reasons[1], /^GitHub Copilot cannot fully hold these rules: Read\(/);
  const goose = await post({ kind: 'web', engine: 'goose', allowUnguarded: true });
  assert.equal(goose.status, 409);
  assert.deepEqual([goose.body.code, goose.body.overridable, goose.body.engine, goose.body.label], ['engine-refused', false, 'goose', 'Goose']);
  for (const body of [{ engine: 'nope' }, { engine: 'mock' }, { engine: null }, { engine: 7 }, { allowUnguarded: 'yes' }, { allowUnguarded: true }, { engine: '  ', allowUnguarded: true }]) {
    assert.equal((await post({ kind: 'web', ...body })).status, 400, JSON.stringify(body));
  }
  const plain = await post({ kind: 'web' });
  assert.equal(plain.status, 201);
  assert.equal(plain.body.design.engine, 'claude');
  assert.equal((await post({ kind: 'web', engine: 'claude', allowUnguarded: false })).body.design.engine, 'claude');
});

test('the picked project: a note for an engine that cannot read it, found by the trimmed key', async () => {
  const { addProject } = await import('../src/core/projects.mjs');
  const dir = join(homeDir, 'shop');
  mkdirSync(dir, { recursive: true });
  const key = (await addProject({ name: 'shop', path: dir })).find((p) => p.name === 'shop').key;
  const gemini = await post({ kind: 'web', engine: 'gemini', projectKey: ` ${key} ` });
  assert.deepEqual([gemini.status, gemini.body.label, gemini.body.notes], [409, 'Gemini CLI', ['Gemini CLI cannot read the picked project.']]);
  assert.deepEqual((await post({ kind: 'web', engine: 'gemini' })).body.notes, [], 'no project, no note');
  assert.deepEqual((await post({ kind: 'web', engine: 'codex', projectKey: key })).body.notes, []);
  const made = await post({ kind: 'web', engine: 'gemini', projectKey: key, allowUnguarded: true });
  assert.deepEqual([made.status, made.body.design.engine, made.body.design.projectKey], [201, 'gemini', key]);
});

test('a design keeps its engine', async () => {
  const { setRunEngineSetting } = await import('../src/core/settings.mjs');
  const { designEngineFor } = await import('../src/core/design/engines.mjs');
  const { getDesign, updateDesign } = await import('../src/core/design/store.mjs');
  const prev = process.env.WORCA_TEST_ALLOW_HOME_FALLBACK;
  process.env.WORCA_TEST_ALLOW_HOME_FALLBACK = '1';
  try {
    const made = (await post({ kind: 'web' })).body.design;
    await setRunEngineSetting('codex');
    assert.equal(designEngineFor(getDesign(made.id)).engine, 'claude', 'a settings change cannot move a design');
    const moved = await post({ kind: 'web' });
    assert.deepEqual([moved.status, moved.body.code, moved.body.engine], [409, 'engine-gated', 'codex'], 'a new design meets the new default');
    updateDesign(made.id, { engine: null });
    await assert.rejects(
      mod.designBuilds.start({ designId: made.id, brief: 'x', by: 'local', allowUnguarded: true }),
      (e) => e.status === 409 && e.code === 'engine-gated',
    );
    assert.equal(getDesign(made.id).engine, null, 'a refused start stores nothing');
  } finally {
    await setRunEngineSetting(null);
    if (prev === undefined) delete process.env.WORCA_TEST_ALLOW_HOME_FALLBACK; else process.env.WORCA_TEST_ALLOW_HOME_FALLBACK = prev;
  }
});

test('the model cannot consent', async () => {
  const { createAskTools } = await import('../src/core/ask/tools.mjs');
  const { ASK_LIMITS } = await import('../src/core/ask/limits.mjs');
  const { defaultDesignDeps } = await import('../src/core/ask/design-deps.mjs');
  const { threadId } = (await post({ kind: 'web' })).body;
  const tools = createAskTools({ limits: ASK_LIMITS, redact: (s) => s, askMode: 'design', ...defaultDesignDeps({ threadId }) });
  assert.equal(tools.list().find((t) => t.name === 'start_design_build').inputSchema.additionalProperties, false);
  const r = await tools.call('start_design_build', { brief: 'x', allowUnguarded: true, engine: 'codex' });
  assert.deepEqual(r.requested, { kind: 'design-start', brief: 'x' });
});

test('M3 (L8.31): a bridged role model whose provider lost its key stops a new design and a Continue, before any rehydrate', async () => {
  const settings = await import('../src/core/settings.mjs');
  const { DesignBuild } = await import('../src/core/design/build.mjs');
  const { getBuild } = await import('../src/core/design/store.mjs');
  const prev = process.env.WORCA_TEST_ALLOW_HOME_FALLBACK;
  process.env.WORCA_TEST_ALLOW_HOME_FALLBACK = '1';
  const rehydrate = DesignBuild.rehydrate;
  try {
    // A paused build of a stored-claude design, made while every model could be reached.
    const made = (await post({ kind: 'web' })).body.design;
    const { buildId } = await mod.designBuilds.start({ designId: made.id, brief: 'MOCK_SECTIONS=2 MOCK_FAIL_SECTION=hero', by: 'local' });
    await mod.designBuilds.settled();
    assert.equal(getBuild(buildId).status, 'paused');
    // Then the Claude lead and builder roles move to a bridged catalog model, and its provider loses its key.
    await settings.updateProvider('openai', { apiKey: 'sk-design-test', baseUrl: 'https://gateway.example.com/v1' });
    await settings.addGlobalModel({ id: 'gw-bridged', upstream: { provider: 'openai', api: 'openai-chat', model: 'gpt-x', apiKey: '${WORCA_DESIGN_TEST_UNSET_KEY}' } });
    await settings.setModelRoles({ claude: { deep: { model: 'gw-bridged' }, everyday: { model: 'gw-bridged' } } });
    await settings.updateProvider('openai', { apiKey: null });
    const before = await count();
    const refused = await post({ kind: 'web' });
    assert.deepEqual([refused.status, refused.body.code, refused.body.overridable, refused.body.engine, refused.body.label], [409, 'engine-refused', false, 'claude', 'Claude Code']);
    assert.match(refused.body.error, /openai/);
    assert.equal(await count(), before, 'no design is made');
    let rehydrated = 0;
    DesignBuild.rehydrate = (...a) => { rehydrated += 1; return rehydrate.apply(DesignBuild, a); };
    assert.throws(() => mod.designBuilds.continueBuild({ designId: made.id, buildId, by: 'local' }),
      (e) => e.status === 409 && e.code === 'engine-refused' && /openai/.test(e.message));
    assert.deepEqual([rehydrated, mod.designBuilds.get(buildId), getBuild(buildId).status], [0, null, 'paused'], 'refused before any rehydrate');
  } finally {
    DesignBuild.rehydrate = rehydrate;
    await settings.setModelRoles({ claude: { deep: null, everyday: null } });
    await settings.removeGlobalModel('gw-bridged').catch(() => {});
    if (prev === undefined) delete process.env.WORCA_TEST_ALLOW_HOME_FALLBACK; else process.env.WORCA_TEST_ALLOW_HOME_FALLBACK = prev;
  }
});
