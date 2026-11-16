// test/stillhet-settings-labs-live.test.mjs — Stillhet Settings › Labs writes the real flags (S12.1 · F-7b-01, F-7b-06):
// the switches. Live: a switch PATCHes /api/flags and shows the server's answer (Saving while it waits, the refusal at the
// end of its sentence, Locked by WORCA_FLAGS when the server locked it); the rows are exactly GET /api/flags'; `rail`
// leaves through RailHost.setStillhet; answers out of order or without their list. Reset all, set.flags and the
// prototype: test/stillhet-settings-labs-reset.test.mjs. The fake server: test/helpers/stillhet-labs-live.mjs.
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { settle, closeHosts } from './helpers/stillhet-live-counts-host.mjs';
import { FIXTURE, server, live, secOf, rowOf, switchOf, textOf, patches, click, toastText, held, page } from './helpers/stillhet-labs-live.mjs';

afterEach(closeHosts);

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


test('T15 F-7b-01: two writes answered without their list each get their toast after the re-read', async () => {
  const srv = server({ patch: (b) => { srv.apply(b); return [200, {}]; } });
  const { w, d } = await live(srv);
  click(w, switchOf(d, 'Run labels'));
  click(w, switchOf(d, 'Design pass'));
  await settle(200);
  assert.equal(switchOf(d, 'Run labels').getAttribute('aria-checked'), 'true');
  assert.equal(switchOf(d, 'Design pass').getAttribute('aria-checked'), 'true');
  const said = toastText(d);
  assert.ok(said.includes('Run labels: on'), said);
  assert.ok(said.includes('Design pass: on'), said);
});

test('T16 F-7b-01: an older PATCH answer that arrives last does not undo a newer one (per flag)', async () => {
  const gate = held();
  const srv = server({ patch: (b) => {
    if (!('runLabels' in b)) return null;   // Design pass answers at once with the table
    srv.apply(b); const then = JSON.parse(JSON.stringify(srv.flags));   // Run labels is written now, its answer (Design pass still off) comes late
    return gate.p.then(() => [200, { flags: then }]);
  } });
  const { w, d } = await live(srv);
  click(w, switchOf(d, 'Run labels')); await settle(30);
  click(w, switchOf(d, 'Design pass')); await settle(120);
  assert.equal(switchOf(d, 'Design pass').getAttribute('aria-checked'), 'true');
  assert.equal(w.RailUI.prefs.flag('design'), true);
  gate.open(); await settle(20);
  assert.equal(switchOf(d, 'Design pass').getAttribute('aria-checked'), 'true', 'the late answer leaves Design pass as the newer one drew it');
  assert.equal(switchOf(d, 'Run labels').getAttribute('aria-checked'), 'true', 'it still takes its own flag');
  await settle(120);
  assert.equal(w.RailUI.prefs.flag('design'), true, 'what Design pass gates stays on');
  assert.equal(w.RailUI.prefs.flag('runLabels'), true);
});
