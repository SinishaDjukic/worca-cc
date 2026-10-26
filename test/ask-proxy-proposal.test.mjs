// test/ask-proxy-proposal.test.mjs — src/core/ask/proxy-proposal.mjs: the propose_network_proxy_change /
// propose_corporate_proxy_on validators and the card's event text. The preview is the real PUT validation + merge.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createProxyChangeValidator, createProxyFlagValidator, proxyEventPrompt, proxyNoticeText, PROXY_LIVE_NOTE } from '../src/core/ask/proxy-proposal.mjs';
import { assertNetworkProxyInput, mergeNetworkProxy } from '../src/core/settings.mjs';

const validator = ({ current = { upstream: 'http://proxy.acme.test:8080', auth: 'ntlm' } } = {}) => createProxyChangeValidator({
  current: () => ({ ...current }),
  preview: (patch) => { assertNetworkProxyInput(patch); return mergeNetworkProxy(current, patch); },
});

test('a change builds a before → after card with the live note; the patch is what PUT would send', async () => {
  const r = await validator()({ upstream: 'proxy2.acme.test:3128', noProxy: 'intranet.acme.test,.corp', timeouts: { connectMs: 10000 }, note: 'new office' });
  assert.equal(r.ok, true);
  assert.equal(r.card.type, 'proxy');
  assert.equal(r.card.kind, 'settings');
  assert.deepEqual(r.card.patch, { upstream: 'proxy2.acme.test:3128', noProxy: 'intranet.acme.test,.corp', timeouts: { connectMs: 10000 } });
  assert.deepEqual(r.card.changes.find((c) => c.field === 'upstream'), { field: 'upstream', label: 'Proxy', before: 'proxy.acme.test:8080', after: 'proxy2.acme.test:3128' });
  assert.equal(r.card.upstreamChanged, true);
  assert.equal(r.card.restartNote, PROXY_LIVE_NOTE);
  assert.equal(PROXY_LIVE_NOTE, 'New connections use it now.');
  assert.equal(r.card.note, 'new office');
});

test('unset with null; same validation errors as PUT; nothing to change; no password ever', async () => {
  const v = validator();
  assert.deepEqual((await v({ auth: null })).card.changes, [{ field: 'auth', label: 'Login', before: 'NTLMv2', after: 'default (NTLMv2 with a saved login, else none)' }]);
  assert.match((await v({ fixedPort: 80 })).errors[0], /fixedPort must be a port from 1024 to 65535/);
  assert.match((await v({ auth: 'negotiate' })).errors[0], /must be one of auto, none, basic, ntlm, digest/);
  assert.match((await v({ upstream: 'proxy.acme.test:8080' })).errors[0], /nothing would change/);
  const pw = await v({ password: 'Winter2026!', upstream: 'p.acme.test:1' });
  assert.equal(pw.ok, false);
  assert.ok(!JSON.stringify(pw).includes('Winter2026!'), 'the value is never echoed');
  const url = await v({ upstream: 'http://jdoe:Winter2026!@p.acme.test:3128' });
  assert.ok(!JSON.stringify(url).includes('Winter2026!'));
});

test('enable card: on → refused as already on; off → a card proposing networkProxy.enabled', async () => {
  const on = createProxyFlagValidator({ enabledNow: () => true });
  assert.match((await on({})).errors[0], /already on/);
  const r = await createProxyFlagValidator({ enabledNow: () => false })({ note: 'behind the ACME proxy' });
  assert.deepEqual([r.card.type, r.card.kind, r.card.restartNote], ['proxy', 'enable', PROXY_LIVE_NOTE]);
  assert.deepEqual(r.card.patch, { enabled: true });
  assert.deepEqual(r.card.changes, [{ field: 'enabled', label: 'Network proxy', before: 'Off', after: 'On' }]);
  assert.equal(r.card.note, 'behind the ACME proxy');
});

test('event and notice text', () => {
  const card = { summary: 'Proxy: proxy2.acme.test:3128' };
  assert.equal(proxyEventPrompt({ cardId: 'card_1', state: 'declined', card }), '[worca event] proxy card card_1 declined; "Proxy: proxy2.acme.test:3128"');
  assert.equal(proxyEventPrompt({ cardId: 'card_1', state: 'failed', card, result: { error: 'boom' } }), '[worca event] proxy card card_1 failed: boom; "Proxy: proxy2.acme.test:3128"');
  assert.match(proxyEventPrompt({ cardId: 'card_1', state: 'applied', card, result: { detail: 'Saved. New connections use it now.' } }), /applied; .*New connections use it now\./);
  assert.equal(proxyNoticeText({ state: 'declined', card }), 'Declined — Proxy: proxy2.acme.test:3128');
});
