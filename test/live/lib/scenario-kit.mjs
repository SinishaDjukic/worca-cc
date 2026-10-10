// test/live/lib/scenario-kit.mjs
// Helpers shared by the guardrail / failure / settings scenarios: a one-node
// workflow fixture, raw wire access (tool results, denials), a fake gateway,
// server-started runs, and waiting for a run to reach a terminal state.
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { createServer } from 'node:http';
import { join } from 'node:path';
import { LIVE_ROOT, waitFor } from './sandbox.mjs';
import { runIdFrom } from './checks.mjs';

export const TERMINAL = new Set(['done', 'error', 'paused', 'stopped', 'failed']);

/** Import a workflow fixture (test/live/fixtures/workflows/<name>.json); returns its id.
 *  `nodeConfig` merges into every agent node's config (e.g. {model, effort}: a server-started
 *  run ignores the request's model, so the node must carry it); `as` renames the import. */
export function importWorkflow(t, name, { nodeConfig = null, as = null } = {}) {
  let file = join(LIVE_ROOT, 'fixtures', 'workflows', `${name}.json`);
  if (nodeConfig || as) {
    const g = JSON.parse(readFileSync(file, 'utf8'));
    if (as) g.name = as;
    if (nodeConfig) for (const n of g.nodes) if (n.kind === 'agent') n.config = { ...(n.config || {}), ...nodeConfig };
    file = join(t.sb.base, `${(as || name).replace(/\W+/g, '-')}.json`);
    writeFileSync(file, JSON.stringify(g, null, 2));
  }
  const im = t.sb.cliSync(['workflow', 'import', file]);
  if (im.status !== 0) throw new Error(`workflow import ${name}: ${im.stderr} ${im.stdout}`);
  const m = /imported\t(\S+)/.exec(im.stdout);
  if (m) return m[1];
  const g = JSON.parse(readFileSync(file, 'utf8'));
  const row = t.sb.cliSync(['workflow', 'list']).stdout.split('\n').map((l) => l.split('\t')).find((r) => r[1] === g.name);
  if (!row) throw new Error(`imported workflow ${name} not listed`);
  return row[0];
}

/** A CLI run on the one-node implement-only workflow (cheap). */
export async function implementOnly(t, prompt, { model = t.model, extra = [], timeoutMs, env } = {}) {
  const wf = importWorkflow(t, 'implement-only');
  const proj = t.sb.addProject();
  const t0 = Date.now();
  const res = await t.sb.cli(['--project', proj, '--prompt', prompt, '--yes', ...(model ? ['--model', model] : []), '--workflow', wf, '--title', 'live implement-only', ...extra], { timeoutMs, env });
  const ms = Date.now() - t0;
  const id = runIdFrom(t.sb, res);
  const run = id ? t.sb.runShow(id) : null;
  return { wf, proj, res, ms, id, run };
}

/** Every stream-json event of one tapped spawn. */
export function rawEvents(tp) {
  const out = [];
  if (!tp.stdoutFile || !existsSync(tp.stdoutFile)) return out;
  for (const line of readFileSync(tp.stdoutFile, 'utf8').split('\n')) {
    if (!line.trim()) continue;
    try { out.push(JSON.parse(line)); } catch { /* skip */ }
  }
  return out;
}

/** tool_result blocks (text joined) of one spawn. */
export function toolResults(tp) {
  const out = [];
  for (const e of rawEvents(tp)) {
    if (e.type !== 'user' || !Array.isArray(e.message?.content)) continue;
    for (const b of e.message.content) {
      if (b.type !== 'tool_result') continue;
      const text = typeof b.content === 'string' ? b.content : Array.isArray(b.content) ? b.content.map((c) => c.text || '').join('\n') : JSON.stringify(b.content);
      out.push({ id: b.tool_use_id, isError: !!b.is_error, text });
    }
  }
  return out;
}

/** The value of one argv flag (null when absent or bare). */
export function flagOf(tp, f) {
  const i = tp.args.indexOf(f);
  return i >= 0 && tp.args[i + 1] != null && !String(tp.args[i + 1]).startsWith('--') ? tp.args[i + 1] : null;
}

/** The --settings payload of a spawn, parsed (inline JSON or staged file). */
export function settingsOf(tp) {
  const v = tp.files?.['--settings'] ?? flagOf(tp, '--settings');
  if (!v) return null;
  try { return JSON.parse(v); } catch { return null; }
}

/** All agent-node spawns (prompt carries "# Task: …"). */
export const nodeTaps = (sb) => sb.agentTaps().filter((tp) => /\| task: /.test(tp.site));

/** A local HTTP server that answers every request with `status` (default 403). */
export async function fakeGateway({ status = 403, body } = {}) {
  const hits = [];
  const srv = createServer((req, res) => {
    let data = '';
    req.on('data', (d) => { data += d; });
    req.on('end', () => {
      hits.push({ method: req.method, url: req.url, at: Date.now(), bytes: data.length });
      res.writeHead(status, { 'content-type': 'application/json' });
      res.end(JSON.stringify(body || { type: 'error', error: { type: 'authentication_error', message: 'live-suite gateway: credential refused' } }));
    });
  });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  const { port } = srv.address();
  return { url: `http://127.0.0.1:${port}`, hits, close: () => new Promise((r) => srv.close(r)) };
}

/** Wait until run `id` (or the newest run) is in a terminal state; returns the run list row. */
export async function waitTerminal(sb, id = null, { timeoutMs = 30 * 60 * 1000 } = {}) {
  return waitFor(() => {
    const runs = sb.runs();
    const r = id ? runs.find((x) => x.id === id) : runs[0];
    return r && TERMINAL.has(r.status) ? r : null;
  }, { timeoutMs, everyMs: 3000 });
}

/** Register the project with a running server (idempotent). */
export async function registerProject(srv, dir, name = 'calc') {
  const r = await srv.api('POST', '/api/projects', { name, path: dir });
  return r;
}

/** Re-point the sandbox's tapped harness wrapper at another HOME (e.g. an empty one = signed out). */
export function retargetTapHome(sb, home) {
  const wrapper = join(sb.base, 'bin', sb.profile.engine);
  const text = readFileSync(wrapper, 'utf8').replace(/LIVE_TAP_HOME='[^']*'/, `LIVE_TAP_HOME='${home}'`);
  writeFileSync(wrapper, text);
}
