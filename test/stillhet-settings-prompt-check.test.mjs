// test/stillhet-settings-prompt-check.test.mjs — Stillhet Settings › Chat › Assistant › Abilities › Prompt check
// (ui/public/stillhet/settings/settings-model.js, settings.js): a library switch row right after "Suggestions", off by
// default. In the live kind it shows and saves the chat pref `promptCheck` (POST /api/settings {chat: {promptCheck}}); in
// the demo kind it toggles locally. Each window is closed when its test ends (closeHosts).
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { liveHost, settle, clone, SOURCES, closeHosts } from './helpers/stillhet-live-counts-host.mjs';
import { stillhetHost } from './helpers/stillhet-host.mjs';

afterEach(closeHosts);
const demoClosers = [];
afterEach(() => { while (demoClosers.length) demoClosers.pop()(); });

const KEY = '[data-svsw="promptCheck"]';
const toastText = (w) => w.RailHost.toastEl.textContent;   // the app host's toast (RailAdapter.toast)
const withChat = (chat) => ({ ...clone(SOURCES), settings: { ...clone(SOURCES.settings || {}), chat } });
async function openAbilities(w) {
  w.location.hash = '#settings/ask';
  await settle(80);
  const more = w.document.querySelector('[data-svdo="more:ask/Assistant/Abilities"]');
  if (more && !w.document.querySelector(KEY)) { more.click(); await settle(40); }
  return w.document.querySelector(KEY);
}
async function live(opts = {}) {
  const h = await liveHost({ hash: '#chat', ...opts });
  await h.hello();
  return h;
}
const nameOf = (sw) => sw.closest('.set-row, .list-row, [class*="row"]');

test('the row sits right after "Suggest a next prompt after each reply", reads "Check how clear a task prompt is", and is off', async () => {
  const { w } = await live({ sources: withChat({}) });
  const sw = await openAbilities(w);
  assert.ok(sw, 'the switch is drawn');
  assert.equal(sw.getAttribute('aria-checked'), 'false');
  const rows = [...w.document.querySelectorAll('#route-settings .set-row')];
  const names = rows.map((r) => r.querySelector('.set-name').textContent.trim());
  assert.equal(names[names.indexOf('Suggestions') + 1], 'Prompt check', 'Suggestions is directly followed by Prompt check');
  const sugg = rows[names.indexOf('Suggestions')];
  assert.equal(sugg.querySelector('.set-text').textContent, 'Not in Stillhet yet: turn Stillhet off from the top-bar switch to use it');
  assert.equal(sugg.querySelector('[data-svsw]'), null, 'live Suggestions has no switch');
  assert.match(nameOf(sw).textContent, /Check how clear a task prompt is/);
  assert.match(nameOf(sw).textContent, /Prompt check/);
});

test('it is the library switch: role switch, with an accessible name and its tooltip', async () => {
  const { w } = await live();
  const sw = await openAbilities(w);
  assert.doesNotMatch(sw.getAttribute('title') || '', /today's Chat/, 'Stillhet\'s composer shows the chip itself');
  assert.equal(sw.getAttribute('role'), 'switch');
  assert.ok(sw.classList.contains('switch'));
  assert.equal(sw.getAttribute('aria-label'), 'Prompt check');
});

test('demo: a toggle changes sv.promptCheck and sends 0 requests; the Abilities summary names it only when on', async () => {
  const calls = [];
  const w = stillhetHost({ hash: '#chat', after: (fn) => demoClosers.push(fn), fetch: async (u, o = {}) => { calls.push(`${o.method || 'GET'} ${u}`); return { ok: false, json: async () => ({}) }; } });
  await settle(200);
  assert.equal(w.RailWorld.live, false);
  const n = calls.length;
  const sv = w.SettingsView.fresh();
  assert.equal(sv.promptCheck, false);
  const abilities = w.SettingsView.rowsOf().find((r) => r.name === 'Abilities');
  assert.doesNotMatch(abilities.say(sv), /checks how clear a task is/);
  assert.equal(w.SettingsView.toggle(sv, 'promptCheck'), 'Prompt check: on');
  assert.equal(sv.promptCheck, true);
  assert.match(abilities.say(sv), /checks how clear a task is/);
  await settle(30);
  assert.deepEqual(calls.slice(n), []);
});

test('other Abilities switches (no sw.live) are not drawn on live, and opening Abilities sends 0 requests', async () => {
  const h = await live();
  const n = h.posts.length;
  assert.ok(await openAbilities(h.w), 'Prompt check is drawn');
  for (const k of ['scripts', 'summaries', 'nextPrompt']) assert.equal(h.d.querySelector(`[data-svsw="${k}"]`), null, `no ${k} switch: a sample row reads the not-live sentence (set.not-live)`);
  assert.equal(h.posts.length, n);
});

test('live: the switch seeds from GET /api/settings chat.promptCheck (true and false)', async () => {
  for (const on of [true, false]) {
    const h = await live({ sources: withChat({ promptCheck: on }) });
    const sw = await openAbilities(h.w);
    assert.equal(sw.getAttribute('aria-checked'), String(on), `promptCheck ${on}`);
  }
});

test('live: GET /api/settings without chat.promptCheck seeds it off', async () => {
  const h = await live({ sources: withChat({}) });
  const sw = await openAbilities(h.w);
  assert.equal(sw.getAttribute('aria-checked'), 'false');
});

test('live: a toggle sends 1 POST /api/settings {chat: {promptCheck: true}} and the switch is on', async () => {
  const sources = withChat({ promptCheck: false });
  const h = await live({ sources, post: (url, body) => { sources.settings.chat = { ...sources.settings.chat, ...body.chat }; return [200, { chat: sources.settings.chat }]; } });
  await openAbilities(h.w);
  const n = h.posts.length;
  h.d.querySelector(KEY).click();
  await settle(400);
  assert.deepEqual(h.posts.slice(n).map((p) => [p.url, p.body]), [['/api/settings', { chat: { promptCheck: true } }]]);
  assert.equal(h.d.querySelector(KEY).getAttribute('aria-checked'), 'true');
  assert.equal(toastText(h.w), 'Prompt check: on');
});

test('live: a refused POST reverts the switch and says so', async () => {
  const h = await live({ sources: withChat({ promptCheck: false }), post: () => [400, { error: 'not now' }] });
  await openAbilities(h.w);
  h.d.querySelector(KEY).click();
  await settle(400);
  assert.equal(h.d.querySelector(KEY).getAttribute('aria-checked'), 'false');
  assert.equal(toastText(h.w), 'Could not change Prompt check: not now');
});

test('live: a settings-changed frame re-seeds it', async () => {
  const sources = withChat({ promptCheck: false });
  const h = await live({ sources });
  await openAbilities(h.w);
  sources.settings.chat.promptCheck = true;
  h.sockets.at(-1).onmessage({ data: JSON.stringify({ type: 'settings-changed' }) });
  await settle(400);                                   // the adapter's refetch is debounced 250 ms
  assert.equal(h.d.querySelector(KEY).getAttribute('aria-checked'), 'true');
});

test('the switch is reachable by Tab (a native button, not disabled) and toggles with Space (its click)', async () => {
  const sources = withChat({ promptCheck: false });
  const { w } = await live({ sources, post: (url, body) => { sources.settings.chat = { ...body.chat }; return [200, {}]; } });
  const sw = await openAbilities(w);
  assert.equal(sw.tagName, 'BUTTON');
  assert.equal(sw.disabled, false);
  assert.notEqual(sw.getAttribute('tabindex'), '-1');
  sw.focus();
  assert.equal(w.document.activeElement, sw);
  sw.click();                                       // Space on a native button is its click
  await settle(400);
  assert.equal(w.document.querySelector(KEY).getAttribute('aria-checked'), 'true');
});
