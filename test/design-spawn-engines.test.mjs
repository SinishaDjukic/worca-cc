// test/design-spawn-engines.test.mjs
// Design P8 Task 3, the build side: the design's engine in every spawn, agent row, meter and model resolve; what a
// locked-down builder can reach (the `.ctx/` read bundle, its question file in `<section>/.asks/`), a lost non-Claude
// session (L8.30), `_readWork` through `readConfined`, and the lead told of the project only where it can read it
// (L8.9). SPEC section 1, C-3, L12, L13; lead calls L8.7, L8.8, L8.26, L8.27. Every build runs on the mock engine.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import {
  chmodSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, symlinkSync, writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, sep } from 'node:path';
import { framesOf, newBuild, newDesign, useDesignEnv, waitForFrame, waitUntil } from './helpers/design-fixture.mjs';
import { runClaude } from '../src/core/claude-runner.mjs';
import { DesignBuild } from '../src/core/design/build.mjs';
import { DESIGN_ENGINES } from '../src/core/design/engines.mjs';
import { stageDesignKit } from '../src/core/design/kit.mjs';
import { asksDir, builderWriteDirs, crewFile, designWorkDir, distDir, kitDir, sectionDir } from '../src/core/design/paths.mjs';
import { builderPrompt, builderSystemPrompt, leadPlanPrompt } from '../src/core/design/prompts.mjs';
import { asksFileFor, readAskFile, removeAskFile } from '../src/core/design/questions.mjs';
import { removeReadBundle, stageReadBundle } from '../src/core/design/read-bundle.mjs';
import { DESIGN_TOOLS, designSpawnOptions } from '../src/core/design/spawn-options.mjs';
import { getAgent, getBuild, listAgents } from '../src/core/design/store.mjs';
import { codexResumeNotFound } from '../src/core/engines/codex.mjs';
import { stopBridge } from '../src/core/bridge/server.mjs';
import { addGlobalModel, updateProvider } from '../src/core/settings.mjs';

useDesignEnv(after);
const D = newDesign();
/** The engines a person may allow for Design, every one off the hook row. */
const CHECK_ROWS = ['codex', 'copilot', 'gemini', 'qwen', 'cursor', 'opencode'];
const LINK = process.platform === 'win32' ? 'junction' : 'dir';
const POSIX = { skip: process.platform === 'win32' };
const Q = { id: 'q1', text: 'Tone?', why: 'mock', options: [{ label: 'Calm', value: 'a' }, { label: 'Bold', value: 'b' }] };
/** A builder ctx for section `hero` of `D`. */
const base = (o = {}) => ({
  role: 'builder', stage: 'first', agentId: 'a_11111111', buildId: 'b_111111111111', designId: D.id, sectionId: 'hero',
  prompt: 'P', model: null, effort: 'medium', maxBudgetUsd: 3, denyRules: ['Read(//**/.env*)'],
  signal: new AbortController().signal, onEvent: () => {}, ...o,
});
const mockRun = (o) => runClaude({ ...o, mock: true });
const abortError = () => Object.assign(new Error('aborted'), { name: 'AbortError' });
const isHero = (o) => o.cwd.endsWith(`${sep}hero`);
/** A rehydrated build of `buildId` on a recording runner over the mock. */
const again = (buildId, runner = mockRun) => {
  const calls = []; const frames = [];
  const b = DesignBuild.rehydrate({ buildId, deps: { staggerMs: 0, retryDelayMs: 0, runClaude: (o) => { calls.push(o); return runner(o); } } });
  b.on('frame', (f) => frames.push(f));
  return { b, calls, frames };
};
/** A folder outside every design, removed after the file. */
const outsideDir = () => {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'dse-outside-')));
  after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
};
/** The adapters' own "is gone" line (gemini-family.mjs), its em dash and ellipsis spelled by code point. */
const goneLine = (name, session) => `[worca] ${name}: session ${session.slice(0, 12)}${String.fromCodePoint(0x2026)} is gone ${String.fromCodePoint(0x2014)} starting a fresh one`;
/** A paused build of an `engine` design whose builder `hero` failed after reporting its session. */
async function pausedHero(engine) {
  const d = newDesign({ engine });
  const first = newBuild(d, { brief: 'MOCK_SECTIONS=1 MOCK_FAIL_SECTION=hero' });
  assert.deepEqual(await first.build.run(), { status: 'paused', reason: 'failed' });
  const hero = listAgents(first.build.id).find((a) => a.sectionId === 'hero');
  assert.ok(hero.sessionId, 'the builder reported a session');
  return { d, buildId: first.build.id, hero };
}

test('non-Claude: its own engine, a cwd, no guard', () => {
  for (const engine of CHECK_ROWS) {
    const o = designSpawnOptions(base({ engine }));
    assert.equal(o.engine, engine);
    for (const k of ['addDirs', 'writeGuard', 'includePartialMessages', 'tools', 'maxBudgetUsd']) assert.equal(k in o, false, `${engine}: ${k}`);
    assert.equal(o.noGit, true, engine);
    assert.equal(o.cwd, sectionDir(D.id, 'hero'));
    assert.deepEqual(o.allowedTools, [...DESIGN_TOOLS]);
    assert.deepEqual([o.asAgent, o.envScrub, o.spawnKind, o.runId], [true, true, 'phase', 'b_111111111111']);
    assert.ok(o.systemPrompt.includes(join(sectionDir(D.id, 'hero'), '.ctx')), `${engine}: the system prompt names the read bundle`);
    const deny = o.permissionRules.deny;
    assert.ok(deny.includes('Read(//**/.env*)'), `${engine}: the design's own rules stay`);
    for (const r of ['Bash', 'WebSearch', 'WebFetch']) assert.equal(deny.includes(r), false, `${engine}: ${r} is not denied`);
    const lead = designSpawnOptions(base({ engine, role: 'lead', stage: 'plan', sectionId: null, projectDir: '/proj' }));
    assert.equal(lead.systemPrompt.includes('.ctx'), false, `${engine}: a lead has no read bundle`);
    assert.equal(lead.cwd, designWorkDir(D.id));
    assert.equal('addDirs' in lead, false);
  }
  assert.throws(() => designSpawnOptions(base({ engine: 'goose' })), /engine goose/);
  assert.throws(() => designSpawnOptions(base({ engine: 'no-such' })), /engine no-such/);
});

test('Claude is untouched; a bridged model withholds its excluded tools', () => {
  const o = designSpawnOptions(base({ engine: 'claude' }));
  assert.equal(o.engine, 'claude');
  assert.deepEqual(o.writeGuard, { allowedDirs: builderWriteDirs(D.id, 'hero') });
  assert.equal(o.includePartialMessages, true);
  assert.deepEqual(o.tools, [...DESIGN_TOOLS]);
  assert.equal(o.maxBudgetUsd, 3);
  assert.deepEqual(o.addDirs, [designWorkDir(D.id)]);
  assert.deepEqual(o.permissionRules.deny, ['Read(//**/.env*)']);
  for (const k of ['noGit', 'disallowedTools']) assert.equal(k in o, false, k);
  assert.equal(o.systemPrompt.includes('.ctx'), false);
  const bridged = designSpawnOptions(base({ engine: 'claude', row: { ...DESIGN_ENGINES.claude, bridged: true }, bridgedInfo: { excludeTools: ['WebSearch'] } }));
  assert.deepEqual(bridged.disallowedTools, ['WebSearch']);
  assert.ok(bridged.writeGuard, 'a bridged model is still on the hook row');
  assert.equal('disallowedTools' in designSpawnOptions(base({ engine: 'claude', bridgedInfo: { excludeTools: [] } })), false);
});

test('the build spawns on the design engine: options, agent rows and frames, before and after a rehydrate', async () => {
  const d = newDesign({ engine: 'copilot' });
  const ctx = [];
  const record = (o) => {
    if (o.cwd !== designWorkDir(d.id)) {
      ctx.push(readdirSync(join(o.cwd, '.ctx')).sort());
      assert.ok(o.prompt.includes(`Tokens: ${join(o.cwd, '.ctx', 'tokens.css')}`), 'the first prompt names the copies');
      assert.ok(lstatSync(join(o.cwd, '.asks')).isDirectory(), 'the builder folder holds its .asks');
    }
    return mockRun(o);
  };
  const { build, frames, calls } = newBuild(d, { brief: 'MOCK_SECTIONS=2 MOCK_COST=0.25', deps: { runClaude: record } });
  assert.deepEqual(await build.run(), { status: 'done', reason: null });
  assert.ok(calls.length >= 4, 'lead, two builders and the integrate pass');
  for (const o of calls) assert.equal(o.engine, 'copilot');
  assert.ok(ctx.length >= 2 && ctx.every((names) => names.includes('crew.json') && names.includes('tokens.css')), 'every builder process gets its read bundle');
  for (const s of ['hero', 'features']) assert.equal(existsSync(join(sectionDir(d.id, s), '.ctx')), false, `${s}: the bundle goes after its process`);
  const rows = listAgents(build.id);
  assert.ok(rows.length >= 3);
  for (const r of rows) assert.equal(r.engine, 'copilot');
  const ag = framesOf(frames, 'design-agent');
  assert.ok(ag.length);
  for (const f of ag) assert.deepEqual([f.engine, f.costKnown], ['copilot', false]);
  assert.equal(getBuild(build.id).costUsd, 0, 'copilot reports no cost, so nothing is booked');

  // A lead stopped while it waits for the machine slot, rehydrated and continued: the restored agent keeps the engine.
  const held = newDesign({ engine: 'copilot' });
  let hold = true; let waited = false;
  const acquireGlobal = ({ signal }) => (!hold ? Promise.resolve() : new Promise((resolve, reject) => {
    waited = true;
    const bound = setTimeout(() => reject(new Error('hung')), 10_000);
    signal.addEventListener('abort', () => { clearTimeout(bound); reject(abortError()); }, { once: true });
  }));
  const first = newBuild(held, { brief: 'MOCK_SECTIONS=1 MOCK_COST=0.25', deps: { acquireGlobal } });
  const p = first.build.run();
  await waitUntil(() => waited);
  await first.build.stop('user');
  await p;
  hold = false;
  const two = again(first.build.id);
  assert.ok(two.b.snapshot().agents.every((a) => a.engine === 'copilot' && a.costKnown === false), 'restored agents read cost unknown');
  assert.deepEqual(await two.b.continue(), { status: 'done', reason: null });
  assert.ok(two.calls.length >= 3);
  for (const o of two.calls) assert.equal(o.engine, 'copilot');
  for (const f of framesOf(two.frames, 'design-agent')) assert.deepEqual([f.engine, f.costKnown], ['copilot', false]);
  for (const r of listAgents(first.build.id)) assert.equal(r.engine, 'copilot');
  assert.equal(getBuild(first.build.id).costUsd, 0, 'the restored lead books nothing either');
});

test('the build resolves its models on the design engine', async (t) => {
  const prev = { HOME: process.env.HOME, USERPROFILE: process.env.USERPROFILE, ALLOW: process.env.WORCA_TEST_ALLOW_HOME_FALLBACK };
  const home = outsideDir();
  t.after(() => {
    for (const [k, v] of [['HOME', prev.HOME], ['USERPROFILE', prev.USERPROFILE], ['WORCA_TEST_ALLOW_HOME_FALLBACK', prev.ALLOW]]) if (v === undefined) delete process.env[k]; else process.env[k] = v;
  });
  mkdirSync(join(home, '.worca-cc'));
  writeFileSync(join(home, '.worca-cc', 'settings.json'), JSON.stringify({ modelRoles: { claude: { deep: { model: 'claude-opus-5-5' }, everyday: { model: 'claude-sonnet-5-5' } } } }));
  process.env.HOME = home; process.env.USERPROFILE = home; process.env.WORCA_TEST_ALLOW_HOME_FALLBACK = '1';
  const models = async (engine) => {
    const { build } = newBuild(newDesign({ engine }), { brief: 'MOCK_SECTIONS=1' });
    assert.deepEqual(await build.run(), { status: 'done', reason: null });
    return listAgents(build.id).map((a) => [a.role, a.model]);
  };
  assert.deepEqual(await models('claude'), [['lead', 'claude-opus-5-5'], ['builder', 'claude-sonnet-5-5']]);
  assert.deepEqual(await models('copilot'), [['lead', null], ['builder', null]], 'Claude roles never reach another engine');
  // A bridged model's excluded tools reach the spawn (fixture as design-spawn-options' bridged row).
  t.after(() => stopBridge());
  await updateProvider('openai', { apiKey: 'sk-design-test', baseUrl: 'https://gateway.example.com/v1' });
  await addGlobalModel({ id: 'gw-bridged', upstream: { provider: 'openai', api: 'openai-chat', model: 'gpt-x', apiKey: '${WORCA_DESIGN_TEST_UNSET_KEY}' } });
  const { build } = newBuild(newDesign());
  const agent = build._newAgent({ role: 'builder', sectionId: 'hero', job: 'Hero', model: 'gw-bridged', effort: 'medium', cwd: sectionDir(build.designId, 'hero') });
  assert.deepEqual(build._processOptions(agent, 'P', 'first', new AbortController().signal, { onEvent() {} }).disallowedTools, ['WebSearch', 'WebFetch']);
});

test('a Claude build stages no read bundle, and its question files stay in work/.asks', async () => {
  const d = newDesign();
  const seen = [];
  const { build, frames } = newBuild(d, { brief: 'MOCK_SECTIONS=1 MOCK_ASK_SECTION=hero', deps: { runClaude: (o) => { if (isHero(o)) seen.push(existsSync(join(o.cwd, '.ctx'))); return mockRun(o); } } });
  const p = build.run();
  const q = await waitForFrame(frames, (f) => f.type === 'design-question');
  assert.ok(existsSync(join(asksDir(d.id), `${q.agentId}.json`)));
  build.answer(q.askId, [{ id: 'q1', value: 'a' }]);
  assert.deepEqual(await p, { status: 'done', reason: null });
  assert.ok(seen.length && seen.every((x) => x === false));
});

test('a locked-down builder asks through <section>/.asks, and the build hears it', async () => {
  const d = newDesign({ engine: 'codex' });
  const { build, frames, calls } = newBuild(d, { brief: 'MOCK_SECTIONS=1 MOCK_ASK_SECTION=hero' });
  const p = build.run();
  const q = await waitForFrame(frames, (f) => f.type === 'design-question');
  const file = join(sectionDir(d.id, 'hero'), '.asks', `${q.agentId}.json`);
  assert.ok(existsSync(file), 'the question file sits inside the builder cwd');
  assert.equal(existsSync(join(asksDir(d.id), `${q.agentId}.json`)), false);
  assert.ok(calls.find(isHero).prompt.split('\n').includes(`Question file: ${file}`));
  build.answer(q.askId, [{ id: 'q1', value: 'b' }]);
  assert.deepEqual(await p, { status: 'done', reason: null });
  assert.equal(existsSync(file), false, 'removed once the resume received it');
  assert.equal(getAgent(q.agentId).asks, 1);
});

test('a Continue asks a locked-down builder again from its own folder, whatever sections it names', async () => {
  const d = newDesign({ engine: 'codex' });
  const { build, frames } = newBuild(d, { brief: 'MOCK_SECTIONS=2 MOCK_ASK_SECTION=hero MOCK_FAIL_SECTION=features' });
  const p = build.run();
  const q = await waitForFrame(frames, (f) => f.type === 'design-question');
  await waitUntil(() => getBuild(build.id).sections.find((s) => s.id === 'features')?.status === 'failed');
  await build.stop('user');
  await p;
  assert.ok(existsSync(join(sectionDir(d.id, 'hero'), '.asks', `${q.agentId}.json`)), 'the question waits in the section');
  const two = again(build.id);
  const c = two.b.continue({ sections: ['features'] });
  const q2 = await waitForFrame(two.frames, (f) => f.type === 'design-question');
  assert.equal(q2.agentId, q.agentId);
  two.b.answer(q2.askId, [{ id: 'q1', value: 'a' }]);
  assert.deepEqual(await c, { status: 'done', reason: null });
});

test('a lost codex session starts over from the first prompt; a second loss fails the agent', async () => {
  const lost = new Error('codex exited with code 1: Error: thread/resume: thread/resume failed: no rollout found for thread id 00000000-0000-4000-8000-00000000dead (code -32600)');
  assert.equal(codexResumeNotFound(lost), true, 'the fixture is the adapter\'s own words');
  const { buildId } = await pausedHero('codex');
  const one = again(buildId, (o) => (isHero(o) && o.resumeSessionId ? Promise.reject(lost) : mockRun(o)));
  assert.deepEqual(await one.b.continue(), { status: 'done', reason: null });
  const heroCalls = one.calls.filter(isHero);
  assert.equal(heroCalls.length, 2);
  assert.ok(heroCalls[0].resumeSessionId);
  assert.equal(heroCalls[1].resumeSessionId, undefined);
  assert.match(heroCalls[1].prompt, /^Section: hero$/m, 'the full first prompt');

  const second = await pausedHero('codex');
  const two = again(second.buildId, (o) => (isHero(o) ? Promise.reject(lost) : mockRun(o)));
  assert.deepEqual(await two.b.continue(), { status: 'paused', reason: 'failed' });
  assert.equal(two.calls.filter(isHero).length, 2, 'one fresh start, never a third process');
  assert.match(getAgent(second.hero.id).error, /no rollout found/);
});

test('a gemini session the adapter restarted fresh counts as lost: the agent runs once more on its first prompt', async () => {
  const { buildId } = await pausedHero('gemini');
  const runner = (o) => {
    if (!isHero(o) || !o.resumeSessionId) return mockRun(o);
    // The adapter's retry: its "is gone" line, then a fresh session on the SAME prompt, which ends ok.
    o.onEvent({ type: 'stderr', stream: 'err', text: goneLine('gemini', o.resumeSessionId) });
    return mockRun({ ...o, resumeSessionId: undefined });
  };
  const one = again(buildId, runner);
  assert.deepEqual(await one.b.continue(), { status: 'done', reason: null });
  const heroCalls = one.calls.filter(isHero);
  assert.equal(heroCalls.length, 2);
  assert.ok(heroCalls[0].resumeSessionId);
  assert.doesNotMatch(heroCalls[0].prompt, /^Section: hero$/m, 'the resume carried no task');
  assert.equal(heroCalls[1].resumeSessionId, undefined);
  assert.match(heroCalls[1].prompt, /^Section: hero$/m);

  // The same line on a spawn that resumed nothing is no loss, and on a resumed one any other stderr line is none.
  const fresh = newBuild(newDesign({ engine: 'gemini' }), { brief: 'MOCK_SECTIONS=1', deps: { runClaude: (o) => {
    if (isHero(o)) o.onEvent({ type: 'stderr', stream: 'err', text: goneLine('gemini', 'x'.repeat(20)) });
    return mockRun(o);
  } } });
  assert.deepEqual(await fresh.build.run(), { status: 'done', reason: null });
  assert.equal(fresh.calls.filter(isHero).length, 1, 'nothing was resumed, so nothing was lost');
  const quiet = await pausedHero('gemini');
  const two = again(quiet.buildId, (o) => {
    if (isHero(o)) o.onEvent({ type: 'stderr', stream: 'err', text: `${goneLine('gemini', o.resumeSessionId ?? 'x')} anyway` });
    return mockRun(o);
  });
  assert.deepEqual(await two.b.continue(), { status: 'done', reason: null });
  assert.equal(two.calls.filter(isHero).length, 1);
});

test('a gemini session lost again after its fresh start fails the agent', async () => {
  const runner = (o) => {
    if (!isHero(o) || !o.resumeSessionId) return mockRun(o);
    o.onEvent({ type: 'stderr', stream: 'err', text: goneLine('gemini', o.resumeSessionId) });
    return mockRun({ ...o, resumeSessionId: undefined });
  };
  // hero asks on every process: answered, its resume restarts fresh (lost once), its first prompt asks again, and
  // the "no more questions" resume restarts fresh again.
  const { build, frames, calls } = newBuild(newDesign({ engine: 'gemini' }), { brief: 'MOCK_SECTIONS=1 MOCK_ASK_ALWAYS_SECTION=hero', deps: { runClaude: runner } });
  const p = build.run();
  const q = await waitForFrame(frames, (f) => f.type === 'design-question');
  build.answer(q.askId, [{ id: 'q1', value: 'a' }]);
  assert.deepEqual(await p, { status: 'paused', reason: 'failed' });
  assert.deepEqual(calls.filter(isHero).map((o) => Boolean(o.resumeSessionId)), [false, true, false, true]);
  assert.match(calls.filter(isHero)[2].prompt, /^Section: hero$/m);
  assert.match(getAgent(q.agentId).error, /lost again/);
});

test('read bundle: copies staged without following links, removed whole', () => {
  const d = newDesign();
  const work = designWorkDir(d.id);
  const sec = sectionDir(d.id, 'hero');
  mkdirSync(sec, { recursive: true });
  writeFileSync(join(work, 'tokens.css'), ':root{--a:1}');
  writeFileSync(crewFile(d.id), '[]');
  const r = stageReadBundle({ designId: d.id, sectionId: 'hero' });
  assert.equal(r.dir, join(sec, '.ctx'));
  assert.deepEqual(r.files, ['crew.json', 'tokens.css']);
  assert.equal(readFileSync(join(r.dir, 'crew.json'), 'utf8'), '[]');
  writeFileSync(join(work, 'plan.json'), '{}');
  writeFileSync(join(work, 'brand.md'), '# brand');
  writeFileSync(join(work, 'global.css'), 'body{}');
  mkdirSync(kitDir(d.id), { recursive: true });
  writeFileSync(join(kitDir(d.id), 'CONTRACT.md'), 'kit');
  assert.deepEqual(stageReadBundle({ designId: d.id, sectionId: 'hero' }).files, ['CONTRACT.md', 'brand.md', 'crew.json', 'global.css', 'plan.json', 'tokens.css']);
  assert.equal(readFileSync(join(r.dir, 'CONTRACT.md'), 'utf8'), 'kit');

  // A `.ctx` planted as a link to an outside folder: replaced by a real folder, the outside folder untouched.
  const out = outsideDir();
  writeFileSync(join(out, 'keep.txt'), 'keep');
  removeReadBundle({ designId: d.id, sectionId: 'hero' });
  assert.equal(existsSync(r.dir), false);
  symlinkSync(out, r.dir, LINK);
  stageReadBundle({ designId: d.id, sectionId: 'hero' });
  assert.ok(lstatSync(r.dir).isDirectory() && !lstatSync(r.dir).isSymbolicLink());
  assert.deepEqual(readdirSync(out), ['keep.txt']);
  removeReadBundle({ designId: d.id, sectionId: 'hero' });
  assert.throws(() => lstatSync(r.dir), { code: 'ENOENT' });
  assert.deepEqual(readdirSync(out), ['keep.txt']);
});

const LOCKED = { skip: process.platform === 'win32' || process.getuid?.() === 0 ? 'POSIX, not root: a read-only folder stands in for EACCES' : false };
/** Counting machine slots for `newBuild`'s deps. */
const slotCounter = () => { const slot = { taken: 0, freed: 0 }; return { slot, deps: { acquireGlobal: async () => { slot.taken += 1; }, releaseGlobal: () => { slot.freed += 1; } } }; };

test('M4: a read bundle that cannot be staged fails its builder and gives back its machine slot and running count', LOCKED, async () => {
  const d = newDesign({ engine: 'codex' });
  const hero = sectionDir(d.id, 'hero');
  const { slot, deps } = slotCounter();
  let locked = false;
  const error = console.error;
  console.error = () => {};
  let build;
  try {
    // Locked once the builder's process is counted and its folder made, right before the bundle is staged.
    ({ build } = newBuild(d, { brief: 'MOCK_SECTIONS=1', deps: { ...deps,
      onLiveChange: () => { if (!locked && build.runningCount === 1 && existsSync(join(hero, '.asks'))) { chmodSync(hero, 0o555); locked = true; } },
    } }));
    assert.deepEqual(await build.run(), { status: 'paused', reason: 'failed' });
  } finally {
    chmodSync(hero, 0o755);
    console.error = error;
  }
  assert.equal(locked, true, 'the section was locked before staging');
  assert.match(listAgents(build.id).find((a) => a.sectionId === 'hero').error, /EACCES/);
  assert.deepEqual([build.runningCount, slot.taken, slot.freed], [0, 2, 2], 'every slot taken is given back');
});

test('M4: a read bundle that cannot be removed is logged, and the slot and running count still go back', LOCKED, async () => {
  const d = newDesign({ engine: 'codex' });
  const hero = sectionDir(d.id, 'hero');
  const { slot, deps } = slotCounter();
  const logged = [];
  const error = console.error;
  console.error = (m) => { logged.push(String(m)); };
  let build;
  try {
    ({ build } = newBuild(d, { brief: 'MOCK_SECTIONS=1', deps: { ...deps,
      runClaude: async (o) => { const r = await mockRun(o); if (isHero(o)) chmodSync(o.cwd, 0o555); return r; },
    } }));
    assert.deepEqual(await build.run(), { status: 'done', reason: null });
  } finally {
    chmodSync(hero, 0o755);
    console.error = error;
  }
  assert.ok(logged.some((m) => /read bundle of hero not removed: .*EACCES/.test(m)), logged.join('\n'));
  assert.deepEqual([build.runningCount, slot.taken, slot.freed], [0, slot.taken, slot.taken], 'every slot taken is given back');
  assert.ok(slot.taken >= 3, 'the lead, the builder and the integrate pass');
});

test('cycle 5 major 4: a .ctx worca cannot remove (an agent\'s 0555 folder holding a file) is set aside: every later staging and removal succeeds', LOCKED, () => {
  const d = newDesign();
  const sec = sectionDir(d.id, 'hero');
  mkdirSync(sec, { recursive: true });
  writeFileSync(join(designWorkDir(d.id), 'tokens.css'), ':root{}');
  const { dir } = stageReadBundle({ designId: d.id, sectionId: 'hero' });
  const lines = [];
  const warn = console.warn;
  console.warn = (...a) => { lines.push(a.join(' ')); };
  try {
    for (const round of [1, 2]) {
      chmodSync(dir, 0o555);
      assert.deepEqual(stageReadBundle({ designId: d.id, sectionId: 'hero' }).files, ['tokens.css'], `staging ${round}`);
      assert.equal(readFileSync(join(dir, 'tokens.css'), 'utf8'), ':root{}');
    }
    chmodSync(dir, 0o555);
    removeReadBundle({ designId: d.id, sectionId: 'hero' });
    assert.equal(existsSync(dir), false, 'out of the section');
  } finally {
    console.warn = warn;
    for (const n of readdirSync(sec)) if (n.includes('.ctx')) chmodSync(join(sec, n), 0o755);
  }
  assert.equal(readdirSync(sec).filter((n) => n.startsWith('..ctx-')).length, 3, 'each set aside in the section');
  assert.equal(lines.filter((l) => /\.ctx could not be removed/.test(l)).length, 3, lines.join(' | '));
});

test('read bundle: a planted copy link is replaced, and a source linked out of work/ is never copied', POSIX, () => {
  const d = newDesign();
  const work = designWorkDir(d.id);
  mkdirSync(sectionDir(d.id, 'hero'), { recursive: true });
  writeFileSync(join(work, 'tokens.css'), ':root{}');
  const out = outsideDir();
  writeFileSync(join(out, 'secret.txt'), 'secret');
  const { dir } = stageReadBundle({ designId: d.id, sectionId: 'hero' });
  rmSync(join(dir, 'tokens.css'));
  symlinkSync(join(out, 'secret.txt'), join(dir, 'tokens.css'));
  stageReadBundle({ designId: d.id, sectionId: 'hero' });
  assert.ok(lstatSync(join(dir, 'tokens.css')).isFile());
  assert.equal(readFileSync(join(dir, 'tokens.css'), 'utf8'), ':root{}');
  assert.equal(readFileSync(join(out, 'secret.txt'), 'utf8'), 'secret', 'the link target is never written');
  symlinkSync(join(out, 'secret.txt'), join(work, 'brand.md'));
  assert.deepEqual(stageReadBundle({ designId: d.id, sectionId: 'hero' }).files, ['tokens.css'], 'brand.md links out of work/');
});

test('prompts name the copies', () => {
  const work = designWorkDir(D.id);
  const sec = sectionDir(D.id, 'hero');
  const readRoot = join(sec, '.ctx');
  const section = { id: 'hero', job: 'Hero', brief: 'B', parts: ['html'] };
  const shared = { section, notes: '', sectionDir: sec, tokensCss: join(work, 'tokens.css'), globalCss: join(work, 'global.css'), crewJson: crewFile(D.id), questionFile: join(sec, '.asks', 'a_1.json') };
  const p = builderPrompt({ ...shared, kitContract: join(kitDir(D.id), 'CONTRACT.md'), readRoot });
  for (const f of ['tokens.css', 'global.css', 'crew.json', 'CONTRACT.md']) assert.ok(p.includes(join(readRoot, f)), f);
  for (const f of [join(work, 'tokens.css'), join(work, 'global.css'), crewFile(D.id), join(kitDir(D.id), 'CONTRACT.md')]) assert.equal(p.includes(f), false, f);
  assert.doesNotMatch(builderPrompt({ ...shared, kitContract: null, readRoot }), /^Kit contract:/m, 'no kit, no line');
  assert.ok(builderPrompt(shared).includes(join(work, 'tokens.css')), 'without readRoot the work/ paths stay');
  const s = builderSystemPrompt({ kind: 'web', readRoot });
  assert.ok(s.includes(readRoot));
  assert.match(s, /read-only copies/);
  assert.match(s, /never link to them or `@import` them/);
  assert.equal(builderSystemPrompt().includes('.ctx'), false, 'the hook row keeps the shared prompt');
  assert.ok(builderSystemPrompt({ kind: 'pitch', readRoot }).startsWith(s.slice(0, s.lastIndexOf('\n\nA web page:\n') + 2)), 'a deck adds its block after the same text');
});

test('asks inside the cwd where that is all the engine can write', () => {
  const d = newDesign();
  const sec = sectionDir(d.id, 'hero');
  const at = (row, sectionId) => asksFileFor({ row, designId: d.id, sectionId, agentId: 'a_00000001' });
  assert.equal(at(DESIGN_ENGINES.claude, 'hero'), join(asksDir(d.id), 'a_00000001.json'));
  assert.equal(at(DESIGN_ENGINES.codex, 'hero'), join(sec, '.asks', 'a_00000001.json'));
  assert.equal(at(DESIGN_ENGINES.codex, null), join(asksDir(d.id), 'a_00000001.json'), 'a lead writes all of work/');
  const file = at(DESIGN_ENGINES.gemini, 'hero');
  mkdirSync(sec, { recursive: true });
  assert.equal(readAskFile(file), null, 'a missing section .asks reads null');
  removeAskFile(file);
  mkdirSync(join(sec, '.asks'));
  writeFileSync(file, JSON.stringify({ questions: [Q] }));
  assert.deepEqual(readAskFile(file), { questions: [Q] });
  removeAskFile(file);
  assert.equal(existsSync(file), false);
  assert.ok(existsSync(join(sec, '.asks')), 'only the file goes');
  // A section .asks planted as a link: invalid, and removing it takes the link, never its target.
  rmSync(join(sec, '.asks'), { recursive: true });
  const out = outsideDir();
  writeFileSync(join(out, 'a_00000001.json'), JSON.stringify({ questions: [Q] }));
  symlinkSync(out, join(sec, '.asks'), LINK);
  assert.equal(typeof readAskFile(file).invalid, 'string');
  removeAskFile(file);
  assert.throws(() => lstatSync(join(sec, '.asks')), { code: 'ENOENT' });
  assert.equal(readFileSync(join(out, 'a_00000001.json'), 'utf8'), JSON.stringify({ questions: [Q] }));
});

test('the lead hears about the project only where it can read it', () => {
  const p = (engine) => leadPlanPrompt({ brief: 'B', projectDir: '/p', questionFile: '/q', planFile: '/f', row: DESIGN_ENGINES[engine] });
  for (const e of ['claude', 'codex', 'cursor']) assert.match(p(e), /^Project: \/p /m, e);
  for (const e of ['gemini', 'copilot']) assert.doesNotMatch(p(e), /\/p /, e);
  assert.match(leadPlanPrompt({ brief: 'B', projectDir: '/p', questionFile: '/q', planFile: '/f' }), /^Project: \/p /m, 'no row: as before');
  for (const [engine, named] of [['gemini', false], ['claude', true], ['codex', true]]) {
    const { build } = newBuild(newDesign({ engine }));
    build._projectDir = '/proj';
    assert.equal(/^Project: \/proj /m.test(build._leadPlanPrompt({ id: 'a_00000001' })), named, engine);
  }
});

test('_readWork reads through readConfined: a link out of work/ or a FIFO reads null, never blocking', POSIX, () => {
  const d = newDesign();
  const { build } = newBuild(d);
  const sec = sectionDir(d.id, 'hero');
  mkdirSync(sec, { recursive: true });
  const out = outsideDir();
  writeFileSync(join(out, 'secret.html'), 'secret');
  const index = join(sec, 'index.html');
  symlinkSync(join(out, 'secret.html'), index);
  assert.equal(build._readWork('sections/hero/index.html'), null);
  rmSync(index);
  execFileSync('mkfifo', [index]);
  assert.equal(build._readWork('sections/hero/index.html'), null);
  rmSync(index);
  writeFileSync(index, '<div data-section="hero">ok</div>');
  assert.equal(build._readWork('sections/hero/index.html'), '<div data-section="hero">ok</div>');
});

test('a stored mock engine builds as Claude did: the hook row, spawned as claude', async () => {
  const { build, calls } = newBuild(newDesign({ engine: 'mock' }), { brief: 'MOCK_SECTIONS=1' });
  assert.deepEqual(await build.run(), { status: 'done', reason: null });
  for (const o of calls) assert.equal(o.engine, 'claude');
  assert.ok(calls.every((o) => o.writeGuard), 'the hook row keeps its guard');
});

test('off the hook row, a deck stages its kit again before assembly, so a lead edit of .kit never reaches it', async () => {
  const edited = [];
  const run = async (engine) => {
    let staged = 0;
    const d = newDesign({ kind: 'pitch', engine });
    const stageKit = async (o) => { staged += 1; return stageDesignKit(o); };
    // The lead edits the kit's runtime during its plan pass, as an engine with no write hook can.
    const lead = async (o) => {
      const r = await mockRun(o);
      if (o.maxTurns === 80) {
        const runtime = join(kitDir(d.id), 'deck-stage.js');
        assert.ok(existsSync(runtime), 'the drive staged the deck runtime');
        writeFileSync(runtime, 'window.LEAD_EDIT = 1;');
        edited.push(runtime);
      }
      return r;
    };
    const { build } = newBuild(d, { brief: 'MOCK_SECTIONS=1', deps: { stageKit, runClaude: lead } });
    assert.deepEqual(await build.run(), { status: 'done', reason: null });
    return { staged, html: readFileSync(join(distDir(d.id), 'index.html'), 'utf8') };
  };
  const codex = await run('codex');
  assert.equal(codex.staged, 2, 'at the drive and again before assembly');
  assert.doesNotMatch(codex.html, /LEAD_EDIT/);
  assert.equal((await run('claude')).staged, 1, 'the hook row keeps the lead out of .kit');
  assert.ok(edited.length === 2 && edited[0], 'the fixture edited a runtime file');
});
