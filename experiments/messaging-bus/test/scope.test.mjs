// T-scope: the spike touches only docs/design/messaging-bus.md and experiments/messaging-bus/**,
// imports only node:* and relative modules, and never spawns a model CLI.
// Pinned to the run checkpoint (BUS_SCOPE_BASE); it skips once that commit is gone or not an
// ancestor of HEAD (after a merge). `npm test` never runs it (its discovery is test/*.mjs).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const EXP = fileURLToPath(new URL('..', import.meta.url));
const REPO = fileURLToPath(new URL('../../..', import.meta.url));
const SELF = fileURLToPath(import.meta.url);
const BASE = process.env.BUS_SCOPE_BASE || '70ae23e5b8fb20c28342944a6ca251e1b9ad02b0';
const git = (...args) => spawnSync('git', ['-C', REPO, ...args], { encoding: 'utf8' });

function walk(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...walk(p));
    else out.push(p);
  }
  return out;
}

const baseOk = git('cat-file', '-e', `${BASE}^{commit}`).status === 0 && git('merge-base', '--is-ancestor', BASE, 'HEAD').status === 0;

test('only the two folders change', { skip: baseOk ? false : `base ${BASE} is absent or not an ancestor of HEAD` }, () => {
  const changed = git('diff', '--name-only', BASE).stdout.split('\n').filter(Boolean);
  const untracked = git('ls-files', '-o', '--exclude-standard').stdout.split('\n').filter(Boolean);
  const files = [...new Set([...changed, ...untracked])];
  assert.ok(files.length > 0);
  const outside = files.filter((f) => f !== 'docs/design/messaging-bus.md' && !f.startsWith('experiments/messaging-bus/'));
  assert.deepEqual(outside, []);
});

const sources = walk(EXP).filter((f) => f.endsWith('.mjs') && f !== SELF);

test('imports are node:* or relative only', () => {
  // static import/export … from '…', bare import '…', and literal import('…') / require('…')
  const SPEC = /(?:^\s*(?:import|export)\b[^'"\n;]*?\bfrom\s*|^\s*import\s*|\bimport\s*\(\s*|\brequire\s*\(\s*)(['"])([^'"\n]+)\1/gm;
  for (const f of sources) {
    for (const m of readFileSync(f, 'utf8').matchAll(SPEC)) {
      const spec = m[2];
      assert.ok(spec.startsWith('node:') || spec.startsWith('./') || spec.startsWith('../'), `${relative(EXP, f)} imports ${spec}`);
    }
  }
});

test('no engine spawn', () => {
  const CLIS = ['claude', 'codex', 'copilot', 'cursor', 'cursor-agent', 'gemini', 'goose', 'opencode', 'qwen'];
  const SPAWN = new RegExp(`\\b(?:spawn|spawnSync|exec|execSync|execFile|execFileSync|fork)\\s*\\(\\s*['"\`](?:${CLIS.join('|')})\\b`);
  for (const f of walk(EXP).filter((p) => p !== SELF && /\.(mjs|js|json|md)$/.test(p))) {
    assert.doesNotMatch(readFileSync(f, 'utf8'), SPAWN, relative(EXP, f));
  }
});
