// src/core/engines/chat-selftest.mjs
// The runtime proof behind Chat on an engine whose lockdown worca builds from its CLI's own switches (Gemini CLI, Qwen
// Code): before the first chat turn on a binary, run it once, locked down exactly as a chat runs it, against a model
// endpoint served here (127.0.0.1) and a stand-in for worca's MCP server (engines/chat-probe-mcp.mjs) beside a second one
// standing in for a registry copy (a chat attaches the user's sets' servers next to worca's). The scripted model asks for
// a shell command, then for worca's probe tool, then for the copy's, then answers. It passes only when
//   - every model request offered the two servers' tools and nothing else but the engine's named meta tools (its chat
//     descriptor's metaTools; the user's own settings, servers, extensions and env files are read as in a real chat, so
//     a setting that adds a tool fails it),
//   - worca's tools whose names clash with the CLI's built-ins (read_file, glob, …) are still offered,
//   - the shell call did not run (its canary file does not exist), and
//   - worca's probe tool and the copy's answered (the round trips a chat needs).
// A pass is kept per binary, version and user config fingerprint (in memory and in <worca home>/engines/
// chat-selftest.json); a failure is never kept, so the next turn runs the test again. The turn's watchdog (turn.mjs
// _watch) stays the backstop for what a test run cannot show.
import { createServer } from 'node:http';
import { execFile } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { worcaHome } from '../projects.mjs';
import { PROBE_TOOLS } from './chat-probe-mcp.mjs';

export const PROBE_MCP_PATH = fileURLToPath(new URL('./chat-probe-mcp.mjs', import.meta.url));
export const SELF_TEST_MODEL = 'worca-self-test';
const PROBE_SERVER = 'worca';
/** The stand-in registry copy: a second probe server under another name, allowed by name like a set's server. */
export const PROBE_COPY = 'mcpcopy';
/** Bumped when the test itself changes, so a pass kept by an older test runs again. */
const SELF_TEST_REV = 2;

const passed = new Map();     // cache key -> true
const inflight = new Map();   // cache key -> Promise
/** Tests only: forget every kept pass. */
export function resetChatSelfTests() { passed.clear(); inflight.clear(); }

const defaultCacheFile = () => join(worcaHome(), 'engines', 'chat-selftest.json');
function readCache(file) { try { const j = JSON.parse(readFileSync(file, 'utf8')); return j && typeof j === 'object' ? j : {}; } catch { return {}; } }
function writeCache(file, key, at) {
  try {
    const all = readCache(file);
    all[key] = { ok: true, at };
    mkdirSync(join(file, '..'), { recursive: true });
    writeFileSync(file, `${JSON.stringify(all, null, 2)}\n`, { mode: 0o600 });
  } catch { /* best effort: the test runs again after a restart */ }
}

/** `bin --version`'s first line, or throws. */
export function binaryVersion(bin, { timeoutMs = 15000 } = {}) {
  return new Promise((resolve, reject) => {
    execFile(bin, ['--version'], { timeout: timeoutMs }, (err, stdout) => {
      if (err) reject(err); else resolve(String(stdout || '').trim().split('\n')[0] || 'unknown');
    });
  });
}

/** What the files a CLI reads its user config from look like now (path, size, mtime): a change re-runs the test. */
export function configFingerprint(files) {
  return files.map((f) => { try { const s = statSync(f); return `${f}:${s.size}:${Math.round(s.mtimeMs)}`; } catch { return `${f}:-`; } }).join('|');
}

// ── the model endpoint ───────────────────────────────────────────────────────

/**
 * A scripted model endpoint on 127.0.0.1: OpenAI chat completions (`openai`) or the Gemini API (`gemini`), streaming or
 * not. Every request's offered tool names are recorded; a request that offers tools gets the next scripted step, one
 * that offers none (a CLI's own side call: routing, next speaker) gets a short JSON answer and is not counted.
 */
export function startStubEndpoint({ protocol, script }) {
  const requests = [];
  let step = 0;
  const server = createServer((req, res) => {
    let body = '';
    req.on('data', (c) => { body += c; if (body.length > 32 * 1024 * 1024) req.destroy(); });
    req.on('end', () => {
      let j = {};
      try { j = JSON.parse(body || '{}'); } catch { /* an empty body */ }
      const json = (o) => { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify(o)); };
      const url = String(req.url || '');
      if (protocol === 'gemini' && /:countTokens/.test(url)) return json({ totalTokens: 1 });
      const isCall = protocol === 'openai' ? /\/chat\/completions/.test(url) : /:(?:stream)?[gG]enerateContent/.test(url);
      if (!isCall) return json(protocol === 'openai' ? { object: 'list', data: [{ id: SELF_TEST_MODEL, object: 'model' }] } : {});
      const tools = protocol === 'openai'
        ? (Array.isArray(j.tools) ? j.tools : []).map((t) => String(t?.function?.name ?? t?.name ?? ''))
        : (Array.isArray(j.tools) ? j.tools : []).flatMap((t) => [
          ...(Array.isArray(t?.functionDeclarations) ? t.functionDeclarations.map((f) => String(f?.name ?? '')) : []),
          ...Object.keys(t || {}).filter((k) => k !== 'functionDeclarations').map((k) => `<${k}>`),   // a built-in such as googleSearch
        ]);
      const side = tools.length === 0;
      const next = side ? { text: '{"next_speaker":"user","reasoning":"done","model_choice":"flash"}' } : (script[step++] || { text: 'done' });
      if (!side) requests.push({ tools });
      if (protocol === 'openai') {
        const id = `wst-${requests.length}`;
        const msg = next.tool
          ? { role: 'assistant', content: null, tool_calls: [{ id: `call_${id}`, type: 'function', function: { name: next.tool, arguments: JSON.stringify(next.args || {}) } }] }
          : { role: 'assistant', content: next.text };
        const finish = next.tool ? 'tool_calls' : 'stop';
        const usage = { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 };
        if (!j.stream) return json({ id, object: 'chat.completion', created: 1, model: j.model, choices: [{ index: 0, message: msg, finish_reason: finish }], usage });
        res.writeHead(200, { 'content-type': 'text/event-stream' });
        const chunk = (delta, fr = null, extra = {}) => res.write(`data: ${JSON.stringify({ id, object: 'chat.completion.chunk', created: 1, model: j.model, choices: [{ index: 0, delta, finish_reason: fr }], ...extra })}\n\n`);
        chunk(next.tool ? { role: 'assistant', tool_calls: msg.tool_calls.map((c, index) => ({ index, ...c })) } : { role: 'assistant', content: next.text });
        chunk({}, finish, { usage });
        res.end('data: [DONE]\n\n');
        return undefined;
      }
      const part = next.tool ? { functionCall: { name: next.tool, args: next.args || {} } } : { text: next.text };
      const out = { candidates: [{ content: { role: 'model', parts: [part] }, finishReason: 'STOP', index: 0 }], usageMetadata: { promptTokenCount: 1, candidatesTokenCount: 1, totalTokenCount: 2 } };
      if (/stream/i.test(url)) { res.writeHead(200, { 'content-type': 'text/event-stream' }); res.end(`data: ${JSON.stringify(out)}\n\n`); return undefined; }
      return json(out);
    });
  });
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      resolve({ url: `http://127.0.0.1:${port}`, requests, close: () => new Promise((r) => server.close(() => r())) });
    });
  });
}

// ── the test ─────────────────────────────────────────────────────────────────

/**
 * Judge one self-test run (pure, exported for tests).
 * @param {{requests:{tools:string[]}[], allowed:string[], expected:string[], canaryRan:boolean, probeCalled:boolean, error?:string|null, label:string}} r
 * @returns {{refusal:string}|{}}
 */
export function judgeSelfTest({ requests, allowed, expected, canaryRan, probeCalled, error = null, label }) {
  if (!requests.length) return { refusal: `worca could not run its chat self-test on ${label}${error ? ` (${error})` : ''}` };
  const extra = [...new Set(requests.flatMap((r) => r.tools).filter((t) => !allowed.includes(t)))];
  if (extra.length) return { refusal: `${label} offered tools a chat must not have (${extra.slice(0, 8).join(', ')}${extra.length > 8 ? ', …' : ''}), so worca does not run a chat on it — a setting, extension or env file of yours may have added them` };
  const missing = expected.filter((t) => !requests[0].tools.includes(t));
  if (missing.length) return { refusal: `${label} hid worca's own tools (${missing.join(', ')}), so a chat could not read its files` };
  if (canaryRan) return { refusal: `${label} ran a shell command in worca's chat self-test although it was given none` };
  if (!probeCalled) return { refusal: `worca's tools did not answer through ${label} in the chat self-test${error ? ` (${error})` : ''}` };
  return {};
}

/**
 * The cached self-test of one engine binary. Never rejects: resolves {refusal} or {}.
 * @param {object} o
 *   engine, label, bin, run (the adapter's run, called with askLockdown and `probe: {env}`),
 *   protocol ('openai'|'gemini'), probeEnv(baseUrl) (the env that points the CLI at the endpoint),
 *   wireName(server, tool) (the MCP tool's name on the wire), shellTool (the CLI's shell tool),
 *   configFiles (the files whose change re-runs the test), metaTools (the engine's own tools a chat keeps, as the
 *   endpoint sees them), model (the model id the run is given), timeoutMs.
 *   The run gets `probe: {env, url}`: the env that points the CLI at the endpoint, and the endpoint's base URL (for a
 *   CLI that takes its provider from config, not env).
 */
export async function chatSelfTest({
  engine, label, bin, run, protocol, probeEnv, wireName, shellTool = 'run_shell_command', configFiles = [], metaTools = [],
  model = SELF_TEST_MODEL, timeoutMs = 120_000, cacheFile = defaultCacheFile(), version = binaryVersion, home = worcaHome(),
}) {
  let ver;
  try { ver = await version(bin); } catch (err) { return { refusal: /ENOENT|EACCES/.test(String(err?.code || err?.message)) ? `cannot run ${bin} (${err.code || err.message})` : `could not ask ${bin} its version (${err?.message || err})` }; }
  let real = bin;
  try { real = realpathSync(bin); } catch { /* a bare name on PATH: the version tells binaries apart */ }
  const key = `${engine}|${real}|${ver}|${configFingerprint(configFiles)}|r${SELF_TEST_REV}`;
  if (passed.has(key) || readCache(cacheFile)[key]?.ok === true) { passed.set(key, true); return {}; }
  if (inflight.has(key)) return inflight.get(key);
  const p = runOnce({ label, bin, run, protocol, probeEnv, wireName, shellTool, timeoutMs, home, engine, metaTools, model })
    .then((r) => { if (!r.refusal) { passed.set(key, true); writeCache(cacheFile, key, new Date().toISOString()); } return r; })
    .catch((err) => ({ refusal: `worca could not run its chat self-test on ${label} (${err?.message || err})` }))
    .finally(() => inflight.delete(key));
  inflight.set(key, p);
  return p;
}

async function runOnce({ label, bin, run, protocol, probeEnv, wireName, shellTool, timeoutMs, home, engine, metaTools = [], model = SELF_TEST_MODEL }) {
  const dir = join(home, 'tmp', 'chat-selftest', `${engine}-${process.pid}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`);
  mkdirSync(join(dir, 'cwd'), { recursive: true, mode: 0o700 });
  const canary = join(dir, 'canary');
  const probeLog = join(dir, 'probe.log');
  const copyLog = join(dir, 'copy.log');
  const mcpConfigPath = join(dir, 'mcp.json');
  const probe = (log) => ({ type: 'stdio', command: process.execPath, args: [PROBE_MCP_PATH], env: { WORCA_PROBE_LOG: log } });
  writeFileSync(mcpConfigPath, JSON.stringify({ mcpServers: { [PROBE_SERVER]: probe(probeLog), [PROBE_COPY]: probe(copyLog) } }), { mode: 0o600 });
  const script = [
    { tool: shellTool, args: { command: `touch ${canary}` } },
    { tool: wireName(PROBE_SERVER, 'worca_probe'), args: {} },
    { tool: wireName(PROBE_COPY, 'worca_probe'), args: {} },
    { text: 'done' },
  ];
  const stub = await startStubEndpoint({ protocol, script });
  let error = null;
  try {
    await run({
      cwd: join(dir, 'cwd'), bin, prompt: "worca's chat self-test: follow the calls you are given, then answer done.", systemPrompt: '',
      model, askLockdown: true, mcpConfigPath, envScrub: true, envAllowlist: [],
      probe: { env: probeEnv(stub.url), url: stub.url }, signal: AbortSignal.timeout(timeoutMs), onEvent: () => {},
    });
  } catch (err) {
    error = String(err?.message || err).split('\n')[0].slice(0, 300);
  } finally {
    await stub.close();
  }
  const called = (log) => { try { return readFileSync(log, 'utf8').includes('"worca_probe"'); } catch { return false; } };
  const probeCalled = called(probeLog) && called(copyLog);
  const verdict = judgeSelfTest({
    requests: stub.requests,
    allowed: [...PROBE_TOOLS.map((t) => wireName(PROBE_SERVER, t)), ...PROBE_TOOLS.map((t) => wireName(PROBE_COPY, t)), ...metaTools],
    expected: [...PROBE_TOOLS.map((t) => wireName(PROBE_SERVER, t)), wireName(PROBE_COPY, 'worca_probe')],
    canaryRan: existsSync(canary), probeCalled, error, label,
  });
  rmSync(dir, { recursive: true, force: true });
  return verdict;
}
