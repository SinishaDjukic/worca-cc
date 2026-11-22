// test/ask-verbosity.test.mjs — the Chat reply style (#1230): one fixed block per non-normal level, appended LAST to
// the Ask system prompt for every engine; `normal` leaves the prompt byte-identical; every block carries the carve-out
// (tool arguments, briefs, warnings and confirmations stay in full), and no level reaches the tools or the brief path.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { useTempHome } from './helpers/temp-home.mjs';
import { VERBOSITY_LEVELS, DEFAULT_VERBOSITY, VERBOSITY_LABELS, VERBOSITY_HINT, isVerbosity } from '../src/shared/chat-verbosity.mjs';
import { VERBOSITY_BLOCKS, VERBOSITY_CARVE_OUT, verbosityBlock } from '../src/core/ask/verbosity.mjs';
import { buildSystemPrompt, ASK_CODEX_REWRITES } from '../src/core/ask/prompt.mjs';
import { CHAT_ENGINES } from '../src/core/engines/chat.mjs';
import { createAskTools } from '../src/core/ask/tools.mjs';
import { createProposalValidator } from '../src/core/ask/proposal.mjs';
import { ASK_LIMITS } from '../src/core/ask/limits.mjs';
import { setChatPrefs } from '../src/core/settings.mjs';

// The carve-out tests store the user setting as each level in turn: settings.json lives under HOME.
useTempHome(after);
const prevHome = { HOME: process.env.HOME, USERPROFILE: process.env.USERPROFILE };
const osHome = mkdtempSync(join(tmpdir(), 'worca-ask-verbosity-'));
process.env.HOME = osHome; process.env.USERPROFILE = osHome;
after(() => {
  for (const [k, v] of Object.entries(prevHome)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  rmSync(osHome, { recursive: true, force: true });
});

const CATALOG = { projects: [{ key: 'demo-00000001', name: 'Demo', path: '/p/demo' }], workspaces: [], workflows: [] };

const CARVE = 'This style applies to your own prose only. It never changes: tool arguments; the brief you pass to propose_run or any other proposal text the user confirms; code, commands, ids, paths and links; chips and #history links; and the warnings and confirmations these rules require. Write those in full, exactly as you would at the normal style.';
const BODIES = {
  detailed: 'The user chose the detailed reply style; it replaces the general length guidance above. Give full explanations: the context behind the answer, your reasoning, the alternatives you considered with their trade-offs, and the next steps. Use headings and lists where they help.',
  concise: 'The user chose the concise reply style; it replaces the general length guidance above. Lead with the answer, then at most a few short sentences. Skip background, alternatives and recaps unless asked.',
  terse: 'The user chose the terse reply style; it replaces the general length guidance above. Answer in fragments and short bullets. No greeting, no recap, no restating the question, no closing offer.',
  caveman: 'The user chose the caveman reply style; it replaces the general length guidance above. Use minimal words: drop articles, filler, pleasantries and hedging. Fragments are fine, for example: "Run failed. Test timeout. Fix: raise limit."',
};

test('shared constants: five levels most→least verbose, normal default, labels, strict membership', () => {
  assert.deepEqual([...VERBOSITY_LEVELS], ['detailed', 'normal', 'concise', 'terse', 'caveman']);
  assert.equal(DEFAULT_VERBOSITY, 'normal');
  assert.deepEqual(Object.keys(VERBOSITY_LABELS), [...VERBOSITY_LEVELS]);
  assert.equal(VERBOSITY_HINT, 'must be one of detailed | normal | concise | terse | caveman');
  for (const v of VERBOSITY_LEVELS) assert.equal(isVerbosity(v), true);
  for (const v of ['Terse', 'loud', '', null, undefined, 3, ['terse']]) assert.equal(isVerbosity(v), false, String(v));
});

test('blocks: exact text per non-normal level, each ending with the carve-out; normal/null/unknown give nothing', () => {
  assert.equal(VERBOSITY_CARVE_OUT, CARVE);
  assert.deepEqual(Object.keys(VERBOSITY_BLOCKS).sort(), ['caveman', 'concise', 'detailed', 'terse']);
  for (const [level, body] of Object.entries(BODIES)) {
    assert.equal(VERBOSITY_BLOCKS[level], `## Reply style\n${body}\n\n${CARVE}`, level);
    assert.equal(verbosityBlock(level), VERBOSITY_BLOCKS[level]);
    assert.ok(verbosityBlock(level).endsWith(VERBOSITY_CARVE_OUT), `${level} states the carve-out`);
  }
  for (const v of ['normal', null, undefined, '', 'loud', 'TERSE', 'constructor', '__proto__']) assert.equal(verbosityBlock(v), '', String(v));
});

test('no block contains "sub-agent" or any Codex rewrite anchor', () => {
  for (const [level, block] of Object.entries(VERBOSITY_BLOCKS)) {
    assert.ok(!/sub-agent/i.test(block), `${level} says no sub-agent`);
    for (const [from] of ASK_CODEX_REWRITES) assert.ok(!block.includes(from), `${level} holds no rewrite anchor`);
  }
});

test('every engine, commands on and off: normal is byte-identical; a level appends its block last after the unchanged prompt', () => {
  for (const engine of CHAT_ENGINES) {
    for (const commands of [false, true]) {
      const plain = buildSystemPrompt(CATALOG, { engine, commands });
      assert.equal(buildSystemPrompt(CATALOG, { engine, commands, verbosity: 'normal' }), plain, `${engine} normal`);
      assert.equal(buildSystemPrompt(CATALOG, { engine, commands, verbosity: null }), plain, `${engine} null`);
      assert.equal(buildSystemPrompt(CATALOG, { engine, commands, verbosity: 'loud' }), plain, `${engine} unknown`);
      for (const level of Object.keys(BODIES)) {
        const p = buildSystemPrompt(CATALOG, { engine, commands, verbosity: level });
        assert.equal(p, `${plain}\n\n${VERBOSITY_BLOCKS[level]}`, `${engine} ${level}: the rules (warnings, confirmations) are unchanged, block last`);
        assert.equal(p.split('## Reply style').length, 2, 'exactly one block');
      }
    }
  }
});

// ── AC5: the carve-out, proven on the paths a level could reach ───────────────────────────────────────────────────
const toolDeps = () => ({ limits: ASK_LIMITS, redact: (x) => x, scripts: { enabled: true },
  models: {}, clones: {}, projectChanges: {}, workspaceChanges: {}, actions: {}, chatActions: {}, composer: {}, scopeSwitch: {}, listPresets: () => [], showFiles: {}, proxy: {}, mcpServers: {} });
const WF = { id: 'wf_review', name: 'Review only', version: 2, nodes: [{ id: 'n_task', kind: 'task', config: {} }, { id: 'n_end', kind: 'end', config: {} }], wires: [] };
const proposalDeps = () => ({
  listProjects: async () => [{ key: 'demo-00000001', name: 'Demo', path: '/p/demo', exists: true }],
  readWorkspace: async () => null,
  assertRunnableWorkflow: async (id) => { if (id === 'wf_review') return WF; throw Object.assign(new Error(`unknown workflowId "${id}"`), { code: 'NOT_FOUND' }); },
  readGuardrailSet: async (id) => ({ id }),
  isGitRepo: () => true, pathExists: () => true,
  listModels: async () => [], resolveEngine: () => 'claude', claudeAuth: async () => 'signed-in', routed: () => false, policyFields: () => ({}), costOf: () => null,
});
const PROPOSAL = { projectKey: 'demo-00000001', workflowId: 'wf_review', brief: 'Fix the login bug.\n\nStart from src/auth/login.mjs (handleLogin, "if (!user) return"). The root cause is a missing await; keep the API shape.' };

async function underEachLevel(fn) {
  await setChatPrefs({ verbosity: null });
  const normal = await fn();
  try {
    for (const level of ['detailed', 'concise', 'terse', 'caveman', 'normal']) {
      await setChatPrefs({ verbosity: level });
      assert.deepEqual(await fn(), normal, `identical under ${level}`);
    }
  } finally { await setChatPrefs({ verbosity: null }); }
  return normal;
}

test('tool definitions are identical at every level (propose_run\'s input schema included)', async () => {
  const list = await underEachLevel(() => createAskTools(toolDeps()).list());
  const proposeRun = list.find((t) => t.name === 'propose_run');
  assert.ok(proposeRun && proposeRun.inputSchema && proposeRun.inputSchema.properties.brief, 'propose_run is served with its brief field');
  await underEachLevel(() => createAskTools(toolDeps()).list().find((t) => t.name === 'propose_run').inputSchema);
});

test('the propose_run brief path is identical at every level', async () => {
  const card = await underEachLevel(async () => {
    const r = await createProposalValidator(proposalDeps()).validateProposal(PROPOSAL);
    assert.equal(r.ok, true, JSON.stringify(r));
    return r.card;
  });
  assert.equal(card.brief, PROPOSAL.brief, 'the brief is carried in full');
});
