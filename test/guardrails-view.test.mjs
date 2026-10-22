// test/guardrails-view.test.mjs — pure jsdom tests for the Guardrails-view renderers.
// No app.js boot: every renderer takes `doc` explicitly and returns detached DOM.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import {
  renderGuardrailList, renderGuardrailEditor, collectGuardrailEditor,
  renderStartStep, collectStartStep, renderGuardrailReferences409,
} from '../ui/public/guardrails-view.mjs';
import { checkRows } from './helpers/rows.mjs';

const doc = new JSDOM('<!doctype html><body></body>').window.document;

const USER_SET = {
  id: 'gr_org', name: 'Org Policy', origin: null,
  settings: {
    honorProjectSettings: true, envScrub: true, envAllowlist: ['NPM_TOKEN'],
    protectedPaths: ['.env*'], deny: ['Bash(curl:*)', 'Bash(nc:*)'],
  },
};
const BUILTIN = {
  id: 'secure', name: 'Strict', origin: 'builtin',
  settings: { honorProjectSettings: true, envScrub: true, envAllowlist: [], protectedPaths: ['.env*'], deny: ['Bash(curl:*)'] },
};

test('guardrail editor modes: create, edit and read-only view', async () => {
  await checkRows([
    { name: 'editor create mode: name input, Back control, "Create set" primary', run: async () => {
      const el = renderGuardrailEditor({ ...USER_SET, name: '' }, { doc, mode: 'create', dirty: true });
      assert.equal(el.dataset.mode, 'create');
      assert.ok(el.querySelector('.grv-name-input'), 'editable name');
      assert.ok(el.querySelector('.grv-back'), 'create shows a Back-to-step-1 control');
      assert.equal(el.querySelector('.grv-save').textContent, 'Create set');
      assert.equal(el.querySelector('.grv-save').disabled, false, 'dirty enables create');
    } },
    { name: 'editor edit mode: name input, no Back, "Save" primary, clean disables actions', run: async () => {
      const el = renderGuardrailEditor(USER_SET, { doc, mode: 'edit' });
      assert.equal(el.dataset.mode, 'edit');
      assert.equal(el.querySelector('.grv-name-input').value, 'Org Policy');
      assert.equal(el.querySelector('.grv-back'), null, 'edit has no Back');
      assert.equal(el.querySelector('.grv-save').textContent, 'Save');
      assert.equal(el.querySelector('.grv-save').disabled, true, 'clean');
      assert.equal(el.querySelector('.grv-discard').disabled, true);
      assert.deepEqual(
        [...el.querySelectorAll('.gr-list.gr-deny .gr-row .mono')].map((n) => n.textContent),
        ['Bash(curl:*)', 'Bash(nc:*)']);
    } },
    { name: 'editor view mode: static name + badge, read-only, "Save as new set" always enabled, no Discard', run: async () => {
      const el = renderGuardrailEditor(BUILTIN, { doc, mode: 'view' });
      assert.equal(el.dataset.mode, 'view');
      assert.equal(el.querySelector('.grv-name-input'), null, 'no name input');
      assert.equal(el.querySelector('.grv-name').textContent, 'Strict');
      assert.equal(el.querySelector('.grv-origin').textContent, 'built-in');
      assert.equal(el.querySelector('.grv-save').textContent, 'Save as new set');
      assert.equal(el.querySelector('.grv-save').disabled, false, 'always enabled');
      assert.equal(el.querySelector('.grv-discard'), null, 'no Discard in read-only view');
      assert.ok(el.querySelector('.gr-honor').classList.contains('disabled'), 'switch disabled');
      assert.equal(el.querySelector('.gr-honor').getAttribute('aria-disabled'), 'true', 'switch aria-disabled');
      assert.equal(el.querySelector('.gr-add'), null, 'read-only: no add-rows rendered');
      assert.equal(el.querySelectorAll('.gr-rm').length, 0, 'read-only: no remove buttons rendered');
    } },
  ]);
});

test('the editor\'s action row: an editable set has Cancel before Discard; a read-only view has no Cancel', () => {
  const edit = renderGuardrailEditor(USER_SET, { doc, mode: 'edit' });
  assert.deepEqual([...edit.querySelectorAll('.grv-editor-actions button')].map((b) => b.className.split(' ').pop()),
    ['grv-cancel', 'grv-discard', 'grv-save']);
  assert.equal(edit.querySelector('.grv-cancel').textContent, 'Cancel');
  assert.equal(edit.querySelector('.grv-cancel').disabled, false, 'Cancel is always live');
  const view = renderGuardrailEditor(BUILTIN, { doc, mode: 'view' });
  assert.equal(view.querySelector('.grv-cancel'), null);
});

test('collectGuardrailEditor round-trips the rendered editor', () => {
  const el = renderGuardrailEditor(USER_SET, { doc });
  assert.deepEqual(collectGuardrailEditor(el), { name: 'Org Policy', settings: USER_SET.settings });
  // and reads live DOM state: flip a switch class + type a name
  el.querySelector('.gr-scrub').classList.remove('on');
  el.querySelector('.grv-name-input').value = 'Renamed';
  const got = collectGuardrailEditor(el);
  assert.equal(got.name, 'Renamed');
  assert.equal(got.settings.envScrub, false);
});

test('guardrail list cards, start step and 409 reference rows render', async () => {
  await checkRows([
    { name: 'list cards: name, origin badge, summary, delegation hooks; built-ins get View and no Delete', run: () => {
      const el = renderGuardrailList([BUILTIN, USER_SET], { doc });
      const cards = el.querySelectorAll('.grv-card');
      assert.equal(cards.length, 2);
      assert.equal(cards[0].dataset.id, 'secure');
      assert.equal(cards[0].querySelector('.grv-name').textContent, 'Strict');
      assert.equal(cards[0].querySelector('.grv-origin').textContent, 'built-in');
      assert.equal(cards[0].querySelector('.grv-edit').title, 'View');
      assert.equal(cards[0].querySelector('.grv-edit').textContent, 'Details', 'open affordance is a Details button');
      assert.equal(cards[0].querySelector('.grv-delete'), null, 'built-ins are undeletable');
      assert.equal(cards[1].querySelector('.grv-origin').textContent, 'user');
      assert.equal(cards[1].querySelector('.grv-edit').dataset.id, 'gr_org');
      assert.equal(cards[1].querySelector('.grv-delete').dataset.id, 'gr_org');
      assert.match(cards[1].querySelector('.grv-summary').textContent, /2 deny · 1 paths · scrub on/);
      for (const c of cards) assert.ok(c.classList.contains('drow') && !c.classList.contains('card') && c.closest('.drows'), 'a divided row, not a card');
    } },
    { name: 'editor fields are divided rows: every .field is a .drow inside .drows, its control in .drow-control', run: () => {
      for (const mode of ['edit', 'view']) {
        const el = renderGuardrailEditor(USER_SET, { doc, mode });
        const fields = [...el.querySelectorAll('.field')];
        assert.equal(fields.length, 3, mode);
        for (const f of fields) {
          assert.ok(f.classList.contains('drow') && f.closest('.drows'), `${mode}: ${f.querySelector('label').textContent}`);
          assert.ok(f.querySelector(':scope > .drow-control .gr-list'), `${mode}: the list sits in .drow-control`);
        }
      }
    } },
    { name: 'start step renders Blank + sources and collectStartStep returns the checked one', run: async () => {
      await checkRows([
        { name: 'start step: Blank first + one row per source, built-in badge, Blank checked by default', run: async () => {
          const el = renderStartStep(
            [{ id: 'secure', name: 'Strict', origin: 'builtin' }, { id: 'gr_org', name: 'Org Policy', origin: null }],
            { doc });
          const rows = [...el.querySelectorAll('.grv-source-row')];
          assert.deepEqual(rows.map((r) => r.querySelector('.grv-source').value), ['', 'secure', 'gr_org']);
          assert.deepEqual(rows.map((r) => r.querySelector('.grv-source-name').textContent),
            ['Blank (custom)', 'Strict', 'Org Policy']);
          assert.ok(rows[1].querySelector('.badge'), 'built-in badge on the built-in row');
          assert.equal(rows[2].querySelector('.badge'), null, 'no badge on the user row');
          assert.equal(el.querySelector('.grv-source:checked').value, '', 'Blank checked by default');
          assert.equal(el.querySelector('.grv-source-list').getAttribute('role'), 'radiogroup');
          assert.ok(el.querySelector('.grv-next') && el.querySelector('.grv-cancel'));
        } },
        { name: 'collectStartStep returns the checked value and honors selectedId', run: async () => {
          const el = renderStartStep([{ id: 'secure', name: 'Strict', origin: 'builtin' }], { doc, selectedId: 'secure' });
          assert.equal(el.querySelector('.grv-source:checked').value, 'secure');
          assert.equal(collectStartStep(el), 'secure');
        } },
      ]);
    } },
    { name: 'renderGuardrailReferences409 flattens the referencing list into mono rows', run: () => {
      const el = renderGuardrailReferences409(
        [{ id: 'gr_org', referencedBy: ['pipeline p1', 'pipeline p2'] }], { doc });
      assert.match(el.querySelector('.hint').textContent, /still referenced/);
      assert.deepEqual([...el.querySelectorAll('.gr-row .mono')].map((n) => n.textContent),
        ['pipeline p1', 'pipeline p2']);
    } },
  ]);
});
