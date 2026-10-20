// src/cli/run-preset.mjs — `worca run --preset NAME --prompt "…"` (docs/run-presets.md, #712 slice 3).
// Unlike `worca --prompt`, this start goes THROUGH the Worca server: the preset's scope, owner and broken-item checks
// live there (POST /api/run with presetId, 409 preset-broken), so the CLI sends only the prompt, the target and
// what the preset contributes to New run's body (slice 1 proved that normalizes to the hand-made body).
import http from 'node:http';
import { resolve } from 'node:path';
import { readUiInstance, probeUi, DEFAULT_UI_HOST, DEFAULT_UI_PORT } from '../core/ui-instance.mjs';
import { projectKey } from '../core/store.mjs';
import { presetRunBody } from '../shared/run-presets.mjs';

export const RUN_HELP = `worca run --preset NAME --prompt "…" [--title T] [--project DIR | --workspace ID]

Start a run from one of your run presets, with just a prompt. The run goes through the
running Worca server (start it with: worca ui), which checks the preset first.
  --preset NAME     a preset's name (any case); presets for any project, or pinned to this one
  --prompt TEXT     what to do
  --title T         the run's title
  --project DIR     the project (default: the current directory)
  --workspace ID    a workspace instead of a project
Exits 1 when the preset is unknown here or cannot start, naming why. Works against a local
Worca server; a server that asks you to sign in answers with its sign-in hint.`;

const VALUE_FLAGS = new Set(['--preset', '--prompt', '--title', '--project', '--workspace']);

function parseRunArgs(argv, fail) {
  const flags = {};
  const unknown = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const eq = a.indexOf('=');
    const name = a.startsWith('--') && eq > 0 ? a.slice(0, eq) : a;
    if (!VALUE_FLAGS.has(name)) { unknown.push(a); continue; }
    const v = eq > 0 && a.startsWith('--') ? a.slice(eq + 1) : argv[++i];
    // `worca run --preset --prompt x` must not take "--prompt" as the preset's name.
    if (v === undefined || v === '' || (eq < 0 && v.startsWith('--'))) fail(`${name} needs a value — see: worca run help`);
    flags[name.slice(2)] = v;
  }
  if (unknown.length) fail(`unknown option(s): ${unknown.join(' ')} — see: worca run help`);
  if (!flags.preset) fail('worca run needs --preset NAME (to start without a preset: worca --prompt "…")');
  if (!flags.prompt) fail('worca run needs --prompt "…"');
  if (flags.project && flags.workspace) fail('give --project or --workspace, not both');
  return flags;
}

/** The running Worca server's base URL, or null. Dialed the way probeUi's private dialHost does
 *  (src/core/ui-instance.mjs): a wildcard bind (0.0.0.0, ::, empty) goes to 127.0.0.1, any other host as is
 *  (bracketed when IPv6), so a `localhost` bind that Node put on ::1 is reached on the same address the probe used.
 *  Not uiUrl: that keeps 0.0.0.0, and the host guard answers 403 to that Host (src/core/remote-access.mjs). */
export async function findUi() {
  const inst = readUiInstance();
  const host = inst && inst.host ? inst.host : DEFAULT_UI_HOST;
  const port = inst && inst.port ? inst.port : DEFAULT_UI_PORT;
  const probe = await probeUi({ host, port });
  if (probe.state !== 'worca' || probe.info?.legacy) return null;
  const dial = !host || host === '0.0.0.0' || host === '::' ? DEFAULT_UI_HOST
    : host.includes(':') && !host.startsWith('[') ? `[${host}]` : host;
  return `http://${dial}:${port}`;
}

const HTTP_TIMEOUT_MS = 30_000;   // a server that accepts and then hangs must not hang the terminal
/** JSON over http.request (agent:false, Connection: close — the ui-instance.mjs choice, never fetch). */
function httpJson(method, url, body) {
  return new Promise((done, reject) => {
    const data = body === undefined ? null : Buffer.from(JSON.stringify(body));
    const req = http.request(url, { method, agent: false, timeout: HTTP_TIMEOUT_MS, headers: { accept: 'application/json', connection: 'close',
      ...(data ? { 'content-type': 'application/json', 'content-length': data.length } : {}) } }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('error', reject);
      res.on('end', () => {
        let json = null;
        try { json = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { /* not JSON */ }
        done({ status: res.statusCode, json });
      });
    });
    req.on('error', reject);
    req.on('timeout', () => req.destroy(new Error(`no answer in ${HTTP_TIMEOUT_MS / 1000} s`)));
    if (data) req.write(data);
    req.end();
  });
}

/** /api/run answers the runs-map id, but `worca logs` and `worca runs list` know runs by pipeline id, which the
 *  server sets on the run's first state event (after the answer). Polls the live list for it; null when it does not
 *  show within `waitMs` or the list cannot be read. */
async function pipelineIdOf(base, query, runId, waitMs) {
  const url = `${base}/api/runs?${new URLSearchParams(query)}`;
  const until = Date.now() + waitMs;
  for (;;) {
    const listed = await httpJson('GET', url).catch(() => null);
    if (!listed || listed.status !== 200) return null;
    const hit = (listed.json?.live || []).find((r) => r.runId === runId);
    if (hit && hit.id && hit.id !== runId) return hit.id;
    if (Date.now() >= until) return null;
    await new Promise((r) => setTimeout(r, 200));
  }
}

/** @returns {Promise<number>} 0 started, 1 refused (unknown, pinned elsewhere, broken, no server, flag off) */
export async function cmdRun(argv, { out = console.log, err = (s) => process.stderr.write(`${s}\n`), fail, ui = findUi, cwd = process.cwd(), pipelineWaitMs = 10_000 } = {}) {
  if (['help', '--help', '-h'].includes(argv[0])) { out(RUN_HELP); return 0; }
  const flags = parseRunArgs(argv, fail);
  const say = (s) => err(`worca run: ${s}`);
  const base = await ui();
  if (!base) { say('--preset sends the run to the Worca server, and none is running — start it with: worca ui'); return 1; }

  // A server that dies between the probe and these calls rejects httpJson: say so instead of main()'s fatal stack.
  const lost = (e) => { say(`lost the Worca server (${e && e.message})`); return null; };
  const listed = await httpJson('GET', `${base}/api/presets`).catch(lost);
  if (!listed) return 1;
  if (listed.status === 404) { say('run presets are turned off — turn them on with: worca flags on runPresets (or Settings › Labs)'); return 1; }
  if (listed.status !== 200 || !Array.isArray(listed.json?.presets)) { say(listed.json?.error || `could not list presets (HTTP ${listed.status})`); return 1; }

  const target = flags.workspace ? { kind: 'workspace', ref: flags.workspace } : { kind: 'project', ref: projectKey(resolve(cwd, flags.project || '.')) };
  const inScope = (p) => p.scope.kind === 'global' || (p.scope.kind === target.kind && p.scope.ref === target.ref);
  const want = flags.preset.trim().toLowerCase();
  const named = listed.json.presets.filter((p) => p.name.toLowerCase() === want);
  const preset = named.find(inScope);
  if (!preset) {
    if (named[0]) { say(`preset "${named[0].name}" is pinned to ${named[0].scope.kind} ${named[0].scope.ref} — run it from that ${named[0].scope.kind} with --${named[0].scope.kind}`); return 1; }
    const names = listed.json.presets.filter(inScope).map((p) => p.name);
    say(`no run preset named "${flags.preset}" for this ${target.kind}.`);
    err(`Available: ${names.length ? names.join(', ') : 'none — save one in New run'}`);
    return 1;
  }

  const task = { ...(flags.workspace ? { workspaceId: flags.workspace } : { projectDir: resolve(cwd, flags.project || '.') }),
    prompt: flags.prompt, ...(flags.title ? { title: flags.title } : {}) };
  const started = await httpJson('POST', `${base}/api/run`, presetRunBody(preset, task)).catch(lost);
  if (!started) return 1;
  if (started.status === 200 && started.json?.runId) {
    const pipelineId = await pipelineIdOf(base, flags.workspace ? { workspaceId: flags.workspace } : { projectDir: task.projectDir }, started.json.runId, pipelineWaitMs);
    out(pipelineId
      ? `Started run ${pipelineId} from preset "${preset.name}" — follow it with: worca logs ${pipelineId}`
      : `Started a run from preset "${preset.name}" — find it with: worca runs list`);
    return 0;
  }
  if (started.status === 409 && started.json?.code === 'preset-broken' && Array.isArray(started.json.broken)) {
    say(`Preset "${preset.name}" cannot start:`);
    for (const b of started.json.broken) err(`  - ${b.message}`);
    return 1;
  }
  say(started.json?.error || `the run could not be started (HTTP ${started.status})`);
  return 1;
}
