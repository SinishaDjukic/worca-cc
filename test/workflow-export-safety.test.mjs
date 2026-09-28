import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, sep } from 'node:path';
import { applyExport, planExport } from '../src/core/workflow-export.mjs';
import { writeGraphWorkflow } from '../src/core/workflows.mjs';
import { useTempHome } from './helpers/temp-home.mjs';
import { writeKeyGraph } from './helpers/export-fixtures.mjs';

useTempHome(after);

const dirs = [];
const tmp = async () => { const d = await mkdtemp(join(tmpdir(), 'wf-exp-sf-')); dirs.push(d); return d; };
after(async () => { await Promise.all(dirs.map((d) => rm(d, { recursive: true, force: true }))); });

test('slug traversal is rejected', async () => {
  await assert.rejects(
    applyExport({ workflowId: 'wf_default', destination: 'project', projectDir: await tmp(), slug: '../evil' }),
    /invalid slug/,
  );
});

// REGRESSION GUARD (#9): a valid export writes strictly under <dest>/.claude — the safeJoin
// containment check enforces dest/.claude (per its doc), not merely dest.
test('every written path is under <dest>/.claude', async () => {
  const dest = await tmp();
  const applied = await applyExport({ workflowId: 'wf_default', destination: 'project', projectDir: dest, onConflict: 'overwrite' });
  const root = join(dest, '.claude') + sep;   // platform separator: written paths use sep on Windows
  assert.ok(applied.written.length > 0);
  for (const p of applied.written) assert.ok(p.startsWith(root), `${p} must be under ${root}`);
});

test('workspaceReviewer node refuses with a specific message', async () => {
  const tpl = await writeKeyGraph({ name: 'WS Fixture', keys: ['planner', 'workspaceReviewer'] });
  await assert.rejects(
    applyExport({ workflowId: tpl.id, destination: 'project', projectDir: await tmp(), onConflict: 'overwrite' }),
    (e) => e.code === 'UNSUPPORTED' && /workspaceReviewer/.test(e.message),
  );
});

test('decomposer node gets the fan-out workaround (Agent tool + clause)', async () => {
  const dest = await tmp();
  const tpl = await writeKeyGraph({ name: 'Decomp Fixture', keys: ['planner', 'decomposer', 'implementer'] });
  await applyExport({ workflowId: tpl.id, destination: 'project', projectDir: dest, onConflict: 'overwrite' });
  const skill = await readFile(join(dest, '.claude/skills/decomp-fixture/SKILL.md'), 'utf8');
  const dispatch = skill.match(/Dispatch `([^`]*decomposer[^`]*)`/);
  assert.ok(dispatch, 'decomposer is dispatched');
  const agentMd = await readFile(join(dest, `.claude/agents/${dispatch[1]}.md`), 'utf8');
  assert.match(agentMd, /^tools:.*\bAgent\b/m);                       // fan-out tool added
  assert.match(agentMd, /parallel READ-ONLY research subagents/);    // fan-out clause in preamble
});

test('a template with script nodes cannot be exported to Claude Code yet: UNSUPPORTED naming the nodes', async () => {
  const tpl = await writeKeyGraph({ name: 'Script Fixture', keys: ['planner'] });
  const shellPorts = { inputs: [{ id: 'in', type: 'md', required: false }], outputs: [{ id: 'log', type: 'md', when: 'always', filename: 'shell-cycle{cycle}.md' }] };
  await writeGraphWorkflow({ ...tpl,
    nodes: [...tpl.nodes, { id: 'n_sh', kind: 'script', key: 'shell', x: 500, y: 300, config: { params: { command: 'npm test' }, ports: shellPorts } }],
    wires: [...tpl.wires, { id: 'w_sh', from: { node: 'n_task', port: 'task' }, to: { node: 'n_sh', port: 'in' } }] });
  for (const fn of [planExport, applyExport]) {
    await assert.rejects(fn({ workflowId: tpl.id, destination: 'project', projectDir: await tmp(), onConflict: 'overwrite' }),
      (e) => e.code === 'UNSUPPORTED' && e.message === 'export to Claude Code does not carry script cards yet: Shell (n_sh)' && e.nodes[0] === 'n_sh');
  }
});
