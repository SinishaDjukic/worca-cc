#!/usr/bin/env node
// tools/smoke-toolchain-bootstrap.mjs
// Manual, REAL-DOWNLOAD smoke for plugins/toolchain-setup on macOS: proves the mise bootstrap end to end on a
// machine that already has mise. Never part of `npm test` or CI.
//
//   node tools/smoke-toolchain-bootstrap.mjs [--keep]
//
// It hides Homebrew's mise from one process tree with sandbox-exec, gives that tree a scratch HOME and an empty
// environment, then runs the plugin's scripts as worca would:
//   Detect    -> mise is missing
//   Bootstrap -> installs mise with the official mise.run installer into <scratch>/home/.local/bin (~20 MB)
//   Resolve   -> uses that new mise to resolve jq@1.8.1
// Your own mise, HOME and ~/.worca-cc are never touched. The scratch folder is deleted unless --keep.
// Exit 0 = every step checked out; 1 = a step failed; 2 = this machine cannot run the smoke.

import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const SELF = fileURLToPath(import.meta.url);
const SCRIPTS = resolve(dirname(SELF), '..', 'plugins', 'toolchain-setup', 'scripts');

// Every place Homebrew keeps mise (Apple Silicon and Intel prefixes): reading any of them is denied.
const HIDE_MISE = `(version 1)
(allow default)
(deny file-read*
  (literal "/opt/homebrew/bin/mise") (subpath "/opt/homebrew/Cellar/mise") (subpath "/opt/homebrew/opt/mise")
  (literal "/usr/local/bin/mise") (subpath "/usr/local/Cellar/mise") (subpath "/usr/local/opt/mise"))
`;

async function outer(keep) {
  if (process.platform !== 'darwin' || !existsSync('/usr/bin/sandbox-exec')) {
    console.error('smoke:toolchain-bootstrap needs macOS (sandbox-exec hides the installed mise)');
    return 2;
  }
  const work = await mkdtemp(join(tmpdir(), 'worca-toolchain-bootstrap-'));
  try {
    const profile = join(work, 'hide-mise.sb');
    await writeFile(profile, HIDE_MISE);
    await mkdir(join(work, 'home'));
    const r = spawnSync('/usr/bin/sandbox-exec', ['-f', profile, '/usr/bin/env', '-i',
      `HOME=${join(work, 'home')}`, 'PATH=/usr/bin:/bin:/opt/homebrew/bin:/usr/local/bin', `TMPDIR=${work}`,
      process.execPath, SELF, '--inner', work], { stdio: 'inherit' });
    return r.status ?? 1;
  } finally {
    if (keep) console.log(`kept ${work}`);
    else await rm(work, { recursive: true, force: true, maxRetries: 3 });
  }
}

async function inner(work) {
  const log = (level, msg) => console.log(`  [${level}] ${msg}`);
  const check = (ok, what) => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}`); if (!ok) throw new Error(what); };
  const put = async (name, value) => { const p = join(work, name); await writeFile(p, typeof value === 'string' ? value : JSON.stringify(value)); return { path: p }; };

  const detect = await import(join(SCRIPTS, 'toolchainDetect.mjs'));
  const probe = await detect.probeTools();
  check(probe.present === false, `Detect sees no mise (found: ${probe.version || 'none'})`);

  // Homebrew itself stays visible; take the mise.run route, the one a machine without brew gets.
  const boot = await (await import(join(SCRIPTS, 'toolchainBootstrap.mjs'))).default({
    inputs: { bootstrap: await put('probe.json', { ...probe, brew: false }), decision: await put('decision.json', { decision: 'install' }) },
    params: {}, log,
  });
  const done = boot.outputs.done.value;
  check(done.method === 'mise.run', `Bootstrap installed mise via mise.run (method: ${done.method})`);
  check(done.binPath === join(process.env.HOME, '.local', 'bin', 'mise'), `mise landed in the scratch HOME (${done.binPath})`);
  check(!detect.miseTooOld(done.version), `mise ${done.version} meets the floor ${detect.MIN_MISE}`);

  await mkdir(join(work, 'project'));
  const res = await (await import(join(SCRIPTS, 'toolchainResolver.mjs'))).default({
    inputs: {
      facts: await put('facts.json', { facts: [{ tool: 'jq', version: '1.8.1', constraint: 'exact', source: '.tool-versions:1' }], capabilities: [] }),
      proposals: await put('proposals.json', []),
    },
    params: { toolchainRoot: join(work, 'root') }, ctx: { projectDir: join(work, 'project') }, log,
  });
  const plan = res.outputs.plan.value;
  check(!!plan.mise && !plan.miseTooOld, `Resolve used the new mise (${plan.mise})`);
  const row = plan.rows.find((r) => r.tool === 'jq');
  check(row?.spec === 'jq@1.8.1' && row.status === 'installable', `Resolve resolved jq@1.8.1 (${row?.status}${row?.reason ? `: ${row.reason}` : ''})`);
  console.log('smoke:toolchain-bootstrap passed');
}

const argv = process.argv.slice(2);
if (argv[0] === '--inner') {
  try { await inner(argv[1]); } catch (e) { console.error(`smoke:toolchain-bootstrap FAILED — ${e.message}`); process.exitCode = 1; }
} else {
  process.exitCode = await outer(argv.includes('--keep'));
}
