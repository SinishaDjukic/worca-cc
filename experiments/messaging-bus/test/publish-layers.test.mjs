// T-publish-layers: the workflow switch (plan §3.5, §4.7).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolvePublishLayers, DEFAULT_LAYERS } from '../lib/publish-layers.mjs';

test('defaults: lifecycle and auto on, prompt off', () => {
  assert.deepEqual(resolvePublishLayers(), { lifecycle: true, auto: true, prompt: false });
  assert.deepEqual(resolvePublishLayers({}, {}), { lifecycle: true, auto: true, prompt: false });
  assert.deepEqual(DEFAULT_LAYERS, { lifecycle: true, auto: true, prompt: false });
});

test('the workflow default applies first, then the node override wins', () => {
  assert.deepEqual(resolvePublishLayers({ prompt: true }), { lifecycle: true, auto: true, prompt: true });
  assert.deepEqual(resolvePublishLayers({ prompt: true, auto: false }, { auto: true }), { lifecycle: true, auto: true, prompt: true });
  assert.deepEqual(resolvePublishLayers(null, { lifecycle: false }), { lifecycle: false, auto: true, prompt: false });
});

test('an unknown key or a non-boolean value is refused with BUS_BAD_CONFIG naming the key', () => {
  const bad = (w, n, key) => assert.throws(() => resolvePublishLayers(w, n), (e) => e.code === 'BUS_BAD_CONFIG' && e.message.includes(key));
  bad({ promt: true }, undefined, 'promt');
  bad(undefined, { auto: 'yes' }, 'auto');
  bad({ lifecycle: 1 }, undefined, 'lifecycle');
  assert.throws(() => resolvePublishLayers('on'), (e) => e.code === 'BUS_BAD_CONFIG');
});
