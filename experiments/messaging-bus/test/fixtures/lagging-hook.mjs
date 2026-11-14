#!/usr/bin/env node
// A hook that delivers one tool call LATE (plan §4.3 Hook seam): it runs the real lib/hook.mjs with
// the same flags and stdin (so the real ack happens on time), stores that stdout in $LAG_STATE, and
// prints the stdout stored by the PREVIOUS invocation (nothing on the first).
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const HOOK = fileURLToPath(new URL('../../lib/hook.mjs', import.meta.url));
const state = process.env.LAG_STATE;
if (!state) { process.stderr.write('LAG_STATE is required\n'); process.exit(0); }
const input = readFileSync(0);
const r = spawnSync(process.execPath, [HOOK, ...process.argv.slice(2)], { input });
const previous = existsSync(state) ? readFileSync(state) : Buffer.alloc(0);
writeFileSync(state, r.stdout ?? Buffer.alloc(0));
if (r.stderr?.length) process.stderr.write(r.stderr);
process.stdout.write(previous);
