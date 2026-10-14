import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { CLAUDE_INSTRUCTION_FILES, CLAUDE_INSTRUCTION_GLOBS } from '../src/core/engines/claude.mjs';
import { CODEX_INSTRUCTION_FILES } from '../src/core/engines/codex.mjs';
import { COPILOT_INSTRUCTION_FILES } from '../src/core/engines/copilot.mjs';
import { CURSOR_INSTRUCTION_FILES } from '../src/core/engines/cursor.mjs';

describe('Engine instruction constants', () => {
  it('Claude exports CLAUDE_INSTRUCTION_FILES and CLAUDE_INSTRUCTION_GLOBS', () => {
    assert.ok(Array.isArray(CLAUDE_INSTRUCTION_FILES));
    assert.ok(CLAUDE_INSTRUCTION_FILES.includes('CLAUDE.md'));
    assert.ok(CLAUDE_INSTRUCTION_FILES.includes('.claude/CLAUDE.md'));
    assert.ok(CLAUDE_INSTRUCTION_FILES.includes('CLAUDE.local.md'));
    assert.ok(Array.isArray(CLAUDE_INSTRUCTION_GLOBS));
    assert.ok(CLAUDE_INSTRUCTION_GLOBS.includes('.claude/rules/*.md'));
  });

  it('Claude constants are frozen', () => {
    assert.throws(() => { CLAUDE_INSTRUCTION_FILES.push('x'); }, TypeError);
    assert.throws(() => { CLAUDE_INSTRUCTION_GLOBS.push('x'); }, TypeError);
  });

  it('Codex exports CODEX_INSTRUCTION_FILES', () => {
    assert.ok(Array.isArray(CODEX_INSTRUCTION_FILES));
    assert.ok(CODEX_INSTRUCTION_FILES.includes('AGENTS.md'));
    assert.ok(CODEX_INSTRUCTION_FILES.includes('AGENTS.override.md'));
    assert.throws(() => { CODEX_INSTRUCTION_FILES.push('x'); }, TypeError);
  });

  it('Copilot exports COPILOT_INSTRUCTION_FILES', () => {
    assert.ok(Array.isArray(COPILOT_INSTRUCTION_FILES));
    assert.ok(COPILOT_INSTRUCTION_FILES.includes('.github/copilot-instructions.md'));
    assert.ok(COPILOT_INSTRUCTION_FILES.includes('AGENTS.md'));
    assert.throws(() => { COPILOT_INSTRUCTION_FILES.push('x'); }, TypeError);
  });

  it('Cursor exports CURSOR_INSTRUCTION_FILES as empty (unverified)', () => {
    assert.ok(Array.isArray(CURSOR_INSTRUCTION_FILES));
    assert.strictEqual(CURSOR_INSTRUCTION_FILES.length, 0);
    assert.throws(() => { CURSOR_INSTRUCTION_FILES.push('x'); }, TypeError);
  });
});
