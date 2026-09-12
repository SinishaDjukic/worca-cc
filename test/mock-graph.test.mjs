// test/mock-graph.test.mjs
// The offline MOCK chain, audited as a whole.
//
// The chain is: sidecar `mockRole` -> clarifier runnerType -> a node whose output
// feeds an `expands` input -> a declared verdict -> the generic producer
// (`resolveMockRole`, executor.mjs), and every link of it must land on a `case` the
// writer switch in `runMock` actually handles. The unit-level chain is pinned in
// graph-executor.test.mjs; what this file adds is the two things a unit test cannot
// see:
//   1. the STRUCTURAL audit — the writer switch's case labels and the
//      MOCK_WRITER_ROLES export are the same set, and the 12 builtin sidecars pin
//      roles that already exist in it;
//   2. the BEHAVIOURAL audit — real graphs run to completion offline. Every seed
//      graph and the graph default terminate because the mock verdicts get less
//      severe each cycle, an ALL-CUSTOM graph reaches its End card with agents the
//      engine has never heard of, and no flow card ever spawns a runner.
//
// GENERICITY: the all-custom case is the load-bearing one. Every key in it is a user
// sidecar, so if any part of the chain ever keys off a builtin agent name, that test
// goes red first.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync, readdirSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { useTempHome } from './helpers/temp-home.mjs';
import { runGraphOffline } from './helpers/graph-run.mjs';
import { MOCK_WRITER_ROLES, MOCK_ROLE_CLARIFY, MOCK_ROLE_DECOMPOSER, runClaude, memoryDirsFromPrompt } from '../src/core/claude-runner.mjs';
import { renderMemoryIndex } from '../src/core/memory-store.mjs';
import { QUIESCENCE_WARNING, quiescenceDeadEnd } from '../src/core/graph/scheduler.mjs';
import { loadAgentRegistry } from '../src/core/agent-registry.mjs';
import { registryPortsFn } from '../src/core/graph/registry-ports.mjs';
import { SEED_TEMPLATES } from '../src/core/graph/seed-templates.mjs';
import { GRAPH_DEFAULT_WORKFLOW } from '../src/core/graph/builtin-workflows.mjs';
import { flowPorts } from '../src/shared/graph/ports.mjs';
import { AWAIT_PORT } from '../src/shared/graph/constants.mjs';

useTempHome(after);
const REPO = fileURLToPath(new URL('..', import.meta.url));
const AGENTS_DIR = join(REPO, 'agents');
const REGISTRY = loadAgentRegistry(AGENTS_DIR, { userAgentsDir: null, includePlugins: false });
const portsFn = registryPortsFn(REGISTRY);

const scratch = [];
const tmp = (p) => { const d = mkdtempSync(join(tmpdir(), p)); scratch.push(d); return d; };
after(() => { for (const d of scratch) rmSync(d, { recursive: true, force: true }); });

// ── 1. structural audit: the switch, the export, the builtin sidecars ────────

/** The `case` labels of runMock's writer switch, read straight off the source — the
 *  only way to prove the export has not drifted from the switch it mirrors. */
function writerSwitchRoles() {
  const src = readFileSync(join(REPO, 'src/core/claude-runner.mjs'), 'utf8');
  const start = src.indexOf('switch (role) {');
  assert.notEqual(start, -1, 'runMock still dispatches on `switch (role)`');
  const end = src.indexOf('default:', start);
  assert.notEqual(end, -1, 'the switch still has a default arm');
  const named = { MOCK_ROLE_CLARIFY, MOCK_ROLE_DECOMPOSER };
  const roles = [...src.slice(start, end).matchAll(/^\s*case\s+(?:'([^']+)'|([A-Za-z_][A-Za-z0-9_]*)):/gm)]
    .map(([, literal, ident]) => {
      if (literal !== undefined) return literal;
      assert.ok(ident in named, `case ${ident}: names a constant this audit does not know`);
      return named[ident];
    });
  assert.ok(roles.length > 0, 'the switch has case arms');
  return new Set(roles);
}

test('MOCK_WRITER_ROLES is exactly the writer switch case set', () => {
  assert.deepEqual([...writerSwitchRoles()].sort(), [...MOCK_WRITER_ROLES].sort(),
    'the export and the switch it mirrors must not drift');
});

test('the 12 builtins pin roles the switch already handles — no new case strings', () => {
  const pinned = {};
  for (const file of readdirSync(AGENTS_DIR).filter((f) => f.endsWith('.meta.json'))) {
    const meta = JSON.parse(readFileSync(join(AGENTS_DIR, file), 'utf8'));
    pinned[meta.key] = meta.mockRole ?? null;
  }
  assert.equal(Object.keys(pinned).length, 12, 'the 12 builtin sidecars');
  for (const [key, role] of Object.entries(pinned)) {
    assert.notEqual(role, null, `${key} pins an explicit mockRole`);
    assert.ok(MOCK_WRITER_ROLES.has(role), `${key} -> ${role} is a handled writer role`);
  }
  // Nothing in the switch is orphaned either: what the builtins do not claim is
  // exactly the three roles no sidecar can pin.
  const unclaimed = [...MOCK_WRITER_ROLES].filter((r) => !Object.values(pinned).includes(r));
  assert.deepEqual(unclaimed.sort(), ['agent-gen', 'generic-producer', 'generic-verifier'],
    'the switch carries no case the chain can never reach');
});

test('memoryDirsFromPrompt: reads the scope dirs out of a REAL memory index block, and nothing else', () => {
  const { text } = renderMemoryIndex([
    { label: 'Global', dir: '/abs/m/global', entries: [{ name: 'testing', description: 'How tests run', paths: [] }] },
    { label: 'Project My App', dir: '/abs/m/project', entries: [] },
  ]);
  const sys = `TOOLS\n\n${text.trim()}\n\nYou are the agent.\nGlobal — /not/in/the/block:\n`;
  assert.deepEqual(memoryDirsFromPrompt(sys), ['/abs/m/global', '/abs/m/project'], 'the block is contiguous; the blank line ends it');
  assert.deepEqual(memoryDirsFromPrompt('no block here'), []);
  assert.deepEqual(memoryDirsFromPrompt(`## Worca memory\nintro\nGlobal — C:\\Users\\me\\.worca-cc\\p\\memory\\global:\n- (nothing yet)\n`), ['C:\\Users\\me\\.worca-cc\\p\\memory\\global'], 'a Windows dir keeps its drive colon');
  // The label is the model's project NAME: it may contain the separator itself. The renderer's
  // separator is the LAST one on the line, so the label pattern must be greedy.
  const { text: odd } = renderMemoryIndex([{ label: 'Project My — App', dir: '/abs/m/project', entries: [] }]);
  assert.deepEqual(memoryDirsFromPrompt(`TOOLS\n\n${odd.trim()}\n`), ['/abs/m/project'], 'a project name containing the separator keeps the whole dir');
});

test('memory-defrag mock: merges the first two files of the FIRST scope dir named by the system prompt and writes the report', async () => {
  const mount = mkdtempSync(join(tmpdir(), 'worca-mock-mem-'));
  const out = join(mount, 'defrag-report.md');
  const dir = join(mount, 'global');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'a.md'), '---\nname: a\ndescription: A\n---\nRule A.\n');
  writeFileSync(join(dir, 'b.md'), '---\nname: b\ndescription: B\n---\nRule B.\n');
  writeFileSync(join(dir, 'c.md'), 'Rule C.\n');
  const { text: index } = renderMemoryIndex([{ label: 'Global', dir, entries: [] }]);
  const events = [];
  const res = await runClaude({ cwd: mount, mock: true, permissionMode: 'acceptEdits', systemPrompt: `TOOLS\n\n${index}`, onEvent: (e) => events.push(e),
    prompt: `Defragment.\n\nMOCK_ROLE: memory-defrag\nMOCK_OUT: ${out}` });
  assert.ok(res && !res.error, JSON.stringify(res));
  assert.deepEqual(readdirSync(dir).sort(), ['a.md', 'b.md', 'c.md'], 'the file stays on disk — the memory tool set has no unlink');
  assert.equal(readFileSync(join(dir, 'b.md'), 'utf8'), '', 'b was EMPTIED: amendment B19, worca deletes it at sync-back');
  const a = readFileSync(join(dir, 'a.md'), 'utf8');
  assert.ok(a.startsWith('---\nname: a\n'), 'the surviving file keeps its own frontmatter');
  assert.ok(a.includes('## Merged from b') && a.includes('Rule B.') && !a.includes('name: b'), 'the merged body is appended without its fence');
  const report = readFileSync(out, 'utf8');
  assert.ok(report.startsWith('# Memory defragment report'), report);
  assert.ok(report.includes('merged b.md into a.md'), report);
  rmSync(mount, { recursive: true, force: true });
});

test('memory-defrag mock: the "nothing to merge" boundary is ONE file — two files still merge; a dir named *.md is never read', async () => {
  const defrag = async (files) => {
    const mount = mkdtempSync(join(tmpdir(), 'worca-mock-mem1-'));
    const out = join(mount, 'defrag-report.md');
    const dir = join(mount, 'global');
    mkdirSync(dir, { recursive: true });
    for (const [name, text] of Object.entries(files)) writeFileSync(join(dir, name), text);
    mkdirSync(join(dir, 'notes.md'), { recursive: true });        // a DIRECTORY named like a file: never read
    const { text: index } = renderMemoryIndex([{ label: 'Global', dir, entries: [] }]);
    const res = await runClaude({ cwd: mount, mock: true, permissionMode: 'acceptEdits', systemPrompt: `TOOLS\n\n${index}`,
      prompt: `Defragment.\n\nMOCK_ROLE: memory-defrag\nMOCK_OUT: ${out}` });
    assert.ok(res && !res.error, JSON.stringify(res));
    const report = readFileSync(out, 'utf8');
    const after = Object.fromEntries(readdirSync(dir).filter((n) => n.endsWith('.md') && n !== 'notes.md').map((n) => [n, readFileSync(join(dir, n), 'utf8')]));
    rmSync(mount, { recursive: true, force: true });
    return { report, after };
  };
  const one = await defrag({ 'only.md': '---\nname: only\ndescription: O\n---\nRule.\n' });
  assert.ok(one.report.includes('1 file(s), nothing to merge'), one.report);
  assert.deepEqual(one.after, { 'only.md': '---\nname: only\ndescription: O\n---\nRule.\n' }, 'untouched');
  const two = await defrag({ 'a.md': '---\nname: a\n---\nRule A.\n', 'b.md': '---\nname: b\n---\nRule B.\n' });
  assert.ok(two.report.includes('merged b.md into a.md'), two.report);
  assert.equal(two.after['b.md'], '', 'exactly two files is still a merge, not "nothing to merge"');
  assert.ok(two.after['a.md'].includes('Rule B.'));
});

// ── 2. behavioural audit: whole graphs, offline ──────────────────────────────

const GRAPHS = [...SEED_TEMPLATES, GRAPH_DEFAULT_WORKFLOW];

/** Seeds whose graph cannot reach End under the mock BY DESIGN: `wf_no-clarify`
 *  leaves webui.review unwired (its v1 row had no webui feedback), the webui mock
 *  blocks at ordinal 1, so the run quiesces with the §3 warning. */
const QUIESCENT = new Set(['wf_no-clarify']);

const clarifyAnswer = (a) => (a.kind === 'gate'
  ? 'continue'
  : { answers: (a.questions || []).map((q) => ({ id: q.id, choice: (q.options || ['ok'])[0] })) });

for (const tpl of GRAPHS) {
  test(`${tpl.id} completes offline${QUIESCENT.has(tpl.id) ? ' (quiesces by design)' : ' and reaches its End card'}`, { timeout: 120000 }, async () => {
    const r = await runGraphOffline({
      template: tpl, portsFn, registry: REGISTRY,
      projectDir: tmp('worca-mockgraph-proj-'), pipelineDir: tmp('worca-mockgraph-pipe-'),
      answer: clarifyAnswer,
    });
    assert.equal(r.result, 'done', `${tpl.id}: the run resolves done`);
    if (QUIESCENT.has(tpl.id)) {
      assert.equal(r.state.endReached, false, `${tpl.id}: webui blocks once and has no loop wire`);
      assert.equal(r.state.result, null);
      // wf_no-clarify's n_webui.review is deliberately unwired (v1 parity, user
      // decision — the seed stays single-loop). MIN-58: the run now SAYS so instead
      // of leaving "End not reached" unexplained.
      assert.deepEqual(r.state.warnings,
        [QUIESCENCE_WARNING, quiescenceDeadEnd(['n_webui.review'])]);
    } else {
      assert.equal(r.state.endReached, true, `${tpl.id}: a token reached End`);
      assert.ok(r.state.result, `${tpl.id}: the End card carries a result`);
      assert.deepEqual(r.state.warnings, [], `${tpl.id}: no quiescence warning`);
    }
    // Every loop closed at ordinal 2 (the verifier mocks' `cycle <= 1` gate), so no
    // wire ever hit its budget and no gate was ever raised.
    assert.equal(r.events.some((e) => e.name === 'gate'), false, `${tpl.id}: no gate was needed`);
    for (const [wireId, n] of Object.entries(r.state.wireDeliveries)) {
      assert.ok(n <= 1, `${tpl.id}: ${wireId} delivered ${n} times (loops close at ordinal 2)`);
    }
    // No flow card ever spawned a runner.
    const flowExecs = r.events.filter((e) => e.name === 'exec' && e.agentKey === null && e.status === 'done');
    assert.ok(flowExecs.length > 0, `${tpl.id}: flow cards executed`);
    // Every agent row ended `done` — the mock never pauses or errors.
    assert.ok(r.events.filter((e) => e.name === 'exec' && e.status === 'error').length === 0, `${tpl.id}: no error rows`);
  });
}

test('an ALL-CUSTOM graph completes offline through the generic chain alone', { timeout: 60000 }, async () => {
  const CUSTOM = {
    asker: {
      displayName: 'Asker', runnerType: 'clarifier', promptHints: '',
      inputs: [{ id: 'task', type: 'md', required: true }],
      outputs: [{ id: 'answers', type: 'json', when: 'always', filename: 'asker.json', store: 'run' }],
    },
    maker: {
      displayName: 'Maker', runnerType: 'producer', promptHints: '', fanOut: false,
      inputs: [{ id: 'task', type: 'md', required: true }, { id: 'answers', type: 'json', as: 'answers' }],
      outputs: [{ id: 'plan', type: 'md', when: 'always', filename: 'maker-plan-c{cycle}.md', store: 'run' }],
    },
    splitter: {
      displayName: 'Splitter', runnerType: 'producer', promptHints: '',
      inputs: [{ id: 'plan', type: 'md', required: true }],
      outputs: [{ id: 'tasks', type: 'json', when: 'always', filename: 'splitter.json', store: 'run' }],
    },
    worker: {
      displayName: 'Worker', runnerType: 'producer', sideEffect: 'code', promptHints: '',
      inputs: [
        { id: 'fix', type: 'md', loop: true, as: 'fix-review', directive: 'Fix it.' },
        { id: 'task', type: 'json', expands: true, directive: 'Do the slice.' },
        { id: 'plan', type: 'md', required: true, directive: 'Build it.' },
      ],
      outputs: [{ id: 'done', type: 'void', when: 'always' }],
    },
    checker: {
      displayName: 'Checker', runnerType: 'verifier', promptHints: '',
      inputs: [{ id: 'plan', type: 'md', required: true }, { id: 'done', type: 'void', as: 'worktree' }],
      outputs: [
        { id: 'review', type: 'md', when: 'blocking', filename: 'checker-review-cycle{cycle}.md', store: 'run' },
        { id: 'pass', type: 'void', when: 'clean' },
      ],
      verdict: { filename: 'checker-review-cycle{cycle}.json' },
    },
  };
  const customPorts = (n) => (n.kind === 'agent'
    ? {
      ...CUSTOM[n.key],
      inputs: [...(CUSTOM[n.key]?.inputs || []).map((p) => ({ ...p })), { ...AWAIT_PORT }],
      outputs: (CUSTOM[n.key]?.outputs || []).map((p) => ({ ...p })),
    }
    : flowPorts(n));
  const W = (id, from, to, config) => ({
    id,
    from: { node: from.split('.')[0], port: from.split('.')[1] },
    to: { node: to.split('.')[0], port: to.split('.')[1] },
    ...(config ? { config } : null),
  });
  const tpl = {
    id: 'wf_custom', name: 'All custom', version: 2, domain: 'coding',
    nodes: [
      { id: 'n_task', kind: 'task', x: 0, y: 0, config: {} },
      { id: 'n_ask', kind: 'agent', key: 'asker', x: 0, y: 0, config: {} },
      { id: 'n_make', kind: 'agent', key: 'maker', x: 0, y: 0, config: {} },
      { id: 'n_split', kind: 'agent', key: 'splitter', x: 0, y: 0, config: {} },
      { id: 'n_work', kind: 'agent', key: 'worker', x: 0, y: 0, config: {} },
      { id: 'n_check', kind: 'agent', key: 'checker', x: 0, y: 0, config: {} },
      { id: 'n_end', kind: 'end', x: 0, y: 0, config: {} },
    ],
    wires: [
      W('w1', 'n_task.task', 'n_ask.task'), W('w2', 'n_task.task', 'n_make.task'),
      W('w3', 'n_ask.answers', 'n_make.answers'), W('w4', 'n_make.plan', 'n_split.plan'),
      W('w5', 'n_make.plan', 'n_work.plan'), W('w6', 'n_make.plan', 'n_check.plan'),
      W('w7', 'n_split.tasks', 'n_work.task'), W('w8', 'n_work.done', 'n_check.done'),
      W('w9', 'n_check.review', 'n_work.fix', { maxCycles: 3 }),
      W('w10', 'n_check.pass', 'n_end.result'),
    ],
  };
  const r = await runGraphOffline({
    template: tpl, portsFn: customPorts, registry: CUSTOM,
    projectDir: tmp('worca-custom-proj-'), pipelineDir: tmp('worca-custom-pipe-'),
    answer: clarifyAnswer,
  });
  assert.equal(r.result, 'done');
  assert.equal(r.state.endReached, true);
  assert.equal(r.calls.filter((c) => c.nodeId === 'n_check').length, 2, 'the loop closed at ordinal 2');
  assert.ok(r.calls.some((c) => c.composite === 'expand'), 'the expands consumer fanned out');
  assert.ok(r.calls.some((c) => c.nodeId === 'n_work' && c.composite === 'finish'), 'and finished once');
  assert.ok(r.execSeq.some((s) => s.startsWith('n_end')), 'End executed');
});

// ── 3. the verdict half of the chain: what a mock that writes NO verdict costs ──
// A verifier that exits 0 without writing its JSON is indistinguishable from an
// approval, and on every shipped seed the clean side is wired straight to End.
// Parity keeps it a pass; MAJ-10 makes it a LOUD one — the warning rides the
// execution result and the scheduler folds it into state.warnings + the run log.
test('a verifier whose mock writes no verdict passes, but the run warns and names it', { timeout: 60000 }, async () => {
  const SILENT = {
    maker: {
      displayName: 'Maker', runnerType: 'producer', promptHints: '',
      inputs: [{ id: 'task', type: 'md', required: true }],
      outputs: [{ id: 'plan', type: 'md', when: 'always', filename: 'maker-plan.md', store: 'run' }],
    },
    // Declares a verdict, but its mock role is a PRODUCER: the offline writer emits
    // the md and never the JSON — the exact shape of a verifier that ran out of
    // context before writing its review file.
    silent: {
      displayName: 'Silent', runnerType: 'verifier', promptHints: '', mockRole: 'generic-producer',
      inputs: [{ id: 'plan', type: 'md', required: true }],
      outputs: [{ id: 'review', type: 'md', when: 'blocking', filename: 'silent-c{cycle}.md', store: 'run' },
        { id: 'pass', type: 'void', when: 'clean' }],
      verdict: { filename: 'silent-verdict-c{cycle}.json' },
    },
  };
  const silentPorts = (n) => (n.kind === 'agent'
    ? {
      ...SILENT[n.key],
      inputs: [...(SILENT[n.key]?.inputs || []).map((p) => ({ ...p })), { ...AWAIT_PORT }],
      outputs: (SILENT[n.key]?.outputs || []).map((p) => ({ ...p })),
    }
    : flowPorts(n));
  const tpl = {
    id: 'wf_silent', name: 'Silent verifier', version: 2, domain: 'coding',
    nodes: [
      { id: 'n_task', kind: 'task', x: 0, y: 0, config: {} },
      { id: 'n_make', kind: 'agent', key: 'maker', x: 0, y: 0, config: {} },
      { id: 'n_sil', kind: 'agent', key: 'silent', x: 0, y: 0, config: {} },
      { id: 'n_end', kind: 'end', x: 0, y: 0, config: {} },
    ],
    wires: [
      { id: 'w1', from: { node: 'n_task', port: 'task' }, to: { node: 'n_make', port: 'task' } },
      { id: 'w2', from: { node: 'n_make', port: 'plan' }, to: { node: 'n_sil', port: 'plan' } },
      { id: 'w3', from: { node: 'n_sil', port: 'pass' }, to: { node: 'n_end', port: 'result' } },
    ],
  };
  const r = await runGraphOffline({
    template: tpl, portsFn: silentPorts, registry: SILENT,
    projectDir: tmp('worca-silent-proj-'), pipelineDir: tmp('worca-silent-pipe-'),
  });
  assert.equal(r.result, 'done');
  assert.equal(r.state.endReached, true, 'the CLEAN side still fires — v1 parity');
  assert.deepEqual(r.state.warnings, ['verdict file missing: n_sil silent-verdict-c1.json — treated as clean']);
});
