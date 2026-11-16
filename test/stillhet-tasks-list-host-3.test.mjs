// test/stillhet-tasks-list-host-3.test.mjs — B4.4a: a Tasks row's ⋯ reads View PR #N ↗ (one per member PR on a group) and opens
// the real url on live (F-3-15); a row's tooltip is one fact a line, cost never in the bar (F-3-14, docs/rail/lists.md list.one-end).
// Demo (stillhetHost) and live (liveHost) app hosts, jsdom.
import { test, afterEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { liveHost, go, settle, closeHosts, clone, SOURCES } from './helpers/stillhet-chat-live-host.mjs';
import { stillhetHost } from './helpers/stillhet-host.mjs';

afterEach(closeHosts);
const sources = () => { const s = clone(SOURCES); for (const p of s.history.pipelines) p.projectKey = 'web-1'; return s; };
const openMenu = async (d, key) => { d.querySelector(`[data-menu="row:${key}"]`).click(); await settle(30); };
const items = (d, key) => [...d.querySelectorAll(`[data-menu-pick^="row:${key}|"]`)].map((e) => ({ id: e.dataset.menuPick.slice(`row:${key}|`.length), text: e.textContent }));
const prItems = (d, key) => items(d, key).filter((x) => x.id.startsWith('view-pr:'));
const pick = async (d, key, id) => { d.querySelector(`[data-menu-pick="row:${key}|${id}"]`).click(); await settle(60); };
const toastText = (d) => d.querySelector('.rc-toast.is-on')?.textContent || '';
const tip = (d, key) => d.querySelector(`[data-open="${key}"]`)?.getAttribute('title') || '';
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

test('F-3-15 demo: a run row\'s ⋯ reads View PR #962 ↗ and picking it gives the demo\'s would toast', async () => {
  const w = await demo(), d = w.document;
  await openMenu(d, 'run:r7');
  assert.deepEqual(prItems(d, 'run:r7').map((x) => [x.id, x.text]), [['view-pr:r7', 'View PR #962 ↗']]);
  const said = would(w);
  await pick(d, 'run:r7', 'view-pr:r7');
  assert.deepEqual(said, ['open PR #962 on GitHub (it leaves Worca)'], 'the no-demo baseline\'s phrase, byte for byte');
  assert.equal(toastText(d), w.RailWould(said[0]), 'its toast is the adapter\'s answer');
});

test('F-3-15 demo: the Billing export stack offers View PR #970, #971, #972 ↗ in order; #971 toasts #971', async () => {
  const w = await demo(), d = w.document;
  await openMenu(d, 'group:g-stack');
  assert.deepEqual(prItems(d, 'group:g-stack').map((x) => [x.id, x.text]), [['view-pr:m4', 'View PR #970 ↗'], ['view-pr:m5', 'View PR #971 ↗'], ['view-pr:m6', 'View PR #972 ↗']]);
  const said = would(w);
  await pick(d, 'group:g-stack', 'view-pr:m5');
  assert.deepEqual(said, ['open PR #971 on GitHub (it leaves Worca)']);
});

test('F-3-15 live: a saved row with a PR url reads View PR #959 ↗ (no url) and opens that url in a new tab', async () => {
  const { w, d, PR_URL } = await prLive();
  const opened = stubOpen(w);
  await openMenu(d, 'run:h2');
  assert.deepEqual(prItems(d, 'run:h2').map((x) => x.text), ['View PR #959 ↗']);
  assert.ok(items(d, 'run:h2').every((x) => !/http/.test(x.text)), 'the menu never shows the url');
  await pick(d, 'run:h2', 'view-pr:h2');
  assert.deepEqual(opened, [[PR_URL, '_blank']]);
});

test('F-3-15 live: an active run and a row without a PR have no View PR', async () => {
  const { w, d } = await prLive();
  const active = w.RailWorld.data().runs.find((r) => !r.pr && d.querySelector(`[data-menu="row:run:${r.id}"]`) && /^run-/.test(r.id));
  assert.ok(active, 'an active run is listed');
  await openMenu(d, `run:${active.id}`);
  assert.deepEqual(prItems(d, `run:${active.id}`), []);
  await openMenu(d, `run:${active.id}`);
  await openMenu(d, 'run:h3');
  assert.deepEqual(prItems(d, 'run:h3'), []);
});

test('F-3-15 live: a blocked tab says so; a PR address that is not a web link is refused and opens nothing', async () => {
  let h = await prLive();
  const blocked = stubOpen(h.w, null);
  await openMenu(h.d, 'run:h2'); await pick(h.d, 'run:h2', 'view-pr:h2');
  assert.equal(blocked.length, 1);
  assert.match(toastText(h.d), /Could not open the PR: the browser blocked the new tab/);
  closeHosts();
  h = await prLive({ url: 'javascript:alert(1)' });
  const opened = stubOpen(h.w);
  const before = h.d.querySelectorAll('[data-open]').length;
  await openMenu(h.d, 'run:h2');
  assert.deepEqual(prItems(h.d, 'run:h2').map((x) => x.text), ['View PR ↗'], 'no number: the bare words');
  await pick(h.d, 'run:h2', 'view-pr:h2');
  assert.deepEqual(opened, []);
  assert.match(toastText(h.d), /Could not open the PR: it has no web address/);
  assert.equal(h.d.querySelectorAll('[data-open]').length, before, 'the list is the same after a refusal');
  closeHosts();
  h = await prLive({ url: 'https://git.example.com/acme/web/merge-requests' });
  await openMenu(h.d, 'run:h2');
  assert.deepEqual(prItems(h.d, 'run:h2').map((x) => x.text), ['View PR ↗'], 'a url with no number reads the bare words');
});

test('F-3-15 live: with two rows ticked, View PR opens only its own row\'s PR', async () => {
  const { w, d, PR_URL } = await prLive();
  const opened = stubOpen(w);
  assert.doesNotMatch(d.querySelector('[data-open="run:h2"]').closest('[data-row]')?.innerHTML || '', /https?:/, 'nothing on the row carries the url (D9)');
  await openMenu(d, 'run:h2'); await pick(d, 'run:h2', 'toggle');
  await openMenu(d, 'run:h3'); await pick(d, 'run:h3', 'toggle');
  await openMenu(d, 'run:h2'); await pick(d, 'run:h2', 'view-pr:h2');
  assert.deepEqual(opened, [[PR_URL, '_blank']]);
});

test('F-3-14 demo: r7\'s tooltip is one fact a line: title, state, project, PR #962, time', async () => {
  const w = await demo(), d = w.document, r = w.RailWorld.find('r7');
  const word = w.RailUI.runState(w.RunCardModel.stateOf(r.case)).word, needs = w.RailUI.runState('question').word;
  const lines = tip(d, 'run:r7').split('\n');
  // in Needs you its section already says the word, as before
  assert.deepEqual(lines, [r.title, word === needs ? '' : word, ...(r.detail === word ? [] : [r.detail]), r.project, 'PR #962', r.time].filter(Boolean));
  assert.doesNotMatch(tip(d, 'run:r7'), / · (web-app|PR)/, 'no facts joined on one line');
});

test('F-3-14 demo: the Labels line shows only with runLabels on', async () => {
  const w = await demo(), d = w.document;
  w.RailUI.prefs.setFlag('runLabels', false); await settle(40); await openAll(d);
  assert.doesNotMatch(tip(d, 'run:r7'), /Labels:/);
  w.RailUI.prefs.setFlag('runLabels', true); await settle(40); await openAll(d);
  assert.ok(tip(d, 'run:r7').split('\n').includes('Labels: hotfix'));
});

test('F-3-14 demo: the bar row stays one line: no meta line, the same end', async () => {
  const w = await demo(), d = w.document;
  w.RailUI.prefs.setFlag('runLabels', true); await settle(40); await openAll(d);
  const main = d.querySelector('[data-open="run:r7"]');
  assert.equal(main.querySelector('.lr-m'), null, 'no meta line on the row');
  assert.equal(main.textContent.trim(), 'Retry on 502', 'the row holds its title only');
  assert.doesNotMatch(main.closest('[data-row]').querySelector('.lr-end')?.textContent || '', /PR #962|hotfix|web-app/, 'the facts are in the tooltip, not at its end');
});

test('F-3-14 demo: a group\'s tooltip is one fact a line (kind, project, labels, why); its member\'s carries its PR', async () => {
  const w = await demo(), d = w.document;
  w.RailUI.prefs.setFlag('runLabels', true); await settle(40); await openAll(d);
  const lines = tip(d, 'group:g-stack').split('\n');
  assert.equal(lines[0], 'Billing export stack');
  assert.equal(lines[1], 'Chain');
  assert.equal(lines[2], 'billing-api');
  assert.ok(!lines.some((l) => / · billing-api|Chain · /.test(l)), 'kind and project on their own lines');
  assert.ok(!lines.some((l) => /^PR /.test(l)), 'a group\'s PRs are in its menu and on its members');
  if (!d.querySelector('[data-open="run:m5"]')) { d.querySelector('[data-fold="group:g-stack"]').click(); await settle(40); }
  assert.ok(tip(d, 'run:m5').split('\n').includes('PR #971'));
});

test('F-3-14 live: a saved row\'s tooltip reads PR #959, never the url; Started by shows on a shared sign-in only', async () => {
  const { w, d } = await prLive({ by: 'mara' });
  assert.ok(tip(d, 'run:h2').split('\n').includes('PR #959'));
  assert.doesNotMatch(tip(d, 'run:h2'), /http/);
  assert.doesNotMatch(tip(d, 'run:h2'), /Started by/);
  w.RailWorld.setState({ list: 'shared' }); await settle(80); await openAll(d);   // reaches setCase('shared') through W.onChange
  assert.ok(tip(d, 'run:h2').split('\n').includes('Started by mara'));
});

test('F-3-14: no row or group tooltip shows a cost', async () => {
  const w = await demo(), d = w.document;
  w.RailUI.prefs.setFlag('runLabels', true); await settle(40);
  await openAll(d);
  for (let i = 0; i < 20; i++) { const b = d.querySelector('#runs-root button[data-fold^="group:"][aria-expanded="false"]'); if (!b) break; b.click(); await settle(30); }
  const { runs, groups } = w.RailWorld.data();
  const costOf = new Map([...runs.map((r) => [`run:${r.id}`, r.cost]), ...groups.map((g) => [`group:${g.id}`, g.cost])]);
  const tips = [...d.querySelectorAll('#runs-root [data-open]')].map((e) => [e.dataset.open, e.getAttribute('title') || '']);
  assert.ok(tips.filter(([k]) => costOf.get(k) > 0).length > 5, 'rows with a cost are read');
  // a state's own words may name a cap ("Cost cap · reached $120"); the task's own spend never shows
  const spends = (k, t) => { const c = costOf.get(k); return c > 0 && (t.includes('$' + c.toFixed(2)) || t.split('\n').includes('$' + c)); };
  assert.deepEqual(tips.filter(([k, t]) => /\bCost \$|Cost unknown/.test(t) || spends(k, t)), []);
});
