// test/overview-agent.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildOverviewPrompt, normalizeOverview, generateOverview } from '../src/core/overview-agent.mjs';
import { _resetForTests } from '../src/core/db.mjs';
import { seedPipeline } from './helpers/db-seed.mjs';
import { persistResults, persistDiffPatch } from '../src/core/results.mjs';
import { buildClaudeArgs } from '../src/core/claude-runner.mjs';

test('buildOverviewPrompt embeds patch + already-flagged issues', () => {
  const p = buildOverviewPrompt({
    patch: 'diff --git a/x b/x\n+foo',
    results: { summary: { filesNew: 1, filesChanged: 0 } },
    reviews: [{ kind: 'impl', cycle: 1, issues: [{ severity: 'major', title: 'known bug', detail: '', location: 'x:1' }], summary: '' }],
  });
  assert.match(p, /diff --git/);
  assert.match(p, /known bug/);          // so the agent only reports NEW findings
  assert.match(p, /"narrative"/);         // output contract present in prompt
  assert.match(p, /diffFindings/);
});

test('normalizeOverview coerces bad input to a safe shape', () => {
  assert.deepEqual(normalizeOverview(null), { narrative: '', diffFindings: [], diffCheckTruncated: false });
  const n = normalizeOverview({
    narrative: '  did things  ',
    diffFindings: [
      { severity: 'warn', file: 'a.ts', line: 3, title: 't', detail: 'd', newVsReview: true },
      { bogus: 1 },
      { severity: 'nonsense', file: 'b.ts', title: 'x' },
    ],
  });
  assert.equal(n.narrative, 'did things');
  assert.equal(n.diffFindings.length, 2);            // bogus dropped (no title)
  assert.equal(n.diffFindings[0].severity, 'warn');
  assert.equal(n.diffFindings[1].severity, 'note');  // unknown severity -> note
});

test('generateOverview runs agent once, caches result', async () => {
  const home = await mkdtemp(join(tmpdir(), 'worca-cc-ov-'));
  const prev = process.env.WORCA_HOME; process.env.WORCA_HOME = home;
  _resetForTests();
  const { id, dir, key } = await seedPipeline(join(home, 'proj'));
  await mkdir(dir, { recursive: true });
  await persistResults(dir, { summary: { filesNew: 1 } });
  await persistDiffPatch(dir, 'diff --git a/x b/x\n+hi');

  let calls = 0;
  const fake = async () => { calls++; return { text: '{"narrative":"did x","diffFindings":[],"diffCheckTruncated":false}' }; };

  const first = await generateOverview(key, id, { runClaudeImpl: fake });
  assert.equal(first.narrative, 'did x');
  assert.equal(calls, 1);
  const second = await generateOverview(key, id, { runClaudeImpl: fake });
  assert.equal(calls, 1); // cached, agent not re-run
  assert.equal(second.narrative, 'did x');

  _resetForTests();
  if (prev === undefined) delete process.env.WORCA_HOME; else process.env.WORCA_HOME = prev;
  await rm(home, { recursive: true, force: true });
});

// §2.1 row 2: the overview agent is DELIBERATELY excluded from the detached run's
// context — it reasons over an already-persisted patch inside the pipeline artifact
// dir, needs no tools and no MCP server. This guard exists so that exclusion cannot
// decay into an accidental one when Phase 3's fields are threaded everywhere else.
test('generateOverview stays excluded from run context: no tools, no --mcp-config in argv', async () => {
  const home = await mkdtemp(join(tmpdir(), 'worca-cc-ov-excl-'));
  const prev = process.env.WORCA_HOME; process.env.WORCA_HOME = home;
  _resetForTests();
  const { id, dir, key } = await seedPipeline(join(home, 'proj'));
  await mkdir(dir, { recursive: true });
  await persistResults(dir, { summary: { filesNew: 1 } });
  await persistDiffPatch(dir, 'diff --git a/x b/x\n+hi');

  let seen = null;
  const capture = async (o) => {
    seen = o;
    return { text: '{"narrative":"x","diffFindings":[],"diffCheckTruncated":false}' };
  };
  await generateOverview(key, id, { runClaudeImpl: capture, force: true });

  assert.ok(seen, 'the agent ran');
  assert.deepEqual(seen.allowedTools, [], 'pure reasoning over the prompt: no tools granted');
  assert.equal(seen.mcpConfigPath, undefined, 'no merged MCP config is handed to the overview agent');
  assert.equal(seen.mcpServerGrants, undefined, 'and therefore no server grants');
  // The argv the real runner would build from those options carries neither flag.
  const argv = buildClaudeArgs({
    prompt: seen.prompt, systemPrompt: seen.systemPrompt, permissionMode: 'acceptEdits',
    allowedTools: seen.allowedTools, mcpConfigPath: seen.mcpConfigPath,
    mcpServerGrants: seen.mcpServerGrants,
  });
  assert.ok(!argv.includes('--allowedTools'), `no --allowedTools: ${JSON.stringify(argv)}`);
  assert.ok(!argv.includes('--mcp-config'), `no --mcp-config: ${JSON.stringify(argv)}`);

  _resetForTests();
  if (prev === undefined) delete process.env.WORCA_HOME; else process.env.WORCA_HOME = prev;
  await rm(home, { recursive: true, force: true });
});
