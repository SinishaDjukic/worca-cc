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

test('top bar: Back, Workflows ▾, name, Canvas · Versions, chip | Library toggle, Save version, Save — and nothing else', () => {
  const tl = doc.querySelector('.wfv-tl .wfv-bar');
  assert.deepEqual([...tl.querySelectorAll('button, input')].map((e) => e.id || e.dataset.page), ['wfv-back', 'wfv-wf-menu', 'wfv-name', 'canvas', 'versions', 'wfv-errors', 'wfv-import-file']);
  assert.equal(doc.getElementById('wfv-name').placeholder, 'Untitled pipeline');
  const tr = doc.querySelector('.wfv-tr .wfv-bar');
  assert.deepEqual([...tr.querySelectorAll('button')].map((e) => e.id), ['wfv-lib-toggle', 'wfv-saveversion', 'wfv-save']);
  assert.equal(doc.getElementById('wfv-save').textContent.trim(), 'Save');
});

test('dock = black "+" and the chat root; bottom-right = Auto-layout + zoom', () => {
  assert.deepEqual([...doc.querySelectorAll('#wfv-dock > *')].map((e) => e.id), ['wfv-add', 'wfc']);
  assert.deepEqual([...doc.querySelectorAll('#wfv-br button')].map((e) => e.id), ['wfv-autolayout', 'wfv-zoom']);
});

test('the dock "+" is the large icon button (40px, in line with the chat pill), the only .btn-lg in the view', () => {
  assert.deepEqual([...doc.getElementById('wfv-add').classList], ['btn', 'btn-lg', 'btn-primary', 'btn-icon', 'wfv-plus']);
  assert.deepEqual([...doc.querySelectorAll('[data-view="workflows"] .btn-lg')].map((e) => e.id), ['wfv-add']);
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

test('full screen: the sidebar and the top bar are hidden on the view', () => {
  assert.match(css, /body\.view-workflows \.sidebar,body\.view-workflows #topnav\{display:none !important;\}/);
  assert.match(css, /body\.view-workflows \.main\{padding:0;overflow:hidden;display:flex;flex-direction:column;\}/);
  assert.match(css, /\.view\[data-view="workflows"\]\{flex:1 1 auto;min-height:0;position:relative;\}/);
});

test('narrow screens: only Auto-layout goes icon-only (the zoom keeps its %), and the selection toolbar stays on the stage', () => {
  assert.match(css, /@media \(max-width:760px\)\{\.wfv-tr\{top:58px;\}#wfv-autolayout span\{display:none;\}#wfv-autolayout\{width:30px;padding:0;justify-content:center;\}/);
  assert.doesNotMatch(css, /\.wfv-br \.wfv-btn span\{display:none;\}/, 'that rule also hid #wfv-zoom-label');
  assert.match(css, /\.wfv-tb\{[^}]*max-width:calc\(100% - 16px\);overflow-x:auto;/);
});

test('versions (flag workflowTests): Canvas / Versions switch, the status line, Save version and the hidden page', () => {
  const pages = doc.getElementById('wfv-pages');
  assert.ok(pages, '#wfv-pages');
  assert.equal(pages.dataset.flag, 'workflowTests');
  assert.ok(pages.classList.contains('seg'));
  assert.deepEqual([...pages.querySelectorAll('button')].map((b) => b.textContent.trim()), ['Canvas', 'Versions']);
  assert.deepEqual([...pages.querySelectorAll('button')].map((b) => b.dataset.page), ['canvas', 'versions']);
  // The Labs chip sits inside the Versions tab label (A4), never as a link in the strip.
  assert.equal(pages.querySelector('[data-page="versions"]').dataset.flagChip, 'workflowTests');
  assert.equal(pages.hasAttribute('data-flag-chip'), false);
  const status = doc.getElementById('wfv-vstatus');
  assert.equal(status.dataset.flag, 'workflowTests');
  assert.ok(status.hidden);
  const save = doc.getElementById('wfv-saveversion');
  assert.equal(save.textContent.trim(), 'Save version');
  assert.equal(save.dataset.flag, 'workflowTests');
  const page = doc.getElementById('wfv-versions');
  assert.ok(page, '#wfv-versions');
  assert.ok(page.hidden);
  assert.equal(page.dataset.flag, 'workflowTests');
  // Under the floating top bars (so Canvas stays reachable) and fenced from the canvas keys (Delete never edits the hidden graph).
  assert.equal(page.parentElement.id, 'wfv-stage');
  assert.equal(page.dataset.canvasKeys, 'off');
});
