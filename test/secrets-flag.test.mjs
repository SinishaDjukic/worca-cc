// test/secrets-flag.test.mjs — the secretVault flag: the one gate later slices call; in this slice it changes nothing.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, readdirSync, statSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const HOME = mkdtempSync(join(tmpdir(), 'worca-secrets-flag-'));
const prev = { HOME: process.env.HOME, USERPROFILE: process.env.USERPROFILE, ALLOW: process.env.WORCA_TEST_ALLOW_HOME_FALLBACK, FLAGS: process.env.WORCA_FLAGS };
process.env.HOME = HOME;
process.env.USERPROFILE = HOME;
process.env.WORCA_TEST_ALLOW_HOME_FALLBACK = '1';
delete process.env.WORCA_FLAGS;
after(() => {
  for (const [k, v] of [['HOME', prev.HOME], ['USERPROFILE', prev.USERPROFILE], ['WORCA_TEST_ALLOW_HOME_FALLBACK', prev.ALLOW], ['WORCA_FLAGS', prev.FLAGS]]) {
    if (v === undefined) delete process.env[k]; else process.env[k] = v;
  }
  rmSync(HOME, { recursive: true, force: true });
});

const { secretVaultEnabled } = await import('../src/core/secrets/flag.mjs');
const { writeSettingsKeys, settingsFile } = await import('../src/core/settings.mjs');
const { guardrailsToPermissionRules, GUARDRAIL_PRESETS } = await import('../src/core/guardrails.mjs');
const { ASK_DENY_RULES } = await import('../src/core/ask/deny-rules.mjs');
const { checkAskCommand } = await import('../src/core/ask/command-policy.mjs');

const setFlag = (on) => { if (on) process.env.WORCA_FLAGS = 'secretVault'; else delete process.env.WORCA_FLAGS; };

test('secretVaultEnabled: off by default, on under WORCA_FLAGS', () => {
  setFlag(false);
  assert.equal(secretVaultEnabled(), false);
  setFlag(true);
  assert.equal(secretVaultEnabled(), true);
  setFlag(false);
});

test('the flag changes no written byte, file mode, file name or deny rule', async () => {
  const snapshot = async (on) => {
    setFlag(on);
    rmSync(join(HOME, '.worca-cc'), { recursive: true, force: true });
    await writeSettingsKeys({ a: 1 });
    const file = settingsFile();
    return {
      bytes: readFileSync(file, 'utf8'),
      mode: process.platform === 'win32' ? null : statSync(file).mode & 0o777,
      names: readdirSync(join(HOME, '.worca-cc')).sort(),
      rules: guardrailsToPermissionRules(GUARDRAIL_PRESETS.normal),
      ask: [...ASK_DENY_RULES],
      cmd: checkAskCommand('secret-tool lookup service worca', { cwd: '/w/proj', home: join(HOME, '.worca-cc'), userHome: HOME }),
    };
  };
  const off = await snapshot(false);
  const on = await snapshot(true);
  setFlag(false);
  assert.deepEqual(on, off);
  if (process.platform !== 'win32') assert.equal(off.mode, 0o600);
});
