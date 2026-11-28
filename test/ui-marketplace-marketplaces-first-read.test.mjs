// test/ui-marketplace-marketplaces-first-read.test.mjs
// The test of test/ui-marketplace-marketplaces.test.mjs about the Marketplaces page BEFORE its first good read: the
// app keeps a page it once painted, so with one app boot per file this test lives in its own file, where the page has
// not been read yet (test/helpers/shared-app-boot.mjs, C5). Its server stub is the original file's, from
// test/helpers/mk-marketplaces-fixtures.mjs.
import { test, before, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { useSharedApp } from './helpers/shared-app-boot.mjs';
import { EXAMPLE, marketplaceApi } from './helpers/mk-marketplaces-fixtures.mjs';

const tick = () => new Promise((r) => setTimeout(r, 0));
const settle = async (n = 10) => { for (let i = 0; i < n; i++) await tick(); };

const app = useSharedApp({ before, beforeEach, after }, {
  url: 'http://localhost:4319/',
  fetchHandler: marketplaceApi().fetchHandler,
});
const WSStub = { get last() { return { frame: (msg) => app.recv(msg) }; } };

async function boot(server = {}) {
  const { calls, state, fetchHandler } = marketplaceApi(server);
  await app.fresh({ fetchHandler });
  await settle();
  return { window: app.window, doc: app.document, calls, state };
}

async function go(window, hash) { window.location.hash = hash; window.dispatchEvent(new window.Event('hashchange')); await settle(); }
const dialog = (d) => d.querySelector('#mk-dialog-host #mk-dialog');
const head = (d) => d.querySelector('#mk-root .mk-head-actions[data-tab="marketplaces"]');

test('Open it before the first good read: the card takes focus when the page first paints it', async () => {
  let down = true;
  const { window, doc } = await boot({ api: (m, p) => {
    if (down && m === 'GET' && p === '/api/plugins') return { status: 500, body: { error: 'db locked' } };
    if (m === 'POST' && p === '/api/marketplaces') return { status: 409, body: { error: 'x', code: 'EXISTS', existing: { id: EXAMPLE.id, name: EXAMPLE.name } } };
    return undefined;
  } });
  await go(window, 'marketplace/marketplaces');
  head(doc).querySelector('.mk-add-mkt').click(); await settle();
  const url = doc.getElementById('mk-add-url');
  url.value = 'example/worca-marketplace'; url.dispatchEvent(new window.Event('input', { bubbles: true }));
  dialog(doc).querySelector('.mk-add-primary').click(); await settle();
  dialog(doc).querySelector('.mk-add-primary').click(); await settle();
  assert.equal(doc.querySelector('#mk-root section.mk-mkt'), null, 'nothing painted yet');
  down = false;
  WSStub.last.frame({ type: 'plugins-changed', action: 'install' }); await settle();
  assert.equal(doc.activeElement.dataset.id, EXAMPLE.id);
});
