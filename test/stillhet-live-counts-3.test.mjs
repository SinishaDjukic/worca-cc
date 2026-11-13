// test/stillhet-live-counts-3.test.mjs — the live kind in the app host, part 3 of 3: every count of the bar, Pulse and the
// bell equals its source and opens what it counts; the store is written only by the adapter; a refused action changes
// nothing and says so; the mode is dev's uiLevel. The host is test/helpers/stillhet-live-counts-host.mjs.
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { BELL, SOURCES, URLS, bellN, liveHost, settle, store, toastText, closeHosts } from './helpers/stillhet-live-counts-host.mjs';

afterEach(closeHosts);   // each test's window closes when the test ends
test('a failed first load: failed in the bar and in Pulse; Try again in Pulse and in the bar list retry and then show the rows', async () => {
  let down = true;
  const { w, d, sockets, hello } = await liveHost({ getStatus: (u) => (down && u === URLS.budget ? 500 : 200) });
  await settle();
  assert.equal(w.RailDemoState.list, 'failed');
  assert.match(d.getElementById('bar-chat').textContent, /Could not load the chats/);
  w.RailPulse.open('now');
  assert.match(d.querySelector('#app .pz-popover').textContent, /Could not load the updates/);
  let retried = 0; const real = w.RailAdapter.retry; w.RailAdapter.retry = () => { retried++; return real(); };
  d.querySelector('#app .pz-popover [data-pulse-retry]').click();
  assert.equal(retried, 1);
  await settle();
  [...d.querySelectorAll('#bar-chat button')].find((b) => b.textContent.trim() === 'Try again').click();
  assert.equal(retried, 2);
  down = false;
  w.RailAdapter.retry(); await settle();
  assert.ok(sockets.length >= 1);
  await hello();
  assert.equal(w.RailDemoState.list, '');
  assert.equal(bellN(d), BELL);
  assert.ok(d.querySelector('#bar-chat [data-open]'), 'the chats show');
});

test('the mode: the stamp wins over localStorage, nothing posted at start; a pick posts uiLevel once; a refusal restores the confirmed level', async () => {
  let answer = [200, { uiLevel: 'advanced' }];
  const { w, d, posts, hello } = await liveHost({ level: 'expert', post: () => answer, before: (win) => win.localStorage.setItem('worca-rail.mode', 'simple') });
  await hello();
  assert.equal(w.RailUI.prefs.mode(), 'expert');
  assert.equal(posts.length, 0);
  const pick = (lvl) => { if (!d.querySelector('#app .acct-menu')) d.querySelector('[data-acct]').click(); if (!d.querySelector('#app [data-level]')) d.querySelector('[data-sub="lvl"]').click(); d.querySelector(`#app [data-level="${lvl}"]`).click(); };
  pick('advanced'); await settle();
  assert.deepEqual(posts.map((p) => [p.url, p.body]), [['/api/settings', { uiLevel: 'advanced' }]]);
  assert.equal(w.RailUI.prefs.mode(), 'advanced');
  assert.equal(toastText(d), 'Interface mode: Advanced');
  answer = [400, { error: 'uiLevel is locked by your team' }];
  pick('simple'); await settle();
  assert.equal(posts.length, 2, 'one post for the refused pick, no second');
  assert.equal(w.RailUI.prefs.mode(), 'advanced');
  assert.equal(toastText(d), 'Could not change the interface mode: uiLevel is locked by your team');
  assert.equal(w.localStorage.getItem('worca-rail.mode'), 'simple', 'the live kind never writes the demo\'s mode');
});

test('the Chats needs number is counts.needs over every thread, not the waiting rows of the first page', async () => {
  const sources = { ...SOURCES, threads: { ...SOURCES.threads, counts: { ...SOURCES.threads.counts, needs: 7 } } };
  const { d, hello } = await liveHost({ sources });
  await hello();
  const label = d.querySelector('[data-mini="chat"]').getAttribute('aria-label');
  assert.match(label, /· 7 need you/);
  assert.match(label, /Chats: 8 open/, 'the 6 waiting chats past the page count as open too');
});

test('opening a failed task the run left unread drops it from the bell, and a pipelines-changed refetch keeps it out', async () => {
  const { w, d, sockets, hello } = await liveHost();
  await hello();
  const frame = async (f) => { sockets.at(-1).onmessage({ data: JSON.stringify(f) }); await settle(); };
  await frame({ type: 'done', runId: 'run-b', seq: 1, status: 'error' });
  assert.equal(bellN(d), BELL + 1, 'failed while watched: it needs you');
  w.RailAdapter.seenRun('run-b'); await settle();
  assert.equal(bellN(d), BELL);
  await frame({ type: 'pipelines-changed' }); await settle(300);
  assert.equal(bellN(d), BELL, 'still out after the runs are read again');
});

test('opening the failed task from the bell\'s own Needs-you row acknowledges it: the bell drops by one', async () => {
  const { w, d, sockets, hello } = await liveHost();
  await hello();
  sockets.at(-1).onmessage({ data: JSON.stringify({ type: 'done', runId: 'run-b', seq: 1, status: 'error' }) }); await settle();
  assert.equal(bellN(d), BELL + 1);
  d.querySelector('[data-pop]').click();
  d.querySelector('#app .pz-popover [data-open="r:run-b"]').click(); await settle();
  assert.match(w.location.hash, /^#run\//, 'the row opens its task');
  assert.equal(bellN(d), BELL, 'opened from Pulse, it no longer needs you');
});

test('the Tasks center in the live kind: a card\'s step writes nothing to the store, and Open acknowledges through the adapter', async () => {
  const { w, d, sockets, hello } = await liveHost({ hash: '#runs' });
  await hello();
  sockets.at(-1).onmessage({ data: JSON.stringify({ type: 'done', runId: 'run-b', seq: 1, status: 'error' }) }); await settle();
  const steps = [...d.querySelectorAll('[data-c-act]')].filter((b) => !/^(open|answer)\|/.test(b.dataset.cAct));
  assert.ok(steps.length, 'the center draws a card step');
  const was = store(w);
  for (const b of steps) b.click();
  await settle();
  assert.deepEqual(store(w), was, 'no store write outside load and run frames');
  assert.equal(bellN(d), BELL + 1);
  assert.match(toastText(d), new RegExp(`: ${steps.at(-1).textContent.trim()} is not in Stillhet yet`), 'the refused step names itself');
  d.querySelector('[data-c-open="run-b"], [data-c-act="open|run-b"], [data-c-act="answer|run-b"]').click(); await settle();
  assert.equal(bellN(d), BELL, 'Open acknowledges it through the adapter');
});
