// src/core/mcp/test.mjs
// Test (spec §7.3): start one membership exactly as a spawn would (P3 materializeCopy: launcher,
// keep-list env, MCPCHILD_* declared env; agentSpawn under isolation), run initialize + tools/list
// through the MCP SDK with a 2-minute bound (timeouts.mjs), kill the whole process tree, and store the result. The
// connect runs outside the store lock; recordTest re-reads under it and writes only this entry.
import { spawn, spawnSync } from 'node:child_process';
import { McpStoreError, recordTest } from './store.mjs';
import { keepListEnv } from './keep-list.mjs';
import { copyName } from './identity.mjs';
import { materializeCopy, skipReasonText } from './registry.mjs';
import { viewContext, setMembers, membershipKeys } from './views.mjs';
import { createRedactor } from '../redact.mjs';
import { agentSpawn, killAgentGroup } from '../agent-user.mjs';
import { agentIdentityFor } from '../agent-pool.mjs';
import { currentOwner } from '../billing.mjs';
import { MCP_STARTUP_MS, mcpStartupMs } from './timeouts.mjs';

export const TEST_TIMEOUT_MS = MCP_STARTUP_MS.test;
const MAX_TOOLS = 10000;   // a tools/list that pages past this fails the Test (a cursor that never ends fills the heap)
const REF_RE = /\$\{(MCPSECRET_[0-9A-F]{8})\}/g;
const own = (o, k) => !!o && Object.hasOwn(o, k);
const SCHEMA_MAX = 20000;   // a tool's input schema is kept up to 20 KB of JSON: tests.json holds every membership's last Test
/** What a Test keeps of one listed tool: its name, and for the workflow-test stand-ins (D35) its description, input
 *  schema and annotations. */
export function toolRecord(x) {
  const out = { name: String((x && x.name) ?? '') };
  if (x && typeof x.description === 'string' && x.description) out.description = x.description.slice(0, 2000);
  if (x && x.inputSchema && typeof x.inputSchema === 'object' && JSON.stringify(x.inputSchema).length <= SCHEMA_MAX) out.inputSchema = x.inputSchema;
  if (x && x.annotations && typeof x.annotations === 'object') out.annotations = x.annotations;
  return out;
}

/** One membership as a spawn would start it (P3 materializeCopy, this membership only, with the
 *  context's host facts): `{ entry, env, secretValues, fingerprint }`, or the §7.3 refusal as a
 *  McpStoreError (400 "fill in <field>" for a missing required field, else 409). A Team member nobody
 *  consented to never runs, not even for a Test. */
export function materializeForTest(ctx, setId, serverId) {
  const live = setMembers(ctx, setId);
  if (!live) throw new McpStoreError(404, 'set not found');
  const m = live.members.find((x) => x.serverId === serverId);
  if (!m) throw new McpStoreError(404, 'not a member of this set');
  const refuse = (reason) => {
    const text = skipReasonText({ serverId, reason }, ctx.catalog);
    return reason.startsWith('missing:') ? new McpStoreError(400, `fill in ${text.replace(/ not set$/, '')}`) : new McpStoreError(409, text);
  };
  const entry = ctx.catalog.find((x) => x.id === serverId);
  if (!entry) throw refuse('missing-server');
  if (!entry.pluginEnabled) throw refuse('plugin-disabled');
  if (live.set.group === 'team' && m.consent === null) throw new McpStoreError(409, 'turn it on from the team checklist');
  const copy = copyName(entry.base, live.set.slug);
  const secrets = ctx.snapshot.secrets[setId]?.[serverId] || {};
  const mat = materializeCopy({ entry, values: m.values, secrets, copy, name: copy }, ctx);
  if (mat.reason) throw refuse(mat.reason);
  return { entry: mat.server, env: mat.env, secretValues: mat.secretValues, fingerprint: mat.fingerprint };
}

/** The entry with its `${MCPSECRET_…}` refs replaced from `env`, single pass (no `claude` in between). */
function expand(entry, env) {
  const fill = (s) => (typeof s === 'string' ? s.replace(REF_RE, (m, n) => (own(env, n) ? env[n] : m)) : s);
  const map = (o) => Object.fromEntries(Object.entries(o || {}).map(([k, v]) => [k, fill(v)]));
  return entry.command
    ? { command: entry.command, args: entry.args.map(fill), env: map(entry.env) }
    : { type: entry.type, url: fill(entry.url), headers: map(entry.headers) };
}

/** The SDK, loaded by the first Test rather than with the server. */
const loadSdk = () => Promise.all([
  import('@modelcontextprotocol/sdk/client/index.js'), import('@modelcontextprotocol/sdk/client/streamableHttp.js'),
  import('@modelcontextprotocol/sdk/client/sse.js'), import('@modelcontextprotocol/sdk/shared/stdio.js'),
]);

/** A Transport over a spawned child's stdio (the SDK's own framing), so the child is ours to spawn. Nothing
 *  throws out of a stream listener: there it would end the whole server (the SDK's ReadBuffer throws once a
 *  line passes 10 MB); such a server closes, and the reason becomes its last stderr line. */
function childTransport(child, stderr, { ReadBuffer, serializeMessage }) {
  const buf = new ReadBuffer();
  const t = {
    async start() {
      child.stdout.on('data', (chunk) => {
        try { buf.append(chunk); } catch (err) {
          stderr.add(`\n${err.message}\n`);
          child.stdout.destroy();
          t.onclose?.();
          return;
        }
        for (;;) {
          let msg;
          try { msg = buf.readMessage(); } catch (err) { t.onerror?.(err); continue; }
          if (msg === null) break;
          t.onmessage?.(msg);
        }
      });
      child.stderr.on('data', (c) => stderr.add(String(c)));
      // A server that stops reading (closed its stdin, or exited between two writes) fails the next write with EPIPE:
      // an 'error' nobody hears would end the worca server; here it ends the connection, with that reason.
      child.stdin.on('error', (err) => { stderr.add(`\n${err.message}\n`); t.onclose?.(); });
      child.on('close', () => t.onclose?.());
    },
    async send(message) { child.stdin.write(serializeMessage(message)); },
    async close() { child.stdin.end(); t.onclose?.(); },
  };
  return t;
}

/** Kill the probe's process tree: the group on POSIX (and through sudo under agent isolation),
 *  `taskkill /T /F` on Windows, where killing the cmd.exe wrapper alone leaves npx/node running. taskkill and the
 *  sudo kill run only while the child runs: after it exits its pid may be reused (script-runner killTree does the same). */
export function killProbe(child, { platform = process.platform, agent = null, kill = process.kill,
  spawnSyncImpl = spawnSync, killGroup = killAgentGroup } = {}) {
  const alive = child.exitCode == null && child.signalCode == null;
  if (platform === 'win32') {
    if (alive) spawnSyncImpl('taskkill', ['/T', '/F', '/PID', String(child.pid)], { stdio: 'ignore', windowsHide: true });
    return;
  }
  try { kill(-child.pid, 'SIGKILL'); } catch { /* the group is gone */ }
  if (agent && alive) killGroup(child.pid, agent);
}

/** initialize + tools/list against one expanded entry → tool records (toolRecord). Throws on failure or timeout;
 *  `err.rejected` marks an HTTP 401/403 (http/sse only). */
export async function probe(entry, { platform = process.platform, env = process.env, agent = null, spawnImpl = spawn,
  timeoutMs = TEST_TIMEOUT_MS, kill = killProbe, redact = (s) => s } = {}) {
  const [{ Client }, { StreamableHTTPClientTransport }, { SSEClientTransport }, stdio] = await loadSdk();
  const client = new Client({ name: 'worca-test', version: '1.0.0' });
  // The last 2000 characters of stderr, redacted BEFORE the cut: a cut inside a secret would leave a piece of it.
  const stderr = { text: '', add(c) { this.text = redact(this.text + c).slice(-2000); } };
  let child = null;
  let rejected = false;
  let transport;
  if (entry.command) {
    let file = entry.command;
    let args = entry.args;
    let spawnEnv = { ...keepListEnv(env, platform), ...entry.env };
    if (agent) ({ file, args, env: spawnEnv } = agentSpawn(file, args, spawnEnv, agent));
    child = spawnImpl(file, args, { env: spawnEnv, stdio: ['pipe', 'pipe', 'pipe'], detached: platform !== 'win32', windowsHide: true });
    // A spawn that fails (no sudo, EMFILE, EAGAIN) emits 'error' and then 'close'; an 'error' nobody hears ends the server.
    child.on('error', (err) => stderr.add(`\n${err.message}\n`));
    transport = childTransport(child, stderr, stdio);
  } else {
    const fetchSeen = async (url, init) => {
      const r = await fetch(url, init);
      // Streamable HTTP's optional GET stream fails quietly; there only a POST's 401/403 is the token's.
      if ((r.status === 401 || r.status === 403) && (entry.type === 'sse' || init?.method === 'POST')) rejected = true;
      return r;
    };
    const Transport = entry.type === 'sse' ? SSEClientTransport : StreamableHTTPClientTransport;
    transport = new Transport(new URL(entry.url), { requestInit: { headers: entry.headers }, fetch: fetchSeen });
  }
  let timer;
  try {
    // The SDK ends each request after 60 s of its own (DEFAULT_REQUEST_TIMEOUT_MSEC) unless told otherwise:
    // hand it the whole bound, so the race below is the only limit.
    const request = { timeout: timeoutMs };
    const work = (async () => {
      await client.connect(transport, request);
      const tools = [];
      let cursor;
      do {
        const page = await client.listTools(cursor ? { cursor } : undefined, request);
        tools.push(...page.tools.map(toolRecord));
        if (tools.length > MAX_TOOLS) throw new Error(`tools/list returned more than ${MAX_TOOLS} tools`);
        cursor = page.nextCursor;
      } while (cursor);
      return tools;
    })();
    const timeout = new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(`no answer within ${timeoutMs / 1000} s`)), timeoutMs);
    });
    return await Promise.race([work, timeout]);
  } catch (err) {
    if (rejected) throw Object.assign(new Error('token rejected'), { rejected: true });
    // The line that says why: a Node crash ends with its stack and a "Node.js v…" trailer, so the last line naming an
    // error wins, stack frames ("at …") passed over; else the last line.
    const lines = stderr.text.split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('at '));
    const last = lines.findLast((l) => /error/i.test(l)) ?? lines.at(-1);
    // fetch's own message is a bare "fetch failed"; the reason (ENOTFOUND, ECONNREFUSED…) is its cause.
    const why = err.cause?.message && !err.message.includes(err.cause.message) ? `${err.message}: ${err.cause.message}` : err.message;
    throw new Error(last ? `${why} — ${last}` : why);
  } finally {
    clearTimeout(timer);
    if (child) kill(child, { platform, agent });
    await client.close().catch(() => {});
  }
}

const inflight = new Map();   // membership key → the run in progress
const queued = new Map();     // membership key → the run a Save queued behind it (it tests what was saved)

/** POST /api/mcp/sets/:setId/members/:serverId/test. Concurrent calls for one membership share a run: the
 *  one a Save queued when there is one, else the one in progress. `probeImpl` is a test seam. */
export function testMembership(setId, serverId, { probeImpl = probe } = {}) {
  const key = `${setId}|${serverId}`;
  if (queued.has(key)) return queued.get(key);
  if (!inflight.has(key)) inflight.set(key, runTest(setId, serverId, probeImpl).finally(() => inflight.delete(key)));
  return inflight.get(key);
}

async function runTest(setId, serverId, probeImpl) {
  const m = materializeForTest(await viewContext(), setId, serverId);
  const redactor = createRedactor(m.secretValues);
  const agent = process.platform !== 'win32' ? agentIdentityFor(currentOwner()) : null;
  const at = new Date().toISOString();
  let result;
  try {
    const tools = await probeImpl(expand(m.entry, m.env), { agent, redact: redactor.text, timeoutMs: mcpStartupMs('test') });
    result = { at, ok: true, tools, error: null, fingerprint: m.fingerprint };
  } catch (err) {
    result = { at, ok: false, tools: [], error: err.rejected ? 'token rejected' : redactor.text(err.message), fingerprint: m.fingerprint };
  }
  await recordTest(setId, serverId, result);
  return result;
}

/** Fire-and-forget re-tests (§7.3). One that finds its membership's probe in flight runs after it, so a
 *  Save always gets a Test of what it saved. A refusal (an unfilled field, a disabled plugin) is expected
 *  and stays quiet; anything else is logged. */
export function retestInBackground(memberships) {
  for (const k of memberships) {
    const i = k.indexOf('|');
    const run = () => { queued.delete(k); return testMembership(k.slice(0, i), k.slice(i + 1)); };
    if (inflight.has(k) && !queued.has(k)) queued.set(k, inflight.get(k).catch(() => {}).then(run));
    (queued.get(k) ?? run()).catch((err) => {
      if (!(err instanceof McpStoreError)) console.warn(`[worca] mcp: background test of ${k} failed: ${err.message}`);
    });
  }
}

/** The members PUT's background Test (§7.3), given the state read BEFORE the write: a Save of a membership that is on
 *  once it lands (a new one starts on, P1 putMember) re-tests; a switch-off, or a Save of a switched-off membership,
 *  starts nothing (docs/mcp-servers.md: off starts nothing). */
export function retestAfterSave(ctx, setId, serverId, patch) {
  const was = setMembers(ctx, setId)?.members.find((m) => m.serverId === serverId);
  if (patch.enabled ?? (was ? was.enabled : true)) retestInBackground([`${setId}|${serverId}`]);
}

/** Re-test every switched-on membership (user and Team) of the servers `match` accepts. Never rejects. */
export async function retestServers(match) {
  try { retestInBackground(membershipKeys(await viewContext(), match)); }
  catch (err) { console.warn(`[worca] mcp: background re-test skipped: ${err.message}`); }
}
