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
  // One external image: every other stage builds FROM a stage of this file (`os`, `pkg`,
  // `engines`), never a second registry image.
  const stages = froms.map((l) => / AS (\S+)$/.exec(l)?.[1]).filter(Boolean);
  const external = froms.filter((l) => !stages.includes(l.split(/\s+/)[1]));
  assert.deepEqual(external.length, 1, `external images: ${external.join(' | ')}`);
  assert.equal(external[0], froms[0], 'the external image is the first stage');
  // Literal, not a build arg: Dependabot only reads image references written in FROM.
  assert.match(froms[0], /^FROM node:\d+-bookworm-slim@sha256:[0-9a-f]{64} AS os$/);
});

// One Node for everything this repo runs: .nvmrc names the major, the image and every single-version
// workflow job follow it, and the fast-test matrix covers the supported range (the exact floor,
// .nvmrc's major, the newest LTS). A Node bump is .nvmrc plus the image digest.
test('one Node: the image and every single-version job use .nvmrc; the matrix spans floor to newest LTS', async () => {
  const nvmrc = read('.nvmrc').trim();
  assert.match(nvmrc, /^\d+$/, '.nvmrc names a major only (an exact pin would go stale)');
  const from = read('docker/Dockerfile').split('\n').find((l) => /^FROM\s/.test(l));
  assert.equal(from.match(/^FROM node:(\d+)-/)[1], nvmrc, "the image's Node major is .nvmrc's");

  const dir = join(ROOT, '.github', 'workflows');
  const setups = [];
  for (const f of readdirSync(dir).filter((n) => /\.ya?ml$/.test(n))) {
    for (const [id, job] of Object.entries(YAML.parse(read(`.github/workflows/${f}`)).jobs || {})) {
      for (const step of job.steps || []) {
        if (String(step.uses || '').startsWith('actions/setup-node@')) setups.push({ at: `${f} ${id}`, with: step.with || {}, matrix: job.strategy?.matrix });
      }
    }
  }
  assert.ok(setups.length > 5, 'setup-node steps found');
  for (const s of setups) {
    if (s.with['node-version'] === '${{ matrix.node }}') continue;
    assert.equal(s.with['node-version-file'], '.nvmrc', `${s.at}: node-version-file .nvmrc`);
    assert.equal(s.with['node-version'], undefined, `${s.at}: no literal node-version`);
  }

  const { MIN_NODE } = await import('../src/core/preflight-node.mjs');
  const matrix = setups.filter((s) => s.with['node-version'] === '${{ matrix.node }}');
  assert.equal(matrix.length, 1, 'one matrix job (ci.yml test-fast)');
  const nodes = matrix[0].matrix.node.map(String);
  assert.equal(nodes[0], MIN_NODE, 'the matrix starts at the exact floor');
  assert.ok(nodes.includes(nvmrc), "the matrix runs .nvmrc's major");
  assert.ok(Number(nodes.at(-1)) >= Number(nvmrc), 'the matrix ends at the newest LTS');
  assert.equal(JSON.parse(read('package.json')).engines.node, `>=${MIN_NODE}`, 'engines is MIN_NODE');
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
