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
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { createAskTools, AskToolError } from './tools.mjs';
import { defaultToolDeps } from './tool-deps.mjs';
import { defaultWorktreeDeps } from './worktree-deps.mjs';

const SUPPORTED_PROTOCOLS = Object.freeze(['2024-11-05', '2025-03-26', '2025-06-18', '2025-11-25']);
const DEFAULT_PROTOCOL = '2025-06-18';
const PKG_VERSION = createRequire(import.meta.url)('../../../package.json').version;

/** `--home <base> --thread <id>`; a flag without a value is ignored. */
export function parseArgv(argv) {
  const out = { home: null, thread: null };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--home' && argv[i + 1] !== undefined) out.home = argv[++i];
    else if (argv[i] === '--thread' && argv[i + 1] !== undefined) out.thread = argv[++i];
  }
  return out;
}

/**
 * @param {{tools:{list:Function, call:Function}, write:(s:string)=>void, log?:(s:string)=>void, serverVersion?:string}} opts
 * @returns {{feed:(line:string)=>Promise<void>, idle:()=>Promise<void>}}
 */
export function createRpcServer({ tools, write, log = (s) => process.stderr.write(`${s}\n`), serverVersion = PKG_VERSION }) {
  const send = (msg) => write(`${JSON.stringify(msg)}\n`);
  const result = (id, res) => send({ jsonrpc: '2.0', id, result: res });
  const error = (id, code, message) => send({ jsonrpc: '2.0', id, error: { code, message } });
  const toolNames = () => new Set(tools.list().map((t) => t.name));

  async function handle(msg) {
    if (!msg || typeof msg !== 'object' || Array.isArray(msg)) return error(null, -32600, 'Invalid Request');
    const { id, method, params } = msg;
    const isNotification = id === undefined || id === null;
    if (typeof method !== 'string') return isNotification ? undefined : error(id, -32600, 'Invalid Request');
    if (isNotification) return undefined;                       // notifications/* — never answered
    switch (method) {
      case 'initialize': {
        const requested = params && typeof params.protocolVersion === 'string' ? params.protocolVersion : '';
        return result(id, {
          protocolVersion: SUPPORTED_PROTOCOLS.includes(requested) ? requested : DEFAULT_PROTOCOL,
          capabilities: { tools: {} },
          serverInfo: { name: 'worca', version: serverVersion },
        });
      }
      case 'ping':
        return result(id, {});
      case 'tools/list':
        return result(id, { tools: tools.list() });
      case 'tools/call': {
        const name = params && typeof params.name === 'string' ? params.name : '';
        const args = params && params.arguments !== undefined ? params.arguments : {};
        if (!name || !toolNames().has(name)) return error(id, -32602, `Invalid params: unknown tool ${JSON.stringify(name)}`);
        if (args === null || typeof args !== 'object' || Array.isArray(args)) return error(id, -32602, 'Invalid params: arguments must be an object');
        try {
          const out = await tools.call(name, args);
          return result(id, { content: [{ type: 'text', text: JSON.stringify(out ?? null) }] });   // never `undefined` → invalid JSON text
        } catch (err) {
          const message = err && err.message ? err.message : String(err);
          if (!(err instanceof AskToolError)) log(`[ask-mcp] ${name} failed: ${err && err.stack ? err.stack : message}`);
          return result(id, { content: [{ type: 'text', text: `error: ${message}` }], isError: true });
        }
      }
      default:
        return error(id, -32601, `Method not found: ${method}`);
    }
  }

  // One sequential chain: responses leave in request order, a slow tool never reorders them.
  let chain = Promise.resolve();
  return {
    feed(line) {
      const trimmed = String(line).trim();
      if (!trimmed) return chain;
      let msg;
      try { msg = JSON.parse(trimmed); } catch {
        chain = chain.then(() => error(null, -32700, 'Parse error'));   // through the chain: order preserved
        return chain;
      }
      for (const m of Array.isArray(msg) ? msg : [msg]) {
        chain = chain.then(() => handle(m)).catch((e) => log(`[ask-mcp] handler crashed: ${e && e.stack ? e.stack : e}`));
      }
      return chain;
    },
    idle: () => chain,
  };
}

export async function main({ argv = process.argv.slice(2), env = process.env, stdin = process.stdin, stdout = process.stdout } = {}) {
  const { home, thread } = parseArgv(argv);
  if (home) env.WORCA_HOME = home;                               // argv wins; worcaHome() reads the env at call time
  const threadId = thread || env.WORCA_ASK_THREAD_ID || null;
  const server = createRpcServer({
    tools: createAskTools({ ...defaultToolDeps({ threadId }), ...defaultWorktreeDeps({ threadId }) }),
    write: (s) => stdout.write(s),
  });
  const rl = createInterface({ input: stdin });
  rl.on('line', (line) => { server.feed(line); });
  await new Promise((resolve) => rl.on('close', resolve));
  await server.idle();
  await new Promise((resolve) => stdout.write('', resolve));      // macOS pipes are async: drain before exit
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().then(
    () => process.exit(0),
    (err) => { process.stderr.write(`[ask-mcp] fatal: ${err && err.stack ? err.stack : err}\n`); process.exit(1); },
  );
}
