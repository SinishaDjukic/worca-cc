#!/usr/bin/env node
import { readFileSync, writeFileSync, mkdirSync, unlinkSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';

const PID_DIR = join(homedir(), '.worca');
const PID_FILE = join(PID_DIR, 'worca-ui.pid');
const SERVER_SCRIPT = join(dirname(fileURLToPath(import.meta.url)), '..', 'server', 'index.js');

function parseArgs(argv) {
  const args = { command: 'start', port: 3400, host: '127.0.0.1', open: false };
  for (let i = 2; i < argv.length; i++) {
    if (argv[i] === 'start' || argv[i] === 'stop' || argv[i] === 'restart' || argv[i] === 'status') {
      args.command = argv[i];
    } else if (argv[i] === '--port' && argv[i + 1]) {
      args.port = parseInt(argv[++i], 10);
    } else if (argv[i] === '--host' && argv[i + 1]) {
      args.host = argv[++i];
    } else if (argv[i] === '--open') {
      args.open = true;
    }
  }
  return args;
}

function readPid() {
  try {
    return JSON.parse(readFileSync(PID_FILE, 'utf8'));
  } catch {
    return null;
  }
}

function writePid(info) {
  mkdirSync(PID_DIR, { recursive: true });
  writeFileSync(PID_FILE, JSON.stringify(info, null, 2) + '\n');
}

function removePid() {
  try { unlinkSync(PID_FILE); } catch { /* ignore */ }
}

function isRunning(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function start({ port, host, open }) {
  const existing = readPid();
  if (existing && isRunning(existing.pid)) {
    console.log(`worca-ui already running (PID ${existing.pid}) at http://${existing.host}:${existing.port}`);
    return;
  }

  const child = spawn(process.execPath, [SERVER_SCRIPT, '--port', String(port), '--host', host], {
    detached: true,
    stdio: 'ignore',
    cwd: process.cwd()
  });
  child.unref();

  const info = { pid: child.pid, port, host, started_at: new Date().toISOString() };
  writePid(info);
  const url = `http://${host}:${port}`;
  console.log(`worca-ui started (PID ${child.pid}) at ${url}`);

  if (open) {
    spawn('open', [url], { detached: true, stdio: 'ignore' }).unref();
  }
}

function stop() {
  const info = readPid();
  if (!info) {
    console.log('worca-ui is not running');
    return;
  }
  if (isRunning(info.pid)) {
    try {
      process.kill(info.pid, 'SIGTERM');
      console.log(`worca-ui stopped (PID ${info.pid})`);
    } catch (e) {
      console.error(`Failed to stop PID ${info.pid}: ${e.message}`);
    }
  } else {
    console.log('worca-ui was not running (stale PID file)');
  }
  removePid();
}

function restart(opts) {
  stop();
  setTimeout(() => start(opts), 500);
}

function status() {
  const info = readPid();
  if (!info) {
    console.log('worca-ui is not running');
    return;
  }
  if (isRunning(info.pid)) {
    console.log(`worca-ui is running (PID ${info.pid}) at http://${info.host}:${info.port}`);
    console.log(`Started: ${info.started_at}`);
  } else {
    console.log('worca-ui is not running (stale PID file)');
    removePid();
  }
}

const args = parseArgs(process.argv);
switch (args.command) {
  case 'start': start(args); break;
  case 'stop': stop(); break;
  case 'restart': restart(args); break;
  case 'status': status(); break;
  default: console.log('Usage: worca-ui [start|stop|restart|status] [--port N] [--host H] [--open]');
}
