// test/models-harness-tiles.test.mjs — the harness tiles (models-menu P5 Task 2, DESIGN JOB-1): one tile per harness
// in MODEL_ENGINE_NAMES order, Claude Code's the big one with "Best performance", the rest "Beta"; Ready / Not ready
// said on each tile (nothing claimed with no engine list); a lock disables, a not-ready engine stays pickable (L10);
// a click moves the pick, its aria-pressed and the tick.
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { MODEL_ENGINE_NAMES } from '../src/shared/engine-switch.mjs';
import { renderHarnessTiles } from '../ui/public/models/harness-tiles.mjs';

const doms = [];
afterEach(() => { for (const d of doms.splice(0)) d.window.close(); });
const docOf = () => { const d = new JSDOM('<!doctype html><body></body>'); doms.push(d); return d.window.document; };

const ALL_READY = ['claude', 'codex', 'copilot', 'cursor', 'gemini', 'goose', 'opencode', 'qwen'].map((name) => ({ name, ready: true }));

const tiles = (root) => [...root.querySelectorAll('button.mdl-hx-t')];
const tileOf = (root, engine) => root.querySelector(`button.mdl-hx-t[data-engine="${engine}"]`);
const stateOf = (tile) => tile.querySelector('.mdl-hx-state').textContent;

test('eight tiles in engine order; Claude Code is the big one', () => {
  const doc = docOf();
  const root = renderHarnessTiles(doc, { engines: ALL_READY, picked: 'codex', showDefault: true });
  assert.ok(root.matches('div.mdl-hx[role="group"]'));
  assert.equal(root.getAttribute('aria-label'), 'Harness');
  const all = tiles(root);
  assert.deepEqual(all.map((t) => t.dataset.engine), [...MODEL_ENGINE_NAMES]);
  assert.deepEqual(all.map((t) => t.dataset.engine), ['claude', 'codex', 'copilot', 'cursor', 'gemini', 'goose', 'opencode', 'qwen']);
  assert.ok(all.every((t) => t.type === 'button'));

  const [claude, codex] = all;
  assert.ok(claude.classList.contains('best'));
  assert.ok(claude.querySelector('.mdl-mark.xl'));
  assert.equal(claude.querySelector('.badge.mdl-best').textContent, 'Best performance');
  assert.equal(claude.querySelector('.badge.blue'), null);
  assert.equal(stateOf(claude), 'Ready · Default for new runs');
  assert.ok(claude.querySelector('.mdl-hx-state').matches('.mdl-st.ok'));
  assert.equal(claude.getAttribute('aria-pressed'), 'false');
  assert.ok(!claude.classList.contains('on'));
  assert.equal(claude.querySelector('.mdl-hx-check'), null);
  assert.equal(claude.querySelector('.mdl-hx-name').textContent, 'Claude Code');

  assert.equal(codex.getAttribute('aria-pressed'), 'true');
  assert.ok(codex.querySelector('.mdl-hx-check'));
  assert.ok(codex.classList.contains('on'));
  assert.equal(codex.querySelector('.badge').textContent, 'Beta');
  assert.ok(codex.querySelector('.badge').matches('.badge.blue'));
  assert.ok(codex.querySelector('.mdl-mark.lg'));
  assert.ok(!codex.classList.contains('best'));
  assert.equal(codex.querySelector('.mdl-hx-name').textContent, 'OpenAI Codex');
  assert.equal(stateOf(codex), 'Ready');
  assert.equal(root.querySelectorAll('.mdl-hx-check').length, 1);
  assert.equal(root.querySelectorAll('.badge.mdl-best').length, 1);
  assert.equal(root.querySelectorAll('.badge.blue').length, 7);
});

test('not ready is said and explained, and still pickable; a lock disables', () => {
  const doc = docOf();
  const root = renderHarnessTiles(doc, {
    engines: [{ name: 'claude', ready: true }, { name: 'goose', ready: false, reason: 'its CLI is not installed' }],
    locks: [{ name: 'copilot', reason: 'off while the credential broker is on' }],
  });
  doc.body.append(root);
  const goose = tileOf(root, 'goose');
  assert.equal(stateOf(goose), 'Not ready');
  assert.ok(goose.querySelector('.mdl-hx-state').matches('.mdl-st.off'));
  assert.equal(goose.title, 'its CLI is not installed');
  assert.equal(goose.disabled, false);
  assert.ok(goose.classList.contains('off'));

  const copilot = tileOf(root, 'copilot');
  assert.equal(copilot.disabled, true);
  assert.equal(copilot.title, 'off while the credential broker is on');

  const codex = tileOf(root, 'codex');
  assert.equal(stateOf(codex), 'Not ready', 'an engine missing from the list is not ready');
  assert.ok(codex.classList.contains('off'));

  const claude = tileOf(root, 'claude');
  assert.equal(stateOf(claude), 'Ready', 'no default suffix without showDefault');
  assert.ok(!claude.classList.contains('off'));
  assert.equal(claude.getAttribute('aria-pressed'), 'true');

  goose.click();
  assert.equal(goose.getAttribute('aria-pressed'), 'true');
  assert.ok(goose.classList.contains('on'));
  assert.ok(goose.querySelector('.mdl-hx-check'));
  assert.equal(claude.getAttribute('aria-pressed'), 'false');
  assert.ok(!claude.classList.contains('on'));
  assert.equal(root.querySelectorAll('.mdl-hx-check').length, 1);
  assert.deepEqual(tiles(root).filter((t) => t.getAttribute('aria-pressed') === 'true').map((t) => t.dataset.engine), ['goose']);

  const both = renderHarnessTiles(doc, {
    engines: [{ name: 'copilot', ready: false, reason: 'not signed in' }],
    locks: [{ name: 'copilot', reason: 'off while the credential broker is on' }],
  });
  assert.equal(tileOf(both, 'copilot').title, 'off while the credential broker is on', 'a lock wins over a reason');
});

test('with no engine list nothing is claimed', () => {
  const doc = docOf();
  const root = renderHarnessTiles(doc, {});
  const states = [...root.querySelectorAll('.mdl-hx-state')];
  assert.equal(states.length, 8);
  assert.deepEqual(states.map((s) => s.textContent), Array(8).fill(''));
  assert.ok(states.every((s) => !s.classList.contains('mdl-st')), 'no tone, so no state dot');
  assert.ok(tiles(root).every((t) => !t.classList.contains('off') && !t.disabled));
  assert.equal(tileOf(root, 'claude').getAttribute('aria-pressed'), 'true');
});

test("the default harness and the group's name are the caller's", () => {
  const doc = docOf();
  const root = renderHarnessTiles(doc, { engines: ALL_READY, showDefault: true, defaultEngine: 'codex', label: 'X' });
  assert.equal(root.getAttribute('aria-label'), 'X');
  assert.equal(stateOf(tileOf(root, 'codex')), 'Ready · Default for new runs');
  assert.equal(stateOf(tileOf(root, 'claude')), 'Ready');
  assert.deepEqual(tiles(root).filter((t) => stateOf(t).includes('Default')).map((t) => t.dataset.engine), ['codex']);
});

test('a locked tile takes no click, and a locked pick goes to the first unlocked harness', () => {
  const doc = docOf();
  const view = doc.defaultView;
  const lock = (name) => ({ name, reason: 'Off while the credential broker is on' });
  const pressed = (root) => tiles(root).filter((t) => t.getAttribute('aria-pressed') === 'true').map((t) => t.dataset.engine);
  const root = renderHarnessTiles(doc, { engines: ALL_READY, picked: 'codex', locks: [lock('codex')] });
  doc.body.append(root);
  assert.deepEqual(pressed(root), ['claude'], 'a locked harness is never the pick');
  assert.ok(tileOf(root, 'claude').querySelector('.mdl-hx-check'));
  // A synthetic click reaches a disabled button's listeners: the tile itself refuses it.
  tileOf(root, 'codex').dispatchEvent(new view.MouseEvent('click', { bubbles: true }));
  assert.deepEqual(pressed(root), ['claude']);
  assert.equal(tileOf(root, 'codex').querySelector('.mdl-hx-check'), null);
  tileOf(root, 'gemini').dispatchEvent(new view.MouseEvent('click', { bubbles: true }));
  assert.deepEqual(pressed(root), ['gemini'], 'an open tile still takes the click');

  const two = renderHarnessTiles(doc, { engines: ALL_READY, picked: 'codex', locks: [lock('claude'), lock('codex')] });
  assert.deepEqual(pressed(two), ['copilot'], 'the first unlocked one in engine order');
  assert.deepEqual(pressed(renderHarnessTiles(doc, { engines: ALL_READY, picked: 'nope' })), [], 'an unknown pick presses none');
  const every = renderHarnessTiles(doc, { picked: 'claude', locks: MODEL_ENGINE_NAMES.map(lock) });
  assert.deepEqual(pressed(every), [], 'every harness locked: none pressed');
});
