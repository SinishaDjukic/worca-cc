// test/ui-run-presets-view.test.mjs — Settings › Presets (ui/public/run-presets-view.mjs): empty state, cards, the
// callbacks, the gone badge, and a name holding HTML rendering as text.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import { renderPresetsList, presetScopeLabel, PRESETS_EMPTY_TEXT } from '../ui/public/run-presets-view.mjs';

const NOW = Date.parse('2026-10-16T12:00:00Z');
const preset = (over = {}) => ({ id: 'rp_aaaaaaaaaaaa', name: 'Quick fix', scope: { kind: 'global', ref: null },
  setup: { workflowId: 'wf_default', engine: 'codex' }, updatedAt: '2026-10-14T12:00:00Z', ...over });

test('0 presets show the empty state text', () => {
  const { document } = new JSDOM('').window;
  assert.equal(renderPresetsList(document, []).textContent, PRESETS_EMPTY_TEXT);
  assert.equal(PRESETS_EMPTY_TEXT, 'No presets yet. Set up a run in New run, then use Preset ▾ › Save as preset');
});

test('a card names the preset, its scope, workflow and engine; each button calls back with the preset', () => {
  const { document } = new JSDOM('').window;
  const calls = [];
  const cb = (act) => (p) => calls.push([act, p.id]);
  const list = renderPresetsList(document, [preset(), preset({ id: 'rp_bbbbbbbbbbbb', name: 'Pinned', scope: { kind: 'project', ref: 'api-1' } })], {
    names: { 'project:api-1': 'api' }, workflowNames: { wf_default: 'Default' }, now: NOW,
    onUse: cb('use'), onRename: cb('rename'), onDuplicate: cb('duplicate'), onEditScope: cb('scope'), onDelete: cb('delete'),
  });
  const cards = list.querySelectorAll('.preset-card');
  assert.equal(cards.length, 2);
  assert.ok(list.classList.contains('drows'));
  for (const c of cards) assert.ok(c.classList.contains('drow') && !c.classList.contains('card'), 'a divided row, not a card');
  assert.match(cards[0].textContent, /Quick fix.*Any project.*Default · Codex · Updated 2 d ago/);
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

test('the meta line names the workflow and engine: Auto workflow, a muted Workflow removed, no wf_ or raw engine id', () => {
  const { document } = new JSDOM('').window;
  const list = renderPresetsList(document, [
    preset({ id: 'rp_1', setup: { workflowId: 'wf_auto', engine: 'codex' } }),
    preset({ id: 'rp_2', setup: { workflowId: 'wf_gone99', engine: 'claude' } }),
    preset({ id: 'rp_3', setup: { workflowId: 'wf_x1', engine: 'copilot' } }),
    preset({ id: 'rp_4', setup: { workflowId: 'wf_default', engine: 'cursor' } }),
  ], { workflowNames: { wf_default: 'Default', wf_x1: 'Bug triage' }, now: NOW });
  const metas = [...list.querySelectorAll('.preset-meta')].map((m) => m.textContent);
  assert.deepEqual(metas, ['Auto workflow · Codex · Updated 2 d ago', 'Workflow removed · Claude · Updated 2 d ago',
    'Bug triage · Copilot · Updated 2 d ago', 'Default · Cursor · Updated 2 d ago']);
  assert.ok(list.querySelector('[data-preset="rp_2"] .preset-wf').classList.contains('muted'));
  assert.ok(!list.querySelector('[data-preset="rp_1"] .preset-wf').classList.contains('muted'));
  assert.doesNotMatch(list.textContent, /wf_|\b(claude|codex|copilot|cursor)\b/);
});

test('style.css dims a muted workflow label on the card meta line', () => {
  const css = readFileSync(new URL('../ui/public/style.css', import.meta.url), 'utf8');
  assert.match(css, /\.preset-meta \.preset-wf\.muted\{color:var\(--ink-3\);\}/);
});

test('with no workflow list the meta line names only the engine', () => {
  const { document } = new JSDOM('').window;
  const list = renderPresetsList(document, [preset({ setup: { workflowId: 'wf_x1', engine: 'codex' } })], { workflowNames: null, now: NOW });
  assert.equal(list.querySelector('.preset-meta').textContent, 'Codex · Updated 2 d ago');
});
