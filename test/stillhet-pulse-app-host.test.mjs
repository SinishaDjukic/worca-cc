// test/stillhet-pulse-app-host.test.mjs — pulse.js's clicks in the app host. The app serves <html data-level="…"> (dev's
// interface mode, src/core/index-html.mjs), so a click handler that matches a bare [data-level] with closest() catches every
// click on the page. The profile menu's Settings item must still reach RailShell.go('settings/').
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import * as R from '../ui/public/design-system/components/index.mjs';

const read = (p) => readFileSync(new URL('../ui/public/stillhet/' + p, import.meta.url), 'utf8');
const BODY = '<aside id="side-rail"><nav class="nav"></nav><div id="side-foot"></div></aside><span id="rail-pulse-slot"></span>'
  + '<div id="rail-strip"></div><section id="route-settings" hidden></section><div class="pz-app rail-layer" id="app"></div>';

function appHost() {
  const dom = new JSDOM(`<!doctype html><html data-level="expert"><body>${BODY}${R.toast({})}</body></html>`, { runScripts: 'outside-only', url: 'http://localhost/#chat' });
  const w = dom.window;
  after(() => w.close());   // pulse.js keeps timers on the window
  w.RailUI = { ...R };
  w.RailHost = { name: 'app', stillhetOn: () => true };
  w.scrollTo = () => {};
  w.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
  const went = [];
  // a stub of shell.js's RailShell: only what pulse.js calls while it starts and answers these clicks
  w.RailShell = {
    owns: (who, t) => who === 'pulse' && !!t?.isConnected, go: (h) => went.push(h), closeDrawer: () => {}, connReset: () => {},
    pageContext: () => ({}), needs: () => null, locked: () => false, runActive: () => false, start: () => w.RailPulse.show('runs', '', 'chat'),
  };
  for (const f of ['adapter.js', 'runs/run-page-model.js', 'shell/world.js', 'pulse/pulse-model.js', 'settings/settings-model.js', 'settings/settings.js', 'pulse/pulse.js']) w.eval(read(f));
  return { w, went };
}

test('app host: the profile menu\'s Settings item goes to #settings/ although <html> carries data-level', () => {
  const { w, went } = appHost();
  w.document.querySelector('[data-acct]').click();
  const item = w.document.querySelector('[data-go="settings"]');
  assert.ok(item, 'the profile menu is open');
  item.click();
  assert.deepEqual(went, ['settings/']);
});

test('a repaint keeps a toast another page said (a refused Settings change says Not connected through the adapter)', () => {
  const { w } = appHost();
  w.RailAdapter.toast(w.RailAdapter.NOT_CONNECTED);
  w.RailPulse.open('now');   // Pulse repaints, with no toast of its own
  const t = w.document.querySelector('body > .rc-toast');
  assert.match(t.textContent, /Not connected to Worca yet\./);
  assert.ok(t.classList.contains('is-on'));
});

test('RailPulse.open(tab) shows the popover on that tab (the bell and #activity use it)', () => {
  const { w } = appHost();
  w.RailPulse.open('now');
  const pop = w.document.querySelector('#app .pz-popover');
  assert.ok(pop, 'the popover is open');
  assert.equal(pop.querySelector('[data-ptab="vitals"]').getAttribute('aria-selected'), 'true');
  w.RailPulse.open('updates');
  assert.equal(w.document.querySelector('#app .pz-popover [data-ptab="updates"]').getAttribute('aria-selected'), 'true');
});

test('the account menu closes when the page moves on (a hashchange): it never stays open over the next page', async () => {
  const { w } = appHost();
  w.document.querySelector('[data-acct]').click();
  assert.ok(w.document.querySelector('#app .acct-menu'), 'open');
  w.location.hash = '#runs';
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(w.document.querySelector('#app .acct-menu'), null, 'closed on navigation');
});

test('search: a chat\'s schedule opens its own card (Schedules D15), never the demo\'s s1', async () => {
  const { stillhetHost } = await import('./helpers/stillhet-host.mjs');
  const w = stillhetHost({ hash: '#chat', after }); await new Promise((r) => setTimeout(r, 200));
  const d = w.document, c = w.RailChats.data().chats.find((x) => x.id === 'c1');
  c.tasks = [...(c.tasks || []), { id: 's5', kind: 'schedule', title: 'Zebra digest', time: '14:30', detail: 'Every weekday at 14:30' }];
  const box = d.querySelector('[data-search]');
  box.value = 'zebra'; box.dispatchEvent(new w.Event('input', { bubbles: true }));
  const hit = [...d.querySelectorAll('[data-search-res] [data-menu-pick]')].find((e) => /Zebra digest/.test(e.textContent));
  assert.ok(hit, 'the schedule is found');
  const opened = []; const open = w.RailShell.openTask; w.RailShell.openTask = (...a) => { opened.push(a.slice(0, 2)); return open(...a); };
  hit.click(); await new Promise((r) => setTimeout(r, 60));
  assert.deepEqual(opened, [['s5', 'c1']], 'its own card in its chat');
});

test('with no usage reading, Usage and costs wears an empty ring glyph and the dollar spend, never a percent (small.usage-rings)', () => {
  const { w } = appHost();
  w.PulseModel.rings = () => [];   // no provider reading: the same acctMenu draws demo and live
  w.document.querySelector('[data-acct]').click();
  const row = w.document.querySelector('[data-sub="usage"]');
  const ring = row.querySelector('.pz-mi-ring');
  assert.ok(ring, 'the ring glyph is drawn');
  assert.match(ring.getAttribute('style'), /--p:0;/, 'an empty track, no arc');
  assert.doesNotMatch(row.textContent, /%/);
  assert.match(row.textContent, /\$/);
});

// ---- Settings › Notifications › Pulse icon: how long the icon animates (is-news), driven by window timers ----
const isNews = (w) => w.document.querySelector('#rail-pulse-slot .pz-pulse-b').classList.contains('is-news');
const pickPulseFor = (w, v) => {
  w.RailPulse.show('settings', 'notifications');
  w.document.querySelector('[data-menu="pulseFor"]').click();
  w.document.querySelector(`[data-menu-pick="pulseFor|${v}"]`).click();
};

test('Pulse icon 10s: is-news is on at 9 999 ms and off at 10 000 ms of fake time', async (t) => {
  const { w } = appHost();
  const { useAppTimers } = await import('./helpers/app-timers.mjs');
  const clock = useAppTimers(t);
  pickPulseFor(w, '10s');
  assert.equal(isNews(w), false, 'no news before an event');
  w.RailPulse.newEvent('problem');
  assert.equal(isNews(w), true);
  await clock.advance(9999);
  assert.equal(isNews(w), true, 'still on at 9 999 ms');
  await clock.advance(1);
  assert.equal(isNews(w), false, 'off at 10 000 ms');
  // a second event during the news restarts the one timer
  w.RailPulse.newEvent('problem');
  await clock.advance(5000);
  w.RailPulse.newEvent('problem');
  await clock.advance(9999);
  assert.equal(isNews(w), true, 'on at 14 999 ms');
  await clock.advance(1);
  assert.equal(isNews(w), false, 'off at 15 000 ms');
});

test('Pulse icon 1m: is-news is off after 60 000 ms', async (t) => {
  const { w } = appHost();
  const { useAppTimers } = await import('./helpers/app-timers.mjs');
  const clock = useAppTimers(t);
  pickPulseFor(w, '1m');
  w.RailPulse.newEvent('problem');
  await clock.advance(59999);
  assert.equal(isNews(w), true);
  await clock.advance(1);
  assert.equal(isNews(w), false);
});

test('Pulse icon never: a new event never sets is-news', async (t) => {
  const { w } = appHost();
  const { useAppTimers } = await import('./helpers/app-timers.mjs');
  const clock = useAppTimers(t);
  pickPulseFor(w, 'never');
  w.RailPulse.newEvent('problem');
  assert.equal(isNews(w), false, 'right after the event');
  await clock.advance(60000);
  w.RailPulse.newEvent('problem');
  assert.equal(isNews(w), false, 'after a minute and another event');
});

test('Pulse icon until read: is-news stays after 5 minutes and goes when the new update is marked read', async (t) => {
  const { w } = appHost();
  const { useAppTimers } = await import('./helpers/app-timers.mjs');
  const clock = useAppTimers(t);
  w.RailPulse.newEvent('problem');
  assert.equal(isNews(w), true);
  await clock.advance(150000);
  w.RailPulse.show('settings', 'notifications'); w.RailPulse.show('runs', '', 'chat');   // a repaint with the same count
  assert.equal(isNews(w), true, 'a repaint does not end the news');
  await clock.advance(150000);
  assert.equal(isNews(w), true, 'still on after 5 minutes');
  w.RailPulse.open('updates');
  assert.equal(isNews(w), true, 'opening Pulse alone is not reading');
  w.document.querySelector('.pz-popover [data-menu="more"]').click();
  w.document.querySelector('[data-pick="more|allread"]').click();
  assert.equal(isNews(w), false, 'marked read: the news ends');
});

test('Settings › Notifications › Pulse icon: picking never removes is-news from the running icon without a reload', () => {
  const { w } = appHost();
  w.RailPulse.newEvent('problem');
  assert.equal(isNews(w), true);
  pickPulseFor(w, 'never');
  assert.equal(isNews(w), false);
});

test('Settings › Notifications › Pulse icon: switching until read to 10s ends the news 10 s after the pick', async (t) => {
  const { w } = appHost();
  const { useAppTimers } = await import('./helpers/app-timers.mjs');
  const clock = useAppTimers(t);
  w.RailPulse.newEvent('problem');
  await clock.advance(30000);
  assert.equal(isNews(w), true);
  pickPulseFor(w, '10s');
  await clock.advance(9999);
  assert.equal(isNews(w), true);
  await clock.advance(1);
  assert.equal(isNews(w), false);
});

test('the Pulse icon row reads a whole sentence for each value', () => {
  const { w } = appHost();
  const row = () => [...w.document.querySelectorAll('.set-row')].find((r) => /Pulse icon/.test(r.textContent));
  w.RailPulse.show('settings', 'notifications');
  assert.match(row().textContent, /When something new arrives, Pulse's icon\s*shakes until you read or act on it/);
  assert.equal(row().querySelector('.set-dot'), null, 'no changed dot at the default');
  w.document.querySelector('[data-menu="pulseFor"]').click();
  const words = [...w.document.querySelectorAll('[data-menu-pick^="pulseFor|"]')].map((b) => b.textContent.trim());
  assert.deepEqual(words, ['shakes until you read or act on it', 'shakes for 10 seconds', 'shakes for 1 minute', 'stays still']);
  w.document.querySelector('[data-menu-pick="pulseFor|1m"]').click();
  assert.match(row().textContent, /Pulse's icon\s*shakes for 1 minute/);
  assert.ok(row().querySelector('.set-dot'), 'the changed dot shows off the default');
});

test('rail.css: the Pulse shake loops only on .pz-pulse-b and stops under reduced motion', () => {
  const css = read('css/rail.css');
  assert.match(css, /\.pz-pulse-b\.is-news > svg\{[^}]*animation:tb-shake [^;}]*infinite/);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)\{ \.pz-pulse-b\.is-news > svg\{animation:none;\} \}/);
  assert.doesNotMatch(css, /\.topnav-act\.is-news/);
  assert.match(css, /\.kind-mark\.is-news \.km-ring circle\[style\]\{animation:km-seg/);
});
