// test/toolchain-setup-plugin.test.mjs
// The bundled toolchain-setup plugin (plugins/toolchain-setup): listed in the builtin marketplace, strict-valid,
// and every script case it ships passes on the real bench. The scripts' own behaviour is covered by the
// test/toolchain-setup-*.test.mjs suites, which stub mise, brew, winget and rustup.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { useTempHome } from './helpers/temp-home.mjs';
import { validatePluginDir } from '../src/core/plugin-manifest.mjs';
import { runPluginScriptCases } from '../src/core/plugin-script-cases.mjs';

useTempHome(after);

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const DIR = join(ROOT, 'plugins', 'toolchain-setup');

test('toolchain-setup is in the builtin marketplace and validates strictly', () => {
  const market = JSON.parse(readFileSync(join(ROOT, 'worca-cc-marketplace.json'), 'utf8'));
  assert.ok(market.plugins.includes('plugins/toolchain-setup'));
  const v = validatePluginDir(DIR, { strict: true });
  assert.equal(v.ok, true, JSON.stringify(v.problems, null, 2));
  // The only warnings are V19: Detect's and Resolve's blocking outputs route on to the next step by design.
  for (const p of v.problems) assert.match(p.message, /V19: blocking output '[^']+' is wired into/, p.message);
});

test('every case the plugin ships passes on the bench', async () => {
  const r = await runPluginScriptCases(DIR);
  assert.deepEqual(r.problems, []);
  const cases = r.scripts.flatMap((s) => s.cases.map((k) => ({ id: `${s.key}/${k.caseId}`, pass: k.pass, diffs: k.diffs })));
  assert.deepEqual(cases.filter((k) => !k.pass), [], 'no case fails');
  assert.deepEqual(r.scripts.map((s) => s.key).sort(),
    ['toolchainBootstrap', 'toolchainDetect', 'toolchainInstall', 'toolchainRecord', 'toolchainResolver', 'toolchainVerify']);
  assert.equal(r.failed, 0);
  assert.ok(r.passed >= 14, `${r.passed} cases passed`);
});
