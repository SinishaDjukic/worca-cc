// test/ui-settings-index.test.mjs — the Settings / Add-ons catalogue behind the top bar search:
// every entry names a real tab/card in index.html with the same mode and Labs gate, and locks read the live state.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import { TABS, CARDS, UNLISTED_CARDS, SETTING_ENTRIES, ADDON_ENTRIES, locksFor, lockNote } from '../ui/public/settings-index.mjs';

const doc = new JSDOM(readFileSync(new URL('../ui/public/index.html', import.meta.url), 'utf8')).window.document;
const FORM_TABS = ['general', 'tags', 'runs', 'ask'];   // app.js SETTINGS_FORM_TABS: only these scroll to a card

test('every catalogued tab exists with the same mode, flag and name as its button; no tab is missing', () => {
  for (const t of TABS) {
    const b = doc.querySelector(`#settings-tabs button[data-tab="${t.id}"]`);
    assert.ok(b, `tab ${t.id}`);
    assert.equal(b.dataset.minLevel, t.min, `${t.id} min level`);
    assert.equal(b.dataset.flag || '', t.flag, `${t.id} flag`);
    assert.equal(b.textContent.trim(), t.title, `${t.id} title`);
  }
  const buttons = [...doc.querySelectorAll('#settings-tabs button[data-tab]')].map((b) => b.dataset.tab);
  assert.deepEqual(TABS.map((t) => t.id).sort(), buttons.sort(), 'no tab missing from the catalogue');
});

test('every catalogued card sits on its form tab with the same mode, flag and heading; every form-tab card is listed', () => {
  for (const c of CARDS) {
    const card = doc.getElementById(c.id);
    assert.ok(card, `card ${c.id}`);
    assert.equal(card.closest('.settings-pane').dataset.tab, c.tab, `${c.id} pane`);
    assert.equal(card.dataset.minLevel, c.min, `${c.id} min level`);
    assert.equal(card.dataset.flag || '', c.flag, `${c.id} flag`);
    // The card's h2; the root folder card has none, its first field's label names it.
    assert.equal((card.querySelector('h2') || card.querySelector('.label-row label')).textContent.trim(), c.title, `${c.id} heading`);
    assert.ok(FORM_TABS.includes(c.tab), `${c.id}: only form tabs scroll to a card`);
  }
  const onForms = [...doc.querySelectorAll('.settings-pane .settings-card')]
    .filter((n) => FORM_TABS.includes(n.closest('.settings-pane').dataset.tab)).map((n) => n.id);
  assert.deepEqual(onForms.filter((id) => !UNLISTED_CARDS.includes(id)).sort(), CARDS.map((c) => c.id).sort(),
    'a new Settings card is catalogued (with its alternative words) or named in UNLISTED_CARDS');
});

test('locks: a mode lock below the effective mode, a flag lock per Labs feature that is off; the note names both', () => {
  const presets = SETTING_ENTRIES.find((e) => e.id === 'tab:presets');
  assert.deepEqual(locksFor(presets, { level: 'simple', flags: {} }).map((l) => l.type), ['mode', 'flag']);
  assert.deepEqual(locksFor(presets, { level: 'advanced', flags: { runPresets: true } }), []);
  const budget = SETTING_ENTRIES.find((e) => e.id === 'card:budget-settings-card');
  assert.deepEqual(locksFor(budget, { level: 'simple', flags: {} }), []);
  const chat = SETTING_ENTRIES.find((e) => e.id === 'card:ask-settings-card');   // a Simple card on an Advanced tab
  assert.equal(locksFor(chat, { level: 'simple', flags: {} })[0].min, 'advanced');
  assert.equal(lockNote(locksFor(presets, { level: 'simple', flags: {} })), 'Switch to Advanced mode · Turn on Labs: Run presets');
  assert.deepEqual(locksFor(presets, {}).map((l) => l.type), ['flag'], 'no level given = Expert, nothing mode-locked');
  const labels = SETTING_ENTRIES.find((e) => e.id === 'card:labels-settings-card');   // its tab needs runTags too
  assert.deepEqual(locksFor(labels, { level: 'simple', flags: {} }).map((l) => l.key), ['runTags', 'runLabels']);
  assert.deepEqual(locksFor(labels, { level: 'simple', flags: { runTags: true } }).map((l) => l.key), ['runLabels']);
  assert.equal(lockNote(locksFor(labels, { level: 'simple', flags: {} })), 'Turn on Labs: Cost tags, Run labels');
  const debug = SETTING_ENTRIES.find((e) => e.id === 'card:debug-spawn-settings-card');
  assert.equal(lockNote(locksFor(debug, { level: 'advanced', flags: {} })), 'Switch to Expert mode');
});

test('add-ons are never locked and open their own page', () => {
  assert.deepEqual(ADDON_ENTRIES.map((e) => e.href), ['#marketplace', '#connectors', '#models', '#providers']);
  for (const e of ADDON_ENTRIES) assert.deepEqual(locksFor(e, { level: 'simple', flags: {} }), []);
});

test('hrefs: General is plain #settings, other tabs #settings/<tab>, cards #settings/<tab>/<card id>', () => {
  const h = (id) => SETTING_ENTRIES.find((e) => e.id === id).href;
  assert.equal(h('tab:general'), '#settings');
  assert.equal(h('tab:guardrails'), '#settings/guardrails');
  assert.equal(h('card:appearance-card'), '#settings/general/appearance-card');
  assert.equal(h('card:budget-settings-card'), '#settings/runs/budget-settings-card');
});
