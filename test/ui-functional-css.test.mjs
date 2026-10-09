// test/ui-functional-css.test.mjs — the `hidden` ATTRIBUTE must beat every author `display:`
// on elements app.js hides with it (shipped symptom: Pause/Stop visible on a finished run).
// Replaces the per-feature CSS greps (suite reduction 2026-10-04, review/UI.jsonl).
// jsdom's getComputedStyle cannot prove this cascade, so the guard reads the RULES through
// jsdom's CSSOM and replays the cascade for `display`: importance, then specificity, then order.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import { checkRows } from './helpers/rows.mjs';

const css = readFileSync(new URL('../ui/public/style.css', import.meta.url), 'utf8');
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
  ['.hd-report', 'latent: .hd-menu .hd-report outranks .hd-report[hidden] (fixed by the global rule)'],
  // More dropped tests that asserted a [hidden] rule:
  ['.rd-night-sec', 'ui-night-mode: the answers sit under the run card'],
  ['.ask-pill', 'ui-ask-style: the launcher button keeps its hidden twin'],
  ...['.hd-resume', '.hd-pause', '.hd-stop', '.hd-resume-split', '.rd-page-branch', '.rd-pr-slot']
    .map((sel) => [sel, 'ui-history-detail-tabs: the saved run bar shares the run page bar\'s rules']),
  ['.hd-sec', 'ui-projects-view: the projects shell is a twin of the History track'], ['.pd-sec', 'ui-projects-view: the projects shell is a twin of the History track'],
  ['.rd-questions', 'ui-running-detail: the question panel rises in'],
  ['.wm-add-msg', 'workspace-map-css: hidden lines stay hidden'],
  // The account corner's popups and cards (side-flyout.mjs and app.js toggle `hidden`).
  ...['.acct-menu', '.lvl-menu', '.acct-spend', '.id-card'].map((sel) => [sel, 'ui-account-corner: a closed menu, an empty card']),
  ['.tsearch-pop', 'ui-topnav-search: the top bar search\'s closed listbox'],
  // (.log-filters .log-f-exec and the checkbox/radio inputs are type/descendant selectors: the
  //  Step 3 row "every element index.html ships with `hidden` stays hidden" covers them.)
];

test('[hidden] beats the author display rule on every element app.js hides by attribute', async () => {
  assert.ok(flat.length > 1000, `jsdom parsed style.css (${flat.length} style rules)`);
  await checkRows([
    ...ROWS.map(([sel, from]) => ({ name: `${sel} (${from})`, run: () => assertHiddenWins(sel) })),
    { name: 'every element index.html ships with `hidden` stays hidden (the cascade over every display rule that matches it)', run: () => {
      const page = new JSDOM(readFileSync(new URL('../ui/public/index.html', import.meta.url), 'utf8')).window.document;
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
    { name: 'ui-running-detail: the Live two-column layout never outranks [hidden]', run: () => {
      const live = displays('.rd-glance').filter(({ s }) => subject(s).includes('.rd-glance[data-live="on"]'));
      assert.ok(live.length, 'the wide layout sets display somewhere');
      assert.deepEqual(live.filter(({ s }) => !subject(s).includes(':not([hidden])')).map(({ s }) => s), []);
    } },
  ]);
});
