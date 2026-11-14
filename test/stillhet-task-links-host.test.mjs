// test/stillhet-task-links-host.test.mjs — R-qa-1, R-qa-2 (#1266): every live way into a task that no chat started lands on
// its own page (#run/ and its id), never on a prototype case (#run/finished-nogit) or a bare state id; a live open with no id
// lands on Tasks with a polite toast. One hashchange listener per window records every hash it ever showed.
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { liveHost, go, settle, closeHosts, savedRun, menuPick, saidText } from './helpers/stillhet-chat-live-host.mjs';

afterEach(closeHosts);
const STATE_IDS = ['paused-you', 'paused-restart', 'paused-limit'];
// pa ended with no branch (case finished-nogit); ask_1 only follows it, so no chat started it
function sources(row = { status: 'done' }) {
  const s = savedRun(row);
  s.runLinks.links = s.runLinks.links.map((l) => (l.pipelineId === 'pa' ? { ...l, started: false } : l));
  return s;
}
async function host(row, hash = '#chat') {
  const h = await liveHost({ sources: sources(row), hash });
  const seen = [];
  h.w.addEventListener('hashchange', () => seen.push(h.w.location.hash));
  await settle(200);
  const cases = new Set([...h.w.RunCardModel.cases.map((c) => c.id), ...STATE_IDS]);
  h.noCase = () => { const bad = seen.filter((x) => x.startsWith('#run/') && cases.has(x.slice(5))); assert.deepEqual(bad, [], `no live hash names a case: ${seen.join(' ')}`); };
  return h;
}
const press = async (w, d, html, where = '#route-chat') => { const b = d.createElement('div'); b.innerHTML = html; d.querySelector(where).append(b); b.firstElementChild.click(); await settle(80); };

test('card ⋯ › Open its page opens #run/pa', async () => {
  const { w, d, noCase } = await host();
  await go(w, '#chat/ask_1', 200);
  await menuPick(d, 'card:pa', 'open');
  assert.equal(w.location.hash, '#run/pa');
  noCase();
});

test('Show the log on a failed task\'s card opens #run/pa', async () => {
  const { w, d, noCase } = await host({ status: 'error' });
  await go(w, '#chat/ask_1', 200);
  await menuPick(d, 'card:pa', 'Show the log');
  assert.equal(w.location.hash, '#run/pa');
  noCase();
});

test('a card fact page| opens #run/pa', async () => {
  const { w, d, noCase } = await host();
  await go(w, '#chat/ask_1', 200);
  await press(w, d, '<button data-fact="page|pa">3 files</button>');
  assert.equal(w.location.hash, '#run/pa');
  noCase();
});

test('the Tasks list row opens #run/pa', async () => {
  const { w, d, noCase } = await host();
  await go(w, '#runs', 200);
  d.querySelector('.list-row[data-row="run:pa"] [data-open="run:pa"]').click(); await settle(80);
  assert.equal(w.location.hash, '#run/pa');
  noCase();
});

test('a Pulse row opens its task by its id', async () => {
  const { w, d, noCase } = await host();
  w.RailPulse.open('updates'); await settle(50);
  d.querySelector('.pz-popover [data-open="oh3"]').click(); await settle(80);
  assert.equal(w.location.hash, '#run/h3');
  noCase();
});

test('Pulse search opens #run/pa', async () => {
  const { w, d, noCase } = await host();
  const box = d.querySelector('[data-search]');
  box.value = 'Ask me'; box.dispatchEvent(new w.Event('input', { bubbles: true })); await settle(30);
  const pick = [...d.querySelectorAll('[data-menu-pick^="srch|"]')].find((x) => /Ask me/.test(x.textContent));
  assert.ok(pick, 'search finds the task');
  pick.click(); await settle(80);
  assert.equal(w.location.hash, '#run/pa');
  noCase();
});

test('a center\'s Open opens #run/pa', async () => {
  const { w, d, noCase } = await host();
  await go(w, '#projects', 200);
  await press(w, d, '<button data-c-act="open|pa">Open</button>', '#route-place');
  assert.equal(w.location.hash, '#run/pa');
  noCase();
});

test('the top bar\'s in-view tab opens #run/pa', async () => {
  const { w, d, noCase } = await host();
  await go(w, '#runs', 200);
  [...d.querySelectorAll('[data-menu^="row:"]')].find((b) => b.dataset.menu === 'row:run:pa').click(); await settle(30);
  d.querySelector('[data-menu-pick="row:run:pa|in-view"]').click(); await settle(30);
  await go(w, '#chat', 100);
  d.querySelector('[data-in-view="task:run:pa"]').click(); await settle(80);
  assert.equal(w.location.hash, '#run/pa');
  noCase();
});

test('a chat mention (a ref Worca named) opens #run/pa', async () => {
  const { w, d, noCase } = await host();
  await go(w, '#chat/ask_1', 200);
  await press(w, d, '<button data-ref-run="pa">Ask me</button>');
  assert.equal(w.location.hash, '#run/pa');
  noCase();
});

test('the card\'s title is no link: a click on it writes no #run/ hash', async () => {
  const { w, d, noCase } = await host();
  await go(w, '#chat/ask_1', 200);
  const head = d.querySelector('#route-chat [data-anchor="card_run"] .rc-head');
  assert.equal(head.querySelectorAll('a, [data-open-task-page], [data-open-slice]').length, 0, 'the head holds no link');
  head.querySelector('.rc-title, [data-title], h3, b')?.click(); await settle(60);
  assert.equal(w.location.hash, '#chat/ask_1');
  noCase();
});

test('a live open with no task id lands on Tasks with "This task has no page to open"', async () => {
  const { w, d, noCase } = await host();
  w.RailShell.openTaskPage('finished-nogit', '', 'Ask me'); await settle(80);
  assert.equal(w.location.hash, '#runs');
  assert.match(saidText(d), /This task has no page to open/);
  assert.equal(d.querySelector('body > .rc-toast').getAttribute('aria-live'), 'polite');
  w.RailShell.openRun('run/group:g1', 'Release', 'run-b'); await settle(80);   // a Tasks group row: its member's id finds no chat
  assert.equal(w.location.hash, '#run/group:g1', 'a live group opens its own page, not its first member');
  noCase();
});
