// test/agent-gen-model.test.mjs
// The Models page's Claude tab › Agent generation: the { model, effort } pair behind the agent
// wizard's Generate (Workflows › Agents › +). Mirrors the PR description model setting
// (test/pr-description-model.test.mjs) with memoryDefrag's pair shape: catalog-validated before
// any write, cleared by an empty value, reported with its effective pair, read when Generate is
// clicked. settings.json lives under HOME, so HOME is sandboxed and the test runner's HOME guard lifted.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { useTempHome } from './helpers/temp-home.mjs';
import { checkRows } from './helpers/rows.mjs';

useTempHome(after);   // the mock generations below finish ASYNC in-process

let home, srv, base, runs;
const prev = {};
const JSONH = { 'Content-Type': 'application/json' };
before(async () => {
  home = await mkdtemp(join(tmpdir(), 'worca-cc-agentgenmodel-'));
  for (const k of ['HOME', 'USERPROFILE', 'WORCA_TEST_ALLOW_HOME_FALLBACK', 'WORCA_MOCK']) prev[k] = process.env[k];
  process.env.HOME = home; process.env.USERPROFILE = home;
  process.env.WORCA_TEST_ALLOW_HOME_FALLBACK = '1';
  process.env.WORCA_MOCK = '1';
  const mod = await import('../ui/server.mjs');       // imported ⇒ no port bind
  ({ runs } = mod);
  srv = mod.server;
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${srv.address().port}`;
});
after(async () => {
  if (srv) await Promise.race([
    new Promise((r) => { srv.close(r); srv.closeAllConnections?.(); }),
    new Promise((r) => { const t = setTimeout(r, 500); t.unref?.(); }),
  ]);
  for (const r of runs?.values() || []) { try { r.orch?.stop?.(); } catch { /* best-effort */ } }
  for (const k of Object.keys(prev)) { if (prev[k] === undefined) delete process.env[k]; else process.env[k] = prev[k]; }
  await rm(home, { recursive: true, force: true });
});
const get = async () => (await fetch(`${base}/api/settings`)).json();
const post = (body) => fetch(`${base}/api/settings`, { method: 'POST', headers: JSONH, body: JSON.stringify(body) });
const settingsJson = async () => JSON.parse(await readFile(join(home, '.worca-cc', 'settings.json'), 'utf8'));
const UNSET = { model: null, effort: null };
const DEFAULT = { model: null, effort: null, source: 'default', stale: null };

async function writeStored(value) {
  await mkdir(join(home, '.worca-cc'), { recursive: true });
  let cur = {};
  try { cur = await settingsJson(); } catch { /* none yet */ }
  await writeFile(join(home, '.worca-cc', 'settings.json'), JSON.stringify({ ...cur, agentGenModel: value }));
}

test('settings: agentGenModel round-trips through the API, validates BEFORE any write, clears on empty, reports the effective pair', async () => {
  const { agentGenModel, SETTINGS_POST_KEYS } = await import('../src/core/settings.mjs');
  assert.ok(SETTINGS_POST_KEYS.includes('agentGenModel'), 'the key is registered beside its setter (the root-clearing guard reads this list)');
  assert.deepEqual(agentGenModel(), UNSET);
  let j = await get();
  assert.deepEqual(j.agentGenModel, UNSET);
  assert.deepEqual(j.agentGenModelEffective, DEFAULT, 'unset: the CLI default model, as before');
  let r = await post({ agentGenModel: { model: 'CLAUDE-OPUS-5-5', effort: 'high' } });
  j = await r.json();
  assert.equal(r.status, 200, JSON.stringify(j));
  assert.deepEqual(j.agentGenModel, { model: 'claude-opus-5-5', effort: 'high' }, 'canonical catalog casing');
  assert.deepEqual(j.agentGenModelEffective, { model: 'claude-opus-5-5', effort: 'high', source: 'settings', stale: null });
  assert.deepEqual((await settingsJson()).agentGenModel, { model: 'claude-opus-5-5', effort: 'high' });
  assert.deepEqual(agentGenModel(), { model: 'claude-opus-5-5', effort: 'high' });
  // Refusals change nothing on disk.
  for (const [bad, re] of [
    [{ model: 'no-such-model' }, /The model “no-such-model” is not in the catalog/],
    [{ model: 'gpt-5.5', effort: 'high' }, /"gpt-5\.5" runs on Codex\. This setting picks a model Claude Code can run\.$/],
    [{ model: 'claude-haiku-4-5', effort: 'max' }, /does not offer effort "max"/],
    [{ model: '', effort: 'high' }, /“Effort” needs a model/],
    [{ model: 'claude-opus-5-5', effort: 'low' }, /“Effort” must be one of medium, high, xhigh, max/],
    ['claude-opus-5-5', /must be \{ model, effort \}/],
  ]) {
    r = await post({ agentGenModel: bad });
    assert.equal(r.status, 400, JSON.stringify(bad));
    const body = await r.json();
    assert.match(body.error, re);
    assert.equal(body.field.split('.')[0], 'agentGenModel');
  }
  assert.deepEqual(agentGenModel(), { model: 'claude-opus-5-5', effort: 'high' }, 'a rejected write changes nothing');
  r = await post({ agentGenModel: { model: 'no-such-model' }, titleModel: 'claude-sonnet-5' });
  assert.equal(r.status, 400, 'validation runs before ANY write');
  assert.equal((await get()).titleModel, null, 'the sibling key of a rejected body was not written either');
  r = await post({ agentGenModel: { model: 'claude-sonnet-5', effort: '' } });
  j = await r.json();
  assert.deepEqual(j.agentGenModel, { model: 'claude-sonnet-5', effort: null }, 'a blank effort = the model\'s default effort');
  assert.deepEqual((await settingsJson()).agentGenModel, { model: 'claude-sonnet-5' });
  for (const empty of [null, '', { model: '', effort: '' }]) {
    await post({ agentGenModel: { model: 'claude-opus-5-5', effort: 'high' } });
    j = await (await post({ agentGenModel: empty })).json();
    assert.deepEqual(j.agentGenModel, UNSET, JSON.stringify(empty));
    assert.deepEqual(j.agentGenModelEffective, DEFAULT);
    assert.equal('agentGenModel' in (await settingsJson()), false, 'cleared tidily');
  }
  // A POST naming no SETTINGS_POST_KEYS key clears root — pin that this key is not such a POST.
  const rootDir = await mkdtemp(join(tmpdir(), 'worca-cc-agentgenmodel-root-'));
  try {
    assert.equal((await (await post({ root: rootDir })).json()).root, rootDir);
    j = await (await post({ agentGenModel: { model: 'claude-opus-5-5' } })).json();
    assert.equal(j.root, rootDir, 'an agentGenModel-only POST must not clear the root');
    assert.equal((await get()).root, rootDir);
  } finally {
    await post({ root: '' });
    await post({ agentGenModel: null });
    await rm(rootDir, { recursive: true, force: true });
  }
});

test('assertAgentGenModelInput / setAgentGenModel / agentGenModel: the pair rule, the catalog casing, hand edits', async () => {
  const { assertAgentGenModelInput, setAgentGenModel, agentGenModel } = await import('../src/core/settings.mjs');
  const MODELS = [{ id: 'claude-opus-5-5', efforts: ['medium', 'high', 'xhigh', 'max'] }, { id: 'claude-haiku-4-5', efforts: ['medium', 'high'] }];
  await checkRows([
    { name: 'assertAgentGenModelInput: empty / null / blank model clears; the model comes back in the catalog casing', run: () => {
      for (const v of ['', null, undefined, { model: '' }, { model: null, effort: null }]) assert.equal(assertAgentGenModelInput(v, MODELS), null, JSON.stringify(v));
      assert.deepEqual(assertAgentGenModelInput({ model: ' claude-OPUS-5-5 ', effort: ' max ' }, MODELS), { model: 'claude-opus-5-5', effort: 'max' });
      assert.deepEqual(assertAgentGenModelInput({ model: 'my-proxy', effort: 'high' }), { model: 'my-proxy', effort: 'high' }, 'no catalog: the id passes as given');
    } },
    { name: 'assertAgentGenModelInput: refuses a non-pair, an effort without a model, an unknown model, an unoffered effort', run: () => {
      assert.throws(() => assertAgentGenModelInput('claude-opus-5-5', MODELS), /^Error: agentGenModel must be \{ model, effort \} or null$/);
      assert.throws(() => assertAgentGenModelInput({ effort: 'high' }, MODELS), /agentGenModel\.effort needs a model/);
      assert.throws(() => assertAgentGenModelInput({ model: 42 }, MODELS), /agentGenModel\.model must be a catalog model id/);
      assert.throws(() => assertAgentGenModelInput({ model: 'x', effort: 'low' }), /agentGenModel\.effort must be one of medium \| high \| xhigh \| max/);
      assert.throws(() => assertAgentGenModelInput({ model: 'nope' }, MODELS), /unknown model "nope"/);
      assert.throws(() => assertAgentGenModelInput({ model: 'claude-haiku-4-5', effort: 'max' }, MODELS), /claude-haiku-4-5 does not offer effort "max"/);
    } },
    { name: 'setAgentGenModel refuses before any write; agentGenModel reads a bad hand edit as unset', run: async () => {
      await assert.rejects(() => setAgentGenModel({ model: 42 }), /catalog model id/);
      assert.deepEqual(agentGenModel(), UNSET);
      await writeStored({ model: 'claude-opus-5-5', effort: 'bogus' });
      assert.deepEqual(agentGenModel(), { model: 'claude-opus-5-5', effort: null }, 'a bad effort reads as the model\'s default effort');
      await writeStored('claude-opus-5-5');
      assert.deepEqual(agentGenModel(), UNSET, 'not a pair: unset');
      await writeStored({ effort: 'high' });
      assert.deepEqual(agentGenModel(), UNSET, 'an effort without a model means nothing');
      await setAgentGenModel(null);
      assert.equal('agentGenModel' in (await settingsJson()), false);
    } },
  ]);
});

test('GET /api/settings: a stored id the catalog no longer carries reports the CLI default as effective', async () => {
  await writeStored({ model: 'gone-model', effort: 'high' });
  try {
    const j = await get();
    assert.deepEqual(j.agentGenModel, { model: 'gone-model', effort: 'high' }, 'the stored pair, as stored');
    assert.deepEqual(j.agentGenModelEffective, { ...DEFAULT, stale: 'gone-model' });
    await writeStored({ model: 'claude-haiku-4-5', effort: 'max' });
    assert.deepEqual((await get()).agentGenModelEffective, { model: 'claude-haiku-4-5', effort: null, source: 'settings', stale: null },
      'an effort the model does not offer is dropped');
  } finally { await post({ agentGenModel: null }); }
});

// ── Generate: the setting is read per click ─────────────────────────────────

async function generate() {
  const r = await fetch(`${base}/api/agents/generate`, { method: 'POST', headers: JSONH, body: JSON.stringify({ name: 'Docs Writer', purpose: 'write docs' }) });
  const raw = await r.text();
  assert.equal(r.status, 200, raw);
  const { genId } = JSON.parse(raw);
  const entry = runs.get(genId);
  const t0 = Date.now();
  while (!['done', 'error', 'stopped'].includes(entry.status)) {
    if (Date.now() - t0 > 10000) throw new Error('agent generation never settled');
    await new Promise((res) => setTimeout(res, 15));
  }
  assert.equal(entry.status, 'done');
  return entry;
}

test('POST /api/agents/generate runs on the setting read at click time; unset and stale run on the CLI default', async () => {
  const { mockSpawnLog } = await import('../src/core/claude-runner.mjs');
  const warn = console.warn;
  const warnings = [];
  console.warn = (...a) => { warnings.push(a.join(' ')); };
  try {
    let entry = await generate();
    assert.equal(entry.orch.claude.model, undefined, 'unset: no --model, the CLI default');
    assert.equal(entry.orch.claude.effort, undefined);
    await post({ agentGenModel: { model: 'claude-opus-5-5', effort: 'xhigh' } });
    entry = await generate();
    assert.deepEqual([entry.orch.claude.model, entry.orch.claude.effort], ['claude-opus-5-5', 'xhigh'], 'saved after the server started: read per Generate');
    assert.equal(mockSpawnLog.at(-1).model, 'claude-opus-5-5', 'the model reached runClaude');
    await post({ agentGenModel: { model: 'claude-haiku-4-5' } });
    entry = await generate();
    assert.deepEqual([entry.orch.claude.model, entry.orch.claude.effort], ['claude-haiku-4-5', undefined], 'no effort: the model\'s default effort');
    await writeStored({ model: 'gone-model', effort: 'high' });
    entry = await generate();
    assert.deepEqual([entry.orch.claude.model, entry.orch.claude.effort], [undefined, undefined], 'stale: the CLI default');
    assert.ok(warnings.some((w) => /^\[worca\] agentGenModel "gone-model" is no longer in the catalog — agent generation uses the CLI default$/.test(w)), warnings.join('\n'));
  } finally {
    console.warn = warn;
    await post({ agentGenModel: null });
  }
});
