// test/ui-pr-controls.test.mjs — one look for every pull request control (docs/design-system.md, "PR controls"): Create PR
// and Push are primary, View PR is secondary, every one is a .btn led by an icons.mjs glyph, none is full width, and the
// run page's button sits in the card's head beside the status.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import { ICONS } from '../ui/public/icons.mjs';
import { syncActions } from '../ui/public/run-status-card.mjs';
import { HEAD_ACTIONS, MENU_ACTIONS } from '../src/shared/run-model.mjs';
import { renderShipItStrip } from '../ui/public/actions-view.mjs';

const read = (p) => readFileSync(new URL(`../ui/public/${p}`, import.meta.url), 'utf8');
const html = read('index.html');
const css = read('style.css').replace(/\/\*[\s\S]*?\*\//g, '');
/** Every declaration block whose selector list names `sel` exactly, joined. */
const decls = (sel) => [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)]
  .filter((m) => m[1].split(',').map((s) => s.trim()).includes(sel)).map((m) => m[2]).join(';');
/** The icons.mjs glyph a control leads with (its first child, an .ic span); '' when none. */
function glyphOf(el) {
  const svg = el && el.firstElementChild && el.firstElementChild.matches('.ic') ? el.firstElementChild.querySelector('svg') : null;
  return svg ? Object.keys(ICONS).find((k) => ICONS[k] === svg.innerHTML) || '' : '';
}
const doc = () => new JSDOM('<!doctype html><body></body>').window.document;

test('slice 3: the card head holds the head buttons with the one PR slot, then the tracker; no PR bar, in both templates', () => {
  const page = new JSDOM(html).window.document;
  for (const id of ['run-detail-tpl', 'hist-detail-tpl']) {
    const tpl = page.getElementById(id).content;
    assert.equal(tpl.querySelectorAll('.rd-pr-slot').length, 1, `${id}: one slot`);
    const acts = tpl.querySelectorAll('.rd-sheet-head > .rd-head-acts');
    assert.equal(acts.length, 1, `${id}: one head host in .rd-sheet-head`);
    const slot = acts[0].querySelector(':scope > .rd-pr-slot');
    assert.ok(slot, `${id}: the slot is in .rd-head-acts`);
    assert.ok(slot.hasAttribute('data-needs-git'), `${id}: the slot hides with git off`);
    assert.ok(tpl.querySelector('.rd-sheet-head > .rd-pr-feed[hidden]'), `${id}: the hidden PR status feed`);
    const head = tpl.querySelector('.rd-sheet-head');
    assert.ok(head.nextElementSibling.matches('.rd-track'), `${id}: the tracker follows the head`);
    assert.equal(tpl.querySelectorAll('.rd-track').length, 1, `${id}: one tracker`);
    assert.equal(tpl.querySelector('.rd-pr-box'), null, `${id}: no PR bar`);
  }
  const live = page.getElementById('run-detail-tpl').content.querySelector('.rd-sheet-head > .rd-head-acts');
  assert.ok(live.previousElementSibling.matches('.rd-live-row'), 'the head buttons come after the Live view row');
});

test('the head lays the buttons out after the live row, and under the status in a narrow card', () => {
  assert.match(decls('.rd-sheet-head'), /grid-template-columns:minmax\(0,1fr\) auto auto/);
  assert.match(decls('.rd-sheet-head > .rd-head-acts'), /grid-area:1 \/ 3/);
  assert.match(css, /@container rd-head \(max-width:420px\)\{[^@]*\.rd-sheet-head > \.rd-head-acts\{grid-area:2 \/ 1 \/ 3 \/ -1;justify-self:start;/);
  assert.match(decls('.rd-pr-slot'), /width:fit-content/);
  assert.doesNotMatch(decls('.rd-pr-wait'), /width:100%/, 'the placeholder takes the button\'s natural size');
  assert.doesNotMatch(css, /rd-pr-fold/, 'the no-button exit fades in place');
  assert.doesNotMatch(css, /\[data-rd-cta\]\{border-radius/, 'the dead PR-box corner rule is gone');
  assert.doesNotMatch(css, /\.rd-pr-box/, 'no PR bar rules');
});

test('no PR control is full width, and the CTA glyphs come from icons.mjs', () => {
  for (const f of ['app.js', 'chat/run-card.mjs', 'run-status-card.mjs']) assert.doesNotMatch(read(f), /btn-block/, f);
  assert.doesNotMatch(read('app.js'), /CTA_ICONS|rd-cta-ico/);
  assert.ok(Object.hasOwn(ICONS, 'pr-create'));
  assert.doesNotMatch(read('app.js'), /Push the source branch/, 'Push says the header\'s "Push <branch>"');
});

test('facts: a quiet button that opens a value sits on the value column (.btn-sm padding + border)', () => {
  const sm = decls('.btn-sm');
  const pad = Number(/padding:\d+(?:px)? (\d+)px/.exec(sm)[1]);
  assert.equal(pad, 10, '.btn-sm horizontal padding');
  assert.match(decls('.rd-kv-v > .btn-sm.btn-quiet:first-child'), new RegExp(`margin-inline-start:-${pad + 1}px`));
});

test('History Details header: View PR is a secondary .btn, the old pill is gone', () => {
  const page = new JSDOM(html).window.document;
  const tpl = page.getElementById('hist-detail-tpl').content;
  const link = tpl.querySelector('a.hd-pr-link');
  assert.ok(link.classList.contains('btn') && !link.classList.contains('btn-primary'));
  for (const sel of ['.hd-pr', '.hd-push']) assert.ok(tpl.querySelector(`button${sel}.btn.btn-primary`), sel);
  assert.doesNotMatch(decls('.hd-pr-link'), /padding|border|background|font/);
  assert.equal(decls('.hd-pr-link.merged'), '');
  assert.equal(decls('.hd-pr-link:focus-visible'), '', '.btn has the focus ring');
});

test('bar buttons: Create PR is primary with pr-create, View PR secondary with pull-request, both 14px', () => {
  const d = doc();
  for (const [id, glyph, primary] of [['ship', 'pr-create', true], ['open-pr', 'pull-request', false]]) {
    const host = d.createElement('div');
    syncActions(host, { actions: [id] });
    const b = host.querySelector(`[data-model-action="${id}"]`);
    assert.ok(b.classList.contains('btn') && b.classList.contains('btn-sm'), id);
    assert.equal(b.classList.contains('btn-primary'), primary, id);
    assert.equal(glyphOf(b), glyph, id);
    assert.equal(b.firstElementChild.style.width, '14px', id);
    syncActions(host, { actions: [id] });
    assert.equal(b.querySelectorAll('.ic').length, 1, `${id}: a repaint keeps one glyph`);
  }
});

test('slice 3: the run page bar skips the head actions, so it makes no Create PR or View PR', () => {
  const d = doc();
  for (const actions of [['ship'], ['open-pr'], ['retry', 'report'], ['open-pr', 'ask-changes']]) {
    const host = d.createElement('div');
    syncActions(host, { actions }, { skip: [...MENU_ACTIONS, ...HEAD_ACTIONS] });
    assert.equal(host.querySelectorAll('[data-model-action]').length, 0, actions.join());
  }
});

test('PR text links are --blue-ink-strong at weight 600', () => {
  for (const sel of ['.rd-prs-link', '.rd-track-pr', '.chat-rc-watch-pr', '.ask-prcard-link', '.ask-shipcard-pr', '.hd-pr-repo-link']) {
    const d = decls(sel);
    assert.match(d, /color:var\(--blue-ink-strong\)/, sel);
    assert.match(d, /font-weight:600/, sel);
    assert.doesNotMatch(d, /font-weight:400|--green-ink/, sel);
  }
  assert.equal(decls('.hd-pr-repo-link.merged'), '', 'a merged repo link is not greyed');
});

test('Ship it dialog, Try it first: Check out is a secondary small button', () => {
  const row = renderShipItStrip({ finished: true, members: [{ projectKey: 'p', branch: 'b' }] }, { doc: doc() });
  const b = [...row.querySelectorAll('button')].find((x) => x.textContent === 'Check out');
  assert.equal(b.className, 'btn btn-sm');
});
