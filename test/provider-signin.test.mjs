// test/provider-signin.test.mjs
// src/core/provider-signin.mjs — "signed in to a model provider" means ANY provider, so a Copilot-only
// install reaches Runner. Every source is injected; nothing here reads settings or spawns a CLI.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { anyProviderSignedIn } from '../src/core/provider-signin.mjs';

const none = { copilot: { connected: false }, openai: { configured: false }, anthropic: { configured: false }, openrouter: { keySet: false } };
const seams = (over = {}) => ({ claudeConnected: false, providers: async () => none, engines: () => null, mock: () => false, ...over });

test('Copilot only -> signed in (R-po-24)', async () => {
  const r = await anyProviderSignedIn(seams({ providers: async () => ({ ...none, copilot: { connected: true } }) }));
  assert.deepEqual(r, { signedIn: true, via: ['copilot'] });
});

test('each keyed provider counts, alongside Claude', async () => {
  const r = await anyProviderSignedIn(seams({
    claudeConnected: true,
    providers: async () => ({ ...none, openai: { configured: true }, anthropic: { configured: true }, openrouter: { keySet: true } }),
  }));
  assert.deepEqual(r, { signedIn: true, via: ['claude', 'openai', 'anthropic', 'openrouter'] });
});

test('nothing -> false with via []', async () => {
  assert.deepEqual(await anyProviderSignedIn(seams()), { signedIn: false, via: [] });
});

test('a throwing source is false, not a throw', async () => {
  const boom = () => { throw new Error('boom'); };
  const r = await anyProviderSignedIn(seams({ providers: async () => { throw new Error('x'); }, engines: boom, mock: boom }));
  assert.deepEqual(r, { signedIn: false, via: [] });
});

test('a cold engine cache (null) is not signed in; ready claude/mock engines are ignored, others count', async () => {
  assert.equal((await anyProviderSignedIn(seams({ engines: () => null }))).signedIn, false);
  assert.equal((await anyProviderSignedIn(seams({ engines: () => ['claude', 'mock'] }))).signedIn, false);
  assert.deepEqual(await anyProviderSignedIn(seams({ engines: () => ['claude', 'codex'] })), { signedIn: true, via: ['codex'] });
});

test('mock mode counts', async () => {
  assert.deepEqual(await anyProviderSignedIn(seams({ mock: () => true })), { signedIn: true, via: ['mock'] });
});
