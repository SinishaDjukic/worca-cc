// Run: node plans/rail/prototype/gates/ds-check.mjs
// The design-system gate: a Rail page is built only from what the design system has. Reports, in the prototype's CSS,
// a colour, type size, corner or shadow that is not a token, and a token that does not exist; and, on every case of
// every page, an inline style that sets a look (not layout or data), a class no stylesheet styles, and a control that
// is not one of the design system's. A line marked `ds-ok: <reason>` is a known exception.
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { APP_CSS, writeAppCss } from './app-css.mjs';
import { writeComponentsJs } from './components-js.mjs';
import { ALIGN } from './align-check.mjs';
import { scanText } from '../../../../tools/rail-gate.mjs';
writeAppCss();   // the app's CSS, assembled from its parts
writeComponentsJs();   // the Rail components, bundled for file://
const here = (f) => fileURLToPath(new URL('../' + f, import.meta.url));   // the prototype's root
const SHEETS = ['design-system/rail-look.css', 'design-system/rail.css', 'pulse/pulse.css'];
const ALL = [APP_CSS, ...SHEETS.map(here), here('shell/shell.css'), ...readdirSync(here('.')).filter((f) => f.endsWith('.html')).map(here)];
const FOLDERS = ['runs', 'pulse', 'settings', 'shell', 'chat'];
const SCRIPTS = FOLDERS.flatMap((d) => readdirSync(here(d)).filter((f) => f.endsWith('.js')).map((f) => here(`${d}/${f}`)));
const issues = new Map(); const add = (k, where) => { if (!issues.has(k)) issues.set(k, new Set()); issues.get(k).add(where); };

// Every control a page may draw, by the design-system component it belongs to (docs/rail/components.md).
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
  WorkflowGraph: '.wg-node',
  SideMenu: '.side-i',
  ListRow: '.lr-main, .row-btn, .sc-step, .ch-row, .st-head, .pz-nav-i, .pz-acct, .sc-loop.is-btn',
  'Text link': '.rc-fig-link, .rc-crumb, .rc-branch, .dc-link, .ov-art-name, .rl-back',
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
// Every page writes none of their markup by hand: the component brings it, so a fix or an upgrade reaches every page.
// The list reads itself: every script of every feature folder, by the same scan as npm test (tools/rail-gate.mjs).
const PAGES_JS = FOLDERS.flatMap((d) => readdirSync(here(d)).filter((f) => f.endsWith('.js')).map((f) => `${d}/${f}`));
for (const name of PAGES_JS) for (const [c, n] of Object.entries(scanText(readFileSync(here(name), 'utf8')))) add('markup or logic the library owns, written by hand (use the library)', `${name} ${c} × ${n}`);

// --- names: a page, a menu item, a section head, a settings row (docs/rail/small-rules.md) ---
const NAMES = () => {
  const out = [];
  const sel = '.pz-title, .side-menu .side-l, .set-sec-h, .set-name, .list-h, .dlg-title, .rc-tabs .tab, .menu-item:not(.pz-team) .mi-lbl';   // .pz-team is a notice, in the app's own words
  for (const e of document.querySelectorAll(sel)) {
    if (!e.offsetParent) continue;
    const t = (e.childNodes[0]?.textContent || e.textContent).trim();
    if (!t || t === 'Usage and costs') continue;   // small-rules: one thing, not two joined
    const why = /&| and /.test(t) ? 'joins two things' : /^(Your|My|This) /.test(t) ? 'starts with Your, My or This'
      : /\?$/.test(t) ? 'is a question' : /^(What|How|When|Where|Which|Up) /.test(t) ? 'is a phrase, not a name' : t.split(/\s+/).length > 3 && !e.matches('.dlg-title') ? 'is more than 3 words' : '';
    if (why) out.push(`"${t}" ${why}`);
  }
  return out;
};

// --- heads: never smaller or weaker than what they head (docs/rail/look.md) ---
// A head is a step larger than its items (a page's sections), or the same size, heavier and in --ink (a list's or a
// menu's groups).
const HEADS = () => {
  const out = []; const PAIRS = [['.side-g', '.side-i'], ['.set-sec-h', '.set-name'], ['.set-sec-h', '.lr-t'], ['.list-h', '.lr-t'], ['.pz-h', '.pz-row-t']];
  const st = (e) => { const c = getComputedStyle(e); return { size: parseFloat(c.fontSize), weight: parseFloat(c.fontWeight) }; };
  for (const [h, i] of PAIRS) {
    const head = [...document.querySelectorAll(h)].find((e) => e.offsetParent), item = [...document.querySelectorAll(i)].find((e) => e.offsetParent);
    if (!head || !item) continue;
    const a = st(head), b = st(item);
    if (a.size < b.size || (a.size === b.size && a.weight <= b.weight)) out.push(`${h} (${a.size}px/${a.weight}) heads ${i} (${b.size}px/${b.weight})`);
  }
  return out;
};

// --- the pages ---
const READ = ([CONTROL_SEL, known]) => {
      const out = []; const known_ = new Set(known);
      const root = document.querySelector('.mk-wrap, .pz-app') ? document.body : document.body;
      for (const e of root.querySelectorAll('*')) {
        if (e.closest('.mk-bar, .mk-intro, .mk-proposed, .mk-tools, #route-today, #side-rail, #topnav, svg')) continue;
        const st = e.getAttribute('style') || '';
        if (/#[0-9a-f]{3,8}\b|\b(rgba?|hsla?)\(/i.test(st)) out.push(['an inline colour', e.className + ': ' + st]);
        if (/(font|padding|margin|border|radius|shadow|color|background)[^:]*:\s*[^;]*\d+px/i.test(st)) out.push(['an inline style that sets a look', e.className + ': ' + st]);
        for (const c of e.classList) if (!known_.has(c) && !/^is-/.test(c)) out.push(['a class no stylesheet styles', c]);   // is-* are state hooks
        if (e.tagName === 'BUTTON' && !e.matches(CONTROL_SEL)) out.push(['a control the design system does not have', (e.className || '(no class)') + ' "' + e.textContent.trim().slice(0, 24) + '"']);
        if (e.tagName === 'BUTTON' && /^[×+▾✕✓]$/.test(e.textContent.trim())) out.push(['a typed icon (use the line icon)', e.className + ' "' + e.textContent.trim() + '"']);
      }
      return out;
    };
const b = await chromium.launch({ channel: 'chrome' });
const OPEN = ['break:part', 'break:background', 'break:offline', '[data-pop]', '[data-acct]', '[data-newrun]', '[data-key="act-main"]', '[data-menu]', '.rc-tabs .tab:nth-child(2)', '.rc-tabs .tab:nth-child(3)', '.rc-tabs .tab:nth-child(4)', '.rc-tabs .tab:nth-child(5)'];
for (const page of readdirSync(here('.')).filter((f) => f.endsWith('.html') && f !== 'components.html')) {
  const p = await b.newPage({ viewport: { width: 900, height: 900 } });
  p.on('pageerror', (e) => add('script error', String(e)));
  await p.goto('file://' + here(page));
  const cases = page === 'index.html' ? [] : await p.evaluate(() => [...document.querySelectorAll('#case option')].map((o) => o.value));   // the one Worca's pages are read by route, below
  for (const c of cases) for (const o of [null, ...OPEN]) {
    await p.selectOption('#case', cases[(cases.indexOf(c) + 1) % cases.length]); await p.selectOption('#case', c);
    if (o && o.startsWith('break:')) { if (!(await p.$('#break'))) continue; await p.selectOption('#break', o.slice(6)); }   // the error cases
    else if (o) { const hit = await p.evaluate((s) => { const x = document.querySelector(s); x?.click(); return !!x; }, o); if (!hit) continue; }
    const found = await p.evaluate(READ, [CONTROL_SEL, [...classes]]);
    for (const [k, wh] of found) add(k, `${page}: ${wh}`);
    for (const m of await p.evaluate(ALIGN)) add('misaligned (the components own alignment)', `${page} ${c}: ${m}`);
    for (const m of await p.evaluate(NAMES)) add('a name against the naming rule', `${page}: ${m}`);
    for (const m of await p.evaluate(HEADS)) add('a head smaller or weaker than what it heads', `${page}: ${m}`);
    await p.keyboard.press('Escape');
  }
  // the one Worca's own lists, in the states a click opens: read like a case
  if (page === 'index.html') for (const [route, root] of [['runs', '#runs-root'], ['chat', '#chats-root']]) {
    await p.goto(`file://${here(page)}#${route}`); await p.waitForTimeout(80);
    for (const o of ['', '[data-menu="show"]', '[data-menu="tools"]', '[data-menu^="row:"]', '[data-fold]', '[data-rounds]', '[data-pick="tools|select"]']) {
      if (o) await p.evaluate((s) => document.querySelector(s)?.click(), `${root} ${o}`);
      const found = await p.evaluate(READ, [CONTROL_SEL, [...classes]]);
      for (const [k, wh] of found) add(k, `${page}#${route}: ${wh}`);
      for (const m of await p.evaluate(NAMES)) add('a name against the naming rule', `${page}#${route}: ${m}`);
      for (const m of await p.evaluate(HEADS)) add('a head smaller or weaker than what it heads', `${page}#${route}: ${m}`);
    }
    await p.evaluate((s) => { document.querySelector(`${s} [data-menu="tools"]`)?.click(); document.querySelector(`${s} [data-menu-pick="tools|select"]`)?.click(); }, root);
    await p.evaluate((s) => document.querySelector(`${s} [data-sel]`)?.click(), root);
    for (const [k, wh] of await p.evaluate(READ, [CONTROL_SEL, [...classes]])) add(k, `${page}#${route} selecting: ${wh}`);
  }
  // every settings section, wide and narrow
  if (await p.$('[data-acct]')) {   // Settings opens from the profile menu
    for (const w of [900, 400]) {
      await p.setViewportSize({ width: w, height: 900 });
      await p.evaluate(() => { document.querySelector('[data-acct]').click(); document.querySelector('[data-go="settings"]').click(); });
      const ids = await p.evaluate(() => [...document.querySelectorAll('[data-sset]')].map((e) => e.dataset.sset));
      for (const id of [...new Set(ids)]) {
        await p.evaluate((id) => document.querySelector(`[data-sset="${id}"]`)?.click(), id);
        for (const m of await p.evaluate(ALIGN)) add('misaligned (the components own alignment)', `${page} settings/${id} at ${w}px: ${m}`);
        for (const m of await p.evaluate(NAMES)) add('a name against the naming rule', `${page} settings/${id}: ${m}`);
        for (const m of await p.evaluate(HEADS)) add('a head smaller or weaker than what it heads', `${page} settings/${id} at ${w}px: ${m}`);
      }
    }
  }
  await p.close();
}
await b.close();
console.log(issues.size ? [...issues].map(([k, v]) => `${k} (${v.size})\n   ${[...v].slice(0, 12).join('\n   ')}`).join('\n') : 'everything is from the design system');
process.exitCode = issues.size ? 1 : 0;
