// test/design-agent-tools.test.mjs — what a Design agent may use (docs/design.md "What the agents can use"): the
// tools a workflow agent has (files, the shell, the web), the picked project to read, and the capture kit to start the
// product and shoot its real screens. No picture ever comes from the web: there is no download tool, and the prompts
// say so.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { useTempHome } from './helpers/temp-home.mjs';
import { designEngineGate } from '../src/core/design/engines.mjs';
import { CAPTURE_KIT, designWorkDir, sectionDir } from '../src/core/design/paths.mjs';
import { builderChangePrompt, builderPrompt, builderSystemPrompt, leadChangePrompt, leadPlanPrompt, leadSystemPrompt } from '../src/core/design/prompts.mjs';
import { DESIGN_MAX_TURNS, DESIGN_TOOLS, designSpawnOptions } from '../src/core/design/spawn-options.mjs';
import { chatPrefs, setChatPrefs } from '../src/core/settings.mjs';

useTempHome(after);
const D = 'd_0123456789ab';
const base = { engine: 'claude', agentId: 'a_11111111', buildId: 'b_111111111111', designId: D, prompt: 'P', model: 'claude-sonnet-5-5', effort: 'medium', denyRules: ['Read(//**/.env*)'] };
const lead = (extra = {}) => designSpawnOptions({ ...base, role: 'lead', stage: 'plan', ...extra });
const builder = (extra = {}) => designSpawnOptions({ ...base, role: 'builder', stage: 'first', sectionId: 'hero', ...extra });
const KINDS = ['web', 'presentation', 'pitch', 'video'];

test('every agent gets the files, the shell and the web, and no MCP server', () => {
  assert.deepEqual(DESIGN_TOOLS, ['Read', 'Write', 'Edit', 'Bash', 'Glob', 'Grep', 'WebSearch', 'WebFetch']);
  for (const o of [lead(), lead({ stage: 'integrate' }), lead({ stage: 'change' }), builder(), builder({ stage: 'change' })]) {
    assert.deepEqual(o.tools, [...DESIGN_TOOLS]);
    assert.deepEqual(o.allowedTools, o.tools);
    assert.equal(o.mcpConfigPath, undefined);
    assert.equal(o.mcpServerGrants, undefined);
    assert.equal(o.strictMcpConfig, true, 'no server of the person\'s own leaks in');
    assert.deepEqual(o.permissionRules, { deny: ['Read(//**/.env*)'] }, 'only the build\'s own rules deny anything');
  }
});

test('off the hook row nothing of the shell or the web is denied either', () => {
  for (const engine of ['gemini', 'codex', 'cursor', 'copilot', 'qwen', 'opencode']) {
    for (const o of [lead({ engine }), builder({ engine })]) {
      assert.deepEqual(o.permissionRules.deny, ['Read(//**/.env*)'], engine);
      assert.deepEqual(o.allowedTools, [...DESIGN_TOOLS], engine);
    }
  }
});

test('the lead and every builder may read the picked project', () => {
  assert.deepEqual(lead({ projectDir: '/proj' }).addDirs, [designWorkDir(D), '/proj']);
  assert.deepEqual(builder({ projectDir: '/proj' }).addDirs, [designWorkDir(D), '/proj']);
  assert.deepEqual(builder().addDirs, [designWorkDir(D)]);
  assert.equal(builder({ projectDir: '/proj' }).cwd, sectionDir(D, 'hero'));
});

test('starting the product and shooting it takes turns: the lead\'s plan stage has them', () => {
  assert.deepEqual(DESIGN_MAX_TURNS, { 'lead:plan': 80, 'builder:first': 25, 'lead:integrate': 40, 'lead:change': 20, 'builder:change': 15 });
});

test('the lead prompt: real pictures from the project, the product started when none fits, nothing from the web', () => {
  for (const kind of KINDS) {
    const p = leadSystemPrompt({ kind });
    assert.match(p, /its logo/, kind);
    assert.match(p, /`cp`/, kind);
    assert.match(p, /assets\/project\/<name>/, kind);
    assert.match(p, /Capture kit/, kind);
    assert.match(p, /start the product/, kind);
    assert.match(p, /assets\/shots\/<name>/, kind);
    assert.match(p, /Never a person's real data/, kind);
    assert.match(p, /Never take a picture from the web/, kind);
    assert.match(p, /never name a picture file that is not on disk/i, kind);
    assert.match(p, /Builders do not start the product/, kind);
    assert.doesNotMatch(p, /save_image|use_project_image/, kind);
    assert.equal(leadSystemPrompt({ kind }), p, 'one prompt per kind, whatever the build');
  }
});

test('the builder prompt: the same tools, held to its own job', () => {
  for (const kind of KINDS) {
    const p = builderSystemPrompt({ kind });
    assert.match(p, /only to a file your task names/, kind);
    assert.match(p, /Never take a picture from the web/, kind);
    assert.match(p, /never start the product/i, kind);
    assert.match(p, /never change a file of the project/i, kind);
    assert.doesNotMatch(p, /save_image|use_project_image/, kind);
  }
});

test('the design\'s own files are written with Write and Edit, never with the shell', () => {
  for (const kind of KINDS) {
    for (const p of [leadSystemPrompt({ kind }), builderSystemPrompt({ kind })]) assert.match(p, /with Write and Edit, never with the shell/, kind);
  }
});

test('the task names the project to every agent, and the capture kit to the lead', () => {
  const plan = leadPlanPrompt({ brief: 'B', kind: 'web', fast: false, projectDir: '/proj', captureKit: '/kit/lib.mjs', questionFile: '/q', planFile: '/p' }).split('\n');
  assert.ok(plan.includes('Project: /proj (read it for the brand, its logo and its screens; you may start it, never change its files)'));
  assert.ok(plan.includes('Capture kit: /kit/lib.mjs'));
  const bare = leadPlanPrompt({ brief: 'B', kind: 'web', fast: false, captureKit: '/kit/lib.mjs', questionFile: '/q', planFile: '/p' });
  assert.doesNotMatch(bare, /^Project:/m);
  assert.doesNotMatch(bare, /^Capture kit:/m, 'no project, nothing to start');
  const blind = leadPlanPrompt({ brief: 'B', kind: 'web', fast: false, projectDir: '/proj', captureKit: '/kit/lib.mjs', questionFile: '/q', planFile: '/p', row: { readsOutsideCwd: false } });
  assert.doesNotMatch(blind, /^Project:|^Capture kit:/m, 'an engine that cannot read the project is not told of it');
  const change = leadChangePrompt({ instruction: 'X', kind: 'web', sections: [], projectDir: '/proj', captureKit: '/kit/lib.mjs', questionFile: '/q', roundFile: '/r' }).split('\n');
  assert.ok(change.includes('Capture kit: /kit/lib.mjs') && change.some((l) => l.startsWith('Project: /proj ')), 'a change round can bring a new screen in');
  const section = { id: 'hero', job: 'Hero', brief: 'b', parts: ['html'] };
  const first = builderPrompt({ section, notes: '', sectionDir: '/s', tokensCss: '/t', globalCss: '/g', crewJson: '/c', questionFile: '/q', projectDir: '/proj' }).split('\n');
  assert.ok(first.includes('Project: /proj (read only)'));
  assert.ok(!first.some((l) => l.startsWith('Capture kit:')));
  assert.ok(builderChangePrompt({ section, instruction: 'X', notes: '', sectionDir: '/s', questionFile: '/q', projectDir: '/proj' }).split('\n').includes('Project: /proj (read only)'));
  assert.doesNotMatch(builderPrompt({ section, notes: '', sectionDir: '/s', tokensCss: '/t', globalCss: '/g', crewJson: '/c', questionFile: '/q' }), /^Project:/m);
});

test('the capture kit is the one worca ships: it starts an app and opens a page', async () => {
  assert.ok(existsSync(CAPTURE_KIT), CAPTURE_KIT);
  assert.equal(CAPTURE_KIT, fileURLToPath(new URL('../assets/promo-kit/capture/lib.mjs', import.meta.url)));
  const kit = await import(new URL('../assets/promo-kit/capture/lib.mjs', import.meta.url));
  assert.deepEqual([typeof kit.startApp, typeof kit.open], ['function', 'function']);
});

test('no web switch and no picture download are left', async () => {
  assert.equal('designWeb' in chatPrefs(), false);
  assert.equal('designWeb' in await setChatPrefs({ designWeb: true }), false, 'a stored or sent switch is ignored');
  const files = readdirSync(new URL('../src/core/design/', import.meta.url));
  for (const gone of ['web-access.mjs', 'web-mcp.mjs', 'web-image.mjs', 'project-image.mjs']) assert.equal(files.includes(gone), false, gone);
});

test('the engine gate no longer names the shell or the tools: only what worca cannot hold', () => {
  const adapterOf = () => ({ capabilities: { allowedTools: false }, unenforcedRules: () => [], partialRules: () => [] });
  const r = designEngineGate({ engine: 'gemini', adapterOf, broker: () => null });
  assert.deepEqual([r.ok, r.overridable], [false, true]);
  assert.match(r.reasons[0], /^Gemini CLI cannot be held to worca's guardrails/);
  assert.doesNotMatch(r.reasons.join(' '), /shell|web tools|tools Design allows/);
  const codex = designEngineGate({ engine: 'codex', adapterOf, broker: () => null });
  assert.match(codex.reasons[0], /^OpenAI Codex runs in its own sandbox/);
});
