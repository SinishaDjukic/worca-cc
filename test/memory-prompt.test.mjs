import { test } from 'node:test';
import assert from 'node:assert/strict';
import { WORKSPACE_CONTEXT_WINS, buildSystemPrompt, _runOptsForTests as runOpts } from '../src/core/phases.mjs';
import { buildClaudeArgs, memoryDirsFromPrompt } from '../src/core/claude-runner.mjs';

const BLOCK = '## Worca memory\nintro\nGlobal — /m/global:\n';

test('buildSystemPrompt: the memory block sits after the workspace block and before the agent body', () => {
  const ws = { workspaceDescription: 'A workspace.', projects: [{ projectName: 'A' }] };
  const sp = buildSystemPrompt('TOOL', 'BODY', 'planner', ws, BLOCK);
  const at = (s) => { const i = sp.indexOf(s); assert.notEqual(i, -1, `missing ${s}`); return i; };
  assert.ok(at('TOOL') < at('## Workspace Context'));
  assert.ok(at('## Workspace Context') < at('## Worca memory'));
  assert.ok(at('## Worca memory') < at('BODY'));
  // workspaceContextBlock ends with one newline of its own and the joiner adds two.
  assert.equal(sp, 'TOOL\n\n## Workspace Context\n\nA workspace.\n\nMember projects: A.\n\n' + WORKSPACE_CONTEXT_WINS + '\n\n\n' + BLOCK.trim() + '\n\nBODY');
});

test('runOpts: ctx.memoryBlock becomes appendSubagentSystemPrompt and ctx.memoryMount becomes addDirs; absent ⇒ both undefined (argv unchanged)', () => {
  const base = { projectDir: '/w', claudeOpts: {}, node: { key: 'planner', tools: [] } };
  const withBlock = runOpts({ ...base, memoryBlock: BLOCK, memoryMount: '/p/pipe/memory' }, { role: 'planner', prompt: 'p', systemPrompt: 's', allowedTools: ['Read'] });
  assert.equal(withBlock.appendSubagentSystemPrompt, BLOCK);
  assert.deepEqual(withBlock.addDirs, ['/p/pipe/memory'], 'the writable copy is outside the cwd: acceptEdits auto-approves edits only in the working directory and additionalDirectories');
  const without = runOpts(base, { role: 'planner', prompt: 'p', systemPrompt: 's', allowedTools: ['Read'] });
  assert.equal(without.appendSubagentSystemPrompt, undefined);
  assert.equal(without.addDirs, undefined);
  const empty = runOpts({ ...base, memoryBlock: '', memoryMount: null }, { role: 'planner', prompt: 'p', systemPrompt: 's', allowedTools: ['Read'] });
  assert.equal(empty.appendSubagentSystemPrompt, undefined);
  assert.equal(empty.addDirs, undefined);
  // The argv end-to-end: the dir rides --add-dir, last.
  const argv = buildClaudeArgs({ ...withBlock, permissionMode: 'acceptEdits' });
  assert.deepEqual(argv.slice(-2), ['--add-dir', '/p/pipe/memory']);
});

// The agent bodies as shipped; the three that hold the knowledge carry a `## Worca memory` section.
import { readFileSync } from 'node:fs';

const agentBody = (file) => readFileSync(new URL(`../agents/${file}`, import.meta.url), 'utf8');

const MEMORY_AGENTS = ['worca-cc-implementer.md', 'worca-cc-code-reviewer.md', 'worca-cc-planner.md'];

// The defragmenter's sidecar directive lands in its TASK prompt, beside the body's own location
// sentence. Both must name the writable copy: the rules copy under the cwd refuses every write.
test('the defragmenter directive points at the writable copy outside the checkout, never at the rules copy', () => {
  const meta = JSON.parse(agentBody('memoryDefragmenter.meta.json'));
  const directive = meta.inputs.find((i) => i.id === 'task').directive;
  assert.doesNotMatch(directive, /under the project directory at \.claude\/rules\/worca/, 'the old location sentence is gone');
  assert.match(directive, /outside the project checkout/, 'the directive names the writable copy');
  assert.match(directive, /\.claude\/rules\/worca\/[^.]*read-only/, 'the rules copy is named as read-only');
  assert.match(directive, /never write there/, 'and the agent is told not to write to it');
});

// §15: the block reaches Task-tool sub-agents by exact byte, or not at all.
import { renderMemoryBlock } from '../src/core/memory-store.mjs';

test('an agent body that carries its own `## Worca memory` heading never confuses memoryDirsFromPrompt', () => {
  // The three knowledge-holding bodies now repeat the heading. memoryDirsFromPrompt takes the
  // FIRST occurrence, and buildSystemPrompt always puts the real block ahead of the body — so the
  // mount still resolves; with memory off, the body's prose simply yields no dirs.
  const block = renderMemoryBlock([{ label: 'Global', dir: '/m/global' }, { label: 'Project worca-cc', dir: '/m/project' }]);
  for (const file of MEMORY_AGENTS) {
    const body = agentBody(file);
    assert.deepEqual(memoryDirsFromPrompt(buildSystemPrompt('TOOL', body, 'r', undefined, block)), ['/m/global', '/m/project'], file);
    assert.deepEqual(memoryDirsFromPrompt(buildSystemPrompt('TOOL', body, 'r')), [], `${file}: no block ⇒ no dirs`);
  }
});

test('buildClaudeArgs: the block rides --append-subagent-system-prompt by exact byte; absent ⇒ argv unchanged', () => {
  const base = { prompt: 'p', systemPrompt: 's', allowedTools: ['Read'], permissionMode: 'acceptEdits' };
  const args = buildClaudeArgs({ ...base, appendSubagentSystemPrompt: BLOCK });
  assert.equal(args[args.indexOf('--append-subagent-system-prompt') + 1], BLOCK);
  assert.deepEqual(buildClaudeArgs(base), buildClaudeArgs({ ...base, appendSubagentSystemPrompt: undefined }));
  assert.ok(!buildClaudeArgs(base).includes('--append-subagent-system-prompt'));
});
