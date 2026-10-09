// test/ui-inherit-field.test.mjs — the one inherit/override field (plans/cascading-settings-design.md §6, §8 test 11):
// an empty field says what it inherits and from where; an override shows a Project badge and a clear control.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { inheritText, inheritedOf, renderInheritField, readInheritField, readDirtyFields, formatPair } from '../ui/public/inherit-field.mjs';
import { renderNightForm } from '../ui/public/night-mode-form.mjs';
import { NIGHT_DEFAULTS } from '../src/core/night/config.mjs';

const doc = () => new JSDOM('<!doctype html><div id="root"></div>').window.document;
const CATALOG = [
  { id: 'claude-opus-5-5', label: 'Opus 5.5', engine: 'claude', efforts: ['medium', 'high', 'xhigh', 'max'] },
  { id: 'gpt-5.5', label: 'GPT-5.5', engine: 'codex', efforts: ['minimal', 'low', 'medium', 'high'] },
  { id: 'gpt-5.6-sol', label: 'GPT-5.6 Sol', engine: 'codex', efforts: ['minimal', 'low', 'medium', 'high'] },
];

test('inheritText and inheritedOf name the layer an empty field falls back to', () => {
  assert.equal(inheritText('user', 'Opus'), 'Opus (your setting)');
  assert.equal(inheritText('team', '12'), '12 (team default)');
  assert.equal(inheritText('default', '400'), '400 (default)');
  assert.equal(inheritText(undefined, null), 'Same as my settings');
  assert.deepEqual(inheritedOf({ project: 9, user: 30, team: 12, default: 400 }), { value: 30, source: 'user' });
  assert.deepEqual(inheritedOf({ team: 12, default: 400 }), { value: 12, source: 'team' });
  assert.deepEqual(inheritedOf({ user: 30, default: 400 }, { level: 'user' }), { value: 400, source: 'default' }, 'your own value is not inherited at your level');
  assert.equal(formatPair({ model: 'gpt-5.5', effort: 'low' }, CATALOG), 'GPT-5.5 · low');
  assert.equal(formatPair(undefined, CATALOG, "the workflow's model"), "the workflow's model");
});

test('number field: inherit placeholder; an override shows the badge; Clear returns it to inherit', () => {
  const d = doc();
  const f = renderInheritField(d, { id: 'askMaxTurns', label: 'Turn limit', kind: 'number', level: 'project', own: undefined, inherited: { value: 30, source: 'user' } });
  const input = f.querySelector('.inherit-input');
  assert.equal(input.value, '');
  assert.equal(input.placeholder, '30 (your setting)');
  assert.equal(f.querySelector('.inherit-badge').hidden, true);
  assert.equal(readInheritField(f), null);
  const o = renderInheritField(d, { id: 'askMaxTurns', label: 'Turn limit', kind: 'number', level: 'project', own: 9, inherited: { value: 12, source: 'team' } });
  assert.equal(o.querySelector('.inherit-input').value, '9');
  assert.equal(o.querySelector('.inherit-input').placeholder, '12 (team default)');
  assert.equal(o.querySelector('.inherit-badge').hidden, false);
  assert.equal(o.querySelector('.inherit-badge').textContent, 'Project');
  assert.equal(readInheritField(o), 9);
  const root = d.getElementById('root'); root.append(f, o);
  assert.deepEqual(readDirtyFields(root), {}, 'nothing touched, nothing sent');
  o.querySelector('.inherit-clear').click();
  assert.equal(o.querySelector('.inherit-input').value, '');
  assert.equal(o.querySelector('.inherit-badge').hidden, true);
  assert.deepEqual(readDirtyFields(root), { askMaxTurns: null });
});

test('a select whose own value is null (the API\'s "not set") shows the inherited choice, not a blank', () => {
  const eng = renderInheritField(doc(), { id: 'run.engine', label: 'Default engine', kind: 'select', level: 'user', own: null,
    inherited: { value: 'claude', source: 'default' }, options: [{ value: 'claude', label: 'Claude' }, { value: 'codex', label: 'Codex' }] });
  const sel = eng.querySelector('.inherit-input');
  assert.equal(sel.selectedIndex, 0);
  assert.equal(sel.value, '');
  assert.equal(readInheritField(eng), null);
  assert.equal(eng.querySelector('.inherit-clear').hidden, true, 'nothing set, nothing to clear');
});

test('select field and model field: options, inheritance text, effort follows the picked model', () => {
  const d = doc();
  const eng = renderInheritField(d, { id: 'run.engine', label: 'Default engine', kind: 'select', level: 'project', own: undefined,
    inherited: { value: 'codex', source: 'user' }, options: [{ value: 'claude', label: 'Claude' }, { value: 'codex', label: 'Codex' }], format: (v) => ({ claude: 'Claude', codex: 'Codex' })[v] });
  assert.equal(eng.querySelector('.inherit-input option').textContent, 'Codex (your setting)');
  const m = renderInheritField(d, { id: 'models.codex.steps.planner', label: 'Plan', kind: 'model', level: 'project', engine: 'codex', catalog: CATALOG,
    efforts: ['minimal', 'low', 'medium', 'high'], own: undefined, inherited: { value: { model: 'gpt-5.5', effort: 'low' }, source: 'user' } });
  const sel = m.querySelector('.inherit-model');
  assert.deepEqual([...sel.options].map((o) => o.value), ['', 'gpt-5.5', 'gpt-5.6-sol'], 'only the engine\'s models');
  assert.equal(sel.options[0].textContent, 'GPT-5.5 (your setting)', 'the Model names the model only');
  assert.equal(m.querySelector('.inherit-effort').options[0].textContent, 'low (your setting)', 'the Effort says its own');
  sel.value = 'gpt-5.6-sol';
  sel.dispatchEvent(new d.defaultView.Event('change', { bubbles: true }));
  const eff = m.querySelector('.inherit-effort');
  assert.deepEqual([...eff.options].map((o) => o.value), ['', 'minimal', 'low', 'medium', 'high']);
  eff.value = 'high';
  eff.dispatchEvent(new d.defaultView.Event('change', { bubbles: true }));
  assert.deepEqual(readInheritField(m), { model: 'gpt-5.6-sol', effort: 'high' });
  assert.equal(m.dataset.dirty, '1');
  assert.equal(m.querySelector('.inherit-badge').hidden, false);
});

test('the Away mode form takes its inherit text from the shared field', () => {
  const d = doc();
  const root = d.getElementById('root');
  renderNightForm(root, { level: 'project', values: {}, effective: NIGHT_DEFAULTS, sources: {},
    inherited: { config: { ...NIGHT_DEFAULTS, maxDecisions: 7 }, sources: { maxDecisions: 'team', graceMinutes: 'default', strategy: 'user' } }, toggle: 'auto', now: 0 });
  assert.equal(root.querySelector('.night-num[data-field="maxDecisions"]').placeholder, '7 (team default)');
  assert.equal(root.querySelector('.night-num[data-field="graceMinutes"]').placeholder, '30 (default)');
  assert.match(root.querySelector('.night-strategy option').textContent, / \(your setting\)$/);
});

test('a select lists the inherited value once: "Codex (your setting)" stands for Codex, unless Codex is pinned here', () => {
  const d = doc();
  const spec = (own) => ({ id: 'run.engine', label: 'Default engine', kind: 'select', level: 'project', own,
    inherited: { value: 'codex', source: 'user' }, options: [{ value: 'claude', label: 'Claude' }, { value: 'codex', label: 'Codex' }], format: (v) => ({ claude: 'Claude', codex: 'Codex' })[v] });
  const values = (f) => [...f.querySelectorAll('.inherit-input option')].map((o) => o.value);
  assert.deepEqual(values(renderInheritField(d, spec(undefined))), ['', 'claude']);
  const pinned = renderInheritField(d, spec('codex'));
  assert.deepEqual(values(pinned), ['', 'claude', 'codex'], 'a pinned value still shows');
  assert.equal(pinned.querySelector('.inherit-input').value, 'codex');
});
