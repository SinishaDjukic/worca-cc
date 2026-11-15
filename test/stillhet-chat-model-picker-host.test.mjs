// test/stillhet-chat-model-picker-host.test.mjs — the composer's model picker grouped by who makes the model (comp.menu-sub),
// in the app host, live kind (jsdom; the host is test/helpers/stillhet-chat-live-host.mjs). Its keys are menuKeys', its
// Esc the dismiss registry's; a pick is still livePick's (the same PATCH or first-send as before).
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { LISTS, go, liveHost, posts, settle, closeHosts } from './helpers/stillhet-chat-live-host.mjs';

afterEach(closeHosts);
const CAT = LISTS['/api/ask/models'];
const MODELS = { ...LISTS, '/api/ask/models': { ...CAT, models: [{ id: 'gemini-3-pro', label: 'Gemini 3 Pro', engine: 'gemini', efforts: ['high'] }, ...CAT.models, { id: 'copilot/claude-sonnet-5.5', label: 'Claude Sonnet 5.5', engine: 'copilot', efforts: ['high'] }] } };
const R = '#route-chat';
const chip = (d) => d.querySelector(`${R} [data-menu="cp-engine"]`);
const openers = (d) => [...d.querySelectorAll(`${R} .spick [data-menu-sub]:not([data-menu-sub=""])`)].map((e) => e.textContent.trim());
const key = (w, el, k) => el.dispatchEvent(new w.KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true }));
const focused = (d) => d.activeElement?.dataset?.menuSub ?? d.activeElement?.dataset?.menuPick;

test('keys open, leave and pick in a maker sub-menu; the chip then shows the chosen model', async () => {
  const { w, d, calls } = await liveHost({ lists: MODELS });
  await go(w, '#chat');
  chip(d).click(); await settle(5);
  assert.deepEqual(openers(d), ['Anthropic', 'OpenAI', 'Google'], 'MAKERS order, not catalog order');
  const anthropic = () => d.querySelector(`${R} [data-menu-sub="anthropic"]`);
  key(w, anthropic(), 'ArrowRight'); assert.equal(focused(d), 'cp-engine|opus', 'its first model (the chosen one)');
  key(w, d.activeElement, 'ArrowLeft'); assert.equal(focused(d), 'anthropic');
  key(w, d.activeElement, ' '); assert.equal(d.querySelector(`${R} .menu`).dataset.subOf, 'anthropic');
  key(w, d.querySelector(`${R} .menu-back`), 'Enter'); assert.equal(focused(d), 'anthropic', 'the back row returns');
  key(w, d.activeElement, 'Enter'); assert.equal(focused(d), 'cp-engine|opus');
  key(w, d.activeElement, 'Escape');
  assert.equal(focused(d), 'anthropic', 'Esc leaves the sub-menu for its opener');
  assert.ok(d.querySelector(`${R} .spick .menu`), 'the picker is still open');
  key(w, d.activeElement, 'Enter'); key(w, d.activeElement, 'ArrowDown'); assert.equal(focused(d), 'cp-engine|sonnet');
  key(w, d.activeElement, 'Enter'); await settle(10);
  assert.equal(d.querySelector(`${R} .spick .menu`), null, 'the pick closes the menu');
  assert.equal(chip(d).textContent.trim(), 'Sonnet 5.5');
  assert.equal(calls.filter((c) => c.url.endsWith('/messages')).length, 0, 'Enter on a model sends nothing');
  chip(d).click(); await settle(5);
  key(w, anthropic(), 'Escape'); await settle(5);
  assert.equal(d.querySelector(`${R} .spick .menu`), null, 'no sub-menu open: Esc closes the picker');
});

test('a picked Copilot model names its engine on the chip', async () => {
  const { w, d } = await liveHost({ lists: MODELS });
  await go(w, '#chat');
  chip(d).click(); await settle(5);
  d.querySelector(`${R} [data-menu-sub="anthropic"]`).click(); await settle(5);
  const item = d.querySelector(`${R} [data-menu-pick="cp-engine|copilot/claude-sonnet-5.5"]`);
  assert.equal(item.textContent.trim(), 'Sonnet 5.5 · Copilot');
  item.click(); await settle(10);
  assert.equal(chip(d).textContent.trim(), 'Sonnet 5.5 · Copilot', 'the chip says what the item said');
});

test('reopening starts at the makers', async () => {
  const { w, d } = await liveHost({ lists: MODELS });
  await go(w, '#chat');
  chip(d).click(); await settle(5);
  d.querySelector(`${R} [data-menu-sub="openai"]`).click(); await settle(5);
  assert.equal(d.querySelector(`${R} .menu[data-sub-of]`).dataset.subOf, 'openai');
  chip(d).click(); await settle(5); chip(d).click(); await settle(5);
  assert.equal(d.querySelector(`${R} .menu[data-sub-of]`), null, 'closed and reopened');
  assert.deepEqual(openers(d), ['Anthropic', 'OpenAI', 'Google']);
  d.querySelector(`${R} [data-menu-sub="google"]`).click(); await settle(5);
  d.querySelector(`${R} [data-menu="cp-project"]`).click(); await settle(5);
  assert.equal(d.querySelector(`${R} .menu[data-sub-of]`), null, 'another picker opened');
  chip(d).click(); await settle(5);
  assert.equal(d.querySelector(`${R} .menu[data-sub-of]`), null);
});

test('a pick in a chat posts one PATCH and no message', async () => {
  const { w, d, calls } = await liveHost({ lists: MODELS, write: () => [200, {}] });
  await go(w, '#chat/ask_1');
  calls.length = 0;
  chip(d).click(); await settle(5);
  key(w, d.querySelector(`${R} [data-menu-sub="anthropic"]`), 'Enter');
  const sonnet = d.querySelector(`${R} [data-menu-pick="cp-engine|sonnet"]`); sonnet.focus();
  key(w, sonnet, 'Enter'); await settle(40);
  const p = posts(calls);
  assert.equal(p.filter(([m]) => m === 'PATCH').length, 1, JSON.stringify(p));
  assert.deepEqual(p[0].slice(0, 2), ['PATCH', '/api/ask/threads/ask_1']);
  assert.equal(p[0][2].model, 'sonnet');
  assert.equal(calls.filter((c) => c.url.endsWith('/messages')).length, 0);
});

test('the New task composer shows the same makers', async () => {
  const { w, d } = await liveHost({ lists: MODELS });
  await go(w, '#chat');
  chip(d).click(); await settle(5);
  const chat = openers(d);
  chip(d).click(); await settle(5);
  d.querySelector(`${R} [data-starter="task"]`).click(); await settle(10);
  chip(d).click(); await settle(5);
  assert.deepEqual(openers(d), chat);
  assert.deepEqual(chat, ['Anthropic', 'OpenAI', 'Google']);
});
