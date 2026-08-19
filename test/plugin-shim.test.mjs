// test/plugin-shim.test.mjs — ephemeral child shim (spec §7.2).
// Real-spawn tests install a complete fixture plugin under the temp WORCA_HOME
// (lock entry + manifest + connector) and exercise the whole load path:
// lock -> manifest -> config/secrets -> state -> spawn -> ONE stdout frame.
// `current` is a plain directory here (production makes it a symlink; the shim
// only ever path-joins through it, so both work).
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { useTempHome } from './helpers/temp-home.mjs';
import { writePluginsLock, pluginCurrentDir } from '../src/core/plugins-lock.mjs';
import { writePluginConfig, writePluginState, readPluginState } from '../src/core/plugin-config.mjs';
import { callSource, PluginOpError, setMockSourceResponses } from '../src/core/plugin-shim.mjs';

useTempHome(after);

const NAME = 'mock-echo';
const SCHEMA = [{ key: 'token', type: 'text', label: 'Token', secret: true }];

// Connector fixture: default-export factory per plugin API v1. Deliberately
// backtick-free so it embeds as a plain string.
const CONNECTOR = [
  'export default function createTaskSource(ctx) {',
  '  return {',
  '    async echoOp(args) {',
  "      return { op: 'echoOp', args, token: ctx.config.token,",
  "               cursor: await ctx.state.get('cursor'), api: ctx.apiVersion };",
  '    },',
  '    async envKeys() { return Object.keys(process.env).sort(); },',
  '    async bumpState() {',
  "      await ctx.state.set('cursor', 'page-2');",
  "      ctx.log('info', 'cursor advanced');",
  '      return { moved: true, readBack: await ctx.state.get(\'cursor\') };',
  '    },',
  "    async boom() { const e = new Error('token expired'); e.kind = 'auth'; throw e; },",
  '    async never() { return new Promise(() => {}); },',
  "    async noisy() { console.log('junk before the frame'); return { fine: true }; },",
  '  };',
  '}',
].join('\n');

function installFixture() {
  const cur = pluginCurrentDir(NAME);
  mkdirSync(join(cur, 'connector'), { recursive: true });
  writeFileSync(join(cur, 'worca-cc-plugin.json'), JSON.stringify({
    name: NAME,
    engines: { 'worca-cc-api': '>=1 <2' }, // API-1 plugin: must negotiate apiVersion 1 on an API-2 host
    taskSources: [{
      id: 'main',
      displayName: 'Mock Echo',
      module: './connector/index.mjs',
      configSchema: SCHEMA,
      inputs: [{ key: 'task', type: 'task-browser', label: 'Task' }],
    }],
  }));
  writeFileSync(join(cur, 'connector', 'index.mjs'), CONNECTOR);
  writePluginsLock({
    [NAME]: {
      repo: 'local-fixture', subdir: null, pinnedSha: 'f'.repeat(40),
      version: null, enabled: true, installedAt: '2026-07-12T00:00:00.000Z',
    },
  });
  writePluginConfig(NAME, SCHEMA, { token: 'sekret' });
  writePluginState(NAME, { cursor: 'page-1' });
}
installFixture();

const rejectsKind = (p, kind, re) => assert.rejects(p, (err) => {
  assert.ok(err instanceof PluginOpError, `expected PluginOpError, got ${err?.name}: ${err?.message}`);
  assert.equal(err.kind, kind);
  if (re) assert.match(err.message, re);
  return true;
});

test('real child round-trip: op/args echo back; config+state arrive via stdin', async () => {
  const result = await callSource({ plugin: NAME, sourceId: 'main', op: 'echoOp', args: { a: 1, s: 'x' } });
  assert.equal(result.op, 'echoOp');
  assert.deepEqual(result.args, { a: 1, s: 'x' });
  assert.equal(result.token, 'sekret', 'secret config travelled via stdin, not env/argv');
  assert.equal(result.cursor, 'page-1', 'state snapshot readable through ctx.state.get');
  assert.equal(result.api, 1, 'ctx.apiVersion negotiated down to 1 for a ">=1 <2" manifest');
});

test('connector-thrown error maps to PluginOpError with the connector kind', async () => {
  await rejectsKind(
    callSource({ plugin: NAME, sourceId: 'main', op: 'boom' }),
    'auth', /token expired/,
  );
});

test("unimplemented op yields kind 'plugin' + a 'does not implement' message", async () => {
  // Task 13's capabilities tolerant-default depends on exactly this behavior.
  await rejectsKind(
    callSource({ plugin: NAME, sourceId: 'main', op: 'capabilities' }),
    'plugin', /does not implement op "capabilities"/,
  );
});

test('timeout kills the child and rejects with kind timeout', async () => {
  const t0 = Date.now();
  await rejectsKind(
    callSource({ plugin: NAME, sourceId: 'main', op: 'never', timeoutMs: 300 }),
    'timeout', /300ms/,
  );
  assert.ok(Date.now() - t0 < 5000, 'rejected promptly after the kill, not at some default');
});

test('child env is scrubbed to PATH+HOME — no WORCA_*/npm_* leakage', async () => {
  const keys = await callSource({ plugin: NAME, sourceId: 'main', op: 'envKeys' });
  assert.ok(Array.isArray(keys) && keys.includes('PATH'), 'PATH is passed through');
  assert.ok(!keys.includes('WORCA_HOME'), 'WORCA_HOME must NOT leak (it IS set in this test process)');
  assert.ok(!keys.some((k) => k.startsWith('WORCA_') || k.startsWith('npm_')),
    `unexpected env leak: ${keys.join(',')}`);
});

test('stateDelta is applied host-side via writePluginState; logs route to the passed logger', async () => {
  const logLines = [];
  const result = await callSource({
    plugin: NAME, sourceId: 'main', op: 'bumpState',
    logger: (level, msg) => logLines.push(`${level}:${msg}`),
  });
  assert.deepEqual(result, { moved: true, readBack: 'page-2' }, 'ctx.state.get reads back its own set within the op');
  assert.deepEqual(readPluginState(NAME), { cursor: 'page-2' }, 'delta shallow-merged into data/state.json');
  assert.deepEqual(logLines, ['info:cursor advanced'], 'ctx.log lines returned in the frame and routed');
});

test('stdout is protocol-reserved: console.log junk => PluginOpError protocol', async () => {
  await rejectsKind(
    callSource({ plugin: NAME, sourceId: 'main', op: 'noisy' }),
    'protocol', /protocol-reserved/,
  );
});

test('WORCA_MOCK=1 short-circuits without spawning (plugin need not exist)', async () => {
  process.env.WORCA_MOCK = '1';
  try {
    // Built-in defaults (smoke path): 2 canned tasks, canned getTask, ok reportResult/validateConfig.
    const listed = await callSource({ plugin: 'not-installed', sourceId: 'x', op: 'listTasks' });
    assert.equal(listed.tasks.length, 2);
    const got = await callSource({ plugin: 'not-installed', sourceId: 'x', op: 'getTask', args: { id: 'T-42' } });
    assert.equal(got.id, 'T-42');
    assert.ok(typeof got.body === 'string' && got.body.length > 0);
    assert.deepEqual(await callSource({ plugin: 'x', sourceId: 'x', op: 'reportResult', args: { id: 'T-42', status: 'completed', summary: 's' } }), { ok: true });
    assert.deepEqual(await callSource({ plugin: 'x', sourceId: 'x', op: 'validateConfig' }), { ok: true });
    // Test override wins over the default…
    setMockSourceResponses({ listTasks: { tasks: [{ id: 'T-override', title: 't', state: 'open', updatedAt: 'now' }] } });
    const overridden = await callSource({ plugin: 'x', sourceId: 'x', op: 'listTasks' });
    assert.equal(overridden.tasks[0].id, 'T-override');
    // …and an op with NO canned response mirrors the real child's kind 'plugin'.
    await rejectsKind(callSource({ plugin: 'x', sourceId: 'x', op: 'capabilities' }), 'plugin');
  } finally {
    delete process.env.WORCA_MOCK;
    setMockSourceResponses(null);
  }
});
