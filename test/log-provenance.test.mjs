// stream:'err' records the origin CHANNEL. It must be derived from whether the
// subprocess actually wrote stderr — a `|| 'exit 1'` fallback carries no stderr
// bytes, and tagging it makes the tag a lie; conversely a warn line that embeds
// real stderr must carry it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { errStreamAttr } from '../src/core/run-harness.mjs';

test('non-empty stderr yields the stream tag', () => {
  assert.deepEqual(errStreamAttr('boom'), { stream: 'err' });
});

test('empty/whitespace/absent stderr yields NO tag', () => {
  assert.equal(errStreamAttr(''), null);
  assert.equal(errStreamAttr('   '), null);
  assert.equal(errStreamAttr(undefined), null);
});

test('extra attrs merge under the tag and survive without it', () => {
  assert.deepEqual(errStreamAttr('boom', { nodeId: 'n1' }), { nodeId: 'n1', stream: 'err' });
  assert.deepEqual(errStreamAttr('', { nodeId: 'n1' }), { nodeId: 'n1' });
});
