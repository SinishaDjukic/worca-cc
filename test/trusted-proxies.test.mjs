// test/trusted-proxies.test.mjs — X1: one rule for a trusted identity header, on the UI server and the broker's
// key page: WORCA_IDENTITY_HEADER is believed only from WORCA_IDENTITY_TRUSTED_PROXIES.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseAddressList, createTrustedPeerCheck, identityHeaderTrust } from '../src/core/trusted-proxies.mjs';

const req = (peer) => ({ socket: { remoteAddress: peer }, headers: {} });

test('parseAddressList: IPs and CIDRs, split on commas or spaces; anything else is bad', () => {
  assert.deepEqual(parseAddressList('10.0.0.5, 172.18.0.0/16 fd00::/8'), { list: ['10.0.0.5', '172.18.0.0/16', 'fd00::/8'], bad: [] });
  assert.deepEqual(parseAddressList('proxy.local 10.0.0.0/33 1.2.3.4/8/1').bad, ['proxy.local', '10.0.0.0/33', '1.2.3.4/8/1']);
});

test('createTrustedPeerCheck: only listed peers, v4-mapped unmapped; an empty list trusts nobody', () => {
  const ok = createTrustedPeerCheck(['172.18.0.0/16', '::1']);
  for (const p of ['172.18.0.9', '::ffff:172.18.3.4', '::1']) assert.equal(ok(req(p)), true, p);
  for (const p of ['127.0.0.1', '127.0.0.2', '172.19.0.1', undefined]) assert.equal(ok(req(p)), false, String(p));
  assert.equal(createTrustedPeerCheck([])(req('127.0.0.1')), false);
});

test('identityHeaderTrust: no header, nothing to check; a header needs valid trusted proxies (the server refuses to boot)', () => {
  assert.deepEqual(identityHeaderTrust({}).errors, []);
  assert.equal(identityHeaderTrust({}).header, null);
  assert.match(identityHeaderTrust({ WORCA_IDENTITY_HEADER: 'X-Forwarded-Email' }).errors[0], /needs WORCA_IDENTITY_TRUSTED_PROXIES/);
  assert.match(identityHeaderTrust({ WORCA_IDENTITY_HEADER: 'X-Forwarded-Email', WORCA_IDENTITY_TRUSTED_PROXIES: 'proxy' }).errors[0], /not an IP address or CIDR/);
  const t = identityHeaderTrust({ WORCA_IDENTITY_HEADER: 'X-Forwarded-Email', WORCA_IDENTITY_TRUSTED_PROXIES: '10.0.0.5' });
  assert.deepEqual([t.header, t.errors, t.trusted(req('10.0.0.5')), t.trusted(req('10.0.0.6'))], ['x-forwarded-email', [], true, false]);
});
