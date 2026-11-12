// test/engine-cli-resolve-routing.test.mjs — every engine's preflight / ask-support check (and the chat
// self-test's version probe) goes through the shared CLI resolver with ITS OWN spec, and a refusal for a
// script shim shows the resolver's explanation instead of the engine's install tail.
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { _testing } from '../src/core/engines/exec-cli.mjs';
import { ENGINE_CLIS } from '../src/core/engines/cli-specs.mjs';
import { binaryVersion } from '../src/core/engines/chat-selftest.mjs';
import { codexPreflight, codexAskSupport } from '../src/core/engines/codex.mjs';
import { copilotPreflight, copilotAskSupport } from '../src/core/engines/copilot.mjs';
import { cursorPreflight } from '../src/core/engines/cursor.mjs';
import { goosePreflight, gooseAskSupport } from '../src/core/engines/goose.mjs';
import { geminiPreflight, geminiAskSupport } from '../src/core/engines/gemini.mjs';
import { qwenPreflight, qwenAskSupport } from '../src/core/engines/qwen.mjs';
import { opencodePreflight, opencodeAskSupport } from '../src/core/engines/opencode.mjs';

afterEach(() => _testing.reset());

/** Every check each engine has, with the install words its refusal carries when no shim was found. */
const CHECKS = {
  codex: { checks: [codexPreflight, codexAskSupport], tail: 'install codex' },
  copilot: { checks: [copilotPreflight, copilotAskSupport], tail: 'npm i -g @github/copilot' },
  cursor: { checks: [cursorPreflight], tail: 'cursor-agent' },
  goose: { checks: [goosePreflight, gooseAskSupport], tail: 'install the Goose CLI' },
  gemini: { checks: [geminiPreflight, geminiAskSupport], tail: 'npm i -g @google/gemini-cli' },
  qwen: { checks: [qwenPreflight, qwenAskSupport], tail: 'npm i -g @qwen-code/qwen-code' },
  opencode: { checks: [opencodePreflight, opencodeAskSupport], tail: 'opencode.ai' },
};

test('every non-Claude engine in ENGINE_CLIS has its routing checks listed here', () => {
  assert.deepEqual(Object.keys(CHECKS).sort(), Object.keys(ENGINE_CLIS).filter((n) => n !== 'claude').sort());
});

for (const [engine, { checks, tail }] of Object.entries(CHECKS)) {
  test(`${engine}: each check resolves with the ${engine} spec and shows the resolver's hint`, async () => {
    for (const check of checks) {
      const specs = [];
      _testing.set({
        execFile: (f, a, o, cb) => cb(Object.assign(new Error('x'), { code: 'ENOENT' }), '', ''),
        explain: (bin, spec) => { specs.push(spec.id); return `HINT-${spec.id}`; },
      });
      const r = await check({ bin: 'zz-missing-bin' });
      assert.ok(specs.length > 0 && specs.every((id) => id === engine), `${check.name}: spec ids ${specs}`);
      assert.match(r.refusal, new RegExp(`HINT-${engine}`), `${check.name}: ${JSON.stringify(r)}`);
      assert.ok(!r.refusal.includes(tail), `${check.name}: the install tail is replaced by the hint`);
    }
  });
}

test('the chat self-test version probe uses the engine\'s spec', async () => {
  const specs = [];
  _testing.set({
    execFile: (f, a, o, cb) => cb(Object.assign(new Error('x'), { code: 'ENOENT' }), '', ''),
    explain: (bin, spec) => { specs.push(spec.id); return 'h'; },
  });
  await assert.rejects(binaryVersion('zz-missing-bin', { cli: ENGINE_CLIS.gemini }), (e) => e.cliHint === 'h');
  assert.deepEqual(specs, ['gemini']);
});
