// Run: node plans/rail/prototype/sweep.mjs file://$PWD/plans/rail/prototype/index.html
// The glitch gate: every case × tab × width × system theme. Reports page overflow, clipped text with no tooltip,
// overlapping siblings in rows, section edges off the text edge below the card, low-contrast text, mojibake.
import { chromium } from '/Users/emil.angelov/src/worka-cc/node_modules/playwright/index.mjs';
import { writeAppCss } from './app-css.mjs';
import { writeComponentsJs } from './components-js.mjs';
writeAppCss();   // the app's CSS, assembled from its parts
writeComponentsJs();   // the Rail components, bundled for file://
const URL = process.argv[2];
const b = await chromium.launch({ channel: 'chrome' });
const issues = new Map(); const add = (k, where) => { if (!issues.has(k)) issues.set(k, []); if (issues.get(k).length < 4) issues.get(k).push(where); };
for (const scheme of ['dark', 'light']) for (const w of [375, 900]) {
  const p = await b.newPage({ viewport: { width: w, height: 900 }, colorScheme: scheme, reducedMotion: 'reduce' });
  await p.goto(URL);
  const cases = await p.evaluate(() => [...document.querySelectorAll('#case option')].map((o) => o.value));
  for (const c of cases) {
    await p.selectOption('#case', c);
    const tabs = await p.$$eval('.rc-tabs .tab', (x) => x.map((e) => e.dataset.tab));
    for (const t of tabs) {
      await p.click(`.tab[data-tab="${t}"]`);
      const found = await p.evaluate(() => {
        const out = [];
        const vw = document.documentElement.clientWidth;
        if (document.documentElement.scrollWidth > vw + 1) out.push(['page scrolls sideways', '']);
        const lum = (rgb) => { const [r, g, b] = rgb.map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
        const parse = (s) => { const m = s.match(/[\d.]+/g); return m ? m.map(Number) : null; };
        const bgOf = (el) => { for (let e = el; e; e = e.parentElement) { const c = getComputedStyle(e).backgroundColor; const v = parse(c); if (v && (v.length < 4 || v[3] > 0.5)) return v.slice(0, 3); } return [255, 255, 255]; };
        const card = document.getElementById('card');
        const all = [...card.querySelectorAll('*')].filter((e) => e.offsetParent && !e.closest('svg'));
        const txt = all.filter((e) => [...e.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim()));
        for (const e of txt) {
          const s = e.textContent;
          if (/[âÂ€]/.test(s) && /â€|Â·|â†|âˆ/.test(s)) out.push(['mojibake', s.trim().slice(0, 30)]);
          const cs = getComputedStyle(e);
          const clipped = e.scrollWidth > e.clientWidth + 1 && /hidden|clip/.test(cs.overflow + cs.overflowX) && cs.textOverflow !== 'ellipsis';
          if (clipped) out.push(['text clipped without an ellipsis', e.className + ': ' + s.trim().slice(0, 30)]);
          const ell = e.scrollWidth > e.clientWidth + 1 && cs.textOverflow === 'ellipsis';
          if (ell && !e.closest('[title]') && !e.closest('[aria-label]')) out.push(['truncated with no tooltip', e.className + ': ' + s.trim().slice(0, 30)]);
          const fg = parse(cs.color); if (!fg || (fg[3] !== undefined && fg[3] < 0.3)) continue;
          if (e.closest('[disabled],.is-future,.is-next')) continue;
          const L1 = lum(fg.slice(0, 3)), L2 = lum(bgOf(e)); const ratio = (Math.max(L1, L2) + 0.05) / (Math.min(L1, L2) + 0.05);
          const big = parseFloat(cs.fontSize) >= 18.6 || (parseFloat(cs.fontSize) >= 14 && +cs.fontWeight >= 700);
          if (ratio < (big ? 3 : 4.5) && !/rc-sep|rc-to/.test(e.className)) out.push(['contrast ' + ratio.toFixed(2), e.className + ': ' + s.trim().slice(0, 24)]);
        }
        // overlapping siblings in rows
        for (const row of card.querySelectorAll('.rc-bar,.rc-facts,.rc-chips,.rc-title-row,.ch-head,.rtab-bar,.ov-acts,.ch-tools,.rc-figs,.sc-head,.rc-confirm')) {
          const kids = [...row.children].filter((k) => k.offsetParent && getComputedStyle(k).position !== 'absolute');
          for (let i = 0; i < kids.length; i++) for (let j = i + 1; j < kids.length; j++) {
            const a = kids[i].getBoundingClientRect(), b = kids[j].getBoundingClientRect();
            if (a.width && b.width && a.left < b.right - 1 && b.left < a.right - 1 && a.top < b.bottom - 1 && b.top < a.bottom - 1) out.push(['overlap', row.className + ' > ' + kids[i].className + ' / ' + kids[j].className]);
          }
        }
        // below the card, every section's first text starts on the tab text edge
        const firstText = (el) => { const tw = document.createTreeWalker(el, NodeFilter.SHOW_TEXT, { acceptNode: (n) => (n.textContent.trim() && n.parentElement.offsetParent ? 1 : 3) }); const n = tw.nextNode(); if (!n) return null; const r = document.createRange(); r.selectNodeContents(n); return r.getBoundingClientRect().left; };
        const strip = document.querySelector('.rc-tabs');   // a strip wider than the screen scrolls to the open tab: measure as unscrolled
        const edge = firstText(document.querySelector('.rc-tabs .tab')) + (strip ? strip.scrollLeft : 0);
        const panel = document.querySelector('.rtab-panel');
        for (const sec of panel ? panel.children : []) {
          // a section that starts with a rail list keeps its marks on the rail (on the edge at 375px), as Activity's steps do
          if (sec.matches('.rtab-dec.is-runs, .rtab-stage, .rtab:has(> .rd-route-list:first-child)') || !sec.offsetParent) continue;
          const h = sec.querySelector('.rtab-h, .seg button, .btn, .ch-head') || sec;
          const boxed = h.matches('.seg button') ? h.closest('.seg') : h.matches('.btn:not(.btn-quiet)') ? h : null;   // a control with its own box lines up by the box
          const x = boxed ? boxed.getBoundingClientRect().left : firstText(h); if (x !== null && edge !== null && Math.abs(x - edge) > 1.5) out.push(['off the text edge by ' + Math.round(x - edge) + 'px', sec.className]);
        }
        return out;
      });
      for (const [k, wh] of found) add(k, `${scheme}/${w}/${c}/${t}: ${wh}`);
    }
    // Menus and dialogs: each opens inside the window, and nothing a click does moves the page.
    await p.selectOption('#case', 'starting'); await p.selectOption('#case', c);
    await p.evaluate(() => window.scrollTo(0, 260));
    const triggers = await p.$$eval('#card [data-menu], #card .tab, #card .sc-stage, #card [data-key="act-main"]', (xs) => xs.filter((x) => x.offsetParent).map((x) => x.dataset.key));
    for (const key of triggers) {
      const before = await p.evaluate(() => window.scrollY);
      const el = await p.$(`#card [data-key="${key}"]`); if (!el) continue;
      await el.evaluate((x) => x.click());   // a real click, without the test scrolling to the element first
      const r = await p.evaluate(() => {
        const vw = document.documentElement.clientWidth, vh = window.innerHeight;
        const box = document.querySelector('#card .menu, #card .pd-card');
        const b = box && box.getBoundingClientRect();
        return { y: window.scrollY, off: b ? (b.left < 15.5 || b.right > vw - 15.5 || (box.classList.contains('pd-card') && (b.top < 0 || b.bottom > vh))) : false, side: document.documentElement.scrollWidth > vw + 1 };
      });
      if (Math.abs(r.y - before) > 1 && key !== 'act-main') add('page moved on click', `${scheme}/${w}/${c}: ${key} (${before} → ${r.y})`);
      if (r.off) add('menu or dialog outside the window', `${scheme}/${w}/${c}: ${key}`);
      if (r.side) add('page scrolls sideways with a menu open', `${scheme}/${w}/${c}: ${key}`);
      await p.keyboard.press('Escape');
      await p.selectOption('#case', 'starting'); await p.selectOption('#case', c); await p.evaluate(() => window.scrollTo(0, 260));
    }
  }
  await p.close();
}
console.log(issues.size ? [...issues].map(([k, v]) => `${k}\n   ${v.join('\n   ')}`).join('\n') : 'no glitches found');
await b.close();
