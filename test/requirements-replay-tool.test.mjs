// test/requirements-replay-tool.test.mjs — the interview cost replay tool, with a fake spawn; never a real claude and never a real model call.
import { test, after, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { useTempHome } from './helpers/temp-home.mjs';
import {
  main, loadFixture, replayPlan, splitCost, summarize, compareReports, measureCall,
} from '../tools/requirements-replay.mjs';
import { REPO_LOOK_TOOLS } from '../src/core/auto/classify.mjs';
import { ROUND_SYSTEM_PROMPT } from '../src/core/requirements/round.mjs';

useTempHome(after);
const work = mkdtempSync(join(tmpdir(), 'req-replay-'));
const FIXTURE = loadFixture(fileURLToPath(new URL('../tools/requirements-replay.fixture.json', import.meta.url)));
const MODEL = 'claude-opus-5-5';
const noMock = {};
let savedDebug;
beforeEach(() => { savedDebug = process.env.WORCA_DEBUG_SPAWN; });
afterEach(() => { if (savedDebug === undefined) delete process.env.WORCA_DEBUG_SPAWN; else process.env.WORCA_DEBUG_SPAWN = savedDebug; });

const logger = () => { const lines = []; return { lines, log: (s) => lines.push(String(s)) }; };

const USAGE_OBJ = { input_tokens: 10, cache_creation_input_tokens: 600, cache_read_input_tokens: 4000, output_tokens: 200,
  cache_creation: { ephemeral_5m_input_tokens: 500, ephemeral_1h_input_tokens: 100 } };

/** A fake spawn: a raw init frame, the spawn-debug stderr line, and a raw result. `reply(i)` gives call i's text. */
function fakeSpawn({ cost = 0.1, reply, fail = [] } = {}) {
  const calls = [];
  const debugSpawn = [];   // process.env.WORCA_DEBUG_SPAWN as each call saw it
  const spawn = async (opts) => {
    const i = calls.length;
    calls.push(opts);
    debugSpawn.push(process.env.WORCA_DEBUG_SPAWN);
    if (fail.includes(i)) throw new Error('boom');
    const text = reply ? reply(i) : '{}';
    opts.onEvent({ type: 'system', raw: { type: 'system', subtype: 'init', apiKeySource: 'none', tools: ['a', 'b'], plugins: [], skills: ['s'], slash_commands: ['x', 'y', 'z'], mcp_servers: [{ name: 'm' }] } });
    opts.onEvent({ type: 'stderr', stream: 'err', text: '[worca] spawn-debug: bin="claude" argv=["-p","--system-prompt","S","--model","m"] promptViaStdin=true staged=false envScrub=on childEnvKeys=3 routingEnv=[(none)]' });
    opts.onEvent({ type: 'result', raw: { type: 'result', subtype: 'success', result: text, total_cost_usd: cost, usage: USAGE_OBJ,
      modelUsage: { [MODEL]: {} }, num_turns: 1, duration_ms: 1234 }, text, costUsd: cost });
    return { text };
  };
  return { calls, debugSpawn, spawn };
}

test('WORCA_MOCK set: exit 2 before anything, even the dry run text', async () => {
  const { lines, log } = logger();
  const f = fakeSpawn();
  const code = await main([], { spawn: f.spawn, log, env: { WORCA_MOCK: '1' } });
  assert.equal(code, 2);
  assert.match(lines.join('\n'), /unset WORCA_MOCK/);
  assert.doesNotMatch(lines.join('\n'), /Dry run/);
  assert.equal(await main([], { spawn: f.spawn, log, env: { ORCH_MOCK: '1' } }), 2);
  assert.equal(f.calls.length, 0);
});

test('dry run: one line per call, never spawns, exit 0', async () => {
  const { lines, log } = logger();
  const f = fakeSpawn();
  const code = await main(['--rounds', '3', '--model', MODEL], { spawn: f.spawn, log, env: noMock, userSignIn: () => false });
  assert.equal(code, 0);
  assert.equal(f.calls.length, 0);
  assert.equal(lines.filter((l) => /^round \d/.test(l)).length, 3);
  assert.match(lines.at(-1), /Dry run: nothing was sent\. Add --yes to call the model \(this costs money\)\./);
});

test('rounds outside 1..6 are a usage error', async () => {
  const { log } = logger();
  assert.equal(await main(['--rounds', '7'], { spawn: fakeSpawn().spawn, log, env: noMock }), 2);
  assert.equal(await main(['--rounds', '0'], { spawn: fakeSpawn().spawn, log, env: noMock }), 2);
});

test('the fixture is product language with no paths, five rounds, ~6 criteria and 3 assumptions', () => {
  assert.equal(FIXTURE.rounds.length, 5);
  const last = FIXTURE.rounds.at(-1).specAfter;
  assert.equal(last.criteria.length, 6);
  assert.equal(last.assumptions.length, 3);
  assert.deepEqual(last.openQuestions, []);
  assert.doesNotMatch(readFileSync(new URL('../tools/requirements-replay.fixture.json', import.meta.url), 'utf8'), /[A-Za-z]:\\|\/Users\/|\/home\//);
});

test('replayPlan: 3 rounds carry the earlier answers and the previous spec', () => {
  const plan = replayPlan(FIXTURE, { rounds: 3, roundCwd: work, model: MODEL });
  assert.deepEqual(plan.map((c) => [c.kind, c.round]), [['round', 1], ['round', 2], ['round', 3]]);
  const firstAnswer = FIXTURE.rounds[0].answers[0].answer;
  assert.doesNotMatch(plan[0].options.prompt, new RegExp(firstAnswer));
  assert.match(plan[1].options.prompt, new RegExp(firstAnswer));
  // round 1 starts from an empty spec; round 2 from round 1's specAfter
  assert.doesNotMatch(plan[0].options.prompt, /R-po-1/);
  assert.match(plan[1].options.prompt, /R-po-1/);
  assert.match(plan[1].options.prompt, new RegExp(FIXTURE.rounds[0].specAfter.criteria[0].text.slice(0, 30)));
  assert.match(plan[2].options.prompt, new RegExp(FIXTURE.rounds[1].specAfter.criteria[3].text.slice(0, 30)));
  assert.match(plan[2].options.prompt, /round 3 of at most 6/);
  assert.equal(plan[0].options.cwd, work);
  assert.equal(plan[0].options.effort, 'medium');
  assert.deepEqual(plan[0].options.tools, []);
});

test('replayPlan: --look adds a first look call with the look tools', () => {
  const plan = replayPlan(FIXTURE, { rounds: 2, lookDir: work, roundCwd: work, model: MODEL });
  assert.equal(plan.length, 3);
  assert.equal(plan[0].kind, 'look');
  assert.equal(plan[0].options.cwd, work);
  assert.deepEqual(plan[0].options.tools, [...REPO_LOOK_TOOLS]);
  assert.equal(plan[1].round, 1);
});

test('splitCost: prompt and output weights add up to the cost', () => {
  const s = splitCost(1, { input_tokens: 100, output_tokens: 20 });   // P = 100, O = 100
  assert.equal(s.promptCostUsd, 0.5);
  assert.equal(s.outputCostUsd, 0.5);
  const t = splitCost(0.3, USAGE_OBJ);
  const P = 10 + 1.25 * 500 + 2 * 100 + 0.1 * 4000;
  assert.ok(Math.abs(t.promptCostUsd - 0.3 * P / (P + 1000)) < 1e-12);
  assert.ok(Math.abs(t.promptCostUsd + t.outputCostUsd - 0.3) < 1e-12);
});

test('measureCall: reads the init frame, the spawn-debug argv, tokens and the reply', async () => {
  const plan = replayPlan(FIXTURE, { rounds: 1, roundCwd: work, model: MODEL });
  const reply = JSON.stringify({ spec: { goal: { text: 'g', measure: 'm' } }, criteria: [{ id: null, text: 'A shopper can add a gift message' }], questions: [], done: false, note: 'n' });
  const f = fakeSpawn({ cost: 0.2, reply: () => reply });
  const rec = await measureCall(f.spawn, plan[0], { timeoutMs: 5000 });
  assert.equal(rec.ok, true);
  assert.deepEqual(rec.loaded, { apiKeySource: 'none', tools: 2, plugins: 0, skills: 1, slashCommands: 3, mcpServers: 1 });
  assert.equal(rec.systemPromptFlag, 'replace');
  assert.equal(rec.inputTokens, 10);
  assert.equal(rec.cacheWrite5m, 500);
  assert.equal(rec.cacheWrite1h, 100);
  assert.equal(rec.cacheWriteTokens, 600);
  assert.equal(rec.cacheReadTokens, 4000);
  assert.equal(rec.outputTokens, 200);
  assert.deepEqual(rec.models, [MODEL]);
  assert.equal(rec.numTurns, 1);
  assert.equal(rec.durationMs, 1234);
  assert.equal(rec.costUsd, 0.2);
  assert.ok(Math.abs(rec.promptCostUsd + rec.outputCostUsd - 0.2) < 1e-12);
  assert.equal(rec.replyReadable, true);
  assert.equal(f.calls[0].signal instanceof AbortSignal, true);
});

test('measureCall: an unreadable reply is ok but not readable; a throw is recorded', async () => {
  const plan = replayPlan(FIXTURE, { rounds: 1, roundCwd: work, model: MODEL });
  const bad = await measureCall(fakeSpawn({ reply: () => 'not json at all' }).spawn, plan[0], { timeoutMs: 5000 });
  assert.equal(bad.ok, true);
  assert.equal(bad.replyReadable, false);
  const thrown = await measureCall(fakeSpawn({ fail: [0] }).spawn, plan[0], { timeoutMs: 5000 });
  assert.equal(thrown.ok, false);
  assert.equal(thrown.error, 'boom');
});

test('--yes: the report adds up, sets WORCA_DEBUG_SPAWN, and --out writes the JSON', async () => {
  delete process.env.WORCA_DEBUG_SPAWN;
  const { lines, log } = logger();
  const f = fakeSpawn({ cost: 0.1 });
  const out = join(work, 'report.json');
  const code = await main(['--rounds', '3', '--model', MODEL, '--yes', '--label', 'before', '--out', out], { spawn: f.spawn, log, env: noMock, userSignIn: () => false });
  assert.equal(code, 0);
  assert.deepEqual(f.debugSpawn, ['1', '1', '1'], 'WORCA_DEBUG_SPAWN is 1 during every call');
  assert.equal(process.env.WORCA_DEBUG_SPAWN, undefined);   // restored after the run
  assert.equal(f.calls.length, 3);
  assert.match(lines.join('\n'), /^TOTAL/m);
  const rep = JSON.parse(readFileSync(out, 'utf8'));
  assert.equal(rep.version, 1);
  assert.equal(rep.label, 'before');
  assert.equal(rep.model, MODEL);
  assert.equal(rep.variant, null);
  assert.equal(rep.fixture, 'requirements-replay.fixture.json');
  assert.equal(rep.calls.length, 3);
  assert.equal(rep.calls[0].systemPromptFlag, 'replace');
  assert.equal(rep.totals.inputTokens, 30);
  assert.equal(rep.totals.cacheReadTokens, 12000);
  assert.equal(rep.totals.outputTokens, 600);
  assert.ok(Math.abs(rep.totals.costUsd - 0.3) < 1e-9);
  assert.ok(Math.abs(rep.totals.promptCostUsd + rep.totals.outputCostUsd - 0.3) < 1e-9);
  assert.ok(Math.abs(rep.totals.promptCostRounds2toN - (rep.calls[1].promptCostUsd + rep.calls[2].promptCostUsd)) < 1e-5);
  const sum = summarize(rep.calls);
  assert.deepEqual(sum, rep.totals);
  assert.equal(f.calls[0].spawnEnv, undefined);
});

test('--max-usd 0.15 with $0.10 calls stops after two and marks the rest skipped', async () => {
  const { log } = logger();
  const f = fakeSpawn({ cost: 0.1 });
  const out = join(work, 'capped.json');
  const code = await main(['--rounds', '4', '--model', MODEL, '--yes', '--max-usd', '0.15', '--out', out], { spawn: f.spawn, log, env: noMock, userSignIn: () => false });
  assert.equal(code, 1);
  assert.equal(f.calls.length, 2);
  const rep = JSON.parse(readFileSync(out, 'utf8'));
  assert.deepEqual(rep.calls.map((c) => c.skipped), [null, null, 'max-usd', 'max-usd']);
});

test('--no-cache passes DISABLE_PROMPT_CACHING to every call', async () => {
  const { log } = logger();
  const f = fakeSpawn();
  await main(['--rounds', '2', '--model', MODEL, '--yes', '--no-cache'], { spawn: f.spawn, log, env: noMock, userSignIn: () => false });
  assert.equal(f.calls.length, 2);
  for (const c of f.calls) assert.deepEqual(c.spawnEnv, { DISABLE_PROMPT_CACHING: '1' });
});

test('a throwing call is recorded, the replay goes on, and the exit code is 1', async () => {
  const { log } = logger();
  const f = fakeSpawn({ fail: [0] });
  const out = join(work, 'failed.json');
  const code = await main(['--rounds', '2', '--model', MODEL, '--yes', '--out', out], { spawn: f.spawn, log, env: noMock, userSignIn: () => false });
  assert.equal(code, 1);
  assert.equal(f.calls.length, 2);
  const rep = JSON.parse(readFileSync(out, 'utf8'));
  assert.equal(rep.calls[0].ok, false);
  assert.equal(rep.calls[0].error, 'boom');
  assert.equal(rep.calls[1].ok, true);
});

test('--compare: per-call and total deltas and percentages; spawns nothing', async () => {
  const rec = (kind, round, costUsd, wallMs) => ({ kind, round, costUsd, promptCostUsd: costUsd / 2, outputCostUsd: costUsd / 2, cacheWriteTokens: 100, cacheReadTokens: 1000, outputTokens: 50, wallMs });
  const a = { calls: [rec('round', 1, 0.2, 4000), rec('round', 2, 0.1, 3000)], totals: { costUsd: 0.3, wallMs: 7000 } };
  const b = { calls: [rec('round', 1, 0.1, 2000), rec('round', 2, 0.1, 3000)], totals: { costUsd: 0.2, wallMs: 5000 } };
  const cmp = compareReports(a, b);
  assert.equal(cmp.calls.length, 2);
  assert.deepEqual(cmp.calls[0].metrics.costUsd, { a: 0.2, b: 0.1, delta: -0.1, pct: -50 });
  assert.equal(cmp.calls[1].metrics.costUsd.delta, 0);
  assert.deepEqual(cmp.totals.wallMs, { a: 7000, b: 5000, delta: -2000, pct: -28.571429 });
  const pa = join(work, 'a.json');
  const pb = join(work, 'b.json');
  writeFileSync(pa, JSON.stringify(a)); writeFileSync(pb, JSON.stringify(b));
  const { lines, log } = logger();
  const f = fakeSpawn();
  assert.equal(await main(['--compare', pa, pb], { spawn: f.spawn, log, env: noMock }), 0);
  assert.equal(f.calls.length, 0);
  assert.match(lines.join('\n'), /-50\.0%/);
  assert.equal(await main(['--compare', pa], { spawn: f.spawn, log, env: noMock }), 2);
});

test('replayPlan: 6 rounds work from 5 fixture rounds; the last is final and carries round 5 answers', () => {
  const plan = replayPlan(FIXTURE, { rounds: 6, roundCwd: work, model: MODEL });
  assert.equal(plan.length, 6);
  assert.equal(plan[5].check.final, true);
  assert.equal(plan[4].check.final, false);
  assert.match(plan[5].options.prompt, new RegExp(FIXTURE.rounds[4].answers[0].answer));
  assert.match(plan[5].options.prompt, /This is the final round/);
  assert.throws(() => replayPlan(FIXTURE, { rounds: 7, roundCwd: work, model: MODEL }));
});

test('a call without a result frame is not ok; --yes without a resolvable model is refused', async () => {
  const plan = replayPlan(FIXTURE, { rounds: 1, roundCwd: work, model: MODEL });
  const rec = await measureCall(async () => ({ text: '{}' }), plan[0], { timeoutMs: 5000 });
  assert.equal(rec.ok, false);
  assert.equal(rec.error, 'no result');
  const { lines, log } = logger();
  const f = fakeSpawn();
  assert.equal(await main(['--yes'], { spawn: f.spawn, log, env: noMock, resolveModel: async () => undefined }), 2);
  assert.match(lines.join('\n'), /--model/);
  assert.equal(f.calls.length, 0);
});

// ── A1.1 Task 3: the calls are the interview's (replace mode, hermetic), and the system-stable variant ──
test('replayPlan: every call is replace mode and hermetic unless the user settings carry sign-in; the look names its directory', () => {
  const plan = replayPlan(FIXTURE, { rounds: 2, lookDir: work, roundCwd: work, model: MODEL });
  for (const c of plan) {
    assert.equal(c.options.systemPromptMode, 'replace');
    assert.deepEqual(c.options.settingSources, ['project']);
    assert.equal(c.options.disableSlashCommands, true);
  }
  assert.ok(plan[0].options.prompt.includes(`The working directory, ${work}, is a checkout of the project.`));
  for (const c of replayPlan(FIXTURE, { rounds: 2, lookDir: work, roundCwd: work, model: MODEL, keepUserSettings: true })) {
    assert.equal('settingSources' in c.options, false);
    assert.equal(c.options.disableSlashCommands, true);
  }
});

test('replayPlan --variant system-stable: the stable blocks move into the system prompt; the look is unchanged', () => {
  const plain = replayPlan(FIXTURE, { rounds: 3, lookDir: work, roundCwd: work, model: MODEL });
  const plan = replayPlan(FIXTURE, { rounds: 3, lookDir: work, roundCwd: work, model: MODEL, variant: 'system-stable' });
  assert.deepEqual(plan[0].options, plain[0].options, 'the look call is unchanged');
  for (const c of plan.slice(1)) {
    assert.ok(c.options.systemPrompt.startsWith(`${ROUND_SYSTEM_PROMPT}\n\n<feature id=`), `round ${c.round}`);
    for (const tag of ['<feature id=', '<description>', '<project_context>', '<what_worca_found_in_the_code>']) {
      assert.ok(c.options.systemPrompt.includes(tag), `${tag} in the system prompt`);
      assert.ok(!c.options.prompt.includes(tag), `${tag} not in the prompt`);
    }
    assert.match(c.options.prompt, /^<thread>\n/);
    assert.equal(c.options.systemPromptMode, 'replace');
  }
  assert.equal(plan[2].options.systemPrompt, plan[3].options.systemPrompt, 'one system prompt across rounds');
  const p = plain[2].options.prompt;
  assert.equal(`${plan[2].options.systemPrompt.slice(ROUND_SYSTEM_PROMPT.length + 2)}\n\n${plan[2].options.prompt}`, p, 'the same text, split');
  assert.throws(() => replayPlan(FIXTURE, { rounds: 1, roundCwd: work, model: MODEL, variant: 'nope' }));
});

test('--variant system-stable and the kept user settings are recorded in the report; an unknown variant is a usage error', async () => {
  const { log } = logger();
  const f = fakeSpawn();
  const out = join(work, 'variant.json');
  const code = await main(['--rounds', '2', '--model', MODEL, '--yes', '--variant', 'system-stable', '--out', out],
    { spawn: f.spawn, log, env: noMock, userSignIn: () => true });
  assert.equal(code, 0);
  const rep = JSON.parse(readFileSync(out, 'utf8'));
  assert.equal(rep.variant, 'system-stable');
  assert.equal(rep.keptUserSettings, true);
  assert.equal('settingSources' in f.calls[0], false);
  assert.ok(f.calls[0].systemPrompt.includes('<description>'));
  assert.ok(!f.calls[0].prompt.includes('<description>'));
  const out2 = join(work, 'plain.json');
  await main(['--rounds', '1', '--model', MODEL, '--yes', '--out', out2], { spawn: fakeSpawn().spawn, log, env: noMock, userSignIn: () => false });
  const rep2 = JSON.parse(readFileSync(out2, 'utf8'));
  assert.equal(rep2.variant, null);
  assert.equal(rep2.keptUserSettings, false);
  assert.equal(await main(['--rounds', '1', '--model', MODEL, '--variant', 'nope'], { spawn: fakeSpawn().spawn, log, env: noMock, userSignIn: () => false }), 2);
});

// ── the tool's defaults follow the interview's model and effort (A1.1 Task 5) ──
test('no --model / --effort: the replay uses interviewModel()\'s pair', async () => {
  const { log } = logger();
  const f = fakeSpawn();
  await main(['--rounds', '1', '--yes'], { spawn: f.spawn, log, env: noMock, resolveModel: async () => ({ model: 'claude-sonnet-5', effort: 'high', source: 'settings' }), userSignIn: () => false });
  assert.equal(f.calls[0].model, 'claude-sonnet-5');
  assert.equal(f.calls[0].effort, 'high');
});

test('a resolved pair without effort sends none; --effort and --model override', async () => {
  const { log } = logger();
  const noEffort = fakeSpawn();
  await main(['--rounds', '1', '--yes'], { spawn: noEffort.spawn, log, env: noMock, resolveModel: async () => ({ model: 'claude-sonnet-5', effort: null, source: 'settings' }), userSignIn: () => false });
  assert.equal('effort' in noEffort.calls[0], false);
  const over = fakeSpawn();
  await main(['--rounds', '1', '--yes', '--model', 'm-x', '--effort', 'low'], { spawn: over.spawn, log, env: noMock,
    resolveModel: async () => { throw new Error('not asked'); }, userSignIn: () => false });
  assert.equal(over.calls[0].model, 'm-x');
  assert.equal(over.calls[0].effort, 'low');
});

test('--model alone sends the default effort (medium) and does not ask the resolver', async () => {
  const { log } = logger();
  const f = fakeSpawn();
  await main(['--rounds', '1', '--yes', '--model', 'm-y'], { spawn: f.spawn, log, env: noMock, resolveModel: async () => { throw new Error('not needed'); }, userSignIn: () => false });
  assert.equal(f.calls[0].model, 'm-y');
  assert.equal(f.calls[0].effort, 'medium');
});
