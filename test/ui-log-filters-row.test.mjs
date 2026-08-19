// test/ui-log-filters-row.test.mjs
// Regression: the "Live log" filter pills (source / level / step) must sit on
// one horizontal row in the running-view run card, matching the history panel.
// jsdom has no layout engine, so layout is asserted via the CSS text plus the
// DOM structure the rules rely on (see test/ui-history-sticky-header.test.mjs
// for the same hybrid pattern).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';

const cssPath = fileURLToPath(new URL('../ui/public/style.css', import.meta.url));
const htmlPath = fileURLToPath(new URL('../ui/public/index.html', import.meta.url));
const css = readFileSync(cssPath, 'utf8');

// Same anchored helper idiom as test/ui-pinned-sidebar.test.mjs: extract a flat
// rule body, anchored on a non-word char (or start) so we don't match a longer
// selector that merely ends with the same suffix.
function ruleBody(selector) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const m = css.match(new RegExp('(?:^|[\\s,}])' + escaped + '\\s*\\{([^}]*)\\}'));
  return m ? m[1] : null;
}

// ---------- CSS-string assertions ----------

test('.log-filters keeps its pills on a single flex line', () => {
  const body = ruleBody('.log-filters');
  assert.ok(body, '.log-filters rule must exist');
  assert.match(body, /display:\s*flex/, 'pill bar is a flex row');
  assert.match(body, /flex-wrap:\s*nowrap/, 'pills must never wrap onto extra rows');
  assert.match(body, /min-width:\s*0/,
    'the bar itself must shrink as a run-card flex item instead of overflowing the head row');
});

test('run-card head puts the pill bar on its own row under "Live log"', () => {
  const head = ruleBody('.run-log-head');
  assert.ok(head, '.run-log-head rule must exist');
  assert.match(head, /flex-wrap:\s*wrap/, 'head must wrap so the pill bar can drop to a second row');
  const bar = ruleBody('.run-log-head .log-filters');
  assert.ok(bar, '.run-log-head .log-filters rule must exist');
  assert.match(bar, /flex-basis:\s*100%/, 'pill bar spans the full width -> forced onto its own row');
  assert.match(bar, /order:\s*1/,
    'bar sorts after the label and autoscroll switch so row 1 stays "Live log" ⟷ Auto-scroll');
});

test('.log-filters .log-f resets the global select width:100%', () => {
  const body = ruleBody('.log-filters .log-f');
  assert.ok(body, '.log-filters .log-f rule must exist');
  assert.match(body, /width:\s*auto/, 'pills size to content, not 100% of the bar');
  assert.match(body, /min-width:\s*0/, 'pills may shrink so the single row never overflows the bar');
});

// ---------- DOM structure the CSS relies on ----------

test('run-card template keeps every control as a sibling in one .log-filters bar', () => {
  const dom = new JSDOM(readFileSync(htmlPath, 'utf8'));
  const tpl = dom.window.document.getElementById('run-card-tpl');
  assert.ok(tpl, 'run-card template must exist');
  const bar = tpl.content.querySelector('.run-log-head .log-filters');
  assert.ok(bar, 'run-card head must contain a .log-filters bar');
  const pills = [...bar.children].map((el) => el.className);
  assert.deepEqual(pills, [
    'log-f log-f-source', 'log-f log-f-level', 'log-f log-f-step', 'log-f log-f-cycle',
    'log-f log-search', 'log-f log-copy',
  ]);
});

test('the search box and copy button are labelled and typed for a11y', () => {
  const dom = new JSDOM(readFileSync(htmlPath, 'utf8'));
  const bar = dom.window.document.getElementById('run-card-tpl')
    .content.querySelector('.run-log-head .log-filters');
  const search = bar.querySelector('.log-search');
  assert.equal(search.tagName, 'INPUT');
  assert.equal(search.getAttribute('type'), 'search');
  assert.ok(search.getAttribute('aria-label'), 'search needs an aria-label (placeholder is not one)');
  const copy = bar.querySelector('.log-copy');
  assert.equal(copy.tagName, 'BUTTON');
  assert.equal(copy.getAttribute('type'), 'button', 'must not submit an enclosing form');
  assert.ok(copy.getAttribute('aria-label'), 'copy needs an aria-label');
});

test('the cycle separator is a styled rule, not a log line', () => {
  const body = ruleBody('.log-sep');
  assert.ok(body, '.log-sep rule must exist');
  assert.match(body, /display:\s*flex/, 'the label sits between two rules');
});
