// test/stillhet-tasks-list-host-4.test.mjs — B4.4a review: View PR on a run that is gone while its ⋯ is open says so, live and
// demo, and the PR tab opens with no opener (F-3-15). Its own file: host-3 runs near the jsdom heap limit.
// Demo (stillhetHost) and live (liveHost) app hosts, jsdom.
import { test, afterEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { liveHost, go, settle, closeHosts, clone, SOURCES } from './helpers/stillhet-chat-live-host.mjs';
import { stillhetHost } from './helpers/stillhet-host.mjs';

afterEach(closeHosts);
const sources = () => { const s = clone(SOURCES); for (const p of s.history.pipelines) p.projectKey = 'web-1'; return s; };
const openMenu = async (d, key) => { d.querySelector(`[data-menu="row:${key}"]`).click(); await settle(30); };
const pick = async (d, key, id) => { d.querySelector(`[data-menu-pick="row:${key}|${id}"]`).click(); await settle(60); };
const toastText = (d) => d.querySelector('.rc-toast.is-on')?.textContent || '';
// the phrases a page hands RailWould (the app host answers every one with its one refusal; the prototype host with the demo sentence)
const would = (w) => { const said = [], was = w.RailWould; w.RailWould = (p) => { said.push(p); return was(p); }; return said; };
const stubOpen =(w, answer = {}) => { const opened = []; w.open = (u, t) => { opened.push([u, t]); return answer; }; return opened; };
// every folded date section and every "N more" open, so a row of any day can be read
async function openAll(d) { for (let i = 0; i < 30; i++) { const b = d.querySelector('#runs-root [data-fold-section][aria-expanded="false"], #runs-root [data-more]'); if (!b) return; b.click(); await settle(20); } }
// the demo's every case holds r7 with its PR and the Billing export stack (shell/world.js CASES.every)
async function demo() { const w = stillhetHost({ hash: '#runs', after }); await settle(200); w.RailWorld.set('every'); await settle(100); await openAll(w.document); return w; }
async function prLive({ url = '', by = '' } = {}) {
  const { PR_URL } = await import('./helpers/stillhet-live-fixture.mjs');
  const s = sources(), h2 = s.history.pipelines.find((p) => p.id === 'h2');
  h2.pr = { url: url || PR_URL, state: 'OPEN' };
  if (by) h2.startedBy = by;
  const h = await liveHost({ sources: s });
  await go(h.w, '#runs', 900);
  await openAll(h.d);
  return { ...h, PR_URL };
}

test('F-3-15 live: View PR on a run that is gone says so and opens nothing; the tab it opens has no opener', async () => {
  const { w, d, PR_URL } = await prLive();
  const tab = { opener: w }, opened = stubOpen(w, tab);
  await openMenu(d, 'run:h2');
  await pick(d, 'run:h2', 'view-pr:h2');
  assert.deepEqual(opened, [[PR_URL, '_blank']]);
  assert.equal(tab.opener, null, 'noopener by hand');
  await openMenu(d, 'run:h2');
  const runs = w.RailWorld.data().runs; runs.splice(runs.findIndex((r) => r.id === 'h2'), 1);   // the run goes while its menu is open
  await pick(d, 'run:h2', 'view-pr:h2');
  assert.equal(opened.length, 1, 'nothing more opened');
  assert.match(toastText(d), /That task is gone/);
});

test('F-3-15 demo: View PR on a run that is gone says so and does not throw', async () => {
  const w = await demo(), d = w.document;
  const errors = []; w.addEventListener('error', (e) => errors.push(e.message));
  await openMenu(d, 'run:r7');
  const runs = w.RailWorld.data().runs; runs.splice(runs.findIndex((r) => r.id === 'r7'), 1);
  const said = would(w);
  await pick(d, 'run:r7', 'view-pr:r7');
  assert.deepEqual(said, []);
  assert.deepEqual(errors, []);
  assert.match(toastText(d), /That task is gone/);
});
