// Run: node plans/rail/prototype/ds-check.mjs
// The design-system gate: a Rail page is built only from what the design system has. Reports, in the prototype's CSS,
// a colour, type size, corner or shadow that is not a token, and a token that does not exist; and, on every case of
// every page, an inline style that sets a look (not layout or data), a class no stylesheet styles, and a control that
// is not one of the design system's. A line marked `ds-ok: <reason>` is a known exception.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { chromium } from '/Users/emil.angelov/src/worka-cc/node_modules/playwright/index.mjs';
const here = (f) => fileURLToPath(new URL(f, import.meta.url));
const SHEETS = ['rail.css', 'pulse.css'];
const ALL = [here('../../../ui/public/style.css'), ...SHEETS.map(here), here('index.html'), here('pulse.html')];
const SCRIPTS = ['run-page.js', 'pulse.js', 'run-page-model.js', 'pulse-model.js'].map(here);
const issues = new Map(); const add = (k, where) => { if (!issues.has(k)) issues.set(k, new Set()); issues.get(k).add(where); };

// Every control a page may draw, by the design-system component it belongs to (docs/design-system.md › Which component).
// A <button> that is not .btn must match one of these; anything else is a control the design system does not have.
const CONTROLS = {
  Button: '.btn',
  Tabs: '.tab',
  Stepper: '.sc-stage',
  Segmented: '.seg button, .theme-ic',                       // ds-ok: .theme-ic is the account menu's icon segmented control
  CompactMenu: '.menu-item',
  SentencePicker: '.pd-base',
  SuggestionField: '.pd-ai, .pd-stop, .pd-eye, .pd-retry',
  Switch: '.switch, .sw-item',
  TagGroup: '.rc-tags-mark, .rc-tag-x',
  'Option list': '.sc-ans-opt',
  'List row': '.row-btn, .sc-step, .ch-row, .st-head, .pz-nav-i, .pz-acct, .sc-loop.is-btn',
  'Text link': '.rc-fig-link, .rc-crumb, .rc-branch, .dc-link, .ov-art-name',
};
const CONTROL_SEL = Object.values(CONTROLS).join(', ');

// --- the stylesheets ---
const tokens = new Set(); const classes = new Set();
for (const f of ALL) {
  const css = readFileSync(f, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
  for (const m of css.matchAll(/(--[a-z0-9-]+)\s*:/gi)) tokens.add(m[1]);
  for (const m of css.replace(/url\([^)]*\)/g, '').matchAll(/\.([A-Za-z_][\w-]*)/g)) classes.add(m[1]);
}
for (const f of SCRIPTS) for (const m of readFileSync(f, 'utf8').matchAll(/(--[a-z][a-z0-9-]*)\s*:/g)) tokens.add(m[1]);   // set inline from data
const SCALE = new Set([11, 12, 13, 15, 18, 22, 32]);
for (const name of SHEETS) {
  readFileSync(here(name), 'utf8').split('\n').forEach((line, i) => {
    if (/ds-ok:/.test(line)) return;
    const at = `${name}:${i + 1}`;
    const code = line.replace(/\/\*.*?\*\//g, '').replace(/url\([^)]*\)/g, '');
    for (const d of code.split(/[;{}]/)) {
      const [prop, ...rest] = d.split(':'); const p = (prop || '').trim(); const v = rest.join(':');
      if (!v) continue;
      if (/#[0-9a-f]{3,8}\b|\b(rgba?|hsla?)\(/i.test(v) && !/mask/.test(p)) add('a colour that is not a token', `${at} ${p}`);
      if (/^font(-size)?$/.test(p)) for (const m of v.matchAll(/(?<![\w.-])(\d+(?:\.\d+)?)px/g)) if (!SCALE.has(+m[1]) && !(p === 'font' && v.indexOf(m[0]) > v.indexOf('/'))) add('a type size off the scale', `${at} ${m[0]}`);
      if (p === 'border-radius' && /\d+px/.test(v) && !/var\(--r-/.test(v)) add('a corner that is not a token', `${at} ${v.trim()}`);
      if (p === 'box-shadow' && /\d+px \d+px [1-9]\d*px/.test(v) && !/var\(--shadow-/.test(v)) add('a shadow that is not a token', `${at}`);
    }
    for (const m of code.matchAll(/var\((--[a-z0-9-]+)/gi)) if (!tokens.has(m[1])) add('a token that does not exist', `${at} ${m[1]}`);
  });
}

// --- the pages ---
const b = await chromium.launch({ channel: 'chrome' });
const OPEN = ['[data-pop]', '[data-acct]', '[data-newrun]', '[data-go="settings"]', '[data-key="act-main"]', '[data-menu]', '.rc-tabs .tab:nth-child(2)', '.rc-tabs .tab:nth-child(3)', '.rc-tabs .tab:nth-child(4)', '.rc-tabs .tab:nth-child(5)'];
for (const page of ['index.html', 'pulse.html']) {
  const p = await b.newPage({ viewport: { width: 900, height: 900 } });
  p.on('pageerror', (e) => add('script error', String(e)));
  await p.goto('file://' + here(page));
  const cases = await p.evaluate(() => [...document.querySelectorAll('#case option')].map((o) => o.value));
  for (const c of cases) for (const o of [null, ...OPEN]) {
    await p.selectOption('#case', cases[(cases.indexOf(c) + 1) % cases.length]); await p.selectOption('#case', c);
    if (o) { const hit = await p.evaluate((s) => { const x = document.querySelector(s); x?.click(); return !!x; }, o); if (!hit) continue; }
    const found = await p.evaluate(([CONTROL_SEL, known]) => {
      const out = []; const known_ = new Set(known);
      const root = document.querySelector('.mk-wrap, .pz-app') ? document.body : document.body;
      for (const e of root.querySelectorAll('*')) {
        if (e.closest('.mk-bar, .mk-intro, .mk-proposed, svg')) continue;
        const st = e.getAttribute('style') || '';
        if (/#[0-9a-f]{3,8}\b|\b(rgba?|hsla?)\(/i.test(st)) out.push(['an inline colour', e.className + ': ' + st]);
        if (/(font|padding|margin|border|radius|shadow|color|background)[^:]*:\s*[^;]*\d+px/i.test(st)) out.push(['an inline style that sets a look', e.className + ': ' + st]);
        for (const c of e.classList) if (!known_.has(c) && !/^is-/.test(c)) out.push(['a class no stylesheet styles', c]);   // is-* are state hooks
        if (e.tagName === 'BUTTON' && !e.matches(CONTROL_SEL)) out.push(['a control the design system does not have', (e.className || '(no class)') + ' "' + e.textContent.trim().slice(0, 24) + '"']);
        if (e.tagName === 'BUTTON' && /^[×+▾✕✓]$/.test(e.textContent.trim())) out.push(['a typed icon (use the line icon)', e.className + ' "' + e.textContent.trim() + '"']);
      }
      return out;
    }, [CONTROL_SEL, [...classes]]);
    for (const [k, wh] of found) add(k, `${page}: ${wh}`);
    await p.keyboard.press('Escape');
  }
  await p.close();
}
await b.close();
console.log(issues.size ? [...issues].map(([k, v]) => `${k} (${v.size})\n   ${[...v].slice(0, 12).join('\n   ')}`).join('\n') : 'everything is from the design system');
process.exitCode = issues.size ? 1 : 0;
