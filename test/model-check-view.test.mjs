// test/model-check-view.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { modelCheckNote } from '../ui/public/model-check-view.mjs';

test('modelCheckNote: one sentence per problem, null when healthy or skipped', () => {
  assert.equal(modelCheckNote(null), null);
  assert.equal(modelCheckNote({ ok: true, problems: [] }), null);
  assert.equal(modelCheckNote({ ok: true, skipped: 'auto' }), null);
  const s = modelCheckNote({ ok: false, problems: [
    { model: 'gw-gpt', provider: 'openai', nodes: ['Implement'], message: 'provider openai: no API key — open Settings › Providers', fix: 'add an API key for openai in Settings › Providers' },
    { model: null, nodes: ['Plan'], message: "Claude Code isn't signed in", fix: 'run `claude` in a terminal and type /login' },
  ] });
  assert.equal(s, "This run can't start yet: gw-gpt (Implement) — provider openai: no API key — open Settings › Providers. Fix: add an API key for openai in Settings › Providers. Claude Code's default model (Plan) — Claude Code isn't signed in. Fix: run `claude` in a terminal and type /login.");
});
