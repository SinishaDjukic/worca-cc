// test/engine-cli-guard.test.mjs — static guard: engine CLIs are only ever started through the shared
// resolver (exec-cli.mjs for probes, superviseSpawn with `cli:` for runs), never through a raw
// child_process call or a shell, so a new call site cannot forget to resolve a Windows .cmd shim.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const DIR = fileURLToPath(new URL('../src/core/engines/', import.meta.url));
const files = readdirSync(DIR).filter((f) => f.endsWith('.mjs')).map((f) => [f, readFileSync(join(DIR, f), 'utf8')]);

// spawn.mjs: the one run spawn (+ taskkill). exec-cli.mjs: the one probe execFile.
// project-files.mjs: `git` via execFileSync — not an engine CLI.
const ALLOWED = new Set(['spawn.mjs', 'exec-cli.mjs', 'project-files.mjs']);

test('no engine file imports child_process except the allowlist', () => {
  const offenders = files.filter(([f, src]) => !ALLOWED.has(f) && /from 'node:child_process'|from "node:child_process"|require\('child_process'\)/.test(src)).map(([f]) => f);
  assert.deepEqual(offenders, []);
});

test('every superviseSpawn call passes its CLI spec', () => {
  const offenders = files.filter(([f, src]) => f !== 'spawn.mjs' && /superviseSpawn\(/.test(src) && !/\bcli: /.test(src)).map(([f]) => f);
  assert.deepEqual(offenders, []);
});

test('no engine file, nor the resolver, uses a shell', () => {
  assert.deepEqual(files.filter(([, src]) => /shell:\s*true/.test(src)).map(([f]) => f), []);
  const resolver = readFileSync(new URL('../src/core/cli-resolve.mjs', import.meta.url), 'utf8');
  const exec = readFileSync(join(DIR, 'exec-cli.mjs'), 'utf8');
  assert.ok(!/cmd\.exe|powershell|shell:/i.test(resolver.replace(/\/\/.*$/gm, '')));
  assert.ok(!/cmd\.exe|powershell|shell:/i.test(exec.replace(/\/\/.*$/gm, '')));
});
