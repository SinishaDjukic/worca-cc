// Slice 2 of the design language: Settings forms are divided rows, and the theme proof measures the
// form and data pages (docs/design-system.md › Cards versus divided rows).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
const doc = new JSDOM(read('ui/public/index.html')).window.document;
const CSS = read('ui/public/style.css');
const FORM_TABS = ['general', 'runs', 'ask', 'tags'];

test('Settings: every static field is a divided row with its control in .drow-control', () => {
  for (const tab of FORM_TABS) {
    const pane = doc.querySelector(`.settings-pane[data-tab="${tab}"]`);
    assert.ok(pane, tab);
    const bare = [...pane.querySelectorAll('.field')].filter((f) => !f.classList.contains('drow'));
    assert.deepEqual(bare.map((f) => f.querySelector('label')?.textContent.trim()), [], `${tab}: .field without .drow`);
    for (const ctl of pane.querySelectorAll('input.input, select.select')) {
      if (ctl.closest('table, .mem-editor')) continue;
      assert.ok(ctl.closest('.drow-control'), `${tab}: #${ctl.id || ctl.className} sits in .drow-control`);
    }
    for (const row of pane.querySelectorAll('.drow')) assert.ok(row.closest('.drows'), `${tab}: a .drow inside .drows`);
  }
});

test('every inherit-field host is a .drows container, so its rows stack on phones', () => {
  for (const id of ['ask-engine-root', 'engine-settings-root']) assert.ok(doc.getElementById(id).classList.contains('drows'), `#${id}`);
  assert.match(read('ui/public/project-settings-view.mjs'), /body\.className = 'pd-settings-body drows'/);
});

test('Settings: no per-view rule re-widens a field to the old full-width grey bar', () => {
  assert.doesNotMatch(CSS, /\.settings-(?:card|pane)[^{]*\b(?:input|select|\.input|\.select)\b[^{]*\{[^}]*width:100%/);
  assert.match(CSS, /\.drow\.drow-wide\{grid-template-columns:minmax\(0,1fr\);\}/);
  assert.match(CSS, /\.drow\.drow-stack\{display:flex;/);
});

test('no older layout rule overrides a divided row or a table (web UI review cycle 1)', () => {
  // The member table reuses .ws-members: the chip list's flex rule must not reach the table.
  assert.doesNotMatch(CSS, /(?:^|[\s,}])\.ws-members(?::empty)?\s*\{[^}]*display:/m);
  assert.match(CSS, /div\.ws-members\{display:flex;/);
  // Chat notification rows are switch drows: no flex rule re-lays them out.
  assert.doesNotMatch(CSS, /\.chat-event-row[^{]*\{[^}]*display:/);
  // A wide row's table host fills the row, so the table's container query sees the row's width.
  assert.match(CSS, /\.drow\.drow-wide > \.drow-control > :is\([^)]*#tagDimsEditor[^)]*\)\{flex:1 1 auto;min-width:0;\}/);
  // On phones a wrapped select fills the row like an input.
  assert.match(CSS, /@container drows \(max-width:560px\)\{[^@]*\.drow-control > \.select-wrap\{flex:1 1 auto;min-width:0;\}/);
});

test('the theme proof measures five pages at three widths and two fresh loads', () => {
  const proof = read('tools/verify-theme-cdp.mjs');
  assert.match(proof, /\['settings', 'projects', 'schedules', 'stats', 'team-metrics'\]/);
  assert.match(proof, /\[290, 375, 1440\]/);
  assert.match(proof, /\['stats', 'Statistics'\], \['team-metrics', 'Team metrics'\]/);
  for (const s of ['settings-tags', 'settings-ask', 'settings-memory', 'settings-presets', 'projects', 'projects-detail', 'workspaces', 'schedules'])
    assert.match(proof, new RegExp(`SIZE_STATES = new Set\\([^)]*'${s}'`), `${s} is size-audited`);
});
