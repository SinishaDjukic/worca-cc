// test/ui-control-skins.test.mjs — the browser's own controls, skinned.
//
// Covers the three halves of the change:
//   1. style.css skins the REAL <input> (appearance:none), which is what lets
//      every existing emitter keep its markup;
//   2. the four live toggles render as switches and the three lists as rows;
//   3. window.confirm / window.prompt have no call sites left — every dialog
//      goes through confirmModal() / promptModal().
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';
import { renderPluginList } from '../ui/public/plugins-view.mjs';
import { renderChatSettings } from '../ui/public/chat-settings-view.mjs';
import { renderStartStep } from '../ui/public/guardrails-view.mjs';

const read = (p) => readFileSync(fileURLToPath(new URL(p, import.meta.url)), 'utf8');
const css = read('../ui/public/style.css');
const html = read('../ui/public/index.html');
const appjs = read('../ui/public/app.js');

// ---------------------------------------------------------------- stylesheet

test('checkbox and radio are skinned on the real input, not a stand-in span', () => {
  const rule = css.match(/input\[type="checkbox"\],\s*\ninput\[type="radio"\]\{[^}]+\}/);
  assert.ok(rule, 'no shared checkbox/radio base rule');
  assert.match(rule[0], /appearance:none/, 'still letting the UA draw it');
  assert.match(rule[0], /-webkit-appearance:none/, 'Safari needs the prefix too');
  assert.match(rule[0], /border:1\.5px solid var\(--radio-ring\)/, 'not the .qopt hairline');
  // NOTHING may set display here: #mock and the two segmented radio groups are
  // [hidden], and a display declaration would override the UA rule and show them.
  assert.ok(!/display\s*:/.test(rule[0]), 'the base rule must not set display');
});

test('checked / indeterminate / locked-on all paint a glyph', () => {
  assert.match(css, /input\[type="checkbox"\]:checked\{[^}]*var\(--green\)[^}]*data:image\/svg\+xml/,
    'checked has no green fill + tick');
  assert.match(css, /input\[type="checkbox"\]:indeterminate\{[^}]*data:image\/svg\+xml/,
    'no mixed state');
  assert.match(css, /input\[type="radio"\]:checked\{[^}]*box-shadow:inset/,
    'radio dot should come from an inset shadow, not a pseudo-element');
  // :disabled uses the `background` shorthand, which drops the image :checked
  // painted — a locked-on box has to restate it or it renders blank.
  const locked = css.match(/input\[type="checkbox"\]:disabled:checked\{[^}]+\}/);
  assert.ok(locked, 'no locked-on rule');
  assert.match(locked[0], /data:image\/svg\+xml/, 'locked-on lost its tick');
  assert.match(locked[0], /var\(--seq\)/, 'locked-on should read as fixed (grey), not broken');
});

test('focus ring matches the rest of the app', () => {
  assert.match(css, /input\[type="checkbox"\]:focus-visible,\s*\ninput\[type="radio"\]:focus-visible\{outline:2px solid var\(--ink\)/);
});

test('accent-color nets anything never hand-skinned', () => {
  assert.match(css, /:root\{accent-color:var\(--green\);\}/);
});

test('markdown task lists keep their gap', () => {
  // the blanket margin:0 in the base rule would otherwise win on source order
  const base = css.indexOf('input[type="checkbox"],\ninput[type="radio"]{');
  const askMd = css.lastIndexOf('.ask-md input[type="checkbox"]{margin-right:6px;}');
  assert.ok(askMd > base, '.ask-md gap must be restated after the base rule');
});

test('a switch can be driven by a real checkbox', () => {
  assert.match(css, /\.sw-input:checked \+ \.switch\{background:var\(--green\)/);
  assert.match(css, /\.sw-input:checked \+ \.switch::after\{left:21px/);
  assert.match(css, /\.sw-input:focus-visible \+ \.switch\{outline:2px solid var\(--ink\)/);
  assert.match(css, /\.switch\.switch-sm\{/, 'no compact variant for dense rows');
  // the hand-mirrored .on emitters (#mock, autoscroll) must keep working
  assert.match(css, /\.switch\.on,\s*\n\.sw-input:checked \+ \.switch\{/);
});

test('.check-row beats `.field > label`, which used to claim it', () => {
  assert.match(css, /\.check-row\{[^}]*display:inline-flex/);
  assert.match(css, /\.field > label\.check-row,\s*\n\.field > label\.fanout-toggle\{[^}]*margin-bottom:0/);
  const fieldLabel = css.indexOf('.field > label,.field .label{');
  const override = css.indexOf('.field > label.check-row,');
  assert.ok(override > fieldLabel, 'equal specificity — the override must come later');
});

test('selectable rows and chips carry the selection themselves', () => {
  assert.match(css, /\.opt-row:has\(input:checked\)\{background:var\(--green-bg\)/);
  assert.match(css, /\.opt-row:has\(input:disabled\)/);
  assert.match(css, /\.chip-select label:has\(input:checked\)\{background:var\(--green-bg\)/);
  // .opt-row is appended AFTER .wiz-proj / .grv-source-row / .mvx-model, which it
  // ties with on specificity — source order is what lets it win.
  for (const base of ['.wiz-proj{', '.grv-source-row{', '.mvx-model{']) {
    assert.ok(css.indexOf('.opt-row{') > css.indexOf(base), `.opt-row must come after ${base}`);
  }
});

test('the last of the UA chrome is reset', () => {
  assert.match(css, /input\[type="number"\]::-webkit-inner-spin-button\{-webkit-appearance:none/);
  assert.match(css, /input\[type="number"\]\{-moz-appearance:textfield;\}/);
  assert.match(css, /input\[type="search"\]::-webkit-search-cancel-button/);
  assert.match(css, /\.disclosure > summary::-webkit-details-marker\{display:none/);
  assert.match(css, /\.disclosure\[open\] > summary::before\{transform:rotate\(90deg\)/);
  assert.match(css, /html\{scrollbar-color:/, 'Firefox never sees ::-webkit-scrollbar');
});

test('the reduced-motion block is still the last one in the file', () => {
  // style.css:3180 documents why; appending after it would silently break it.
  const last = css.lastIndexOf('@media (prefers-reduced-motion: reduce){');
  assert.ok(css.indexOf('.opt-row{') < last, 'the new section jumped the reduced-motion block');
});

// ------------------------------------------------------------------- markup

test('the confirm modal has a slot for prompt fields', () => {
  assert.ok(html.includes('id="confirm-fields"'), 'no #confirm-fields');
  // ...between the message and the opt-in checkbox
  assert.ok(html.indexOf('id="confirm-fields"') > html.indexOf('id="confirm-message"'));
  assert.ok(html.indexOf('id="confirm-fields"') < html.indexOf('id="confirm-checkbox-wrap"'));
});

test('plugin enable renders as a switch', () => {
  const doc = new JSDOM('<div></div>').window.document;
  const el = renderPluginList([{ name: 'telegram-chat', version: '1.0.0', enabled: true }], { doc });
  const cb = el.querySelector('input.pl-toggle');
  assert.ok(cb, 'the .pl-toggle hook app.js delegates on is gone');
  assert.ok(cb.classList.contains('sw-input'), 'not wired to the switch');
  // `+` only reaches the IMMEDIATE next sibling — the track must sit right after
  assert.ok(cb.nextElementSibling?.classList.contains('switch'), 'no .switch track after the input');
  assert.ok(cb.nextElementSibling.classList.contains('switch-sm'), 'card headers use the compact track');
  assert.ok(cb.getAttribute('aria-label'), 'a bare switch needs its own name');
});

test('chat notify + channel toggles render as switches', () => {
  const doc = new JSDOM('<div></div>').window.document;
  const el = renderChatSettings({
    prefs: { notify: {}, channels: {} },
    channels: [{ plugin: 'telegram-chat', channelId: 'team', platform: 'telegram', state: 'connected' }],
  }, { doc });
  for (const sel of ['input.chat-ev', 'input.chat-ch']) {
    const cb = el.querySelector(sel);
    assert.ok(cb, `${sel} missing`);
    assert.ok(cb.classList.contains('sw-input'), `${sel} not wired to the switch`);
    assert.ok(cb.nextElementSibling?.classList.contains('switch'), `${sel} has no track`);
  }
});

test('guardrails starting point renders as selectable rows', () => {
  const doc = new JSDOM('<div></div>').window.document;
  const el = renderStartStep([{ id: 'g1', name: 'Strict', origin: 'builtin' }], { doc });
  const row = el.querySelector('.grv-source-row');
  assert.ok(row, 'the .grv-source-row hook is gone');
  assert.ok(row.classList.contains('opt-row'), 'row does not carry the selection');
  assert.ok(row.querySelector('.opt-name'), 'the name needs .opt-name to truncate');
});

// ------------------------------------------------------------------ dialogs

test('no window.confirm / window.prompt call sites remain', () => {
  // Comments may still mention them; a CALL is what must be gone.
  const calls = appjs.match(/window\.(confirm|prompt)\s*\(/g) || [];
  assert.deepEqual(calls, [], `still calling ${calls.join(', ')}`);
});

test('promptModal exists and shares the confirm shell', () => {
  assert.match(appjs, /function promptModal\(/, 'no promptModal');
  assert.match(appjs, /function confirmModal\(/, 'confirmModal must keep its name — 11 callers');
  assert.match(appjs, /function modalShell\(/, 'the two should share one shell');
});

test('the destructive deletes ask in red', () => {
  // every confirmModal that deletes something passes danger:true
  for (const title of ['Delete pipeline', 'Delete workspace', 'Delete agent', 'Delete profile']) {
    const m = appjs.match(new RegExp(`title: '${title}',([\\s\\S]{0,120})`));
    assert.ok(m, `no confirmModal titled "${title}"`);
    assert.match(m[1], /danger: true/, `"${title}" is not tinted red`);
  }
});
