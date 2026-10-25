#!/usr/bin/env node
// test/fixtures/fake-engine.mjs
// A stand-in engine binary for the boundary tests (spawn-supervise, engine-conformance). It records its argv, env,
// cwd and process group to $FAKE_OUT (JSON), starts a backgrounded grandchild (`sleep 600 &` in a shell, as an agent's
// `npm run dev &` would) that writes its pid to $FAKE_OUT.grand, replays the lines of $FAKE_STREAM on stdout, then
// exits $FAKE_EXIT (default 0), or with $FAKE_HOLD=1 waits to be stopped. Run as `<node> fake-engine.mjs …` or by path.
// Knobs for the credential and ledger rows (test/engine-conformance.test.mjs):
//   FAKE_FILES=1        records every staged file the argv names (`rec.files`: path → text), before anything else:
//                       a plain argv value naming a file, an `@<path>` value, a `key="<path>"` inside a -c override and
//                       every file under an argv-named directory (≤ 64 KiB each, ≤ 200 files). Staged files are gone
//                       once the spawn ends, so the fake reads them itself.
//   FAKE_CALL=1         makes ONE model call the way the engine's CLI would, from its own env and argv, and records
//                       `rec.call` ({url, status, body}): Claude Code's Messages call (ANTHROPIC_BASE_URL), codex's
//                       Responses call (its `model_providers.worca_relay.base_url` override), copilot's offline provider
//                       call (COPILOT_PROVIDER_*), cursor-agent's RunSSE (CURSOR_API_ENDPOINT), OpenCode's provider block
//                       (OPENCODE_CONFIG_CONTENT), Gemini's (GOOGLE_GEMINI_BASE_URL, goose's GOOGLE_HOST) and goose's
//                       and Qwen Code's other provider hosts. The body names
//                       FAKE_CALL_MODEL, else the argv's model flag (-m for codex, --model for the others). The reply is
//                       read to its end before the stream lines.
//   FAKE_HOLD_AFTER=N   prints N stream lines, then waits to be stopped.
//   FAKE_PAUSE=N:MS     prints N stream lines, goes quiet for MS ms, then prints the rest (a background agent at work).
//   FAKE_GRANDCHILD_STDOUT=1  the grandchild keeps the engine's stdout open (an agent's `npm run dev &` that writes to
//                       it): the step's output never ends while it runs, though the engine itself exits.
import { spawn, execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const out = process.env.FAKE_OUT;
const argv = process.argv.slice(2);
const MAX_FILE = 64 << 10;
const MAX_FILES = 200;
let pgid = null;
try { pgid = Number(execFileSync('ps', ['-o', 'pgid=', '-p', String(process.pid)], { encoding: 'utf8' }).trim()) || null; } catch { /* no ps */ }

/** Every staged file the argv names, read now (FAKE_FILES). */
function stagedFiles() {
  const files = {};
  const add = (p) => {
    if (Object.keys(files).length >= MAX_FILES || Object.hasOwn(files, p)) return;
    let st; try { st = statSync(p); } catch { return; }
    if (st.isFile()) { try { files[p] = readFileSync(p).subarray(0, MAX_FILE).toString('utf8'); } catch { /* unreadable */ } return; }
    if (!st.isDirectory()) return;
    let names = []; try { names = readdirSync(p); } catch { return; }
    for (const n of names) add(join(p, n));
  };
  for (const a of argv) {
    if (typeof a !== 'string' || !a) continue;
    const path = a.startsWith('@') ? a.slice(1) : a;
    if (path.startsWith('/') && existsSync(path)) add(path);
    for (const m of a.matchAll(/="(\/[^"]+)"/g)) if (existsSync(m[1])) add(m[1]);
  }
  return files;
}

const flag = (name) => { const i = argv.indexOf(name); return i === -1 ? null : argv[i + 1] ?? null; };

/** One call to `provider`'s API under `base` (its API root: …/v1 for anthropic and openai, …/v1beta for google), signed
 *  with `key` in the header that provider's SDK uses. */
function providerCall(provider, base, key, model, headers) {
  if (provider === 'google') {
    return { url: `${base}/models/${model}:streamGenerateContent?alt=sse`, headers: { ...headers, 'x-goog-api-key': key },
      body: JSON.stringify({ contents: [{ role: 'user', parts: [{ text: 'hi' }] }] }) };
  }
  if (provider === 'anthropic') {
    return { url: `${base}/messages`, headers: { ...headers, 'x-api-key': key, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({ model, stream: true, max_tokens: 5, messages: [{ role: 'user', content: 'hi' }] }) };
  }
  return { url: `${base}/${provider === 'openai' ? 'responses' : 'chat/completions'}`, headers: { ...headers, authorization: `Bearer ${key}` },
    body: JSON.stringify({ model, stream: true, ...(provider === 'openai' ? { input: 'hi' } : { messages: [{ role: 'user', content: 'hi' }] }) }) };
}

/** The engine's one model call, the way its CLI makes it (FAKE_CALL). */
async function modelCall() {
  const env = process.env;
  const codexBase = argv.map((a) => /^model_providers\.worca_relay\.base_url="(.*)"$/.exec(a)?.[1]).find(Boolean);
  let url; let headers = { 'content-type': 'application/json' }; let body; let model;
  if (codexBase) {
    model = env.FAKE_CALL_MODEL || flag('-m');
    url = `${codexBase}/responses`; headers.authorization = `Bearer ${env.WORCA_RELAY_KEY}`;
    body = JSON.stringify({ model, stream: true, input: 'hi' });
  } else if (env.COPILOT_PROVIDER_BASE_URL) {
    model = env.FAKE_CALL_MODEL || flag('--model');
    const anthropic = env.COPILOT_PROVIDER_TYPE === 'anthropic';
    const path = anthropic ? '/v1/messages' : env.COPILOT_PROVIDER_WIRE_API === 'responses' ? '/responses' : '/chat/completions';
    url = `${env.COPILOT_PROVIDER_BASE_URL}${path}`;
    if (anthropic) headers['x-api-key'] = env.COPILOT_PROVIDER_API_KEY; else headers.authorization = `Bearer ${env.COPILOT_PROVIDER_API_KEY}`;
    body = JSON.stringify({ model, stream: true, ...(anthropic ? { max_tokens: 5, messages: [{ role: 'user', content: 'hi' }] } : path === '/responses' ? { input: 'hi' } : { messages: [{ role: 'user', content: 'hi' }] }) });
  } else if (env.OPENCODE_CONFIG_CONTENT && JSON.parse(env.OPENCODE_CONFIG_CONTENT).provider) {
    // OpenCode: its provider block (baseURL, apiKey) in its inline config; the model is provider/model.
    const [provider, ...rest] = String(env.FAKE_CALL_MODEL || flag('-m') || flag('--model') || '').split('/');
    model = rest.join('/') || provider;
    const { baseURL, apiKey } = JSON.parse(env.OPENCODE_CONFIG_CONTENT).provider[provider]?.options || {};
    ({ url, headers, body } = providerCall(provider, baseURL, apiKey, model, headers));
  } else if (env.GOOGLE_GEMINI_BASE_URL || env.GOOGLE_HOST) {
    // Gemini CLI and Qwen Code's gemini mode (GOOGLE_GEMINI_BASE_URL), goose's google (GOOGLE_HOST).
    model = env.FAKE_CALL_MODEL || flag('--model') || 'gemini-2.5-pro';
    ({ url, headers, body } = providerCall('google', `${env.GOOGLE_GEMINI_BASE_URL || env.GOOGLE_HOST}/v1beta`, env.GEMINI_API_KEY || env.GOOGLE_API_KEY, model, headers));
  } else if (env.OPENAI_HOST || env.OPENAI_BASE_URL) {
    // goose's openai (an origin plus OPENAI_BASE_PATH) and Qwen Code's OpenAI-compatible mode (a base URL).
    model = env.FAKE_CALL_MODEL || flag('--model');
    url = env.OPENAI_HOST ? `${env.OPENAI_HOST}/${env.OPENAI_BASE_PATH}` : `${env.OPENAI_BASE_URL}/chat/completions`;
    headers.authorization = `Bearer ${env.OPENAI_API_KEY}`;
    body = JSON.stringify({ model, stream: true, messages: [{ role: 'user', content: 'hi' }] });
  } else if (env.OPENROUTER_HOST) {
    model = env.FAKE_CALL_MODEL || flag('--model');
    ({ url, headers, body } = providerCall('openrouter', `${env.OPENROUTER_HOST}/api/v1`, env.OPENROUTER_API_KEY, model, headers));
  } else if (env.ANTHROPIC_HOST) {
    model = env.FAKE_CALL_MODEL || flag('--model');
    ({ url, headers, body } = providerCall('anthropic', `${env.ANTHROPIC_HOST}/v1`, env.ANTHROPIC_API_KEY, model, headers));
  } else if (env.CURSOR_API_ENDPOINT) {
    url = `${env.CURSOR_API_ENDPOINT}/agent.v1.AgentService/RunSSE`;
    headers = { 'content-type': 'application/connect+proto', authorization: `Bearer ${env.CURSOR_AUTH_TOKEN}` };
    body = Buffer.from([0, 0, 0, 0, 0]);
  } else {
    model = env.FAKE_CALL_MODEL || flag('--model');
    url = `${env.ANTHROPIC_BASE_URL || 'https://api.anthropic.com'}/v1/messages`;
    if (env.ANTHROPIC_AUTH_TOKEN) headers.authorization = `Bearer ${env.ANTHROPIC_AUTH_TOKEN}`; else if (env.ANTHROPIC_API_KEY) headers['x-api-key'] = env.ANTHROPIC_API_KEY;
    headers['anthropic-version'] = '2023-06-01';
    body = JSON.stringify({ model, stream: true, max_tokens: 5, messages: [{ role: 'user', content: 'hi' }] });
  }
  try {
    const r = await fetch(url, { method: 'POST', headers, body });
    const text = Buffer.from(await r.arrayBuffer()).toString('latin1');
    return { url, status: r.status, body: text };
  } catch (err) { return { url, status: 0, body: String(err?.message || err) }; }
}

const rec = { argv, env: process.env, cwd: process.cwd(), pid: process.pid, pgid };
if (process.env.FAKE_FILES === '1') rec.files = stagedFiles();
if (out) writeFileSync(out, JSON.stringify(rec));
if (out && process.env.FAKE_GRANDCHILD !== '0') {
  spawn('sh', ['-c', 'sleep 600 & echo $! > "$1"; wait', 'fake-engine', `${out}.grand`],
    { stdio: ['ignore', process.env.FAKE_GRANDCHILD_STDOUT === '1' ? 'inherit' : 'ignore', 'ignore'] });
}
if (process.env.FAKE_CALL === '1') {
  rec.call = await modelCall();
  if (out) writeFileSync(out, JSON.stringify(rec));
}
const holdAfter = process.env.FAKE_HOLD_AFTER != null && process.env.FAKE_HOLD_AFTER !== '' ? Number(process.env.FAKE_HOLD_AFTER) : null;
if (process.env.FAKE_STREAM) {
  const lines = readFileSync(process.env.FAKE_STREAM, 'utf8').split('\n').filter((l) => l.trim());
  const [pauseAt, pauseMs] = String(process.env.FAKE_PAUSE || '').split(':').map(Number);
  for (const [i, line] of (holdAfter == null ? lines : lines.slice(0, holdAfter)).entries()) {
    if (i === pauseAt && pauseMs > 0) await new Promise((r) => setTimeout(r, pauseMs));
    process.stdout.write(`${line}\n`);
  }
}
if (process.env.FAKE_HOLD === '1' || holdAfter != null) setInterval(() => {}, 1000);
else setTimeout(() => process.exit(Number(process.env.FAKE_EXIT || 0)), 50);
