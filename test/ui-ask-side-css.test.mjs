// test/ui-ask-side-css.test.mjs — Ask worca beside the page (Task 7): the side column's rules in the REAL style.css —
// it pushes in flow, covers the main column at 1080px, fills the width under the bar at 760px, honours reduced motion,
// moves the toasts only while it pushes, and spends tokens only.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { cssRules } from './helpers/css-rules.mjs';

const css = readFileSync(new URL('../ui/public/style.css', import.meta.url), 'utf8');
const ALL = cssRules(css);
const rule = (sel, media = '') => ALL.find((r) => r.sel === sel && r.media === media);
const decl = (r, prop) => {
  const m = r && r.body.match(new RegExp(`(?:^|;)\\s*${prop}\\s*:\\s*([^;]+)`));
  return m ? m[1].trim() : null;
};

test('the column pushes in flow beside main.main; the row holds them', () => {
  const side = rule('.ask-side');
  assert.equal(decl(side, 'width'), 'var(--ask-side-w,440px)');
  assert.equal(decl(side, 'position'), 'relative', 'in flow: it narrows the page');
  assert.equal(decl(side, 'flex'), 'none');
  assert.equal(decl(rule('.ask-side[hidden]'), 'display'), 'none');
  assert.equal(decl(rule('.main-row'), 'display'), 'flex');
  assert.equal(decl(rule('.main-row'), 'position'), 'relative', 'the 1080px tier covers the main column, not the page');
  assert.equal(decl(rule('.ask-side-in'), 'position'), 'relative', 'the chat page fills it (.chat-page is absolute, inset 0)');
  assert.ok(ALL.findIndex((r) => r.sel === '.ask-side' && !r.media) < ALL.findIndex((r) => r.sel === '.ask-side' && r.media === '@media (max-width:1080px)'), 'tiers below the base rule');
});

test('tier rules: over the main column at 1080px, full width under the bar at 760px; the grip only where it pushes', () => {
  const over = rule('.ask-side', '@media (max-width:1080px)');
  assert.deepEqual(['position', 'inset', 'width', 'z-index'].map((p) => decl(over, p)), ['absolute', '0 0 0 auto', '100%', '38']);
  assert.equal(decl(rule('.ask-side-grip', '@media (max-width:1080px)'), 'display'), 'none');
  const phone = rule('.ask-side', '@media (max-width:760px)');
  assert.deepEqual(['position', 'top', 'left', 'right', 'bottom'].map((p) => decl(phone, p)), ['fixed', '48px', 'auto', '0', '0'], 'anchored right: it grows from the right edge like the other tiers');
  assert.equal(decl(phone, 'height'), 'auto', "the base rule's height:100% would win over bottom:0 and push the composer 48px under the screen");
  assert.equal(decl(rule('.topnav-ask-label', '@media (max-width:1200px)'), 'display'), 'none', 'icon only on a phone, and up to 1200px');
  const toasts = rule('body.ask-side-open .toasts', '@media (min-width:1081px)');
  assert.equal(decl(toasts, 'right'), 'calc(var(--ask-side-w,440px) + 20px)', 'the toasts clear a pushing column only');
  assert.equal(decl(rule('body.ask-side-open.term-open .toasts', '@media (min-width:1081px)'), 'right'), 'calc(var(--ask-side-w,440px) + var(--term-w,460px) + 20px)');
  assert.equal(ALL.some((r) => r.sel.includes('ask-side-open') && r.sel.includes('.toasts') && r.media !== '@media (min-width:1081px)' && decl(r, 'right') !== null), false, 'the toasts move left only in the push tier');
  assert.equal(decl(rule('body.ask-side-open .toasts', '@media (max-width:1080px)'), 'bottom'), 'calc(var(--ask-side-dock-h,240px) + 12px + env(safe-area-inset-bottom,0px))',
    'where the column covers the page they clear its composer at its real height (ask-panel.mjs puts the docked strip\'s height on the body: 234px with the chip row, more as a draft grows)');
});

test('the button keeps the bar\'s page title readable: icon only up to 1200px and beside the terminal pane, with its label on wider windows', () => {
  for (const sel of ['.topnav-ask-label', 'body.term-open .topnav-ask-label']) {
    const media = sel.startsWith('body') ? '' : '@media (max-width:1200px)';
    assert.equal(decl(rule(sel, media), 'display'), 'none', sel);
  }
  for (const [sel, media] of [['.topnav-ask', '@media (max-width:1200px)'], ['body.term-open .topnav-ask', '']]) {
    assert.deepEqual(['min-width', 'padding', 'justify-content'].map((p) => decl(rule(sel, media), p)), ['32px', '0 8px', 'center'], sel);
  }
  assert.equal(ALL.some((r) => r.sel === '.topnav-ask-label' && r.media !== '@media (max-width:1200px)'), false, 'no other width hides it: above 1200px the label shows');
  assert.ok(ALL.findIndex((r) => r.sel === '.topnav-ask') < ALL.findIndex((r) => r.sel === '.topnav-ask' && r.media === '@media (max-width:1200px)'), 'below the base rule');
});

test('the column and its chats menu hold their shape: a flex column the chat page fills, the dropdown inside it', () => {
  const side = rule('.ask-side');
  assert.deepEqual(['display', 'flex-direction', 'overflow', 'height'].map((p) => decl(side, p)), ['flex', 'column', 'hidden', '100%']);
  assert.equal(decl(side, 'max-width'), '100%', 'never wider than its row: a wide terminal pane does not push Send under it (L12)');
  const inner = rule('.ask-side-in');
  assert.deepEqual(['position', 'flex', 'min-height', 'display', 'flex-direction'].map((p) => decl(inner, p)), ['relative', '1', '0', 'flex', 'column']);
  const menu = rule('.chat-page[data-host="dock"] .chat-history');
  assert.deepEqual(['position', 'top', 'right', 'left', 'z-index', 'width'].map((p) => decl(menu, p)), ['absolute', '46px', '8px', '8px', '6', 'auto']);
  const scrim = rule('.chat-page[data-host="dock"] .chat-scrim:not([hidden])');
  assert.deepEqual(['display', 'position', 'inset', 'z-index'].map((p) => decl(scrim, p)), ['block', 'absolute', '0', '5']);
});

test('motion: 320ms in and out, never under reduced motion', () => {
  assert.match(decl(rule('.ask-side.is-entering'), 'animation'), /^askSideIn \.32s cubic-bezier\(\.2,\.8,\.2,1\)$/);
  assert.match(decl(rule('.ask-side.is-entering .ask-side-in'), 'animation'), /\.08s both$/);
  assert.match(decl(rule('.ask-side.is-leaving'), 'animation'), /reverse both$/);
  const reduced = rule('.ask-side,.ask-side-in', '@media (prefers-reduced-motion:reduce)');
  assert.equal(decl(reduced, 'animation'), 'none !important');
  assert.match(css, /@keyframes askSideIn\{from\{width:0;\}\}/);
});

test('the dock look of the chat page: its own head, the History column as a dropdown under it, no hero', () => {
  assert.equal(decl(rule('.chat-page[data-host="dock"] .chat-history'), 'position'), 'absolute');
  assert.equal(decl(rule('.chat-page[data-host="dock"] .chat-history'), 'top'), '46px');
  assert.equal(decl(rule('.chat-page[data-host="dock"] .chat-head'), 'height'), '46px');
  assert.equal(decl(rule('.chat-page[data-host="dock"][data-view="home"] .chat-dock'), 'display'), 'block', 'the composer stays docked on home');
  assert.equal(decl(rule('.chat-page[data-host="dock"] .chat-convo'), 'container'), 'chat-convo / inline-size', 'the 520/420 composer trims apply (L15)');
  assert.equal(decl(rule('.chat-page[data-host="dock"] .chat-scrim:not([hidden])'), 'background'), 'transparent');
  const pop = rule('.chat-page[data-host="dock"][data-view="home"] .ask-composer > .ask-pop');
  assert.deepEqual([decl(pop, 'top'), decl(pop, 'bottom')], ['auto', 'calc(var(--ask-box-top) + 6px)'], 'the docked composer opens its menus upward even on home');
});

test('the row under the bar fills it and makes no stacking context (the column at z 38 competes with the terminal, scrim and drawer)', () => {
  const row = rule('.main-row');
  assert.deepEqual(['flex', 'min-width', 'min-height'].map((p) => decl(row, p)), ['1', '0', '0']);
  assert.doesNotMatch(row.body, /z-index|transform|filter|opacity|isolation|contain/);
});

test('the Chat page hides the column-only controls; the column hides the page-only ones; a thread hides the empty state', () => {
  assert.equal(decl(rule('.chat-page:not([data-host="dock"]) :is(.ask-side-thread,.ask-side-btn,.chat-history-foot,.ask-side-empty)'), 'display'), 'none');
  const hides = rule('.chat-page[data-host="dock"] :is(.chat-history-toggle,.chat-head > .ask-title,.chat-head-spacer,.chat-head > .chat-new-btn,.chat-home,.chat-panel)');
  assert.equal(decl(hides, 'display'), 'none');
  assert.equal(decl(rule('.chat-page[data-host="dock"][data-view="thread"] .ask-side-empty'), 'display'), 'none');
});

test('small column rules: the grip by touch, no selection while dragging, 32px suggestions, the caption on the right', () => {
  assert.equal(decl(rule('.ask-side-grip'), 'touch-action'), 'none', 'a touch drag is not taken for a pan');
  assert.equal(decl(rule('.ask-side.is-resizing'), 'user-select'), 'none');
  assert.equal(decl(rule('.ask-side-grip:is(:hover,:focus-visible)::after'), 'width'), '2px');
  assert.equal(decl(rule('.ask-side-opt'), 'min-height'), '32px', 'A5: a suggestion is a 32px control');
  assert.deepEqual([decl(rule('.chat-history-foot'), 'flex'), decl(rule('.chat-history-foot'), 'display')], ['none', 'flex']);
  assert.match(decl(rule('.chat-page[data-host="dock"] .chat-history'), 'max-height'), /^min\(520px,/);
  assert.match(decl(rule('.ask-side-empty'), 'padding'), /var\(--chat-dock-h,120px\)/);
  assert.equal(decl(rule('.ask-user-where'), 'align-self'), 'flex-end');
});

test('no hex, rgb or hsl colours in the new rules', () => {
  const mine = ALL.filter((r) => /ask-side|topnav-ask|main-row|ask-page-chip|ask-user-where|chat-history-foot|chat-history-in-chat|data-host/.test(r.sel));
  assert.ok(mine.length > 30, `${mine.length} rules`);
  for (const r of mine) assert.doesNotMatch(r.body, /#[0-9a-f]{3,8}\b|\brgba?\(|\bhsla?\(/i, r.sel);
});

// Task 8: the menu toggle while the column folds the menu (app.js sets body.ask-side-rail).
test('the menu toggle is out of the way while the column folds the menu', () => {
  assert.equal(decl(rule('body.ask-side-rail .side-toggle'), 'display'), 'none');
});
