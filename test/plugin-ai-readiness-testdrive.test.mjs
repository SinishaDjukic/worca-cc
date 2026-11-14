// test/plugin-ai-readiness-testdrive.test.mjs — Test-drive drives Claude Code and Codex live, only when
// selected; every other selected engine gets the final probe's static result with the not-yet reason;
// an unselected engine gets no line; a missing binary is "not driven"; workspace runs stay static.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const DIR = fileURLToPath(new URL('../plugins/ai-readiness/', import.meta.url));
const td = readFileSync(join(DIR, 'agents', 'readinessTestDrive.md'), 'utf8');
const flat = td.replace(/\s+/g, ' ');
const meta = JSON.parse(readFileSync(join(DIR, 'agents', 'readinessTestDrive.meta.json'), 'utf8'));
const STATIC = ['copilot', 'cursor', 'gemini', 'qwen', 'goose', 'opencode'];

test('the Test-drive prompt drives only claude and codex live', () => {
  assert.match(flat, /Live legs run for `claude` and `codex` only/);
  assert.match(td, /env -u CLAUDECODE claude -p /);
  assert.match(td, /"\$CODEX_BIN" exec --sandbox workspace-write/);
  // No other engine's CLI is started from the prompt.
  for (const bin of ['copilot', 'cursor-agent', 'gemini', 'qwen', 'goose', 'opencode']) {
    assert.doesNotMatch(td, new RegExp(`\\(cd "\\$WT" && ${bin}\\b`), `${bin} is started live`);
    assert.doesNotMatch(td, new RegExp(`command -v ${bin}\\b`), `${bin} is looked up to be driven`);
  }
  // The legs follow the selection, not a fixed list.
  assert.match(flat, /only for an engine in the selected tools/);
  assert.match(meta.description, /every selected/);
});

test('a selected gemini is reported static with the not-yet reason', () => {
  assert.match(flat, /`copilot`, `cursor`, `gemini`, `qwen`, `goose`, `opencode`/);
  for (const e of STATIC) assert.match(td, new RegExp(`\`${e}\``), `${e} is not named`);
  assert.match(flat, /<Label>: static checks only — worca cannot drive <Label> headless from a pipeline step yet/);
  assert.match(flat, /readiness-probe-final-cycle\{N\}\.json/);
  assert.match(flat, /`tools\.<engine>`: its `surface` and `why`/);
  assert.match(flat, /No worktree for them/);
  assert.match(flat, /Gemini CLI: static checks only — worca cannot drive Gemini CLI headless from a pipeline step yet/);
});

test('an unselected engine gets no line', () => {
  assert.match(flat, /An engine that is not selected gets no line at all/);
  assert.doesNotMatch(flat, /Cursor, Copilot\*\*: not driven/);
});

test('a missing engine binary is reported not driven', () => {
  assert.match(flat, /"not driven: no claude binary" \(minor\)/);
  assert.match(flat, /"not driven: no codex binary" \(minor\)/);
  assert.match(td, /command -v claude/);
  assert.match(td, /WORCA_CODEX_BIN/);
});

test('the final message lists the live legs and the static checks', () => {
  assert.match(flat, /which engines got a live leg and which got static checks only/);
});

test('workspace runs stay static', () => {
  assert.match(flat, /When `map\.members` is present, drive no CLI and create no worktree/);
});

test('the Claude leg pipes the brief on stdin, never after --allowedTools', () => {
  const line = td.split('\n').find((l) => l.includes('env -u CLAUDECODE claude -p'));
  assert.ok(line, 'claude command present');
  assert.doesNotMatch(line, /--allowedTools "[^"]*" "<brief>"/);
  assert.match(flat, /printf '%s\\n' "<brief>" \| env -u CLAUDECODE claude -p/);
});

test('the Claude leg loads only the project settings and no MCP servers', () => {
  const line = td.split('\n').find((l) => l.includes('env -u CLAUDECODE claude -p'));
  assert.match(line, /--setting-sources project /);
  assert.match(line, /--strict-mcp-config/);
});

test('a nested CLI blocked by the run sandbox is an environment result, not a failed task', () => {
  assert.match(flat, /not driven — the run's engine sandbox blocks nested CLIs/);
  assert.match(flat, /Operation not permitted/);
  assert.match(flat, /say so in the final message/);
  const readme = readFileSync(join(DIR, 'README.md'), 'utf8').replace(/\s+/g, ' ');
  assert.match(readme, /live legs need a run engine that allows nested CLI processes/i);
});
