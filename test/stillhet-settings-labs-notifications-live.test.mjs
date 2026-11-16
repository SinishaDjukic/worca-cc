// test/stillhet-settings-labs-notifications-live.test.mjs — Stillhet Settings › Labs and › Notifications in the live kind
// (ui/public/stillhet/settings/settings-model.js, settings.js, pulse/pulse.js): what is real but not wired yet is disabled,
// shows its value and says the not-live sentence as its reason (docs/rail/settings.md `set.not-live`). Labs lists exactly
// the flags GET /api/flags returns, read-only; Notifications' Badge, Sound, Breathing, Desktop and Updates save nothing.
// The demo kind keeps every switch and picker. Each window is closed when its test ends.
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { liveHost, settle, closeHosts, toastText } from './helpers/stillhet-live-counts-host.mjs';
import { stillhetHost } from './helpers/stillhet-host.mjs';
import { NOT_LIVE_SENTENCE as SENTENCE } from '../ui/public/design-system/components/index.mjs';

afterEach(closeHosts);
const demoClosers = [];
afterEach(() => { while (demoClosers.length) demoClosers.pop()(); });

const FLAG = (key, title, stage, on) => ({ key, title, description: `${title} does a thing`, stage, default: false, on, locked: false, requires: [] });
const FLAGS_FIXTURE = [FLAG('rail', 'Stillhet', 'experimental', true), FLAG('runLabels', 'Run labels', 'experimental', false),
  FLAG('commandSummaries', 'Command summaries', 'beta', true), FLAG('design', 'Design pass', 'experimental', false)];

async function live({ flags = () => [200, { flags: FLAGS_FIXTURE }], hash } = {}) {
  const h = await liveHost({ read: (u) => (u === '/api/flags' ? flags() : null) });
  await h.hello();
  if (hash) await go(h.w, hash);
  return h;
}
const page = (d) => d.querySelector('#route-settings');
async function go(w, hash, ms = 120) { w.location.hash = hash; await settle(ms); }
const rowOf = (d, name) => [...page(d).querySelectorAll('.set-row')].find((r) => r.querySelector('.set-name')?.textContent.trim() === name);
const secOf = (d, title) => [...page(d).querySelectorAll('.set-sec')].find((s) => s.querySelector('.set-sec-h')?.textContent.trim() === title);
const metaOf = (s) => s.querySelector('.set-sec-meta')?.textContent.trim() || '';
const switchOf = (d, name) => rowOf(d, name)?.querySelector('[role=switch]');
const labsNames = (d) => [...secOf(d, 'Features').querySelectorAll('.set-row .set-name')].map((x) => x.textContent.trim()).filter((n) => n !== 'Guide');
const buttonOf = (s, label) => [...s.querySelectorAll('button')].find((b) => b.textContent.trim() === label);
const nonGets = (posts) => posts.map((p) => `${p.method} ${p.url}`);

test('F-7b-01: live Labs lists exactly the flags GET /api/flags returns, rail included, under their stage', async () => {
  const { d, gets } = await live({ hash: '#settings/experimental' });
  assert.ok(gets.includes('/api/flags'));
  assert.deepEqual(labsNames(d).sort(), FLAGS_FIXTURE.map((f) => f.title).sort());
  const heads = [...secOf(d, 'Features').querySelectorAll('.set-grp-h, .set-group-h, h3, h4')].map((x) => x.textContent.trim());
  assert.ok(heads.indexOf('Beta') >= 0 && heads.indexOf('Beta') < heads.indexOf('Experimental'), `Beta, then Experimental: ${heads}`);
  const text = page(d).textContent;
  for (const v of ['Shared session', 'Requirements first', 'Locked by WORCA_FLAGS']) assert.ok(!text.includes(v), `no ${v}`);
  assert.equal(rowOf(d, 'Stillhet').querySelector('.set-text').textContent.trim(), 'Stillhet does a thing');
});

test('F-7b-01: each live Labs switch shows the server\'s state', async () => {
  const { d } = await live({ hash: '#settings/experimental' });
  for (const f of FLAGS_FIXTURE) assert.equal(switchOf(d, f.title).getAttribute('aria-checked'), String(f.on), f.title);
});

test('F-7b-01: a live Labs switch is disabled and gives the not-live sentence; Features\' meta says it', async () => {
  const { d } = await live({ hash: '#settings/experimental' });
  for (const f of FLAGS_FIXTURE) {
    const sw = switchOf(d, f.title);
    assert.equal(sw.disabled, true, f.title);
    assert.equal(sw.closest('.tip-wrap')?.title, SENTENCE, f.title);
    assert.equal(rowOf(d, f.title).querySelectorAll('.set-dot').length, 0, `${f.title}: no ChangedDot`);
  }
  assert.equal(metaOf(secOf(d, 'Features')), SENTENCE);
});

test('F-7b-01: clicking a live Labs switch sends nothing, changes nothing and toasts nothing', async () => {
  const { w, d, posts } = await live({ hash: '#settings/experimental' });
  const was = w.RailUI.prefs.flag('runLabels');
  switchOf(d, 'Run labels').click(); await settle();
  switchOf(d, 'Run labels').dispatchEvent(new w.MouseEvent('click', { bubbles: true })); await settle();
  assert.deepEqual(nonGets(posts), []);
  assert.equal(switchOf(d, 'Run labels').getAttribute('aria-checked'), 'false');
  assert.equal(toastText(d), '');
  assert.equal(w.RailUI.prefs.flag('runLabels'), was);
});

test('F-7b-01: SettingsView.toggle(\'flag:…\') on live returns \'\' and leaves prefs', async () => {
  const { w, posts } = await live({ hash: '#settings/experimental' });
  const was = w.RailUI.prefs.flag('runLabels');
  assert.equal(w.SettingsView.toggle({}, 'flag:runLabels'), '');
  assert.equal(w.RailUI.prefs.flag('runLabels'), was);
  assert.deepEqual(nonGets(posts), []);
});

test('F-7b-01: Reset all is disabled with the sentence on live', async () => {
  const { w, d, posts } = await live({ hash: '#settings/experimental' });
  const b = buttonOf(secOf(d, 'Features'), 'Reset all');
  assert.equal(b.disabled, true);
  assert.equal(b.closest('.tip-wrap')?.title, SENTENCE);
  b.dispatchEvent(new w.MouseEvent('click', { bubbles: true })); await settle();
  assert.deepEqual(nonGets(posts), []);
  assert.equal(toastText(d), '');
});

test('F-7b-01: a flags frame reads /api/flags again and the switch follows', async () => {
  let flags = FLAGS_FIXTURE;
  const { w, d, gets, sockets } = await live({ flags: () => [200, { flags }], hash: '#settings/experimental' });
  assert.equal(switchOf(d, 'Run labels').getAttribute('aria-checked'), 'false');
  flags = FLAGS_FIXTURE.map((f) => (f.key === 'runLabels' ? { ...f, on: true } : f));
  sockets.at(-1).onmessage({ data: JSON.stringify({ type: 'flags', flags: { runLabels: true } }) });
  await settle(120);
  assert.equal(gets.filter((u) => u === '/api/flags').length, 2);
  assert.equal(switchOf(d, 'Run labels').getAttribute('aria-checked'), 'true');
  assert.equal(switchOf(d, 'Run labels').disabled, true);
  void w;
});

test('F-7b-01: a failed /api/flags read says so and draws no switch', async () => {
  const { d } = await live({ flags: () => [500, { error: 'boom' }], hash: '#settings/experimental' });
  const s = secOf(d, 'Features');
  assert.equal(metaOf(s), 'Could not read the features');
  assert.equal(s.querySelectorAll('[role=switch]').length, 0);
  assert.ok(!page(d).textContent.includes(SENTENCE));
});

test('F-7b-02: live Badge, Sound and Breathing show their default value, disabled, with the sentence; Channels\' meta says it', async () => {
  const { d } = await live({ hash: '#settings/notifications' });
  for (const id of ['badge', 'sound', 'attnFor']) assert.equal(page(d).querySelectorAll(`[data-menu="${id}"]`).length, 0, id);
  const want = { Badge: 'counts what needs you', Sound: null, Breathing: 'for 3 seconds' };
  for (const [name, words] of Object.entries(want)) {
    const r = rowOf(d, name), tip = r.querySelector('.set-text .tip-wrap');
    assert.ok(tip, `${name} has the disabled tooltip`);
    assert.equal(tip.title, SENTENCE, name);
    const b = tip.querySelector('b');
    assert.ok(b && b.textContent.trim(), `${name} shows its value in bold`);
    if (words) assert.equal(b.textContent.trim(), words, name);
  }
  assert.equal(metaOf(secOf(d, 'Channels')), SENTENCE);
});

test('F-7b-02: the live Desktop switch is disabled with the sentence and clicking it changes nothing', async () => {
  const { w, d, posts } = await live({ hash: '#settings/notifications' });
  const sw = switchOf(d, 'Desktop');
  assert.equal(sw.disabled, true);
  assert.equal(sw.closest('.tip-wrap')?.title, SENTENCE);
  assert.equal(sw.hasAttribute('data-desk'), false);
  const was = sw.getAttribute('aria-checked');
  sw.dispatchEvent(new w.MouseEvent('click', { bubbles: true })); await settle();
  assert.deepEqual(nonGets(posts), []);
  assert.equal(toastText(d), '');
  assert.equal(switchOf(d, 'Desktop').getAttribute('aria-checked'), was);
});

test('F-7b-02: the live Updates pickers, fold and Reset are disabled; nothing changes or is sent', async () => {
  const { w, d, posts } = await live({ hash: '#settings/notifications' });
  const p = page(d);
  for (const sel of ['[data-menu^="lvl:"]', '[data-menu^="whr:"]', '[data-menu^="ev:"]', '[data-custom]', '[data-reset]']) assert.equal(p.querySelectorAll(sel).length, 0, sel);
  const up = secOf(d, 'Updates');
  assert.ok(up.querySelectorAll('.set-text .tip-wrap[title]').length > 0, 'the groups\' values carry the sentence');
  for (const t of up.querySelectorAll('.set-text .tip-wrap')) assert.equal(t.title, SENTENCE);
  const reset = buttonOf(up, 'Reset to defaults');
  assert.equal(reset.disabled, true);
  assert.equal(reset.closest('.tip-wrap')?.title, SENTENCE);
  const before = rowOf(d, 'Badge').textContent;
  for (const pickId of ['badge|none', 'sound|all', 'attnFor|act']) {   // a stale open menu's item, clicked
    const el = d.createElement('button'); el.dataset.menuPick = pickId; secOf(d, 'Channels').append(el);
    el.click(); await settle();
  }
  for (const attr of ['data-desk', 'data-custom', 'data-backgroup', 'data-reset']) {
    const el = d.createElement('button'); el.setAttribute(attr, attr === 'data-desk' || attr === 'data-reset' ? '' : 'usage'); secOf(d, 'Channels').append(el);
    el.click(); await settle();
  }
  assert.equal(rowOf(d, 'Badge').textContent, before);
  assert.equal(w.RailAttnFor, undefined);
  assert.ok(!d.body.textContent.includes('Reset every group'), 'no reset confirm opened');
  assert.equal(page(d).querySelectorAll('[data-menu^="ev:"]').length, 0, 'no fold opened');
  assert.equal(switchOf(d, 'Desktop').getAttribute('aria-checked'), 'false');
  assert.deepEqual(nonGets(posts), []);
  assert.equal(toastText(d), '');
});

test('F-7b-02: Pulse icon stays wired on live', async () => {
  const { d, posts } = await live({ hash: '#settings/notifications' });
  d.querySelector('[data-menu="pulseFor"]').click(); await settle();
  d.querySelector('[data-menu-pick="pulseFor|10s"]').click(); await settle();
  assert.deepEqual(posts.map((p) => [p.url, p.body]), [['/api/settings', { pulseFor: '10s' }]]);
});

test('prototype keeps its demo: a Labs switch flips and toasts; Badge and Desktop change on screen', async () => {
  const gets = [];
  const w = stillhetHost({ hash: '#settings/experimental', fetch: async (u) => { gets.push(String(u)); return { ok: false, json: async () => ({}) }; }, after: (fn) => demoClosers.push(fn) });
  const d = w.document;
  await settle(120);
  assert.equal(metaOf(secOf(d, 'Features')).startsWith('Labs features may change'), true);
  d.querySelector('[data-svsw="flag:runLabels"]').click(); await settle();
  assert.equal(toastText(d), 'Run labels: on');
  assert.equal(d.querySelector('[data-svsw="flag:runLabels"]').getAttribute('aria-checked'), 'true');
  assert.ok(!gets.includes('/api/flags'), 'the demo never reads /api/flags');

  await go(w, '#settings/notifications');
  assert.equal(metaOf(secOf(d, 'Channels')), '');
  d.querySelector('[data-menu="badge"]').click(); await settle();
  d.querySelector('[data-menu-pick="badge|none"]').click(); await settle();
  assert.match(rowOf(d, 'Badge').textContent, /shows no count/);
  const desk = d.querySelector('[data-desk]');
  const was = desk.getAttribute('aria-checked');
  desk.click(); await settle();
  assert.notEqual(d.querySelector('[data-desk]').getAttribute('aria-checked'), was);
  assert.ok(d.querySelector('[data-custom]') && d.querySelector('[data-menu^="lvl:"], [data-menu^="whr:"]'), 'the demo keeps the Updates pickers and fold');
});

test('F-G-G4-07: live Labs › Guide › Open is disabled with the not-live sentence; it toasts nothing and sends nothing', async () => {
  const { w, d, posts } = await live({ hash: '#settings/experimental' });
  const b = buttonOf(rowOf(d, 'Guide'), 'Open');
  assert.equal(b.disabled, true);
  assert.equal(b.closest('.tip-wrap')?.title, SENTENCE);
  b.dispatchEvent(new w.MouseEvent('click', { bubbles: true })); await settle();
  assert.equal(toastText(d), '');
  assert.deepEqual(nonGets(posts), []);
});
