// test/ask-script-tools.test.mjs
// The four script tools (scripts-workbench-design.md §9.1, W19/W20): registration under the
// toggle, the schemas, paging, the pinned-project rule, redaction, and the source scans that
// keep tools.mjs import-free and write-free. Fake bundle only — no store, no bench, no claude.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createAskTools } from '../src/core/ask/tools.mjs';
import { ASK_LIMITS } from '../src/core/ask/limits.mjs';
import { redactAskText } from '../src/core/ask/redact.mjs';

const SECRET = 'ghp_abcdefghijklmnopqrstuvwxyz0123456789';
const RESULT = {
  status: 'blocking', exitCode: 1, runtime: 'shell', durationMs: 4200, summary: `3 failing ${SECRET}`,
  warnings: [], fired: ['log', 'fail'],
  outputs: { log: { type: 'md', bytes: 20, text: `token ${SECRET}`, truncated: false }, pass: { type: 'void' } },
  verdict: { summary: 'suite red', issues: [{ severity: 'major', title: '3 tests failed', detail: `see ${SECRET}`, location: '' }], issueCount: 1 },
  expect: null, error: null, draft: false, log: { text: `npm test ${SECRET}`, lines: 1, truncated: false },
};

function fakeTools({ enabled = true, scripts = true, pin = null, over = {} } = {}) {
  const saves = [];
  const tests = [];
  const bundle = scripts ? {
    enabled,
    list: async () => [{ key: 'runTests', displayName: 'Run tests', description: `Runs the suite ${SECRET}`, origin: 'user', runtime: 'shell', portLine: 'in: -, out: log, fail', caseCount: 2, writable: true }],
    read: async (key) => (key === 'runTests' ? {
      key, origin: 'user', runtime: 'shell', writable: true,
      meta: { key, metaVersion: 2, displayName: 'Run tests', description: `Runs the suite ${SECRET}`, runtime: 'shell',
        params: [{ id: 'cmd', type: 'command', default: `curl -H 'Authorization: ${SECRET}'` }] },
      source: `line1 ${SECRET}\nline2\nline3\n`, sourceWin32: null, sourceTruncated: false,
      cases: [{ id: 'c1', name: 'red', inputs: { plan: { text: `plan ${SECRET}` } } }], userCases: [{ id: 'u1', name: 'mine', inputs: { plan: { text: `mine ${SECRET}` } } }],
    } : null),
    save: async (input) => { saves.push(input); return { ok: true, key: input.key, created: true, path: '/h/.worca-cc/scripts/runTests.sh', link: `#scripts/${input.key}` }; },
    test: async (input) => { tests.push(input); return { ok: true, result: RESULT }; },
    ...over,
  } : null;
  const deps = {
    buildCatalog: async () => ({ projects: [], workspaces: [], workflows: [] }),
    validateProposal: async () => ({ ok: true, card: {} }),
    pinnedScope: () => pin, redact: redactAskText, limits: ASK_LIMITS,
    ...(bundle ? { scripts: bundle } : {}),
  };
  return { tools: createAskTools(deps), saves, tests };
}

const SCRIPT_TOOLS = ['list_scripts', 'get_script', 'save_script', 'test_script'];
// redactAskText keeps a token's prefix (`ghp_<redacted>`): the pin is that the VALUE is gone.
const noSecret = (s, msg = 'every string the model reads is redacted') => assert.equal(String(s).includes(SECRET), false, msg);

test('registration: all four with the toggle on, the two readers only with it off, none without a bundle', () => {
  const on = fakeTools().tools.list().map((d) => d.name);
  assert.deepEqual(on.slice(-4), SCRIPT_TOOLS, 'the family is appended last');
  const off = fakeTools({ enabled: false }).tools.list().map((d) => d.name);
  assert.deepEqual(off.slice(-2), ['list_scripts', 'get_script']);
  for (const n of ['save_script', 'test_script']) assert.equal(off.includes(n), false, `${n} is not registered when W20 is off`);
  const none = fakeTools({ scripts: false }).tools.list().map((d) => d.name);
  for (const n of SCRIPT_TOOLS) assert.equal(none.includes(n), false, `${n} needs a scripts bundle`);
  assert.deepEqual(none.slice(-3), ['list_task_sources', 'find_tasks', 'get_task'], 'a bundle-less list is unchanged');
});

test('schemas: JSON-Schema objects, required fields, described for a model', () => {
  const defs = fakeTools().tools.list();
  const byName = (n) => defs.find((d) => d.name === n);
  for (const n of SCRIPT_TOOLS) {
    const d = byName(n);
    assert.equal(d.inputSchema.type, 'object', n);
    assert.equal(d.inputSchema.additionalProperties, false, n);
    assert.ok(d.description.length > 120, `${n} is described for a model, not for a changelog`);
  }
  assert.equal(byName('list_scripts').inputSchema.required, undefined);
  assert.deepEqual(byName('get_script').inputSchema.required, ['key']);
  assert.deepEqual(byName('save_script').inputSchema.required, ['key', 'meta', 'source']);
  assert.deepEqual(byName('test_script').inputSchema.required, ['key']);
  assert.equal(byName('test_script').inputSchema.properties.timeoutSec.maximum, ASK_LIMITS.scriptTestMaxTimeoutSec);
  assert.equal(byName('get_script').inputSchema.properties.maxBytes.maximum, ASK_LIMITS.scriptSourceMaxBytes);
  assert.match(byName('save_script').description, /overwrite: true/);
  assert.match(byName('save_script').description, /merged over the stored meta/, 'the store merges on overwrite — the model is told');
  assert.match(byName('test_script').description, /pinned/);
  assert.match(byName('test_script').description, /exactly as saved/, 'the bench runs a case as saved — cwd/timeoutSec do not apply, and the model is told');
});

test('list_scripts / get_script: shapes, the #scripts link, paging and redaction', async () => {
  const { tools } = fakeTools();
  const list = await tools.call('list_scripts', {});
  assert.equal(list.scripts[0].key, 'runTests');
  assert.equal(list.scripts[0].link, '#scripts/runTests');
  noSecret(list.scripts[0].description, 'every string the model reads is redacted');
  const whole = await tools.call('get_script', { key: 'runTests' });
  assert.equal(whole.truncated, false);
  assert.equal(whole.writable, true);
  assert.equal(whole.link, '#scripts/runTests');
  noSecret(whole.source);
  noSecret(whole.meta.description);
  assert.equal(whole.cases[0].id, 'c1');
  assert.equal(whole.userCases[0].id, 'u1');
  // B24 goes all the way down: a param default, a case's input text, a user-layer case.
  for (const s of [JSON.stringify(whole.meta), JSON.stringify(whole.cases), JSON.stringify(whole.userCases)]) noSecret(s);
  assert.equal(whole.meta.params[0].id, 'cmd', 'keys and shapes survive the walk');
  const page = await tools.call('get_script', { key: 'runTests', maxBytes: 8 });
  assert.equal(page.truncated, true);
  assert.ok(page.nextOffset > 0);
  const rest = await tools.call('get_script', { key: 'runTests', offset: page.nextOffset });
  assert.equal(`${page.source}${rest.source}`, whole.source, 'the pages concatenate to the whole source');
  await assert.rejects(() => tools.call('get_script', {}), { name: 'AskToolError', message: 'get_script: key is required' });
  await assert.rejects(() => tools.call('get_script', { key: 'ghost' }), { name: 'AskToolError', message: 'get_script: no script "ghost" — use list_scripts' });
});

test('save_script: the input reaches the bundle unredacted; the toggle and a missing bundle refuse', async () => {
  const { tools, saves } = fakeTools();
  const meta = { displayName: 'Run tests', description: 'Runs the suite.', runtime: 'shell', inputs: [], outputs: [] };
  const out = await tools.call('save_script', { key: 'runTests', meta, source: `echo ${SECRET}\n`, overwrite: true, cases: [{ id: 'c1', name: 'red' }] });
  assert.deepEqual(out, { ok: true, key: 'runTests', created: true, path: '/h/.worca-cc/scripts/runTests.sh', link: '#scripts/runTests' });
  assert.deepEqual(saves[0], { key: 'runTests', meta, source: `echo ${SECRET}\n`, sourceWin32: null, cases: [{ id: 'c1', name: 'red' }], overwrite: true },
    'the model\'s own text is never redacted on the way in');
  const off = fakeTools({ enabled: false }).tools;
  await assert.rejects(() => off.call('save_script', { key: 'x', meta: {}, source: 'x' }),
    { name: 'AskToolError', message: 'save_script: creating and running scripts is switched off for this chat — the user turns it back on in Settings → Ask Worca' });
  const none = fakeTools({ scripts: false }).tools;
  await assert.rejects(() => none.call('list_scripts', {}), { name: 'AskToolError', message: 'list_scripts: scripts are unavailable in this session' });
});

test('test_script: cwd "project" is the PINNED project or a refusal; scratch is the default; timeoutSec clamps; the result is redacted', async () => {
  const pinned = fakeTools({ pin: { projectKey: 'worca-cc-551183d0' } });
  const ok = await pinned.tools.call('test_script', { key: 'runTests', cwd: 'project', inputs: { plan: { text: '# Plan' } }, timeoutSec: 5000 });
  assert.deepEqual(pinned.tests[0], {
    key: 'runTests', caseId: null, params: null, ports: null, inputs: { plan: { text: '# Plan' } },
    cwd: { kind: 'project', projectKey: 'worca-cc-551183d0' }, timeoutMs: ASK_LIMITS.scriptTestMaxTimeoutSec * 1000,
    pinnedProjectKey: 'worca-cc-551183d0',
  });
  assert.equal(ok.timeoutSec, ASK_LIMITS.scriptTestMaxTimeoutSec);
  assert.equal(ok.cwd, 'project');
  assert.equal(ok.link, '#scripts/runTests');
  assert.equal(ok.result.status, 'blocking');
  for (const s of [ok.result.summary, ok.result.log.text, ok.result.outputs.log.text, JSON.stringify(ok.result)]) noSecret(s);
  assert.equal(ok.result.verdict.issues[0].title, '3 tests failed', 'issues stay objects — redacted in place, not stringified');
  assert.equal(ok.result.verdict.issueCount, 1);
  assert.deepEqual(ok.result.outputs.pass, { type: 'void' });

  const scratch = fakeTools();
  await scratch.tools.call('test_script', { key: 'runTests', caseId: 'c1' });
  assert.deepEqual(scratch.tests[0].cwd, { kind: 'scratch' }, 'no cwd = the bench\'s own folder');
  assert.equal(scratch.tests[0].caseId, 'c1');
  assert.equal(scratch.tests[0].timeoutMs, ASK_LIMITS.scriptTestDefaultTimeoutSec * 1000);
  assert.equal(scratch.tests[0].pinnedProjectKey, null, 'no pin travels as null');
  const floor = fakeTools();
  await floor.tools.call('test_script', { key: 'runTests', timeoutSec: 0 });
  assert.equal(floor.tests[0].timeoutMs, 1000, 'timeoutSec floors at 1 = the engine\'s MIN_TIMEOUT_MS');

  const unpinned = fakeTools();
  assert.deepEqual(await unpinned.tools.call('test_script', { key: 'runTests', cwd: 'project' }),
    { ok: false, errors: ['cwd "project" needs a project pinned for this chat — ask the user to pin one, or leave cwd out to run in a scratch folder'] });
  assert.equal(unpinned.tests.length, 0, 'a refused cwd never reaches the bench');
  const ws = fakeTools({ pin: { workspaceId: 'wks-team-0000abcd' } });
  assert.deepEqual(await ws.tools.call('test_script', { key: 'runTests', cwd: 'project' }),
    { ok: false, errors: ['the scope pinned for this chat is a workspace — pin a project to run a script in a checkout, or leave cwd out to run in a scratch folder'] });
  assert.deepEqual(await fakeTools().tools.call('test_script', { key: 'runTests', cwd: '/etc' }),
    { ok: false, errors: ['cwd must be "scratch" or "project"'] });
  const refused = fakeTools({ over: { test: async () => ({ ok: false, errors: ['script not found: ghost'] }) } });
  assert.deepEqual(await refused.tools.call('test_script', { key: 'ghost' }),
    { ok: false, errors: ['script not found: ghost'] }, 'the bench\'s own sentence reaches the model unchanged');
});

test('source scans: tools.mjs stays import-free and write-free; script-deps.mjs is the ONE Ask module that imports the store and the bench', () => {
  const tools = readFileSync(new URL('../src/core/ask/tools.mjs', import.meta.url), 'utf8');
  assert.doesNotMatch(tools, /^import /m, 'tools.mjs imports nothing');
  assert.doesNotMatch(tools, /\b(INSERT|UPDATE|DELETE)\b/);
  assert.doesNotMatch(tools, /script-store|script-bench/, 'the store and the bench are reachable only through deps.scripts');
  const deps = readFileSync(new URL('../src/core/ask/script-deps.mjs', import.meta.url), 'utf8');
  assert.match(deps, /from '\.\.\/script-store\.mjs'/);
  assert.match(deps, /from '\.\.\/script-bench\.mjs'/);
  assert.doesNotMatch(deps, /from 'node:fs/, 'no direct fs — the store owns every write');
  const toolDeps = readFileSync(new URL('../src/core/ask/tool-deps.mjs', import.meta.url), 'utf8');
  assert.doesNotMatch(toolDeps, /script-store|script-bench/, 'tool-deps stays read-only');
});

test('source scan: the MCP child spreads the script bundle, and the turn forwards the write poke', () => {
  const stdio = readFileSync(new URL('../src/core/ask/mcp-stdio.mjs', import.meta.url), 'utf8');
  assert.match(stdio, /createAskTools\(\{[\s\S]*?defaultScriptDeps\(\{ threadId, signal: life\.signal \}\)/, 'the child spreads the script bundle in, with the life signal');
  const turn = readFileSync(new URL('../src/core/ask/turn.mjs', import.meta.url), 'utf8');
  assert.match(turn, /onScriptMutation: deps\.onScriptMutation \?\? \(\(\) => \{\}\)/);
  assert.match(turn, /onScriptMutation: \(e\) => \{ try \{ this\.deps\.onScriptMutation\(e\); \}/);
  const server = readFileSync(new URL('../ui/server.mjs', import.meta.url), 'utf8');
  assert.match(server, /onScriptMutation: \(\) => \{ emitChanged\('scripts-changed', 'updated'\); \}/, 'a chat write reaches an open Scripts tab');
});

test('docs: guardrails.md carries the four tools, the toggle and the accepted risk (spec §9.4)', () => {
  const doc = readFileSync(new URL('../docs/guardrails.md', import.meta.url), 'utf8');
  for (const s of ['list_scripts', 'get_script', 'save_script', 'test_script', 'Create and run scripts',
    'overwrite: true', 'ask:<threadId>', 'no sandbox']) {
    assert.ok(doc.includes(s), `docs/guardrails.md states: ${s}`);
  }
  assert.match(doc, /Settings → Ask Worca/, 'the reader is told where the switch is');
  assert.equal(doc.includes('worca-cc scripts'), false);
  // The accepted risk is documentation, never UI copy (the standing no-prose rule).
  const html = readFileSync(new URL('../ui/public/index.html', import.meta.url), 'utf8');
  const view = readFileSync(new URL('../ui/public/chat-settings-view.mjs', import.meta.url), 'utf8');
  for (const src of [html, view]) assert.equal(src.includes('prompt injection'), false, 'the risk paragraph stays in the docs');
  assert.match(view, /Create and run scripts/, 'the label itself is the whole control');
});
