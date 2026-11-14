import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createPreviewGrants, TOKEN_RE } from '../src/core/design/preview-grants.mjs';

test('mint: 256 random bits in base64url, unique, carries design and owner', () => {
  const g = createPreviewGrants({ now: () => 1000 });
  const a = g.mint({ designId: 'd_aaaaaaaaaaaa', owner: 'me@example.com' });
  assert.match(a.token, TOKEN_RE);
  assert.equal(Buffer.from(a.token, 'base64url').length, 32);
  assert.notEqual(g.mint({ designId: 'd_aaaaaaaaaaaa', owner: null }).token, a.token);
  assert.equal(a.expiresAt, 1000 + 43_200_000);
  assert.deepEqual(g.check(a.token), { designId: 'd_aaaaaaaaaaaa', owner: 'me@example.com', expiresAt: 43_201_000 });
});
test('check: expired at exactly expiresAt, and the entry is dropped', () => {
  let t = 0; const g = createPreviewGrants({ now: () => t, ttlMs: 10 });
  const { token } = g.mint({ designId: 'd_aaaaaaaaaaaa', owner: null });
  t = 9; assert.ok(g.check(token));
  t = 10; assert.equal(g.check(token), null); assert.equal(g.size(), 0);
});
test('check refuses anything that is not a live token', () => {
  const g = createPreviewGrants();
  for (const bad of [undefined, null, '', 'x', '__proto__', 'constructor', 'a'.repeat(43), 'a'.repeat(44), 7, {}]) assert.equal(g.check(bad), null);
});
test('revokeDesign drops only that design', () => {
  const g = createPreviewGrants();
  const a = g.mint({ designId: 'd_aaaaaaaaaaaa', owner: null }); const b = g.mint({ designId: 'd_bbbbbbbbbbbb', owner: null });
  assert.equal(g.revokeDesign('d_aaaaaaaaaaaa'), 1);
  assert.equal(g.check(a.token), null); assert.ok(g.check(b.token));
});
test('mint sweeps expired entries, so the map cannot grow without bound', () => {
  let t = 0; const g = createPreviewGrants({ now: () => t, ttlMs: 10 });
  for (let i = 0; i < 5; i++) g.mint({ designId: 'd_aaaaaaaaaaaa', owner: null });
  t = 10; g.mint({ designId: 'd_aaaaaaaaaaaa', owner: null });
  assert.equal(g.size(), 1);
});
