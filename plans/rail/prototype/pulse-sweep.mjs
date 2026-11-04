// Run: node plans/rail/prototype/pulse-sweep.mjs file://$PWD/plans/rail/prototype/pulse.html
// The glitch gate for Pulse (as sweep.mjs for the run page): every case × view × width × system theme. Reports page
// overflow, clipped text with no tooltip, overlaps, low contrast, menus or popovers outside the window, a click that
// moves the page, and a control that does nothing.
import { chromium } from '/Users/emil.angelov/src/worka-cc/node_modules/playwright/index.mjs';
import { writeAppCss } from './app-css.mjs';
writeAppCss();   // the app's CSS, assembled from its parts
const URL = process.argv[2];
const b = await chromium.launch({ channel: 'chrome' });
const issues = new Map(); const add = (k, where) => { if (!issues.has(k)) issues.set(k, []); if (issues.get(k).length < 4) issues.get(k).push(where); };
const click = (p, sel) => p.evaluate((s) => document.querySelector(s)?.click(), sel);
const VIEWS = {
  now: async () => {},
  popNow: async (p) => click(p, '[data-pop]'),
  popUpdates: async (p) => { await click(p, '[data-pop]'); await click(p, '[data-ptab="updates"]'); },
  account: async (p) => click(p, '[data-acct]'),
  usage: async (p) => { await click(p, '[data-acct]'); await click(p, '[data-sub="usage"]'); },
  popSelect: async (p) => { await click(p, '[data-pop]'); await click(p, '[data-ptab="updates"]'); await click(p, '[data-menu="more"]'); await click(p, '[data-pick="more|select"]'); await click(p, '[data-sel]'); },
  popNowFiltered: async (p) => { await click(p, '[data-pop]'); await click(p, '[data-menu="nowShow"]'); await click(p, '[data-pick="nowShow|running"]'); },
  popMore: async (p) => { await click(p, '[data-pop]'); await click(p, '[data-ptab="updates"]'); await click(p, '[data-menu="more"]'); },
  newrun: async (p) => click(p, '[data-newrun]'),
  newrunSmall: async (p) => { await click(p, '[data-newrun]'); await click(p, '[data-menu="nr-size"]'); await click(p, '[data-pick="nr-size|small"]'); },
  settings: async (p) => { await click(p, '[data-go="settings"]'); await click(p, '[data-sset="notifications"]'); await click(p, '[data-custom="usage"]'); },
  // every other Settings section: their rows are the same components, each with its own pickers, switches and buttons
  ...Object.fromEntries(['general', 'experimental', 'runs', 'presets', 'tags', 'automations', 'ask', 'guardrails', 'memory', 'marketplace', 'connectors', 'models', 'providers']
    .map((id) => ['settings-' + id, async (p) => { await click(p, '[data-go="settings"]'); await click(p, `[data-sset="${id}"]`); }])),
  settingsWait: async (p) => { await click(p, '[data-go="settings"]'); await click(p, '[data-sset="notifications"]'); await click(p, '[data-menu="auto"]'); await click(p, '[data-pick="auto|wait"]'); await click(p, '[data-menu="mine"]'); await click(p, '[data-pick="mine|wait"]'); await click(p, '[data-newrun]'); },
};
let clicks = 0;
for (const scheme of ['dark', 'light']) for (const w of [375, 900]) {
  const p = await b.newPage({ viewport: { width: w, height: 900 }, colorScheme: scheme, reducedMotion: 'reduce' });
  p.on('pageerror', (e) => add('script error', String(e)));
  await p.goto(URL);
  await p.evaluate((s) => { document.documentElement.dataset.theme = s; }, scheme);
  const cases = await p.evaluate(() => [...document.querySelectorAll('#case option')].map((o) => o.value));
  const reset = async (c, v) => { await p.selectOption('#case', c); await VIEWS[v](p); };
  for (const c of cases) for (const v of Object.keys(VIEWS)) {
    await reset(c, v);
    const found = await p.evaluate(() => {
      const out = [];
      const vw = document.documentElement.clientWidth, vh = window.innerHeight;
      if (document.documentElement.scrollWidth > vw + 1) out.push(['page scrolls sideways', '']);
      const lum = (rgb) => { const [r, g, b] = rgb.map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
      const parse = (s) => { const m = s.match(/[\d.]+/g); return m ? m.map(Number) : null; };
      const bgOf = (el) => { for (let e = el; e; e = e.parentElement) { const v = parse(getComputedStyle(e).backgroundColor); if (v && (v.length < 4 || v[3] > 0.5)) return v.slice(0, 3); } return [255, 255, 255]; };
      const app = document.getElementById('app');
      const txt = [...app.querySelectorAll('*')].filter((e) => e.offsetParent && !e.closest('svg') && [...e.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim()));
      for (const e of txt) {
        const s = e.textContent.trim().slice(0, 30), cs = getComputedStyle(e);
        if (e.scrollWidth > e.clientWidth + 1 && /hidden|clip/.test(cs.overflow + cs.overflowX) && cs.textOverflow !== 'ellipsis') out.push(['text clipped without an ellipsis', e.className + ': ' + s]);
        if (e.scrollWidth > e.clientWidth + 1 && cs.textOverflow === 'ellipsis' && !e.closest('[title]') && !e.closest('[aria-label]')) out.push(['truncated with no tooltip', e.className + ': ' + s]);
        const fg = parse(cs.color); if (!fg || (fg[3] !== undefined && fg[3] < 0.3) || e.closest('[aria-disabled="true"],[disabled]')) continue;
        const L1 = lum(fg.slice(0, 3)), L2 = lum(bgOf(e)), ratio = (Math.max(L1, L2) + 0.05) / (Math.min(L1, L2) + 0.05);
        const big = parseFloat(cs.fontSize) >= 18.6 || (parseFloat(cs.fontSize) >= 14 && +cs.fontWeight >= 700);
        if (ratio < (big ? 3 : 4.5) && !/pz-sep|pz-dotsep/.test(e.className)) out.push(['contrast ' + ratio.toFixed(2), e.className + ': ' + s]);
      }
      for (const row of app.querySelectorAll('.pz-row,.pz-bar,.runs-bulk,.pz-srow,.pz-sv,.pz-urow,.pz-uhead,.pz-head,.pz-top,.pz-erow,.mc-head,.pz-advice,.pz-advice-acts,.mi,.pz-phead')) {
        const kids = [...row.children].filter((k) => k.offsetParent && getComputedStyle(k).position !== 'absolute');
        for (let i = 0; i < kids.length; i++) for (let j = i + 1; j < kids.length; j++) {
          const a = kids[i].getBoundingClientRect(), d = kids[j].getBoundingClientRect();
          if (a.width && d.width && a.left < d.right - 1 && d.left < a.right - 1 && a.top < d.bottom - 1 && d.top < a.bottom - 1) out.push(['overlap', row.className + ' > ' + kids[i].className + ' / ' + kids[j].className]);
        }
      }
      for (const box of [...app.querySelectorAll('.pz-popover,.nav-fly,.pz-menu,.spick-menu')].filter((x) => x.offsetParent)) { const r = box.getBoundingClientRect(); if (r.left < 15.5 || r.right > vw - 15.5) out.push(['popover or menu outside the window', box.className]); }
      // every heading, row text and sentence on the page starts on one text edge
      const page = app.querySelector('.pz-page');
      const edges = new Set([...page.querySelectorAll('.pz-title,.pz-h,.pz-row-t,.pz-sk')].filter((e) => e.offsetParent && !e.closest('.pz-events')).map((e) => Math.round(e.getBoundingClientRect().left)));
      if (edges.size > 1) out.push(['more than one text edge', [...edges].join(', ')]);
      return out;
    });
    for (const [k, wh] of found) add(k, `${scheme}/${w}/${c}/${v}: ${wh}`);
    // every control does something, and no click moves the page
    const keys = await p.evaluate(() => [...document.querySelectorAll('#app button, #app input[type=checkbox]')].filter((x) => x.offsetParent).map((x, i) => { x.dataset.k = 'k' + i; return x.matches('[aria-selected="true"], [aria-current="page"], [role="menuitemradio"][aria-checked="true"], :disabled') ? null : 'k' + i; }).filter(Boolean));   // a tab already open, or a choice already made, has nothing to do
    for (const k of keys) {
      await reset(c, v);
      await p.evaluate(() => [...document.querySelectorAll('#app button, #app input[type=checkbox]')].filter((x) => x.offsetParent).forEach((x, i) => { x.dataset.k = 'k' + i; }));
      await p.evaluate(() => window.scrollTo(0, 200));
      const r = await p.evaluate((key) => {
        const el = document.querySelector(`[data-k="${key}"]`); if (!el) return null;
        const before = document.getElementById('app').innerHTML + document.querySelector('.rc-toast').textContent, y = window.scrollY, label = el.getAttribute('aria-label') || el.textContent.trim().slice(0, 30) || el.className;
        el.click();
        const after = document.getElementById('app').innerHTML.replace(/ data-k="k\d+"/g, '') + document.querySelector('.rc-toast').textContent;
        const maxY = document.documentElement.scrollHeight - window.innerHeight;   // a page that got shorter may have to give some back
        const goes = el.matches('[data-sset], [data-go]');   // to another page: it opens at its top
        return { label, moved: !goes && Math.abs(window.scrollY - Math.min(y, maxY)) > 1, dead: after === before.replace(/ data-k="k\d+"/g, ''), side: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1 };
      }, k);
      if (!r) continue; clicks++;
      if (r.moved) add('page moved on click', `${scheme}/${w}/${c}/${v}: ${r.label}`);
      if (r.dead) add('control did nothing', `${scheme}/${w}/${c}/${v}: ${r.label}`);
      if (r.side) add('page scrolls sideways after a click', `${scheme}/${w}/${c}/${v}: ${r.label}`);
    }
  }
  await p.close();
}
console.log(`${clicks} clicks · ` + (issues.size ? '\n' + [...issues].map(([k, v]) => `${k}\n   ${v.join('\n   ')}`).join('\n') : 'no glitches found'));
await b.close();
