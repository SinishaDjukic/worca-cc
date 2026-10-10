// test/ui-workflows-markup.test.mjs — the Workflows view's static shell (index.html) and its CSS hooks.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';

const html = readFileSync(new URL('../ui/public/index.html', import.meta.url), 'utf8');
const css = readFileSync(new URL('../ui/public/style.css', import.meta.url), 'utf8');
const doc = new JSDOM(html).window.document;

test('one workflows view; the composer, agents, scripts and agent-create views are gone', () => {
  assert.equal(doc.querySelectorAll('[data-view="workflows"]').length, 1);
  for (const v of ['composer', 'agents', 'scripts', 'agent-create']) assert.equal(doc.querySelector(`[data-view="${v}"]`), null, v);
});

test('top bar: Back, Workflows ▾, name, chip | Library toggle, Save — and nothing else', () => {
  const tl = doc.querySelector('.wfv-tl .wfv-bar');
  assert.deepEqual([...tl.querySelectorAll('button, input')].map((e) => e.id), ['wfv-back', 'wfv-wf-menu', 'wfv-name', 'wfv-errors', 'wfv-import-file']);
  assert.equal(doc.getElementById('wfv-name').placeholder, 'Untitled pipeline');
  const tr = doc.querySelector('.wfv-tr .wfv-bar');
  assert.deepEqual([...tr.querySelectorAll('button')].map((e) => e.id), ['wfv-lib-toggle', 'wfv-save']);
  assert.equal(doc.getElementById('wfv-save').textContent.trim(), 'Save');
});

test('dock = black "+" and the chat root; bottom-right = Auto-layout + zoom', () => {
  assert.deepEqual([...doc.querySelectorAll('#wfv-dock > *')].map((e) => e.id), ['wfv-add', 'wfc']);
  assert.deepEqual([...doc.querySelectorAll('#wfv-br button')].map((e) => e.id), ['wfv-autolayout', 'wfv-zoom']);
});

test('the agent + script editors live in the view\'s sheet with their old ids', () => {
  const sheet = doc.getElementById('wfv-sheet');
  assert.equal(sheet.getAttribute('aria-modal'), 'true');
  for (const id of ['agents-list', 'agents-msg', 'agent-card-tpl', 'agw-step-1', 'agw-step-2', 'agw-step-3', 'agw-name', 'agw-close', 'scripts-host', 'scripts-msg']) {
    assert.ok(sheet.querySelector(`#${id}`), `#${id} inside the sheet`);
  }
});

test('the canvas-keys fence covers every non-canvas surface', () => {
  for (const id of ['wfv-library', 'wfc', 'wfv-overlay', 'wfv-sheet']) assert.equal(doc.getElementById(id).dataset.canvasKeys, 'off', id);
  // The top bars, the dock and the bottom-right bar too: Space on a focused Save, "+" or zoom button activates IT
  // (the canvas Space-pan would cancel the press) and Delete / arrows never edit the selected card from there.
  const floats = [...doc.querySelectorAll('.wfv-float')];
  assert.equal(floats.length, 4);
  for (const f of floats) assert.equal(f.dataset.canvasKeys, 'off', f.className);
});

test('full screen: the sidebar, the top bar and the Ask dock are hidden on the view', () => {
  assert.match(css, /body\.view-workflows \.sidebar,body\.view-workflows #topnav,body\.view-workflows > \.ask-dock\{display:none !important;\}/);
});

test('narrow screens: only Auto-layout goes icon-only (the zoom keeps its %), and the selection toolbar stays on the stage', () => {
  assert.match(css, /@media \(max-width:760px\)\{\.wfv-tr\{top:58px;\}#wfv-autolayout span\{display:none;\}#wfv-autolayout\{width:30px;padding:0;justify-content:center;\}/);
  assert.doesNotMatch(css, /\.wfv-br \.wfv-btn span\{display:none;\}/, 'that rule also hid #wfv-zoom-label');
  assert.match(css, /\.wfv-tb\{[^}]*max-width:calc\(100% - 16px\);overflow-x:auto;/);
});
