#!/usr/bin/env node
// src/core/ask/mcp-stdio.mjs
// The worca MCP server of the Ask Worca sandbox (ask-worca-design.md §6.4, D11):
// a hand-rolled JSON-RPC 2.0 server over stdio — newline-delimited JSON, one
// message per line (the MCP stdio transport rule), stdout carrying ONLY protocol
// messages, diagnostics on stderr. claude spawns it once per process through the
// per-turn --mcp-config and closes its stdin on shutdown; the server then exits 0.
//
// Probed on claude 2.1.239: request ids start at 0 (so a notification is
// id === undefined || id === null); the client sends initialize (protocolVersion
// '2025-11-25') → notifications/initialized → tools/list → tools/call{name,
// arguments, _meta}; with only capabilities.tools advertised it never sends
// resources/prompts/roots/ping. Tool-execution failures are returned INSIDE the
// result as isError:true text so the model can self-correct; unknown tools and
// non-object arguments are -32602; unknown methods -32601; parse errors -32700.
//
// WORCA_HOME / WORCA_ASK_THREAD_ID come from the env (mcpServers.env) or from
// `--home <base> --thread <id>` (argv wins). The DB opens lazily on the first
// tool call through db.mjs (WAL, busy_timeout, open-retry — second-process
// access is designed for).
import { createInterface } from 'node:readline';
import { pathToFileURL } from 'node:url';
import { createAskTools } from './tools.mjs';
import { createRpcServer } from './rpc-server.mjs';
import { defaultToolDeps } from './tool-deps.mjs';
import { defaultWorktreeDeps } from './worktree-deps.mjs';
import { defaultMemoryDeps } from './memory-deps.mjs';
import { defaultScriptDeps } from './script-deps.mjs';
import { defaultCommentDeps } from './comment-deps.mjs';
import { defaultWorkflowDeps } from './workflow-deps.mjs';
import { defaultMetricsDeps } from './metrics-deps.mjs';
import { defaultPolicyDeps } from './policy-deps.mjs';
import { defaultAwayDeps } from './away-deps.mjs';
import { defaultScheduleDeps } from './schedule-deps.mjs';
import { defaultSourceDeps } from './source-deps.mjs';
import { defaultModelDeps } from './model-deps.mjs';
import { defaultCloneDeps } from './clone-deps.mjs';
import { defaultWorkspaceDeps } from './workspace-deps.mjs';
import { defaultActionsDeps } from './actions-deps.mjs';
import { defaultWebDeps } from './web-deps.mjs';
import { defaultFileDeps } from './file-deps.mjs';
import { defaultCommandDeps } from './command-deps.mjs';
import { defaultBranchDeps } from './branch-deps.mjs';

// The JSON-RPC server itself lives in rpc-server.mjs (re-exported: tests and the Codex file tools use it).
export { createRpcServer } from './rpc-server.mjs';

/** `--home <base> --thread <id> [--relay <url>]`; a flag without a value is ignored. */
export function parseArgv(argv) {
  const out = { home: null, thread: null, relay: null };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--home' && argv[i + 1] !== undefined) out.home = argv[++i];
    else if (argv[i] === '--thread' && argv[i + 1] !== undefined) out.thread = argv[++i];
    else if (argv[i] === '--relay' && argv[i + 1] !== undefined) out.relay = argv[++i];
  }
  return out;
}

/**
 * The worca tools of one chat, wired to their real deps. Used by this process (the classic
 * mode, where the MCP child reads worca's database itself) and, in relay mode, by the worca
 * server (ui/server.mjs /api/ask/relay), when the chat's claude runs as an agent user that
 * cannot read that database (agent-pool.mjs, credential broker).
 */
export function createAskToolServer({ threadId, reader = null, signal, write, log, env = process.env, extraDeps = {} }) {
  return createRpcServer({
    tools: createAskTools({
      ...defaultToolDeps({ threadId, viewer: reader }),
      ...defaultWorktreeDeps({ threadId }),
      ...defaultMemoryDeps({ threadId }),
      // The life signal (already built for propose_workflow's nested classifier): the turn
      // ending or being stopped also stops a bench run still going.
      ...defaultScriptDeps({ threadId, signal }),
      ...defaultCommentDeps(),
      ...defaultWorkflowDeps({ threadId, signal, env }),
      ...defaultMetricsDeps({ threadId }),
      ...defaultPolicyDeps({ threadId }),
      ...defaultAwayDeps(),
      ...defaultScheduleDeps({ threadId, reader }),
      ...defaultSourceDeps(),
      ...defaultModelDeps({ threadId }),
      ...defaultCloneDeps(),
      ...defaultWorkspaceDeps(),
      // Actions (docs/actions.md "Ask Worca"): read the config, checkouts and running services; propose config.
      ...defaultActionsDeps(),
      // Branch reads + fetch-only (#527): list_branches, list_projects.sync, get_run.baseMoved.
      ...defaultBranchDeps(),
      // Web access: present only when this turn's env carries WORCA_ASK_WEB (web-deps.mjs) — the
      // child's env (classic), or the relay's own copy built from the turn's web access (ui/server.mjs).
      ...defaultWebDeps({ threadId, signal, env }),
      // Codex chats only (WORCA_ASK_ENGINE=codex): read_file / grep / glob under the shared deny rules (D13).
      ...defaultFileDeps({ threadId, env, signal }),
      // Agent mode (#574): present only when this turn's env names the command bridge (command-deps.mjs).
      ...defaultCommandDeps({ env }),
      // Readers only the host process can supply (relay mode: ui/server.mjs passes
      // readLiveDiff, which needs the live runs). Absent in the classic child.
      ...extraDeps,
    }),
    write,
    ...(log ? { log } : {}),
  });
}

/**
 * Relay mode: every JSON-RPC line from claude goes to the worca server, which runs the tool
 * (createAskToolServer) and answers with the output lines. One line at a time, in order.
 * The per-turn token (WORCA_ASK_RELAY_TOKEN) is the only credential, and only for this chat.
 */
async function relayMain({ url, token, stdin, stdout, fetchImpl = globalThis.fetch }) {
  const rl = createInterface({ input: stdin });
  let chain = Promise.resolve();
  rl.on('line', (line) => {
    if (!String(line).trim()) return;
    chain = chain.then(async () => {
      try {
        const res = await fetchImpl(url, {
          method: 'POST',
          headers: { 'content-type': 'application/json', 'x-worca-relay': token },
          body: JSON.stringify({ line }),
        });
        const j = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(j.error || `HTTP ${res.status}`);
        for (const out of j.out || []) stdout.write(out.endsWith('\n') ? out : `${out}\n`);
      } catch (err) {
        let id = null;
        try { id = JSON.parse(line).id ?? null; } catch { /* unparseable: id stays null */ }
        if (id !== null) stdout.write(`${JSON.stringify({ jsonrpc: '2.0', id, error: { code: -32603, message: `worca is not reachable: ${err.message}` } })}\n`);
      }
    });
  });
  await new Promise((resolve) => rl.on('close', resolve));
  await chain;
  await new Promise((resolve) => stdout.write('', resolve));
}

export async function main({ argv = process.argv.slice(2), env = process.env, stdin = process.stdin, stdout = process.stdout } = {}) {
  // MCP registry §5.5.2: the CLI hands this child every registry copy's secret (MCPSECRET_*); worca's own tools,
  // the scripts test_script runs in-process and their nested spawns get none of them.
  for (const e of new Set([process.env, env])) for (const k of Object.keys(e)) if (/^MCPSECRET_/i.test(k)) delete e[k];
  const { home, thread, relay } = parseArgv(argv);
  if (relay) {
    return relayMain({ url: relay, token: String(env.WORCA_ASK_RELAY_TOKEN || ''), stdin, stdout });
  }
  if (home) env.WORCA_HOME = home;                               // argv wins; worcaHome() reads the env at call time
  const threadId = thread || env.WORCA_ASK_THREAD_ID || null;
  // P3 (v7): stdin closing == the chat turn ended or was stopped — abort whatever propose_workflow is still classifying
  // (its result could never be delivered), so the drain below returns promptly instead of after the classifier's timeout.
  const life = new AbortController();
  const server = createAskToolServer({
    threadId, reader: process.env.WORCA_ASK_READER || null, signal: life.signal, env,
    write: (s) => stdout.write(s),
  });
  const rl = createInterface({ input: stdin });
  rl.on('line', (line) => { server.feed(line); });
  await new Promise((resolve) => rl.on('close', resolve));
  life.abort();
  await server.idle();
  await new Promise((resolve) => stdout.write('', resolve));      // macOS pipes are async: drain before exit
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().then(
    () => process.exit(0),
    (err) => { process.stderr.write(`[ask-mcp] fatal: ${err && err.stack ? err.stack : err}\n`); process.exit(1); },
  );
}
