// test/supply-chain.test.mjs
// G20: what an install or an image build pulls in is locked, not resolved at
// build time. The published tarball carries npm-shrinkwrap.json (package.json
// `files` names it, and the image installs it with `npm ci`), the base image
// is pinned by digest, third-party actions by commit, and Dependabot
// proposes the updates.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import YAML from 'yaml';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(join(ROOT, p), 'utf8');

test('npm-shrinkwrap.json locks the package the image installs, and is the only root lockfile', () => {
  assert.ok(existsSync(join(ROOT, 'npm-shrinkwrap.json')), 'npm-shrinkwrap.json is committed');
  assert.ok(!existsSync(join(ROOT, 'package-lock.json')), 'one lockfile: npm ignores package-lock.json beside a shrinkwrap');
  const pkg = JSON.parse(read('package.json'));
  const lock = JSON.parse(read('npm-shrinkwrap.json'));
  assert.equal(lock.name, pkg.name);
  assert.equal(lock.version, pkg.version);
  assert.ok(lock.lockfileVersion >= 3);
  for (const dep of Object.keys(pkg.dependencies)) {
    const entry = lock.packages[`node_modules/${dep}`];
    assert.ok(entry && entry.version && entry.integrity, `${dep} is locked with an integrity hash`);
  }
  // npm 11's packlist packs a shrinkwrap only when `files` names it (older npm always did).
  assert.ok(pkg.files.includes('npm-shrinkwrap.json'), 'package.json files ships the shrinkwrap');
});

test('Dockerfile: the node base image is pinned by digest', () => {
  const d = read('docker/Dockerfile');
  const froms = d.split('\n').filter((l) => /^FROM\s/.test(l));
  assert.deepEqual(froms.length, 1);
  // Literal, not a build arg: Dependabot only reads image references written in FROM.
  assert.match(froms[0], /^FROM node:22-bookworm-slim@sha256:[0-9a-f]{64}$/);
});

test('workflows: every third-party action is pinned by full commit SHA, with its tag in a comment', () => {
  const dir = join(ROOT, '.github', 'workflows');
  const bad = [];
  let seen = 0;
  for (const f of readdirSync(dir).filter((n) => /\.ya?ml$/.test(n))) {
    for (const line of read(`.github/workflows/${f}`).split('\n')) {
      const m = /^\s*(?:-\s+)?uses:\s*(\S+)(.*)$/.exec(line);
      if (!m || m[1].startsWith('./')) continue;
      seen++;
      if (!/^[\w.-]+\/[\w./-]+@[0-9a-f]{40}$/.test(m[1]) || !/#\s*v\d/.test(m[2])) bad.push(`${f}: ${line.trim()}`);
    }
  }
  assert.ok(seen > 0);
  assert.deepEqual(bad, []);
});

test('dependabot.yml: npm, docker and github-actions updates', () => {
  const cfg = YAML.parse(read('.github/dependabot.yml'));
  assert.equal(cfg.version, 2);
  const by = Object.fromEntries(cfg.updates.map((u) => [u['package-ecosystem'], u]));
  assert.equal(by.npm?.directory, '/');
  assert.equal(by.docker?.directory, '/docker');
  assert.equal(by['github-actions']?.directory, '/');
  for (const u of cfg.updates) assert.ok(u.schedule?.interval, `${u['package-ecosystem']} has a schedule`);
});
