// test/stillhet-settings-labs-reset.test.mjs — Stillhet Settings › Labs (S12.1 · F-7b-01, F-7b-06): what a flag gates
// follows at once (set.flags), Reset all asks and then PATCHes every changed flag (rail through StillhetHost.setStillhet), and
// the demo kind and gallery show the same states (the prototype). The switches: test/stillhet-settings-labs-live.test.mjs.
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { settle, closeHosts } from './helpers/stillhet-live-counts-host.mjs';
import { stillhetHost } from './helpers/stillhet-host.mjs';
import { FIXTURE, server, live, page, go, secOf, switchOf, textOf, buttonOf, patches, click, toastText, stripText, answer, held } from './helpers/stillhet-labs-live.mjs';

afterEach(closeHosts);
const demoClosers = [];
afterEach(() => { while (demoClosers.length) demoClosers.pop()(); });

test('T9 set.flags: an ok PATCH (no frame) turns Labels on at once and off again; the requires confirm asks first', async () => {
  const { w, d, posts } = await live();
  click(w, switchOf(d, 'Run labels')); await settle(120);
  assert.ok([...d.querySelectorAll('[data-sset="labels"]')].length > 0, 'the side menu lists Labels');
  await go(w, '#settings/labels');
  assert.ok(!page(d).textContent.includes('Task labels is off'), 'Labels draws');
  await go(w, '#settings/experimental');
  click(w, switchOf(d, 'Run labels')); await settle(120);
  await go(w, '#settings/labels');
  assert.ok(page(d).textContent.includes('Task labels is off'));
  await go(w, '#settings/experimental');
  const before = patches(posts).length;
  click(w, switchOf(d, 'Git event automations')); await settle(60);
  assert.equal(stripText(d), 'Turn on Git event automations? It needs Run labels, which will be turned on too.');   // F-W3a2-04: classic's words, right for one or several
  await answer(w, d, false);
  assert.equal(patches(posts).length, before, 'No sends nothing');
  click(w, switchOf(d, 'Git event automations')); await settle(60);
  await answer(w, d, true); await settle(120);
  assert.deepEqual(patches(posts).slice(before), [{ gitAutomations: true }]);
  assert.equal(switchOf(d, 'Run labels').getAttribute('aria-checked'), 'true', 'the answer redraws the other rows');
});

test('T10 Reset all: disabled with Nothing to reset when no unlocked row has source settings; a locked one does not count', async () => {
  const srv = server({ flags: FIXTURE().map((f) => (f.key === 'stillhet' ? { ...f, source: 'default' } : f.key === 'runTelemetry' ? { ...f, locked: true, source: 'settings' } : f)) });
  const { w, d, posts } = await live(srv);
  const b = buttonOf(secOf(d, 'Features'), 'Reset all');
  assert.equal(b.disabled, true);
  assert.equal(b.closest('.tip-wrap')?.title, 'Nothing to reset: every feature is at its default');
  click(w, b); await settle(60);
  assert.deepEqual(patches(posts), []);
});

test('T11 Reset all: asks first; No sends nothing; Yes sends one PATCH of nulls, then toasts', async () => {
  const srv = server({ flags: FIXTURE().map((f) => (f.key === 'stillhet' ? { ...f, source: 'default' } : f.key === 'runLabels' || f.key === 'design' ? { ...f, on: true, source: 'settings' } : f)) });
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

test('T11b Reset all: a switch write started while the confirm waits refuses Yes (one PATCH, no reset, Saving kept)', async () => {
  const gate = held();
  const srv = server({ flags: FIXTURE().map((f) => (f.key === 'stillhet' ? { ...f, source: 'default' } : f.key === 'runLabels' ? { ...f, on: true, source: 'settings' } : f)),
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

test('T12 Reset all with stillhet changed: the confirm says Stillhet turns off; Yes PATCHes the others, then setStillhet(false); a refusal or stillhet alone', async () => {
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
  // only stillhet changed: no PATCH, it leaves through setStillhet
  const only = await live();
  click(only.w, buttonOf(secOf(only.d, 'Features'), 'Reset all')); await settle(60);
  await answer(only.w, only.d, true); await settle(120);
  assert.deepEqual(patches(only.posts), []);
  assert.deepEqual(only.calls, [false]);
});

test('T13 prototype: the demo kind shows Saving then refused on Requirements first, Task telemetry locked, Task labels at once; no /api/flags', async () => {
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
  assert.ok(textOf(d, 'Task telemetry').endsWith('. Locked by WORCA_FLAGS'));
  click(w, d.querySelector('[data-svsw="flag:runLabels"]')); await settle();
  assert.equal(toastText(d), 'Task labels: on');
  assert.ok(!gets.includes('/api/flags'), 'the demo never reads /api/flags');
});

test('T14 prototype: the gallery holds the Labs: saving, refused, locked example in LABS_WORDS\' words', async () => {
  const html = readFileSync(new URL('../plans/stillhet/prototype/components.html', import.meta.url), 'utf8');
  const at = html.indexOf("'Labs: saving, refused, locked'");
  assert.ok(at > 0, 'the example is in the gallery');
  const entry = html.slice(at, html.indexOf(']]', at));
  const w = stillhetHost({ hash: '#settings/experimental', after: (fn) => demoClosers.push(fn) });
  const W = w.SettingsModel.LABS_WORDS;
  for (const words of [W.saving, W.locked, W.demoRefusal]) assert.ok(entry.includes(words), words);
  assert.ok(entry.includes('Could not turn it on'));
});
