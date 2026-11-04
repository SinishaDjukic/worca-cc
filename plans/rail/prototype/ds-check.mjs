// Run: node plans/rail/prototype/ds-check.mjs
// The design-system gate: a Rail page is built only from what the design system has. Reports, in the prototype's CSS,
// a colour, type size, corner or shadow that is not a token, and a token that does not exist; and, on every case of
// every page, an inline style that sets a look (not layout or data), a class no stylesheet styles, and a control that
// is not one of the design system's. A line marked `ds-ok: <reason>` is a known exception.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { chromium } from '/Users/emil.angelov/src/worka-cc/node_modules/playwright/index.mjs';
import { APP_CSS, writeAppCss } from './app-css.mjs';
import { writeComponentsJs } from './components-js.mjs';
import { ALIGN } from './align-check.mjs';
writeAppCss();   // the app's CSS, assembled from its parts
writeComponentsJs();   // the Rail components, bundled for file://
const here = (f) => fileURLToPath(new URL(f, import.meta.url));
const SHEETS = ['rail-look.css', 'rail.css', 'pulse.css'];
const ALL = [APP_CSS, ...SHEETS.map(here), here('index.html'), here('pulse.html')];
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
  SentencePicker: '.pd-base, .spick-b',
  SuggestionField: '.pd-ai, .pd-stop, .pd-eye, .pd-retry',
  Switch: '.switch, .sw-item',
  TagGroup: '.rc-tags-mark, .rc-tag-x',
  OptionList: '.sc-ans-opt',
  ListRow: '.cfg-li, .row-btn, .sc-step, .ch-row, .st-head, .pz-nav-i, .pz-acct, .sc-loop.is-btn',
  'Text link': '.rc-fig-link, .rc-crumb, .rc-branch, .dc-link, .ov-art-name, .cfg-crumb',
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

// --- the components ---
// A page built from the components (ui/public/design-system/components/) writes none of their markup by hand: the
// component brings it, so a fix or an upgrade reaches every page. BUILT lists the pages moved onto them; the others
// move one at a time and join the list.
const BUILT = ['run-page.js'];
const OWN = {
  Button: /class="btn[ "]/, CompactMenu: /class="menu"/, StatusLine: /class="status-dot[ "]/, ConfirmStrip: /class="rc-confirm"/,
  Tabs: /class="(tabs|tab)[ "]/, Segmented: /class="seg"/, Figures: /class="(rc-figs|rc-fig-link)[ "]/, Toast: /class="(rc-toast|toasts)[ "]/,
  EmptyState: /class="empty-line[ "]/, 'Text link': /class="dc-link"/,
};
for (const name of BUILT) {
  readFileSync(here(name), 'utf8').split('\n').forEach((line, i) => {
    if (/ds-ok:/.test(line)) return;
    for (const [c, re] of Object.entries(OWN)) if (re.test(line)) add('markup a component builds, written by hand (use the component)', `${name}:${i + 1} ${c}`);
  });
}

// --- the pages ---
const b = await chromium.launch({ channel: 'chrome' });
const OPEN = ['break:part', 'break:background', 'break:offline', '[data-pop]', '[data-acct]', '[data-newrun]', '[data-go="settings"]', '[data-key="act-main"]', '[data-menu]', '.rc-tabs .tab:nth-child(2)', '.rc-tabs .tab:nth-child(3)', '.rc-tabs .tab:nth-child(4)', '.rc-tabs .tab:nth-child(5)'];
for (const page of ['index.html', 'pulse.html']) {
  const p = await b.newPage({ viewport: { width: 900, height: 900 } });
  p.on('pageerror', (e) => add('script error', String(e)));
  await p.goto('file://' + here(page));
  const cases = await p.evaluate(() => [...document.querySelectorAll('#case option')].map((o) => o.value));
  for (const c of cases) for (const o of [null, ...OPEN]) {
    await p.selectOption('#case', cases[(cases.indexOf(c) + 1) % cases.length]); await p.selectOption('#case', c);
    if (o && o.startsWith('break:')) { if (!(await p.$('#break'))) continue; await p.selectOption('#break', o.slice(6)); }   // the error cases
    else if (o) { const hit = await p.evaluate((s) => { const x = document.querySelector(s); x?.click(); return !!x; }, o); if (!hit) continue; }
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
    for (const m of await p.evaluate(ALIGN)) add('misaligned (the components own alignment)', `${page} ${c}: ${m}`);
    await p.keyboard.press('Escape');
  }
  // every settings section, wide and narrow
  if (await p.$('[data-go="settings"]')) {
    for (const w of [900, 400]) {
      await p.setViewportSize({ width: w, height: 900 });
      await p.evaluate(() => document.querySelector('[data-go="settings"]').click());
      const ids = await p.evaluate(() => [...document.querySelectorAll('[data-sset]')].map((e) => e.dataset.sset));
      for (const id of [...new Set(ids)]) {
        await p.evaluate((id) => document.querySelector(`[data-sset="${id}"]`)?.click(), id);
        for (const m of await p.evaluate(ALIGN)) add('misaligned (the components own alignment)', `${page} settings/${id} at ${w}px: ${m}`);
      }
    }
  }
  await p.close();
}
await b.close();
console.log(issues.size ? [...issues].map(([k, v]) => `${k} (${v.size})\n   ${[...v].slice(0, 12).join('\n   ')}`).join('\n') : 'everything is from the design system');
process.exitCode = issues.size ? 1 : 0;
