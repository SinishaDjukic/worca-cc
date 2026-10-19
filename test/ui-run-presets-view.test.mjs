// test/ui-run-presets-view.test.mjs — Settings › Presets (ui/public/run-presets-view.mjs): empty state, cards, the
// callbacks, the gone badge, and a name holding HTML rendering as text.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { renderPresetsList, presetScopeLabel, PRESETS_EMPTY_TEXT } from '../ui/public/run-presets-view.mjs';

const NOW = Date.parse('2026-10-16T12:00:00Z');
const preset = (over = {}) => ({ id: 'rp_aaaaaaaaaaaa', name: 'Quick fix', scope: { kind: 'global', ref: null },
  setup: { workflowId: 'wf_default', engine: 'codex' }, updatedAt: '2026-10-14T12:00:00Z', ...over });

test('0 presets show the empty state text', () => {
  const { document } = new JSDOM('').window;
  assert.equal(renderPresetsList(document, []).textContent, PRESETS_EMPTY_TEXT);
  assert.equal(PRESETS_EMPTY_TEXT, 'No presets yet. Set up a run in New run, then use Save current setup…');
});

test('a card names the preset, its scope, workflow and engine; each button calls back with the preset', () => {
  const { document } = new JSDOM('').window;
  const calls = [];
  const cb = (act) => (p) => calls.push([act, p.id]);
  const list = renderPresetsList(document, [preset(), preset({ id: 'rp_bbbbbbbbbbbb', name: 'Pinned', scope: { kind: 'project', ref: 'api-1' } })], {
    names: { 'project:api-1': 'api', 'workflow:wf_default': 'Default' }, now: NOW,
    onUse: cb('use'), onRename: cb('rename'), onDuplicate: cb('duplicate'), onEditScope: cb('scope'), onDelete: cb('delete'),
  });
  const cards = list.querySelectorAll('.preset-card');
  assert.equal(cards.length, 2);
  assert.match(cards[0].textContent, /Quick fix.*Any project.*Default · codex · Updated 2 d ago/);
  assert.match(cards[1].textContent, /Only api/);
  assert.equal(cards[1].querySelector('.preset-gone'), null);
  for (const b of cards[0].querySelectorAll('button')) b.click();
  assert.deepEqual(calls.map((c) => c[0]), ['use', 'rename', 'duplicate', 'scope', 'delete']);
});

test('a pinned preset whose project or workspace is gone shows the badge', () => {
  const { document } = new JSDOM('').window;
  const list = renderPresetsList(document, [preset({ scope: { kind: 'project', ref: 'gone-1' } }), preset({ id: 'rp_c', scope: { kind: 'workspace', ref: 'wks-x' } })], { now: NOW });
  assert.deepEqual([...list.querySelectorAll('.preset-gone')].map((b) => b.textContent), ['Project gone', 'Workspace gone']);
  assert.equal(presetScopeLabel({ kind: 'workspace', ref: 'wks-x' }, { 'workspace:wks-x': 'Platform' }), 'Only workspace Platform');
});

test('a name holding HTML renders as text with 0 injected elements', () => {
  const { document } = new JSDOM('').window;
  const list = renderPresetsList(document, [preset({ name: '<img src=x onerror="alert(1)">' })], { now: NOW });
  assert.equal(list.querySelectorAll('img').length, 0);
  assert.equal(list.querySelector('.preset-name').textContent, '<img src=x onerror="alert(1)">');
});
