// test/feature-pull-picker.test.mjs — the "pull from Requirements" picker and its shared labels, in jsdom with a fake modal and fetch.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { DRAIN_ACTIVE_STATUSES } from '../src/core/drain.mjs';

const { window } = new JSDOM('<!doctype html><body></body>', { url: 'http://localhost:4317/' });
for (const k of ['document', 'window', 'Event']) Object.defineProperty(globalThis, k, { value: k === 'window' ? window : window[k], configurable: true, writable: true });
after(() => window.close());
const tick = () => new Promise((r) => setTimeout(r, 0));
const settle = async () => { for (let i = 0; i < 6; i++) await tick(); };
const { STATE, READY_CHECKS, RUN_LIVE, readyText, liveStart } = await import('../ui/public/feature-pull/labels.mjs');
const { openFeaturePicker } = await import('../ui/public/feature-pull/picker.mjs');

const SCOPE = { scopeType: 'project', scopeKey: 'shop-1' };
const feat = (seq, title, state, ready) => ({ seq, title, state, status: state === 'archived' ? 'archived' : 'idle', ready });

function fakeModal() {
  const m = { card: null, opts: null, closed: [], open(card, opts) { m.card = card; m.opts = opts; }, close(restore) { m.closed.push(restore); if (m.opts && m.opts.onClose) m.opts.onClose(); } };
  return m;
}
async function open({ features = [], scope = SCOPE, fetchJson, onPick = () => {}, onClose = () => {} } = {}) {
  const modal = fakeModal();
  const calls = [];
  const fj = fetchJson || (async (url) => { calls.push(url); return { features }; });
  openFeaturePicker({ modal, fetchJson: async (u) => { if (!fetchJson) return fj(u); calls.push(u); return fj(u); }, scope, onPick, onClose, document });
  await settle();
  return { modal, calls, card: modal.card };
}
const rows = (card) => [...card.querySelectorAll('[data-ui="feature-pick-row"]')];

test('labels: readyText, RUN_LIVE equals the server drain statuses, liveStart picks the first live run', () => {
  assert.equal(READY_CHECKS, 6);
  assert.equal(readyText({ ready: 4 }), 'Ready 4 of 6');
  assert.equal(readyText({ ready: 0 }), 'Ready 0 of 6');
  assert.equal(readyText({ ready: null }), '—');
  assert.equal(readyText({}), '—');
  assert.equal(STATE.your_turn.label, 'Your turn');
  assert.deepEqual([...RUN_LIVE].sort(), [...DRAIN_ACTIVE_STATUSES].sort());
  assert.equal(liveStart([{ run: { status: 'done' } }, { run: { status: 'running', id: 'r' } }, { run: { status: 'created' } }]).run.id, 'r');
  assert.equal(liveStart([{ run: { status: 'done' } }, { run: null }, {}]), null);
  assert.equal(liveStart(undefined), null);
});

test('rows show title, state label and "Ready 4 of 6"; a non-number ready shows "—"; archived is never listed', async () => {
  const { card, calls } = await open({ features: [feat(1, 'Login', 'ready', 4), feat(2, 'Export', 'decide', null), feat(3, 'Old', 'archived', 6)] });
  assert.equal(calls[0], '/api/requirements?scopeType=project&scopeKey=shop-1');
  const r = rows(card);
  assert.equal(r.length, 2);
  assert.match(r[0].textContent, /Login/);
  assert.match(r[0].textContent, /Ready/);
  assert.match(r[0].textContent, /Ready 4 of 6/);
  assert.match(r[1].textContent, /Decide/);
  assert.match(r[1].textContent, /—/);
  assert.doesNotMatch(card.textContent, /Old/);
});

test('search filters by case-insensitive substring; no match and empty list have their own messages', async () => {
  const { card } = await open({ features: [feat(1, 'Login page', 'ready', 4), feat(2, 'Export CSV', 'ready', 6)] });
  const q = card.querySelector('input[type="search"]');
  q.value = 'EXPORT'; q.dispatchEvent(new window.Event('input', { bubbles: true }));
  assert.deepEqual(rows(card).map((x) => x.textContent.includes('Export CSV')), [true]);
  q.value = 'zzz'; q.dispatchEvent(new window.Event('input', { bubbles: true }));
  assert.equal(rows(card).length, 0);
  assert.match(card.textContent, /No features match/);
  const empty = await open({ features: [feat(3, 'Old', 'archived', 6)] });
  assert.match(empty.card.textContent, /No active features in Requirements yet\./);
});

test('scope null: says to pick a project or workspace first and fetches nothing', async () => {
  const { card, calls } = await open({ scope: null });
  assert.match(card.textContent, /Pick a project or workspace first/);
  assert.equal(calls.length, 0);
});

test('a load error shows an inline message and Retry, and Retry refetches', async () => {
  let n = 0;
  const { card } = await open({ fetchJson: async () => { n++; if (n === 1) throw new Error('boom'); return { features: [feat(1, 'Login', 'ready', 4)] }; } });
  const retry = card.querySelector('[data-ui="feature-pick-retry"]');
  assert.ok(retry);
  assert.match(card.textContent, /could not be loaded/i);
  retry.click(); await settle();
  assert.equal(n, 2);
  assert.equal(rows(card).length, 1);
  assert.equal(card.querySelector('[data-ui="feature-pick-retry"]'), null);
});

test('a title with markup stays text; picking calls onPick with the summary and closes the modal', async () => {
  const evil = '<img src=x onerror="window.__pwned=1">';
  let picked = null; let closes = 0;
  const f = feat(7, evil, 'ready', 6);
  const { card, modal } = await open({ features: [f], onPick: (s) => { picked = s; }, onClose: () => { closes++; } });
  assert.equal(card.querySelector('img'), null);
  assert.ok(rows(card)[0].textContent.includes(evil));
  rows(card)[0].click();
  assert.equal(modal.closed.length, 1, 'the picker closes first');
  await settle();
  assert.deepEqual(picked, f);
  assert.equal(closes, 1);
});

test('a rejecting onPick is caught (no unhandled rejection) and the trigger is handed to the modal', async () => {
  const f = feat(7, 'A', 'ready', 6);
  const warn = console.warn; const warned = [];
  console.warn = (...a) => warned.push(a);
  const unhandled = []; const on = (e) => unhandled.push(e); process.on('unhandledRejection', on);
  try {
    const { card } = await open({ features: [f], onPick: async () => { throw new Error('boom'); } });
    rows(card)[0].click();
    await settle(); await settle();
  } finally { console.warn = warn; process.off('unhandledRejection', on); }
  assert.equal(unhandled.length, 0);
  assert.equal(warned.length, 1);
});

test('the picker is opened with the trigger so focus can return to it', async () => {
  const trigger = document.createElement('button');
  const modal = fakeModal();
  openFeaturePicker({ modal, fetchJson: async () => ({ features: [] }), scope: SCOPE, trigger, document });
  assert.equal(modal.opts.trigger, trigger);
});

test('Cancel and the modal onClose both fire onClose once', async () => {
  let closes = 0;
  const { card, modal } = await open({ onClose: () => { closes++; } });
  card.querySelector('[data-ui="feature-pick-cancel"]').click();
  assert.equal(closes, 1);
  const again = await open({ onClose: () => { closes++; } });
  again.modal.opts.onClose();
  assert.equal(closes, 2);
  assert.ok(modal.closed.length >= 1);
});
