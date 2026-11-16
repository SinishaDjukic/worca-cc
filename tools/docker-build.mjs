#!/usr/bin/env node
// tools/docker-build.mjs
// Build a Worca container image locally the way CI does: `npm pack` the
// package, then `docker build` docker/Dockerfile with that tarball.
//
//   npm run docker:build                                  # ghcr.io/sinishadjukic/worca:dev (controller, slim)
//   npm run docker:build -- --variant full                # ...:dev-full
//   npm run docker:build -- --target worker               # ghcr.io/sinishadjukic/worca-worker:dev-claude
//   npm run docker:build -- --target worker --engine all  # ...worca-worker:dev-all (every engine)
//   npm run docker:build -- --tag worca:test --claude-code 2.1.278
//   npm run docker:build -- --platform linux/arm64 -- --no-cache   # args after `--` go to docker build
//
// The Claude Code version defaults to docker/CLAUDE_CODE_VERSION (one file,
// bumped by PR); the other engines' pins are docker/engines.env, passed through
// as build args whatever the target. ESM, no external dependencies.

import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import process from 'node:process';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const DEFAULT_IMAGE = 'ghcr.io/sinishadjukic/worca';
export const DEFAULT_WORKER_IMAGE = 'ghcr.io/sinishadjukic/worca-worker';
export const TARGETS = ['controller', 'worker'];
/** The engine ids docker/engines/install.sh knows (src/core/engines/cli-specs.mjs ENGINE_CLIS), plus `all`. */
export const ENGINES = ['claude', 'codex', 'copilot', 'cursor', 'gemini', 'qwen', 'goose', 'opencode', 'all'];
const PACK_DIR = join('docker', '.pack');

const USAGE = `Usage: npm run docker:build -- [options] [-- <docker build args>]
  --target controller|worker   which image (default controller; the Dockerfile's last stage)
  --engine <id|all>            worker only: the engine CLI(s) to install (default claude);
                               ids: ${ENGINES.join(' ')}
  --variant slim|full          add python, build tools, chromium, uv, the Railway CLI (default slim)
  --tag, -t <image:tag>        default ${DEFAULT_IMAGE}:dev[-full] for the controller,
                               ${DEFAULT_WORKER_IMAGE}:dev-<engine>[-full] for a worker
  --claude-code <ver>          the Claude Code pin (default docker/CLAUDE_CODE_VERSION)
  --platform <p>               e.g. linux/arm64
  --help, -h
The other engines' pins come from docker/engines.env (every KEY=value is a --build-arg).`;

function parseArgs(argv) {
  const out = { target: 'controller', engine: null, variant: 'slim', tag: null, claudeCode: null, platform: null, docker: [], help: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--') { out.docker = argv.slice(i + 1); break; }
    else if (a === '--target') out.target = argv[++i];
    else if (a === '--engine') out.engine = argv[++i];
    else if (a === '--variant') out.variant = argv[++i];
    else if (a === '--tag' || a === '-t') out.tag = argv[++i];
    else if (a === '--claude-code') out.claudeCode = argv[++i];
    else if (a === '--platform') out.platform = argv[++i];
    else if (a === '--help' || a === '-h') out.help = true;
    else { console.error(`docker:build: unknown argument ${a}`); process.exit(2); }
  }
  if (out.help) return out;
  if (!['slim', 'full'].includes(out.variant)) { console.error(`docker:build: --variant must be slim or full, got ${out.variant}`); process.exit(2); }
  if (!TARGETS.includes(out.target)) { console.error(`docker:build: --target must be ${TARGETS.join(' or ')}, got ${out.target}`); process.exit(2); }
  if (out.engine && out.target !== 'worker') { console.error('docker:build: --engine applies to --target worker only'); process.exit(2); }
  if (out.target === 'worker') {
    out.engine = out.engine || 'claude';
    if (!ENGINES.includes(out.engine)) { console.error(`docker:build: --engine must be one of ${ENGINES.join(', ')}, got ${out.engine}`); process.exit(2); }
  }
  return out;
}

export function pinnedClaudeCodeVersion() {
  return readFileSync(join(REPO_ROOT, 'docker', 'CLAUDE_CODE_VERSION'), 'utf8').trim();
}

/**
 * The engine pins of docker/engines.env (or any KEY=value text): `#` lines and blank lines are
 * ignored, values are trimmed, a `KEY=` keeps an empty string (install.sh decides what that means).
 * @param {string} [text] the file's text; default docker/engines.env
 * @returns {Record<string, string>}
 */
export function readEnginePins(text = readFileSync(join(REPO_ROOT, 'docker', 'engines.env'), 'utf8')) {
  const pins = {};
  for (const raw of String(text).split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const m = /^([A-Z][A-Z0-9_]*)\s*=(.*)$/.exec(line);
    if (!m) throw new Error(`engines.env: not a KEY=value line: ${raw}`);
    pins[m[1]] = m[2].trim();
  }
  return pins;
}

/** The image tag a build gets when --tag is not given. */
export function defaultTag({ target, engine, variant }) {
  const full = variant === 'full' ? '-full' : '';
  return target === 'worker' ? `${DEFAULT_WORKER_IMAGE}:dev-${engine}${full}` : `${DEFAULT_IMAGE}:dev${full}`;
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
  if (a.help) { console.log(USAGE); return; }
  const version = JSON.parse(readFileSync(join(REPO_ROOT, 'package.json'), 'utf8')).version;
  const claudeCode = a.claudeCode || pinnedClaudeCodeVersion();
  const pins = readEnginePins();
  const tag = a.tag || defaultTag(a);
  const tarball = packTarball();
  const what = a.target === 'worker' ? `worker, engine ${a.engine}` : 'controller';
  console.log(`docker:build: @worca/app ${version} + claude-code ${claudeCode} (${what}, ${a.variant}) -> ${tag}`);
  const args = [
    'build', '-f', 'docker/Dockerfile',
    '--target', a.target,
    '--build-arg', `WORCA_TARBALL=${tarball}`,
    '--build-arg', `CLAUDE_CODE_VERSION=${claudeCode}`,
    '--build-arg', `VARIANT=${a.variant}`,
    '--build-arg', `ENGINE=${a.engine || 'claude'}`,
    ...Object.entries(pins).flatMap(([k, v]) => ['--build-arg', `${k}=${v}`]),
    '--label', `org.opencontainers.image.version=${version}`,
    '-t', tag,
  ];
  if (a.platform) args.push('--platform', a.platform);
  args.push(...a.docker, '.');
  run('docker', args);
  console.log(`docker:build: built ${tag}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
