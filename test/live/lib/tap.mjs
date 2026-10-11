#!/usr/bin/env node
// test/live/lib/tap.mjs
// The wire tap: a stand-in harness binary (WORCA_CLAUDE_BIN / WORCA_CODEX_BIN /
// WORCA_COPILOT_BIN) that records exactly what worca hands the harness, then runs
// the REAL binary and records what it streams back. Engine-neutral: it only
// knows argv, env, stdin, stdout, stderr and the exit status.
//
//   LIVE_TAP_DIR    where records go (one <seq>.json + <seq>.stdout per spawn)
//   LIVE_TAP_REAL   absolute path of the real harness binary
//   LIVE_TAP_HOME   HOME for the real binary (the subscription login lives there;
//                   worca itself runs under a throwaway HOME)
//
// Records are written before the real binary starts (argv/env/staged files: worca
// deletes staged files on exit) and completed when it exits.
import { spawn } from 'node:child_process';
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const dir = process.env.LIVE_TAP_DIR;
const real = process.env.LIVE_TAP_REAL;
if (!dir || !real) {
  process.stderr.write('live tap: LIVE_TAP_DIR and LIVE_TAP_REAL must be set\n');
  process.exit(98);
}
mkdirSync(dir, { recursive: true });

const args = process.argv.slice(2);
const seq = `${Date.now().toString(36)}-${process.pid}`;
const recFile = join(dir, `${seq}.json`);
const outFile = join(dir, `${seq}.stdout`);

// Values of keys that may hold a credential never reach the record.
const SECRET_KEY = /(TOKEN|SECRET|KEY|PASSWORD|AUTH|COOKIE|CREDENTIAL)/i;
const env = {};
for (const k of Object.keys(process.env).sort()) {
  if (k.startsWith('LIVE_TAP_')) continue;
  env[k] = SECRET_KEY.test(k) ? `<set, ${process.env[k].length} chars>` : process.env[k];
}

// Staged files: any flag value that names an existing file is captured.
const FILE_FLAGS = new Set(['--settings', '--mcp-config', '--append-system-prompt-file', '--system-prompt-file', '--agents']);
const files = {};
for (let i = 0; i < args.length - 1; i++) {
  if (!FILE_FLAGS.has(args[i])) continue;
  const v = args[i + 1];
  if (typeof v === 'string' && !v.startsWith('{') && existsSync(v)) {
    try { files[args[i]] = readFileSync(v, 'utf8'); } catch { /* unreadable: leave out */ }
  }
}

const rec = { seq, startedAt: new Date().toISOString(), cwd: process.cwd(), args, env, files, stdin: '', exit: null, signal: null, endedAt: null, stdoutFile: outFile };
const save = () => { try { writeFileSync(recFile, JSON.stringify(rec, null, 1)); } catch { /* best effort */ } };
save();

// worca's own MCP server (src/core/ask/mcp-stdio.mjs) is launched BY the harness and
// would inherit the real HOME restored below, i.e. the real ~/.worca-cc/settings.json.
// Point it back at the sandbox HOME (recorded content above stays as worca wrote it).
const sandboxHome = process.env.LIVE_TAP_SANDBOX_HOME;
function homeWorcaServers(text) {
  let cfg;
  try { cfg = JSON.parse(text); } catch { return null; }
  let changed = false;
  for (const srv of Object.values(cfg?.mcpServers || {})) {
    if (srv && Array.isArray(srv.args) && srv.args.some((x) => /[\\/]mcp-stdio\.mjs$/.test(String(x)))) {
      srv.env = { ...(srv.env || {}), HOME: sandboxHome };
      changed = true;
    }
  }
  return changed ? JSON.stringify(cfg) : null;
}
const runArgs = args.slice();
if (sandboxHome) {
  for (let i = 0; i < runArgs.length - 1; i++) {
    if (runArgs[i] !== '--mcp-config') continue;
    const v = runArgs[i + 1];
    if (String(v).trim().startsWith('{')) { const nv = homeWorcaServers(v); if (nv) runArgs[i + 1] = nv; continue; }
    try { const nv = homeWorcaServers(readFileSync(v, 'utf8')); if (nv) writeFileSync(v, nv); } catch { /* not a file */ }
  }
}

const childEnv = { ...process.env };
for (const k of Object.keys(childEnv)) if (k.startsWith('LIVE_TAP_')) delete childEnv[k];
if (process.env.LIVE_TAP_HOME) childEnv.HOME = process.env.LIVE_TAP_HOME;

const child = spawn(real, runArgs, { env: childEnv, stdio: ['pipe', 'pipe', 'pipe'] });
writeFileSync(outFile, '');

process.stdin.on('data', (d) => { rec.stdin += d.toString('utf8'); try { child.stdin.write(d); } catch { /* child gone */ } });
process.stdin.on('end', () => { save(); try { child.stdin.end(); } catch { /* child gone */ } });
process.stdin.on('error', () => {});
child.stdin.on('error', () => {});

child.stdout.on('data', (d) => { process.stdout.write(d); try { appendFileSync(outFile, d); } catch { /* best effort */ } });
child.stderr.on('data', (d) => { process.stderr.write(d); rec.stderr = ((rec.stderr || '') + d.toString('utf8')).slice(-8000); });

for (const sig of ['SIGTERM', 'SIGINT', 'SIGHUP']) {
  process.on(sig, () => { rec.forwardedSignal = sig; try { child.kill(sig); } catch { /* gone */ } });
}
// If the tap itself dies hard, take the real binary with it.
process.on('exit', () => { if (child.exitCode === null && child.signalCode === null) { try { child.kill('SIGKILL'); } catch { /* gone */ } } });

child.on('error', (err) => { rec.spawnError = String(err && err.message || err); rec.endedAt = new Date().toISOString(); save(); process.exit(127); });
child.on('close', (code, signal) => {
  rec.exit = code; rec.signal = signal; rec.endedAt = new Date().toISOString();
  save();
  if (signal) { process.removeAllListeners(signal); process.kill(process.pid, signal); }
  else process.exit(code ?? 1);
});
