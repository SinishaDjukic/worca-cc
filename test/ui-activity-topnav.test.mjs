// test/ui-activity-topnav.test.mjs — the top bar's Activity button and popover in the REAL index.html
// and style.css: where they sit (the right slot, before New run), how they look (an outlined pill,
// one badge, a 440px dialog; tokens only) and what a phone keeps (the icon and its badge).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dir = dirname(fileURLToPath(import.meta.url));
const root = join(__dir, '..', 'ui', 'public');
const html = readFileSync(join(root, 'index.html'), 'utf8');
const css = readFileSync(join(root, 'style.css'), 'utf8');

/** The body of the FIRST rule written exactly as `selector {…}` (house rule: no comment inside a rule body). */
function ruleBody(selector) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const m = css.match(new RegExp('(?:^|[\\s,}])' + escaped + '\\s*\\{([^}]*)\\}'));
  return m ? m[1].replace(/\s+/g, ' ') : null;
}
/** The "Responsive nav tiers" phone block (the ≤760px one after the hamburger's base rule). */
function phoneBlock() {
  const tiers = css.slice(css.indexOf('.mbar-menu,.nav-scrim,.side-close{display:none;}'));
  const at = tiers.indexOf('@media (max-width:760px){');
  return tiers.slice(at, tiers.indexOf('\n}\n', at));
}

test('Activity sits in the bar\'s right slot before New run: an outlined pill with its icon, a hidden badge and a hidden dialog, at every level', () => {
  const doc = new JSDOM(html).window.document;
  assert.deepEqual([...doc.querySelector('#topnav > .topnav-r').children].map((n) => n.id), ['topnav-activity', 'activity-pop', 'topnav-new']);
  const b = doc.getElementById('topnav-activity');
  assert.deepEqual([b.tagName, b.type, b.className], ['BUTTON', 'button', 'topnav-act']);
  for (const [k, v] of [['aria-haspopup', 'dialog'], ['aria-expanded', 'false'], ['aria-controls', 'activity-pop'], ['aria-label', 'Activity'], ['data-min-level', 'simple']]) {
    assert.equal(b.getAttribute(k), v, k);
  }
  assert.equal(b.querySelector('svg path').getAttribute('d'), 'M22 12h-4l-3 9L9 3l-3 9H2', 'the activity icon');
  assert.equal(b.querySelector('.topnav-act-label').textContent, 'Activity');
  const n = doc.getElementById('topnav-activity-n');
  assert.deepEqual([n.parentElement, n.className, n.hidden], [b, 'topnav-badge', true]);
  const pop = doc.getElementById('activity-pop');
  assert.deepEqual([pop.className, pop.getAttribute('role'), pop.getAttribute('aria-label'), pop.hidden, pop.children.length],
    ['activity-pop', 'dialog', 'Activity', true, 0]);
  const pill = ruleBody('.topnav-act');
  for (const d of ['height:32px;', 'border-radius:999px;', 'background:var(--panel);', 'box-shadow:inset 0 0 0 1px var(--line-2);']) assert.ok(pill.includes(d), `.topnav-act has ${d}`);
  assert.match(ruleBody('.topnav-act[aria-expanded="true"]'), /box-shadow:inset 0 0 0 1\.5px var\(--ink\);/);
  assert.match(ruleBody('.topnav-badge[data-tone="need"]'), /background:var\(--amber-bg\);color:var\(--amber-ink-strong\);/, 'the Runs badge\'s amber');
  assert.match(ruleBody('.topnav-badge[data-tone="run"]'), /background:var\(--blue-bg\);color:var\(--blue-ink-strong\);/);
  for (const d of ['position:fixed;', 'z-index:43;', 'width:440px;', 'max-height:min(560px,calc(100vh - 72px));', 'border-radius:var(--r-card);', 'box-shadow:var(--shadow-pop);']) {
    assert.ok(ruleBody('.activity-pop').includes(d), `.activity-pop has ${d}`);
  }
  assert.equal(ruleBody('.activity-row button'), null, 'rows carry no actions');
  // The time, the line under the title and an empty tab's text carry information: --ink-2 (4.5:1 and up on --panel
  // and --hover in both themes), not the --ink-3 of labels (2.8:1 on white).
  for (const sel of ['.activity-row-time', '.activity-row-sub', '.activity-empty']) assert.match(ruleBody(sel), /color:var\(--ink-2\);/, sel);
  const last = css.indexOf('.topnav-new:focus-visible{outline:2px solid var(--ink);outline-offset:2px;}');
  assert.ok(last > 0 && css.indexOf('\n.topnav-act{') > last && css.indexOf('\n.topnav-act{') < css.indexOf('\n.topbar{'),
    'the Activity rules follow the top bar\'s');
});

test('phones: Activity turns icon-only and keeps its badge; the popover spans the viewport less 16px', () => {
  const block = phoneBlock();
  assert.match(block, /\n {2}\.topnav-act\{min-width:32px;padding:0 8px;gap:5px;justify-content:center;\}/);
  assert.match(block, /\n {2}\.topnav-act-label\{display:none;\}/);
  assert.match(block, /\n {2}\.activity-pop\{width:calc\(100vw - 16px\);\}/);
  assert.doesNotMatch(block, /\.topnav-badge[^{]*\{[^}]*display:none/, 'the badge stays');
  assert.ok(block.indexOf('.topnav-act-label{display:none;}') > block.indexOf('.topnav-new-label{display:none;}'), 'after the bar\'s own phone rules');
});
