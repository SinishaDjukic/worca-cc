// test/setup-slot-checks.test.mjs — the catalog checks setup apply runs on an asserted modelRoles / askModels patch
// (src/core/setup/slot-checks.mjs): ids are rewritten to the catalog's spelling, a pending import keeps its own.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { useTempHome } from './helpers/temp-home.mjs';

const HOME = useTempHome(after);
process.env.HOME = HOME; process.env.USERPROFILE = HOME;
process.env.WORCA_TEST_ALLOW_HOME_FALLBACK = '1';
delete process.env.WORCA_BROKER_URL;

const { canonicaliseModelIds, checkAskModelsPatch } = await import('../src/core/setup/slot-checks.mjs');

test('canonicaliseModelIds: a catalog id is rewritten to its stored spelling, a pending id to its import\'s, unknown and empty pairs are left alone', async () => {
  const pairs = [{ model: 'CLAUDE-OPUS-5-5' }, { model: 'Copilot-GPT-5.5-Mini' }, { model: 'no-such-model' }, null, {}];
  await canonicaliseModelIds(pairs, [{ id: 'copilot-gpt-5.5-mini' }]);
  assert.deepEqual(pairs, [{ model: 'claude-opus-5-5' }, { model: 'copilot-gpt-5.5-mini' }, { model: 'no-such-model' }, null, {}]);
});

test('checkAskModelsPatch: the catalog check runs on the set engines only, and the model comes back canonical', async () => {
  const patch = { claude: { model: 'CLAUDE-OPUS-5-5', effort: 'high' }, codex: null };
  assert.equal(await checkAskModelsPatch(patch), patch);
  assert.deepEqual(patch, { claude: { model: 'claude-opus-5-5', effort: 'high' }, codex: null });
  await assert.rejects(checkAskModelsPatch({ claude: { model: 'no-such-model' } }), /no-such-model/);
});
