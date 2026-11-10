#!/usr/bin/env node
// src/core/design/web-mcp.mjs
// The MCP server a Design lead gets when "Let the lead use the web" is on (docs/design.md "Web access"): one tool,
// `save_image`, over the same newline-delimited JSON-RPC as Ask's server (ask/rpc-server.mjs). The engine's CLI starts
// it from the build's MCP config (`designWebMcpConfig`); it reads its design's source folder from
// WORCA_DESIGN_WEB_WORK and appends one line per call to WORCA_DESIGN_WEB_LOG. It opens no database and reads no
// settings: everything it may do is in web-image.mjs.

import { appendFileSync, mkdirSync, renameSync, statSync } from 'node:fs';
import { dirname } from 'node:path';
import { createInterface } from 'node:readline';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRpcServer } from '../ask/rpc-server.mjs';
import { AskToolError, MCP_CONTENT } from '../ask/tools.mjs';
import { WebAccessError } from '../ask/web-fetch.mjs';
import { createImageSaver } from './web-image.mjs';

/** The server's name in an MCP config, and so the prefix of its tool in every engine. */
export const DESIGN_WEB_SERVER = 'worca_design_web';
/** Claude's grant for every tool of the server (`--allowedTools`). */
export const DESIGN_WEB_GRANT = `mcp__${DESIGN_WEB_SERVER}`;
/** Proxy and CA variables the child needs to reach the internet where worca itself does through a proxy. */
const FORWARD_ENV = Object.freeze(['HTTPS_PROXY', 'https_proxy', 'HTTP_PROXY', 'http_proxy', 'NO_PROXY', 'no_proxy', 'NODE_EXTRA_CA_CERTS']);
const LOG_MAX_BYTES = 5 * 1024 * 1024;
const SERVER_PATH = fileURLToPath(import.meta.url);

const SAVE_IMAGE = Object.freeze({
  name: 'save_image',
  description: 'Download one picture from the web into this design, as a new file in assets/web/. Give the picture\'s own https URL (not the page around it). Returns the file to point at, such as assets/web/hero.png, and shows you the picture when it is small enough. PNG, JPEG, GIF, WebP, AVIF and SVG only, at most 8 MB each.',
  inputSchema: {
    type: 'object',
    properties: {
      url: { type: 'string', description: 'The https URL of the picture file.' },
      name: { type: 'string', description: 'Optional short file name without an extension, such as "pricing-screenshot". Default: taken from the URL.' },
    },
    required: ['url'],
    additionalProperties: false,
  },
});

/** The tool table of one design's web server. */
export function createDesignWebTools({ saver }) {
  return {
    list: () => [SAVE_IMAGE],
    async call(name, args) {
      if (name !== SAVE_IMAGE.name) throw new AskToolError(`unknown tool ${name}`);
      if (typeof args.url !== 'string' || !args.url.trim()) throw new AskToolError('save_image needs a url');
      if (args.name !== undefined && typeof args.name !== 'string') throw new AskToolError('save_image: name must be text');
      let out;
      try { out = await saver.save(args.url, args.name ?? null); } catch (err) {
        if (err instanceof WebAccessError) throw new AskToolError(err.message);
        throw err;
      }
      const { inline, ...body } = out;
      return { ...body, use: `Point at it as ${body.file} (relative to work/).`, ...(inline ? { [MCP_CONTENT]: [{ type: 'image', data: inline.data, mimeType: inline.mimeType }] } : {}) };
    },
  };
}

/** One JSON line per download (refusals too) in `file`, URLs clipped. Never throws. */
export function designWebLogger(file) {
  return (entry) => {
    if (!file) return;
    try {
      mkdirSync(dirname(file), { recursive: true });
      try { if (statSync(file).size > LOG_MAX_BYTES) renameSync(file, `${file}.1`); } catch { /* first write */ }
      appendFileSync(file, `${JSON.stringify({ ts: new Date().toISOString(), ...entry })}\n`, { encoding: 'utf8', mode: 0o600 });
    } catch (err) { process.stderr.write(`[design-web] log failed: ${err?.message || err}\n`); }
  };
}

/**
 * The MCP config document of one design's web server (`--mcp-config`): its only server, started with this node.
 * @param {{ workDir: string, logFile?: string|null, execPath?: string, env?: object }} opts
 * @returns {{ mcpServers: object }}
 */
export function designWebMcpConfig({ workDir, logFile = null, execPath = process.execPath, env = process.env }) {
  const forwarded = {};
  for (const k of FORWARD_ENV) if (typeof env?.[k] === 'string' && env[k] !== '') forwarded[k] = env[k];
  return {
    mcpServers: {
      [DESIGN_WEB_SERVER]: {
        type: 'stdio',
        command: execPath,
        args: ['--disable-warning=ExperimentalWarning', SERVER_PATH],
        env: { WORCA_DESIGN_WEB_WORK: workDir, ...(logFile ? { WORCA_DESIGN_WEB_LOG: logFile } : {}), ...forwarded },
      },
    },
  };
}

function main() {
  const workDir = process.env.WORCA_DESIGN_WEB_WORK;
  if (!workDir) { process.stderr.write('[design-web] WORCA_DESIGN_WEB_WORK is not set\n'); process.exit(2); }
  const abort = new AbortController();
  const saver = createImageSaver({ workDir, signal: abort.signal, log: designWebLogger(process.env.WORCA_DESIGN_WEB_LOG || null) });
  const server = createRpcServer({
    tools: createDesignWebTools({ saver }),
    write: (s) => process.stdout.write(s),
    log: (s) => process.stderr.write(`${s}\n`),
  });
  const rl = createInterface({ input: process.stdin, crlfDelay: Infinity });
  rl.on('line', (line) => { void server.feed(line); });
  rl.on('close', () => { void server.idle().then(() => { abort.abort(); process.exit(0); }); });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
