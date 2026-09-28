// test/workspace-map-agents.test.mjs
// The Workspace scan's agents (wsmap P2): sidecars exactly as the index pins them, bodies that carry
// the binding contract (the brief's first lines, <OUT> in the checker line, waves of at most 8 in the
// foreground, member-relative 1-based evidence, the checker loop and its exit, guardrail-protected
// files left closed), and the guardrail set every scan runs under (`normal`) leaving that checker
// runnable through Bash.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { loadAgentRegistry } from '../src/core/agent-registry.mjs';
import { toolsForMeta } from '../src/core/graph/executor.mjs';
import { GUARDRAIL_PRESETS } from '../src/core/guardrails.mjs';
import { MOCK_WRITER_ROLES } from '../src/core/claude-runner.mjs';

const AGENTS_DIR = fileURLToPath(new URL('../agents/', import.meta.url));
const REG = loadAgentRegistry(AGENTS_DIR, { userAgentsDir: null, includePlugins: false });
const raw = (key) => JSON.parse(readFileSync(join(AGENTS_DIR, `${key}.meta.json`), 'utf8'));
const body = (key) => readFileSync(join(AGENTS_DIR, REG[key].agentFile), 'utf8');
const ports = (m) => ({ in: m.inputs.map((p) => `${p.id}:${p.type}`), out: m.outputs.map((p) => `${p.id}:${p.type}:${p.filename}`) });

/** The index's agent table (P2). */
const PINNED = {
  workspaceScanner: { agentFile: 'worca-cc-workspace-scanner.md', mockRole: 'workspace-scan', fanOut: true,
    ports: { in: ['brief:md'], out: ['survey:json:survey.json'] } },
  workspaceUsageMapper: { agentFile: 'worca-cc-workspace-usage-mapper.md', mockRole: 'workspace-usage', fanOut: true,
    ports: { in: ['brief:md'], out: ['usage:json:usage.json'] } },
  workspaceSynthesizer: { agentFile: 'worca-cc-workspace-synthesizer.md', mockRole: 'workspace-synth', fanOut: false,
    ports: { in: ['brief:md'], out: ['synthesis:json:synthesis.json'] } },
};

test('the scan agents: sidecars exactly as the index pins them', () => {
  for (const [key, want] of Object.entries(PINNED)) {
    const m = REG[key];
    assert.ok(m, `${key} is registered`);
    assert.equal(m.agentFile, want.agentFile, key);
    assert.equal(m.mockRole, want.mockRole, key);
    assert.ok(MOCK_WRITER_ROLES.has(m.mockRole), `${key}: the offline mock serves ${m.mockRole}`);
    assert.deepEqual(ports(m), want.ports, key);
    assert.equal(m.fanOut, want.fanOut, key);
    assert.equal(m.placeable, false, `${key}: never on a canvas`);
    assert.equal(m.scope, 'workspace-only', key);
    assert.equal(m.runnerType, 'producer', key);
    assert.equal(m.asksQuestions, false, key);
    assert.equal(m.domain, 'shared', key);
    assert.deepEqual(raw(key).humanEffort, { factor: 0 }, `${key}: no human-effort equivalent`);
    assert.match(body(key), new RegExp(`^---\\nname: ${want.agentFile.replace(/\.md$/, '')}\\n`), `${key}: frontmatter name = file stem`);
    assert.equal(body(key).includes('## Worca memory'), false, `${key}: not a knowledge-holding agent`);
  }
});

/** The contract every scan agent body carries (the checker loop on its own output). */
const CHECKER_NEEDLES = ['<!-- worca:check=', 'Replace `<OUT>` with the absolute path', 'Never finish with a failing checker', 'one short line naming the path',
  'cannot start, do not loop'];
/** …and every fan-out body (the waves, the evidence rules). */
const FANOUT_NEEDLES = ['waves of at most 8', 'Dispatch normally and wait for every result', 'EVERY member', '1-based', 'character for character', 'RELATIVE to',
  'guardrails refuse to Read', 'not through Bash'];

test('the usage mapper body: every member, waves of at most 8 in the foreground, evidence rules, the checker loop', () => {
  const b = body('workspaceUsageMapper');
  for (const needle of ['<!-- worca:catalog=', 'usage-briefs/<key>.md', ...CHECKER_NEEDLES, ...FANOUT_NEEDLES]) assert.ok(b.includes(needle), needle);
  assert.match(b, /never skip a member/i);
});

test('the survey (scanner) body: gap members only, waves of at most 8 in the foreground, the fact rules, the checker loop', () => {
  const b = body('workspaceScanner');
  for (const needle of ['Workspace Scanner', '<!-- worca:extract=', '"kind", "key", "file", "line", "match"', ...CHECKER_NEEDLES, ...FANOUT_NEEDLES]) {
    assert.ok(b.includes(needle), needle);
  }
  assert.match(b, /never skip a member/i);
  assert.match(b, /`skipped` for every member the brief lists as needing nothing/);
  assert.match(b, /dispatch nobody — this overrides the task prompt's generic Fan-out block/, 'no gap member: no fan-out at all');
});

test('the synthesizer body: no sub-agents, grounded in the brief, the checker loop', () => {
  const b = body('workspaceSynthesizer');
  for (const needle of ['<!-- worca:map=', '(missing)', 'no relation that is not in the brief', 'Never dispatch sub-agents', ...CHECKER_NEEDLES]) {
    assert.ok(b.includes(needle), needle);
  }
  assert.equal(b.includes('waves of'), false, 'the synthesizer never fans out');
});

test('the normal guardrail set (every scan runs under it) leaves the checker runnable: Bash granted, no node or blanket Bash deny', () => {
  const deny = GUARDRAIL_PRESETS.normal.deny;
  assert.ok(!deny.some((r) => /^Bash(\(\*\))?$/.test(r) || /^Bash\((node|"|\/)/i.test(r)), JSON.stringify(deny));
  for (const key of Object.keys(PINNED)) assert.ok(toolsForMeta(REG[key]).includes('Bash'), `${key} can run the checker`);
});
