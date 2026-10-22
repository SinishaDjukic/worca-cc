#!/usr/bin/env node
// test/fixtures/fake-engine.mjs
// A stand-in engine binary for the boundary tests (spawn-supervise, engine-conformance). It records its argv, env,
// cwd and process group to $FAKE_OUT (JSON), starts a backgrounded grandchild (`sleep 600 &` in a shell, as an agent's
// `npm run dev &` would) that writes its pid to $FAKE_OUT.grand, replays the lines of $FAKE_STREAM on stdout, then
// exits $FAKE_EXIT (default 0), or with $FAKE_HOLD=1 waits to be stopped. Run as `<node> fake-engine.mjs …` or by path.
import { spawn, execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';

const out = process.env.FAKE_OUT;
let pgid = null;
try { pgid = Number(execFileSync('ps', ['-o', 'pgid=', '-p', String(process.pid)], { encoding: 'utf8' }).trim()) || null; } catch { /* no ps */ }
if (out) writeFileSync(out, JSON.stringify({ argv: process.argv.slice(2), env: process.env, cwd: process.cwd(), pid: process.pid, pgid }));
if (out && process.env.FAKE_GRANDCHILD !== '0') {
  spawn('sh', ['-c', 'sleep 600 & echo $! > "$1"; wait', 'fake-engine', `${out}.grand`], { stdio: 'ignore' });
}
if (process.env.FAKE_STREAM) for (const line of readFileSync(process.env.FAKE_STREAM, 'utf8').split('\n')) if (line.trim()) process.stdout.write(`${line}\n`);
if (process.env.FAKE_HOLD === '1') setInterval(() => {}, 1000);
else setTimeout(() => process.exit(Number(process.env.FAKE_EXIT || 0)), 50);
