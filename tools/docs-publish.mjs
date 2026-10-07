#!/usr/bin/env node
// Publish docs.worca.dev: fast-forward the `docs-live` pointer to a commit on dev.
//
//   npm run docs:publish                 # docs-live -> origin/dev
//   npm run docs:publish -- --to <ref>   # docs-live -> <ref> (must be on origin/dev)
//   npm run docs:publish -- --dry-run    # every check, no push
//
// Cloudflare Workers Builds deploys `docs-live` (docs-site/README.md). Before moving
// it, this checks that the target is on origin/dev and a fast-forward of docs-live,
// that its newest changelog entry has its page, and that the site actually builds
// from the target's tree (`npm ci` + `npm run build` in docs-site/ on a `git archive` of it) — so a
// broken entry never reaches the pointer.

import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import { compareVersions } from '../docs-site/changelog.mjs';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const toIdx = args.indexOf('--to');
const toRef = toIdx >= 0 ? args[toIdx + 1] : 'origin/dev';
if (toIdx >= 0 && !toRef) fail('--to needs a ref');
const unknown = args.filter((a, i) => a !== '--dry-run' && a !== '--to' && !(toIdx >= 0 && i === toIdx + 1));
if (unknown.length) fail(`unexpected argument: ${unknown[0]}`);

const git = (...a) => execFileSync('git', a, { cwd: repo, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
const gitOk = (...a) => spawnSync('git', a, { cwd: repo, stdio: 'ignore' }).status === 0;
const short = (sha) => sha.slice(0, 8);

git('fetch', '--quiet', 'origin', 'dev', 'docs-live', '--tags');
const target = git('rev-parse', `${toRef}^{commit}`);
const live = git('rev-parse', 'origin/docs-live^{commit}');
const subject = git('log', '-1', '--format=%s', target);

if (!gitOk('merge-base', '--is-ancestor', target, 'origin/dev')) {
  fail(`${toRef} (${short(target)}) is not on origin/dev — push it to dev first`);
}
if (target === live) {
  console.log(`docs-live is already at ${short(target)} "${subject}" — nothing to publish.`);
  process.exit(0);
}
if (!gitOk('merge-base', '--is-ancestor', live, target)) {
  fail(`docs-live (${short(live)}) is not an ancestor of ${short(target)}; it only ever fast-forwards along dev`);
}

// --- the changelog at the target ---------------------------------------------
let entries;
try {
  entries = JSON.parse(git('show', `${target}:docs/changelog/entries.json`));
} catch {
  fail(`no readable docs/changelog/entries.json at ${toRef} (${short(target)}) — is the changelog entry committed and pushed to dev?`);
}
const versions = entries.map((e) => e.version).sort((a, b) => compareVersions(b, a));
const newest = versions[0];
const warnings = [];

const stable = git('tag', '--list', 'worca-app-v*', '--sort=-v:refname')
  .split('\n')
  .find((t) => /^worca-app-v\d+\.\d+\.\d+$/.test(t));
const stableVersion = stable?.replace('worca-app-v', '');
if (stableVersion && !versions.includes(stableVersion)) {
  warnings.push(`${stableVersion} is released (tag ${stable}) but has no changelog entry yet`);
}

// --- build the target's tree exactly as Workers Builds will --------------------
const tmp = mkdtempSync(path.join(os.tmpdir(), 'worca-docs-publish-'));
try {
  // The paths build.mjs reads: changelog pages point at ui/public/assets for the logo.
  const archive = spawnSync('git', ['archive', '--format=tar', target, 'package.json', 'docs', 'docs-site', 'ui/public/assets'], {
    cwd: repo, maxBuffer: 1024 * 1024 * 1024,
  });
  if (archive.status !== 0) fail(`git archive failed: ${archive.stderr}`);
  const untar = spawnSync('tar', ['-x', '-C', tmp], { input: archive.stdout });
  if (untar.status !== 0) fail(`tar failed: ${untar.stderr}`);
  // Install from the target's lockfile and build, as Workers Builds does (VitePress is a dependency).
  const npm = (args) => spawnSync('npm', args, {
    cwd: path.join(tmp, 'docs-site'), encoding: 'utf8', shell: process.platform === 'win32',
  });
  const install = npm(['ci', '--no-audit', '--no-fund']);
  if (install.status !== 0) fail(`npm ci failed for the docs site at ${short(target)}:\n${install.stderr || install.stdout}`);
  const build = npm(['run', '--silent', 'build']);
  if (build.status !== 0) fail(`the docs site does not build at ${short(target)}:\n${build.stderr || build.stdout}`);
  console.log(`build check: ${build.stdout.trim().split('\n').at(-1)}`);
} finally {
  rmSync(tmp, { recursive: true, force: true });
}

console.log(`
docs-live:  ${short(live)}  ->  ${short(target)}  "${subject}"
changelog:  ${entries.length} entries, newest ${newest}   (https://docs.worca.dev/changelog/${newest}/)`);
for (const w of warnings) console.log(`warning:    ${w}`);

if (dryRun) {
  console.log('\n--dry-run: nothing pushed.');
  process.exit(0);
}
const push = spawnSync('git', ['push', 'origin', `${target}:refs/heads/docs-live`], { cwd: repo, stdio: 'inherit' });
if (push.status !== 0) fail('git push to docs-live failed');
console.log('\nPushed. Workers Builds deploys docs.worca.dev from docs-live in a minute or two.');

function fail(msg) {
  console.error(`docs:publish: ${msg}`);
  process.exit(1);
}
