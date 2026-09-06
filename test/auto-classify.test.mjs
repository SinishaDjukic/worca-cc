import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  classifyTask, ClassifierError, buildClassifierSystemPrompt, buildClassifierUserPrompt, parseShapeReply, checkShapeModels,
  agentVocabulary, summarizeTools, renderAgentCards, shapeForPrompt, withCardsSignal, TASK_TEXT_CAP, EXTRA_TEXT_CAP,
} from '../src/core/auto/classify.mjs';
import { normalizeShape, SHAPE_LIMITS } from '../src/shared/graph/assemble.mjs';
import { loadAgentRegistry } from '../src/core/agent-registry.mjs';

const REG = loadAgentRegistry(undefined, { userAgentsDir: null, includePlugins: false });
const MODELS = [{ id: 'claude-opus-5', label: 'Opus 5', efforts: ['medium', 'high', 'max'] }, { id: 'claude-sonnet-5', label: 'Sonnet 5', efforts: ['medium', 'high'] }];
const reply = (shape) => `Here you go:\n\`\`\`json\n${JSON.stringify(shape)}\n\`\`\`\n`;
const GOOD = { name: 'Plan and build', taskKind: 'prompt', reasoning: 'r', stages: [{ agent: 'planner', model: 'Claude-Opus-5', effort: 'high' }, { agent: 'implementer' }, { agent: 'reviewer' }] };
/** A scripted runClaude: one reply per call, records prompts, reports a cost + usage. */
function fakeRun(replies, { costUsd = 0.01 } = {}) {
  const calls = [];
  const run = async (o) => {
    calls.push(o);
    if (o.signal?.aborted) { const e = new Error('aborted'); e.name = 'AbortError'; throw e; }
    const r = replies[calls.length - 1];
    if (r instanceof Error) throw r;
    if (typeof r === 'function') return r(o);
    o.onEvent?.({ type: 'result', costUsd, raw: { type: 'result', total_cost_usd: costUsd, usage: { input_tokens: 10, output_tokens: 5 } } });
    return { text: r, exitCode: 0 };
  };
  return { run, calls };
}
const base = (over = {}) => ({ taskText: 'Build the thing', models: MODELS, registry: REG, model: 'claude-sonnet-5', cwd: process.cwd(), ...over });

test('agentVocabulary: placeable project agents in registry order; sidecar + frontmatter both labelled; tools folded; body never read', () => {
  const v = agentVocabulary(REG);
  assert.deepEqual(v.map((a) => a.key), ['clarify', 'planner', 'refiner', 'decomposer', 'implementer', 'reviewer', 'manualTestsChecklist', 'manualWebUiTesting', 'planReviewer']);
  assert.ok(!v.some((a) => a.key === 'workspaceScanner' || a.key === 'workspaceReviewer'), 'placeable:false and workspace-only are out');
  const web = v.find((a) => a.key === 'manualWebUiTesting');
  assert.equal(web.verifier, true);
  assert.match(web.purpose, /^Runs the manual checklist in the live web UI/);
  assert.match(web.role, /Drives the RUNNING web UI/, 'the .md frontmatter description is the labelled role');
  assert.match(web.hints, /^Execute the manual test checklist against the running web UI/);
  assert.equal(web.tools, 'Read, Bash, Grep, Glob, Skill; plugin_playwright_playwright MCP (14 tools: browser_navigate, browser_snapshot, browser_click, …)');
  assert.equal(web.model, '', 'model: inherit is not repeated');
  assert.equal(web.origin, 'builtin');
  assert.equal(web.domain, 'coding');
  assert.equal(web.runnerType, 'verifier');
  assert.match(web.inputs, /checklist:md/);
  assert.match(web.outputs, /review:md\/blocking/);
  const plan = v.find((a) => a.key === 'planner');
  assert.match(plan.role, /never asks the user questions/);
  assert.equal(plan.asksQuestions, true, 'the engine flag is kept next to the prose');
  assert.match(plan.inputs, /revise:md \(loop\)\?/);
  const cl = v.find((a) => a.key === 'clarify');
  assert.equal(cl.clarifier, true);
  assert.equal(cl.questionsLocked, true);
  assert.equal(cl.hints, '', 'no promptHints ⇒ empty, never undefined');
  assert.ok(!JSON.stringify(v).includes('You are the **'), 'no agent body text reaches the vocabulary');
});

test('agentVocabulary: derived/identical blurbs do not repeat, a missing .md leaves tools empty, text is cleaned, the domain filter keeps shared/general', () => {
  const base2 = { runnerType: 'producer', order: 1, inputs: [{ id: 'task', type: 'md' }], outputs: [{ id: 'out', type: 'md' }], origin: 'plugin:acme', domain: 'marketing' };
  const reg = {
    derived: { ...base2, key: 'derived', displayName: 'D', description: 'same text', descriptionDerived: true, frontmatter: { name: 'd', description: 'same text', tools: ['Read'], model: 'claude-x' } },
    nomd: { ...base2, key: 'nomd', displayName: 'N\x1b[31m!', description: 'blurb\nwith​controls', frontmatter: null, requiresSkills: ['seo'] },
    shared: { ...base2, key: 'shared', displayName: 'S', description: 'blurb', domain: 'shared', frontmatter: null },
    coding: { ...base2, key: 'coding', displayName: 'C', description: 'blurb', domain: 'coding', frontmatter: null },
  };
  const all = agentVocabulary(reg);
  assert.equal(all.find((a) => a.key === 'derived').role, '', 'a derived blurb is not shown twice');
  assert.equal(all.find((a) => a.key === 'derived').model, 'claude-x', 'a non-inherit model is shown');
  assert.equal(all.find((a) => a.key === 'nomd').tools, '');
  assert.equal(all.find((a) => a.key === 'nomd').displayName, 'N!', 'card text is cleaned');
  assert.equal(all.find((a) => a.key === 'nomd').purpose, 'blurb withcontrols');
  assert.deepEqual(all.find((a) => a.key === 'nomd').requiresSkills, ['seo']);
  // All four fixture entries carry order:1, so agentVocabulary's code-unit tiebreak on the key orders them.
  assert.deepEqual(agentVocabulary(reg, { domain: 'coding' }).map((a) => a.key), ['coding', 'shared'], 'an explicit other domain (marketing) is not offered to a coding run');
  assert.equal(summarizeTools(['Read', 'mcp__srv__a', 'mcp__srv__b']), 'Read; srv MCP (2 tools: a, b)');
  assert.equal(summarizeTools([]), '');
});

test('the prompts carry the cards, the recipes, the models, the HITL rule, the fingerprint, extras, feedback and the capped task', () => {
  const sys = buildClassifierSystemPrompt({ agents: agentVocabulary(REG), models: [...MODELS, { id: 'claude-hidden-9', efforts: ['medium'], hidden: true }], humanInLoop: false });
  for (const s of ['```json', 'manualWebUiTesting', 'Recipes', 'claude-opus-5', 'medium/high/max', 'NO human is in the loop',
    '"size": "small" | "medium" | "large"', '"signals"',
    'purpose: ', 'role (agent file): ', 'hints: ', 'tools: ', 'Drives the RUNNING web UI', 'plugin_playwright_playwright MCP (14 tools',
    'flags are the engine', 'builtin · coding']) assert.ok(sys.includes(s), s);
  assert.ok(!sys.includes('claude-hidden-9'), 'a hidden catalog model is never offered');
  assert.ok(!sys.includes('A human is in the loop'), 'the HITL sentences are mutually exclusive');
  assert.ok(!sys.includes('You are the **'), 'agent bodies never reach the classifier');
  assert.ok(!/worca-cc-[a-z-]+\.md/.test(sys), 'no file names or paths in the prompt');
  const sysOn = buildClassifierSystemPrompt({ agents: agentVocabulary(REG), models: MODELS, humanInLoop: true });
  assert.ok(sysOn.includes('A human is in the loop') && !sysOn.includes('NO human is in the loop'));
  // Budget degradation is deterministic: hints go first, then roles; cards never truncate mid-line.
  const cards = agentVocabulary(REG);
  const full = renderAgentCards(cards);
  const noHints = renderAgentCards(cards, { maxChars: full.length - 1 });
  assert.ok(!noHints.includes('\n  hints: ') && noHints.includes('role (agent file): '));
  const bare = renderAgentCards(cards, { maxChars: 1 });
  assert.ok(!bare.includes('role (agent file): ') && bare.includes('purpose: '));
  const user = buildClassifierUserPrompt({ taskText: 'x'.repeat(TASK_TEXT_CAP + 500), extras: [{ name: 'brief.md', text: 'BRIEF' }, { name: 'logo.png' }], fingerprint: 'top-level: src/', feedback: ['drop the refiner'], priorShape: normalizeShape(GOOD) });
  assert.ok(user.includes('## Repository fingerprint\ntop-level: src/'));
  assert.ok(user.includes('- brief.md\n`````\nBRIEF\n`````') && user.includes('- logo.png'), 'attachments ride a 5-backtick fence');
  assert.ok(user.includes('## User feedback (newest last)') && user.includes('1. drop the refiner'));
  assert.ok(user.includes('## Previous shape') && user.includes('"name": "Plan and build"'));
  assert.ok(user.includes('"model": "Claude-Opus-5"') && !user.includes('"tunables"'), 'the previous shape is shown in the schema the prompt teaches (tunables spread onto the stage)');
  assert.ok(user.includes('[… truncated: 500 more characters]'));
  assert.ok(user.indexOf('## Task') > user.indexOf('## User feedback'), 'the task comes last');
  const capped = buildClassifierUserPrompt({ taskText: 't', extras: [{ name: 'big.md', text: `${'z'.repeat(EXTRA_TEXT_CAP + 100)}\n\`\`\`\nnot a fence` }] });
  assert.ok(capped.includes(`\n\`\`\`\`\`\n${'z'.repeat(EXTRA_TEXT_CAP)}`), 'an attached file is capped at EXTRA_TEXT_CAP');
  assert.ok(!capped.includes('z'.repeat(EXTRA_TEXT_CAP + 1)));
  const fenced = buildClassifierUserPrompt({ taskText: 't', extras: [{ name: 'evil.md', text: 'a\n```\nb\n````\nc' }] });
  assert.ok(!/\n```\n|\n````\n/.test(fenced), 'runs of three or more backticks inside an attachment are neutralised so they cannot close the block');
});

test('parseShapeReply reads a fenced or bare JSON object and rejects the rest', () => {
  assert.deepEqual(parseShapeReply(reply({ a: 1 })), { a: 1 });
  assert.deepEqual(parseShapeReply('{"a":1}'), { a: 1 });
  assert.equal(parseShapeReply('no json here'), null);
  assert.equal(parseShapeReply('[1,2]'), null);
});

test('checkShapeModels canonicalises ids and flags unknown models / bad efforts', () => {
  const shape = normalizeShape({ stages: [{ agent: 'planner', model: 'CLAUDE-OPUS-5', effort: 'max' }, { agent: 'implementer', model: 'gpt-9' }, { agent: 'reviewer', model: 'claude-sonnet-5', effort: 'max' }, { agent: 'decomposer', effort: 'high' }] });
  const issues = checkShapeModels(shape, MODELS);
  assert.equal(shape.stages[0].tunables.model, 'claude-opus-5');
  assert.deepEqual(issues.map((i) => i.code), ['UNKNOWN_MODEL', 'BAD_EFFORT', 'EFFORT_WITHOUT_MODEL']);
});

test('a good reply classifies on the first attempt; cost, usage, the raw reply and the normalized shape come back', async () => {
  const { run, calls } = fakeRun([reply(GOOD)]);
  const r = await classifyTask(base({ fingerprint: 'top-level: src/', domain: 'coding' }), { run });
  assert.equal(r.attempts, 1);
  assert.equal(r.costUsd, 0.01);
  assert.deepEqual(r.usage, { input_tokens: 10, output_tokens: 5 });
  assert.equal(r.raw, reply(GOOD));
  assert.equal(r.shape.stages[0].tunables.model, 'claude-opus-5');
  assert.deepEqual(r.shape.stages.map((s) => s.id), ['s1', 's2', 's3']);
  assert.equal(r.shape.size, 'medium', 'a reply without size normalizes to the default');
  assert.deepEqual(r.warnings, []);
  const o = calls[0];
  assert.deepEqual(o.allowedTools, []);
  assert.deepEqual(o.tools, [], 'no built-in tools: pure reasoning');
  assert.equal(o.effort, 'medium');
  assert.equal(o.model, 'claude-sonnet-5');
  assert.ok(o.systemPrompt.includes('Recipes') && o.systemPrompt.includes('purpose: ') && o.prompt.includes('Build the thing'));
});

test('a bad first reply is retried ONCE with the issues as feedback; a second bad reply fails; usage sums both attempts', async () => {
  const { run, calls } = fakeRun(['no json', reply(GOOD)]);
  const r = await classifyTask(base(), { run });
  assert.equal(r.attempts, 2);
  assert.equal(r.costUsd, 0.02, 'both attempts are billed');
  assert.deepEqual(r.usage, { input_tokens: 20, output_tokens: 10 });
  assert.deepEqual(r.warnings.map((w) => w.code), ['CLASSIFIER_RETRY']);
  assert.ok(calls[1].prompt.includes('Your previous reply was rejected: the reply carried no JSON shape'));

  const twice = fakeRun([reply({ stages: [{ agent: 'nope' }] }), reply({ stages: [] })]);
  await assert.rejects(() => classifyTask(base(), { run: twice.run }),
    (e) => e instanceof ClassifierError && e.code === 'CLASSIFIER_FAILED' && /unusable shape after 2 attempts/.test(e.message)
      && e.costUsd === 0.02 && e.usage.input_tokens === 20, 'a failed classification still reports what its attempts cost');
  assert.ok(twice.calls[1].prompt.includes('unknown agent "nope"'), 'the retry names the unknown agent');
});

test('a spawn failure is CLASSIFIER_FAILED, a timeout is CLASSIFIER_TIMEOUT, an outer abort rethrows the AbortError', async () => {
  const boom = fakeRun([new Error('spawn ENOENT')]);
  await assert.rejects(() => classifyTask(base(), { run: boom.run }), (e) => e.code === 'CLASSIFIER_FAILED' && /ENOENT/.test(e.detail));
  const slow = fakeRun([(o) => new Promise((_r, rej) => o.signal.addEventListener('abort', () => { const e = new Error('aborted'); e.name = 'AbortError'; rej(e); }))]);
  await assert.rejects(() => classifyTask(base({ timeoutMs: 20 }), { run: slow.run }), (e) => e.code === 'CLASSIFIER_TIMEOUT');
  const ctrl = new AbortController();
  const hang = fakeRun([(o) => new Promise((_r, rej) => o.signal.addEventListener('abort', () => { const e = new Error('aborted'); e.name = 'AbortError'; rej(e); }))]);
  const p = classifyTask(base({ signal: ctrl.signal }), { run: hang.run });
  ctrl.abort();
  await assert.rejects(p, (e) => e.name === 'AbortError');
});

test('mock mode answers without spawning (opts.mock or WORCA_MOCK=1)', async () => {
  const { run, calls } = fakeRun([]);
  const r = await classifyTask(base({ mock: true, taskText: 'demo task' }), { run });
  assert.equal(calls.length, 0);
  assert.equal(r.attempts, 0);
  assert.deepEqual(r.usage, { input_tokens: 0, output_tokens: 0 });
  assert.deepEqual(r.shape.stages.map((s) => s.agent), ['planner', 'implementer', 'reviewer']);
  process.env.WORCA_MOCK = '1';
  try {
    const viaEnv = await classifyTask(base({ taskText: 'demo task' }), { run });
    assert.equal(calls.length, 0, 'WORCA_MOCK=1 alone puts the classifier in mock mode');
    assert.equal(viaEnv.attempts, 0);
  } finally { delete process.env.WORCA_MOCK; }
  const off = await classifyTask(base({ mock: true, humanInLoop: false, taskText: 'Please add a background job that re-indexes the search catalogue every night and reports failures to the ops channel.' }), { run });
  assert.ok(!off.shape.stages.some((s) => s.agent === 'clarify'));
});

test('classifyTask appends the agent-card count to signals in the mock arm and keeps size', async () => {
  const r = await classifyTask({ taskText: 'demo task', registry: REG, mock: true, models: MODELS });
  assert.equal(r.shape.size, 'small');
  assert.deepEqual(r.shape.signals, ['trivial', `${agentVocabulary(REG).length} agent cards read`]);
});

test('the agent-card signal survives the cap: it takes the LAST slot, never the first', () => {
  const eight = Array.from({ length: 8 }, (_, i) => `s${i}`);
  const capped = withCardsSignal({ stages: [{ agent: 'planner' }], signals: eight }, 9);
  assert.equal(capped.signals.length, SHAPE_LIMITS.maxSignals);
  assert.equal(capped.signals.at(-1), '9 agent cards read');
  assert.deepEqual(capped.signals.slice(0, 7), eight.slice(0, 7));
  assert.deepEqual(withCardsSignal(capped, 9).signals, capped.signals, 'idempotent: a second stamp replaces, never appends');
});
