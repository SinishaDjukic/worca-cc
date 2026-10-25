// test/setup-detect.test.mjs
// GET /api/setup/detect (D18): src/core/setup/detect.mjs with injected probes (no network, no spawn),
// onboarding's detectClaude (D21), and the route (agent refusal, the probes override).
import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { join } from 'node:path';
import { useTempHome } from './helpers/temp-home.mjs';

const home = useTempHome(after);
const REAL = { HOME: process.env.HOME, USERPROFILE: process.env.USERPROFILE };
process.env.HOME = home; process.env.USERPROFILE = home;      // settings.json lives under HOME, not WORCA_HOME

const { detectSetup, DETECT_CHECKS } = await import('../src/core/setup/detect.mjs');
const { detectClaude } = await import('../src/core/onboarding.mjs');
const { CLAUDE_SIGNED_OUT_HINT } = await import('../src/core/model-test.mjs');
const { INTERNAL_KEY } = await import('../src/core/settings-errors.mjs');

const fast = (out) => async () => out;
const mockProbes = {
  claude: fast({ ready: true, bin: 'claude', hint: null, auth: 'signed-in', connected: true }),
  git: fast({ available: true, version: '2.47.0', reason: 'ok' }),
  sourceEnv: () => ({ HTTPS_PROXY: 'http://jdoe:secret@proxy.acme.example:8080', NO_PROXY: 'localhost' }),
  processEnv: () => ({}),
  direct: fast(false),
  engines: fast([{ name: 'claude', label: 'Claude Code', ready: true, reason: null }, { name: 'codex', label: 'Codex', ready: false, reason: 'not signed in' }]),
  ollama: fast({ models: 3 }),
};

test('detectClaude: the tile and the check agree', async () => {
  const r = await detectClaude({ ready: () => ({ ready: true, bin: '/usr/local/bin/claude', hint: null }),
    probe: async () => ({ state: 'signed-out', source: 'cli', detail: null }) });
  assert.deepEqual(r, { ready: true, bin: '/usr/local/bin/claude', hint: null, auth: 'signed-out', connected: false });
  const unknown = await detectClaude({ ready: () => ({ ready: true, bin: 'claude', hint: null }), probe: async () => ({ state: 'unknown' }) });
  assert.equal(unknown.connected, true, "'unknown' never un-ticks the tile");
  let probed = false;
  const missing = await detectClaude({ ready: () => ({ ready: false, bin: 'claude', hint: null }), probe: async () => { probed = true; return { state: 'signed-in' }; } });
  assert.deepEqual([missing.connected, missing.auth, probed], [false, null, false]);
});

test('AC-3.1: every check, a state and a line, under 3 s', async () => {
  const t0 = Date.now();
  const { checks } = await detectSetup({ probes: mockProbes });
  assert.ok(Date.now() - t0 < 3000);
  assert.deepEqual(checks.map((c) => c.id), DETECT_CHECKS.map((c) => c.id));
  assert.equal(checks.length, 7);
  for (const c of checks) {
    assert.ok(['ok', 'warn', 'no'].includes(c.state), c.id);
    assert.ok(c.line.length > 0, c.id);
    assert.doesNotMatch(c.line, INTERNAL_KEY, c.id);
  }
  const env = checks.find((c) => c.id === 'proxyEnv');
  assert.equal(env.state, 'ok');
  assert.equal(env.line, 'Your environment sends traffic through proxy.acme.example:8080.');
  assert.doesNotMatch(JSON.stringify(env), /secret|jdoe/);           // never echo proxy credentials
  assert.equal(checks.find((c) => c.id === 'harnesses').line, 'Ready: Claude Code. Not ready: Codex (Not signed in).');
});

test('a hung probe becomes warn and never holds the answer', async () => {
  const { checks } = await detectSetup({ probes: { ...mockProbes, git: () => new Promise(() => {}) }, budgetMs: 100 });
  assert.deepEqual(checks.find((c) => c.id === 'git'), { id: 'git', label: 'Git', state: 'warn', line: "Couldn't check this in time." });
});

test('the default budget keeps a hung probe under 3 s', async () => {
  const t0 = Date.now();
  const { checks } = await detectSetup({ probes: { ...mockProbes, direct: () => new Promise(() => {}) } });
  assert.ok(Date.now() - t0 < 3000);
  assert.equal(checks.find((c) => c.id === 'direct').state, 'warn');
});

test('a throwing probe is warn with a fixed line that echoes nothing', async () => {
  const { checks } = await detectSetup({ probes: { ...mockProbes, git: async () => { throw new Error('spawn failed http://jdoe:secret@proxy.acme.example'); } } });
  assert.deepEqual(checks.find((c) => c.id === 'git'), { id: 'git', label: 'Git', state: 'warn', line: "Couldn't check this." });
  assert.doesNotMatch(JSON.stringify(checks), /spawn failed/);
});

test('a long harness reason is cut to 80 characters in the line; facts keep it whole', async () => {
  const reason = 'x'.repeat(200);
  const { checks } = await detectSetup({ probes: { ...mockProbes, engines: fast([{ name: 'claude', label: 'Claude Code', ready: true, reason: null }, { name: 'codex', label: 'Codex', ready: false, reason }]) } });
  const h = checks.find((c) => c.id === 'harnesses');
  const shown = /\(([^)]*)\)/.exec(h.line)[1];
  assert.ok(shown.length <= 80, shown.length);
  assert.equal(h.facts.engines[1].reason, reason);
});

// Table-driven: every check's other states, one row each.
for (const [name, over, id, state, line] of [
  ['claude missing', { claude: fast({ ready: false, bin: null, hint: null }) }, 'claude', 'no', 'Claude Code was not found on this machine.'],
  ['claude signed out', { claude: fast({ ready: true, auth: 'signed-out' }) }, 'claude', 'no', CLAUDE_SIGNED_OUT_HINT],
  ['claude unknown', { claude: fast({ ready: true, auth: 'unknown' }) }, 'claude', 'warn', "Claude Code is installed. Worca couldn't tell whether it is signed in."],
  ['git missing', { git: fast({ available: false, reason: 'not-on-path' }) }, 'git', 'no', 'Git was not found on this machine.'],
  ['git probe-failed', { git: fast({ available: false, reason: 'probe-failed' }) }, 'git', 'warn', "Git didn't answer when Worca checked it."],
  ['git forced-off', { git: fast({ available: false, reason: 'forced-off' }) }, 'git', 'warn', 'Worca is set not to use Git here (WORCA_GIT=0).'],
  ['git not-probed', { git: fast({ available: false, reason: 'not-probed' }) }, 'git', 'warn', "Git hasn't been checked yet."],
  ['no proxy env', { sourceEnv: () => ({}) }, 'proxyEnv', 'no', 'No proxy is set in your environment.'],
  ['scheme-less proxy env', { sourceEnv: () => ({ HTTPS_PROXY: 'jdoe:secret@proxy.acme.example:8080' }) }, 'proxyEnv', 'ok', 'Your environment sends traffic through proxy.acme.example:8080.'],
  ['direct ok', { direct: fast(true) }, 'direct', 'ok', 'api.anthropic.com answers directly.'],
  ['no engine ready', { engines: fast([{ name: 'claude', label: 'Claude Code', ready: false, reason: null }]) }, 'harnesses', 'no', 'No coding agent is ready on this machine.'],
  ['no ollama', { ollama: fast(null) }, 'ollama', 'no', 'No Ollama is running on port 11434.'],
  // With the corporate proxy on, sourceEnv holds only the proxy variables; the key is read from the full env.
  ['api key set, proxy on', { processEnv: () => ({ ANTHROPIC_API_KEY: 'sk-ant-zzz' }) }, 'apiKey', 'ok', 'ANTHROPIC_API_KEY is set in your environment.'],
  ['api key only in sourceEnv', { sourceEnv: () => ({ ANTHROPIC_API_KEY: 'sk-ant-zzz' }) }, 'apiKey', 'no', 'ANTHROPIC_API_KEY is not set.'],
]) {
  test(`detect row: ${name}`, async () => {
    const { checks } = await detectSetup({ probes: { ...mockProbes, ...over } });
    const c = checks.find((x) => x.id === id);
    assert.deepEqual([c.state, c.line], [state, line]);
    assert.doesNotMatch(JSON.stringify(checks), /secret|sk-ant-zzz/);
  });
}

// ── the route ──
let srv, base, testing;
before(async () => {
  process.env.WORCA_MOCK = '1';
  const mod = await import('../ui/server.mjs');
  testing = mod._testing;
  srv = http.createServer(mod.app);
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${srv.address().port}`;
});
after(async () => {
  testing?.resetSetup();
  if (srv) await new Promise((r) => srv.close(r));
  delete process.env.WORCA_MOCK;
  process.env.HOME = REAL.HOME; process.env.USERPROFILE = REAL.USERPROFILE;
});
beforeEach(() => testing?.resetSetup());

test('GET /api/setup/detect answers the 7 checks from the injected probes', async () => {
  testing.setSetupProbes(mockProbes);
  const r = await fetch(`${base}/api/setup/detect`);
  assert.equal(r.status, 200);
  const body = await r.json();
  assert.deepEqual(body.checks.map((c) => c.id), DETECT_CHECKS.map((c) => c.id));
  assert.doesNotMatch(JSON.stringify(body), /secret|jdoe/);
});

test('GET /api/setup/detect refuses an agent caller', async () => {
  process.env.WORCA_AGENT_USER = 'worca-agent';
  process.env.WORCA_AGENT_HOME = join(home, 'agent');
  try {
    const r = await fetch(`${base}/api/setup/detect`);
    assert.equal(r.status, 403);
    assert.equal((await r.json()).code, 'SETUP_AGENT_BLOCKED');
  } finally { delete process.env.WORCA_AGENT_USER; delete process.env.WORCA_AGENT_HOME; }
});
