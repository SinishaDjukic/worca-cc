// test/stillhet-shell-parts-host.test.mjs — B2.7 (docs/rail/components.md `comp.patch-parts`): renderInShell patches
// #app and the shell's slots by part, so a redraw that changes nothing writes nothing (F-a1-02), an open Pulse popover
// keeps its nodes when another layer opens (F-a4-02), and a focused control in it keeps its node (F-a4-10). The live
// Stillhet host on virtual time (test/helpers/stillhet-perf.mjs), so no timer redraws behind the test's back.
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { closeHosts, go } from './helpers/stillhet-chat-live-host.mjs';
import { perfHost } from './helpers/stillhet-perf.mjs';

afterEach(() => closeHosts());
const app = (d) => d.getElementById('app');
const SLOTS = { '#app': '#app', '#rail-pulse-slot': '#rail-pulse-slot', '#side-foot': '#side-foot', '#rail-strip': '#rail-strip', 'nav dots': '#nav-chat-unread, #topnav-ask-dot' };
/** The slot a mutation record belongs to, or 'title' for <title>, or '' for none of the shell's. */
function slotOf(r) {
  const el = r.target.nodeType === 1 ? r.target : r.target.parentElement;
  if (el?.closest?.('title')) return 'title';
  for (const [name, sel] of Object.entries(SLOTS)) if (el?.closest?.(sel)) return name;
  return '';
}
/** The shell's mutation records per slot, around `fn`. */
async function perSlot(h, fn) {
  const recs = [];
  const mo = new h.w.MutationObserver((l) => recs.push(...l));
  mo.observe(h.d.documentElement, { childList: true, characterData: true, attributes: true, subtree: true });
  await fn();
  recs.push(...mo.takeRecords()); mo.disconnect();
  const out = {};
  for (const r of recs) { const s = slotOf(r); if (s) out[s] = (out[s] || 0) + 1; }
  return out;
}
/** The Pulse popover open and drawn a second time, so its opening fade (is-in) is gone. */
async function openPop(h) {
  h.w.RailPulse.open('updates');
  h.w.RailPulse.refresh();
  await h.settleAll();
  const pop = app(h.d).querySelector('.pz-popover');
  assert.ok(pop, 'the popover is open');
  return pop;
}

test('B2.7 probe F-a1-02: a no-change redraw (RailPulse.refresh()) on chat, tasks and projects mutates no shell slot', async () => {
  const h = await perfHost({ hash: '#chat' });
  const seen = {};
  for (const hash of ['#chat', '#runs', '#projects']) {
    await go(h.w, hash); await h.settleAll();
    h.w.RailPulse.refresh(); await h.settleAll();   // whatever the route's first draw left, drawn once more
    seen[hash] = await perSlot(h, async () => { h.w.RailPulse.refresh(); h.w.RailPulse.refresh(); await h.settleAll(); });
  }
  assert.deepEqual(seen, { '#chat': {}, '#runs': {}, '#projects': {} }, `mutation records per slot: ${JSON.stringify(seen)}`);
});

test('B2.7 F-a4-02: with the Pulse popover open, a session dialog adds its part and keeps the popover\'s nodes (same .pz-popover object)', async () => {
  const h = await perfHost({ hash: '#chat' });
  const pop = await openPop(h);
  h.w.RailPulse.session(true); await h.settleAll();
  assert.ok(app(h.d).querySelector('#pz-sess-t'), 'the session dialog is drawn');
  assert.equal(app(h.d).querySelector('.pz-popover'), pop, 'the popover kept its node');
  assert.equal(pop.isConnected, true);
});

test('B2.7 F-a4-02: with the popover open, an idle redraw replaces nothing in #app (same child node objects, no records)', async () => {
  const h = await perfHost({ hash: '#chat' });
  await openPop(h);
  const before = [...app(h.d).childNodes];
  const recs = await perSlot(h, async () => { h.w.RailPulse.refresh(); await h.settleAll(); });
  assert.deepEqual([...app(h.d).childNodes], before);
  assert.equal(recs['#app'] || 0, 0, `#app records: ${recs['#app']}`);
});

test('B2.7 F-a4-10: a focused control in an #app part keeps the same node and focus through a redraw that changes another part', async () => {
  // no #app part draws a text field (popover, new run, account and session hold buttons and menus): the popover's
  // focused tab stands for it, so the node itself, not a refocus by holdFocus, is what is checked
  const h = await perfHost({ hash: '#chat' });
  const pop = await openPop(h);
  const tab = pop.querySelector('[data-ptab]');
  assert.ok(tab, 'the popover has its tabs');
  tab.focus();
  const others = [...pop.querySelectorAll('*')];
  h.w.RailPulse.session(true); await h.settleAll();
  assert.equal(pop.querySelector('[data-ptab]'), tab, 'the same node');
  assert.equal(h.d.activeElement, tab, 'still focused');
  assert.deepEqual([...pop.querySelectorAll('*')], others, 'nothing in the popover was rebuilt');
});

test('B2.7: closing a part removes only its nodes; the order popover → new run → account → session matches today\'s concatenation', async () => {
  const h = await perfHost({ hash: '#chat' });
  // the strings renderInShell hands #app, as they come: today's way is #app.innerHTML = their concatenation
  let drawn = null; const patchParts = h.w.RailUI.patchParts;
  h.w.RailUI.patchParts = (el, parts, o) => { if (el.id === 'app') drawn = { ...parts }; return patchParts(el, parts, o); };
  const pop = await openPop(h);
  h.w.RailPulse.session(true); await h.settleAll();
  const sess = app(h.d).querySelector('#pz-sess-t')?.closest('#app > *');
  const parts = [...app(h.d).children];
  assert.deepEqual(parts.map((e) => e === pop ? 'popover' : e === sess ? 'session' : '?'), ['popover', 'session'], 'popover before session');
  assert.deepEqual(Object.keys(drawn), ['popover', 'new-run', 'account', 'session'], 'the parts in today\'s order');
  // the independent expectation: a fresh element given today's concatenation, in the page for a moment so the shell's
  // words pass (runs read as tasks) reaches it as it reaches #app; #app, patched part by part (the popover kept from an
  // earlier draw), reads the same
  const fresh = h.d.createElement('div'); fresh.innerHTML = Object.values(drawn).join('');
  h.d.body.append(fresh); await h.settleAll();
  const want = fresh.innerHTML; fresh.remove();
  assert.ok(fresh.querySelector('.pz-popover') && fresh.querySelector('#pz-sess-t'), 'the expectation holds both parts');
  assert.equal(app(h.d).innerHTML, want);
  h.w.RailPulse.session(false); await h.settleAll();
  assert.equal(app(h.d).querySelector('#pz-sess-t'), null, 'the session part is gone');
  assert.deepEqual([...app(h.d).children], [pop], 'only the popover is left, the same node');
  // the account menu, then the new-run form, each drawn alone, read as their own strings
  h.d.querySelector('[data-acct]').click(); await h.settleAll();
  assert.ok(app(h.d).querySelector('.acct-menu'), 'the account menu is open');
  assert.equal(app(h.d).querySelector('.pz-popover'), null, 'opening it closed the popover');
});

test('B2.7 F-a1-02: a redraw where the Pulse button changes (the popover opens) replaces #rail-pulse-slot\'s button and leaves #side-foot and #rail-strip nodes identical', async () => {
  const h = await perfHost({ hash: '#chat' });
  h.w.RailPulse.refresh(); await h.settleAll();
  const slot = h.d.getElementById('rail-pulse-slot'), btn = slot.firstElementChild;
  const foot = [...h.d.getElementById('side-foot').childNodes], strip = [...h.d.getElementById('rail-strip').childNodes];
  const was = slot.innerHTML;
  h.w.RailPulse.say('A note');   // a toast: Pulse's words do not change
  h.w.RailPulse.refresh(); await h.settleAll();
  assert.equal(slot.firstElementChild, btn, 'an unchanged button keeps its node');
  h.w.RailPulse.open('updates'); await h.settleAll();   // aria-expanded flips: the button's string changes
  assert.notEqual(slot.innerHTML, was);
  assert.notEqual(slot.firstElementChild, btn, 'the changed button is replaced');
  assert.deepEqual([...h.d.getElementById('side-foot').childNodes], foot);
  assert.deepEqual([...h.d.getElementById('rail-strip').childNodes], strip);
});
