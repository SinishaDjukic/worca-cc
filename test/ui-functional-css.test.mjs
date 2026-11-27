// test/ui-functional-css.test.mjs — the `hidden` ATTRIBUTE must beat every author `display:`
// on elements app.js hides with it (shipped symptom: Pause/Stop visible on a finished run).
// Replaces the per-feature CSS greps (suite reduction 2026-10-04, review/UI.jsonl).
// jsdom's getComputedStyle cannot prove this cascade, so the guard reads the RULES through
// jsdom's CSSOM and replays the cascade for `display`: importance, then specificity, then order.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { readFileSync } from 'node:fs';
import { checkRows } from './helpers/rows.mjs';
import { readIndexHtml } from '../src/core/read-index-html.mjs';
import { readStyleCss } from '../src/core/read-style-css.mjs';

const css = readStyleCss();
const { document } = new JSDOM(`<style>${css}</style>`).window;
// Every style rule in document order. jsdom gives a CSSStyleRule an EMPTY `cssRules` (nesting
// support), so "recurse if r.cssRules, else collect" collects nothing: collect, then recurse.
const flat = [];
(function walk(list) {
  for (const r of list) {
    if (typeof r.selectorText === 'string') flat.push(r);
    if (r.cssRules?.length) walk(r.cssRules);              // @media, @container, @supports
  }
})(document.styleSheets[0].cssRules);

// Split at top-level separators only (never inside (), [] or quotes).
function splitTop(s, seps) {
  const out = []; let depth = 0, quote = null, cur = '';
  for (const ch of s) {
    if (quote) { if (ch === quote) quote = null; cur += ch; continue; }
    if (ch === '"' || ch === "'") { quote = ch; cur += ch; continue; }
    if (ch === '(' || ch === '[') depth++; else if (ch === ')' || ch === ']') depth--;
    if (depth === 0 && seps.includes(ch)) { out.push(cur.trim()); cur = ''; } else cur += ch;
  }
  out.push(cur.trim());
  return out.filter(Boolean);
}
const sels = (r) => splitTop(r.selectorText, ',');
// The subject compound: what the selector styles (after its last combinator).
const subject = (s) => splitTop(s.replace(/\s*([>+~])\s*/g, '$1'), ' >+~').pop();
const cmp = (x, y) => x[0] - y[0] || x[1] - y[1] || x[2] - y[2];
function specificity(sel) {
  let a = 0, b = 0, c = 0, s = sel;
  s = s.replace(/:where\((?:[^()]|\([^()]*\))*\)/g, ' ');
  s = s.replace(/:(?:not|is|has|matches)\(((?:[^()]|\([^()]*\))*)\)/g, (m, inner) => {
    const [x, y, z] = splitTop(inner, ',').map(specificity).sort(cmp).pop() ?? [0, 0, 0];
    a += x; b += y; c += z; return ' ';
  });
  s = s.replace(/\[[^\]]*\]/g, () => { b++; return ' '; });
  s = s.replace(/::?(?:before|after|first-line|first-letter)\b|::[\w-]+(?:\([^)]*\))?/g, () => { c++; return ' '; });
  s = s.replace(/:[\w-]+(?:\([^)]*\))?/g, () => { b++; return ' '; });
  s = s.replace(/#[\w-]+/g, () => { a++; return ' '; });
  s = s.replace(/\.[\w-]+/g, () => { b++; return ' '; });
  for (const _ of s.matchAll(/(?:^|[\s>+~])[a-zA-Z][\w-]*/g)) c++;
  return [a, b, c];
}
const important = (r) => r.style.getPropertyPriority('display') === 'important';
const topLevel = (r) => !r.parentRule;                     // not scoped to a @media / @container
// (b) the D3 product rule: `[hidden]:not([hidden="until-found"]) { display: none !important }`
const isGlobalHidden = (s) => /^\[hidden\](?::not\(\[hidden=(["']?)until-found\1\]\))?$/.test(s);
// Every rule that hides `sel` when it carries the attribute: its own `${sel}[hidden]` or the global one.
const hideRules = (sel) => flat.map((r, i) => ({ r, i }))
  .filter(({ r }) => topLevel(r) && r.style.display === 'none')
  .flatMap(({ r, i }) => sels(r).filter((s) => s === `${sel}[hidden]` || (isGlobalHidden(s) && important(r))).map((s) => ({ r, i, s })));
const token = (sel) => new RegExp(`${sel.replace(/[.#[\]()]/g, '\\$&')}(?![\\w-])`);
// Drop `:has(…)` / `:not(…)` groups: what they name is not the element itself.
const strip = (s, fns) => s.replace(new RegExp(`:(?:${fns})\\((?:[^()]|\\([^()]*\\))*\\)`, 'g'), '');
// Every `display:` other than none, one entry per selector of the rule's list, whose subject is `sel`.
const displays = (sel) => flat.map((r, i) => ({ r, i }))
  .filter(({ r }) => r.style.display && r.style.display !== 'none')
  .flatMap(({ r, i }) => sels(r).map((s) => ({ r, i, s })))
  .filter(({ s }) => token(sel).test(strip(subject(s), 'has|not')));
// ...of those, the ones a hidden `sel` still matches (no `[hidden]` / `:not([hidden])` on the subject).
const authorDisplays = (sel) => displays(sel).filter(({ s }) => !/\[hidden\]/.test(strip(subject(s), 'has')));
const beats = (h, a) => (important(h.r) !== important(a.r) ? important(h.r)
  : (cmp(specificity(h.s), specificity(a.s)) || (h.i - a.i)) > 0);
function assertHiddenWins(sel) {
  const hides = hideRules(sel);
  assert.ok(hides.length, `no top-level ${sel}[hidden] { display: none } (and no global [hidden] !important rule)`);
  const losing = authorDisplays(sel).filter((a) => !hides.some((h) => beats(h, a)));
  assert.deepEqual(losing.map(({ r, s }) => `${s} { display: ${r.style.display} } outranks ${sel}[hidden]`), []);
}

// [selector app.js hides with the `hidden` attribute, the dropped test it replaces].
const ROWS = [
  ['.rd-pause', 'ui-running-pause-fixes (f)'], ['.rd-stop', 'ui-running-pause-fixes (f)'],
  ['.rd-night-wrap', 'ui-night-mode: a hidden night switch really is hidden'],
  ['.artifact-list', 'ui-run-artifacts: restates display:none for a hidden .artifact-list'],
  ['.sched-presets', 'ui-schedule-sheet-after'], ['.sched-after', 'ui-schedule-sheet-after'],
  // (.sched-kind is never hidden by attribute: schedule-sheet.mjs mounts it or not.)
  ['.hd-after', 'ui-schedules-after-card: run-chain entry points'], ['.rd-after', 'ui-schedules-after-card: run-chain entry points'],
  ['.cost-pop', 'ui-cost-breakdown: the panel has a [hidden] rule'],
  ...['.sync-row', '.sync-pill', '.sync-note', '.sync-commits', '.sync-go', '.rd-sync', '#shipit-base-warn', '.proj-sync', '.sync-checked']
    .map((sel) => [sel, 'ui-branch-sync-model: §6.3 explicit [hidden]']),
  ['.rd-glance', 'ui-running-detail: Details must replace the glance'],
  ['.hd-report', 'the ⋯ carrier keeps its [hidden] rule'],
  // More dropped tests that asserted a [hidden] rule:
  ['.rd-night-sec', 'ui-night-mode: the answers sit under the run card'],
  ['.chat-panel', 'worca Chat: the run panel slot keeps its hidden twin'],
  ...['.hd-resume', '.hd-pause', '.hd-stop', '.hd-resume-split', '.rd-route', '.rd-pr-slot']
    .map((sel) => [sel, 'ui-history-detail-tabs: the saved run bar shares the run page bar\'s rules']),
  ['.hd-sec', 'ui-projects-view: the projects shell is a twin of the History track'], ['.pd-sec', 'ui-projects-view: the projects shell is a twin of the History track'],
  ['.rd-questions', 'ui-running-detail: the question panel rises in'],
  ['.rd-live', 'ui-running-detail: the live workflow in the card\'s right column goes when the run ends'],
  ['.wm-add-msg', 'workspace-map-css: hidden lines stay hidden'],
  // The account corner's popups and cards (side-flyout.mjs and app.js toggle `hidden`).
  ...['.acct-menu', '.lvl-menu', '.acct-spend', '.id-card'].map((sel) => [sel, 'ui-account-corner: a closed menu, an empty card']),
  // The Usage section and submenu (usage-view.mjs): no reading, no row, no hairline, no space.
  ...['.usage-menu', '.usage-sect'].map((sel) => [sel, 'usage rings: a hidden Usage section takes no space']),
  // The top bar's Activity popover and its badge (side-flyout.mjs and activity-menu.mjs toggle `hidden`).
  ...['.activity-pop', '.topnav-badge'].map((sel) => [sel, 'ui-activity-topnav: a closed popover, a zero badge']),
  ['.tsearch-pop', 'ui-topnav-search: the top bar search\'s closed listbox'],
  // The Perspective checklists' folded met items and earlier cycles (shape/checklist-view.mjs toggles `hidden`).
  ...['.shape-cl-list', '.shape-cl-earlier'].map((sel) => [sel, 'Shaper checklists: folded items stay folded']),
  // (.log-filters .log-f-exec and the checkbox/radio inputs are type/descendant selectors: the
  //  Step 3 row "every element index.html ships with `hidden` stays hidden" covers them.)
];

test('[hidden] beats the author display rule on every element app.js hides by attribute', async () => {
  assert.ok(flat.length > 1000, `jsdom parsed style.css (${flat.length} style rules)`);
  await checkRows([
    ...ROWS.map(([sel, from]) => ({ name: `${sel} (${from})`, run: () => assertHiddenWins(sel) })),
    { name: 'every element index.html ships with `hidden` stays hidden (the cascade over every display rule that matches it)', run: () => {
      const page = new JSDOM(readIndexHtml()).window.document;
      const els = [page, ...[...page.querySelectorAll('template')].map((t) => t.content)].flatMap((r) => [...r.querySelectorAll('[hidden]')]);
      assert.ok(els.length > 100, `${els.length} hidden elements in index.html`);
      const rules = flat.map((r, i) => ({ r, i })).filter(({ r }) => r.style.display)
        .flatMap(({ r, i }) => sels(r).map((s) => ({ r, i, s })))
        .filter(({ s }) => !/::|:(?:hover|focus|focus-visible|focus-within|active)\b/.test(s));   // states a static page never has
      const matches = (el, s) => { try { return el.matches(s); } catch { return false; } };
      const shown = [];
      for (const el of els) {
        const win = rules.filter(({ s }) => matches(el, s))
          .sort((x, y) => (important(x.r) - important(y.r)) || cmp(specificity(x.s), specificity(y.s)) || (x.i - y.i)).at(-1);
        if (win && win.r.style.display !== 'none') shown.push(`${el.tagName.toLowerCase()}${el.id ? `#${el.id}` : ''}${[...el.classList].map((c) => `.${c}`).join('')}: ${win.s} { display: ${win.r.style.display} }`);
      }
      assert.deepEqual(shown, []);
    } },
  ]);
});

// The tag field sits on the grey field ground, where the house placeholder grey (ink-3) is 2.58:1 in light — under 4.5:1
// (CI theme proof). Like the search fields, its "Tags" placeholder uses ink-2.
test('the tag input placeholder is readable on the grey field (ink-2)', () => {
  const r = flat.find((x) => sels(x).includes('.tag-input-text::placeholder'));
  assert.ok(r, 'a .tag-input-text::placeholder rule exists');
  assert.equal(r.style.getPropertyValue('color').replace(/\s+/g, ''), 'var(--ink-2)');
});

// Run 3 (D8): the Group row is the facts block's first row. Each fact row is a grid that [hidden] really hides, and an
// empty facts block takes no room.
test('the facts block\'s rows (the Group row among them) are grids that [hidden] really hides', () => {
  const row = flat.find((x) => sels(x).includes('.rd-kv-row'));
  assert.ok(row, 'a .rd-kv-row rule exists');
  assert.equal(row.style.getPropertyValue('display'), 'grid');
  const hid = flat.find((x) => sels(x).includes('.rd-kv-row[hidden]'));
  assert.ok(hid, 'a .rd-kv-row[hidden] rule exists');
  assert.equal(hid.style.getPropertyValue('display'), 'none');
  assert.match(css, /\.rd-kv\{container:rd-kv \/ inline-size;/);
});

// The chat card's footer buttons sit in .chat-rc-actions (runs redesign slice 4); without a gap of its own they touch.
test('the chat card footer actions are a wrapping row with a gap between the buttons', () => {
  const r = flat.find((x) => sels(x).includes('.chat-rc-actions'));
  assert.ok(r, 'a .chat-rc-actions rule exists');
  assert.equal(r.style.getPropertyValue('display'), 'flex');
  assert.equal(r.style.getPropertyValue('gap'), '8px');
});

test('run 4 D21, D14: the Chat run card is divided sections, the group page Ship card sits under one divider, and the in-card override stays last', () => {
  const body = (sel) => (flat.find((r) => r.selectorText === sel) || {}).style;
  const section = body('.ask-card.chat-rc > :is(.ask-rc-stats,.chat-rc-q,.chat-rc-result,.chat-rc-foot)');
  assert.ok(section, 'the section rule exists');
  assert.equal(section.getPropertyValue('border-top'), '1px solid var(--line)');
  assert.equal(section.getPropertyValue('padding-top'), '12px');
  assert.equal(flat.some((r) => /chat-rc-well/.test(r.selectorText) && r.style.getPropertyValue('border-top')), false, 'the graph well is a bordered well, not a divider (#959)');
  const ship = body('.feature-page .shape-feature > .ask-shipcard');
  assert.ok(ship, 'the group page Ship card rule exists');
  assert.equal(ship.getPropertyValue('border-top'), '1px solid var(--line)');
  assert.equal(ship.getPropertyValue('border-radius'), '0px');
  assert.match(flat.at(-1).selectorText, /^:is\(\.ask-card,\.chat-rc,\.shape-feature\) :is\(\.qpanel,/, 'the in-card override is the last rule');
});

test('one-level run page: beside the Runs list the run pages drop Back (the list is right there); the group page and the slide layout keep it', () => {
  document.body.innerHTML = `<div class="runs-shell" data-layout="split"><div class="runs-pane">
    <div class="run-shell detail-open"><div class="rd"><div class="rd-bar"><button class="btn btn-sm btn-quiet btn-icon rd-back"></button></div></div></div>
    <div class="hist-shell detail-open"><div class="hd"><div class="hd-bar"><button class="btn btn-sm btn-quiet btn-icon hd-back"></button></div></div></div>
    <div class="group-shell detail-open"><div class="gpage"><div class="gpage-bar rd-bar"><a class="btn btn-sm btn-quiet btn-icon gpage-back"></a></div></div></div>
  </div></div>`;
  const winner = (cls) => {
    const el = document.querySelector(`.${cls}`);
    // Every top-level rule (no @media / @container arm) that sets display on this element; the cascade's winner.
    const hits = flat.map((r, i) => ({ r, i })).filter(({ r }) => topLevel(r) && r.style.getPropertyValue('display'))
      .flatMap(({ r, i }) => sels(r).filter((s) => { try { return el.matches(s); } catch { return false; } })
        .map((s) => ({ r, i, imp: important(r), spec: specificity(s) })));
    hits.sort((x, y) => (x.imp - y.imp) || cmp(x.spec, y.spec) || (x.i - y.i));
    return hits.at(-1);
  };
  const display = (cls) => { const w = winner(cls); assert.ok(w, `${cls}: some rule gives it a display`); return w.r.style.getPropertyValue('display'); };
  for (const cls of ['rd-back', 'hd-back']) assert.equal(display(cls), 'none', `${cls} is hidden beside the Runs list`);
  assert.notEqual(display('gpage-back'), 'none', 'the group page keeps its Back');
  document.querySelector('.runs-shell').dataset.layout = 'slide';
  for (const cls of ['rd-back', 'hd-back', 'gpage-back']) assert.notEqual(display(cls), 'none', `${cls} shows in the slide layout`);
  document.body.innerHTML = '';
});

test('slice 2: a disabled danger ⋯ item (the gated Archive) reads disabled, not red', () => {
  document.body.innerHTML = '<div class="menu wfv-menu"><button class="menu-item wfv-menu-item is-danger" disabled></button></div>';
  const el = document.querySelector('.is-danger');
  const hits = flat.map((r, i) => ({ r, i })).filter(({ r }) => topLevel(r) && r.style.getPropertyValue('color'))
    .flatMap(({ r, i }) => sels(r).filter((s) => { try { return el.matches(s); } catch { return false; } })
      .map((s) => ({ r, i, imp: important(r), spec: specificity(s) })));
  hits.sort((x, y) => (x.imp - y.imp) || cmp(x.spec, y.spec) || (x.i - y.i));
  assert.equal(hits.at(-1)?.r.style.getPropertyValue('color'), 'var(--ink-3)', `won by "${hits.at(-1)?.r.selectorText}"`);
  document.body.innerHTML = '';
});

// The top-level rule that wins `prop` on `el` (importance, specificity, order), and its value.
function winning(el, prop) {
  const hits = flat.map((r, i) => ({ r, i })).filter(({ r }) => topLevel(r) && r.style.getPropertyValue(prop))
    .flatMap(({ r, i }) => sels(r).filter((s) => { try { return el.matches(s); } catch { return false; } })
      .map((s) => ({ r, i, imp: r.style.getPropertyPriority(prop) === 'important', spec: specificity(s) })));
  hits.sort((x, y) => (x.imp - y.imp) || cmp(x.spec, y.spec) || (x.i - y.i));
  return { value: hits.at(-1)?.r.style.getPropertyValue(prop), by: hits.at(-1)?.r.selectorText };
}

test('run page bar: every .rd-bar-end button is one height, font size and padding on both bars (weight: the primary 600, the rest 500); ⋯ is a bordered square', () => {
  const end = (bar) => `<div class="${bar}"><span class="rd-bar-end">
    <button class="btn ${bar === 'rd-bar' ? 'rd' : 'hd'}-after"></button>
    <span class="rd-actions"><button class="btn btn-sm btn-primary" data-k="primary"></button><button class="btn btn-sm" data-k="made"></button></span>
    <div class="btn-split mini"><button class="btn" data-k="split"></button><button class="btn btn-icon btn-split-more"></button></div>
    <button class="btn btn-danger" data-k="stop"></button>
    <button class="btn btn-quiet btn-icon ${bar === 'rd-bar' ? 'rd' : 'hd'}-bar-more"></button>
    <span class="crp-bar-btns"><button class="btn crp-full"></button></span>
  </span></div>`;
  // The run page roots (.rd / .hd) hold the bar: the button rules are scoped to them, wherever the end group sits.
  document.body.innerHTML = `<div class="crp"><div class="rd">${end('rd-bar')}</div><div class="hd">${end('hd-bar')}</div></div>`;
  for (const bar of ['rd-bar', 'hd-bar']) {
    const q = (s) => document.querySelector(`.${bar} ${s}`);
    const labelled = ['.rd-after,.hd-after', '[data-k="primary"]', '[data-k="made"]', '[data-k="split"]', '[data-k="stop"]'].map(q);
    const icons = ['.btn-split-more', '.rd-bar-more,.hd-bar-more'].map(q);
    for (const el of [...labelled, ...icons]) {
      const tag = `${bar} ${el.className}`;
      assert.equal(winning(el, 'height').value, '32px', `${tag}: height (by "${winning(el, 'height').by}")`);
      assert.equal(winning(el, 'font-size').value, 'var(--fs-body)', `${tag}: font-size (by "${winning(el, 'font-size').by}")`);
      assert.equal(winning(el, 'font-weight').value, el.classList.contains('btn-primary') ? '600' : '500',`${tag}: font-weight (by "${winning(el, 'font-weight').by}")`);
      // The Resume split's halves join (square inner corners); every standalone button has the .btn radius.
      if (!el.closest('.btn-split')) assert.equal(winning(el, 'border-radius').value, 'var(--r-sm)', `${tag}: radius`);
    }
    for (const el of labelled) assert.equal(winning(el, 'padding-left').value, '12px', `${bar} ${el.className}: padding (by "${winning(el, 'padding-left').by}")`);
    for (const el of icons) {
      assert.equal(winning(el, 'width').value, '32px', `${bar} ${el.className}: width`);
      assert.equal(winning(el, 'padding-left').value, '0px', `${bar} ${el.className}: icon padding (by "${winning(el, 'padding-left').by}")`);
    }
    const more = icons[1];
    assert.equal(winning(more, 'border-color').value, 'var(--line-2)', `${bar} ⋯ border (by "${winning(more, 'border-color').by}")`);
    assert.equal(winning(more, 'background').value, 'var(--panel)', `${bar} ⋯ background (by "${winning(more, 'background').by}")`);
    // The chat panel's Open full page / Close keep their own square (padding 0), not the bar's labelled padding.
    assert.equal(winning(q('.crp-full'), 'padding-left').value, '0px', `${bar} .crp-full padding (by "${winning(q('.crp-full'), 'padding-left').by}")`);
  }
  document.body.innerHTML = '';
});

test('narrow chat run panel: Resume keeps its word, the other bar buttons go icon-only', () => {
  // The rules inside `@container crp (max-width:560px)`, in order; the cascade replayed for `position`.
  const narrow = flat.map((r, i) => ({ r, i }))
    .filter(({ r }) => /crp\s*\(max-width:\s*560px\)/.test(r.parentRule?.conditionText || r.parentRule?.cssText?.split('{')[0] || ''));
  assert.ok(narrow.length, 'the narrow crp container rules are found');
  const position = (el) => {
    const hits = narrow.filter(({ r }) => r.style.getPropertyValue('position'))
      .flatMap(({ r, i }) => sels(r).filter((s) => { try { return el.matches(s); } catch { return false; } })
        .map((s) => ({ r, i, spec: specificity(s) })));
    hits.sort((x, y) => cmp(x.spec, y.spec) || (x.i - y.i));
    return hits.at(-1)?.r.style.getPropertyValue('position');
  };
  document.body.innerHTML = `<div class="crp">
    <div class="rd-bar"><button class="btn rd-pause" data-action="resume"><span class="rd-btn-label" data-k="rd-resume">Resume</span></button>
      <button class="btn rd-pause" data-action="pause"><span class="rd-btn-label" data-k="rd-pause">Pause</span></button>
      <button class="btn rd-stop"><span class="rd-btn-label" data-k="rd-stop">Stop</span></button></div>
    <div class="hd-bar"><button class="btn hd-resume"><span class="hd-btn-label" data-k="hd-resume">Resume</span></button>
      <button class="btn hd-stop"><span class="hd-btn-label" data-k="hd-stop">Stop</span></button></div></div>`;
  const q = (k) => document.querySelector(`[data-k="${k}"]`);
  for (const k of ['rd-resume', 'hd-resume']) assert.equal(position(q(k)), 'static', `${k}: the word shows`);
  for (const k of ['rd-pause', 'rd-stop', 'hd-stop']) assert.equal(position(q(k)), 'absolute', `${k}: icon-only`);
  document.body.innerHTML = '';
});

test('usage rings (account-corner.css): the 24px avatar under an inner ring, theme-free rules, the -strong inks are light-dark pairs', () => {
  const css = readFileSync(new URL('../ui/public/shell/account-corner.css', import.meta.url), 'utf8');
  assert.match(css, /\.acct\[data-usage-l\]:not\(\[data-usage-l="none"\]\) \.acct-ava\{width:24px;height:24px;/);
  const usage = css.split('\n').filter((l) => /usage|uw-|ring-s|ring-l|data-tone="(?:ok|warn|over)"\] > \.mini-ring/.test(l));
  assert.ok(usage.length >= 10, usage.join('\n'));
  assert.deepEqual(usage.filter((l) => /\[data-theme|prefers-color-scheme/.test(l)), []);
  assert.equal(/data-spend[^\n]*acct-ring|\.acct\[data-spend/.test(css), false, 'the avatar has no spend ring rules');
  const tokens = readFileSync(new URL('../ui/public/shell/self-hosted.css', import.meta.url), 'utf8');
  assert.match(tokens, /--red-ink-strong:light-dark\(/);
  assert.match(tokens, /--amber-ink-strong:light-dark\(/);
});

// Slice 13 (R-ux-5): every open stop line's step card draws as the card's own question draws, and its banner and head,
// which repeat the line, are hidden. The DOM comes from the real paintStopList and the real stop card. jsdom's CSSOM
// expands only some shorthands (never one holding var()), so each longhand is compared next to its shorthand.
test('slice 13: a stop line\'s step card cascades like the card question, banner and head hidden', async () => {
  const { paintStopList, stopLinesOf } = await import('../ui/public/shape/stop-list.mjs');
  const { renderGateCard, stepHead } = await import('../ui/public/shape/step-card.mjs');
  const { planStop } = await import('../src/shared/shape/run-stops.mjs');
  // The busy state: runs 2, 4 and 11 at stops, run 5 failed.
  const ask = (index, kind, reason) => ({ index, runId: `r${index}`, pipelineId: `p${index}`, id: `q${index}`, kind, reason, failed: false, holdsUp: [] });
  const asks = [ask(2, 'plan', 'requirement'), ask(4, 'gate', 'check'),
    { index: 5, runId: null, pipelineId: 'p5', id: null, kind: null, reason: null, failed: true, holdsUp: [] }, ask(11, 'gate', 'check')];
  const slices = [[2, 'approval'], [4, 'questions'], [5, 'error'], [11, 'questions']].map(([index, state]) => ({ index, title: `Run ${index}`, state, pipelineId: `p${index}`, buildsOn: [] }));
  const lines = stopLinesOf({ asks, ask: asks[0], slices });

  /** What a host's `.qpanel` holds for one ask kind, under the renderer's own banner. */
  function fill(panel, kind) {
    panel.classList.remove('hidden');
    panel.dataset.kind = kind;
    panel.innerHTML = '<div class="qpanel-head"><b>Plan ready for your approval · v1</b><span class="qcount">Shape 3/8</span></div>';
    if (kind === 'plan' || kind === 'gate') {
      const stop = planStop(kind === 'plan' ? { run: 2, outlineChange: 'the runner cache needs its own run' } : { run: 4 });
      renderGateCard(panel, { id: `q-${kind}`, kind, issues: [], plan: { round: 1 }, stop },
        { doc: document, title: stop.head, chip: 'Plan', tagLevel: () => {}, submit: async () => true });
    } else {
      panel.append(stepHead(document, 'A few questions', 'Clarify'));
      panel.insertAdjacentHTML('beforeend', '<div class="qbody"><div class="qblock"><div class="qtext">Where?</div></div></div>'
        + '<div class="qpanel-foot"><button type="button" class="btn btn-primary">Send</button></div>');
    }
  }
  const PANEL = ['display', 'padding', 'padding-top', 'padding-right', 'padding-bottom', 'padding-left', 'background', 'background-color', 'border-radius'];
  const PROPS = { '.qpanel': PANEL, '.qblock': PANEL, '.qpanel-foot': ['flex-wrap', 'gap', 'row-gap', 'border-top', 'border-top-color', 'border-color'] };
  const bad = [];
  for (const kind of ['plan', 'gate', 'clarify', 'form']) {
    document.body.innerHTML = '<div class="ask-card chat-rc"><ol class="chat-rc-stops"></ol>'
      + '<section class="chat-rc-q"><div class="chat-rc-qbody"><div class="qpanel hidden"></div></div></section></div>';
    const slot = document.querySelector('section.chat-rc-q');
    fill(slot.querySelector('.qpanel'), kind);
    paintStopList(document, document.querySelector('ol.chat-rc-stops'), lines, {
      bindQuestion: (qHost) => { fill(qHost.querySelector('.qpanel'), kind); return () => {}; },
      paintQuestion: () => null, releaseQuestion: () => {}, resume: async () => ({ ok: true }),
    });
    // The proof reads real values from the card question (so equal never means two unread ones).
    const own = slot.querySelector('.qpanel');
    // A clarify or form panel has no top padding of its own: its questions (or its fields) carry the 16px.
    const top = kind === 'plan' || kind === 'gate' ? '16px' : '0px';
    assert.deepEqual([winning(own, 'padding-top').value, winning(own, 'padding-left').value], [top, '0px'], `${kind}: the card question's padding`);
    assert.equal(winning(slot.querySelector('.qpanel-foot'), 'flex-wrap').value, 'wrap', `${kind}: the card question's foot wraps`);
    assert.notEqual(winning(slot.querySelector('.step-head'), 'display').value, 'none', `${kind}: the card question keeps its step head`);
    assert.equal(winning(slot.querySelector('.qpanel-head'), 'display').value, 'none', `${kind}: the card question hides the banner`);
    for (const run of [2, 4, 11]) {
      // Slice 12: a line mounts its step card when it is opened, and only one is mounted at a time.
      const button = document.querySelector(`ol.chat-rc-stops li[data-run="${run}"] button.chat-rc-stop-line`);
      assert.ok(button, `${kind}: run ${run}'s line is a button`);
      button.click();
      const hosts = [...document.querySelectorAll('.chat-rc-stop-q')];
      assert.equal(hosts.length, 1, `${kind}: one host, for the opened line`);
      const [host] = hosts;
      assert.equal(host.closest('li').dataset.run, String(run), kind);
      const where = `${kind}, run ${run}`;
      for (const sel of ['.qpanel-head', '.step-head']) {
        const w = winning(host.querySelector(sel), 'display');
        if (w.value !== 'none') bad.push(`${where}: ${sel} display is ${w.value} (by "${w.by}"), wants none`);
      }
      const margin = winning(host, 'margin-top').value;
      if (margin !== '0' && margin !== '0px') bad.push(`${where}: the host's margin-top is ${margin}, wants 0`);
      for (const [sel, props] of Object.entries(PROPS)) {
        const mine = [...host.querySelectorAll(sel)];
        const theirs = [...slot.querySelectorAll(sel)];
        assert.ok(theirs.length > 0 && mine.length === theirs.length, `${where}: ${sel} count ${mine.length} vs ${theirs.length}`);
        for (const [i, el] of mine.entries()) {
          for (const prop of props) {
            const a = winning(el, prop);
            const b = winning(theirs[i], prop);
            if (a.value !== b.value) bad.push(`${where}: ${sel}[${i}] ${prop} is ${a.value} (by "${a.by}"), the card question's is ${b.value} (by "${b.by}")`);
          }
        }
      }
    }
  }
  document.body.innerHTML = '';
  assert.deepEqual(bad, []);
});

// Slice 12 (R-ux-5): the same list on the feature page, outside any chat card, and the line's chevron.
async function s12Lines(html) {
  const { paintStopList, stopLinesOf } = await import('../ui/public/shape/stop-list.mjs');
  const asks = [{ index: 2, runId: 'r2', pipelineId: 'p2', id: 'q2', kind: 'gate', reason: 'check', failed: false, holdsUp: [] }];
  document.body.innerHTML = html;
  paintStopList(document, document.querySelector('ol.chat-rc-stops'), stopLinesOf({ asks, slices: [{ index: 2, state: 'questions', pipelineId: 'p2', buildsOn: [] }] }), {
    bindQuestion: (qHost) => {
      const panel = qHost.querySelector('.qpanel');
      panel.classList.remove('hidden');
      panel.innerHTML = '<div class="qpanel-head"><b>Plan ready</b></div><div class="step-head">Run 2</div>';
      return () => {};
    },
    paintQuestion: () => null, releaseQuestion: () => {}, resume: async () => ({ ok: true }),
  });
  const button = document.querySelector('button.chat-rc-stop-line');
  assert.ok(button, 'the line is a button');
  return button;
}

test('S12: a stop line\'s step card on the feature page hides the renderer\'s banner and the step head', async () => {
  const button = await s12Lines('<div class="gpage"><div class="gpage-panel" data-tab="runs"><ol class="chat-rc-stops"></ol></div></div>');
  button.click();
  for (const sel of ['.qpanel-head', '.step-head']) {
    assert.equal(winning(document.querySelector(`.chat-rc-stop-q ${sel}`), 'display').value, 'none', sel);
  }
  document.body.innerHTML = '';
});

test('S12: a stop line has a third column for its chevron, in --ink-2, which turns down while the line is open', async () => {
  const button = await s12Lines('<div class="ask-card chat-rc"><ol class="chat-rc-stops"></ol></div>');
  const chev = button.querySelector('.chat-rc-stop-chev');
  assert.ok(chev, 'the chevron');
  assert.equal(winning(button, 'display').value, 'grid');
  assert.match(winning(button, 'grid-template-columns').value || '', /^16px minmax\(0(px)?, ?1fr\) \S+$/, 'dot, text, chevron');
  assert.equal(winning(chev, 'color').value, 'var(--ink-2)');
  const turn = () => ['transform', 'rotate'].map((p) => winning(chev, p).value || '').filter((v) => v && v !== 'none').join(' ');
  assert.equal(turn(), '', 'closed: it points right');
  button.click();
  assert.equal(button.getAttribute('aria-expanded'), 'true');
  assert.match(turn(), /(rotate\()?90deg/, 'open: it points down');
  document.body.innerHTML = '';
});
