// test/ui-worca-level-dialogs.test.mjs — the three worca level dialogs (welcome-new, welcome-existing,
// celebration): their content, the close that acknowledges once, the backdrop grace window, and
// the invariants that they hold no inputs and never touch <html data-level>.
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { useDomRelease } from './helpers/jsdom-release.mjs';
import { renderWorcaDialog } from '../ui/public/worca-level/dialogs.mjs';

const trackDom = useDomRelease(afterEach);
const realFetch = globalThis.fetch;
const realNow = Date.now;
afterEach(() => {
  globalThis.fetch = realFetch;
  Date.now = realNow;
});

const action = (id, done) => ({ id, label: `Label ${id}`, hint: `Hint ${id}`, href: `#/${id}`, done, doneAt: done ? 't' : null });
const view = (over = {}) => ({
  level: { index: 2, key: 'swimmer', name: 'Swimmer', description: 'You have started.', avatar: '/assets/worca-levels/swimmer.svg' },
  progress: { done: 1, total: 3 },
  next: [action('a', true), action('b', false), action('c', false)],
  top: false,
  ladder: [],
  welcome: null,
  celebration: null,
  ...over,
});

function setup() {
  const dom = trackDom(new JSDOM('<!doctype html><html data-level="beginner"><body></body></html>', { url: 'http://localhost:4317/' }));
  const doc = dom.window.document;
  const acks = [];
  globalThis.fetch = async (url, init) => {
    acks.push({ url, body: JSON.parse(init.body) });
    return { ok: true, status: 200, json: async () => view() };
  };
  return { dom, doc, acks };
}

const open = (kind, v, doc, onClose) => {
  const modal = renderWorcaDialog(kind, v, { doc, onClose });
  return modal;
};
const tick = () => new Promise((r) => setTimeout(r, 0));
const closeButton = (modal) => modal.querySelector('button.worca-dlg-close');

test('every dialog is a guarded .viewer-modal with the level name and avatar', () => {
  for (const kind of ['welcome-new', 'welcome-existing', 'celebration']) {
    const { doc } = setup();
    const modal = open(kind, view(), doc);
    assert.ok(modal.classList.contains('viewer-modal'), kind);
    assert.equal(modal.getAttribute('role'), 'dialog');
    assert.ok(doc.body.contains(modal), `${kind} is attached`);
    assert.match(modal.textContent, /Swimmer/, kind);
    const img = modal.querySelector('img');
    assert.equal(img.getAttribute('src'), '/assets/worca-levels/swimmer.svg');
    assert.ok(modal.querySelector('.dlg-head') && modal.querySelector('.dlg-body') && modal.querySelector('.dlg-foot'));
  }
});

test('welcome-existing and celebration name the next step', () => {
  for (const kind of ['welcome-existing', 'celebration']) {
    const { doc } = setup();
    const modal = open(kind, view(), doc);
    assert.match(modal.textContent, /Label b/, kind);
    assert.doesNotMatch(modal.textContent, /Label a/, kind);
  }
});

test('the top level shows the top line instead of a next step', () => {
  const { doc } = setup();
  const modal = open('celebration', view({ top: true, next: [] }), doc);
  assert.match(modal.textContent, /top level/i);
});

test('I-7: no input, select, textarea, checkbox or file picker in any dialog', () => {
  for (const kind of ['welcome-new', 'welcome-existing', 'celebration']) {
    const { doc } = setup();
    const modal = open(kind, view(), doc);
    assert.equal(modal.querySelectorAll('input, select, textarea, [contenteditable]').length, 0, kind);
  }
});

test('closing acknowledges welcome / celebration exactly once and removes the modal', async () => {
  const cases = [['welcome-new', { what: 'welcome' }], ['welcome-existing', { what: 'welcome' }], ['celebration', { what: 'celebration', index: 3 }]];
  for (const [kind, body] of cases) {
    const { doc, acks } = setup();
    let closed = 0;
    const modal = open(kind, view({ celebration: { index: 3, key: 'hunter', name: 'Hunter', avatar: 'a' } }), doc, () => { closed += 1; });
    const btn = closeButton(modal);
    btn.click();
    btn.click();
    await tick();
    assert.deepEqual(acks.map((a) => a.body), [body], kind);
    assert.equal(acks[0].url, '/api/worca-level/ack');
    assert.equal(closed, 1, kind);
    assert.ok(!doc.body.contains(modal), kind);
  }
});

test('Escape closes and acknowledges once', async () => {
  const { dom, doc, acks } = setup();
  const modal = open('welcome-new', view(), doc);
  modal.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  modal.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  await tick();
  assert.equal(acks.length, 1);
  assert.ok(!doc.body.contains(modal));
});

test('a scrim click straight after opening is ignored; one after the grace window closes', async () => {
  const { dom, doc, acks } = setup();
  const start = realNow();
  Date.now = () => start;
  const modal = open('celebration', view(), doc);
  const scrim = (el) => {
    el.dispatchEvent(new dom.window.MouseEvent('mousedown', { bubbles: true }));
    el.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
  };
  scrim(modal);
  await tick();
  assert.equal(acks.length, 0);
  assert.ok(doc.body.contains(modal));
  Date.now = () => start + 600;
  scrim(modal);
  await tick();
  assert.deepEqual(acks.map((a) => a.body), [{ what: 'celebration', index: 2 }], 'falls back to the current level');
  assert.ok(!doc.body.contains(modal));
});

test('a failed acknowledge still closes the dialog and does not throw', async () => {
  const { doc } = setup();
  globalThis.fetch = async () => ({ ok: false, status: 500, json: async () => ({ error: 'boom' }) });
  const warn = console.warn;
  console.warn = () => {};
  try {
    const modal = open('welcome-new', view(), doc);
    closeButton(modal).click();
    await tick();
    assert.ok(!doc.body.contains(modal));
  } finally {
    console.warn = warn;
  }
});

test('rendering and closing leave <html data-level> untouched', async () => {
  for (const kind of ['welcome-new', 'welcome-existing', 'celebration']) {
    const { doc } = setup();
    const modal = open(kind, view(), doc);
    closeButton(modal).click();
    await tick();
    assert.equal(doc.documentElement.getAttribute('data-level'), 'beginner', kind);
  }
});

test('an unknown kind throws', () => {
  const { doc } = setup();
  assert.throws(() => open('nope', view(), doc), /unknown/i);
});
