// test/plugin-ai-readiness-engines.test.mjs — the ai-readiness pipelines run on whatever engine the
// run uses: no agent needs the Skill tool, every agent that reads the rubric is told where worca
// mounted it (`.claude/skills` on Claude Code, `.agents/skills` on every other engine), fan-out has a
// serial fallback, and the probe leaves the mount out under either folder.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { skillsRelFor } from '../src/core/run-context.mjs';
import { DEFAULT_EXCLUDED } from '../plugins/ai-readiness/scripts/readiness-probe.mjs';

const DIR = fileURLToPath(new URL('../plugins/ai-readiness/', import.meta.url));
const AGENTS = readdirSync(join(DIR, 'agents')).filter((f) => f.endsWith('.md')).map((f) => f.replace(/\.md$/, '')).sort();
const md = (key) => readFileSync(join(DIR, 'agents', `${key}.md`), 'utf8');
const meta = (key) => JSON.parse(readFileSync(join(DIR, 'agents', `${key}.meta.json`), 'utf8'));
const frontTools = (text) => (/^---\n[\s\S]*?^tools:[ \t]*(.*)$/m.exec(text)?.[1] || '').split(',').map((s) => s.trim()).filter(Boolean);
const ENGINES = ['claude', 'codex', 'copilot', 'cursor', 'gemini', 'qwen', 'goose', 'opencode'];
const RUBRIC_AT = (rel) => `${rel}/readiness-rubric/SKILL.md`;

test('the seven agents are the ones this test covers', () => {
  assert.deepEqual(AGENTS, ['readinessGenerate', 'readinessMap', 'readinessPlan', 'readinessRescore', 'readinessScore', 'readinessTestDrive', 'readinessTests']);
});

test('no agent requires the Skill tool', () => {
  for (const key of AGENTS) {
    assert.ok(!frontTools(md(key)).includes('Skill'), `${key}: tools lists Skill`);
    assert.doesNotMatch(md(key), /\bSkill tool\b/, `${key}: the prompt asks for the Skill tool`);
    assert.doesNotMatch(md(key), /\b(the )?rubric skill\b|\*\*readiness-rubric\*\* skill/, `${key}: the prompt sends the agent to a skill instead of the file`);
  }
});

test('every agent that cites the rubric names its path', () => {
  // The mount folder per engine is the host's (run-context.mjs skillsRelFor); the prompt names both.
  const rels = [...new Set(ENGINES.map((e) => skillsRelFor(e)))].sort();
  assert.deepEqual(rels, ['.agents/skills', '.claude/skills']);
  const citing = AGENTS.filter((key) => /rubric/i.test(md(key).replace(/readiness-rubric\//g, '')));
  assert.ok(citing.length >= 5, `expected Map, Plan, Score, Generate and Re-score to cite the rubric, got ${citing}`);
  for (const key of citing) {
    const text = md(key).replace(/\s+/g, ' ');
    assert.ok(text.includes(`Read the rubric at \`${RUBRIC_AT('.claude/skills')}\` before you start`), `${key}: no "Read the rubric at …" line`);
    assert.ok(text.includes(`\`${RUBRIC_AT('.agents/skills')}\``), `${key}: the non-Claude mount is not named`);
  }
});

test('an agent declares the rubric skill exactly when its prompt names the rubric path', () => {
  for (const key of AGENTS) {
    const names = md(key).includes(RUBRIC_AT('.claude/skills'));
    const requires = (meta(key).requiresSkills || []).includes('readiness-rubric');
    assert.equal(requires, names, `${key}: requiresSkills ${requires} but prompt names the path ${names}`);
  }
});

test('workspace fan-out falls back to one member at a time when sub-agents are unavailable', () => {
  const line = 'When you cannot start sub-agents, do the members one after another yourself, in sorted projectKey order.';
  for (const key of ['readinessMap', 'readinessGenerate', 'readinessTests', 'readinessRescore']) {
    assert.ok(md(key).replace(/\s+/g, ' ').includes(line), `${key}: no serial fallback line`);
  }
});

test('the probe and Test-drive leave the rubric mount out under either skills folder', () => {
  for (const rel of ['.claude/skills', '.agents/skills']) {
    assert.ok(DEFAULT_EXCLUDED.includes(`${rel}/readiness-rubric`), `probe: ${rel}/readiness-rubric not excluded`);
  }
  const td = md('readinessTestDrive');
  assert.match(td, /-e '\^\\\.claude\/skills\/readiness-rubric\/'/);
  assert.match(td, /-e '\^\\\.agents\/skills\/readiness-rubric\/'/);
  const map = md('readinessMap');
  assert.match(map, /`\.agents\/skills\/readiness-rubric\/`/, 'Map is told to leave the non-Claude mount out');
});

test('Plan recounts a skills folder row from the tasks kept in the repo', () => {
  const plan = md('readinessPlan').replace(/\s+/g, ' ');
  assert.match(plan, /recount/i);
  assert.match(plan, /`target` is `repo`/);
});

test('Plan plans a .claude/rules row for Claude-only notes that improve would move', () => {
  const plan = md('readinessPlan').replace(/\s+/g, ' ');
  assert.match(plan, /Claude-only notes/);
  assert.match(plan, /`\.claude\/rules\/<name>\.md` row/);
  assert.match(plan, /`improve`/);
});
