// test/design-preview-inline.test.mjs - Design P8 Task 8: the server-side `inline` default (L8.17, L8.18). Behind an
// identity proxy (Cloudflare Access, an issuer, or WORCA_INSECURE_NO_IDENTITY_CHECK) the sandboxed preview frame may
// get no cookies for its subresources, so the doc embeds its CSS, fonts and images. WORCA_DESIGN_PREVIEW_INLINE `1` or
// `0` wins; any other value means "use the rule".
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { designPreviewInline } from '../src/core/design/preview-gate.mjs';
import { checkRows } from './helpers/rows.mjs';

const ACCESS = { identity: { provider: 'cloudflare-access', teamDomain: 't.cloudflareaccess.com', aud: 'a' }, insecureNoIdentity: false };
const ISSUER = { identity: { provider: 'issuer', issuer: 'https://id.example.com' }, insecureNoIdentity: false };

test('designPreviewInline: on behind any identity proxy, off locally, the env override wins', async () => {
  const row = (name, opts, want) => ({ name, run: () => assert.equal(designPreviewInline(opts), want) });
  await checkRows([
    row('no remote access', { env: {} }, false),
    row('remote access with no identity', { env: {}, remoteAccess: {} }, false),
    row('Cloudflare Access', { env: {}, remoteAccess: ACCESS }, true),
    row('an issuer', { env: {}, remoteAccess: ISSUER }, true),
    row('WORCA_INSECURE_NO_IDENTITY_CHECK', { env: {}, remoteAccess: { identity: null, insecureNoIdentity: true } }, true),
    row('env 0 turns it off behind an identity', { env: { WORCA_DESIGN_PREVIEW_INLINE: '0' }, remoteAccess: ACCESS }, false),
    row('env 1 turns it on with no remote access', { env: { WORCA_DESIGN_PREVIEW_INLINE: '1' } }, true),
    row('env yes is the rule: on with an identity', { env: { WORCA_DESIGN_PREVIEW_INLINE: 'yes' }, remoteAccess: ACCESS }, true),
    row('env yes is the rule: off without one', { env: { WORCA_DESIGN_PREVIEW_INLINE: 'yes' } }, false),
  ]);
});

test('designPreviewInline reads process.env on every call, never a cached copy', (t) => {
  const prev = process.env.WORCA_DESIGN_PREVIEW_INLINE;
  t.after(() => { if (prev === undefined) delete process.env.WORCA_DESIGN_PREVIEW_INLINE; else process.env.WORCA_DESIGN_PREVIEW_INLINE = prev; });
  delete process.env.WORCA_DESIGN_PREVIEW_INLINE;
  assert.equal(designPreviewInline({ remoteAccess: ACCESS }), true);
  process.env.WORCA_DESIGN_PREVIEW_INLINE = '0';
  assert.equal(designPreviewInline({ remoteAccess: ACCESS }), false);
  process.env.WORCA_DESIGN_PREVIEW_INLINE = '1';
  assert.equal(designPreviewInline(), true);
});
