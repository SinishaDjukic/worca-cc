// test/engine-conformance.test.mjs
// The conformance suite, part 1: the process rows (plans/core-protection-layer-design.md §5) over every catalog
// entry. Each row runs the REAL adapter (through runClaude's engine dispatch) against test/fixtures/fake-engine.mjs,
// which records its argv, env, cwd and process group, starts a backgrounded grandchild and prints the engine's
// stream (test/fixtures/engines/<engine>/stream.jsonl). A new engine passes by its catalog entry, adapter and
// fixtures; a failure here is a gap in the owner (src/core/spawn.mjs, engines/index.mjs), not in the row.
import { after, beforeEach, afterEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { useTempHome } from './helpers/temp-home.mjs';
import { conformanceRow } from './helpers/conformance.mjs';
import { scratchDirs, fixture, makeEnvOpts } from './helpers/e2b-fixture.mjs';
import { runClaude } from '../src/core/claude-runner.mjs';
import { getEngine, ruleSupport, subagentPolicy, removeRunSessions } from '../src/core/engines/index.mjs';
import { superviseSpawn, argValue, sigkillGraceMs, childEnv } from '../src/core/spawn.mjs';
import { createFakeE2b } from '../src/core/exec-env/e2b-fake.mjs';
import { E2bExecEnv } from '../src/core/exec-env/e2b-env.mjs';
import { ENGINES, RULE_KINDS } from '../src/shared/engine-switch.mjs';
import { createOrchestrator } from '../src/core/orchestrator.mjs';

useTempHome(after);
const HERE = dirname(fileURLToPath(import.meta.url));
const FAKE = join(HERE, 'fixtures', 'fake-engine.mjs');
const RULES_DIR = join(HERE, 'fixtures', 'engine-rules');
const POSIX = process.platform === 'win32' ? { skip: 'POSIX process groups and shell fixtures' } : {};
const { tmp, cleanup } = scratchDirs(); after(cleanup);
const FAKE_VARS = ['FAKE_OUT', 'FAKE_STREAM', 'FAKE_HOLD', 'FAKE_GRANDCHILD', 'FAKE_EXIT'];

process.env.WORCA_SIGKILL_GRACE_MS = '200';
let saved;
beforeEach(() => { saved = { ...process.env }; delete process.env.WORCA_MOCK; });
afterEach(() => {
  for (const k of Object.keys(process.env)) if (!(k in saved)) delete process.env[k];
  Object.assign(process.env, saved);
});

const waitFor = async (cond, ms = 10000) => {
  const end = Date.now() + ms;
  while (Date.now() < end) { const v = cond(); if (v) return v; await new Promise((r) => setTimeout(r, 20)); }
  throw new Error('timed out waiting');
};
const alive = (pid) => { try { process.kill(pid, 0); return true; } catch (e) { return e.code !== 'ESRCH'; } };

/** Run `engine`'s adapter once against the fake; resolves to { rec, out, result|error }. */
async function runFake(engine, { model = ENGINES[engine].requiresExplicitModel ? 'conformance/model' : undefined, env = {}, hold = false, signal, workRoot = null, cwd = tmp('worca-conf-cwd-'), allow = [], ...opts } = {}) {
  const dir = tmp('worca-conf-');
  const out = join(dir, 'rec.json');
  Object.assign(process.env, { FAKE_OUT: out, FAKE_STREAM: join(HERE, 'fixtures', 'engines', engine, 'stream.jsonl'), ...env });
  if (hold) process.env.FAKE_HOLD = '1';
  let result = null; let error = null;
  try {
    result = await runClaude({ engine, bin: FAKE, cwd, prompt: 'P', model, signal, workRoot, envAllowlist: [...FAKE_VARS, ...allow],
      permissionMode: 'acceptEdits', ...opts });
  } catch (err) { error = err; }
  const rec = existsSync(out) ? JSON.parse(readFileSync(out, 'utf8')) : null;
  return { rec, out, result, error, cwd };
}

// ── C-ENV-EXACT ──────────────────────────────────────────────────────────────

conformanceRow('C-ENV-EXACT', 'the child gets base, catalog, sign-in and declared names only; the rest is named as dropped', async (engine) => {
  const entry = ENGINES[engine];
  const own = entry.env.names[0];
  const { rec, error } = await runFake(engine, { env: { COPILOT_ALLOW_ALL: 'true', CONF_UNLISTED_SECRET: 's3', GH_TOKEN: 'ghp_x', ...(own ? { [own]: 'v' } : {}) } });
  assert.equal(error, null, String(error?.message));
  assert.equal(rec.env.COPILOT_ALLOW_ALL, undefined, 'COPILOT_ALLOW_ALL never passes, on any engine');
  assert.equal(rec.env.CONF_UNLISTED_SECRET, undefined, 'a name no list holds');
  assert.equal(rec.env.GH_TOKEN, undefined, 'a host credential');
  if (own) assert.ok(own in rec.env, `${own}: a catalog name passes (the adapter may set its own value)`);
  const { dropped } = childEnv({ engine, base: { COPILOT_ALLOW_ALL: 'true', CONF_UNLISTED_SECRET: 's3', PATH: '/bin' } });
  assert.deepEqual(dropped, ['CONF_UNLISTED_SECRET', 'COPILOT_ALLOW_ALL'], 'dropped names the rest, by name');
  const remote = childEnv({ engine, remote: true, base: { COPILOT_ALLOW_ALL: 'true', LANG: 'C' } });
  assert.equal(remote.env.COPILOT_ALLOW_ALL, undefined, 'the sandbox path gives the same answer');
  assert.equal(remote.env.LANG, 'C');
}, POSIX);

// ── chat spawns: decision 3 holds for Chat too (ask/spawn.mjs; every engine's chat runs through its adapter) ──────────

// A chat's model where the engine's chat needs one that names its provider; else the CLI's own default.
const CHAT_MODEL = { goose: 'anthropic/claude-sonnet-5', opencode: 'anthropic/claude-sonnet-5' };
const chatOn = (engine) => !!ENGINES[engine].chat && ENGINES[engine].chat.verified !== false;
// Chat engines whose chat spawn moves onto the catalog in that engine's own commit (Goose: its MCP servers' env
// moves to a file beside the wrapper): the chat rows wait for it.
const CHAT_PENDING = new Set(['goose']);
/** A chat turn's MCP config: worca's own server, its token and a set's secret by reference (ask/spawn.mjs buildMcpConfig). */
function chatMcpConfig() {
  const file = join(tmp('worca-conf-chat-mcp-'), 'mcp.json');
  writeFileSync(file, JSON.stringify({ mcpServers: { worca: { command: process.execPath, args: ['-e', ''],
    env: { ASK_COMMAND_TOKEN: '${ASK_COMMAND_TOKEN}', CONF_SET_SECRET: '${MCPSECRET_CONF}' } } } }));
  return file;
}
/** One chat spawn of `engine` against the fake, as ask/spawn.mjs builds it: Claude's chat spawn, else the adapter's
 *  locked-down one (askLockdown, read-only). `allow` is the turn's envAllowlist. */
function runChatFake(engine, { env = {}, spawnEnv = {}, allow = [] } = {}) {
  return runFake(engine, { env, model: CHAT_MODEL[engine], allow, mcpConfigPath: chatMcpConfig(), spawnEnv, envScrub: true,
    ...(engine === 'claude' ? {} : { askLockdown: true, sandbox: 'read-only', chatHome: tmp('worca-conf-chat-home-') }) });
}

conformanceRow('C-ENV-EXACT (chat)', "a chat turn's spawn gets exact names only: no unlisted name, no host credential", async (engine, t) => {
  if (!chatOn(engine)) { t.skip('Chat is off on this engine (catalog chat.verified false)'); return; }
  if (CHAT_PENDING.has(engine)) { t.skip('pending: this engine\'s chat moves onto the catalog in its own commit'); return; }
  const { rec, error } = await runChatFake(engine, { env: { COPILOT_ALLOW_ALL: 'true', CONF_UNLISTED_SECRET: 's3', GH_TOKEN: 'ghp_x' },
    spawnEnv: { ASK_COMMAND_TOKEN: 'tok-9', MCPSECRET_CONF: 'm9f3a' } });
  assert.equal(error, null, String(error?.message));
  assert.ok(rec, 'the CLI ran');
  assert.equal(rec.env.COPILOT_ALLOW_ALL, undefined, 'COPILOT_ALLOW_ALL never passes, on any engine');
  assert.equal(rec.env.CONF_UNLISTED_SECRET, undefined, 'a name no list holds');
  assert.equal(rec.env.GH_TOKEN, undefined, 'a host credential');
  // A set's secret reaches the chat only under a name its spawn declares (the run env's, or the server's own env key that
  // codex copies into its env; goose keeps it in a file beside its wrapper), never under another name.
  for (const [k, v] of Object.entries(rec.env)) if (v === 'm9f3a') assert.ok(['MCPSECRET_CONF', 'CONF_SET_SECRET'].includes(k), `${k} holds the set's secret`);
}, POSIX);

// ── C-CEILING ────────────────────────────────────────────────────────────────

conformanceRow('C-CEILING', "the child's git never walks above the run's work root; PWD is its cwd", async (engine) => {
  const root = tmp('worca-conf-root-');
  const work = join(root, 'work'); mkdirSync(work);
  const { rec, error } = await runFake(engine, { cwd: work, workRoot: work });
  assert.equal(error, null, String(error?.message));
  assert.equal(rec.env.GIT_CEILING_DIRECTORIES.split(':')[0], root);
  assert.equal(rec.env.PWD, work);
}, POSIX);

// ── C-ARGV ───────────────────────────────────────────────────────────────────

conformanceRow('C-ARGV', 'a model that reads as a flag is refused before anything spawns', async (engine) => {
  const { rec, error } = await runFake(engine, { model: '-oProxyCommand=x' });
  assert.equal(rec, null, 'the fake never ran');
  assert.equal(error?.errorClass, 'config', String(error?.message));
  assert.throws(() => argValue('', 'model'), { errorClass: 'config' });
  assert.throws(() => argValue('--upload-pack=x', 'branch'), { errorClass: 'config' });
}, POSIX);

// ── C-GROUPKILL ──────────────────────────────────────────────────────────────

conformanceRow('C-GROUPKILL', 'a stop kills the engine and its backgrounded grandchild', async (engine) => {
  const ac = new AbortController();
  const p = runFake(engine, { hold: true, signal: ac.signal });
  const out = await waitFor(() => process.env.FAKE_OUT);
  const gp = await waitFor(() => { try { return Number(readFileSync(`${out}.grand`, 'utf8').trim()) || null; } catch { return null; } });
  const rec = JSON.parse(readFileSync(out, 'utf8'));
  assert.equal(rec.pgid, rec.pid, 'the engine leads its own process group');
  ac.abort();
  const { error } = await p;
  assert.equal(error?.name, 'AbortError');
  await waitFor(() => !alive(gp), sigkillGraceMs() + 1000);
}, POSIX);

test('C-GROUPKILL (sandbox): a stopped step\'s grandchild dies; the sandbox and its relay live on', POSIX, async () => {
  const f = fixture(tmp);
  const sdk = createFakeE2b({ root: tmp('worca-conf-e2b-'), onCommand: (cmd) => (/^command -v /.test(cmd) ? { lines: ['/usr/local/bin/x'] } : null) });
  const env = new E2bExecEnv(makeEnvOpts(tmp, sdk, f));
  await env.start();
  try {
    const out = env.sb(join(f.repo, 'rec.json'));
    const ac = new AbortController();
    const p = superviseSpawn({ file: process.execPath, args: [FAKE], displayBin: 'fake', cwd: f.repo, env: { FAKE_OUT: out, FAKE_HOLD: '1' }, stdin: null,
      signal: ac.signal, asAgent: false, stagedDir: null, cleanup: () => {}, onEvent: () => {}, onStdoutLine: () => {}, stdoutErrorDetail: () => '',
      classify: () => null, spawnError: (e) => e, onDone: (code) => ({ exitCode: code }), execEnv: env });
    const gp = await waitFor(() => { try { return Number(readFileSync(`${out}.grand`, 'utf8').trim()) || null; } catch { return null; } });
    ac.abort();
    await assert.rejects(p, (e) => e.name === 'AbortError');
    await waitFor(() => !alive(gp), sigkillGraceMs() + 1000);
    assert.equal(env.lost, null);
    assert.equal(env.relay.alive, true);
  } finally { await env.close('test'); }
});

// ── C-PREFLIGHT-ENV ──────────────────────────────────────────────────────────

conformanceRow('C-PREFLIGHT-ENV', 'the run-start check sees what the run sees', async (engine) => {
  const adapter = getEngine(engine);
  if (typeof adapter.preflight !== 'function') return;   // claude: preflight.mjs probes run under the same childEnv (engine 'claude')
  const pre = join(tmp('worca-conf-pre-'), 'pre.json');
  process.env.CONF_UNLISTED_SECRET = 's3';
  process.env.FAKE_OUT = pre; process.env.FAKE_GRANDCHILD = '0';
  await adapter.preflight({ bin: FAKE, envAllowlist: FAKE_VARS });
  const a = JSON.parse(readFileSync(pre, 'utf8')).env;
  const { rec } = await runFake(engine, { env: { FAKE_GRANDCHILD: '0' } });
  assert.equal(a.CONF_UNLISTED_SECRET, undefined);
  // The run adds its own per-spawn keys (cwd, host pid, the engine's home and settings); the check sees no other
  // name, and every name it sees has the run's value.
  for (const [k, v] of Object.entries(a)) if (!['FAKE_OUT', 'PWD', 'WORCA_HOST_PID'].includes(k)) assert.equal(rec.env[k], v, k);
}, POSIX);

// ── C-RULES ──────────────────────────────────────────────────────────────────

const SAMPLE = { Read: 'Read(./secrets/**)', Grep: 'Grep(./secrets/**)', Glob: 'Glob(./secrets/**)', Edit: 'Edit(./secrets/**)', Write: 'Write(./out/**)',
  Bash: 'Bash(git push:*)', WebFetch: 'WebFetch', WebSearch: 'WebSearch', mcp: 'mcp__pg__drop' };

conformanceRow('C-RULES', 'held kinds have both fixtures; only held kinds pass the gate; a shell path rule is named, never refused for it', (engine) => {
  const entry = ENGINES[engine];
  for (const kind of RULE_KINDS) {
    const level = entry.rules[kind] ?? 'unenforced';
    if (level === 'held' || level === 'partial') assert.ok(existsSync(join(RULES_DIR, engine, `${kind}.json`)), `${kind}.json`);
    if (level === 'held') assert.ok(existsSync(join(RULES_DIR, engine, `${kind}.denial.jsonl`)), `${kind}.denial.jsonl`);
    const s = ruleSupport(engine, { deny: [SAMPLE[kind]] });
    const passes = !s.refused.length && !s.partial.length;
    if (level !== 'held') assert.equal(passes, false, `${kind} (${level}) needs --allow-unguarded-engine`);
    if (['Read', 'Edit', 'Write', 'Grep', 'Glob'].includes(kind) && entry.shell && !s.refused.length) assert.deepEqual(s.shellPaths, [SAMPLE[kind]], `${kind}: the baseline line`);
  }
  assert.deepEqual(ruleSupport(engine, { deny: ['Foo(x)'] }).refused, ['Foo(x)'], 'an unlisted kind fails closed');
});

// ── C-SUBAGENT ───────────────────────────────────────────────────────────────

conformanceRow('C-SUBAGENT', 'unproven sub-agents lose their tool in the spawn; an engine that cannot deny it is refused', async (engine) => {
  const s = ENGINES[engine].subagents;
  const policy = subagentPolicy(engine);
  if (s.inheritsRules === 'yes') assert.ok(existsSync(join(RULES_DIR, s.proof)), 'the proof is recorded');
  if (policy === 'deny') {
    const { rec, error } = await runFake(engine, { subagentsOff: true, allowedTools: ['Read', 'Bash', 'Agent'] });
    assert.equal(error, null, String(error?.message));
    const argv = rec.argv.join(' ');
    assert.ok(argv.includes(s.tool) || (s.tool === 'Agent' && /--disallowedTools \S*Agent/.test(argv)), `${s.tool} denied in: ${argv}`);
  }
  if (policy === 'refuse') {
    const o = createOrchestrator({ projectDir: '/tmp/conf-proj', guardrailsId: 'permissive', claude: { mock: true, engine } });
    o.resolved = { nodeCtx: {} };
    assert.throws(() => o._engineGate(), /sub-agents/);
  }
}, POSIX);

// ── C-SESSIONS ───────────────────────────────────────────────────────────────

const SID = '44444444-4444-4444-8444-444444444444';
const OTHER = '55555555-5555-4555-8555-555555555555';
/** Per engine: where its CLI keeps a session (`<id>` placed), the run's stored id, and a sign-in file. */
const STORES = {
  claude: { at: (h, id) => join(h, '.claude', 'projects', 'p', `${id}.jsonl`), id: (x) => x, signIn: (h) => join(h, '.claude', '.credentials.json') },
  codex: { at: (h, id) => join(h, '.codex', 'sessions', '2026', '10', '22', `rollout-2026-10-22T10-00-00-${id}.jsonl`), id: (x) => `codex:${x}`, signIn: (h) => join(h, '.codex', 'auth.json') },
  copilot: { at: (h, id) => join(h, '.copilot', 'session-state', id, 'events.jsonl'), id: (x) => `copilot:${x}`, signIn: (h) => join(h, '.copilot', 'config.json') },
  cursor: { at: (h, id) => join(h, '.cursor', 'chats', 'ws', id, 'store.db'), id: (x) => `cursor:${x}`, signIn: (h) => join(h, '.cursor', 'cli-config.json') },
};

conformanceRow('C-SESSIONS', "archiving removes the run's sessions and never the sign-in", async (engine) => {
  if (ENGINES[engine].sessions === 'none') return;
  const store = STORES[engine];
  assert.ok(store, `a session-store fixture for ${engine}`);
  const home = mkdtempSync(join(tmpdir(), 'worca-conf-home-'));
  try {
    process.env.HOME = home;
    for (const k of ['CLAUDE_CONFIG_DIR', 'CODEX_HOME', 'COPILOT_HOME', 'CURSOR_CONFIG_DIR']) delete process.env[k];
    const put = (p, d) => { mkdirSync(dirname(p), { recursive: true }); writeFileSync(p, d); return p; };
    const mine = put(store.at(home, SID), 'a'); const theirs = put(store.at(home, OTHER), 'b'); const signIn = put(store.signIn(home), 'secret');
    await removeRunSessions({ sessionIds: [store.id(SID)] });
    assert.equal(existsSync(mine), false);
    assert.equal(readFileSync(theirs, 'utf8'), 'b');
    assert.equal(readFileSync(signIn, 'utf8'), 'secret');
  } finally { rmSync(home, { recursive: true, force: true }); }
}, POSIX);

test('an adapter with no catalog entry (the mock) holds no deny rule: every one is refused', () => {
  const deny = ['Bash(rm:*)', 'Read(/etc/**)', 'mcp__probe__wipe'];
  assert.deepEqual(ruleSupport('mock', { deny }), { refused: deny, partial: [], shellPaths: [] });
});
