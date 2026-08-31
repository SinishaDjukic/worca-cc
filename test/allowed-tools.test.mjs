// test/allowed-tools.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { effectiveAllowedTools } from '../src/core/phases.mjs';
import { resolveGraph, writeGraphWorkflow } from '../src/core/workflows.mjs';
import { _resetForTests } from '../src/core/db.mjs';

// Declared ONCE for the whole module — both the unit and integration tests reuse it.
const BASE = ['Read', 'Write', 'Edit', 'Bash', 'Grep', 'Glob', 'Skill'];
const WEBUI_BROWSER_TOOL = 'mcp__plugin_playwright_playwright__browser_navigate';

// ── unit: the pure helper ──────────────────────────────────────────────────────

test('union: declared MCP tools are appended to the base list', () => {
  const declared = ['Read', 'Bash', WEBUI_BROWSER_TOOL];
  const out = effectiveAllowedTools(BASE, declared);
  // Base preserved (so the agent can still Write its verdict JSON)…
  assert.ok(out.includes('Write'), 'keeps base Write');
  // …and the browser tool is granted.
  assert.ok(out.includes(WEBUI_BROWSER_TOOL), 'adds browser tool');
});

test('dedup: a tool in both base and frontmatter appears once, base order first', () => {
  const out = effectiveAllowedTools(BASE, ['Read', 'mcp__x__y']);
  assert.deepEqual(out, [...BASE, 'mcp__x__y']);
  assert.equal(out.filter((t) => t === 'Read').length, 1);
});

test('no declared tools (clarify path: ctx.node undefined) -> base unchanged', () => {
  assert.deepEqual(effectiveAllowedTools(BASE, undefined), BASE);
  assert.deepEqual(effectiveAllowedTools(BASE, []), BASE);
});

test('ignores empty / whitespace-only declared entries', () => {
  assert.deepEqual(effectiveAllowedTools(BASE, ['', '  ', 'mcp__a__b']), [...BASE, 'mcp__a__b']);
});

test('returns a fresh array; never mutates the base constant', () => {
  const before = [...BASE];
  const out = effectiveAllowedTools(BASE, ['mcp__a__b']);
  assert.notEqual(out, BASE, 'fresh array, not the same reference');
  assert.deepEqual(BASE, before, 'base constant untouched');
});

test('fanOut=true appends Task and Agent to the allow-list', () => {
  const out = effectiveAllowedTools(BASE, [], true);
  assert.ok(out.includes('Task'), 'grants Task');
  assert.ok(out.includes('Agent'), 'grants Agent');
  assert.equal(out.length, BASE.length + 2);
});

test('fanOut defaults to false: third arg omitted leaves the base unchanged', () => {
  assert.deepEqual(effectiveAllowedTools(BASE, []), BASE);
  assert.deepEqual(effectiveAllowedTools(BASE, [], false), BASE);
  const out = effectiveAllowedTools(BASE, []);
  assert.ok(!out.includes('Task') && !out.includes('Agent'));
});

test('fanOut de-dupes Task/Agent already present', () => {
  const out = effectiveAllowedTools([...BASE, 'Task'], [], true);
  assert.equal(out.filter((t) => t === 'Task').length, 1);
  assert.ok(out.includes('Agent'));
});

// ── integration: frontmatter → resolveGraph node.tools → effectiveAllowedTools ──

test('resolved manualWebUiTesting node + base union grants browser tools AND keeps Write', async () => {
  const home = await mkdtemp(join(tmpdir(), 'worca-cc-home-'));
  const proj = await mkdtemp(join(tmpdir(), 'worca-cc-proj-'));
  const prevHome = process.env.WORCA_HOME;
  process.env.WORCA_HOME = home;            // the template store lives under WORCA_HOME (lazy read)
  _resetForTests();                           // the store hits the DB workflows table; reopen at THIS home
  try {
    // Minimal registry; agentFile names resolve against the REAL repo agents/ dir
    // because resolveGraph's 4th arg defaults to DEFAULT_AGENTS_DIR.
    const REGISTRY = {
      planner: {
        key: 'planner', runnerType: 'producer', agentFile: 'worca-cc-planner.md',
        metaVersion: 2, inputs: [{ id: 'task', type: 'md' }],
        outputs: [{ id: 'plan', type: 'md', filename: '{base}.md' }],
      },
      manualWebUiTesting: {
        key: 'manualWebUiTesting', runnerType: 'verifier',
        agentFile: 'worca-cc-manual-web-ui-testing.md',
        metaVersion: 2, inputs: [{ id: 'plan', type: 'md' }],
        outputs: [{ id: 'review', type: 'md', when: 'blocking', filename: '{base}.md' }, { id: 'pass', type: 'void', when: 'clean' }],
      },
    };
    await writeGraphWorkflow({
      id: 'wf_webui', name: 'WebUI',
      nodes: [
        { id: 'n_task', kind: 'task', x: 0, y: 0, config: {} },
        { id: 'n_plan', kind: 'agent', key: 'planner', x: 240, y: 0, config: {} },
        { id: 'n_web', kind: 'agent', key: 'manualWebUiTesting', x: 480, y: 0, config: {} },
        { id: 'n_end', kind: 'end', x: 720, y: 0, config: {} },
      ],
      wires: [],
    });
    const resolved = await resolveGraph(proj, 'wf_webui', REGISTRY);   // agentsDir defaults to repo agents/
    const web = resolved.nodes.n_web;
    assert.ok(web.tools.includes(WEBUI_BROWSER_TOOL), 'frontmatter browser tool reached the node');
    // Guard against frontmatter drift: the agent declares 14 browser_* tools.
    const browserTools = web.tools.filter((t) => t.startsWith('mcp__plugin_playwright_playwright__browser_'));
    assert.equal(browserTools.length, 14, 'all 14 declared browser tools reached the node');

    const allowed = effectiveAllowedTools(BASE, web.tools);   // what runOpts now passes to runClaude
    assert.ok(allowed.includes(WEBUI_BROWSER_TOOL), 'browser tool is on the allow-list');
    assert.ok(allowed.includes('Write'), 'still allowed to write its verdict JSON');
  } finally {
    _resetForTests();                         // next file reopens clean
    if (prevHome === undefined) delete process.env.WORCA_HOME;
    else process.env.WORCA_HOME = prevHome;
    await rm(home, { recursive: true, force: true });
    await rm(proj, { recursive: true, force: true });
  }
});
