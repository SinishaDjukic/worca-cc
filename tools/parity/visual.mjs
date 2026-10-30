// tools/parity/visual.mjs — #919 slice 2: light/dark captures of the main pages and a pixel diff.
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { decodePNG, encodePNG } from '../../assets/promo-kit/tools/analyze.mjs';
import { PAGES, go } from './flows.mjs';

export const MASKS = JSON.parse(readFileSync(new URL('./visual-masks.json', import.meta.url), 'utf8'));
export const THEMES = ['light', 'dark'];
export const isPageContainer = (sel) => /^(html|body|main)$/.test(sel.trim()) || /(^|[\s>])\.view\b/.test(sel) || /\[data-view/.test(sel);

export function diffPng(bufA, bufB) {
  const a = decodePNG(bufA); const b = decodePNG(bufB);
  if (a.width !== b.width || a.height !== b.height) {
    return { pixels: Math.max(a.width * a.height, b.width * b.height), sizeMismatch: true, note: `size ${a.width}×${a.height} vs ${b.width}×${b.height}` };
  }
  let pixels = 0; const mark = new Uint8Array(a.width * a.height);
  for (let i = 0; i < mark.length; i += 1) {
    const d = i * 3;
    if (a.rgb[d] !== b.rgb[d] || a.rgb[d + 1] !== b.rgb[d + 1] || a.rgb[d + 2] !== b.rgb[d + 2]) { mark[i] = 1; pixels += 1; }
  }
  return { pixels, sizeMismatch: false, width: a.width, height: a.height, mark, a };
}

/** Differing pixels in red over a dimmed copy of A (R-ux-2). */
export function writeDiffPng(file, d) {
  const out = new Uint8Array(d.a.rgb.length);
  for (let i = 0; i < d.mark.length; i += 1) {
    const k = i * 3;
    if (d.mark[i]) { out[k] = 255; out[k + 1] = 0; out[k + 2] = 0; } else for (let c = 0; c < 3; c += 1) out[k + c] = d.a.rgb[k + c] >> 2;
  }
  writeFileSync(file, encodePNG(d.width, d.height, out));
}

/** Server-made ids differ between A and B: mask every element whose text holds one (D17). */
export const SEED_ID_KEYS = ['runId', 'heldRunId', 'pipelineId', 'threadId', 'heldPipelineId'];
export const idMasks = (page, seed) => SEED_ID_KEYS.filter((k) => seed[k]).map((k) => page.getByText(seed[k], { exact: false }));

/** 9 pages × 2 themes; theme set through the app's setting (D16). Runs before the flows, on the clean seed. */
export async function capture(page, t, seed, dir, log = () => {}) {
  const shots = [];
  for (const theme of THEMES) {
    await fetch(`${t.base}/api/settings`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ theme }) });
    for (const p of PAGES) {
      await go(page, p.hash(seed), p.view, p.sub);
      const file = join(dir, `${p.name}-${theme}.png`);
      await page.screenshot({ path: file, animations: 'disabled', caret: 'hide',
        mask: [...(MASKS[p.name] || []).map((s) => page.locator(s)), ...idMasks(page, seed)], maskColor: '#ff00ff' });
      shots.push({ page: p.name, theme, file });
      log(`shot ${p.name}/${theme}`);
    }
  }
  return shots;
}
