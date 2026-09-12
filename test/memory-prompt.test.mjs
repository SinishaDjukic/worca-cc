import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildSystemPrompt, _runOptsForTests as runOpts } from '../src/core/phases.mjs';

const INDEX = '## Worca memory\nintro\nGlobal — /m/global:\n- `testing.md` — hook\n';

test('buildSystemPrompt: the memory block sits after the workspace block and before the agent body', () => {
  const ws = { workspaceDescription: 'A workspace.', projects: [{ projectName: 'A' }] };
  const sp = buildSystemPrompt('TOOL', 'BODY', 'planner', ws, INDEX);
  const at = (s) => { const i = sp.indexOf(s); assert.notEqual(i, -1, `missing ${s}`); return i; };
  assert.ok(at('TOOL') < at('## Workspace Context'));
  assert.ok(at('## Workspace Context') < at('## Worca memory'));
  assert.ok(at('## Worca memory') < at('BODY'));
  // workspaceContextBlock ends with one newline of its own and the joiner adds two.
  assert.equal(sp, 'TOOL\n\n## Workspace Context\n\nA workspace.\n\nMember projects: A.\n\n\n' + INDEX.trim() + '\n\nBODY');
});

test('buildSystemPrompt: no index ⇒ byte-identical to the four-argument call (legacy pins stay green)', () => {
  assert.equal(buildSystemPrompt('T', 'B', 'r', undefined, ''), buildSystemPrompt('T', 'B', 'r'));
  assert.equal(buildSystemPrompt('T', 'B', 'r', undefined, undefined), buildSystemPrompt('T', 'B', 'r'));
  assert.equal(buildSystemPrompt('', 'B', 'r', undefined, '   '), 'B', 'whitespace-only index is no block');
});

test('runOpts: ctx.memoryIndex becomes appendSubagentSystemPrompt; absent ⇒ undefined (argv unchanged)', () => {
  const base = { projectDir: '/w', claudeOpts: {}, node: { key: 'planner', tools: [] } };
  const withIdx = runOpts({ ...base, memoryIndex: INDEX }, { role: 'planner', prompt: 'p', systemPrompt: 's', allowedTools: ['Read'] });
  assert.equal(withIdx.appendSubagentSystemPrompt, INDEX);
  const without = runOpts(base, { role: 'planner', prompt: 'p', systemPrompt: 's', allowedTools: ['Read'] });
  assert.equal(without.appendSubagentSystemPrompt, undefined);
  assert.equal(runOpts({ ...base, memoryIndex: '' }, { role: 'planner', prompt: 'p', systemPrompt: 's', allowedTools: ['Read'] }).appendSubagentSystemPrompt, undefined);
});

// §15: the index reaches Task-tool sub-agents by exact byte, or not at all.
import { buildClaudeArgs } from '../src/core/claude-runner.mjs';

test('buildClaudeArgs: the index rides --append-subagent-system-prompt by exact byte; absent ⇒ argv unchanged', () => {
  const base = { prompt: 'p', systemPrompt: 's', allowedTools: ['Read'], permissionMode: 'acceptEdits' };
  const args = buildClaudeArgs({ ...base, appendSubagentSystemPrompt: INDEX });
  assert.equal(args[args.indexOf('--append-subagent-system-prompt') + 1], INDEX);
  assert.deepEqual(buildClaudeArgs(base), buildClaudeArgs({ ...base, appendSubagentSystemPrompt: undefined }));
  assert.ok(!buildClaudeArgs(base).includes('--append-subagent-system-prompt'));
});
