// test/scratch-start.test.mjs
// `npm start --scratch` starts the UI on a temp WORCA_HOME and a free port.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { wantsScratch, scratchEnv } from '../src/core/scratch-start.mjs';

const argv = (...rest) => ['node', 'ui/server.mjs', ...rest];

test('wantsScratch: the --scratch argument or npm config env asks for it', () => {
  assert.equal(wantsScratch({ argv: argv('--scratch'), env: {} }), true);
  assert.equal(wantsScratch({ argv: argv(), env: { npm_config_scratch: 'true' } }), true);
  assert.equal(wantsScratch({ argv: argv(), env: {} }), false);
  assert.equal(wantsScratch({ argv: argv(), env: { npm_config_scratch: '' } }), false);
});

test('scratchEnv: a new temp home and port 0 when neither is set', () => {
  const out = scratchEnv({ env: {}, mkdtemp: (p) => `${p}abc` });
  assert.match(out.WORCA_HOME, /worca-scratch-abc$/);
  assert.equal(out.PORT, '0');
});

test('scratchEnv: an explicit WORCA_HOME or PORT is kept', () => {
  const out = scratchEnv({ env: { WORCA_HOME: '/x', PORT: '4411' }, mkdtemp: () => assert.fail('no temp dir') });
  assert.deepEqual(out, {});
});
