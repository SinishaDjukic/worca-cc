// test/nav-drift.test.mjs — the navigation ratchet (docs/design-system.md Navigation): back buttons, breadcrumbs and
// tab strips are built only in ui/public/nav/. Every file under ui/public/ is scanned (new files too); the counts
// in test/fixtures/nav-drift-baseline.json may only go DOWN, lowered in the same change.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';

const ROOT = new URL('..', import.meta.url).pathname;
const BASELINE = JSON.parse(readFileSync(path.join(ROOT, 'test/fixtures/nav-drift-baseline.json'), 'utf8')).files;
const PATTERNS = {
  back: /\b[a-z][a-z0-9]*-back\b|\bback-?btn\b|\bbackBtn\b/gi,
  // A crumb class (the sanctioned top bar nav, #topnav-crumbs, is exempt) or a Breadcrumb label in any form:
  // aria-label="Breadcrumb", 'aria-label': 'Breadcrumb', setAttribute('aria-label', 'Breadcrumb').
  crumbs: /aria-label['",=:\s]+Breadcrumb['"]|\b(?!topnav-)[a-z][a-z0-9]*-crumbs?\b/g,
  tablist: /role="tablist"|['"]tablist['"]/g,
  backLabel: /['">]Back(?: to [A-Z][a-z]*)?['"<]/g,
};
// Whole comment lines and HTML comments only: code with a trailing comment still counts (the baseline absorbs it).
const strip = (src) => src.replace(/<!--[\s\S]*?-->/g, (m) => m.replace(/[^\n]/g, ' '))
  .split('\n').map((l) => (/^\s*(\/\/|\/\*|\*)/.test(l) ? '' : l)).join('\n');

export function countDrift(src) {
  const s = strip(String(src));
  const out = {};
  for (const [k, re] of Object.entries(PATTERNS)) { const n = (s.match(re) || []).length; if (n) out[k] = n; }
  return out;
}

function scan() {
  const walk = (d) => readdirSync(path.join(ROOT, d)).flatMap((f) => {
    const p = `${d}/${f}`;
    if (p === 'ui/public/nav') return [];
    return statSync(path.join(ROOT, p)).isDirectory() ? walk(p) : [p];
  });
  const res = {};
  for (const f of walk('ui/public').filter((f) => /\.(mjs|js|html)$/.test(f)).sort()) {
    const c = countDrift(readFileSync(path.join(ROOT, f), 'utf8'));
    if (Object.keys(c).length) res[f] = c;
  }
  return res;
}

test('countDrift: each pattern counts its own form, and a comment line does not', () => {
  const cases = [
    ['back', `el.className = 'x-back';`], ['back', `const backBtn = mk('button');`],
    ['crumbs', `nav.setAttribute('aria-label', 'Breadcrumb');`], ['crumbs', `<nav aria-label="Breadcrumb">`],
    ['crumbs', `div.className = 'tl-crumbs';`], ['tablist', `<div role="tablist">`], ['tablist', `t.setAttribute('role', 'tablist');`],
    ['backLabel', `<a>Back to Runs</a>`], ['backLabel', `b.textContent = 'Back';`],
  ];
  for (const [k, src] of cases) {
    assert.equal(countDrift(src)[k], 1, `${k}: ${src}`);
    assert.equal(countDrift(`// ${src}`)[k], undefined, `commented ${k}`);
  }
  assert.equal(countDrift(`<!-- <nav aria-label="Breadcrumb"> -->`).crumbs, undefined);
  assert.equal(countDrift(`<nav class="topnav-crumbs" id="topnav-crumbs">`).crumbs, undefined);   // the sanctioned one
  assert.equal(countDrift(`onCrumbs(document.getElementById('topnav-crumbs'), NAV_UP);`).crumbs, undefined);
});

test('no view outside ui/public/nav/ builds a new back button, breadcrumb or tab strip (ratchet)', () => {
  const now = scan();
  const rises = [];
  const drops = [];
  for (const f of new Set([...Object.keys(now), ...Object.keys(BASELINE)])) {
    for (const k of Object.keys(PATTERNS)) {
      const a = (BASELINE[f] || {})[k] || 0;
      const b = (now[f] || {})[k] || 0;
      if (b > a) rises.push(`${f} ${k}: ${a} → ${b}`);
      if (b < a) drops.push(`${f} ${k}: ${a} → ${b}`);
    }
  }
  assert.deepEqual(rises, [], 'a new back button, breadcrumb or tab strip outside ui/public/nav/: build it from ui/public/nav/ instead');
  assert.deepEqual(drops, [], 'a count went down: lower test/fixtures/nav-drift-baseline.json to match');
});
