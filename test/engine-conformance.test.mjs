// test/engine-conformance.test.mjs
// The conformance suite, part 1: the process rows (plans/core-protection-layer-design.md §5) over every catalog
// entry. Each row runs the REAL adapter (through runClaude's engine dispatch) against test/fixtures/fake-engine.mjs,
// which records its argv, env, cwd and process group, starts a backgrounded grandchild and prints the engine's
// stream (test/fixtures/engines/<engine>/stream.jsonl). A new engine passes by its catalog entry, adapter and
// fixtures; a failure here is a gap in the owner (src/core/spawn.mjs, engines/index.mjs), not in the row.
import { after, beforeEach, afterEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, lstatSync, rmSync, writeFileSync } from 'node:fs';
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
import { ENGINES, ENGINE_NAMES, RULE_KINDS, engineEntry, setCatalogForTest } from '../src/shared/engine-switch.mjs';
import { createOrchestrator } from '../src/core/orchestrator.mjs';
import { resolveModelRoute, buildRelayRoute, RELAY_DUMMY } from '../src/core/exec-env/relay-route.mjs';
import { credentialNamesOf, modeCredential } from '../src/core/exec-env/credentials.mjs';
import { claudeProbeSpec } from '../src/core/preflight.mjs';
import { MODEL_CREDENTIAL_ENV_KEYS } from '../src/core/broker-guard.mjs';
import { resetBrokerClient } from '../src/core/broker-client.mjs';
import { writeState } from '../src/core/artifacts.mjs';
import { prepare } from '../src/core/db.mjs';
import { ledgerHarness } from './helpers/conformance.mjs';
import { startEngineUpstream, ANTHROPIC_KEY, CODEX_KEY, PAT, CURSOR_KEY, ACCESS } from './helpers/engine-upstream.mjs';
import { startTestBroker } from './helpers/test-broker.mjs';
import { relaySandbox } from './helpers/relay-sandbox.mjs';
import { CATALOG_CREDENTIAL_NAMES } from './helpers/credential-env.mjs';
import { worcaHome } from '../src/core/projects.mjs';
import { CURSOR_ARGV_LIMIT } from '../src/core/engines/cursor.mjs';
import { CURSOR_CLI_CONFIG } from '../src/core/exec-env/relay-route.mjs';
import { chatDescriptor } from '../src/core/engines/chat.mjs';
import { modelPricedOn } from '../src/core/pricing.mjs';
import { chatSignInEnv } from '../src/core/engines/chat-descriptor.mjs';

useTempHome(after);
const HERE = dirname(fileURLToPath(import.meta.url));
const FAKE = join(HERE, 'fixtures', 'fake-engine.mjs');
const RULES_DIR = join(HERE, 'fixtures', 'engine-rules');
const POSIX = process.platform === 'win32' ? { skip: 'POSIX process groups and shell fixtures' } : {};
const { tmp, cleanup } = scratchDirs(); after(cleanup);
const FAKE_VARS = ['FAKE_OUT', 'FAKE_STREAM', 'FAKE_HOLD', 'FAKE_GRANDCHILD', 'FAKE_EXIT', 'FAKE_FILES', 'FAKE_CALL', 'FAKE_CALL_MODEL', 'FAKE_HOLD_AFTER'];

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
async function runFake(engine, { model = ENGINES[engine].requiresExplicitModel ? 'conformance/model' : undefined, env = {}, hold = false, signal, workRoot = null, cwd = tmp('worca-conf-cwd-'), allow = [], stream = 'stream.jsonl', ...opts } = {}) {
  const dir = tmp('worca-conf-');
  const out = join(dir, 'rec.json');
  Object.assign(process.env, { FAKE_OUT: out, FAKE_STREAM: join(HERE, 'fixtures', 'engines', engine, stream), ...env });
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
// Chat engines whose chat spawn moves onto the catalog in that engine's own commit (Gemini CLI and Qwen Code: the
// chat sign-in their model names; Goose: that, and its MCP servers' env moves to a file beside the wrapper): the
// chat rows wait for it.
const CHAT_PENDING = new Set(['gemini', 'goose', 'qwen']);
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

// The spawn tokens C-ARGV saw minted per engine (0 when the refusal came before the lease): an adapter that leases first
// must still revoke (the row checks it), and at least one does, or that check proves nothing.
const argvMinted = {};
conformanceRow('C-ARGV', 'a model that reads as a flag is refused before anything spawns', async (engine) => {
  const { rec, error } = await runFake(engine, { model: '-oProxyCommand=x' });
  assert.equal(rec, null, 'the fake never ran');
  assert.equal(error?.errorClass, 'config', String(error?.message));
  assert.throws(() => argValue('', 'model'), { errorClass: 'config' });
  assert.throws(() => argValue('--upload-pack=x', 'branch'), { errorClass: 'config' });
  // Under the broker: whatever spawn token the adapter took before its argv was refused is revoked, never left to its TTL.
  const { broker } = await sharedBroker();
  clearCredentials();
  broker.on();
  const before = broker.tokens().length;
  let run;
  try { run = await runFake(engine, { model: '-oProxyCommand=x' }); } finally { resetBrokerClient(); }
  assert.equal(run.rec, null, 'the fake never ran under the broker either');
  assert.equal(run.error?.errorClass, 'config', String(run.error?.message));
  const minted = () => broker.tokens().slice(before);
  await waitFor(() => minted().every((r) => r.revoked_at), 5000);
  argvMinted[engine] = minted().length;
}, POSIX);
test('C-ARGV under the broker reached a lease on some engine', () => {
  assert.ok(Object.values(argvMinted).some((n) => n > 0), JSON.stringify(argvMinted));
});

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

// ── credentials and spend (core protection layer, part 2: C-CANARY, C-SIGNIN, C-LEDGER, C-MODEL) ────────────────────

// A canary for every credential name the catalog declares (credentials.mjs credentialNamesOf) and one no list holds,
// shaped so nothing refuses first (Copilot's must look like a fine-grained token). Scanned case-insensitively.
const CANARY = /canary9f3a/i;
const CANARY_NAMES = [...new Set([...ENGINE_NAMES.flatMap(credentialNamesOf), 'CANARY_TOKEN'])];
// The names an MCP server's env references: every canary and every K1 name (a brokered spawn's run env carries both).
const REF_NAMES = [...new Set([...CANARY_NAMES, ...MODEL_CREDENTIAL_ENV_KEYS])];
const canaryOf = (k) => (k === 'COPILOT_GITHUB_TOKEN' ? `github_pat_canary9f3a${'x'.repeat(24)}` : `canary9f3a-${k.toLowerCase()}`);
const setCanaries = (names = CANARY_NAMES) => { for (const k of names) process.env[k] = canaryOf(k); };
const clearCredentials = () => { for (const k of CANARY_NAMES) delete process.env[k]; };
// A model the step names where the engine needs one behind a slot or the relay (Copilot), else its CLI's own default.
const STEP_MODEL = { claude: undefined, codex: undefined, copilot: 'copilot/gpt-4.1', cursor: 'composer-1' };
/** The env var a brokered spawn's token sits in, and how its base names the slot. */
const BROKERED = {
  claude: { name: 'ANTHROPIC_AUTH_TOKEN', base: (r) => r.env.ANTHROPIC_BASE_URL, slot: '/p/anthropic' },
  codex: { name: 'WORCA_RELAY_KEY', base: (r) => r.argv.map((a) => /^model_providers\.worca_relay\.base_url="(.*)"$/.exec(a)?.[1]).find(Boolean), slot: '/p/openai/v1' },
  copilot: { name: 'COPILOT_PROVIDER_API_KEY', base: (r) => r.env.COPILOT_PROVIDER_BASE_URL, slot: '/p/copilot-pat' },
  cursor: { name: 'CURSOR_AUTH_TOKEN', base: (r) => r.env.CURSOR_API_ENDPOINT, slot: '/p/cursor' },
};

/** An MCP config with one stdio server whose env references every canary name as REF_<i> (never the names themselves:
 *  codex copies a server's env keys into its own env, and an unset reference expands to ''). */
function canaryMcpConfig() {
  const file = join(tmp('worca-conf-mcp-'), 'mcp.json');
  writeFileSync(file, JSON.stringify({ mcpServers: { refs: { command: process.execPath, args: ['-e', ''],
    env: Object.fromEntries(REF_NAMES.map((k, i) => [`REF_${i}`, `\${${k}}`])) } } }));
  return file;
}

/** No canary in `what` but the picked credential's own value at its own name (and, on codex, its REF_<i> copy). `token`:
 *  the name a brokered spawn's own wbt_ token sits in (a credential name for some engines; its value is no canary). */
function assertOnlyPicked(engine, env, extra, picked, token = null) {
  const kept = { ...env };
  if (picked) {
    assert.equal(kept[picked], canaryOf(picked), `${picked}: the credential it signs in with`);
    delete kept[picked];
    const ref = `REF_${REF_NAMES.indexOf(picked)}`;
    if (kept[ref] === canaryOf(picked)) delete kept[ref];
  }
  // A linear scan (a `[^"]*canary…` pattern backtracks quadratically over a long quote-free value, such as a binary).
  const text = JSON.stringify({ env: kept, ...extra });
  const at = text.search(CANARY);
  assert.equal(at, -1, `a credential worca holds reached the agent: …${text.slice(Math.max(0, at - 80), at + 40)}…`);
  for (const k of credentialNamesOf(engine)) {
    if (k === picked) continue;
    if (k === token) assert.match(String(env[k]), /^wbt_/, `${k}: the spawn's broker token`);
    else assert.equal(env[k], undefined, `${k}: not this spawn's credential`);
  }
}

// One loopback vendor stand-in and one broker on it for the file's broker and sandbox cases.
let shared = null;
async function sharedBroker() {
  if (shared) return shared;
  const upstream = await startEngineUpstream();
  const broker = await startTestBroker({ upstream, keys: { WORCA_BROKER_KEY_ANTHROPIC: ANTHROPIC_KEY, WORCA_BROKER_KEY_OPENAI: CODEX_KEY,
    WORCA_BROKER_KEY_COPILOT_PAT: PAT, WORCA_BROKER_KEY_CURSOR: CURSOR_KEY } });
  shared = { upstream, broker };
  return shared;
}
after(async () => { if (shared) { await shared.broker.close(); await shared.upstream.close(); } resetBrokerClient(); });

/** One brokered spawn of `engine` (the broker on, `keepCanaries` in worca's env): its record and the broker's tokens. */
async function brokeredRun(engine, { keepCanaries = [], allow = [], spawnEnv = undefined } = {}) {
  const { broker } = await sharedBroker();
  clearCredentials();
  setCanaries(keepCanaries);
  broker.on();
  const before = broker.tokens().length;
  try {
    const run = await runFake(engine, { env: { FAKE_FILES: '1', FAKE_GRANDCHILD: '0' }, model: STEP_MODEL[engine], mcpConfigPath: canaryMcpConfig(),
      allow, ...(spawnEnv ? { spawnEnv } : {}) });
    return { ...run, broker, minted: () => broker.tokens().slice(before) };
  } finally { resetBrokerClient(); }
}

/** The brokered spawn's own checks: the wbt_ token at its slot, revoked once the run ends. */
async function assertBrokered(engine, { rec, error, minted }) {
  assert.equal(error, null, String(error?.message));
  assert.ok(rec, 'the CLI ran');
  const b = BROKERED[engine];
  assert.match(String(rec.env[b.name]), /^wbt_/, 'the spawn holds its broker token');
  assert.ok(String(b.base(rec)).endsWith(b.slot), `${b.base(rec)} names ${b.slot}`);
  await waitFor(() => minted().length && minted().every((r) => r.revoked_at), 10000);
}

conformanceRow('C-CANARY', 'the agent sees no credential worca holds, except the one it signs in with', async (engine, t) => {
  // Local, the broker off: every canary in worca's env, and the engine's own credentials through the project allowlist
  // and the run env too; the child holds the one the resolver picked, nowhere else. (Another engine's credential a
  // project allowlists passes a direct spawn on purpose, so only this engine's are seeded there.)
  clearCredentials();
  setCanaries();
  const own = credentialNamesOf(engine);
  const d = resolveModelRoute({ engine, serverEnv: process.env, broker: { on: false } });
  const local = await runFake(engine, { env: { FAKE_FILES: '1', FAKE_GRANDCHILD: '0' }, model: STEP_MODEL[engine], argvInlineLimit: 1, mcpConfigPath: canaryMcpConfig(),
    allow: own, spawnEnv: Object.fromEntries(own.map((k) => [k, canaryOf(k)])) });
  assert.equal(local.error, null, String(local.error?.message));
  assert.ok(local.rec, 'the CLI ran');
  assertOnlyPicked(engine, local.rec.env, { argv: local.rec.argv, files: local.rec.files }, d.credential);

  // The run-start check: the same rule over the env it spawns with.
  const adapter = getEngine(engine);
  let preEnv;
  if (typeof adapter.preflight === 'function') {
    const pre = join(tmp('worca-conf-pre-'), 'pre.json');
    process.env.FAKE_OUT = pre;
    await adapter.preflight({ bin: FAKE, envAllowlist: [...FAKE_VARS, ...own], ...(engine === 'cursor' ? { env: process.env } : {}) });
    preEnv = JSON.parse(readFileSync(pre, 'utf8')).env;
  } else preEnv = childEnv({ ...claudeProbeSpec({ signInMode: d.signInMode }), allowlist: own }).env;
  assertOnlyPicked(engine, preEnv, {}, d.credential);

  // The broker on: worca's env keeps only what the K1 boot guard allows, the project allowlists every catalog credential
  // and the run env carries every catalog credential and every K1 name; the spawn holds its broker token and no canary.
  const brokered = await brokeredRun(engine, { keepCanaries: CANARY_NAMES.filter((k) => !MODEL_CREDENTIAL_ENV_KEYS.includes(k)),
    allow: CATALOG_CREDENTIAL_NAMES, spawnEnv: Object.fromEntries([...CATALOG_CREDENTIAL_NAMES, ...MODEL_CREDENTIAL_ENV_KEYS].map((k) => [k, canaryOf(k)])) });
  assertOnlyPicked(engine, brokered.rec?.env || {}, { argv: brokered.rec?.argv, files: brokered.rec?.files }, null, BROKERED[engine].name);
  await assertBrokered(engine, brokered);
  if (engine === 'codex') assert.ok(!brokered.rec.argv.some((a) => /^mcp_servers\..*env_vars=.*WORCA_RELAY_KEY/.test(a)), 'no MCP server is handed the broker token');

  // A sandbox: the server env holds every canary; nothing of it reaches the sandbox's env, argv or files.
  clearCredentials();
  const serverEnv = Object.fromEntries(CANARY_NAMES.map((k) => [k, canaryOf(k)]));
  const box = await relaySandbox(t, { engine, tmp, serverEnv });
  await runClaude({ engine, cwd: box.f.repo, prompt: 'P', execEnv: box.env, model: STEP_MODEL[engine], bin: `/nonexistent/worca-test/${engine}` });
  assert.equal(box.seen.length, 1, 'the CLI ran in the sandbox');
  assert.equal(CANARY.test(JSON.stringify({ cmd: box.seen[0].cmd, envs: box.seen[0].envs })), false, 'nothing of the server env in the spawn');
  const files = []; const walk = (d) => { for (const n of readdirSync(d)) { const p = join(d, n); const st = lstatSync(p); if (st.isDirectory()) walk(p); else if (st.isFile() && st.size < (1 << 20)) files.push(p); } };
  walk(box.seen[0].sandbox.pathPrefix);
  assert.deepEqual(files.filter((p) => CANARY.test(readFileSync(p, 'latin1'))), [], 'no file in the sandbox holds a canary');
  await box.close();
}, { ...POSIX, timeout: 240_000 });

conformanceRow('C-CANARY (chat)', 'a chat turn sees no credential worca holds, except the one its model signs in with', async (engine, t) => {
  if (!chatOn(engine)) { t.skip('Chat is off on this engine (catalog chat.verified false)'); return; }
  if (CHAT_PENDING.has(engine)) { t.skip('pending: this engine\'s chat moves onto the catalog in its own commit'); return; }
  // Every canary in worca's env, and the turn's envAllowlist as ask/spawn.mjs builds it (chatSignInEnv): the child holds
  // the one credential the route resolver picks for the chat's model, nowhere else (argv, staged files).
  clearCredentials();
  setCanaries();
  const d = resolveModelRoute({ engine, serverEnv: process.env, broker: { on: false }, model: CHAT_MODEL[engine] ?? null, checkModel: false });
  const allow = engine === 'claude' ? [] : chatSignInEnv(chatDescriptor(engine), CHAT_MODEL[engine], process.env);
  const run = await runChatFake(engine, { env: { FAKE_FILES: '1', FAKE_GRANDCHILD: '0' }, allow, spawnEnv: { ASK_COMMAND_TOKEN: 'tok-9' } });
  assert.equal(run.error, null, String(run.error?.message));
  assert.ok(run.rec, 'the CLI ran');
  assertOnlyPicked(engine, run.rec.env, { argv: run.rec.argv, files: run.rec.files }, d.credential);
}, POSIX);

conformanceRow('C-SIGNIN', 'each sign-in mode sees exactly its declared credential', async (engine, t) => {
  const entry = engineEntry(engine);
  const hostDir = entry.env.hostOnly[0];
  // Every tier, without a spawn: the engine's every credential through the project allowlist or the run env keeps only
  // the mode's own; a brokered spawn keeps only its token, of every engine's credentials and every K1 name.
  const all = Object.fromEntries(credentialNamesOf(engine).map((k) => [k, `v-${k}`]));
  for (const mode of entry.signIn.modes) {
    const cred = modeCredential(mode);
    for (const [tier, spec] of [['allowlist', { base: { ...all, PATH: '/usr/bin' }, allowlist: Object.keys(all) }], ['run env', { base: { PATH: '/usr/bin' }, runEnv: all }]]) {
      const { env, dropped } = childEnv({ engine, signInMode: mode.id, ...spec });
      assert.deepEqual(credentialNamesOf(engine).filter((k) => k in env), cred ? [cred] : [], `${engine}/${mode.id} via the ${tier}`);
      for (const k of Object.keys(all)) if (k !== cred) assert.ok(dropped.includes(k), `${engine}/${mode.id} via the ${tier}: ${k} is named in dropped`);
    }
  }
  const k1 = Object.fromEntries([...CATALOG_CREDENTIAL_NAMES, ...MODEL_CREDENTIAL_ENV_KEYS].map((k) => [k, 'v']));
  const token = BROKERED[engine].name;
  const b = childEnv({ engine, signInMode: 'brokered', base: { ...k1, PATH: '/usr/bin' }, allowlist: Object.keys(k1), runEnv: k1, overlay: { [token]: 'wbt_x' } });
  assert.deepEqual(Object.keys(k1).filter((k) => k in b.env && k !== token), [], `${engine}/brokered`);

  // Each mode, spawned: the mode's credential, plus decoys (the engine's other credentials that leave the pick
  // unchanged) in worca's env, the allowlist and the run env; the child holds exactly the mode's own.
  let seeded = 0;
  for (const mode of entry.signIn.modes) {
    clearCredentials();
    const cred = modeCredential(mode);
    const dirValue = tmp('worca-conf-signin-home-');
    process.env[hostDir] = dirValue;
    if (cred) {
      process.env[cred] = `v-${cred}`;
      for (const k of mode.env) if (k !== cred) process.env[k] = k.endsWith('_URL') ? 'https://gw.example' : 'x-org: o1';
      for (const k of mode.requires || []) process.env[k] = 'http://127.0.0.1:1';
    } else Object.assign(process.env, { HOME: process.env.HOME || '/tmp', USER: process.env.USER || 'u', LOGNAME: process.env.LOGNAME || 'u' });
    const picks = (extra) => resolveModelRoute({ engine, serverEnv: { ...process.env, ...extra }, broker: { on: false }, model: STEP_MODEL[engine] }).signInMode;
    const decoys = credentialNamesOf(engine).filter((k) => k !== cred && picks({ [k]: 'd' }) === mode.id);
    for (const k of decoys) process.env[k] = `decoy-${k}`;
    seeded += decoys.length;
    const { rec, error } = await runFake(engine, { env: { FAKE_GRANDCHILD: '0' }, model: STEP_MODEL[engine], allow: decoys,
      spawnEnv: Object.fromEntries(decoys.map((k) => [k, `decoy-${k}`])) });
    assert.equal(error, null, `${mode.id}: ${error?.message}`);
    assert.deepEqual(credentialNamesOf(engine).filter((k) => k in rec.env), cred ? [cred] : [], `${engine}/${mode.id}`);
    assert.equal(rec.env[hostDir], dirValue, `${mode.id}: the session dir stays (${hostDir})`);
    if (engine === 'claude' && mode.id === 'keychain') for (const k of ['HOME', 'USER', 'LOGNAME']) assert.ok(k in rec.env, `keychain: ${k}`);
    for (const k of [hostDir, ...(cred ? mode.env : []), ...(mode.requires || [])]) delete process.env[k];
  }
  assert.ok(seeded > 0, `${engine}: some mode had a decoy to drop`);

  // The broker on: the spawn token at the engine's slot, and no subscription token for Claude. No credential source
  // the engine's CLI reads (a key, a token, a key command: Copilot's COPILOT_PROVIDER_API_KEY_COMMAND) keeps an ambient
  // value, from worca's env, the allowlist or the run env: the CLI is pointed at the broker with the spawn token only.
  const sources = entry.env.relayOwned.filter((k) => /_(KEY|TOKEN|SECRET)(_COMMAND)?$/.test(k));
  const ambient = Object.fromEntries(sources.map((k) => [k, 'ambient-9f3a']));
  Object.assign(process.env, ambient);
  const brokered = await brokeredRun(engine, { allow: sources, spawnEnv: ambient });
  for (const k of sources) assert.notEqual(brokered.rec?.env[k], 'ambient-9f3a', `${engine}: ${k} is the pointing's own or absent`);
  for (const k of sources) delete process.env[k];
  await assertBrokered(engine, brokered);
  if (engine === 'claude') assert.equal(brokered.rec.env.CLAUDE_CODE_OAUTH_TOKEN, undefined);
  // An engine whose CLI keeps its config dir apart under the broker (Cursor: the HTTP/1.1 agent stream): worca's own
  // dir for this person's work, never the user's.
  const brokerHome = brokered.rec.env.CURSOR_CONFIG_DIR;
  if (engine === 'cursor') {
    assert.equal(brokerHome, join(worcaHome(), 'engines', 'cursor', 'broker-home', 'local'));
    assert.equal(readFileSync(join(brokerHome, 'cli-config.json'), 'utf8'), CURSOR_CLI_CONFIG);
    assert.ok(!brokerHome.startsWith(join(process.env.HOME, '.cursor')), brokerHome);
  }
  // An engine whose every sign-in is its own login is refused under the broker.
  const own = { ...ENGINES, [engine]: { ...ENGINES[engine], signIn: { modes: ENGINES[engine].signIn.modes.filter((m) => m.kind === 'own') } } };
  setCatalogForTest(own);
  process.env.WORCA_BROKER_URL = 'http://127.0.0.1:9';
  try {
    const o = createOrchestrator({ projectDir: '/tmp/conf-proj', guardrailsId: 'permissive', claude: { mock: true, engine } });
    o.resolved = { nodeCtx: {} };
    assert.throws(() => o._engineGate(), /signs in with its own credentials/);
  } finally { setCatalogForTest(null); delete process.env.WORCA_BROKER_URL; resetBrokerClient(); }

  // A sandbox: the CLI holds the relay's URL and a dummy (Claude: the route id), never the server's credential.
  clearCredentials();
  const real = { claude: { CLAUDE_CODE_OAUTH_TOKEN: 'sk-ant-oat01-signin-0123456789abcdef' }, codex: { CODEX_API_KEY: CODEX_KEY },
    copilot: { COPILOT_GITHUB_TOKEN: PAT }, cursor: { CURSOR_API_KEY: CURSOR_KEY } }[engine];
  const box = await relaySandbox(t, { engine, tmp, serverEnv: real });
  await runClaude({ engine, cwd: box.f.repo, prompt: 'P', execEnv: box.env, model: STEP_MODEL[engine], bin: `/nonexistent/worca-test/${engine}` });
  const envs = box.seen[0]?.envs;
  assert.ok(envs, 'the CLI ran in the sandbox');
  if (engine === 'claude') {
    assert.match(envs.ANTHROPIC_AUTH_TOKEN, /^[A-Za-z0-9_-]{43}$/, 'the route id');
    assert.match(envs.ANTHROPIC_BASE_URL, /^http:\/\/127\.0\.0\.1:\d+\/r\//);
    assert.equal(envs.CLAUDE_CODE_OAUTH_TOKEN, undefined);
  } else {
    assert.equal({ codex: envs.WORCA_RELAY_KEY, copilot: envs.COPILOT_PROVIDER_API_KEY, cursor: envs.CURSOR_AUTH_TOKEN }[engine], RELAY_DUMMY);
  }
  for (const v of Object.values(real)) assert.equal(JSON.stringify({ envs, cmd: box.seen[0].cmd }).includes(v), false, 'the server credential stays in worca');
  await box.close();
}, { ...POSIX, timeout: 240_000 });

/** Feed `events` to a ledger harness as _execStep does (the events, then the step's end) and return it. `model`: the
 *  step's (undefined: the harness default). */
async function replay(engine, events, model = undefined) {
  const h = await ledgerHarness(engine, model);
  for (const e of events) h.orch._onAgentEvent('implementer', e, h.attr);
  h.orch._closeOpenTurns(h.attr.stepKey);
  return h;
}
/** The events that carried tokens worca books: a result's non-empty relay take, a spend with messages or usage. */
const carriers = (events) => events.filter((e) => (e.type === 'result' && e.relay?.messages) || (e.type === 'spend' && (e.messages || e.usage)));
/** The line of each fixture stream that carries a result (codex: its turn.completed). */
const RESULT_LINE = { claude: /"type":"result"/, codex: /"type":"turn\.completed"/, copilot: /"type":"result"/, cursor: /"type":"result"/ };
/** The relay's price of one 100-in/20-out reply (list-prices.mjs, per Mtok): Sonnet 5 $2/$10, GPT-5.5 $5/$30. */
const RELAY_PRICE = { claude: 0.0004, codex: 0.0011 };
/** The way a spawn ended is the one the case set up: exit 0, exit code 1, the turn cap, a stop. */
function assertOutcome(engine, x, { result, error, events, argv }) {
  const at = `${engine} ${x.name}`;
  if (x.outcome === 'ok') { assert.equal(error, null, `${at}: ${error?.message}`); assert.equal(result?.exitCode, 0, at); }
  else if (x.outcome === 'exit1') { assert.notEqual(error?.name, 'AbortError', at); assert.match(String(error?.message), /exited with code 1\b/, at); }
  else if (x.outcome === 'turnCap' && argv.includes('--max-turns')) {
    // A CLI that caps its own turns (Claude Code's --max-turns): the flag, and its error_max_turns result.
    assert.equal(error, null, `${at}: ${error?.message}`);
    const i = argv.indexOf('--max-turns');
    assert.deepEqual(argv.slice(i, i + 2), ['--max-turns', '1'], at);
    assert.ok(events.some((e) => e.type === 'result' && e.subtype === 'error_max_turns'), at);
  } else if (x.outcome === 'turnCap') {
    assert.equal(error?.turnCap, true, `${at}: ${error?.message}`);
    assert.match(error.message, /stopped after 1 tool calls \(the turn cap\)/, at);
  } else assert.equal(error?.name, 'AbortError', `${at}: ${error?.message}`);
}

conformanceRow('C-LEDGER', 'spend is booked exactly once on every exit', async (engine, t) => {
  const reportsCost = ENGINES[engine].cost !== false;
  // Relayed: the CLI makes one model call through worca's relay (100 in / 20 out), then ends in each of four ways.
  const upstream = await startEngineUpstream({ usage: { input_tokens: 100, output_tokens: 20 } });
  t.after(() => upstream.close());
  const stepModel = { claude: 'claude-sonnet-5', codex: 'gpt-5.5', copilot: 'copilot/gpt-4.1', cursor: 'composer-1' }[engine];
  const wire = { claude: 'claude-sonnet-5', codex: 'gpt-5.5', copilot: 'gpt-4.1', cursor: undefined }[engine];
  const fixture = (name) => join(HERE, 'fixtures', 'engines', engine, name);
  const box = await relaySandbox(t, { engine, tmp, upstream, serverEnv: upstream.serverEnv, fake: {} });
  // The stream without its result line: a spawn that ends before any result leaves its take to the route's close.
  const noResult = join(tmp('worca-conf-noresult-'), 'stream.jsonl');
  writeFileSync(noResult, `${readFileSync(fixture('stream.jsonl'), 'utf8').split('\n').filter((l) => l && !RESULT_LINE[engine].test(l)).join('\n')}\n`);
  const exits = [
    { name: 'exit 0', outcome: 'ok', knobs: { FAKE_STREAM: fixture('stream.jsonl') } },
    { name: 'exit 1 (no result line)', outcome: 'exit1', spend: true, knobs: { FAKE_STREAM: noResult, FAKE_EXIT: '1' } },
    { name: 'turn cap', outcome: 'turnCap', knobs: { FAKE_STREAM: fixture('turncap.jsonl') }, opts: { maxTurns: 1 } },
    { name: 'abort (before any result)', outcome: 'abort', spend: true, knobs: { FAKE_STREAM: noResult, FAKE_HOLD: '1' }, abort: true },
  ];
  for (const x of exits) {
    const out = join(tmp('worca-conf-ledger-'), 'rec.json');
    box.setFake({ FAKE_OUT: out, FAKE_CALL: '1', FAKE_CALL_MODEL: wire, FAKE_GRANDCHILD: '0', ...x.knobs });
    const events = []; const ac = new AbortController();
    const run = runClaude({ engine, cwd: box.f.repo, prompt: 'P', execEnv: box.env, model: stepModel, signal: ac.signal, bin: `/nonexistent/worca-test/${engine}`,
      ...(engine === 'claude' ? { modelEnv: { ANTHROPIC_BASE_URL: upstream.url, ANTHROPIC_API_KEY: ANTHROPIC_KEY } } : {}), ...(x.opts || {}),
      onEvent: (e) => events.push(e) }).then((result) => ({ result, error: null }), (error) => ({ result: null, error }));
    if (x.abort) {
      await waitFor(() => { try { return JSON.parse(readFileSync(out, 'utf8')).call; } catch { return null; } }, 30000);
      ac.abort();
    }
    const { result, error } = await run;
    const rec = JSON.parse(readFileSync(out, 'utf8'));
    assertOutcome(engine, x, { result, error, events, argv: rec.argv });
    assert.equal(rec.call?.status, 200, `${x.name}: the call went through the relay (${rec.call?.body?.slice(0, 200)})`);
    const carried = carriers(events);
    assert.equal(carried.length, 1, `${x.name}: exactly one event carried the tokens (${events.map((e) => e.type).join(',')})`);
    // No result line (or Copilot, whose result comes after the spawn settled): the route's close carried the take.
    if (x.spend || engine === 'copilot') assert.equal(carried[0].type, 'spend', `${x.name}: the route's close carried it`);
    const h = await replay(engine, events, stepModel);
    assert.deepEqual(h.step.usage, { input: 100, output: 20, cacheRead: 0, cacheWrite: 0 }, x.name);
    if (reportsCost) {
      assert.equal(h.booked(), 1, `${x.name}: one booking at the relay's price`);
      assert.ok(Math.abs(h.step.costUsd - RELAY_PRICE[engine]) < 1e-9, `${x.name}: the relay's price for ${stepModel}, ${h.step.costUsd}`);
    } else { assert.equal(h.step.costKnown, false, x.name); assert.equal(h.booked(), 0, x.name); }
  }
  await box.close();

  // Local: the engine's own figures, booked once on every exit.
  const local = [
    { name: 'exit 0', outcome: 'ok', stream: 'stream.jsonl' },
    { name: 'exit 1', outcome: 'exit1', stream: 'spend-error.jsonl', env: { FAKE_EXIT: '1' } },
    { name: 'turn cap', outcome: 'turnCap', stream: 'turncap.jsonl', opts: { maxTurns: 1 } },
    { name: 'abort', outcome: 'abort', stream: 'stream.jsonl', env: { FAKE_HOLD_AFTER: String(readFileSync(fixture('stream.jsonl'), 'utf8').split('\n').filter(Boolean).length) }, abort: true },
  ];
  for (const x of local) {
    clearCredentials();
    for (const k of ['FAKE_EXIT', 'FAKE_HOLD_AFTER']) delete process.env[k];   // runFake leaves a case's knobs in the env
    const events = []; const ac = new AbortController();
    const p = runFake(engine, { stream: x.stream, env: { FAKE_GRANDCHILD: '0', ...(x.env || {}) }, model: STEP_MODEL[engine], signal: ac.signal, onEvent: (e) => events.push(e), ...(x.opts || {}) });
    // Aborted once the spend-bearing line is out (copilot prints none: its tokens come from its session files).
    if (x.abort) { await waitFor(() => events.some((e) => e.type === 'result' || e.type === 'tool'), 30000); ac.abort(); }
    const { result, error, rec } = await p;
    assertOutcome(engine, x, { result, error, events, argv: rec?.argv || [] });
    const h = await replay(engine, events);
    const want = {
      claude: { usd: x.name === 'turn cap' ? 0.002 : 0.001 },
      codex: { usd: 0.0022 },
      cursor: { tokens: x.name === 'turn cap' ? null : { input: 10, output: 2, cacheRead: 0, cacheWrite: 0 } },
      copilot: {},
    }[engine];
    if (reportsCost) {
      assert.equal(h.booked(), 1, `${engine} ${x.name}: booked once`);
      assert.ok(Math.abs(h.step.costUsd - want.usd) < 1e-4, `${engine} ${x.name}: ${h.step.costUsd}`);
    } else {
      assert.equal(h.booked(), 0, `${engine} ${x.name}`);
      assert.equal(h.step.costKnown, false, `${engine} ${x.name}: cost unknown, never $0`);
      if (engine === 'cursor') assert.deepEqual(h.step.usage ?? null, want.tokens, `${engine} ${x.name}: its result's tokens`);
    }
  }

  // An unpriced reply is cost unknown, never $0.
  if (engine === 'claude') {
    const h = await ledgerHarness('claude', null);
    h.orch._bookUsage({ source: 'relay', messages: 1, byModel: { 'mystery-model': { input_tokens: 1, output_tokens: 1 } } }, { stepKey: h.attr.stepKey, model: null });
    assert.equal(h.step.costKnown, false);
  }

  // A cost cap refuses a run whose spend worca cannot count.
  const home = tmp('worca-conf-cap-home-');
  mkdirSync(join(home, '.worca-cc'), { recursive: true });
  writeFileSync(join(home, '.worca-cc', 'settings.json'), JSON.stringify({ pipelineCostLimitUsd: 5 }));
  Object.assign(process.env, { HOME: home, USERPROFILE: home, WORCA_TEST_ALLOW_HOME_FALLBACK: '1' });
  const gate = (model) => {
    // The run's model and its one node's, as a run that names one model.
    const o = createOrchestrator({ projectDir: '/tmp/conf-proj', guardrailsId: 'permissive', claude: { mock: true, engine, ...(model ? { model } : {}) } });
    o.resolved = { nodeCtx: { a: { nodeId: 'a', kind: 'agent', model } } };
    return o._engineRefusal({ nodes: Object.values(o.resolved.nodeCtx) });
  };
  // The one pricing rule (pricing.mjs): a cap starts a run only on a model worca can price itself (R4), whoever reports.
  const stepPriced = modelPricedOn(engine, STEP_MODEL[engine] ?? null);
  if (!reportsCost) assert.match(gate(STEP_MODEL[engine] ?? null), new RegExp(`^${ENGINES[engine].label} reports no cost, and the pipeline cost limit`));
  else if (stepPriced) assert.equal(gate(STEP_MODEL[engine] ?? null), null, 'a priced model starts under a cap');
  else assert.match(gate(STEP_MODEL[engine] ?? null), /has no price, and the pipeline cost limit/, 'an engine that prices its own calls still needs a price worca knows');
  if (engine === 'claude') assert.match(gate('mystery-model'), /^model "mystery-model" has no price, and the pipeline cost limit/);
  // An engine whose models name their provider (Goose, OpenCode): a list price worca knows starts, another is refused.
  if (reportsCost && ENGINES[engine].signIn.byModel) {
    assert.equal(gate('anthropic/claude-sonnet-5-5'), null, 'Anthropic\'s list price');
    assert.match(gate('google/gemini-2.5-flash'), /^model "google\/gemini-2.5-flash" has no price, and the pipeline cost limit/);
  }
}, { ...POSIX, timeout: 280_000 });

conformanceRow('C-MODEL', 'the step\'s model is checked and recorded', async (engine, t) => {
  const entry = ENGINES[engine];
  // The relay checks a body-checked engine's calls against the step's model.
  if (entry.relay.modelCheck === 'body') {
    const upstream = await startEngineUpstream();
    t.after(() => upstream.close());
    const box = await relaySandbox(t, { engine, tmp, upstream, serverEnv: upstream.serverEnv });
    const d = resolveModelRoute({ engine, remote: true, serverEnv: upstream.serverEnv, model: 'm-step', broker: { on: false } });
    const route = buildRelayRoute(d, { serverEnv: upstream.serverEnv, label: box.env.label, upstreams: upstream.relayUpstreams });
    const { baseUrl } = box.env.relay.addRoute(route);
    const path = engine === 'codex' ? '/responses' : '/chat/completions';
    const call = (model) => fetch(`${baseUrl}${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ model, stream: true }) });
    const other = await call('m-other');
    assert.equal(other.status, 403);
    assert.match((await other.json()).error.message, /^worca-relay: model "m-other"/);
    const ok = await call('m-step');
    assert.equal(ok.status, 200);
    await ok.text();
    await box.close();
  } else assert.equal(entry.relay.modelCheck, 'partial', `${engine}: an unchecked relay is named partial`);

  // At start: a model-less step on an engine that needs one.
  const remote = createOrchestrator({ projectDir: '/tmp/conf-proj', guardrailsId: 'permissive', execEnv: 'e2b', claude: { mock: true, engine } });
  remote.resolved = { nodeCtx: { a: { nodeId: 'a', kind: 'agent', model: null } } };
  const refusal = remote._engineRefusal({ nodes: Object.values(remote.resolved.nodeCtx) });
  if (entry.relay.needsModel) assert.equal(refusal, `${entry.label} in a sandbox needs a model; pick one for this step.`);
  else assert.equal(refusal, null);
  setCatalogForTest({ ...ENGINES, [engine]: { ...ENGINES[engine], requiresExplicitModel: true } });
  try {
    const local = createOrchestrator({ projectDir: '/tmp/conf-proj', guardrailsId: 'permissive', claude: { mock: true, engine } });
    local.resolved = { nodeCtx: { a: { nodeId: 'a', kind: 'agent', model: null } } };
    const why = local._engineRefusal({ nodes: Object.values(local.resolved.nodeCtx) });
    if (entry.defaultModel) assert.equal(why, null, 'its catalog default is a model');
    else assert.equal(why, `${entry.label} needs a model; pick one for this step.`);
  } finally { setCatalogForTest(null); }

  // Who serves the step's model calls is recorded on its row.
  const o = createOrchestrator({ projectDir: '/tmp/conf-proj', guardrailsId: 'permissive', claude: { mock: true, engine } });
  const id = `c${engine.slice(0, 3)}0001`.padEnd(8, '0');
  o.state.id = id;
  o._execStep({ executionId: 'x:a:1', nodeId: 'a', ordinal: 1, uiPhase: 'implement', node: { kind: 'agent', key: 'implementer' }, claudeOpts: { model: null } }, 'start');
  const provider = entry.relay.upstream;
  assert.equal(o.state.steps[0].provider, provider);
  await writeState(`/d-${id}`, { ...o.getState(), id, projectKey: 'proj-conf' });
  assert.equal(prepare('SELECT provider FROM pipeline_steps WHERE pipeline_id = ? AND key = ?').get(id, 'x:a:1').provider, provider);
}, { ...POSIX, timeout: 120_000 });

test('an adapter with no catalog entry (the mock) holds no deny rule: every one is refused', () => {
  const deny = ['Bash(rm:*)', 'Read(/etc/**)', 'mcp__probe__wipe'];
  assert.deepEqual(ruleSupport('mock', { deny }), { refused: deny, partial: [], shellPaths: [] });
});

test('brokered local Copilot and Cursor: a spawn whose staging fails revokes its token; an agent-user Cursor is refused before any', POSIX, async (t) => {
  const { broker } = await sharedBroker();
  clearCredentials();
  // Copilot: a file where its scratch folder goes; the scratch dir is made after the lease.
  const scratch = join(worcaHome(), 'tmp', 'copilot');
  mkdirSync(dirname(scratch), { recursive: true });
  rmSync(scratch, { recursive: true, force: true });
  writeFileSync(scratch, 'a file where the scratch folder goes');
  t.after(() => rmSync(scratch, { force: true }));
  broker.on();
  const first = broker.tokens().length;
  let copilot;
  try { copilot = await runFake('copilot', { model: STEP_MODEL.copilot }); } finally { resetBrokerClient(); }
  assert.equal(copilot.rec, null, 'copilot never ran');
  assert.match(String(copilot.error?.message), /cannot prepare the spawn/);
  const copilotMinted = () => broker.tokens().slice(first);
  assert.equal(copilotMinted().length, 1, 'the token was taken before the scratch dir');
  await waitFor(() => copilotMinted().every((r) => r.revoked_at), 5000);
  // A file where the staging folder goes: the long prompt's staging fails after the lease.
  const block = join(worcaHome(), 'tmp', 'cursor-prompts');
  mkdirSync(dirname(block), { recursive: true });
  rmSync(block, { recursive: true, force: true });
  writeFileSync(block, 'a file where the staging folder goes');
  t.after(() => rmSync(block, { force: true }));
  broker.on();
  let before = broker.tokens().length;
  let run;
  try { run = await runFake('cursor', { model: STEP_MODEL.cursor, prompt: 'x'.repeat(CURSOR_ARGV_LIMIT + 1) }); } finally { resetBrokerClient(); }
  assert.equal(run.rec, null, 'cursor-agent never ran');
  assert.equal(run.error?.code, 'EEXIST', String(run.error?.message));
  const minted = () => broker.tokens().slice(before);
  assert.equal(minted().length, 1, 'the token was taken before the staging');
  await waitFor(() => minted().every((r) => r.revoked_at), 5000);
  // Under agent isolation the spawn would run as another uid, which cannot use worca's own config dir.
  Object.assign(process.env, { WORCA_AGENT_USER: 'worca-agent', WORCA_AGENT_HOME: '/home/worca-agent' });
  broker.on();
  before = broker.tokens().length;
  try { run = await runFake('cursor', { model: STEP_MODEL.cursor, asAgent: true }); } finally { resetBrokerClient(); }
  assert.equal(run.rec, null);
  assert.equal(run.error?.errorClass, 'config');
  assert.match(String(run.error?.message), /cannot run as an agent user yet .* run Cursor in a sandbox/);
  assert.equal(broker.tokens().length, before, 'refused before the lease');
});

test('a sandbox run under the broker (D8): the relay\'s upstream is the broker slot, signed with the spawn token; the sandbox holds a dummy', { ...POSIX, timeout: 180_000 }, async (t) => {
  const { upstream, broker } = await sharedBroker();
  const cases = { codex: { model: 'gpt-5.5', wire: 'gpt-5.5', key: CODEX_KEY, path: '/v1/responses', dummy: (e) => e.WORCA_RELAY_KEY },
    copilot: { model: 'copilot/gpt-4.1', wire: 'gpt-4.1', key: PAT, path: '/chat/completions', dummy: (e) => e.COPILOT_PROVIDER_API_KEY },
    cursor: { model: 'composer-1', wire: undefined, key: ACCESS, path: '/agent.v1.AgentService/RunSSE', dummy: (e) => e.CURSOR_AUTH_TOKEN } };
  for (const [engine, c] of Object.entries(cases)) {
    clearCredentials();
    broker.on();
    const before = broker.tokens().length;
    const out = join(tmp('worca-conf-remote-broker-'), 'rec.json');
    const box = await relaySandbox(t, { engine, tmp, serverEnv: {}, fake: { FAKE_OUT: out, FAKE_CALL: '1', FAKE_CALL_MODEL: c.wire, FAKE_GRANDCHILD: '0',
      FAKE_STREAM: join(HERE, 'fixtures', 'engines', engine, 'stream.jsonl') } });
    const seenBefore = upstream.calls.length;
    try {
      await runClaude({ engine, cwd: box.f.repo, prompt: 'P', execEnv: box.env, model: c.model, bin: `/nonexistent/worca-test/${engine}` });
    } finally { resetBrokerClient(); }
    const call = JSON.parse(readFileSync(out, 'utf8')).call;
    assert.equal(call.status, 200, `${engine}: ${call.body.slice(0, 200)}`);
    const sent = upstream.calls.slice(seenBefore).find((x) => x.url === c.path);
    assert.ok(sent, `${engine}: the call reached the vendor through the broker`);
    assert.equal(sent.headers.authorization, `Bearer ${c.key}`, `${engine}: the broker added the key`);
    assert.equal(c.dummy(box.seen[0].envs), RELAY_DUMMY, `${engine}: the sandbox holds a dummy`);
    assert.equal(JSON.stringify(box.seen[0].envs).includes('wbt_'), false, `${engine}: the spawn token stays in worca`);
    await waitFor(() => broker.tokens().slice(before).length && broker.tokens().slice(before).every((r) => r.revoked_at), 10000);
    await box.close();
  }
});
