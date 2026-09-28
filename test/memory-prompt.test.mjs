import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildSystemPrompt, _runOptsForTests as runOpts } from '../src/core/phases.mjs';
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
  assert.equal(sp, 'TOOL\n\n## Workspace Context\n\nA workspace.\n\nMember projects: A.\n\n\n' + BLOCK.trim() + '\n\nBODY');
});

test('buildSystemPrompt: no block ⇒ byte-identical to the four-argument call (legacy pins stay green)', () => {
  assert.equal(buildSystemPrompt('T', 'B', 'r', undefined, ''), buildSystemPrompt('T', 'B', 'r'));
  assert.equal(buildSystemPrompt('T', 'B', 'r', undefined, undefined), buildSystemPrompt('T', 'B', 'r'));
  assert.equal(buildSystemPrompt('', 'B', 'r', undefined, '   '), 'B', 'whitespace-only block is no block');
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

// The write policy also lands in the three agent bodies that actually hold the knowledge.
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const AGENTS_DIR = fileURLToPath(new URL('../agents/', import.meta.url));
const agentBody = (file) => readFileSync(new URL(`../agents/${file}`, import.meta.url), 'utf8');
/** The `## Worca memory` section of an agent body: its lines, up to the next heading. */
function memorySection(file) {
  const lines = agentBody(file).split('\n');
  const at = lines.findIndex((l) => l === '## Worca memory');
  if (at === -1) return null;
  const rest = lines.slice(at + 1);
  const end = rest.findIndex((l) => l.startsWith('## '));
  return (end === -1 ? rest : rest.slice(0, end)).filter((l) => l.trim());
}

const MEMORY_AGENTS = ['worca-cc-implementer.md', 'worca-cc-code-reviewer.md', 'worca-cc-planner.md'];

test('the implementer, the reviewer and the planner each carry a short `## Worca memory` section', () => {
  for (const file of MEMORY_AGENTS) {
    const section = memorySection(file);
    assert.ok(section, `${file}: no ## Worca memory heading`);
    assert.ok(section.length <= 6, `${file}: ${section.length} lines — the section stays at most 6`);
    const text = section.join('\n');
    // Both limbs of the trigger, asserted separately — one `|` pattern would pass on either alone.
    assert.match(text, /cost [^.]*cycle/, `${file}: restates the trigger's cost-a-cycle limb`);
    assert.match(text, /contradicted/, `${file}: restates the trigger's contradicted-an-assumption limb`);
    assert.match(text, /1–2 files/, `${file}: restates the file cap`);
    assert.match(text, /never a substitute/, `${file}: memory never replaces the run's own outputs`);
  }
  // The role-specific source of the knowledge, per agent.
  assert.match(memorySection('worca-cc-implementer.md').join('\n'), /fix/, 'the implementer is pointed at the review that bounced it');
  assert.match(memorySection('worca-cc-code-reviewer.md').join('\n'), /recur/, 'the reviewer records a recurring class, not this diff');
  assert.match(memorySection('worca-cc-planner.md').join('\n'), /constraint/, 'the planner records a constraint it had to design around');
});

// Each of the three bodies states a write-scope rule a few lines above its memory section. Left
// absolute, that rule reads as a prohibition on the very write the section asks for, so it must
// name the memory directory as its one exception.
const WRITE_SCOPE_RULES = [
  ['worca-cc-planner.md', /Never write outside the pipeline dir/],
  ['worca-cc-code-reviewer.md', /two absolute paths given/],
  ['worca-cc-implementer.md', /Only the files the plan \(implement\) or the review \(fix\) require should change/],
];

test('the write-scope rule in each body carves out the memory directory', () => {
  for (const [file, rule] of WRITE_SCOPE_RULES) {
    const line = agentBody(file).split('\n').find((l) => rule.test(l));
    assert.ok(line, `${file}: the write-scope rule moved — ${rule}`);
    assert.match(line, /memory/i, `${file}: the write-scope rule must name the memory directory as its exception`);
  }
});

test('no other builtin agent body grows a memory section', () => {
  const others = readdirSync(AGENTS_DIR).filter((f) => f.endsWith('.md') && !MEMORY_AGENTS.includes(f));
  assert.ok(others.length >= 8, `expected the rest of the builtins, got ${others.length}`);
  for (const file of others) {
    assert.equal(memorySection(file), null, `${file}: only the three knowledge-holding agents carry the section`);
  }
});

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
