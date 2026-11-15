// test/stillhet-chat-persp-picker.test.mjs — the TaskProposal's "reviewed by" picker on a live task card (flag
// proposedPerspectives; docs/rail/panels.md panel.conversation-cards). Dev's perspectives with Compliance, Product always
// on, and the ticked set sent with Start as dev's run card sends it (POST /api/run `perspectives`). jsdom app host:
// test/helpers/stillhet-chat-live-host.mjs, its fixture's proposed card `card_prop`.
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { closeHosts, go, liveHost, settle } from './helpers/stillhet-chat-live-host.mjs';

afterEach(closeHosts);
const MENU = 'pp-card_prop-persp';

async function host({ on = true } = {}) {
  const h = await liveHost();
  h.sockets.at(-1).onmessage({ data: JSON.stringify({ type: 'flags', flags: { proposedPerspectives: on } }) });
  await go(h.w, '#chat/ask_1');
  const q = (sel) => h.d.querySelector(`#route-chat ${sel}`);
  const picker = () => q(`[data-menu="${MENU}"]`);
  const item = (key) => q(`[data-menu-pick="${MENU}|${key}"]`);
  const open = async () => { if (picker().getAttribute('aria-expanded') !== 'true') { picker().click(); await settle(10); } };
  const tick = async (key) => { await open(); item(key).click(); await settle(10); };
  const start = async () => { q('[data-pp-start="card_prop"]').click(); await settle(40); return h.calls.filter((c) => c.url === '/api/run').at(-1)?.body; };
  return { ...h, q, picker, item, open, tick, start };
}

test('flag off: no reviewed-by picker, and Start sends no perspective set', async () => {
  const s = await host({ on: false });
  assert.equal(s.picker(), null);
  const body = await s.start();
  assert.ok(body, 'Start went out');
  assert.equal('perspectives' in body, false);
});

test('flag on: the picker sits in the card\'s sentence, reading dev\'s default set', async () => {
  const s = await host();
  const p = s.picker();
  assert.ok(p);
  const card = p.closest('[data-anchor="card_prop"]');
  assert.ok(card, 'inside the card');
  assert.equal(p.textContent.trim(), 'Product, Architect, QA');
  assert.match(card.textContent, /reviewed by\s*Product, Architect, QA/);
});

test('the menu lists dev\'s perspectives with Compliance, Project fit held back, the default set ticked', async () => {
  const s = await host();
  await s.open();
  for (const k of ['product', 'architect', 'qa', 'ux', 'security', 'devops', 'release', 'devil', 'compliance']) assert.ok(s.item(k), k);
  assert.equal(s.item('fit'), null, 'Project fit is offered only once picked');
  const ticked = [...s.d.querySelectorAll(`#route-chat [data-menu-pick^="${MENU}|"][aria-checked="true"]`)].map((b) => b.dataset.menuPick.split('|')[1]);
  assert.deepEqual(ticked, ['product', 'architect', 'qa']);
});

test('Product is always on: its item is disabled with "Always reviews", and picking it changes nothing', async () => {
  const s = await host();
  await s.open();
  const p = s.item('product');
  assert.equal(p.getAttribute('aria-disabled'), 'true');
  assert.equal(p.title, 'Always reviews');
  p.click(); await settle(10);
  assert.equal(s.picker().textContent.trim(), 'Product, Architect, QA');
});

test('ticking Compliance adds it in list order; the menu stays open to tick more', async () => {
  const s = await host();
  await s.tick('compliance');
  assert.equal(s.picker().textContent.trim(), 'Product, Architect, QA, Compliance');
  assert.ok(s.item('security'), 'still open');
  await s.tick('security');
  assert.equal(s.picker().textContent.trim(), 'Product, Architect, QA, Security, Compliance');
});

test('unticking a perspective drops it', async () => {
  const s = await host();
  await s.tick('architect');
  assert.equal(s.picker().textContent.trim(), 'Product, QA');
});

test('Start sends the default set as dev\'s perspectives field', async () => {
  const s = await host();
  const body = await s.start();
  assert.deepEqual(body.perspectives, ['product', 'architect', 'qa']);
  assert.equal('perspectiveProposal' in body, false);
  assert.equal('shape' in body, false);
});

test('Start sends the ticked set, Product always in it', async () => {
  const s = await host();
  await s.tick('architect');
  await s.tick('qa');
  await s.tick('compliance');
  const body = await s.start();
  assert.deepEqual(body.perspectives, ['product', 'compliance']);
});

test('a repaint keeps the ticks', async () => {
  const s = await host();
  await s.tick('ux');
  s.d.body.click(); await settle(10);
  await go(s.w, '#chat/ask_2');
  await go(s.w, '#chat/ask_1');
  assert.equal(s.picker().textContent.trim(), 'Product, Architect, QA, UX');
});

test('the flag turned on later draws the picker on the next paint', async () => {
  const s = await host({ on: false });
  assert.equal(s.picker(), null);
  s.sockets.at(-1).onmessage({ data: JSON.stringify({ type: 'flags', flags: { proposedPerspectives: true } }) });
  await go(s.w, '#chat/ask_2');
  await go(s.w, '#chat/ask_1');
  assert.equal(s.picker().textContent.trim(), 'Product, Architect, QA');
});
