// tools/spikes/session-host/lib.mjs — the Phase 0 session-host spike runner (session-groups plan, Task 1).
//
// Owner-run spikes spawn real harness CLIs and spend money: a live run refuses to start without
// WORCA_ALLOW_LIVE_CLAUDE=1. Agents run only `--dry`: every planned spawn prints as one `dry <label>: …` line and
// nothing is spawned or written. child_process is used ONLY through its default import (`cp.spawn`,
// `cp.execFileSync`), so test/spikes-session-host-lib.test.mjs can mock it and prove a --dry run spawns nothing.
import cp from 'node:child_process';
import { accessSync, constants as FS, existsSync, mkdirSync, readdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import http from 'node:http';
import { homedir, tmpdir } from 'node:os';
import { delimiter, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const HAIKU = 'claude-haiku-4-5';
export const SONNET = 'claude-sonnet-4-5';
/** The Docker pin (docker/CLAUDE_CODE_VERSION), run through npx; S2, S3 and S9 run on it as well as the local CLI. */
export const PINNED_BIN = 'npx -y @anthropic-ai/claude-code@2.1.294';
export const CLIS = Object.freeze([{ label: 'local', bin: 'claude' }, { label: '2.1.294', bin: PINNED_BIN }]);
/** What every worca host spawn carries (plan Global Constraints): no forked sub-agents, no background Agent calls. */
export const HOST_SPAWN_ENV = Object.freeze({ CLAUDE_CODE_FORK_SUBAGENT: '0', CLAUDE_CODE_DISABLE_BACKGROUND_TASKS: '1' });

// ---- argv and spawning -----------------------------------------------------------------------------------------

export function buildTurnArgv({ prompt, resume = null, agentsFile = null, extraArgs = [] }) {
  return ['-p', prompt, '--output-format', 'stream-json', '--verbose',
    ...(resume ? ['--resume', resume] : []), ...(agentsFile ? ['--agents', agentsFile] : []), ...extraArgs];
}

/** `'npx -y pkg@1'` → `{ file: 'npx', pre: ['-y', 'pkg@1'] }`. An array is `[file, ...pre]` (a path with spaces). */
export function splitBin(bin) {
  const parts = Array.isArray(bin) ? bin : String(bin).trim().split(/\s+/);
  return { file: parts[0], pre: parts.slice(1) };
}

/**
 * The env a spike child gets: this process's env plus `extra`, without NODE_TEST_CONTEXT. node:test sets it inside a
 * test process, and a `node --test` that inherits it skips every file and exits 0 (tools/test.mjs drops it too).
 */
export function childEnv(extra = {}) {
  const env = { ...process.env, ...extra };
  delete env.NODE_TEST_CONTEXT;
  return env;
}

/**
 * Spawn one JSONL-emitting CLI and collect its frames. Never throws or rejects: a missing binary, a non-zero exit
 * and an abort all resolve. Non-JSON stdout lines go to `stderr`. stdin is closed unless `input` is given.
 */
export function runJsonl({ bin, argv, cwd, env = {}, input = null, signal = null, onFrame = null }) {
  const { file, pre } = splitBin(bin);
  return new Promise((resolve) => {
    const frames = [];
    let stderr = '';
    let buf = '';
    let settled = false;
    const take = (line) => {
      if (!line.trim()) return;
      let frame;
      try { frame = JSON.parse(line); } catch { stderr += `${line}\n`; return; }
      frames.push(frame);
      if (onFrame) { try { onFrame(frame); } catch { /* an observer never breaks the turn */ } }
    };
    const finish = (code, sig) => {
      if (settled) return;
      settled = true;
      take(buf);
      buf = '';
      resolve({ frames, exitCode: code ?? -1, signal: sig ?? null, stderr });
    };
    let child;
    try {
      child = cp.spawn(file, [...pre, ...argv], { cwd, env: childEnv(env),
        stdio: [input == null ? 'ignore' : 'pipe', 'pipe', 'pipe'], ...(signal ? { signal } : {}) });
    } catch (err) { stderr += `${err.message}\n`; finish(-1, null); return; }
    child.stdout?.setEncoding('utf8').on('data', (chunk) => {
      buf += chunk;
      for (let i = buf.indexOf('\n'); i >= 0; i = buf.indexOf('\n')) { take(buf.slice(0, i)); buf = buf.slice(i + 1); }
    });
    child.stderr?.setEncoding('utf8').on('data', (chunk) => { stderr += chunk; });
    child.on('error', (err) => { stderr += `${err.name}: ${err.message}\n`; if (child.pid === undefined) finish(-1, null); });
    child.on('close', (code, sig) => finish(code, sig));
    if (input != null) { child.stdin.on('error', () => {}); child.stdin.end(input); }
  });
}

/** One `claude -p` stream-json turn (the host transport). `dry` returns the argv and spawns nothing. */
export async function runTurn({ bin = 'claude', cwd, prompt, resume = null, agentsFile = null, extraArgs = [], env = {},
  dry = false, signal = null, onFrame = null }) {
  const argv = buildTurnArgv({ prompt, resume, agentsFile, extraArgs });
  if (dry) return { argv, frames: [], exitCode: 0, signal: null, stderr: '', sessionId: null, result: null };
  const run = await runJsonl({ bin, argv, cwd, env: { ...HOST_SPAWN_ENV, ...env }, signal, onFrame });
  const top = run.frames.filter((f) => !f.parent_tool_use_id);
  const init = top.find((f) => f.type === 'system' && f.subtype === 'init');
  const result = top.filter((f) => f.type === 'result').at(-1) ?? null;
  return { argv, ...run, sessionId: init?.session_id ?? result?.session_id ?? null, result };
}

/** stdout+stderr of a short, free CLI call (`--version`, `--help`); '' when it cannot run. Live runs only. */
export function cliText(bin, args) {
  const { file, pre } = splitBin(bin);
  try {
    return cp.execFileSync(file, [...pre, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 180_000 });
  } catch (err) { return `${err.stdout ?? ''}${err.stderr ?? ''}`; }
}

/** `<dir>/agents-<n>.json`; `n` defaults to the next free index. `dry` returns the path without writing. */
export function writeAgentsFile(dir, defs, { n = null, dry = false } = {}) {
  const idx = n ?? 1 + (existsSync(dir) ? readdirSync(dir).filter((f) => /^agents-\d+\.json$/.test(f)).length : 0);
  const path = join(dir, `agents-${idx}.json`);
  if (!dry) { mkdirSync(dir, { recursive: true }); writeFileSync(path, `${JSON.stringify(defs, null, 2)}\n`); }
  return path;
}

/** Deterministic ASCII filler of at least `bytes` bytes that ends with `marker` (S1: a real brief's size). */
export function bigPrompt(bytes, marker) {
  const parts = [];
  let size = Buffer.byteLength(marker);
  for (let i = 0; size < bytes; i += 1) {
    const line = `Context line ${String(i).padStart(6, '0')}: padding that gives this brief a real size; no instruction.\n`;
    parts.push(line);
    size += line.length;
  }
  return parts.join('') + marker;
}

// ---- frame views -------------------------------------------------------------------------------------------------

const blocksOf = (f) => (Array.isArray(f?.message?.content) ? f.message.content : []);
const AGENT_TOOLS = new Set(['Agent', 'Task']);

export function summarize(frames) {
  const agentCalls = [];
  const toolCalls = [];
  const toolResults = [];
  const inits = [];
  const parents = new Set();
  let childFrames = 0;
  let cumulativeUsd = null;
  let usage = null;
  for (const f of frames) {
    const parent = f.parent_tool_use_id ?? null;
    if (parent) { childFrames += 1; parents.add(parent); }
    if (f.type === 'system' && f.subtype === 'init') inits.push({ parent, model: f.model ?? null, tools: f.tools ?? [] });
    if (f.type === 'assistant') {
      for (const b of blocksOf(f)) {
        if (b.type !== 'tool_use') continue;
        toolCalls.push({ id: b.id, name: b.name, parent });
        if (AGENT_TOOLS.has(b.name)) {
          agentCalls.push({ id: b.id, type: b.input?.subagent_type ?? null, parent, inputKeys: Object.keys(b.input ?? {}).sort() });
        }
      }
    }
    if (f.type === 'user') {
      for (const b of blocksOf(f)) {
        if (b.type === 'tool_result') toolResults.push({ id: b.tool_use_id, isError: b.is_error === true, meta: f.tool_use_result ?? null });
      }
    }
    if (f.type === 'result' && !parent) {
      if (typeof f.total_cost_usd === 'number') cumulativeUsd = f.total_cost_usd;
      if (f.usage) usage = f.usage;
    }
  }
  return { agentCalls, toolCalls, childFrames, parentIds: [...parents].sort(), toolResults, inits, cumulativeUsd, usage };
}

/** The tool_result for one tool_use id: `{ isError, text, meta }` (meta = the frame's tool_use_result) or null. */
export function toolResult(frames, id) {
  for (const f of frames) {
    if (f.type !== 'user') continue;
    for (const b of blocksOf(f)) {
      if (b.type !== 'tool_result' || b.tool_use_id !== id) continue;
      const text = typeof b.content === 'string' ? b.content
        : Array.isArray(b.content) ? b.content.map((c) => (typeof c?.text === 'string' ? c.text : '')).join('\n') : '';
      return { isError: b.is_error === true, text, meta: f.tool_use_result ?? null };
    }
  }
  return null;
}

/** The host's own Agent calls (no parent), in order. */
export const hostAgentCalls = (frames) => summarize(frames).agentCalls.filter((c) => c.parent === null);

/** The host's Agent call for one sub-agent type, its result and the child's frames. */
export function childCall(frames, type) {
  const call = hostAgentCalls(frames).find((c) => c.type === type) ?? null;
  return { call, result: call ? toolResult(frames, call.id) : null, frames: call ? frames.filter((f) => f.parent_tool_use_id === call.id) : [] };
}

/** Distinct assistant messages (stream-json may split one message over frames). `parent` undefined = all, null = the host. */
export function assistantMessages(frames, parent) {
  const byId = new Map();
  for (const f of frames) {
    if (f.type !== 'assistant') continue;
    if (parent !== undefined && (f.parent_tool_use_id ?? null) !== parent) continue;
    const id = f.message?.id ?? `frame-${byId.size}`;
    byId.set(id, { id, model: f.message?.model ?? null, usage: f.message?.usage ?? null });
  }
  return [...byId.values()];
}

const USAGE_KEYS = ['input_tokens', 'output_tokens', 'cache_read_input_tokens', 'cache_creation_input_tokens'];
export function sumUsage(list) {
  const out = Object.fromEntries(USAGE_KEYS.map((k) => [k, 0]));
  for (const u of list) if (u) for (const k of USAGE_KEYS) out[k] += Number(u[k] ?? 0);
  return out;
}

export function median(xs) {
  const s = xs.filter((x) => Number.isFinite(x)).sort((a, b) => a - b);
  if (!s.length) return null;
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

// Text-bearing keys (plan Task 1) plus path- and output-bearing keys: the S9 fixture is committed to the repo.
// `output` is a hook_response's whole hook payload (worca's sub-agent hook is `cat`: transcript_path, cwd, the prompt
// and the child's reply); a string `tool_use_result` is a tool error, which can print the cwd. `signature` is a thinking
// block's encrypted signature (tools/ask-capture-fixtures.mjs blanks it too); `message` and `error` here are only string
// values (plugin_errors[].message, an error frame's text), never a frame's message object.
const STRIP_KEYS = new Set(['text', 'thinking', 'content', 'prompt', 'command', 'description', 'result', 'stdout',
  'stderr', 'cwd', 'path', 'file_path', 'filePath', 'pattern', 'old_string', 'new_string', 'output', 'tool_use_result',
  'transcript_path', 'scratchpad_dir', 'scratchpad_path', 'messaging_socket_path', 'output_file', 'summary', 'detail',
  'status_detail', 'task_description', 'signature', 'outputFile', 'needs_action', 'error', 'message', 'partial_json']);
// Keys whose value is an object or array of paths (init.memory_paths, Glob's tool_use_result.filenames) or of the
// owner's installed inventory (init's skills, slash commands, agents, plugins, MCP server names and mcp__<server>__
// tool names): every string in it.
const BLANK_KEYS = new Set(['memory_paths', 'filenames', 'skills', 'slash_commands', 'agents', 'plugins', 'mcp_servers', 'tools']);

/**
 * [root, placeholder] pairs replaced inside every string strip() keeps, longest first (tools/ask-capture-fixtures.mjs
 * createSanitizer): the home dir, the tmpdir and the cwd, each also as its realpath (macOS: /var → /private/var) and in
 * the dashed form Claude names a project folder by (~/.claude/projects/-Users-…).
 */
function stripRoots() {
  const real = (p) => { try { return realpathSync(p); } catch { return p; } };
  const pairs = [[homedir(), '/HOME'], [tmpdir(), '/TMP'], [real(tmpdir()), '/TMP'], [process.cwd(), '/REPO'],
    [real(process.cwd()), '/REPO']].filter(([root]) => root && root.length > 1);
  return [...pairs, ...pairs.map(([root, ph]) => [root.replace(/[^A-Za-z0-9]/g, '-'), ph.replace('/', '-')])]
    .sort((a, b) => b[0].length - a[0].length);
}

const blank = (v) => (typeof v === 'string' ? 'x' : Array.isArray(v) ? v.map(blank)
  : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, blank(x)])) : v);

/**
 * Replace, at any depth, every string value of STRIP_KEYS and every string under BLANK_KEYS with "x", and the home,
 * tmp and cwd roots in every other string with a placeholder. Ids, types, names, usage, model and cost survive.
 */
export function strip(frame) {
  const roots = stripRoots();
  const walk = (v) => {
    if (typeof v === 'string') return roots.reduce((s, [root, ph]) => s.split(root).join(ph), v);
    if (Array.isArray(v)) return v.map(walk);
    if (!v || typeof v !== 'object') return v;
    const out = {};
    for (const [k, x] of Object.entries(v)) {
      out[k] = BLANK_KEYS.has(k) ? blank(x) : STRIP_KEYS.has(k) && typeof x === 'string' ? 'x' : walk(x);
    }
    return out;
  };
  return walk(frame);
}

// ---- API request facts and the recording proxy ------------------------------------------------------------------

function textValues(v, out = []) {
  if (Array.isArray(v)) { for (const x of v) textValues(x, out); return out; }
  if (v && typeof v === 'object') {
    for (const [k, x] of Object.entries(v)) {
      if ((k === 'text' || k === 'content') && typeof x === 'string') out.push(x); else textValues(x, out);
    }
  }
  return out;
}

/** Sizes and marker hits of one Messages API request body; never its text. */
export function requestFacts(body, markers = []) {
  const blocks = typeof body?.system === 'string' ? [body.system]
    : Array.isArray(body?.system) ? body.system.filter((b) => b?.type === 'text').map((b) => b.text ?? '') : [];
  const system = blocks.join('');
  const messages = textValues(body?.messages ?? []).join('\n');
  return {
    model: body?.model ?? null,
    systemBytes: Buffer.byteLength(system),
    markersInSystem: markers.filter((m) => system.includes(m)),
    markersInMessages: markers.filter((m) => messages.includes(m)),
  };
}

const HOP_BY_HOP = new Set(['host', 'connection', 'keep-alive', 'proxy-connection', 'transfer-encoding', 'upgrade',
  'content-length', 'accept-encoding']);

/** The owner's own API base (a gateway, say) when set, else the first-party API. The spike's child gets the proxy. */
export const defaultUpstream = (env = process.env) => (env.ANTHROPIC_BASE_URL || 'https://api.anthropic.com').replace(/\/+$/, '');

/**
 * A loopback proxy the spike points ANTHROPIC_BASE_URL at. It forwards each request (method, body, auth and the
 * other end-to-end headers) and streams the reply back; per Messages request it records `requestFacts`, the
 * `thinking` setting's type/budget and the body's key names — sizes and names only, never text.
 */
export async function recordingProxy({ upstream = defaultUpstream(), markers = [] } = {}) {
  const seen = [];
  const server = http.createServer(async (req, res) => {
    const chunks = [];
    for await (const c of req) chunks.push(c);
    const body = Buffer.concat(chunks);
    let json = null;
    try { json = body.length ? JSON.parse(body.toString('utf8')) : null; } catch { /* not JSON: forwarded, not recorded */ }
    if (json && Array.isArray(json.messages)) {
      seen.push({ path: req.url.split('?')[0], ...requestFacts(json, markers),
        thinking: json.thinking ? { type: json.thinking.type ?? null, budgetTokens: json.thinking.budget_tokens ?? null } : null,
        bodyKeys: Object.keys(json).sort() });
    }
    const headers = {};
    for (const [k, v] of Object.entries(req.headers)) if (!HOP_BY_HOP.has(k)) headers[k] = v;
    headers['accept-encoding'] = 'identity';          // fetch would decode gzip and the client would decode it again
    try {
      const up = await fetch(upstream + req.url, { method: req.method, headers, body: body.length ? body : undefined });
      const out = {};
      up.headers.forEach((v, k) => { if (!HOP_BY_HOP.has(k) && k !== 'content-encoding') out[k] = v; });
      res.writeHead(up.status, out);
      if (up.body) for await (const c of up.body) res.write(c);
      res.end();
    } catch (err) {
      if (!res.headersSent) res.writeHead(502, { 'content-type': 'text/plain' });
      res.end(`spike proxy: ${err.message}`);
    }
  });
  await new Promise((ok) => server.listen(0, '127.0.0.1', ok));
  return {
    url: `http://127.0.0.1:${server.address().port}`,
    requests: () => seen.slice(),
    close: () => new Promise((ok) => { server.closeAllConnections?.(); server.close(() => ok()); }),
  };
}

// ---- verdicts, dry printing, the spike context ------------------------------------------------------------------

/** One JSON verdict line. false ⇒ exit code 3; true never clears an earlier 3; null (skipped) leaves it alone. */
export function verdict(spike, pass, facts, { log = console.log } = {}) {
  log(JSON.stringify({ spike, pass, facts }));
  if (pass === false) process.exitCode = 3;
  else if (pass === true && !process.exitCode) process.exitCode = 0;
}

const SAFE_ARG = /^[\w@%+=:,./<>-]+$/;               // printed bare (placeholders such as <session-1> included)
export function shellArg(arg) {
  const s = String(arg);
  if (s.length > 2000 || s.includes('\n')) return `<${Buffer.byteLength(s)} bytes>`;
  return SAFE_ARG.test(s) ? s : `'${s.replace(/'/g, `'\\''`)}'`;
}

/** `dry <label>: [ENV=v …] <bin> <args…>` — one line per planned spawn. */
export function dryLine(label, { bin = 'claude', argv, env = {} }) {
  const envPart = Object.entries(env).map(([k, v]) => `${k}=${shellArg(v)}`);
  return `dry ${label}: ${[...envPart, Array.isArray(bin) ? bin.join(' ') : bin, ...argv.map(shellArg)].join(' ')}`;
}

/** The executable `name` on PATH (pure fs; no `which`), or null. */
export function onPath(name, pathVar = process.env.PATH ?? '') {
  for (const dir of pathVar.split(delimiter)) {
    if (!dir) continue;
    const p = join(dir, name);
    try { accessSync(p, FS.X_OK); return p; } catch { /* not here */ }
  }
  return null;
}

export function assertLiveSpikeAllowed(env = process.env) {
  if (env.WORCA_ALLOW_LIVE_CLAUDE === '1') return;
  throw new Error('refusing a live spike run: it spawns real harness CLIs and spends money. '
    + 'Use --dry, or (owner only) re-run with WORCA_ALLOW_LIVE_CLAUDE=1.');
}

/**
 * Per-script state. `turn` runs (or, with --dry, prints) one claude turn; `run` does the same for any JSONL CLI
 * (S10). Live runs write each turn's frames to `<out>/frames-<n>.ndjson`; --dry writes nothing at all.
 */
export function spikeContext(id, args = [], { log = console.log } = {}) {
  const dry = args.includes('--dry');
  if (!dry) assertLiveSpikeAllowed();
  const out = join(tmpdir(), 'worca-spikes', id);
  if (!dry) { rmSync(out, { recursive: true, force: true }); mkdirSync(out, { recursive: true }); }
  let agentsN = 0;
  let framesN = 0;
  const record = (label, bin, env, run) => {
    if (dry) log(dryLine(label, { bin, argv: run.argv, env }));
    else writeFileSync(join(out, `frames-${++framesN}.ndjson`), run.frames.map((f) => `${JSON.stringify(f)}\n`).join(''));
    return run;
  };
  return {
    id, dry, out, log,
    note: (text) => log(`# ${text}`),
    scratch(name, { git = false } = {}) {
      const dir = join(out, name);
      if (!dry) {
        mkdirSync(dir, { recursive: true });
        if (git) cp.execFileSync('git', ['init', '-q'], { cwd: dir, stdio: 'ignore' });
      }
      return dir;
    },
    file(path, text) {
      if (!dry) { mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, text); }
      return path;
    },
    agents: (defs) => writeAgentsFile(out, defs, { n: ++agentsN, dry }),
    turn: async (label, opts) => record(label, opts.bin ?? 'claude', opts.env ?? {}, await runTurn({ ...opts, dry })),
    run: async (label, opts) => record(label, opts.bin, opts.env ?? {},
      dry ? { argv: opts.argv, frames: [], exitCode: 0, signal: null, stderr: '' } : { argv: opts.argv, ...(await runJsonl(opts)) }),
  };
}

/** True when this module is the process entry point (realpath-safe; tools/requirements-replay.mjs idiom). */
export function isMain(metaUrl) {
  try { return realpathSync(process.argv[1]) === realpathSync(fileURLToPath(metaUrl)); } catch { return false; }
}
