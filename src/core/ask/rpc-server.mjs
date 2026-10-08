// src/core/ask/rpc-server.mjs
// The MCP JSON-RPC 2.0 server over newline-delimited stdio lines (protocol notes in mcp-stdio.mjs), over any
// {list(), call()} tool table: the Ask Worca child's worca tools (mcp-stdio.mjs) and a Codex helper job's
// file tools (engines/codex-files-mcp.mjs). No tool imports, so a small server stays small.
import { createRequire } from 'node:module';
import { AskToolError } from './tools.mjs';

const SUPPORTED_PROTOCOLS = Object.freeze(['2024-11-05', '2025-03-26', '2025-06-18', '2025-11-25']);
const DEFAULT_PROTOCOL = '2025-06-18';
const PKG_VERSION = createRequire(import.meta.url)('../../../package.json').version;

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
