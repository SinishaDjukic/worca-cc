// test/stillhet-settings-labs-live.test.mjs — Stillhet Settings › Labs writes the real flags (S12.1 · F-7b-01, F-7b-06).
// Live: a switch PATCHes /api/flags and shows the server's answer (Saving while it waits, the refusal at the end of its
// sentence, Locked by WORCA_FLAGS when the server locked it); the rows are exactly GET /api/flags'; `rail` leaves through
// RailHost.setStillhet; Reset all asks, then PATCHes every changed flag. The demo kind shows the same states (the
// prototype). A small fake server answers GET and PATCH from one table, as ui/routes/feature-flags/flags.mjs does.
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { liveHost, settle, closeHosts } from './helpers/stillhet-live-counts-host.mjs';
import { stillhetHost } from './helpers/stillhet-host.mjs';

afterEach(closeHosts);
const demoClosers = [];
afterEach(() => { while (demoClosers.length) demoClosers.pop()(); });

const F = (key, title, stage, on, o = {}) => ({ key, title, description: `${title} does a thing.`, stage, on, source: 'default', locked: false, requires: [], ...o });
const FIXTURE = () => [F('rail', 'Stillhet', 'experimental', true, { source: 'settings' }), F('design', 'Design pass', 'experimental', false),
  F('runLabels', 'Run labels', 'experimental', false), F('runTelemetry', 'Run telemetry', 'experimental', false),
  F('commandSummaries', 'Command summaries', 'beta', true), F('gitAutomations', 'Git event automations', 'experimental', false, { requires: ['runLabels'] })];

// The server: GET answers its table; PATCH applies `{key: bool|null}` (with requires), or answers `patch(body)` when the test
// gives one ([status, data] or a promise of it; a throw rejects the fetch).
function server({ flags = FIXTURE(), patch } = {}) {
  const s = { flags };
  s.read = (u) => (u === '/api/flags' ? [200, { flags: s.flags }] : null);
  s.post = async (url, body) => {
    if (url !== '/api/flags') return [200, {}];
    if (patch) { const own = await patch(body); if (own) return own; }
    for (const [k, v] of Object.entries(body)) {
      const set = (key, on, src) => { s.flags = s.flags.map((f) => (f.key === key ? { ...f, on, source: src } : f)); };
      if (v === null) { set(k, k === 'commandSummaries', 'default'); continue; }
      set(k, v, 'settings');
      if (v) for (const r of s.flags.find((f) => f.key === k).requires) set(r, true, 'settings');
    }
    return [200, { flags: s.flags }];
  };
  return s;
}
async function live(srv = server(), { hash = '#settings/experimental', railHost } = {}) {
  const h = await liveHost({ read: (u) => srv.read(u), post: (u, b) => srv.post(u, b) });
  const calls = [];
  h.w.RailHost.setStillhet = (on) => { calls.push(on); return Promise.resolve(railHost ? railHost(on) : { ok: true }); };
  await h.hello();
  await go(h.w, hash);
  return { ...h, srv, calls };
}
const page = (d) => d.querySelector('#route-settings');
async function go(w, hash, ms = 120) { w.location.hash = hash; await settle(ms); }
const rowOf = (d, name) => [...page(d).querySelectorAll('.set-row')].find((r) => r.querySelector('.set-name')?.textContent.trim() === name);
const secOf = (d, title) => [...page(d).querySelectorAll('.set-sec')].find((s) => s.querySelector('.set-sec-h')?.textContent.trim() === title);
const switchOf = (d, name) => rowOf(d, name)?.querySelector('[role=switch]');
const textOf = (d, name) => rowOf(d, name).querySelector('.set-text').textContent.trim();
const buttonOf = (s, label) => [...s.querySelectorAll('button')].find((b) => b.textContent.trim() === label);
const patches = (posts) => posts.filter((p) => p.url === '/api/flags').map((p) => p.body);
const click = (w, el) => el.dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
// every toast the page said: the app host's own (RailHost.toastEl) is the last `.rc-toast`, the prototype's the first
const toastText = (d) => [...d.querySelectorAll('body > .rc-toast')].map((x) => x.textContent).filter(Boolean).join(' | ');
const stripText = (d) => d.querySelector('.rc-confirm-t')?.textContent.trim() || '';
const answer = async (w, d, yes) => { click(w, d.querySelector(`[data-confirm="${yes ? 'yes' : 'no'}"]`)); await settle(60); };
const held = () => { let open; const p = new Promise((r) => { open = r; }); return { p, open }; };

test('T1 F-7b-01: a live Labs switch sends one PATCH, shows Saving while it waits, then the server\'s answer', async () => {
  const gate = held();
  const srv = server({ patch: () => gate.p.then(() => null) });
  const { w, d, posts, sockets } = await live(srv);
  click(w, switchOf(d, 'Run labels')); await settle(60);
  assert.deepEqual(patches(posts), [{ runLabels: true }]);
  let sw = switchOf(d, 'Run labels');
  assert.equal(sw.disabled, true);
  assert.equal(sw.getAttribute('aria-busy'), 'true');
  assert.equal(sw.closest('.tip-wrap')?.title, 'Saving');
  assert.equal(sw.getAttribute('aria-checked'), 'false');
  click(w, sw); await settle(30);   // a second click while it saves sends nothing (I3)
  sockets.at(-1).onmessage({ data: JSON.stringify({ type: 'flags', flags: { commandSummaries: false } }) }); await settle(60);   // a frame re-read meanwhile
  assert.equal(switchOf(d, 'Run labels').disabled, true, 'still saving after a re-read');
  assert.equal(patches(posts).length, 1);
  gate.open(); await settle(120);
  sw = switchOf(d, 'Run labels');
  assert.equal(sw.getAttribute('aria-checked'), 'true');
  assert.equal(sw.disabled, false);
  assert.equal(sw.hasAttribute('aria-busy'), false);
  assert.equal(toastText(d), 'Run labels: on');
  assert.equal(w.RailUI.prefs.flag('runLabels'), true);
});

test('T2 F-7b-01: a 200 whose answer still says off leaves the switch off and the toast says off', async () => {
  const srv = server({ patch: () => [200, { flags: srv.flags }] });
  const { w, d } = await live(srv);
  click(w, switchOf(d, 'Run labels')); await settle(120);
  assert.equal(switchOf(d, 'Run labels').getAttribute('aria-checked'), 'false');
  assert.equal(toastText(d), 'Run labels: off');
});

test('T3 F-7b-01: a 409 refusal ends the row\'s sentence; the switch keeps the server value; prefs stay; no success toast', async () => {
  const srv = server({ patch: () => [409, { error: '"runLabels" is locked by WORCA_FLAGS', code: 'locked', key: 'runLabels' }] });
  const { w, d } = await live(srv);
  const was = w.RailUI.prefs.flag('runLabels');
  click(w, switchOf(d, 'Run labels')); await settle(120);
  assert.equal(textOf(d, 'Run labels'), 'Run labels does a thing. Could not turn it on: "runLabels" is locked by WORCA_FLAGS');
  const sw = switchOf(d, 'Run labels');
  assert.equal(sw.disabled, false);
  assert.equal(sw.getAttribute('aria-checked'), 'false');
  assert.equal(w.RailUI.prefs.flag('runLabels'), was);
  assert.equal(toastText(d), '');
});

test('T4 F-7b-01: a write the server never answers says so; the next click clears the line while it saves', async () => {
  let n = 0; const gate = held();
  const srv = server({ patch: () => { n += 1; if (n === 1) throw new Error('offline'); return gate.p.then(() => null); } });
  const { w, d } = await live(srv);
  click(w, switchOf(d, 'Run labels')); await settle(120);
  assert.equal(textOf(d, 'Run labels'), 'Run labels does a thing. Could not turn it on: the server did not answer');
  click(w, switchOf(d, 'Run labels')); await settle(60);
  assert.equal(textOf(d, 'Run labels'), 'Run labels does a thing.', 'its own period comes back with no tail');
  assert.equal(switchOf(d, 'Run labels').disabled, true);
  gate.open(); await settle(120);
  assert.equal(switchOf(d, 'Run labels').getAttribute('aria-checked'), 'true');
});

test('T5 F-7b-01: a locked row is disabled with Locked by WORCA_FLAGS as its reason and in its sentence; a click sends nothing', async () => {
  const srv = server({ flags: FIXTURE().map((f) => (f.key === 'runTelemetry' ? { ...f, locked: true, source: 'env' } : f)) });
  const { w, d, posts } = await live(srv);
  const sw = switchOf(d, 'Run telemetry');
  assert.equal(sw.disabled, true);
  assert.equal(sw.closest('.tip-wrap')?.title, 'Locked by WORCA_FLAGS');
  assert.equal(textOf(d, 'Run telemetry'), 'Run telemetry does a thing. Locked by WORCA_FLAGS');
  click(w, sw); await settle(60);
  assert.equal(w.SettingsView.toggle({}, 'flag:runTelemetry'), '');
  await settle(60);
  assert.deepEqual(patches(posts), []);
});

test('T6 F-7b-06: the rows are exactly the GET titles, Beta then Experimental; no demo FLAGS name', async () => {
  const { w, d } = await live();
  const groups = [...secOf(d, 'Features').querySelectorAll('.set-group')];
  const heads = groups.map((g) => g.querySelector('.list-h')?.textContent.trim());
  assert.deepEqual(heads, ['Beta', 'Experimental']);
  const names = [...secOf(d, 'Features').querySelectorAll('.set-row .set-name')].map((x) => x.textContent.trim()).filter((x) => x !== 'Guide');
  assert.deepEqual(names, ['Command summaries', 'Stillhet', 'Design pass', 'Run labels', 'Run telemetry', 'Git event automations']);
  const text = page(d).textContent;
  for (const f of w.SettingsModel.FLAGS) if (!names.includes(f.name)) assert.ok(!text.includes(f.name), `no demo ${f.name}`);
});

test('T7 F-7b-06: Run telemetry shows no Locked while locked:false, and shows it when locked:true', async () => {
  const srv = server();
  const { d, sockets } = await live(srv);
  assert.ok(!rowOf(d, 'Run telemetry').textContent.includes('Locked'));
  assert.equal(switchOf(d, 'Run telemetry').disabled, false);
  srv.flags = srv.flags.map((f) => (f.key === 'runTelemetry' ? { ...f, locked: true } : f));
  sockets.at(-1).onmessage({ data: JSON.stringify({ type: 'flags', flags: { runTelemetry: true } }) }); await settle(120);
  assert.ok(rowOf(d, 'Run telemetry').textContent.includes('Locked by WORCA_FLAGS'));
});

test('T8 F-7b-06: Stillhet and Design rows show under Experimental; Stillhet off goes through RailHost.setStillhet once, no own PATCH; a failure ends its row', async () => {
  const { w, d, posts, calls } = await live();
  const exp = [...secOf(d, 'Features').querySelectorAll('.set-group')].find((g) => g.textContent.includes('Experimental'));
  assert.ok(exp.textContent.includes('Stillhet') && exp.textContent.includes('Design pass'));
  assert.equal(switchOf(d, 'Stillhet').getAttribute('aria-checked'), 'true');
  assert.equal(switchOf(d, 'Design pass').getAttribute('aria-checked'), 'false');
  click(w, switchOf(d, 'Stillhet')); await settle(120);
  assert.deepEqual(calls, [false]);
  assert.deepEqual(patches(posts), []);
  // a failed setStillhet puts its line on the Stillhet row
  const no = await live(server(), { railHost: () => ({ ok: false, text: 'Could not turn Stillhet off: no disk' }) });
  click(no.w, switchOf(no.d, 'Stillhet')); await settle(120);
  assert.deepEqual(no.calls, [false]);
  assert.equal(textOf(no.d, 'Stillhet'), 'Stillhet does a thing. Could not turn Stillhet off: no disk');
  assert.equal(switchOf(no.d, 'Stillhet').disabled, false);
});

test('T9 set.flags: an ok PATCH (no frame) turns Labels on at once and off again; the requires confirm asks first', async () => {
  const { w, d, posts } = await live();
  click(w, switchOf(d, 'Run labels')); await settle(120);
  assert.ok([...d.querySelectorAll('[data-sset="labels"]')].length > 0, 'the side menu lists Labels');
  await go(w, '#settings/labels');
  assert.ok(!page(d).textContent.includes('Run labels is off'), 'Labels draws');
  await go(w, '#settings/experimental');
  click(w, switchOf(d, 'Run labels')); await settle(120);
  await go(w, '#settings/labels');
  assert.ok(page(d).textContent.includes('Run labels is off'));
  await go(w, '#settings/experimental');
  const before = patches(posts).length;
  click(w, switchOf(d, 'Git event automations')); await settle(60);
  assert.equal(stripText(d), 'Turn on Git event automations? It needs Run labels, which turn on too.');
  await answer(w, d, false);
  assert.equal(patches(posts).length, before, 'No sends nothing');
  click(w, switchOf(d, 'Git event automations')); await settle(60);
  await answer(w, d, true); await settle(120);
  assert.deepEqual(patches(posts).slice(before), [{ gitAutomations: true }]);
  assert.equal(switchOf(d, 'Run labels').getAttribute('aria-checked'), 'true', 'the answer redraws the other rows');
});

test('T10 Reset all: disabled with Nothing to reset when no unlocked row has source settings; a locked one does not count', async () => {
  const srv = server({ flags: FIXTURE().map((f) => (f.key === 'rail' ? { ...f, source: 'default' } : f.key === 'runTelemetry' ? { ...f, locked: true, source: 'settings' } : f)) });
  const { w, d, posts } = await live(srv);
  const b = buttonOf(secOf(d, 'Features'), 'Reset all');
  assert.equal(b.disabled, true);
  assert.equal(b.closest('.tip-wrap')?.title, 'Nothing to reset: every feature is at its default');
  click(w, b); await settle(60);
  assert.deepEqual(patches(posts), []);
});

test('T11 Reset all: asks first; No sends nothing; Yes sends one PATCH of nulls, then toasts', async () => {
  const srv = server({ flags: FIXTURE().map((f) => (f.key === 'rail' ? { ...f, source: 'default' } : f.key === 'runLabels' || f.key === 'design' ? { ...f, on: true, source: 'settings' } : f)) });
  const { w, d, posts, calls } = await live(srv);
  click(w, buttonOf(secOf(d, 'Features'), 'Reset all')); await settle(60);
  assert.equal(stripText(d), 'Turn every Labs feature back to its default?');
  await answer(w, d, false);
  assert.deepEqual(patches(posts), []);
  click(w, buttonOf(secOf(d, 'Features'), 'Reset all')); await settle(60);
  await answer(w, d, true); await settle(120);
  assert.deepEqual(patches(posts), [{ design: null, runLabels: null }]);
  assert.deepEqual(calls, []);
  assert.equal(toastText(d), 'Labs: back to its defaults');
  assert.equal(switchOf(d, 'Run labels').getAttribute('aria-checked'), 'false');
});

test('T11 Reset all: a switch write started while the confirm waits refuses Yes (one PATCH, no reset, Saving kept)', async () => {
  const gate = held();
  const srv = server({ flags: FIXTURE().map((f) => (f.key === 'rail' ? { ...f, source: 'default' } : f.key === 'runLabels' ? { ...f, on: true, source: 'settings' } : f)),
    patch: () => gate.p.then(() => null) });
  const { w, d, posts, calls } = await live(srv);
  click(w, buttonOf(secOf(d, 'Features'), 'Reset all')); await settle(60);
  click(w, switchOf(d, 'Run labels')); await settle(60);
  assert.deepEqual(patches(posts), [{ runLabels: false }]);
  await answer(w, d, true); await settle(60);
  assert.deepEqual(patches(posts), [{ runLabels: false }], 'Yes sends no reset while a write is pending');
  assert.deepEqual(calls, []);
  assert.equal(switchOf(d, 'Run labels').disabled, true, 'the pending write keeps its Saving');
  assert.ok(!toastText(d).includes('Labs: back to its defaults'));
  click(w, switchOf(d, 'Run labels')); await settle(30);
  assert.equal(patches(posts).length, 1, 'no third request (I3)');
  gate.open(); await settle(120);
  assert.equal(switchOf(d, 'Run labels').getAttribute('aria-checked'), 'false');
});

test('T12 Reset all with rail changed: the confirm says Stillhet turns off; Yes PATCHes the others, then setStillhet(false); a refusal or rail alone', async () => {
  const flags = () => FIXTURE().map((f) => (f.key === 'runLabels' ? { ...f, on: true, source: 'settings' } : f));
  const { w, d, posts, calls } = await live(server({ flags: flags() }));
  click(w, buttonOf(secOf(d, 'Features'), 'Reset all')); await settle(60);
  assert.equal(stripText(d), 'Turn every Labs feature back to its default? Stillhet is one of them: it turns off, and Worca opens in its classic look.');
  await answer(w, d, true); await settle(120);
  assert.deepEqual(patches(posts), [{ runLabels: null }]);
  assert.deepEqual(calls, [false]);
  // refused: setStillhet is not called and the toast says why
  const no = await live(server({ flags: flags(), patch: () => [500, { error: 'disk full' }] }));
  click(no.w, buttonOf(secOf(no.d, 'Features'), 'Reset all')); await settle(60);
  await answer(no.w, no.d, true); await settle(120);
  assert.deepEqual(patches(no.posts), [{ runLabels: null }]);
  assert.deepEqual(no.calls, []);
  assert.equal(toastText(no.d), 'Could not reset Labs: disk full');
  // only rail changed: no PATCH, it leaves through setStillhet
  const only = await live();
  click(only.w, buttonOf(secOf(only.d, 'Features'), 'Reset all')); await settle(60);
  await answer(only.w, only.d, true); await settle(120);
  assert.deepEqual(patches(only.posts), []);
  assert.deepEqual(only.calls, [false]);
});

test('T13 prototype: the demo kind shows Saving then refused on Requirements first, Run telemetry locked, Run labels at once; no /api/flags', async () => {
  const gets = [];
  const w = stillhetHost({ hash: '#settings/experimental', fetch: async (u) => { gets.push(String(u)); return { ok: false, json: async () => ({}) }; }, after: (fn) => demoClosers.push(fn) });
  const d = w.document;
  await settle(120);
  const W = w.SettingsModel.LABS_WORDS;
  click(w, d.querySelector('[data-svsw="flag:shapeRequirements"]')); await settle(60);
  let sw = d.querySelector('[data-svsw="flag:shapeRequirements"]');
  assert.equal(sw.disabled, true);
  assert.equal(sw.getAttribute('aria-busy'), 'true');
  assert.equal(sw.title, W.saving);
  await settle(700);
  sw = d.querySelector('[data-svsw="flag:shapeRequirements"]');
  assert.equal(sw.disabled, false);
  assert.equal(sw.getAttribute('aria-checked'), 'false');
  assert.ok(textOf(d, 'Requirements first').endsWith('. Could not turn it on: the settings file is read-only'));
  const tel = d.querySelector('[data-svsw="flag:runTelemetry"]');
  assert.equal(tel.disabled, true);
  assert.ok(textOf(d, 'Run telemetry').endsWith('. Locked by WORCA_FLAGS'));
  click(w, d.querySelector('[data-svsw="flag:runLabels"]')); await settle();
  assert.equal(toastText(d), 'Run labels: on');
  assert.ok(!gets.includes('/api/flags'), 'the demo never reads /api/flags');
});

test('T14 prototype: the gallery holds the Labs: saving, refused, locked example in LABS_WORDS\' words', async () => {
  const html = readFileSync(new URL('../plans/rail/prototype/components.html', import.meta.url), 'utf8');
  const at = html.indexOf("'Labs: saving, refused, locked'");
  assert.ok(at > 0, 'the example is in the gallery');
  const entry = html.slice(at, html.indexOf(']]', at));
  const w = stillhetHost({ hash: '#settings/experimental', after: (fn) => demoClosers.push(fn) });
  const W = w.SettingsModel.LABS_WORDS;
  for (const words of [W.saving, W.locked, W.demoRefusal]) assert.ok(entry.includes(words), words);
  assert.ok(entry.includes('Could not turn it on'));
});
