// test/pr-description.test.mjs
// The "Ship it?" modal's Generate with AI: a one-shot, tool-less Claude call over the
// run's persisted artifacts that drafts a PR description. Never cached, never
// submitted — the text only fills the modal's textarea. `runClaudeImpl` is injected.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  PR_DESCRIPTION_SYSTEM_PROMPT, DESCRIPTION_CAP, buildPrDescriptionPrompt, sanitizePrDescription,
  resolvePrDescriptionModel, generatePrDescription, prDescriptionSystemPrompt,
} from '../src/core/pr-description.mjs';
import { _resetForTests, getDb } from '../src/core/db.mjs';
import { seedPipeline } from './helpers/db-seed.mjs';
import { persistResults, persistDiffPatch } from '../src/core/results.mjs';
import { writeReview } from '../src/core/artifacts.mjs';
import { AUX_EFFORT } from '../src/core/model-env.mjs';
import { buildClaudeArgs } from '../src/core/claude-runner.mjs';

const MODELS = [{ id: 'claude-opus-5-5' }, { id: 'claude-sonnet-5-5' }, { id: 'claude-sonnet-5' }, { id: 'claude-sonnet-4-6' }, { id: 'claude-haiku-4-5' }];

async function withRun(state, fn) {
  const home = await mkdtemp(join(tmpdir(), 'worca-cc-prdesc-'));
  const prev = process.env.WORCA_HOME; process.env.WORCA_HOME = home;
  _resetForTests();
  try {
    const seeded = await seedPipeline(join(home, 'proj'), state);
    await mkdir(seeded.dir, { recursive: true });
    await fn(seeded);
  } finally {
    _resetForTests();
    if (prev === undefined) delete process.env.WORCA_HOME; else process.env.WORCA_HOME = prev;
    await rm(home, { recursive: true, force: true });
  }
}

test('the system prompt treats the run data as untrusted and asks for the three sections', () => {
  assert.match(PR_DESCRIPTION_SYSTEM_PROMPT, /untrusted data/i);
  assert.match(PR_DESCRIPTION_SYSTEM_PROMPT, /never instructions/i);
  assert.match(PR_DESCRIPTION_SYSTEM_PROMPT, /## Summary/);
  assert.match(PR_DESCRIPTION_SYSTEM_PROMPT, /## Changes/);
  assert.match(PR_DESCRIPTION_SYSTEM_PROMPT, /## Testing/);
});

test('prDescriptionSystemPrompt: GitHub keeps the prompt; Azure DevOps names its host and the 4,000-char cap', () => {
  assert.equal(prDescriptionSystemPrompt('github'), PR_DESCRIPTION_SYSTEM_PROMPT);
  assert.equal(prDescriptionSystemPrompt(), PR_DESCRIPTION_SYSTEM_PROMPT);
  const azure = prDescriptionSystemPrompt('azure');
  assert.match(azure, /an Azure DevOps pull request/);
  assert.match(azure, /4,000 characters/);
  assert.doesNotMatch(azure, /GitHub/);
  assert.match(azure, /untrusted data/i);
  assert.match(azure, /## Summary/);
});

test('buildPrDescriptionPrompt: a patch above the cap keeps hunk headers only; a long prompt is capped', () => {
  const big = ['diff --git a/a b/a', '--- a/a', '+++ b/a', '@@ -1 +1 @@', `+${'x'.repeat(70_000)}`].join('\n');
  const p = buildPrDescriptionPrompt({ title: 't', prompt: 'p'.repeat(20_000), patch: big, results: null, reviews: [] });
  assert.match(p, /diff --git a\/a b\/a/);
  assert.match(p, /@@ -1 \+1 @@/);
  assert.ok(!p.includes('x'.repeat(100)), 'the hunk bodies are dropped');
  assert.match(p, /TRUNCATED/);
  assert.ok(p.length < 20_000, `prompt capped: ${p.length}`);
  assert.match(buildPrDescriptionPrompt({ title: '', prompt: '', patch: '', results: null, reviews: [] }), /\(none\)/);
});

test('sanitizePrDescription strips a wrapping fence, keeps inner fences, trims and caps', () => {
  assert.equal(sanitizePrDescription(null), '');
  assert.equal(sanitizePrDescription('   '), '');
  assert.equal(sanitizePrDescription('```markdown\n## Summary\nDid x.\n```'), '## Summary\nDid x.');
  assert.equal(sanitizePrDescription('```\n## Summary\n```'), '## Summary');
  const inner = '## Summary\nDid x.\n\n```js\nf();\n```';
  assert.equal(sanitizePrDescription(`  ${inner}\n`), inner, 'a body that only ends in a fence keeps it');
  const long = sanitizePrDescription(`## Summary\n${'word '.repeat(DESCRIPTION_CAP)}`);
  assert.ok(long.length <= DESCRIPTION_CAP, `capped: ${long.length}`);
  assert.ok(long.startsWith('## Summary'));
});

test('resolvePrDescriptionModel: the stored catalog id, else Sonnet 5, else any Sonnet — never Haiku while a Sonnet exists', () => {
  assert.deepEqual(resolvePrDescriptionModel(MODELS, { setting: 'CLAUDE-OPUS-5-5' }), { model: 'claude-opus-5-5', source: 'settings', stale: null });
  assert.deepEqual(resolvePrDescriptionModel(MODELS, { setting: '' }), { model: 'claude-sonnet-5', source: 'default', stale: null });
  assert.deepEqual(resolvePrDescriptionModel(MODELS, { setting: 'gone-model' }), { model: 'claude-sonnet-5', source: 'default', stale: 'gone-model' });
  assert.equal(resolvePrDescriptionModel([{ id: 'claude-haiku-4-5' }, { id: 'claude-sonnet-4-6' }], { setting: '' }).model, 'claude-sonnet-4-6');
  assert.deepEqual(resolvePrDescriptionModel([], { setting: '' }), { model: '', source: 'default', stale: null });
});

test('generatePrDescription: one tool-less aux call over the run artifacts, no cache, cost recorded as a pr-description sub-agent', async () => {
  await withRun({ title: 'Retry fetch', prompt: 'Make fetch retry' }, async ({ id, dir, key }) => {
    await persistResults(dir, { summary: { filesNew: 1 } });
    await persistDiffPatch(dir, 'diff --git a/x b/x\n+retry()');
    await writeReview(id, 'impl', 1, { summary: '', issues: [{ severity: 'minor', title: 'naming', location: 'x:2' }] });
    const seen = [];
    const fake = async (o) => {
      seen.push(o);
      o.onEvent({ type: 'result', text: '', costUsd: 0.0123, isError: false });
      return { text: '```markdown\n## Summary\nRetries fetch.\n```' };
    };
    const first = await generatePrDescription(key, id, { model: 'claude-sonnet-5', baseBranch: 'main', runClaudeImpl: fake });
    assert.equal(first, '## Summary\nRetries fetch.');
    const second = await generatePrDescription(key, id, { model: 'claude-sonnet-5', runClaudeImpl: fake });
    assert.equal(second, first);
    assert.equal(seen.length, 2, 'never cached: every click runs the model');
    const o = seen[0];
    assert.deepEqual(o.allowedTools, []);
    assert.equal(o.mcpConfigPath, undefined);
    // The diff and prompt are untrusted: the call gets no built-in tool and no MCP server,
    // so an injected instruction has nothing to act with.
    assert.deepEqual(o.tools, []);
    assert.equal(o.strictMcpConfig, true);
    const argv = buildClaudeArgs({
      prompt: o.prompt, systemPrompt: o.systemPrompt, permissionMode: 'acceptEdits',
      allowedTools: o.allowedTools, tools: o.tools, strictMcpConfig: o.strictMcpConfig,
    });
    assert.equal(argv[argv.indexOf('--tools') + 1], '', `--tools "": ${JSON.stringify(argv)}`);
    assert.ok(argv.includes('--strict-mcp-config'));
    assert.ok(!argv.includes('--mcp-config'));
    assert.equal(o.model, 'claude-sonnet-5');
    assert.equal(o.effort, AUX_EFFORT);
    assert.equal(o.spawnKind, 'aux');
    assert.equal(o.cwd, dir);
    assert.equal(o.systemPrompt, PR_DESCRIPTION_SYSTEM_PROMPT);
    assert.match(o.prompt, /Retry fetch/);
    assert.match(o.prompt, /Make fetch retry/);
    assert.match(o.prompt, /\+retry\(\)/);
    assert.match(o.prompt, /\[minor\] naming/);
    assert.match(o.prompt, /"filesNew": 1/);
    const rows = getDb().prepare('SELECT subagent_type, label, status, cost_usd FROM sub_agents WHERE pipeline_id = ?').all(id);
    assert.equal(rows.length, 2, 'each generation is its own sub-agent row, so no spend is overwritten');
    for (const r of rows) {
      assert.equal(r.subagent_type, 'pr-description');
      assert.equal(r.status, 'finished');
      assert.equal(r.cost_usd, 0.0123);
    }
  });
});

test('generatePrDescription: without an explicit model it resolves the setting, warning on a stale id', async () => {
  await withRun({ title: 't' }, async ({ id, key }) => {
    const seen = [];
    const fake = async (o) => { seen.push(o); return { text: '## Summary\nok' }; };
    const warns = [];
    const orig = console.warn; console.warn = (m) => warns.push(String(m));
    try {
      await generatePrDescription(key, id, { setting: 'gone-model', runClaudeImpl: fake });
    } finally { console.warn = orig; }
    assert.equal(seen[0].model, 'claude-sonnet-5');
    assert.ok(warns.some((w) => /prDescriptionModel "gone-model" is no longer in the catalog/.test(w)), warns.join('\n'));
    await generatePrDescription(key, id, { setting: 'claude-opus-5', runClaudeImpl: fake });
    assert.equal(seen[1].model, 'claude-opus-5');
  });
});

test('generatePrDescription: an Azure DevOps target gets the Azure system prompt', async () => {
  await withRun({ title: 't' }, async ({ id, key }) => {
    const seen = [];
    const fake = async (o) => { seen.push(o); return { text: '## Summary\nok' }; };
    await generatePrDescription(key, id, { model: 'claude-sonnet-5', forge: 'azure', runClaudeImpl: fake });
    assert.equal(seen[0].systemPrompt, prDescriptionSystemPrompt('azure'));
    assert.notEqual(seen[0].systemPrompt, PR_DESCRIPTION_SYSTEM_PROMPT);
  });
});
