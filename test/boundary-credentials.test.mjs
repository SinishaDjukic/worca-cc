// test/boundary-credentials.test.mjs
// One owner for model credentials (plans/core-protection-layer-design.md §4.2): only the route resolver
// (src/core/exec-env/credentials.mjs) reads a catalog credential name from an env object; the adapters, the harness
// and the remote env take its decision, and open relay routes only from it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ENGINE_NAMES } from '../src/shared/engine-switch.mjs';
import { credentialNamesOf } from '../src/core/exec-env/credentials.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const NAMES = [...new Set(ENGINE_NAMES.flatMap(credentialNamesOf))];
const scanned = () => [
  ...readdirSync(join(ROOT, 'src/core/engines')).filter((f) => f.endsWith('.mjs')).map((f) => `src/core/engines/${f}`),
  'src/core/run-harness.mjs', 'src/core/exec-env/remote-env.mjs',
];
const strip = (src) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');   // comments only

test('no owner but the resolver reads a catalog credential name from an env object', () => {
  const bad = [];
  for (const f of scanned()) {
    const src = strip(readFileSync(join(ROOT, f), 'utf8'));
    for (const k of NAMES) {
      // `.NAME`, `?.NAME`, or `x['NAME']` — a member read; an array literal `['NAME']` is not one (lookbehind).
      const re = new RegExp(`(\\?\\.|\\.)${k}\\b|(?<=[\\w$)\\]]\\s*)\\[\\s*['"\`]${k}['"\`]\\s*\\]`);
      if (re.test(src)) bad.push(`${f}: ${k}`);
    }
  }
  assert.deepEqual(bad, []);
});

test('the guard sees every credential name the catalog declares', () => {
  for (const k of ['CLAUDE_CODE_OAUTH_TOKEN', 'ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN', 'CODEX_API_KEY', 'OPENAI_API_KEY',
    'COPILOT_GITHUB_TOKEN', 'COPILOT_PROVIDER_API_KEY', 'CURSOR_API_KEY', 'CURSOR_AUTH_TOKEN']) assert.ok(NAMES.includes(k), k);
  assert.ok(!NAMES.includes('CODEX_HOME') && !NAMES.includes('ANTHROPIC_BASE_URL'), 'dirs and config are not credentials');
});

test('adapters open routes only from a resolved decision', () => {
  for (const f of scanned().filter((x) => x.startsWith('src/core/engines/'))) {
    const src = strip(readFileSync(join(ROOT, f), 'utf8'));
    assert.ok(!/\.open(Model|Engine)Route\(/.test(src), `${f} calls a back-compat opener; use openRoute(decision, …)`);
  }
});
