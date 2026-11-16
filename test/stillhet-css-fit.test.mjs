// test/stillhet-css-fit.test.mjs — Stillhet's CSS fits real data (B5.2): the bar rows are one line at 32px on a fine
// pointer and keep their larger target on touch (list.bar-row-size), the unread dot exists for B7.2's markup, and each
// overflow fix holds. A text test: jsdom applies no stylesheet, so the rules themselves are pinned.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { cssRules } from './helpers/css-rules.mjs';

const RAIL = cssRules(readFileSync('ui/public/stillhet/css/stillhet.css', 'utf8'));
const SHELL = cssRules(readFileSync('ui/public/stillhet/shell/shell.css', 'utf8'));
const norm = (s) => s.replace(/\s*,\s*/g, ',').replace(/\s+/g, ' ').trim();
/** The first rule whose normalised selector matches, optionally only under a media head that matches. */
const ruleFor = (rules, selectorRe, { media } = {}) => rules.find((r) => selectorRe.test(norm(r.sel)) && (!media || media.test(r.media)));
const has = (body, prop, value) => new RegExp(`(^|;)\\s*${prop}:\\s*${value.replace(/[()[\]+.*?^$|\\]/g, '\\$&')}\\s*(;|$)`).test(body.trim());

test('T-7 / V1-01: bar home and Chat bar rails are 28px on a fine pointer', () => {
  const r = ruleFor(SHELL, /^:is\(\.bar-list,\.bar-back\) \.lr-rail$/, { media: /pointer:\s*fine/ });
  assert.ok(r, 'one shared fine-pointer rail rule');
  assert.ok(has(r.body, 'height', '28px'), r.body);
});

test('T-7: no unscoped bar rail height remains', () => {
  const loose = SHELL.filter((r) => /\.bar-(list|back)\) ?\.lr-rail$|\.bar-(list|back) \.lr-rail$/.test(norm(r.sel)) && /(^|;)\s*height:/.test(r.body) && !/pointer:/.test(r.media));
  assert.deepEqual(loose.map((r) => `${r.line}: ${r.sel}`), []);
});

test("T-7: bar home ends line up like the Chat bar's", () => {
  const r = SHELL.find((x) => /(^|,)\s*(\.bar-back \.lr-end|:is\(\.bar-list,\.bar-back\) \.lr-end)$/.test(norm(x.sel)) && !x.media);
  assert.ok(r, 'a bar-back .lr-end rule');
  assert.ok(has(r.body, 'padding-top', '5px'), r.body);
});

test('T-7 touch: no fine-pointer bar rule leaks to coarse', () => {
  for (const r of [...SHELL, ...RAIL].filter((x) => /pointer:\s*coarse/.test(x.media) && /\.lr-rail/.test(x.sel))) {
    const h = /(?:^|;)\s*height:\s*(\d+)px/.exec(r.body);
    assert.ok(!h || +h[1] >= 40, `${r.line}: ${r.sel} sets ${h?.[1]}px on touch`);
  }
  // the 28px rail is only ever drawn under a fine pointer
  for (const r of SHELL.filter((x) => /\.lr-rail$/.test(norm(x.sel)) && /(^|;)\s*height:\s*28px/.test(x.body))) assert.match(r.media, /pointer:\s*fine/, `${r.line}: ${r.sel}`);
});

test('T-7 touch: on the 40px rail the title, the end and the current fill line up with the mark (both bars)', () => {
  const touch = /pointer:\s*coarse/;
  const main = ruleFor(SHELL, /^:is\(\.bar-list,\.bar-back\) \.lr-main$/, { media: touch });
  assert.ok(main, 'a touch .lr-main rule for both bars');
  assert.ok(has(main.body, 'padding-top', '9px') && has(main.body, 'padding-bottom', '9px'), main.body);
  const end = ruleFor(SHELL, /^:is\(\.bar-list,\.bar-back\) \.lr-end$/, { media: touch });
  assert.ok(end && has(end.body, 'padding-top', '11px'), end?.body);
  const fold = ruleFor(SHELL, /^\.bar-list \.lr-end:has\(> \[data-fold\]\)$/, { media: touch });
  assert.ok(fold && has(fold.body, 'padding-top', '8px'), fold?.body);
  const fill = ruleFor(SHELL, /^\.bar-list \.list-row\.is-current > \.lr-main::after$/, { media: touch });
  assert.ok(fill && has(fill.body, 'height', '40px'), fill?.body);
  // later in the file than the unscoped rules it overrides (same specificity)
  const base = ruleFor(SHELL, /^\.bar-list \.list-row\.is-current > \.lr-main::after$/);
  assert.ok(fill.line > base.line, `touch fill at ${fill.line} must follow ${base.line}`);
});

test('T-3: .lr-unread is a 6px round dot in Advisory ink', () => {
  const r = ruleFor(RAIL, /^\.lr-unread$/);
  assert.ok(r, 'a .lr-unread rule');
  for (const [p, v] of [['width', '6px'], ['height', '6px'], ['border-radius', '50%'], ['background', 'var(--advisory)'], ['flex', 'none']]) assert.ok(has(r.body, p, v), `${p}:${v} in ${r.body}`);
});

// Overflow on real data (PLAN.md 1d): the per-id evidence is gone, so each test names the place the probe reproduced it in.
test('Overflow, base shrink: a long base branch on the run card ends in an ellipsis instead of running off the card', () => {
  const r = ruleFor(RAIL, /^\.rc-base$/);
  assert.ok(r, 'a .rc-base rule');
  for (const [p, v] of [['flex', '0 1 auto'], ['min-width', '0'], ['max-width', '100%'], ['overflow', 'hidden'], ['text-overflow', 'ellipsis'], ['white-space', 'nowrap']]) assert.ok(has(r.body, p, v), `${p}:${v} in ${r.body}`);
  assert.ok(!has(r.body, 'flex', 'none'), 'no longer flex:none');
});

test("Overflow, squeezed icon: a Marketplace card's why icon keeps its 12px beside a long reason", () => {
  const r = ruleFor(RAIL, /(^|,)\.pg-why svg(,|$)/);
  assert.ok(r, 'a .pg-why svg rule');
  assert.ok(has(r.body, 'flex', 'none'), r.body);
});
