// test/guardrails-view.test.mjs — pure jsdom tests for the Guardrails-view renderers.
// No app.js boot: every renderer takes `doc` explicitly and returns detached DOM.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import {
  guardrailSummary, renderGuardrailList, renderGuardrailEditor, collectGuardrailEditor,
  renderCreateDialog, collectCreateDialog, renderGuardrailReferences409,
} from '../ui/public/guardrails-view.mjs';

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

test('guardrailSummary counts the raw 5-key lists', () => {
  assert.equal(guardrailSummary(USER_SET.settings), '2 deny · 1 paths · scrub on');
  assert.equal(guardrailSummary({ deny: [], protectedPaths: [], envScrub: false }), '0 deny · 0 paths · scrub off');
});

test('list cards: name, origin badge, summary, delegation hooks; built-ins get View and no Delete', () => {
  const el = renderGuardrailList([BUILTIN, USER_SET], { doc });
  const cards = el.querySelectorAll('.grv-card');
  assert.equal(cards.length, 2);
  assert.equal(cards[0].dataset.id, 'secure');
  assert.equal(cards[0].querySelector('.grv-name').textContent, 'Strict');
  assert.equal(cards[0].querySelector('.grv-origin').textContent, 'built-in');
  assert.equal(cards[0].querySelector('.grv-edit').title, 'View');
  assert.ok(cards[0].querySelector('.grv-edit .chev'), 'open affordance is a chevron');
  assert.equal(cards[0].querySelector('.grv-delete'), null, 'built-ins are undeletable');
  assert.equal(cards[1].querySelector('.grv-origin').textContent, 'user');
  assert.equal(cards[1].querySelector('.grv-edit').dataset.id, 'gr_org');
  assert.equal(cards[1].querySelector('.grv-delete').dataset.id, 'gr_org');
  assert.match(cards[1].querySelector('.grv-summary').textContent, /2 deny · 1 paths · scrub on/);
});

test('editor: user set renders a name input, switches, three row editors, Save disabled while clean', () => {
  const el = renderGuardrailEditor(USER_SET, { doc });
  assert.equal(el.dataset.id, 'gr_org');
  assert.equal(el.querySelector('.grv-name-input').value, 'Org Policy');
  assert.ok(el.querySelector('.gr-honor').classList.contains('on'));
  assert.ok(el.querySelector('.gr-scrub').classList.contains('on'));
  assert.deepEqual(
    [...el.querySelectorAll('.gr-list.gr-deny .gr-row .mono')].map((n) => n.textContent),
    ['Bash(curl:*)', 'Bash(nc:*)']);
  assert.equal(el.querySelector('.gr-list.gr-deny .gr-row .gr-rm').dataset.value, 'Bash(curl:*)');
  assert.equal(el.querySelector('.gr-add[data-list="gr-allow"] input').placeholder, 'NPM_TOKEN');
  assert.equal(el.querySelector('.grv-save').disabled, true);
  assert.equal(el.querySelector('.grv-save').textContent, 'Save');
  assert.equal(el.querySelector('.grv-discard').disabled, true);
});

test('editor: built-in renders static name + badge, "Save as new set" label; dirty enables actions and paints msg', () => {
  const el = renderGuardrailEditor(BUILTIN, { doc, dirty: true, msg: 'boom', msgErr: true });
  assert.equal(el.querySelector('.grv-name-input'), null, 'no name input on built-ins');
  assert.equal(el.querySelector('.grv-name').textContent, 'Strict');
  assert.equal(el.querySelector('.grv-save').textContent, 'Save as new set');
  assert.equal(el.querySelector('.grv-save').disabled, false);
  assert.equal(el.querySelector('.grv-msg').textContent, 'boom');
  assert.ok(el.querySelector('.grv-msg').classList.contains('err'));
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

test('create dialog: sources + blank option, collect, and the hideFrom variant', () => {
  const el = renderCreateDialog([{ id: 'normal', name: 'Normal' }, { id: 'gr_org', name: 'Org Policy' }], { doc });
  const opts = [...el.querySelectorAll('.grv-create-from option')].map((o) => [o.value, o.textContent]);
  assert.deepEqual(opts, [['', 'Blank (permissive)'], ['normal', 'Normal'], ['gr_org', 'Org Policy']]);
  el.querySelector('.grv-create-name').value = 'New Set';
  el.querySelector('.grv-create-from').value = 'gr_org';
  assert.deepEqual(collectCreateDialog(el), { name: 'New Set', from: 'gr_org' });
  const hidden = renderCreateDialog([{ id: 'normal', name: 'Normal' }], { doc, hideFrom: true });
  assert.equal(hidden.querySelector('.grv-create-from'), null, 'start-from suppressed');
  assert.deepEqual(collectCreateDialog(hidden), { name: '', from: '' });
});

test('renderGuardrailReferences409 flattens the referencing list into mono rows', () => {
  const el = renderGuardrailReferences409(
    [{ id: 'gr_org', referencedBy: ['pipeline p1', 'pipeline p2'] }], { doc });
  assert.match(el.querySelector('.hint').textContent, /still referenced/);
  assert.deepEqual([...el.querySelectorAll('.gr-row .mono')].map((n) => n.textContent),
    ['pipeline p1', 'pipeline p2']);
});
