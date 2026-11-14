// node plans/rail/prototype/gates/colour-check.mjs [--list]
// The colour gate (docs/rail/look.md › look.tokens, look.state-contrast, look.type-roles): walks the prototype's places in
// light and dark and fails when
//   1. anything visible wears a colour Rail does not have: blue, or the old working gold (running is ink);
//   2. readable text is under WCAG contrast on what is behind it: 4.5:1, or 3:1 for large text;
//   3. a state's mark ring is under 3:1 on its page.
// It prints each finding once, by its element's classes, with where it was seen and the measured value.
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
const { chromium } = createRequire(import.meta.url)('playwright-core');
import { indexUrl } from './target.mjs';
const URL_ = indexUrl();
const PLACES = ['chat', 'chat/c1', 'chat/c2', 'chat/c5', 'chat/c6', 'chat/c17', 'runs', 'schedules', 'schedule/s1', 'projects', 'projects/billing-api', 'projects/web-app', 'projects/ws:web-shop', 'workflows', 'workflows/workflow:default', 'workflows/agent:security', 'requirements/FEAT-2', 'marketplace', 'marketplace/jira-source', 'insights', 'insights/spend', 'insights/team', 'workspaces/iot', 'run/working', 'run/failed', 'run/merged', 'settings/runs', 'settings/models'];
const list = process.argv.includes('--list');

const SCAN = () => {
  const parse = (c) => { const m = c.match(/rgba?\(([^)]+)\)/); if (!m) return null; const [r, g, b, a = 1] = m[1].split(/[ ,/]+/).filter(Boolean).map(Number); return { r, g, b, a }; };
  const lum = ({ r, g, b }) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b); };
  const ratio = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
  const hsl = ({ r, g, b }) => { r /= 255; g /= 255; b /= 255; const mx = Math.max(r, g, b), mn = Math.min(r, g, b), l = (mx + mn) / 2, d = mx - mn; if (!d) return { h: 0, s: 0, l }; const s = d / (1 - Math.abs(2 * l - 1)); let h = mx === r ? ((g - b) / d) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4; h *= 60; if (h < 0) h += 360; return { h, s, l }; };
  const bgOf = (el) => { for (let e = el; e; e = e.parentElement) { const c = parse(getComputedStyle(e).backgroundColor); if (c && c.a > 0.85) return c; } return parse(getComputedStyle(document.body).backgroundColor) || { r: 255, g: 255, b: 255, a: 1 }; };
  const name = (el) => `${el.tagName.toLowerCase()}${[...el.classList].slice(0, 3).map((c) => '.' + c).join('')}`;
  const shown = (el) => { if (!el.getClientRects().length) return false; const cs = getComputedStyle(el); if (cs.visibility === 'hidden' || +cs.opacity === 0) return false; if (el.closest('[aria-hidden="true"], [hidden], .is-lent ~ *, #proto, .proto-corner, script, style')) return false; return true; };
  const out = [];
  for (const el of document.querySelectorAll('body *')) {
    if (!shown(el)) continue;
    const cs = getComputedStyle(el);
    // 1. no colour Rail does not have
    for (const [prop, v] of [['color', cs.color], ['background', cs.backgroundColor], ['border', cs.borderTopWidth !== '0px' ? cs.borderTopColor : '']]) {
      const c = v && parse(v); if (!c || c.a < 0.3) continue;
      const { h, s, l } = hsl(c);
      if (s > 0.35 && l > 0.15 && l < 0.92 && ((h >= 185 && h <= 238) || (h >= 46 && h <= 68))) out.push({ k: 'hue', who: name(el), v: `${prop} ${v}` });
    }
    // 2. readable text holds its contrast
    const text = [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim().length > 1);
    if (text && !el.closest('button[disabled], [aria-disabled="true"], .is-off, input, textarea, select, .page-bg')) {
      const fg = parse(cs.color); if (fg && fg.a > 0.5) {
        const r = ratio(fg, bgOf(el)), size = parseFloat(cs.fontSize), large = size >= 18.6 || (size >= 14 && +cs.fontWeight >= 700);
        if (r < (large ? 3 : 4.5)) out.push({ k: 'contrast', who: name(el), v: `${r.toFixed(2)}:1 · ${size}px · ${el.textContent.trim().slice(0, 24)}` });
      }
    }
  }
  // 3. a state's ring holds 3:1
  for (const m of document.querySelectorAll('.kind-mark:not(.is-idle):not(.is-wait) .km-ring circle:last-child')) {
    if (!shown(m.closest('.kind-mark'))) continue;
    const c = parse(getComputedStyle(m).stroke); if (!c) continue;
    const r = ratio(c, bgOf(m.closest('.kind-mark'))); if (r < 3) out.push({ k: 'ring', who: `kind-mark.${[...m.closest('.kind-mark').classList].join('.')}`, v: `${r.toFixed(2)}:1` });
  }
  return out;
};

const b = await chromium.launch(process.env.CHROME ? { executablePath: process.env.CHROME } : {});
const seen = new Map();
for (const theme of ['light', 'dark']) {
  const p = await b.newPage({ viewport: { width: 1280, height: 900 }, colorScheme: theme, reducedMotion: 'reduce' });
  await p.addInitScript(() => { try { localStorage.setItem('worca-rail.mode', 'expert'); } catch { /* none */ } });
  for (const place of PLACES) {
    await p.goto(`${URL_}#${place}`); await p.waitForTimeout(350);
    for (const f of await p.evaluate(SCAN)) { const key = `${f.k} ${f.who}`; if (!seen.has(key)) seen.set(key, { ...f, where: `${theme} #${place}` }); }
  }
  await p.close();
}
await b.close();
const all = [...seen.values()], by = (k) => all.filter((f) => f.k === k);
console.log(`colour: ${by('hue').length} off-palette, ${by('contrast').length} under contrast, ${by('ring').length} faint rings`);
if (list || all.length) for (const f of all) console.log(`  ${f.k.padEnd(8)} ${f.who.padEnd(44)} ${f.v} · ${f.where}`);
process.exit(all.length && !list ? 1 : 0);
