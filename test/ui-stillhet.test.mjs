// test/ui-stillhet.test.mjs — ui/public/stillhet.mjs in jsdom: the Invitation, the switch, the Labs row and the reload rule.
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';

const dom0 = new JSDOM('<!doctype html><html data-flags=""><body></body></html>');
globalThis.document = dom0.window.document;
globalThis.window = dom0.window;
globalThis.CustomEvent = dom0.window.CustomEvent;
const S = await import('../ui/public/stillhet.mjs');
const F = await import('../ui/public/flags.mjs');
const { stillhetInvitation, designSwitch } = await import('../ui/public/design-system/components/index.mjs');

const URL_ = 'https://github.com/o/r/issues';
const page = (extra = '') => {
  const w = new JSDOM(`<!doctype html><html data-flags=""><body><div class="main-col"><header id="topnav"><div class="topnav-r"><button id="topnav-activity"></button><div id="activity-pop"></div><button id="topnav-new"></button></div></header><main id="main" tabindex="-1">${extra}</main></div></body></html>`, { pretendToBeVisual: true }).window;
  globalThis.document = w.document; globalThis.window = w; globalThis.CustomEvent = w.CustomEvent;
  return w;
};
const status = { stillhetAsk: true, bugsUrl: URL_ };
const sleep = () => new Promise((r) => setTimeout(r, 0));
beforeEach(() => { S.resetStillhetState(); });

test('shouldAskStillhet: false for each condition alone, true when all pass', () => {
  const ok = { ask: true, asked: false, fresh: false, flagKnown: true, on: false, locked: false, welcomeThisLoad: false, setupOpen: false, dialogOpen: false };
  assert.equal(S.shouldAskStillhet(ok), true);
  for (const [k, v] of Object.entries({ ask: false, asked: true, fresh: true, flagKnown: false, on: true, locked: true, welcomeThisLoad: true, setupOpen: true, dialogOpen: true })) {
    assert.equal(S.shouldAskStillhet({ ...ok, [k]: v }), false, k);
  }
});

test('stillhetLabsRow keeps the rail row in every case, until the end of feature 3 the one way in and out', () => {
  for (const flag of [{ key: 'rail', on: false }, { key: 'rail', on: true }, { key: 'runLabels', on: false }]) assert.equal(S.stillhetLabsRow()(flag), true, JSON.stringify(flag));
});

test('mounting twice leaves one node of each kind; the strip follows #topnav and takes the focus on No thanks', () => {
  const w = page(); const d = w.document;
  const fetchJson = async () => ({ ok: true, data: {} });
  S.mountStillhetAsk({ doc: d, status, fetchJson });
  S.mountStillhetAsk({ doc: d, status, fetchJson });
  S.mountDesignSwitch({ doc: d, status, flag: { on: false, locked: false }, fetchJson, toast() {} });
  S.mountDesignSwitch({ doc: d, status, flag: { on: false, locked: false }, fetchJson, toast() {} });
  assert.equal(d.querySelectorAll('[data-stillhet="invitation"]').length, 1);
  assert.equal(d.querySelectorAll('[data-stillhet="design-switch"]').length, 1);
  assert.equal(d.getElementById('topnav').nextElementSibling.id, 'rail-strip');
  assert.equal(d.activeElement, d.querySelector('[data-confirm="no"]'));
  assert.equal(d.getElementById('rail-strip').innerHTML, stillhetInvitation({ bugsUrl: URL_ }));
  assert.equal(d.getElementById('activity-pop').nextElementSibling.dataset.stillhet, 'design-switch');
});

test('with the ask switch off the switch mounts nothing', () => {
  const d = page().document;
  assert.equal(S.mountDesignSwitch({ doc: d, status: { stillhetAsk: false }, flag: { on: false }, fetchJson: async () => ({}), toast() {} }), null);
  assert.equal(d.querySelectorAll('[data-stillhet]').length, 0);
});

test('Try Stillhet sends one PATCH and ignores clicks while it is pending; a failure shows Try again', async () => {
  const w = page(); const d = w.document; const sent = [];
  let release; const gate = new Promise((r) => { release = r; });
  let ok = false;
  const fetchJson = async (m, u, b) => { sent.push([m, u, b]); await gate; return ok ? { ok: true, data: {} } : { ok: false, data: { error: 'read-only' } }; };
  S.mountStillhetAsk({ doc: d, status, fetchJson });
  d.querySelector('[data-confirm="yes"]').click();
  d.querySelector('[data-confirm="yes"]').click();
  d.querySelector('[data-confirm="no"]').click();
  assert.deepEqual(sent, [['PATCH', '/api/flags', { rail: true }]]);
  assert.equal(d.querySelector('[data-confirm="yes"]').textContent, 'Turning on…');
  release(); await sleep(); await sleep();
  assert.match(d.getElementById('rail-strip').textContent, /Stillhet could not be turned on.*read-only/);
  assert.equal(d.querySelector('[data-confirm="yes"]').textContent, 'Try again');
  d.querySelector('[data-confirm="yes"]').click();
  assert.equal(sent.length, 2);
});

test('No thanks sends one POST; a failure offers Not now, which closes with no request', async () => {
  const d = page().document; const sent = [];
  const fetchJson = async (m, u, b) => { sent.push([m, u, b]); return { ok: false, data: { error: 'disk' } }; };
  S.mountStillhetAsk({ doc: d, status, fetchJson });
  d.querySelector('[data-confirm="no"]').click();
  assert.deepEqual(sent, [['POST', '/api/onboarding', { stillhetAsked: true }]]);
  await sleep(); await sleep();
  assert.match(d.getElementById('rail-strip').textContent, /Your answer could not be saved/);
  assert.equal(d.querySelector('[data-confirm="no"]').textContent, 'Not now');
  d.querySelector('[data-confirm="no"]').click();
  assert.equal(sent.length, 1);
  assert.equal(d.getElementById('rail-strip'), null);
});

test('a saved No thanks closes the strip', async () => {
  const d = page().document;
  S.mountStillhetAsk({ doc: d, status, fetchJson: async () => ({ ok: true, data: {} }) });
  d.querySelector('[data-confirm="no"]').click();
  await sleep(); await sleep();
  assert.equal(d.getElementById('rail-strip'), null);
});

test('Esc sends nothing, closes the strip, and a reconnect mount adds nothing', async () => {
  const w = page(); const d = w.document; const sent = [];
  const fetchJson = async (...a) => { sent.push(a); return { ok: true, data: {} }; };
  S.mountStillhetAsk({ doc: d, status, fetchJson });
  d.querySelector('.rc-confirm').getClientRects = () => [1];
  d.body.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  assert.equal(sent.length, 0);
  assert.equal(d.getElementById('rail-strip'), null);
  assert.equal(d.activeElement, d.getElementById('main'));
  assert.equal(S.mountStillhetAsk({ doc: d, status, fetchJson }), null);
  assert.equal(d.querySelectorAll('[data-stillhet]').length, 0);
});

test('Esc while the answer is pending does nothing', async () => {
  const w = page(); const d = w.document;
  S.mountStillhetAsk({ doc: d, status, fetchJson: () => new Promise(() => {}) });
  d.querySelector('[data-confirm="yes"]').click();
  d.querySelector('.rc-confirm').getClientRects = () => [1];
  d.body.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  assert.ok(d.getElementById('rail-strip'));
});

test('the strip closes when rail turns on elsewhere', () => {
  const d = page().document;
  S.mountStillhetAsk({ doc: d, status, fetchJson: async () => ({ ok: true }) });
  F.applyFlags({ rail: true }, d);
  assert.equal(d.getElementById('rail-strip'), null);
  F.applyFlags({ rail: false }, d);
});

test('the switch writes the flag, sets aria-busy while pending, and flips back with a Toast on failure', async () => {
  const d = page().document; const toasts = [];
  let release; const gate = new Promise((r) => { release = r; });
  S.mountDesignSwitch({ doc: d, status, flag: { on: false, locked: false }, fetchJson: async (m, u, b) => { assert.deepEqual(b, { rail: true }); await gate; return { ok: false, data: { error: 'nope' } }; }, toast: (t) => toasts.push(t) });
  d.querySelector('[data-design-switch]').click();
  assert.equal(d.querySelector('[data-design-switch]').getAttribute('aria-busy'), 'true');
  release(); await sleep(); await sleep();
  assert.equal(d.querySelector('[data-design-switch]').getAttribute('aria-checked'), 'false');
  assert.deepEqual(toasts, ['Stillhet could not be switched: nope']);
  assert.equal(d.querySelector('[data-stillhet="design-switch"]').outerHTML, designSwitch({ on: false }));
});

test('watchRailReload: once away from the boot value, never toward it, held while text is typed, and not twice in 10 s', () => {
  const w = page('<textarea id="t"></textarea>'); const d = w.document;
  const store = new Map(); const storage = { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, v) };
  let reloads = 0; const toasts = []; let t = 1000;
  const win = { location: { reload: () => { reloads++; } }, sessionStorage: storage };
  const off = S.watchRailReload({ doc: d, win, bootOn: false, toast: (x) => toasts.push(x), now: () => t, storage });
  F.applyFlags({ rail: false }, d);
  assert.equal(reloads, 0);
  d.getElementById('t').value = 'typed';
  F.applyFlags({ rail: true }, d);
  assert.equal(reloads, 0); assert.deepEqual(toasts, ['Stillhet is on.']);
  d.getElementById('t').value = '';
  d.dispatchEvent(new w.Event('input'));
  assert.equal(reloads, 1);
  F.applyFlags({ rail: false }, d);
  assert.equal(reloads, 1);
  t += 1000;
  F.applyFlags({ rail: true }, d);
  assert.equal(reloads, 1);   // same value again within 10 s: refused
  off();
  F.applyFlags({ rail: false }, d);
});

test('ui/public/stillhet.mjs imports only the flags module and the library index', () => {
  const src = readFileSync('ui/public/stillhet.mjs', 'utf8');
  const imports = [...src.matchAll(/^import .* from '([^']+)'/gm)].map((m) => m[1]);
  assert.deepEqual(imports.sort(), ['./design-system/components/index.mjs', './flags.mjs']);
});
