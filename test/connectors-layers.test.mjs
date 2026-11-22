// test/connectors-layers.test.mjs — the Connectors modal / sheet / confirm adapter over marketplace/layers.mjs.
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { useDomRelease } from './helpers/jsdom-release.mjs';
import { createConnectorLayers } from '../ui/public/mcp-servers/connectors-layers.mjs';

const trackDom = useDomRelease(afterEach);
const tick = () => new Promise((r) => setTimeout(r, 0));
function world() {
  const { window } = trackDom(new JSDOM('<!doctype html><body><button id="opener" data-focus-key="k:1">x</button></body>'));
  const doc = window.document;
  doc.getElementById('opener').focus();
  return { window, doc, ...createConnectorLayers({ doc, win: window }) };
}
const esc = (doc, id) => doc.getElementById(id).dispatchEvent(new doc.defaultView.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
const body = (doc, t = 'hello') => { const d = doc.createElement('div'); d.textContent = t; return d; };

test('modal.open draws .mk-dialog with #mk-dialog-title, the body and the action buttons (no btn-sm)', () => {
  const { doc, modal } = world();
  const b = body(doc);
  modal.open('Pick', b, [['Cancel', 'btn btn-sm', () => {}], ['Save', 'btn btn-primary btn-sm', () => {}]], { width: 'lg' });
  assert.equal(doc.getElementById('mk-dialog-title').textContent, 'Pick');
  assert.equal(doc.getElementById('mk-dialog').dataset.width, 'lg');
  assert.ok(doc.querySelector('.mk-dialog-body').contains(b));
  const btns = [...doc.querySelectorAll('.mk-dialog-foot button')];
  assert.deepEqual(btns.map((x) => x.textContent), ['Cancel', 'Save']);
  assert.ok(btns.every((x) => !x.classList.contains('btn-sm')));
  assert.ok(doc.querySelector('.mk-dialog-head .mk-dlg-close[aria-label=Close]'));
});

test('Escape runs onClose hooks then afterClose once; close() runs neither', async () => {
  const { doc, modal } = world();
  const log = [];
  modal.open('A', body(doc), []);
  modal.onClose(() => log.push('hook'));
  modal.afterClose(() => log.push('after'));
  esc(doc, 'mk-dialog');
  await tick();
  assert.deepEqual(log, ['hook', 'after']);
  assert.equal(doc.getElementById('mk-dialog'), null);
  modal.open('B', body(doc), []);
  modal.onClose(() => log.push('hook2'));
  modal.afterClose(() => log.push('after2'));
  modal.close();
  await tick();
  assert.deepEqual(log, ['hook', 'after']);
  assert.equal(doc.getElementById('mk-dialog'), null);
});

test('the Close button is a dismissal', async () => {
  const { doc, modal } = world();
  let n = 0;
  modal.open('A', body(doc), []);
  modal.afterClose(() => { n++; });
  doc.querySelector('.mk-dlg-close').click();
  await tick();
  assert.equal(n, 1);
});

test('shows(node) is true only while open; a second open replaces the first without its afterClose', () => {
  const { doc, modal } = world();
  const b = body(doc);
  assert.equal(modal.shows(b), false);
  let after = 0;
  modal.open('A', b, []);
  modal.afterClose(() => { after++; });
  assert.equal(modal.shows(b), true);
  const b2 = body(doc, 'two');
  modal.open('B', b2, []);
  assert.equal(after, 0);
  assert.equal(modal.shows(b), false);
  assert.equal(modal.shows(b2), true);
  assert.equal(doc.querySelectorAll('.mk-dialog').length, 1);
  modal.close();
  assert.equal(modal.shows(b2), false);
});

test('confirm: title, lose list, keep line, Cancel focused, red Remove; true only on Remove; once', async () => {
  const { doc, confirm } = world();
  const p = confirm({ title: 'Remove x from y?', message: 'Runs stop getting it.', lose: ['its values', 'its tests'], keep: 'x stays in Servers.' });
  assert.equal(doc.getElementById('mk-dialog-title').textContent, 'Remove x from y?');
  assert.deepEqual([...doc.querySelectorAll('.cx-lose li')].map((l) => l.textContent), ['its values', 'its tests']);
  assert.match(doc.querySelector('.mk-dialog-body .mk-meta').textContent, /x stays in Servers/);
  const [cancel, go] = doc.querySelectorAll('.mk-dialog-foot button');
  assert.equal(doc.activeElement, cancel);
  assert.ok(go.classList.contains('btn-danger') && go.textContent === 'Remove');
  go.click();
  go.click();
  assert.equal(await p, true);
  assert.equal(doc.getElementById('mk-dialog'), null);
});

test('confirm resolves false on Cancel and on Escape', async () => {
  const { doc, confirm } = world();
  const a = confirm({ title: 'T', message: 'm' });
  doc.querySelector('.mk-dialog-foot button').click();
  assert.equal(await a, false);
  const b = confirm({ title: 'T', message: 'm' });
  esc(doc, 'mk-dialog');
  assert.equal(await b, false);
});

test('sheet.open draws .mk-sheet with #mk-sheet-title and returns focus to the opener on Esc', async () => {
  const { doc, sheet } = world();
  sheet.open('SKILL.md', body(doc), [['Close', 'btn', () => {}]], { kind: 'viewer' });
  assert.equal(doc.getElementById('mk-sheet-title').textContent, 'SKILL.md');
  assert.ok(doc.querySelector('#mk-sheet .mk-sheet-body'));
  assert.equal(doc.getElementById('mk-sheet-host').classList.contains('hidden'), false);
  esc(doc, 'mk-sheet');
  await tick();
  assert.equal(doc.getElementById('mk-sheet-host').classList.contains('hidden'), true);
  assert.equal(doc.activeElement, doc.getElementById('opener'));
});

test('an onClose hook registered before open() survives it and fires on Escape', async () => {
  const { doc, modal } = world();
  let hit = 0;
  modal.onClose(() => { hit++; });
  modal.open('A', body(doc), []);
  esc(doc, 'mk-dialog');
  await tick();
  assert.equal(hit, 1);
});
