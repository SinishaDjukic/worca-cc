#!/usr/bin/env node
// tools/docker-build.mjs
// Build the Worca container image locally the way CI does: `npm pack` the
// package, then `docker build` docker/Dockerfile with that tarball.
//
//   npm run docker:build                                  # ghcr.io/sinishadjukic/worca:dev (slim)
//   npm run docker:build -- --variant full                # ...:dev-full
//   npm run docker:build -- --tag worca:test --claude-code 2.1.278
//   npm run docker:build -- --platform linux/arm64 -- --no-cache   # args after `--` go to docker build
//
// The Claude Code version defaults to docker/CLAUDE_CODE_VERSION (one file,
// bumped by PR). ESM, no external dependencies.

import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import process from 'node:process';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const DEFAULT_IMAGE = 'ghcr.io/sinishadjukic/worca';
const PACK_DIR = join('docker', '.pack');

function parseArgs(argv) {
  const out = { variant: 'slim', tag: null, claudeCode: null, platform: null, docker: [], help: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--') { out.docker = argv.slice(i + 1); break; }
    else if (a === '--variant') out.variant = argv[++i];
    else if (a === '--tag' || a === '-t') out.tag = argv[++i];
    else if (a === '--claude-code') out.claudeCode = argv[++i];
    else if (a === '--platform') out.platform = argv[++i];
    else if (a === '--help' || a === '-h') out.help = true;
    else { console.error(`docker:build: unknown argument ${a}`); process.exit(2); }
  }
  if (!['slim', 'full'].includes(out.variant)) { console.error(`docker:build: --variant must be slim or full, got ${out.variant}`); process.exit(2); }
  return out;
}

export function pinnedClaudeCodeVersion() {
  return readFileSync(join(REPO_ROOT, 'docker', 'CLAUDE_CODE_VERSION'), 'utf8').trim();
}

function run(cmd, args, opts = {}) {
  console.log(`$ ${cmd} ${args.join(' ')}`);
  const r = spawnSync(cmd, args, { cwd: REPO_ROOT, stdio: 'inherit', ...opts });
  if (r.status !== 0) { console.error(`docker:build: ${cmd} exited ${r.status ?? r.signal}`); process.exit(r.status || 1); }
  return r;
}

/** `npm pack` into docker/.pack and return the tarball path relative to the repo root. */
export function packTarball() {
  const dest = join(REPO_ROOT, PACK_DIR);
  rmSync(dest, { recursive: true, force: true });
  mkdirSync(dest, { recursive: true });
  run('npm', ['pack', '--silent', '--pack-destination', dest]);
  const tgz = readdirSync(dest).find((f) => /^worca-app-.*\.tgz$/.test(f));
  if (!tgz) { console.error('docker:build: npm pack produced no worca-app-*.tgz'); process.exit(1); }
  return join(PACK_DIR, tgz);
}

function main() {
  const a = parseArgs(process.argv.slice(2));
  if (a.help) {
    console.log('Usage: npm run docker:build -- [--variant slim|full] [--tag <image:tag>] [--claude-code <ver>] [--platform <p>] [-- <docker build args>]');
    return;
  }
  const version = JSON.parse(readFileSync(join(REPO_ROOT, 'package.json'), 'utf8')).version;
  const claudeCode = a.claudeCode || pinnedClaudeCodeVersion();
  const tag = a.tag || `${DEFAULT_IMAGE}:dev${a.variant === 'full' ? '-full' : ''}`;
  const tarball = packTarball();
  console.log(`docker:build: @worca/app ${version} + claude-code ${claudeCode} (${a.variant}) -> ${tag}`);
  const args = [
    'build', '-f', 'docker/Dockerfile',
    '--build-arg', `WORCA_TARBALL=${tarball}`,
    '--build-arg', `CLAUDE_CODE_VERSION=${claudeCode}`,
    '--build-arg', `VARIANT=${a.variant}`,
    '--label', `org.opencontainers.image.version=${version}`,
    '-t', tag,
  ];
  if (a.platform) args.push('--platform', a.platform);
  args.push(...a.docker, '.');
  run('docker', args);
  console.log(`docker:build: built ${tag}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
