// test/ask-prompt-codex.test.mjs — the Codex prompt variant (cascading-settings-design.md §4.6 "Prompt"); the Claude text is unchanged.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ASK_SYSTEM_RULES, ASK_CODEX_REWRITES, codexSystemRules, buildSystemPrompt, renderWebSection, codexMemoryLine } from '../src/core/ask/prompt.mjs';

const CATALOG = { projects: [], workspaces: [], workflows: [], agents: [] };

test('every rewrite targets text that occurs exactly once in the Claude rules', () => {
  for (const [from] of ASK_CODEX_REWRITES) {
    const at = ASK_SYSTEM_RULES.indexOf(from);
    assert.ok(at >= 0 && ASK_SYSTEM_RULES.indexOf(from, at + 1) < 0, from.slice(0, 60));
  }
});

test('the Codex rules name worca file tools, no Read/Grep/Glob tools, no sub-agents, no claude CLI for this chat', () => {
  const r = codexSystemRules();
  assert.match(r, /read_file/);
  assert.doesNotMatch(r, /your Read, Grep and Glob tools/);
  assert.doesNotMatch(r, /pass that path to your Read tool/);
  assert.doesNotMatch(r, /never from a sub-agent/);
  assert.match(r, /this chat runs on the Codex CLI/);
  assert.match(r, /NOT loaded into this session/);
});

test('buildSystemPrompt: the Claude prompt is byte-identical; Codex swaps the rules and the web line', () => {
  const web = { enabled: true, allowedDomains: ['example.com'], search: null };
  assert.equal(buildSystemPrompt(CATALOG, { web }), buildSystemPrompt(CATALOG, { web, engine: 'claude' }));
  const codex = buildSystemPrompt(CATALOG, { web, engine: 'codex' });
  assert.ok(codex.startsWith(codexSystemRules()));
  assert.match(codex, /Codex's own web search stays off/);
  assert.doesNotMatch(codex, /WebFetch\/WebSearch/);
  assert.equal(renderWebSection(web), renderWebSection(web, { engine: 'claude' }));
});

test('codexMemoryLine names the mounted rules folder, or nothing', () => {
  assert.equal(codexMemoryLine(null), '');
  assert.match(codexMemoryLine('/h/ask/memory/global'), /\/h\/ask\/memory\/global\/\.claude\/rules\/worca/);
});
