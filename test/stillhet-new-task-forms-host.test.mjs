// test/stillhet-new-task-forms-host.test.mjs — the New task / New schedule forms survive a repaint (B2.1: F-a4-02, F-gb2-01) and
// keep the focus on first open (F-gb21-01). Split from stillhet-new-task-projects-host to stay under CI's 300 s per file.
import { test, afterEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import { liveHost, go, settle, closeHosts, clone, SOURCES, posts } from './helpers/stillhet-chat-live-host.mjs';
import { stillhetHost } from './helpers/stillhet-host.mjs';

afterEach(closeHosts);
const sent = (calls) => posts(calls).filter(([, u]) => !/^\/api\/ask\//.test(u));
const items = async (d) => {
  d.querySelector('#center-dlg [data-menu="f-project"]').click(); await settle(20);
  const got = [...d.querySelectorAll('#center-dlg [data-menu-pick^="f-project|"]')].map((x) => x.dataset.menuPick.slice('f-project|'.length));
  d.querySelector('#center-dlg [data-menu="f-project"]').click(); await settle(20);
  return got;
};
const shown = (d) => d.querySelector('#center-dlg [data-menu="f-project"]').textContent.trim();
const openTask = async (w) => { w.RailCenters.maker('tasks').newPick('form'); await settle(60); };
const type = (w, d, sel, v) => { const t = d.querySelector(sel); t.value = v; t.dispatchEvent(new w.Event('input', { bubbles: true })); };
const yes = async (d) => { d.querySelector('#center-dlg [data-dialog="yes"]').click(); await settle(100); };
// no live runs; the newest saved task (pa) is in `old`, a project dev no longer lists
const removedNewest = () => { const s = clone(SOURCES); s.hello.runs = []; s.history.pipelines.find((p) => p.id === 'pa').projectName = 'old'; return s; };
const write = (u) => (u === '/api/run' ? [200, { runId: 'r-new' }] : [200, {}]);

// ---- B2.1: the forms survive a repaint (F-a4-02, F-gb2-01) ----
const key = (w, el, k) => el.dispatchEvent(new w.KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true }));
const typedTask = async (w, d) => {
  await openTask(w);
  type(w, d, '#cc-text', 'Add a pager'); d.querySelector('#cc-text').focus();
  return d.querySelector('#center-dlg .viewer-modal');
};

test('New task survives a full #app redraw: text, focus, then Escape still closes (F-a4-02, F-gb2-01)', async () => {
  const { w, d } = await liveHost({ sources: clone(SOURCES) });
  await go(w, '#runs', 120);
  const dlg = await typedTask(w, d);
  w.RailPulse.refresh(); await settle(40);
  assert.ok(dlg.isConnected, 'the same dialog is still on screen');
  assert.equal(d.querySelector('#center-dlg .viewer-modal'), dlg);
  assert.equal(d.querySelector('#cc-text').value, 'Add a pager');
  assert.equal(d.activeElement?.id, 'cc-text', 'the typed field keeps the focus');
  key(w, d.querySelector('#cc-text'), 'Escape'); await settle(20);
  assert.equal(d.querySelector('#center-dlg .viewer-modal'), null, 'Escape closes it');
  assert.equal(d.activeElement, d.querySelector('#bar-head [data-bar-new]'), 'the focus goes back to +');
});

test('a pipelines-changed frame on live data keeps the open form (F-a4-02, F-gb2-01)', async () => {
  const { w, d, sockets } = await liveHost({ sources: clone(SOURCES) });
  await go(w, '#runs', 120);
  const dlg = await typedTask(w, d);
  sockets.at(-1).onmessage({ data: '{"type":"pipelines-changed"}' }); await settle(400);   // the frame's reload waits out the 250 ms debounce
  assert.ok(dlg.isConnected, 'the same dialog is still on screen');
  assert.equal(d.querySelector('#cc-text').value, 'Add a pager');
  assert.equal(d.activeElement?.id, 'cc-text');
});

test('New schedule survives a redraw: the name stays (F-a4-02, F-gb2-01)', async () => {
  const { w, d } = await liveHost({ sources: clone(SOURCES) });
  await go(w, '#runs', 120);
  w.RailCenters.maker('schedules').newPick('form'); await settle(60);
  type(w, d, '#cc-name', 'Nightly pager'); d.querySelector('#cc-name').focus();
  const dlg = d.querySelector('#center-dlg .viewer-modal');
  w.RailPulse.refresh(); await settle(40);
  assert.ok(dlg.isConnected);
  assert.equal(d.querySelector('#cc-name').value, 'Nightly pager');
  assert.equal(d.activeElement?.id, 'cc-name');
});

test('a focused picker inside the form keeps the focus across a redraw (F-a4-02, F-gb2-01)', async () => {
  const { w, d } = await liveHost({ sources: clone(SOURCES) });
  await go(w, '#runs', 120);
  await openTask(w);
  const pick = d.querySelector('#center-dlg [data-menu="f-project"]'); pick.focus();
  w.RailPulse.refresh(); await settle(40);
  assert.equal(d.activeElement, pick, 'the picker keeps the focus');
});

test('+ › New task… right after boot opens at once while live data loads; the host sits outside #app (F-gb2-01, F-a4-02)', async () => {
  let release; const gate = new Promise((r) => { release = r; });
  const hold = (u) => (u === '/api/history' || u.startsWith('/api/run-groups') ? gate : null);
  const { w, d } = await liveHost({ sources: clone(SOURCES), hold });
  const adds = []; const add = w.EventTarget.prototype.addEventListener;
  w.EventTarget.prototype.addEventListener = function (type, ...rest) { if (this.id === 'center-dlg') adds.push(type); return add.call(this, type, ...rest); };
  await go(w, '#runs', 40);
  d.querySelector('#bar-head [data-bar-new]').click(); await settle(10);
  d.querySelector('#bar-head [data-menu-pick="bar-new|form"]').click();
  const dlg = d.querySelector('#center-dlg .viewer-modal');
  assert.ok(dlg, 'the dialog is there at once');
  type(w, d, '#cc-text', 'Add a pager');
  release(); await settle(150);
  assert.ok(d.querySelector('#center-dlg .viewer-modal'), 'still there once the held sources land');   // its own catalog loads may repaint it
  assert.equal(d.querySelector('#cc-text').value, 'Add a pager');
  const host = d.getElementById('center-dlg');
  assert.equal(host.parentElement, d.body, 'a direct child of body');
  assert.equal(d.getElementById('app').contains(host), false, 'not inside #app');
  assert.ok(host.classList.contains('pz-app') && host.classList.contains('rail-page'));
  key(w, d.querySelector('#cc-text'), 'Escape'); await settle(20);
  await openTask(w);
  assert.equal(d.querySelectorAll('#center-dlg').length, 1);
  assert.equal(d.getElementById('center-dlg'), host, 'the same host across close and reopen');
  assert.equal(adds.filter((t) => t === 'click').length, 1, 'its click listener is added once');
});

test('list keys stay off behind an open New task form, and come back after it closes (F-a4-02)', async () => {
  const { w, d } = await liveHost({ sources: clone(SOURCES) });
  await go(w, '#runs', 120);
  const rows = () => [...d.querySelectorAll('#runs-root [data-open]')];
  const first = rows()[0]; first.focus();
  await openTask(w);
  d.activeElement.blur();
  assert.equal(d.activeElement, d.body);
  key(w, d.body, 'ArrowDown'); await settle(20);
  assert.equal(d.activeElement, d.body, 'no row took the focus behind the form');
  assert.ok(d.querySelector('#center-dlg .viewer-modal'), 'the form is still open');
  key(w, d.querySelector('#center-dlg .viewer-modal'), 'Escape'); await settle(20);
  const at = d.activeElement;
  key(w, at, 'ArrowDown'); await settle(20);
  assert.notEqual(d.activeElement, at, 'the list key moves the row once the form is closed');
  assert.ok(d.activeElement.closest('#runs-root'), 'a row has the focus');
});

// the same guard on Schedules and Chats: the list's down key would take a row behind the form, now that the host is outside #app
for (const [hash, root] of [['#schedules', '#bar-schedules'], ['#chat', '#chats-root']]) {
  test(`${hash}: list keys stay off behind an open New schedule form, and come back after it closes (F-a4-02)`, async () => {
    const { w, d } = await liveHost({ sources: clone(SOURCES) });
    await go(w, hash, 120);
    assert.ok(d.querySelector(`${root} [data-open]`), 'the list has rows');
    w.RailCenters.maker('schedules').newPick('form'); await settle(60);
    d.activeElement.blur();
    key(w, d.body, 'ArrowDown'); await settle(20);
    assert.equal(d.activeElement, d.body, 'no row took the focus behind the form');
    key(w, d.querySelector('#center-dlg .viewer-modal'), 'Escape'); await settle(20);
    d.activeElement.blur();
    key(w, d.body, 'ArrowDown'); await settle(20);
    assert.ok(d.activeElement.closest(root), 'a row has the focus once the form is closed');
  });
}

test('a route change closes the open form, as the account menu does; a redraw of the same page keeps it (F-a4-02)', async () => {
  const { w, d } = await liveHost({ sources: clone(SOURCES) });
  await go(w, '#runs', 120);
  const dlg = await typedTask(w, d);
  w.RailPulse.refresh(); await settle(40);
  assert.ok(dlg.isConnected, 'a redraw of the same page keeps it');
  await go(w, '#schedules', 60);
  assert.equal(d.querySelector('#center-dlg .viewer-modal'), null, 'closed on navigation');
  assert.equal(d.getElementById('center-dlg').children.length, 0, 'the host is left empty');
  w.RailCenters.maker('schedules').newPick('form'); await settle(60);
  assert.ok(d.querySelector('#center-dlg #cc-name'), 'New schedule opens on the next page');
  await go(w, '#chat', 60);
  assert.equal(d.querySelector('#center-dlg .viewer-modal'), null, 'New schedule closes on navigation too');
});

test('the empty host takes no clicks and draws nothing: #app\'s fixed, see-through, click-through layer (F-a4-02)', async () => {
  const { w, d } = await liveHost({ sources: clone(SOURCES) });
  await go(w, '#runs', 120);
  await openTask(w);
  key(w, d.querySelector('#center-dlg .viewer-modal'), 'Escape'); await settle(20);
  const host = d.getElementById('center-dlg');
  assert.equal(host.innerHTML, '', 'nothing left in it once closed');
  // the shell's own sheets in boot.js's order (pulse.css, then shell.css); jsdom cascades them but lays nothing out
  const css = ['pulse/pulse.css', 'shell/shell.css'].map((f) => readFileSync(new URL(`../ui/public/stillhet/${f}`, import.meta.url), 'utf8')).join('\n');
  const { window: v } = new JSDOM(`<style>${css}</style><div id="h" class="${host.className}"></div>`);
  const cs = v.getComputedStyle(v.document.getElementById('h'));
  assert.equal(cs.pointerEvents, 'none', 'clicks go through to the page');
  assert.equal(cs.position, 'fixed', 'out of the flow: it moves nothing');
  assert.match(cs.backgroundColor, /^(transparent|rgba\(0, 0, 0, 0\))$/, 'see-through');
  assert.match(cs.borderTopWidth || '0', /^0(px)?$/, 'no border');
  v.close();
});

// ---- F-gb21-01: the first open after load keeps its focus; Esc closes from anywhere ----
// the form's own live loads (branches, the workflows and models catalogs) land after it opened and repaint it
const heldOpen = async () => {
  let gate = null, release = () => {};
  const { w, d, calls } = await liveHost({ sources: clone(SOURCES), hold: () => gate, read: (u) => (u.startsWith('/api/branches') ? [200, { branches: ['main', 'dev'], current: 'main', runs: [] }] : null) });
  await go(w, '#runs', 120);
  gate = new Promise((r) => { release = r; });
  const before = calls.length;
  w.RailCenters.maker('tasks').newPick('form'); await settle(5);
  return { w, d, calls: () => calls.slice(before).map((c) => c.url), release: async () => { gate = null; release(); await settle(150); } };
};

test('the first open: the live loads landing keep the focus, caret and selection in What should it do (F-gb21-01)', async () => {
  const { w, d, calls, release } = await heldOpen();
  assert.ok(calls().length, `the form's own loads are held: ${JSON.stringify(calls())}`);
  const t = d.querySelector('#cc-text');
  assert.equal(d.activeElement, t, 'it opens on the text field');
  type(w, d, '#cc-text', 'Add a pager'); t.setSelectionRange(4, 5);
  await release();
  const now = d.querySelector('#cc-text');
  assert.notEqual(now, t, 'the loads did repaint the form');
  assert.equal(d.activeElement, now, 'the focus is still in the text field');
  assert.deepEqual([now.selectionStart, now.selectionEnd], [4, 5], 'caret and selection kept');
  assert.equal(now.value, 'Add a pager', 'the typed text is in the field');
});

test('text typed straight after the first open lands in the field once the loads land (F-gb21-01)', async () => {
  const { w, d, release } = await heldOpen();
  await release();
  const t = d.activeElement;
  assert.equal(t?.id, 'cc-text', 'typing goes to the text field');
  t.value = 'Fix the login'; t.dispatchEvent(new w.Event('input', { bubbles: true }));
  w.RailPulse.refresh(); await settle(40);
  assert.equal(d.querySelector('#cc-text').value, 'Fix the login');
});

test('Esc with the focus on body closes the open form; once closed, the page has Esc back (F-gb21-01)', async () => {
  const { w, d } = await liveHost({ sources: clone(SOURCES) });
  await go(w, '#runs', 120);
  await openTask(w);
  d.activeElement.blur();
  assert.equal(d.activeElement, d.body);
  key(w, d.body, 'Escape'); await settle(20);
  assert.equal(d.querySelector('#center-dlg .viewer-modal'), null, 'Esc closed it');
  let heard = 0; d.addEventListener('keydown', (e) => { if (e.key === 'Escape') heard++; });
  d.activeElement.blur();
  key(w, d.body, 'Escape'); await settle(20);
  assert.equal(heard, 1, 'with no form open, Esc goes on to the page');
});
